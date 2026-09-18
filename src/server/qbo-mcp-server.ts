import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SERVER_INFO = {
  name: "QuickBooks Online MCP Server",
  version: "1.0.0",
} as const;

const SERVER_OPTIONS = {
  capabilities: {
    tools: {},
  },
} as const;

/**
 * Builds a fresh McpServer instance. Stdio uses exactly one, via
 * QuickbooksMCPServer.GetServer(), for the life of the process. The
 * streamable HTTP transport calls this directly to build a new, isolated
 * server per request (see src/http/create-streamable-http-server.ts), since
 * HTTP has no equivalent of "one process, one connection".
 */
export function createMcpServer(): McpServer {
  return new McpServer(SERVER_INFO, SERVER_OPTIONS);
}

export class QuickbooksMCPServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (QuickbooksMCPServer.instance === null) {
      QuickbooksMCPServer.instance = createMcpServer();
    }
    return QuickbooksMCPServer.instance;
  }
}