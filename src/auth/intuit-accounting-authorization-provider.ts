import OAuthClient from "intuit-oauth";

/**
 * Completes the *Accounting*-scope grant an employee authorizes for a single
 * Company (issue #8, ADR 0002) — distinct from ../auth/intuit-identity-provider.ts,
 * which federates login identity via OpenID Connect scopes. Both reuse the
 * same Intuit app (QUICKBOOKS_CLIENT_ID/SECRET), per ADR 0002.
 */
export interface IntuitAccountingGrant {
  refreshToken: string;
  /** The Company (realm) Intuit actually issued the grant for — the employee picks this on Intuit's consent screen, so it must be checked against what was requested. */
  realmId: string;
  /**
   * The access token minted alongside the refresh token by this same
   * exchange (issue #9) — reused by ../http/company-oauth-http.ts to look up
   * the Company's name via CompanyInfo without a second token exchange.
   */
  accessToken: string;
  /** "sandbox" or "production", needed to pick the right QuickBooks API host when looking up CompanyInfo. */
  environment: string;
}

export interface IntuitAccountingAuthorizationProvider {
  /** The URL to send the employee's browser to, to authorize a Company with Intuit. */
  authorizationUrl(params: { redirectUri: string; state: string }): string;

  /**
   * Exchanges the authorization code on `callbackUrl` for a refresh token and
   * the realm Intuit issued it for. `redirectUri` must be the exact URI used
   * to obtain that code.
   */
  exchangeCodeForGrant(params: { callbackUrl: string; redirectUri: string }): Promise<IntuitAccountingGrant>;
}

export interface IntuitAccountingAuthorizationConfig {
  clientId: string;
  clientSecret: string;
  environment: string;
}

export class IntuitAccountingOAuthProvider implements IntuitAccountingAuthorizationProvider {
  /**
   * Takes a config LOADER, not a config, called only when an endpoint is
   * actually hit — mirrors ../auth/oauth-config.ts's loadOAuthConfig()
   * pattern (see its own docstring). This lets createDefaultCompanyOAuthDeps()
   * in ../http/company-oauth-http.ts build a provider unconditionally, even
   * on a process where QUICKBOOKS_CLIENT_ID/SECRET aren't set (e.g. most
   * test suites), without throwing until the Company-authorization flow is
   * genuinely used.
   */
  constructor(private readonly loadConfig: () => IntuitAccountingAuthorizationConfig) {}

  authorizationUrl(params: { redirectUri: string; state: string }): string {
    const config = this.loadConfig();
    const client = new OAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      environment: config.environment,
      redirectUri: params.redirectUri,
    });
    return client
      .authorizeUri({
        scope: [OAuthClient.scopes.Accounting as string],
        state: params.state,
      })
      .toString();
  }

  async exchangeCodeForGrant(params: { callbackUrl: string; redirectUri: string }): Promise<IntuitAccountingGrant> {
    const config = this.loadConfig();
    const client = new OAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      environment: config.environment,
      redirectUri: params.redirectUri,
    });

    const response = await client.createToken(params.callbackUrl);
    const token = response.token as unknown as {
      refresh_token?: string;
      realmId?: string;
      access_token?: string;
    };

    if (!token.refresh_token || !token.realmId || !token.access_token) {
      throw new Error("Intuit did not return a refresh token, an access token, and a realm id");
    }
    return {
      refreshToken: token.refresh_token,
      realmId: token.realmId,
      accessToken: token.access_token,
      environment: config.environment,
    };
  }
}
