import { z } from "zod";
import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolDefinition<T extends z.ZodType<any, any>> {
  name: string;
  description: string;
  schema: T;
  handler: ToolCallback<{ [key: string]: T }>;
  /**
   * An MCP App component (issue #28) every result of this tool renders as,
   * declared on the tool itself via `_meta.ui.resourceUri`. Set it only when
   * that is true of EVERY result: a host binds the component to the tool,
   * not to one of its answers. See ../mcp-apps/connect-company-app.ts.
   */
  uiResourceUri?: string;
}