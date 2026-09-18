#!/usr/bin/env node

import {
  createStreamableHttpServer,
  DEFAULT_ALLOWED_HOSTNAMES,
  MCP_HTTP_PATH,
} from "./http/create-streamable-http-server.js";
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

// Loopback-only by default: this transport has no authentication yet (that's
// issue #6), so binding to every interface would expose every QuickBooks
// tool to anything that can reach the host's network. A future deployment
// (issue #13) that needs to accept connections from outside loopback — e.g.
// behind Cloud Run — sets HOST explicitly, and should widen
// MCP_HTTP_ALLOWED_HOSTS alongside it (see readAllowedHostnames below).
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

const server = createStreamableHttpServer(registerAllTools, {
  allowedHostnames: readAllowedHostnames(),
});

server.listen(port, host, () => {
  console.error(`QuickBooks Online MCP Server listening on streamable HTTP at ${host}:${port}${MCP_HTTP_PATH}`);
});
