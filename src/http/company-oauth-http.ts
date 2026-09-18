import type http from "node:http";
import {
  COMPANY_AUTHORIZE_PATH,
  COMPANY_CALLBACK_PATH,
  CompanyAuthorizationStore,
} from "../auth/company-authorization.js";
import { IntuitAccountingOAuthProvider, type IntuitAccountingAuthorizationProvider } from "../auth/intuit-accounting-authorization-provider.js";
import { IntuitCompanyInfoProvider, type CompanyInfoProvider } from "../auth/company-info-provider.js";
import { loadIntuitFederationConfig } from "../auth/oauth-config.js";
import { FirestoreGrantStore, type GrantStore } from "../clients/firestore-grant-store.js";
import { InMemoryFirestore } from "../clients/in-memory-firestore.js";
import { guardOAuthEndpoint } from "./oauth-http.js";

/**
 * The browser-facing half of the Company-authorization flow (issue #8): the
 * two endpoints a link minted by ../auth/company-authorization.ts's
 * checkCompanyAuthorization() sends the employee's browser through.
 * COMPANY_AUTHORIZE_PATH consumes that one-time start token and redirects to
 * Intuit's Accounting-scope consent screen; COMPANY_CALLBACK_PATH exchanges
 * Intuit's response for a refresh token and persists the grant. Structured
 * like ../auth/oauth-http.ts's /authorize + /auth/intuit/callback pair, but
 * this flow has no claude.ai client on the other end — it ends in an HTML
 * page the employee reads directly, not a redirect back to a third party.
 */
export interface CompanyOAuthDeps {
  grantStore: GrantStore;
  pending: CompanyAuthorizationStore;
  authorizationProvider: IntuitAccountingAuthorizationProvider;
  /** Looks up a Company's display name at grant creation (issue #9). */
  companyInfoProvider: CompanyInfoProvider;
}

/**
 * The grant store defaults to an in-process one (see ../clients/in-memory-firestore.ts)
 * until a real Firestore client is wired up for a deployed environment (see
 * the streamable-http-index.ts comment on issue #13) — overridable via
 * createStreamableHttpServer's `companyAuth` option, exactly like `oauth`.
 * The Intuit config is loaded lazily (see IntuitAccountingOAuthProvider's own
 * docstring), so building these defaults never throws just because
 * QUICKBOOKS_CLIENT_ID/SECRET aren't set on a process that never uses this flow.
 */
export function createDefaultCompanyOAuthDeps(): CompanyOAuthDeps {
  return {
    grantStore: new FirestoreGrantStore(new InMemoryFirestore()),
    pending: new CompanyAuthorizationStore(),
    authorizationProvider: new IntuitAccountingOAuthProvider(loadIntuitFederationConfig),
    companyInfoProvider: new IntuitCompanyInfoProvider(),
  };
}

function sendHtml(res: http.ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  res.end(
    `<html><body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:Arial,sans-serif;text-align:center">` +
      `<h2>${title}</h2><p>${message}</p></body></html>`
  );
}

function handleCompanyAuthorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  origin: string,
  deps: CompanyOAuthDeps
): void {
  const token = url.searchParams.get("token");
  const start = token ? deps.pending.consume(token) : undefined;
  if (!start) {
    sendHtml(res, 400, "This authorization link has expired.", "Ask Claude to retry the QuickBooks tool call to get a fresh link.");
    return;
  }

  // Re-mint a fresh, second start token as the Intuit `state` param: the
  // first token is single-use and was already consumed above, and Intuit
  // requires its own opaque state round-tripped through its redirect.
  const state = deps.pending.create(start);
  const authorizationUrl = deps.authorizationProvider.authorizationUrl({
    redirectUri: `${origin}${COMPANY_CALLBACK_PATH}`,
    state,
  });
  res.writeHead(302, { Location: authorizationUrl });
  res.end();
}

async function handleCompanyCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  origin: string,
  deps: CompanyOAuthDeps
): Promise<void> {
  const state = url.searchParams.get("state");
  const pending = state ? deps.pending.consume(state) : undefined;
  if (!pending) {
    sendHtml(res, 400, "This authorization link has expired.", "Ask Claude to retry the QuickBooks tool call to get a fresh link.");
    return;
  }

  let grant: { refreshToken: string; realmId: string; accessToken: string; environment: string };
  try {
    grant = await deps.authorizationProvider.exchangeCodeForGrant({
      callbackUrl: `${origin}${url.pathname}${url.search}`,
      redirectUri: `${origin}${COMPANY_CALLBACK_PATH}`,
    });
  } catch (error) {
    console.error("[company-oauth] Intuit Accounting exchange failed:", error);
    sendHtml(res, 400, "QuickBooks authorization failed.", "Please ask Claude to retry the tool call.");
    return;
  }

  if (grant.realmId !== pending.realmId) {
    // The employee picked a different Company on Intuit's consent screen
    // than the one the tool call named. Refuse rather than silently
    // authorizing the wrong Company, or attributing this grant to the one
    // that was requested.
    sendHtml(
      res,
      400,
      "Wrong Company authorized.",
      "You authorized a different QuickBooks Company than the one requested. Ask Claude to retry the tool call and pick the matching Company when signing in."
    );
    return;
  }

  // Best-effort: a CompanyInfo lookup failure must not block the authorization
  // itself — the grant is real and usable either way. Falls back to the realm
  // id (FirestoreGrantStore.create()'s own default) so list_companies (issue
  // #9) still has *something* to show rather than failing the whole flow over
  // a display-name nicety.
  let companyName: string | undefined;
  try {
    companyName = await deps.companyInfoProvider.fetchCompanyName({
      accessToken: grant.accessToken,
      realmId: grant.realmId,
      environment: grant.environment,
    });
  } catch (error) {
    console.error("[company-oauth] Failed to fetch Company name:", error);
  }

  await deps.grantStore
    .forGrant({ employeeSub: pending.employeeSub, realmId: grant.realmId })
    .create(grant.refreshToken, companyName);

  sendHtml(res, 200, "✓ QuickBooks authorized", "You can close this window and return to Claude.");
}

/**
 * Routes a request to the Company-authorization HTTP surface if its path
 * matches one of the endpoints this module owns. Returns true if handled.
 */
export async function tryHandleCompanyOAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  origin: string,
  deps: CompanyOAuthDeps
): Promise<boolean> {
  if (pathname === COMPANY_AUTHORIZE_PATH && req.method === "GET") {
    await guardOAuthEndpoint(res, () => handleCompanyAuthorize(req, res, url, origin, deps));
    return true;
  }
  if (pathname === COMPANY_CALLBACK_PATH && req.method === "GET") {
    await guardOAuthEndpoint(res, () => handleCompanyCallback(req, res, url, origin, deps));
    return true;
  }
  return false;
}
