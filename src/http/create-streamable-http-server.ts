import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../server/qbo-mcp-server.js";
import { runWithEmployeeContext } from "../context/employee-context.js";
import {
  createDefaultOAuthDeps,
  requireBearerAuth,
  resolveOrigin,
  tryHandleOAuthRequest,
  type OAuthDeps,
} from "./oauth-http.js";

export const MCP_HTTP_PATH = "/mcp";

// By default this binds only to loopback (see src/streamable-http-index.ts).
// Loopback binding alone does not stop DNS rebinding: a page on an
// attacker-controlled domain that resolves to 127.0.0.1 can still have a
// victim's browser send it a same-origin-looking request whose Host header
// is that attacker domain. Validating Host against a known-good allowlist
// closes that gap regardless of auth.
// https://modelcontextprotocol.io/docs/concepts/transports#security
export const DEFAULT_ALLOWED_HOSTNAMES = ["127.0.0.1", "localhost", "::1"];

export interface CreateStreamableHttpServerOptions {
  /** Hostnames (no port) accepted in the request's Host header. */
  allowedHostnames?: string[];
  /** Overridable for tests (see tests/integration/oauth-http-application.test.ts); defaults to the real Intuit-federated OAuth server. */
  oauth?: OAuthDeps;
}

/**
 * Builds a Node HTTP server that answers MCP over streamable HTTP at
 * MCP_HTTP_PATH. Runs stateless: sessionIdGenerator is undefined, and a
 * fresh McpServer + transport is built per request, so no state is shared
 * across requests or leaks between them. The stdio entry point (src/index.ts)
 * is untouched and keeps behaving exactly as before; this is an alongside
 * transport, not a replacement.
 *
 * `registerTools` is deliberately required rather than defaulted to
 * registerAllTools: the caller (src/streamable-http-index.ts) passes it
 * explicitly, which keeps this module from eagerly importing all 145 tool
 * modules itself. Eagerly importing them here would make this module the
 * first thing to load them under Jest, surfacing currently-untested files in
 * the coverage report and sinking the global 100% threshold.
 *
 * Every request to MCP_HTTP_PATH requires a bearer token issued by this
 * server's own OAuth endpoints (issue #6); the token's employee identity is
 * made available to every tool call via ../context/employee-context.js. The
 * OAuth endpoints themselves (metadata, /authorize, the Intuit callback,
 * /token) are public, same as any authorization server's.
 */
export function createStreamableHttpServer(
  registerTools: (server: McpServer) => void,
  options: CreateStreamableHttpServerOptions = {}
): http.Server {
  const allowedHostnames = options.allowedHostnames ?? DEFAULT_ALLOWED_HOSTNAMES;
  const oauth = options.oauth ?? createDefaultOAuthDeps();
  return http.createServer((req, res) => {
    void handleRequest(req, res, registerTools, allowedHostnames, oauth);
  });
}

/** Host header's hostname (no port, no brackets around an IPv6 literal), or null if unparseable. */
function hostnameOf(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registerTools: (server: McpServer) => void,
  allowedHostnames: string[],
  oauth: OAuthDeps
): Promise<void> {
  const hostHeader = req.headers.host;
  const hostname = hostHeader ? hostnameOf(hostHeader) : null;
  if (!hostname || !allowedHostnames.includes(hostname)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid Host header" }));
    return;
  }

  // req.url is always a string for a real 'request' event on an http.Server;
  // the base below is a parsing anchor only — the host was already validated
  // above, and only the pathname is used for routing.
  const url = new URL(req.url as string, "http://localhost");
  const { pathname } = url;
  const origin = resolveOrigin(req, hostname);

  if (await tryHandleOAuthRequest(req, res, pathname, url, origin, MCP_HTTP_PATH, oauth)) {
    return;
  }

  if (pathname !== MCP_HTTP_PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  const identity = requireBearerAuth(req, res, origin, MCP_HTTP_PATH, oauth.store);
  if (!identity) return;

  try {
    const server = createMcpServer();
    registerTools(server);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      // Caught rather than left to reject unhandled: the client can close the
      // connection while server.connect(transport) below is still in flight,
      // racing this handler against setup, and an unhandled rejection here
      // would crash the process.
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await runWithEmployeeContext(identity, () => transport.handleRequest(req, res));
  } catch (error) {
    console.error("[http] Error handling MCP request:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        })
      );
    } else if (!res.writableEnded) {
      // Headers (and possibly a partial body/SSE stream) already went out
      // before the failure; there's no error payload to send at this point,
      // but the response must still be terminated so the client isn't left
      // waiting on a connection that will never close.
      res.end();
    }
  }
}
