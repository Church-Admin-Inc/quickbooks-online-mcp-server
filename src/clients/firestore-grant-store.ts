/**
 * Per-employee-and-Company grant storage for multi-Company mode (issue #7,
 * ADR 0002). One Firestore document per (employee, Company) pair, holding
 * the refresh token, its rotation state, last-refreshed/last-used
 * timestamps, and health.
 *
 * `GrantHandle` mirrors the read/save shape `TokenGrantStore` (see
 * token-grant-store.ts, #3) introduced for the single-tenant file store, but
 * async — Firestore is network-backed — and scoped to one grant key rather
 * than one process-wide token. FileTokenGrantStore/QuickbooksClient are
 * untouched; wiring a Company-aware client onto this store is later work
 * (#8), so the refresh logic itself is not rewritten here.
 */

// ── Firestore seam ───────────────────────────────────────────────────────
// The minimal slice of the Firestore Admin SDK's shape this store needs —
// doc()/get()/set() and a transaction with get()/set() — kept close to the
// real SDK's own API so a real Firestore instance can stand in later with
// little to no adapter code. Deliberately not exercised against the
// Firestore emulator (see #1's testing decisions): a fake implementing this
// interface is the seam tests drive.
export interface FirestoreDocSnapshotLike {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreDocRefLike {
  readonly path: string;
  get(): Promise<FirestoreDocSnapshotLike>;
  set(data: Record<string, unknown>): Promise<void>;
}

export interface FirestoreTransactionLike {
  get(ref: FirestoreDocRefLike): Promise<FirestoreDocSnapshotLike>;
  set(ref: FirestoreDocRefLike, data: Record<string, unknown>): void;
}

export interface FirestoreLike {
  doc(path: string): FirestoreDocRefLike;
  /**
   * `maxAttempts` defaults to the real SDK's automatic-retry behaviour, but
   * this store always passes 1: the update function calls out to Intuit
   * (via the caller-supplied `refresh` callback), and re-invoking that on a
   * commit conflict would fire a second, unwanted refresh against Intuit.
   */
  runTransaction<T>(
    updateFunction: (transaction: FirestoreTransactionLike) => Promise<T>,
    options?: { maxAttempts?: number }
  ): Promise<T>;
  /**
   * Every document currently stored under `collectionPath` (issue #9's
   * `list_companies`: enumerating the Companies one employee holds grants
   * for needs a collection scan, unlike every other operation here, which is
   * a single-document get/set keyed by grant id).
   */
  listCollection(collectionPath: string): Promise<Record<string, unknown>[]>;
}

// ── Domain ───────────────────────────────────────────────────────────────

/** Identifies one employee-and-Company grant, mirroring EmployeeContext.sub and CompanyContext.realmId. */
export interface GrantKey {
  employeeSub: string;
  realmId: string;
}

export type GrantHealth = "healthy" | "unhealthy";

export interface Grant {
  employeeSub: string;
  realmId: string;
  refreshToken: string;
  /**
   * The Company's human-readable QuickBooks name (issue #9's `list_companies`),
   * captured once at grant creation from CompanyInfo so it survives even once
   * the connection later goes unhealthy and QuickBooks can no longer be asked.
   */
  companyName: string;
  createdAt: Date;
  lastRefreshedAt: Date;
  lastUsedAt: Date | undefined;
  health: GrantHealth;
}

export class GrantNotFoundError extends Error {
  constructor(key: GrantKey) {
    super(`No grant found for employee "${key.employeeSub}" and Company "${key.realmId}"`);
  }
}

/** One grant's read/save operations, scoped to the key it was obtained for. */
export interface GrantHandle {
  readonly key: GrantKey;

  /** The grant currently persisted, or undefined if none exists yet. */
  read(): Promise<Grant | undefined>;

  /**
   * Persists a brand-new grant (first-touch authorization). `companyName`
   * defaults to the realm id when omitted (existing callers/tests that
   * predate issue #9 and don't care about the display name).
   */
  create(refreshToken: string, companyName?: string): Promise<Grant>;

  /**
   * Exchanges the current refresh token via `refresh` and persists whatever
   * comes back — unconditionally, since Intuit rotates roughly daily rather
   * than on every call. Concurrent calls for the same key, from this same
   * store instance, share one underlying refresh (single-flight); a
   * transactional commit guards against a second store instance (e.g. a
   * sibling process) racing the same underlying document.
   */
  refresh(exchangeToken: (currentRefreshToken: string) => Promise<{ refreshToken: string }>): Promise<Grant>;

  /** Records that the grant was just used successfully. */
  recordUse(): Promise<void>;

  /** Records the grant's health, e.g. after Intuit rejects it outright. */
  recordHealth(health: GrantHealth): Promise<void>;
}

export interface GrantStore {
  forGrant(key: GrantKey): GrantHandle;

  /**
   * Every grant currently held by `employeeSub`, across every Company
   * (issue #9's `list_companies`) — the one place this store is queried by
   * something other than a single grant key.
   */
  listForEmployee(employeeSub: string): Promise<Grant[]>;

  /**
   * Every grant currently stored, across every employee and Company (issue
   * #12's scheduled maintenance job: the daily refresh, weekly
   * re-validation, and 30-day expiry sweeps all need the whole set, not one
   * employee's slice).
   */
  listAll(): Promise<Grant[]>;
}

interface StoredGrantData {
  [key: string]: unknown;
  employeeSub: string;
  realmId: string;
  refreshToken: string;
  companyName: string;
  createdAt: string;
  lastRefreshedAt: string;
  lastUsedAt: string | null;
  health: GrantHealth;
}

function grantId(key: GrantKey): string {
  return `${key.employeeSub}:${key.realmId}`;
}

function asStoredGrantData(data: Record<string, unknown> | undefined): StoredGrantData {
  return data as StoredGrantData;
}

function toGrant(stored: StoredGrantData): Grant {
  return {
    employeeSub: stored.employeeSub,
    realmId: stored.realmId,
    refreshToken: stored.refreshToken,
    // Falls back to the realm id for any grant created before issue #9 added
    // this field, so an old stored document still round-trips.
    companyName: stored.companyName || stored.realmId,
    createdAt: new Date(stored.createdAt),
    lastRefreshedAt: new Date(stored.lastRefreshedAt),
    lastUsedAt: stored.lastUsedAt ? new Date(stored.lastUsedAt) : undefined,
    health: stored.health,
  };
}

export class FirestoreGrantStore implements GrantStore {
  // In-process single-flight, keyed by grant id: concurrent refresh() calls
  // for the same grant, from THIS store instance, share one underlying
  // refresh rather than each racing Intuit's rotation independently.
  private readonly inFlightRefreshes = new Map<string, Promise<Grant>>();

  constructor(
    private readonly firestore: FirestoreLike,
    private readonly collectionPath: string = "grants"
  ) {}

  forGrant(key: GrantKey): GrantHandle {
    return {
      key,
      read: () => this.read(key),
      create: (refreshToken, companyName) => this.create(key, refreshToken, companyName),
      refresh: (exchangeToken) => this.refresh(key, exchangeToken),
      recordUse: () => this.recordUse(key),
      recordHealth: (health) => this.recordHealth(key, health),
    };
  }

  async listForEmployee(employeeSub: string): Promise<Grant[]> {
    const docs = await this.firestore.listCollection(this.collectionPath);
    return docs
      .map((data) => asStoredGrantData(data))
      .filter((stored) => stored.employeeSub === employeeSub)
      .map(toGrant);
  }

  async listAll(): Promise<Grant[]> {
    const docs = await this.firestore.listCollection(this.collectionPath);
    return docs.map((data) => asStoredGrantData(data)).map(toGrant);
  }

  private docRef(key: GrantKey): FirestoreDocRefLike {
    return this.firestore.doc(`${this.collectionPath}/${grantId(key)}`);
  }

  private async read(key: GrantKey): Promise<Grant | undefined> {
    const snap = await this.docRef(key).get();
    if (!snap.exists) return undefined;
    return toGrant(asStoredGrantData(snap.data()));
  }

  private async create(key: GrantKey, refreshToken: string, companyName?: string): Promise<Grant> {
    const now = new Date().toISOString();
    const stored: StoredGrantData = {
      employeeSub: key.employeeSub,
      realmId: key.realmId,
      refreshToken,
      companyName: companyName || key.realmId,
      createdAt: now,
      lastRefreshedAt: now,
      lastUsedAt: null,
      health: "healthy",
    };
    await this.docRef(key).set(stored);
    return toGrant(stored);
  }

  private recordUse(key: GrantKey): Promise<void> {
    return this.patch(key, () => ({ lastUsedAt: new Date().toISOString() }));
  }

  private recordHealth(key: GrantKey, health: GrantHealth): Promise<void> {
    return this.patch(key, () => ({ health }));
  }

  /**
   * Reads the current grant, applies `updateFields`, and commits the merged
   * result — inside the same transactional guard `refresh()` uses, so a
   * recordUse()/recordHealth() call racing a concurrent refresh() can't read
   * stale data and clobber the refresh's write.
   */
  private async patch(
    key: GrantKey,
    updateFields: (stored: StoredGrantData) => Partial<StoredGrantData>
  ): Promise<void> {
    const ref = this.docRef(key);
    await this.firestore.runTransaction(
      async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new GrantNotFoundError(key);
        const stored = asStoredGrantData(snap.data());
        tx.set(ref, { ...stored, ...updateFields(stored) });
      },
      { maxAttempts: 1 }
    );
  }

  private refresh(
    key: GrantKey,
    exchangeToken: (currentRefreshToken: string) => Promise<{ refreshToken: string }>
  ): Promise<Grant> {
    const id = grantId(key);
    const inFlight = this.inFlightRefreshes.get(id);
    if (inFlight) return inFlight;

    const promise = this.performRefresh(key, exchangeToken).finally(() => {
      this.inFlightRefreshes.delete(id);
    });
    this.inFlightRefreshes.set(id, promise);
    return promise;
  }

  private async performRefresh(
    key: GrantKey,
    exchangeToken: (currentRefreshToken: string) => Promise<{ refreshToken: string }>
  ): Promise<Grant> {
    const ref = this.docRef(key);
    return this.firestore.runTransaction(
      async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new GrantNotFoundError(key);
        const stored = asStoredGrantData(snap.data());

        const { refreshToken } = await exchangeToken(stored.refreshToken);

        const updated: StoredGrantData = {
          ...stored,
          refreshToken,
          lastRefreshedAt: new Date().toISOString(),
          health: "healthy",
        };
        tx.set(ref, updated);
        return toGrant(updated);
      },
      { maxAttempts: 1 }
    );
  }
}
