import OAuthClient from "intuit-oauth";

/**
 * The identity Intuit federates for employee login (ADR 0002): the same
 * Intuit account that later owns a Company's QuickBooks grant, so no mapping
 * table is needed between "who logged in" and "whose refresh token this is".
 * This is deliberately a login identity only — it says nothing about which
 * QuickBooks Companies the employee can reach; that is issue #8's concern.
 */
export interface IntuitIdentity {
  /** Intuit's stable subject identifier (OpenID Connect `sub`). */
  sub: string;
  email: string;
}

export interface IntuitIdentityProvider {
  /** The URL to send the employee's browser to, to sign in with Intuit. */
  authorizationUrl(params: { redirectUri: string; state: string }): string;

  /**
   * Exchanges the authorization code on `callbackUrl` (the full URL Intuit
   * redirected the employee's browser back to) for their identity.
   * `redirectUri` must be the exact URI used to obtain that code — Intuit
   * rejects the exchange otherwise.
   */
  exchangeCodeForIdentity(params: {
    callbackUrl: string;
    redirectUri: string;
  }): Promise<IntuitIdentity>;
}

export interface IntuitIdentityProviderConfig {
  clientId: string;
  clientSecret: string;
  environment: string;
}

/**
 * Federates employee login to Intuit via OpenID Connect, reusing the same
 * Intuit app (QUICKBOOKS_CLIENT_ID/SECRET) already used for the QuickBooks
 * Accounting grants — per ADR 0002, one Intuit identity serves both purposes.
 * A fresh OAuthClient is built per call, scoped to the redirect URI that
 * particular call needs (the Intuit SDK binds redirectUri at construction),
 * mirroring the pattern QuickbooksClient.startOAuthFlow() already uses.
 */
export class IntuitOpenIdIdentityProvider implements IntuitIdentityProvider {
  constructor(private readonly config: IntuitIdentityProviderConfig) {}

  authorizationUrl(params: { redirectUri: string; state: string }): string {
    const client = new OAuthClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      environment: this.config.environment,
      redirectUri: params.redirectUri,
    });
    return client
      .authorizeUri({
        scope: [OAuthClient.scopes.OpenId, OAuthClient.scopes.Email, OAuthClient.scopes.Profile],
        state: params.state,
      })
      .toString();
  }

  async exchangeCodeForIdentity(params: {
    callbackUrl: string;
    redirectUri: string;
  }): Promise<IntuitIdentity> {
    const client = new OAuthClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      environment: this.config.environment,
      redirectUri: params.redirectUri,
    });

    await client.createToken(params.callbackUrl);
    const userInfo = await client.getUserInfo();
    const claims = (userInfo as { json?: Record<string, unknown> }).json;

    const sub = typeof claims?.sub === "string" ? claims.sub : undefined;
    const email = typeof claims?.email === "string" ? claims.email : undefined;
    if (!sub || !email) {
      throw new Error("Intuit did not return an identity with both sub and email");
    }
    return { sub, email };
  }
}
