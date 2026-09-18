import crypto from "node:crypto";
import type { GrantStore } from "../clients/firestore-grant-store.js";
import type { EmployeeContext } from "../context/employee-context.js";

/**
 * The single authorization checkpoint every Company resolution passes
 * through (issue #8, ADR 0002): seeded with "any Company the employee holds
 * a grant for" — a call is authorized exactly when the calling employee
 * already holds a healthy grant for the named Company, and there is no
 * separate allow-list. register-tool.ts (the one chokepoint every tool
 * passes through, see its own docstring) calls checkCompanyAuthorization()
 * before invoking a tool's handler; a "needs authorization" result carries a
 * URL the employee opens to complete the grant via ../http/company-oauth-http.js.
 */

export const COMPANY_AUTHORIZE_PATH = "/auth/quickbooks/authorize";
export const COMPANY_CALLBACK_PATH = "/auth/quickbooks/callback";

/** How long a start token minted by the checkpoint stays valid before the employee must retry the tool call. */
export const PENDING_AUTHORIZATION_TTL_SECONDS = 600;

export interface PendingCompanyAuthorization {
  employeeSub: string;
  realmId: string;
  expiresAt: number;
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * One-time start tokens binding a checkpoint decision (this employee, this
 * Company) to the browser flow that completes it — mirrors OAuthStore's
 * pendingLogins map (see ../auth/oauth-store.ts) in shape and lifecycle.
 */
export class CompanyAuthorizationStore {
  private readonly pending = new Map<string, PendingCompanyAuthorization>();

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.expiresAt < now) this.pending.delete(key);
    }
  }

  /** Current entry count, exposed for tests and operational visibility into sweepExpired()'s effect. */
  size(): number {
    return this.pending.size;
  }

  create(record: { employeeSub: string; realmId: string }, ttlSeconds: number = PENDING_AUTHORIZATION_TTL_SECONDS): string {
    this.sweepExpired();
    const token = randomToken();
    this.pending.set(token, { ...record, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  /** Looks up and removes a start token (single use), or undefined if unknown/expired. */
  consume(token: string): PendingCompanyAuthorization | undefined {
    const record = this.pending.get(token);
    this.pending.delete(token);
    if (!record || record.expiresAt < Date.now()) return undefined;
    return record;
  }
}

export interface CompanyAuthorizationDeps {
  grantStore: GrantStore;
  pending: CompanyAuthorizationStore;
}

export type CompanyAuthorizationResult = { authorized: true } | { authorized: false; authorizeUrl: string };

/**
 * Checks whether `employee` already holds a healthy grant for `realmId`. If
 * not, mints a one-time start token and returns the URL the employee opens
 * to authorize it — never an error, per the acceptance criteria this
 * implements ("a call naming a Company the employee has no grant for prompts
 * authorization rather than erroring").
 */
export async function checkCompanyAuthorization(
  deps: CompanyAuthorizationDeps,
  employee: EmployeeContext,
  realmId: string,
  origin: string
): Promise<CompanyAuthorizationResult> {
  const grant = await deps.grantStore.forGrant({ employeeSub: employee.sub, realmId }).read();
  if (grant && grant.health === "healthy") {
    return { authorized: true };
  }

  const token = deps.pending.create({ employeeSub: employee.sub, realmId });
  const authorizeUrl = new URL(COMPANY_AUTHORIZE_PATH, origin);
  authorizeUrl.searchParams.set("token", token);
  return { authorized: false, authorizeUrl: authorizeUrl.toString() };
}
