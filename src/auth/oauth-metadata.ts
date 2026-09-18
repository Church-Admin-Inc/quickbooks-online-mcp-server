/**
 * RFC 9728 (OAuth 2.0 Protected Resource Metadata) and RFC 8414 (OAuth 2.0
 * Authorization Server Metadata) documents this server publishes so claude.ai
 * can discover, from a bare 401, how to obtain a token (issue #6).
 */

/** Well-known path for a resource's Protected Resource Metadata: the resource's own path is appended, per RFC 9728 §3.1. */
export function protectedResourceMetadataPath(resourcePath: string): string {
  return `/.well-known/oauth-protected-resource${resourcePath}`;
}

export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const AUTHORIZE_PATH = "/authorize";
export const TOKEN_PATH = "/token";
export const INTUIT_CALLBACK_PATH = "/auth/intuit/callback";

export function buildProtectedResourceMetadata(origin: string, resourcePath: string) {
  return {
    // Exact URL employees connect to, including path — claude.ai matches this
    // verbatim against the resource it is calling.
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
  };
}

export function buildAuthorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    // Public client (PKCE-only, no client secret) — a static client_id is
    // pre-registered instead of Dynamic Client Registration, so no
    // registration_endpoint is advertised.
    token_endpoint_auth_methods_supported: ["none"],
  };
}
