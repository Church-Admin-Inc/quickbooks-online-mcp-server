import crypto from "node:crypto";
import type http from "node:http";
import type { IntuitIdentityProvider } from "../auth/intuit-identity-provider.js";
import { OAuthStore } from "../auth/oauth-store.js";
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  loadIntuitFederationConfig,
  loadOAuthConfig,
  PENDING_LOGIN_TTL_SECONDS,
  type OAuthConfig,
} from "../auth/oauth-config.js";
import { IntuitOpenIdIdentityProvider } from "../auth/intuit-identity-provider.js";
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  AUTHORIZE_PATH,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  INTUIT_CALLBACK_PATH,
  protectedResourceMetadataPath,
  TOKEN_PATH,
} from "../auth/oauth-metadata.js";
import type { EmployeeContext } from "../context/employee-context.js";

/**
 * Dependencies for the OAuth HTTP surface. Overridable so tests can drive the
 * whole federated-login flow (see tests/integration) against a fake Intuit
 * without a network call, exactly like registerTools is injected in
 * create-streamable-http-server.ts.
 */
export interface OAuthDeps {
  store: OAuthStore;
  identityProvider: IntuitIdentityProvider;
  /** Lazy: only evaluated when an OAuth endpoint is actually hit, so misconfiguration never breaks stdio/unrelated HTTP requests. */
  loadConfig: () => OAuthConfig;
}

export function createDefaultOAuthDeps(): OAuthDeps {
  return {
    store: new OAuthStore(),
    identityProvider: new IntuitOpenIdIdentityProvider(loadIntuitFederationConfig()),
    loadConfig: loadOAuthConfig,
  };
}

/** Protocol + host this request was addressed to, for building absolute URLs back to this server. */
export function resolveOrigin(req: http.IncomingMessage, hostname: string): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim();
  const socketIsTls = (req.socket as { encrypted?: boolean }).encrypted === true;
  const protocol = proto || (socketIsTls ? "https" : "http");

  // The Host header's own port, when it has one (e.g. "127.0.0.1:3000" for a
  // direct local-dev connection), reflects what the client actually
  // addressed. The socket's local port is only trustworthy as a fallback for
  // a *direct* connection (no X-Forwarded-Proto) with no port in the Host
  // header — behind a reverse proxy (Cloud Run and friends) that port is the
  // container's internal listen port, not the public one, and the forwarded
  // Host header omits the port entirely to mean "the protocol's default".
  // Unlike x-forwarded-proto, Node types (and parses) the Host header as a
  // single string, never an array — no array-handling needed here.
  const headerPort = req.headers.host?.match(/:(\d+)$/)?.[1];
  const socketPort = (req.socket as { localPort?: number }).localPort;
  let port: number | undefined;
  if (headerPort) {
    port = Number(headerPort);
  } else if (!proto) {
    port = socketPort;
  }
  const host = port && port !== 80 && port !== 443 ? `${hostname}:${port}` : hostname;
  return `${protocol}://${host}`;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(payload);
}

function sendRedirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

/**
 * Builds an OAuth error redirect via URL/searchParams rather than string
 * concatenation, so a registered redirect_uri that already carries its own
 * query string (e.g. `https://host/cb?connector=qbo`) still produces a
 * well-formed URL instead of a second, unparseable `?`.
 */
function errorRedirectUrl(
  redirectUri: string,
  error: string,
  errorDescription: string | undefined,
  state: string | undefined
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (errorDescription) url.searchParams.set("error_description", errorDescription);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Enforces bearer-token auth for the MCP endpoint (RFC 6750 / RFC 9728). On
 * success returns the caller's identity; on failure it has already written
 * the 401 response (with a WWW-Authenticate pointing at Protected Resource
 * Metadata) and the caller must not process the request further.
 */
export function requireBearerAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin: string,
  resourcePath: string,
  store: OAuthStore
): EmployeeContext | undefined {
  const challenge = `Bearer resource_metadata="${origin}${protectedResourceMetadataPath(resourcePath)}"`;
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer (.+)$/i.exec(header) : null;

  if (!match) {
    res.writeHead(401, { "WWW-Authenticate": `${challenge}, error="invalid_request"`, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing bearer token" }));
    return undefined;
  }

  const identity = store.resolveAccessToken(match[1]);
  if (!identity) {
    res.writeHead(401, { "WWW-Authenticate": `${challenge}, error="invalid_token"`, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_token", error_description: "Token is unknown, expired, or revoked" }));
    return undefined;
  }

  return identity;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function handleAuthorize(req: http.IncomingMessage, res: http.ServerResponse, url: URL, origin: string, deps: OAuthDeps): void {
  const config = deps.loadConfig();
  const params = url.searchParams;

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const state = params.get("state") ?? undefined;
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");

  if (clientId !== config.claudeClientId) {
    sendJson(res, 400, { error: "unauthorized_client", error_description: "Unknown client_id" });
    return;
  }
  if (!redirectUri || !config.claudeRedirectUris.includes(redirectUri)) {
    // Refuse to redirect anywhere when the redirect_uri itself isn't a
    // registered one — redirecting here would make this endpoint an open
    // redirect.
    sendJson(res, 400, { error: "invalid_request", error_description: "Unknown or missing redirect_uri" });
    return;
  }

  if (responseType !== "code") {
    sendRedirect(res, errorRedirectUrl(redirectUri, "unsupported_response_type", undefined, state));
    return;
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    sendRedirect(res, errorRedirectUrl(redirectUri, "invalid_request", "PKCE with S256 is required", state));
    return;
  }

  const loginState = deps.store.createPendingLogin(
    { claudeClientId: clientId, claudeRedirectUri: redirectUri, claudeState: state, codeChallenge },
    PENDING_LOGIN_TTL_SECONDS
  );

  const intuitAuthorizationUrl = deps.identityProvider.authorizationUrl({
    redirectUri: `${origin}${INTUIT_CALLBACK_PATH}`,
    state: loginState,
  });

  sendRedirect(res, intuitAuthorizationUrl);
}

async function handleIntuitCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  origin: string,
  deps: OAuthDeps
): Promise<void> {
  const loginState = url.searchParams.get("state");
  if (!loginState) {
    sendJson(res, 400, { error: "invalid_request", error_description: "Missing state" });
    return;
  }

  const pendingLogin = deps.store.consumePendingLogin(loginState);
  if (!pendingLogin) {
    sendJson(res, 400, { error: "invalid_request", error_description: "Unknown, expired, or already-used login" });
    return;
  }

  let identity: EmployeeContext;
  try {
    identity = await deps.identityProvider.exchangeCodeForIdentity({
      callbackUrl: `${origin}${url.pathname}${url.search}`,
      redirectUri: `${origin}${INTUIT_CALLBACK_PATH}`,
    });
  } catch (error) {
    console.error("[oauth] Intuit identity exchange failed:", error);
    sendRedirect(res, errorRedirectUrl(pendingLogin.claudeRedirectUri, "access_denied", undefined, pendingLogin.claudeState));
    return;
  }

  const code = deps.store.issueAuthorizationCode(
    {
      identity,
      claudeClientId: pendingLogin.claudeClientId,
      claudeRedirectUri: pendingLogin.claudeRedirectUri,
      codeChallenge: pendingLogin.codeChallenge,
    },
    AUTHORIZATION_CODE_TTL_SECONDS
  );

  const redirectUrl = new URL(pendingLogin.claudeRedirectUri);
  redirectUrl.searchParams.set("code", code);
  if (pendingLogin.claudeState) redirectUrl.searchParams.set("state", pendingLogin.claudeState);
  sendRedirect(res, redirectUrl.toString());
}

async function handleToken(req: http.IncomingMessage, res: http.ServerResponse, deps: OAuthDeps): Promise<void> {
  const config = deps.loadConfig();
  const bodyText = await readBody(req);
  const form = new URLSearchParams(bodyText);

  const grantType = form.get("grant_type");
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const clientId = form.get("client_id") ?? config.claudeClientId;
  const codeVerifier = form.get("code_verifier");

  if (grantType !== "authorization_code") {
    sendJson(res, 400, { error: "unsupported_grant_type" });
    return;
  }
  if (!code || !redirectUri || !codeVerifier) {
    sendJson(res, 400, { error: "invalid_request", error_description: "code, redirect_uri, and code_verifier are required" });
    return;
  }

  const record = deps.store.peekAuthorizationCode(code);
  if (!record || record.claudeClientId !== clientId || record.claudeRedirectUri !== redirectUri) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  const computedChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  if (computedChallenge !== record.codeChallenge) {
    sendJson(res, 400, { error: "invalid_grant", error_description: "code_verifier does not match code_challenge" });
    return;
  }

  deps.store.markAuthorizationCodeUsed(code);
  const { token, expiresIn } = deps.store.issueAccessToken(record.identity, config.accessTokenTtlSeconds);

  sendJson(res, 200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });
}

/**
 * Routes a request to the OAuth surface if its path matches one of the
 * endpoints this module owns. Returns true if handled (response already
 * sent or in flight), false if the caller should continue its own routing.
 */
export async function tryHandleOAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  origin: string,
  resourcePath: string,
  deps: OAuthDeps
): Promise<boolean> {
  if (pathname === protectedResourceMetadataPath(resourcePath) && req.method === "GET") {
    sendJson(res, 200, buildProtectedResourceMetadata(origin, resourcePath));
    return true;
  }
  if (pathname === AUTHORIZATION_SERVER_METADATA_PATH && req.method === "GET") {
    sendJson(res, 200, buildAuthorizationServerMetadata(origin));
    return true;
  }
  if (pathname === AUTHORIZE_PATH && req.method === "GET") {
    await guardOAuthEndpoint(res, () => handleAuthorize(req, res, url, origin, deps));
    return true;
  }
  if (pathname === INTUIT_CALLBACK_PATH && req.method === "GET") {
    await guardOAuthEndpoint(res, () => handleIntuitCallback(req, res, url, origin, deps));
    return true;
  }
  if (pathname === TOKEN_PATH && req.method === "POST") {
    await guardOAuthEndpoint(res, () => handleToken(req, res, deps));
    return true;
  }
  return false;
}

/**
 * Runs an OAuth endpoint handler and turns an otherwise-unhandled throw (e.g.
 * deps.loadConfig() rejecting a misconfigured server, or an unexpected error
 * from the identity provider) into a 500 response instead of an unhandled
 * promise rejection that leaves the client's connection hanging — the
 * try/catch in create-streamable-http-server.ts only wraps the MCP-tool-call
 * path, not this one.
 */
export async function guardOAuthEndpoint(res: http.ServerResponse, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[oauth] Unhandled error in OAuth endpoint:", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "server_error" });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
