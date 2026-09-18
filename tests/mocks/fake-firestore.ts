import type {
  FirestoreDocRefLike,
  FirestoreDocSnapshotLike,
  FirestoreLike,
  FirestoreTransactionLike,
} from "../../src/clients/firestore-grant-store.js";

/**
 * An in-memory stand-in for the Firestore seam FirestoreGrantStore depends
 * on (see src/clients/firestore-grant-store.ts). Models just enough of real
 * Firestore transaction semantics — a read establishes a version, a commit
 * that finds any read document changed since is rejected rather than
 * applied — to exercise the store's own single-flight and race-safety
 * behaviour without the Firestore emulator (see #1/#7).
 */
export class FakeFirestore implements FirestoreLike {
  private readonly docs = new Map<string, { data: Record<string, unknown>; version: number }>();

  doc(path: string): FirestoreDocRefLike {
    return {
      path,
      get: async () => this.snapshotOf(path),
      set: async (data) => {
        this.write(path, data);
      },
    };
  }

  async listCollection(collectionPath: string): Promise<Record<string, unknown>[]> {
    const prefix = `${collectionPath}/`;
    const results: Record<string, unknown>[] = [];
    for (const [path, doc] of this.docs) {
      if (path.startsWith(prefix)) results.push({ ...doc.data });
    }
    return results;
  }

  async runTransaction<T>(
    updateFunction: (transaction: FirestoreTransactionLike) => Promise<T>,
    options?: { maxAttempts?: number }
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? 5;
    let lastConflict: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readVersions = new Map<string, number>();
      const pendingWrites = new Map<string, Record<string, unknown>>();

      const tx: FirestoreTransactionLike = {
        get: async (ref) => {
          readVersions.set(ref.path, this.docs.get(ref.path)?.version ?? 0);
          return this.snapshotOf(ref.path);
        },
        set: (ref, data) => {
          pendingWrites.set(ref.path, data);
        },
      };

      // Any error thrown by the caller's update function (e.g. the
      // supplied `refresh` callback rejecting) propagates immediately —
      // it is an application failure, not transient contention, so it is
      // never retried here.
      const result = await updateFunction(tx);

      const conflicted = [...readVersions].some(
        ([path, readVersion]) => (this.docs.get(path)?.version ?? 0) !== readVersion
      );
      if (!conflicted) {
        for (const [path, data] of pendingWrites) {
          this.write(path, data);
        }
        return result;
      }

      lastConflict = new Error(`Firestore transaction aborted: concurrent modification of a read document`);
      if (attempt >= maxAttempts) throw lastConflict;
    }

    throw lastConflict;
  }

  private snapshotOf(path: string): FirestoreDocSnapshotLike {
    const doc = this.docs.get(path);
    return {
      exists: doc !== undefined,
      data: () => (doc ? { ...doc.data } : undefined),
    };
  }

  private write(path: string, data: Record<string, unknown>): void {
    const nextVersion = (this.docs.get(path)?.version ?? 0) + 1;
    this.docs.set(path, { data: { ...data }, version: nextVersion });
  }
}
