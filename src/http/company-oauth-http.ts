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
import { createFirestore } from "../clients/cloud-firestore.js";
import {
  renderAuthorizationPage,
  type AuthorizationPage,
} from "./authorization-page.js";

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
 * The grant store is backed by real Firestore when deployed (GOOGLE_CLOUD_PROJECT
 * set — see ../clients/cloud-firestore.ts's createFirestore()) or an
 * in-process store otherwise (local dev, tests, stdio usage) — overridable
 * via createStreamableHttpServer's `companyAuth` option, exactly like `oauth`.
 * The Intuit config is loaded lazily (see IntuitAccountingOAuthProvider's own
 * docstring), so building these defaults never throws just because
 * QUICKBOOKS_CLIENT_ID/SECRET aren't set on a process that never uses this flow.
 */
export function createDefaultCompanyOAuthDeps(): CompanyOAuthDeps {
  return {
    grantStore: new FirestoreGrantStore(createFirestore()),
    pending: new CompanyAuthorizationStore(),
    authorizationProvider: new IntuitAccountingOAuthProvider(loadIntuitFederationConfig),
    companyInfoProvider: new IntuitCompanyInfoProvider(),
  };
}

function sendPage(res: http.ServerResponse, status: number, page: AuthorizationPage): void {
  res.writeHead(status, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  res.end(renderAuthorizationPage(page));
}

/** Reused verbatim by both endpoints: either half of the flow can be the one that finds the token dead. */
const EXPIRED_PAGE: AuthorizationPage = {
  outcome: "failure",
  heading: "This authorization link has expired",
  detail:
    "Authorization links are single-use and last 10 minutes. Ask Claude to connect the Company again to " +
    "get a fresh one.",
};

/**
 * HTML counterpart to guardOAuthEndpoint, for the two endpoints an employee
 * reaches in a browser: the shared guard answers with JSON, which /token and
 * the other machine-facing endpoints need but which a browser renders as a
 * raw blob. Same contract otherwise — an unhandled throw becomes a response
 * rather than an unhandled rejection that hangs the connection.
 */
async function guardCompanyPage(res: http.ServerResponse, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[company-oauth] Unhandled error in Company-authorization endpoint:", error);
    if (!res.headersSent) {
      sendPage(res, 500, {
        outcome: "failure",
        heading: "Something went wrong",
        detail:
          "QuickBooks authorization could not be completed, and the problem is on our side rather than " +
          "yours. Ask Claude to try again; if it keeps happening, report it.",
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
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
    sendPage(res, 400, EXPIRED_PAGE);
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
    sendPage(res, 400, EXPIRED_PAGE);
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
    sendPage(res, 400, {
      outcome: "failure",
      heading: "QuickBooks authorization failed",
      detail: "Intuit did not complete the sign-in. Ask Claude to try connecting the Company again.",
    });
    return;
  }

  // An open flow (issue #29) named no Company up front — the employee picks
  // one on Intuit's screen — so there is nothing to mismatch against and
  // nothing to mis-attribute. A realm-directed flow (issue #8) still refuses.
  if (pending.realmId !== undefined && grant.realmId !== pending.realmId) {
    // The employee picked a different Company on Intuit's consent screen
    // than the one the tool call named. Refuse rather than silently
    // authorizing the wrong Company, or attributing this grant to the one
    // that was requested.
    sendPage(res, 400, {
      outcome: "failure",
      heading: "That is a different Company",
      detail:
        "You signed in to a different QuickBooks Company than the one your request named, so nothing was " +
        "connected. Ask Claude to try again and pick the matching Company.",
    });
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

  // Names the Company that was actually connected: an open flow's employee
  // never named one going in, so the page is their only confirmation of
  // which Company they just picked.
  sendPage(res, 200, {
    outcome: "success",
    heading: `${companyName ?? grant.realmId} is connected`,
    detail: "You can close this window and return to Claude.",
  });
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
    await guardCompanyPage(res, () => handleCompanyAuthorize(req, res, url, origin, deps));
    return true;
  }
  if (pathname === COMPANY_CALLBACK_PATH && req.method === "GET") {
    await guardCompanyPage(res, () => handleCompanyCallback(req, res, url, origin, deps));
    return true;
  }
  return false;
}
