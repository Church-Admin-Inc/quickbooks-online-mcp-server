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

interface StoredAuditLogEntry extends Record<string, unknown> {
  employeeSub: string;
  employeeEmail: string;
  realmId: string;
  toolName: string;
  // JSON-serialized: params can nest arrays/objects of arbitrary shape, and
  // FirestoreDocRefLike.set() is not guaranteed to round-trip those faithfully.
  params: string;
  recordedAt: string;
}

/**
 * Firestore-shaped audit log, mirroring FirestoreGrantStore's seam
 * (../clients/firestore-grant-store.ts) so a real Firestore client can stand
 * in later with no adapter code. Each entry gets its own document (no
 * updates, no deletes - an audit log is append-only).
 */
export class FirestoreAuditLog implements AuditLogger {
  constructor(
    private readonly firestore: FirestoreLike,
    private readonly collectionPath: string = "audit-log"
  ) {}

  async record(entry: AuditLogEntry): Promise<void> {
    const id = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const stored: StoredAuditLogEntry = {
      employeeSub: entry.employeeSub,
      employeeEmail: entry.employeeEmail,
      realmId: entry.realmId,
      toolName: entry.toolName,
      params: JSON.stringify(entry.params),
      recordedAt: new Date().toISOString(),
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
