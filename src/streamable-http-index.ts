#!/usr/bin/env node

import {
  createStreamableHttpServer,
  DEFAULT_ALLOWED_HOSTNAMES,
  MCP_HTTP_PATH,
} from "./http/create-streamable-http-server.js";
import { createDefaultCompanyOAuthDeps } from "./http/company-oauth-http.js";
import { setMultiTenantResolver } from "./clients/quickbooks-client.js";
import { GrantBackedQuickbooksClients } from "./clients/grant-quickbooks-clients.js";
import { loadIntuitFederationConfig } from "./auth/oauth-config.js";
import { registerAllTools } from "./server/register-all-tools.js";

// `??` only falls through on null/undefined, not on "" — a process manager
// that exports an unset PORT as an empty string would otherwise silently
// resolve to Number("") === 0 and listen on a random ephemeral port.
function readPort(): number {
  for (const raw of [process.env.PORT, process.env.MCP_HTTP_PORT]) {
    if (raw) return Number(raw);
  }
  return 3000;
}

// Loopback-only by default. Every request to MCP_HTTP_PATH now requires a
// bearer token from this server's own OAuth endpoints (issue #6), but
// loopback stays the default regardless — it also keeps the OAuth endpoints
// themselves off the open network until a deployment is ready for them. A
// future deployment (issue #13) that needs to accept connections from
// outside loopback — e.g. behind Cloud Run — sets HOST explicitly, and
// should widen MCP_HTTP_ALLOWED_HOSTS alongside it (see readAllowedHostnames
// below).
function readHost(): string {
  return process.env.HOST || "127.0.0.1";
}

function readAllowedHostnames(): string[] {
  const raw = process.env.MCP_HTTP_ALLOWED_HOSTS;
  if (!raw) return DEFAULT_ALLOWED_HOSTNAMES;
  return raw
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
}

const port = readPort();
const host = readHost();

// The SAME grant store backs both halves of issue #8's Company-authorization
// flow: the checkpoint createStreamableHttpServer wires onto register-tool.js
// (via its companyAuth option), and the grant-backed QuickBooks client
// resolver wired onto quickbooks-client.js here, so a grant the checkpoint
// just confirmed exists is the one every handler's QuickbooksClient calls
// actually use.
const companyAuth = createDefaultCompanyOAuthDeps();
setMultiTenantResolver(new GrantBackedQuickbooksClients(companyAuth.grantStore, loadIntuitFederationConfig));

const server = createStreamableHttpServer(registerAllTools, {
  allowedHostnames: readAllowedHostnames(),
  companyAuth,
});

server.listen(port, host, () => {
  console.error(`QuickBooks Online MCP Server listening on streamable HTTP at ${host}:${port}${MCP_HTTP_PATH}`);
});
