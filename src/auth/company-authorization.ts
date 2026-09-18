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

export type CompanyAuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      authorizeUrl: string;
      reason: "missing" | "unhealthy";
      /**
       * The Company's human-readable QuickBooks name (issue #9), present
       * whenever a grant already exists to read it from (reason "unhealthy")
       * — never for "missing", since no grant has ever recorded a name for a
       * Company nobody has authorized yet. Lets the response name the Company
       * the way the employee actually refers to it, not by its opaque realm
       * id — the whole point `list_companies` (also issue #9) exists to spare
       * them from.
       */
      companyName?: string;
    };

/**
 * Mints a one-time start token for (employee, Company) and builds the
 * absolute URL the employee's browser opens to authorize it. Shared by
 * checkCompanyAuthorization() below and by
 * ../clients/grant-quickbooks-clients.ts (issue #9), which needs the exact
 * same link when it detects a grant just died mid-call — same endpoints, same
 * one-time-token lifecycle, so there is exactly one authorization UX rather
 * than two.
 */
export function mintCompanyAuthorizeUrl(
  pending: CompanyAuthorizationStore,
  record: { employeeSub: string; realmId: string },
  origin: string
): string {
  const token = pending.create(record);
  const authorizeUrl = new URL(COMPANY_AUTHORIZE_PATH, origin);
  authorizeUrl.searchParams.set("token", token);
  return authorizeUrl.toString();
}

/**
 * Checks whether `employee` already holds a healthy grant for `realmId`. If
 * not, mints a one-time start token and returns the URL the employee opens
 * to authorize it — never an error, per the acceptance criteria this
 * implements ("a call naming a Company the employee has no grant for prompts
 * authorization rather than erroring"). `reason` distinguishes a Company
 * never authorized at all ("missing") from one whose grant died since
 * (issue #9's "unhealthy") so register-tool.ts's response can address the
 * employee accurately in either case.
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

  const authorizeUrl = mintCompanyAuthorizeUrl(deps.pending, { employeeSub: employee.sub, realmId }, origin);
  return { authorized: false, authorizeUrl, reason: grant ? "unhealthy" : "missing", companyName: grant?.companyName };
}
