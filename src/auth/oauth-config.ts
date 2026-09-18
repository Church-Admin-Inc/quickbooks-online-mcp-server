/**
 * Configuration for this server's own OAuth authorization server (issue #6).
 * Read lazily (not at module load, unlike QuickbooksClient's env parsing) so
 * that stdio usage and unrelated tests never pay for — or fail on — env vars
 * that only matter to the streamable HTTP + OAuth surface.
 */
export interface OAuthConfig {
  /** The single statically-registered client (claude.ai) — no Dynamic Client Registration. */
  claudeClientId: string;
  /** Exact redirect URIs claude.ai is allowed to use; the authorize request's redirect_uri must match one exactly. */
  claudeRedirectUris: string[];
  accessTokenTtlSeconds: number;
}

const DEFAULT_CLIENT_ID = "claude-ai";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600;

/** Short-lived: RFC 6749 §4.1.2 recommends a narrow window, and it is exchanged within the same login flow. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
/** How long an employee has to complete the Intuit half of the flow before /authorize must be restarted. */
export const PENDING_LOGIN_TTL_SECONDS = 600;

export class OAuthConfigError extends Error {}

export function loadOAuthConfig(): OAuthConfig {
  const claudeRedirectUris = (process.env.MCP_OAUTH_REDIRECT_URIS ?? "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);

  if (claudeRedirectUris.length === 0) {
    throw new OAuthConfigError(
      "MCP_OAUTH_REDIRECT_URIS must be set to the comma-separated redirect URI(s) claude.ai's connector " +
        "uses, before the OAuth endpoints can be used. claude.ai does not allow a connector's auth " +
        "settings to be edited after it is added, so this must be right before rollout."
    );
  }

  return {
    claudeClientId: process.env.MCP_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
    claudeRedirectUris,
    accessTokenTtlSeconds:
      Number(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS) || DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  };
}

export interface IntuitFederationConfig {
  clientId: string;
  clientSecret: string;
  environment: string;
}

export function loadIntuitFederationConfig(): IntuitFederationConfig {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthConfigError(
      "QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set before employee login can federate " +
        "to Intuit (the same Intuit app used for QuickBooks grants — see ADR 0002)."
    );
  }
  return {
    clientId,
    clientSecret,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || "sandbox",
  };
}
