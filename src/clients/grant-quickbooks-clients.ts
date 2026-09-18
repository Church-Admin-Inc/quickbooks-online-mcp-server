import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import { GrantNotFoundError, type GrantStore } from "./firestore-grant-store.js";
import type { MultiTenantQuickbooksResolver } from "./quickbooks-client.js";
import { isAuthInvalidationError } from "../helpers/intuit-auth-errors.js";
import { mintCompanyAuthorizeUrl, type CompanyAuthorizationStore } from "../auth/company-authorization.js";
import { getCurrentRequestContext } from "../context/request-context.js";

/**
 * Wires a Company-aware client onto the grant store (issue #8) — the piece
 * ../clients/firestore-grant-store.ts's docstring calls out as later work.
 * Resolves a QuickBooks instance per (employee, Company) from whatever grant
 * checkCompanyAuthorization() already confirmed exists, rather than the
 * single process-wide client QuickbooksClient uses for single-tenant/stdio.
 * Registered onto QuickbooksClient via setMultiTenantResolver() so every
 * existing handler's QuickbooksClient.getInstance() call routes here
 * whenever an employee context is active, with no handler changes.
 */

// Mirrors QuickbooksClient's own refresh buffer (see quickbooks-client.ts).
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface GrantQuickbooksClientsConfig {
  clientId: string;
  clientSecret: string;
  environment: string;
}

export class GrantBackedQuickbooksClients implements MultiTenantQuickbooksResolver {
  // In-process cache of short-lived access tokens, keyed by "employeeSub:realmId".
  // Refresh tokens are never cached here — GrantHandle.refresh() below is the
  // single source of truth for them, single-flight and transactional per
  // ../clients/firestore-grant-store.ts.
  private readonly accessTokens = new Map<string, CachedAccessToken>();
  private config?: GrantQuickbooksClientsConfig;
  private oauthClient?: OAuthClient;

  /**
   * Takes a config LOADER, called lazily on first actual use — mirrors
   * ../auth/intuit-accounting-authorization-provider.ts's own reasoning: this
   * lets ../http/create-streamable-http-server.ts wire this class up
   * unconditionally, even on a process where QUICKBOOKS_CLIENT_ID/SECRET
   * aren't set (most test suites), without throwing until a multi-tenant
   * grant is genuinely resolved.
   *
   * `pending` (issue #9) is optional so existing callers/tests that never
   * exercise a dead-grant path keep working unchanged; when supplied it lets
   * a mid-call auth failure mint the SAME kind of re-authorize link
   * register-tool.ts's checkpoint hands out on the NEXT call, rather than two
   * different authorization UXes.
   */
  constructor(
    private readonly grantStore: GrantStore,
    private readonly loadConfig: () => GrantQuickbooksClientsConfig,
    private readonly pending?: CompanyAuthorizationStore
  ) {}

  private ensureConfig(): GrantQuickbooksClientsConfig {
    if (!this.config) {
      this.config = this.loadConfig();
      // redirectUri is irrelevant to a refresh-token exchange (only the
      // authorize/exchange pair binds to it), so a placeholder is fine here.
      this.oauthClient = new OAuthClient({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        environment: this.config.environment,
        redirectUri: "https://unused.invalid/callback",
      });
    }
    return this.config;
  }

  async getAuthCredentials(
    employeeSub: string,
    realmId: string
  ): Promise<{ accessToken: string; realmId: string; isSandbox: boolean }> {
    const accessToken = await this.resolveAccessToken(employeeSub, realmId);
    return { accessToken, realmId, isSandbox: this.ensureConfig().environment === "sandbox" };
  }

  async getInstance(employeeSub: string, realmId: string): Promise<QuickBooks> {
    const accessToken = await this.resolveAccessToken(employeeSub, realmId);
    const config = this.ensureConfig();
    return new QuickBooks(
      config.clientId,
      config.clientSecret,
      accessToken,
      false, // no token secret for OAuth 2.0
      realmId,
      config.environment === "sandbox",
      false, // debug?
      null, // minor version
      "2.0" // oauth version
    );
  }

  /**
   * Plain-language, Company-named message for a grant that just died
   * mid-call (issue #9's "no raw Intuit error text reaches the employee").
   * Names the Company by `companyName` when known (the point of
   * `list_companies`, also issue #9) rather than its opaque realm id.
   * Includes a fresh re-authorization link when `pending` was supplied;
   * otherwise falls back to instructing a retry, which register-tool.ts's
   * checkpoint will itself turn into a link on the next call now that the
   * grant is marked unhealthy.
   */
  private deadConnectionMessage(employeeSub: string, realmId: string, companyName: string | undefined): string {
    const companyLabel = companyName ?? realmId;
    const origin = getCurrentRequestContext()?.origin;
    if (this.pending && origin) {
      const authorizeUrl = mintCompanyAuthorizeUrl(this.pending, { employeeSub, realmId }, origin);
      return (
        `Your QuickBooks connection to Company "${companyLabel}" is no longer valid and must be re-authorized. ` +
        `Open this link, sign in with your Intuit account, and re-authorize this Company, then retry the call: ${authorizeUrl}`
      );
    }
    return (
      `Your QuickBooks connection to Company "${companyLabel}" is no longer valid and must be re-authorized. ` +
      `Retry the call to get a fresh authorization link.`
    );
  }

  private async resolveAccessToken(employeeSub: string, realmId: string): Promise<string> {
    const key = `${employeeSub}:${realmId}`;
    const cached = this.accessTokens.get(key);
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return cached.accessToken;
    }

    this.ensureConfig();
    const handle = this.grantStore.forGrant({ employeeSub, realmId });
    let resolved: CachedAccessToken | undefined;
    try {
      await handle.refresh(async (currentRefreshToken) => {
        const authResponse = await this.oauthClient!.refreshUsingToken(currentRefreshToken);
        const token = authResponse.token as unknown as {
          access_token: string;
          expires_in?: number;
          refresh_token?: string;
        };
        resolved = { accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 };
        return { refreshToken: token.refresh_token ?? currentRefreshToken };
      });
    } catch (error) {
      // Reached when a READ call fell back to the ambient/default Company
      // (no realm_id — see register-tool.ts's checkpoint, which only runs
      // for a Company actually NAMED in the call) and that ambient Company
      // has no grant for this employee. A clearer, actionable message than
      // GrantNotFoundError's own beats a raw error surfacing from a tool
      // call the employee didn't realize named an unauthorized Company.
      if (error instanceof GrantNotFoundError) {
        throw new Error(
          `No QuickBooks grant for employee "${employeeSub}" and Company "${realmId}". Retry the call with ` +
            `an explicit realm_id naming the Company to authorize, then complete the authorization link.`
        );
      }

      // Issue #9: the grant's refresh token is genuinely dead (revoked,
      // expired, or rotated out) rather than a transient Intuit hiccup.
      // register-tool.ts's checkpoint already let THIS call through because
      // the stored grant still read "healthy" at the time it checked — the
      // failure only surfaced here, mid-call. Mark it unhealthy so the NEXT
      // call is caught by that checkpoint, and never let Intuit's raw error
      // text (an opaque OAuth failure message) reach the employee for THIS
      // one: replace it with a plain-language, Company-named re-authorization
      // message. A transient failure (5xx/429/network) is NOT reclassified —
      // it must stay retryable and self-heal, exactly like the single-tenant
      // client's own handling in ../clients/quickbooks-client.ts.
      if (isAuthInvalidationError(error)) {
        // Best-effort: the grant document is still readable even though its
        // refresh token just died, so this recovers the Company's real name
        // for the message below; a read failure just falls back to the realm
        // id rather than blocking the (already-failing) call any further.
        const companyName = await handle
          .read()
          .then((grant) => grant?.companyName)
          .catch(() => undefined);
        try {
          await handle.recordHealth("unhealthy");
        } catch (recordHealthError) {
          console.error(
            `[grant-quickbooks-clients] Failed to record unhealthy grant for employee "${employeeSub}" and Company "${realmId}":`,
            recordHealthError
          );
        }
        throw new Error(this.deadConnectionMessage(employeeSub, realmId, companyName));
      }

      throw error;
    }

    await handle.recordUse();
    // handle.refresh() above either resolves `resolved` or throws, so this
    // is unreachable in practice; the check exists only to satisfy the
    // return type without a non-null assertion.
    if (!resolved) {
      throw new Error(`Failed to obtain an access token for employee "${employeeSub}" and Company "${realmId}"`);
    }
    this.accessTokens.set(key, resolved);
    return resolved.accessToken;
  }
}
