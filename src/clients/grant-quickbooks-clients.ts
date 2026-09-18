import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import { GrantNotFoundError, type GrantStore } from "./firestore-grant-store.js";
import type { MultiTenantQuickbooksResolver } from "./quickbooks-client.js";

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
   */
  constructor(
    private readonly grantStore: GrantStore,
    private readonly loadConfig: () => GrantQuickbooksClientsConfig
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
