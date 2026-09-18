import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../server/qbo-mcp-server.js";

export const MCP_HTTP_PATH = "/mcp";

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
 */
export function createStreamableHttpServer(registerTools: (server: McpServer) => void): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res, registerTools);
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registerTools: (server: McpServer) => void
): Promise<void> {
  // req.url is always a string for a real 'request' event on an http.Server;
  // the base below is a parsing anchor only — the actual host is irrelevant
  // since only the pathname is used for routing.
  const { pathname } = new URL(req.url as string, "http://localhost");

  if (pathname !== MCP_HTTP_PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

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
    await transport.handleRequest(req, res);
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
