import crypto from "node:crypto";
import type { FirestoreLike } from "../clients/firestore-grant-store.js";
import { createFirestore } from "../clients/cloud-firestore.js";

/**
 * Independent write audit trail (issue #10). QuickBooks' own audit log
 * already attributes writes to the authorizing person (ADR 0002), but it is
 * silent on writes that never reached QuickBooks at all, and it is entirely
 * outside this agency's control. This is the record that survives whatever
 * QuickBooks does or does not retain: recorded by
 * ../helpers/register-tool.ts, the one chokepoint every write already passes
 * through, BEFORE the write is attempted, so a call that throws or a
 * QuickBooks outage never leaves a write unaccounted for.
 */
export interface AuditLogEntry {
  employeeSub: string;
  employeeEmail: string;
  realmId: string;
  toolName: string;
  /** The tool's own parameters, already stripped of realm_id and any undeclared keys (see register-tool.ts). Never contains credentials or tokens - tool params never carry them. */
  params: Record<string, unknown>;
}

export interface AuditLogger {
  record(entry: AuditLogEntry): Promise<void>;
}

/**
 * How long an audit entry lives before Firestore deletes it.
 *
 * Seven years matches the retention of the financial records the entry
 * describes — the entries carry the tool's parameters, which for bookkeeping
 * operations means amounts, dates, account and class names and memo text, so
 * this is a Company's financial detail. Keeping it exactly as long as the books it
 * documents is what justifies keeping it at all; keeping it longer is
 * retention nobody can defend, and shorter would leave writes unaccounted for
 * while the records they touched are still live. Stated as the retention
 * period in docs/legal/privacy-policy.md, which a published Privacy Policy
 * has to name (issue #33).
 */
export const AUDIT_LOG_RETENTION_YEARS = 7;

/**
 * The instant an entry recorded at `recordedAt` expires. Calendar arithmetic
 * rather than a fixed span of milliseconds, so the leap days inside the window
 * do not pull the date backwards (seven fixed 365-day years land up to two
 * days early). The one imprecision left is a Feb 29 entry, which lands on Mar
 * 1 — seven years is never a leap-to-leap span — and a day either way is
 * meaningless at this scale.
 */
export function auditLogExpiryFor(recordedAt: Date): Date {
  const expiresAt = new Date(recordedAt.getTime());
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + AUDIT_LOG_RETENTION_YEARS);
  return expiresAt;
}

interface StoredAuditLogEntry extends Record<string, unknown> {
  employeeSub: string;
  employeeEmail: string;
  realmId: string;
  toolName: string;
  // JSON-serialized: params can nest arrays/objects of arbitrary shape, and
  // FirestoreDocRefLike.set() is not guaranteed to round-trip those faithfully.
  params: string;
  recordedAt: string;
  /**
   * Firestore TTL field (docs/deploy.md): a real Date, since the Admin SDK
   * maps it to the Timestamp a TTL policy requires — unlike `recordedAt`,
   * which stays an ISO string for readability. Expiry is the infrastructure's
   * job, not the maintenance job's (src/jobs/grant-maintenance.ts): entries
   * age out even if no sweep ever runs again.
   */
  expiresAt: Date;
}

/**
 * Firestore-shaped audit log, mirroring FirestoreGrantStore's seam
 * (../clients/firestore-grant-store.ts) so a real Firestore client can stand
 * in later with no adapter code. Each entry gets its own document (no
 * updates, and no deletes this code performs — an audit log is append-only;
 * the only deletion is Firestore's TTL sweep of `expiresAt`, see
 * AUDIT_LOG_RETENTION_YEARS).
 */
export class FirestoreAuditLog implements AuditLogger {
  constructor(
    private readonly firestore: FirestoreLike,
    private readonly collectionPath: string = "audit-log"
  ) {}

  async record(entry: AuditLogEntry): Promise<void> {
    const id = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const recordedAt = new Date();
    const stored: StoredAuditLogEntry = {
      employeeSub: entry.employeeSub,
      employeeEmail: entry.employeeEmail,
      realmId: entry.realmId,
      toolName: entry.toolName,
      params: JSON.stringify(entry.params),
      recordedAt: recordedAt.toISOString(),
      expiresAt: auditLogExpiryFor(recordedAt),
    };
    await this.firestore.doc(`${this.collectionPath}/${id}`).set(stored);
  }
}

/**
 * Default audit log, backed by real Firestore when deployed (issue #13's
 * createFirestore()) or an in-process store otherwise — see
 * createDefaultCompanyOAuthDeps() in ../http/company-oauth-http.ts for the
 * same selection applied to the grant store.
 */
export function createDefaultAuditLog(): AuditLogger {
  return new FirestoreAuditLog(createFirestore());
}
