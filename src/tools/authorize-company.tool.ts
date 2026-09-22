import { authorizeCompany } from "../handlers/authorize-company.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import {
  CONNECT_COMPANY_RESOURCE_URI,
  connectCompanyResultFields,
} from "../mcp-apps/connect-company-app.js";

const toolName = "authorize_company";
const toolDescription =
  "Connect a new QuickBooks Company to this server, for the calling employee. Returns a link the employee " +
  "opens to sign in with Intuit and pick which Company to connect. Use this whenever the employee wants to " +
  "add, connect, or authorize a Company - including one whose realm_id is unknown, which is the normal case: " +
  "they choose the Company on Intuit's own screen, so no realm_id is needed to start. Do NOT send the " +
  "employee to their Claude connector settings to do this; reconnecting the connector re-runs employee " +
  "login and does not connect a QuickBooks Company. Once they finish, list_companies shows the new Company.";
const toolSchema = z.object({});

const toolHandler = async () => {
  const response = await authorizeCompany();
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return {
    content: [
      {
        type: "text" as const,
        // Markdown link, for the same reason register-tool.ts's
        // authorizationNeededResponse() uses one: clients that render tool
        // output as Markdown show it as a clickable link rather than pasted
        // text. The URL is minted by this server, so there is nothing
        // untrusted to escape here. This stays the fallback for a client
        // without MCP Apps support, and is what the model reads.
        text:
          `[Connect a QuickBooks Company](${response.result!.authorize_url}) by signing in with your Intuit ` +
          `account and choosing the Company to connect. The link is single-use and expires in 10 minutes. ` +
          `Once you are done, retry your request or ask me to list your Companies.`,
      },
    ],
    // Renders as a real "Connect" button on a host that supports MCP Apps
    // (issue #28). No Company is named: this tool exists precisely to
    // connect one nobody has identified yet, and the employee picks it on
    // Intuit's screen - hence reason "new", which the component words
    // accordingly.
    ...connectCompanyResultFields({
      authorizeUrl: response.result!.authorize_url,
      reason: "new",
    }),
  };
};

export const AuthorizeCompanyTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
  // Every result of this tool is a connection prompt, so the component is
  // declared on the tool itself as well as on the result - the binding
  // claude.ai and other MCP Apps hosts read from `tools/list`.
  uiResourceUri: CONNECT_COMPANY_RESOURCE_URI,
};
