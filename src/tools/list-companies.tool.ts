import { listCompanies } from "../handlers/list-companies.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "list_companies";
const toolDescription =
  "List every QuickBooks Company the calling employee has authorized, with each Company's name, realm_id, " +
  "and connection health. Use this to resolve a Company the employee refers to by name into the realm_id " +
  "every other tool requires, and to find out before running a workflow whether a Company's connection has " +
  "gone unhealthy and needs re-authorization.";
const toolSchema = z.object({});

const toolHandler = async () => {
  const response = await listCompanies();
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const ListCompaniesTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
