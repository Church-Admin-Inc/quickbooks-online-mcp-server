import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { runWithCompanyContext } from "../context/company-context.js";
import { getCurrentEmployeeContext } from "../context/employee-context.js";
import { getCurrentRequestContext } from "../context/request-context.js";
import { checkCompanyAuthorization, type CompanyAuthorizationDeps } from "../auth/company-authorization.js";
import type { AuditLogger } from "../audit/audit-log.js";

/**
 * Defines CRUD categories for tools
 */
export const CRUD_CATEGORY = {
  WRITE:  "WRITE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  READ:   "READ",
} as const;

export type CrudCategory = typeof CRUD_CATEGORY[keyof typeof CRUD_CATEGORY];

/** 
 * Maps each CRUD category to its corresponding environment variable for disabling tools.
 */
export const DISABLE_ENV = {
  [CRUD_CATEGORY.WRITE]:  "QUICKBOOKS_DISABLE_WRITE",
  [CRUD_CATEGORY.UPDATE]: "QUICKBOOKS_DISABLE_UPDATE",
  [CRUD_CATEGORY.DELETE]: "QUICKBOOKS_DISABLE_DELETE",
} as const;

/** 
 * Maps every non-READ verb prefix to its category. Handles both underscore
 * and legacy hyphen separator variants (e.g. create-bill, update-vendor).
 * Insertion order is preserved in V8; all prefixes are distinct so order
 * does not affect correctness.
 */
export const PREFIX_CATEGORY_MAP: Record<string, CrudCategory> = {
  "create_": CRUD_CATEGORY.WRITE,
  "create-": CRUD_CATEGORY.WRITE,
  "update_": CRUD_CATEGORY.UPDATE,
  "update-": CRUD_CATEGORY.UPDATE,
  "delete_": CRUD_CATEGORY.DELETE,
  "delete-": CRUD_CATEGORY.DELETE,
};

/** 
 * Determines the CRUD category of a tool based on its name prefix.
 * Defaults to READ if no prefix matches.
 */
export function getCrudCategory(toolName: string): CrudCategory {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORY_MAP)) {
    if (toolName.startsWith(prefix)) return category;
  }
  return CRUD_CATEGORY.READ;
}

/** 
 * Checks if a tool is disabled based on its CRUD category and corresponding environment variable.
 * READ tools are never disabled.
 */
export function isToolDisabled(toolName: string): boolean {
  const category = getCrudCategory(toolName);
  if (category === CRUD_CATEGORY.READ) return false;
  return process.env[DISABLE_ENV[category]] === "true";
}

/** 
 * Registers a tool with the MCP server if it is not disabled.
 * Tools are categorized by their name prefix (e.g. create_, update_, delete_).
 * The corresponding environment variable (e.g. QUICKBOOKS_DISABLE_WRITE) determines if the tool is registered.
 */
/**
 * Unsupported-parameter reporting.
 *
 * Tool schemas are strict zod objects, so a parameter a tool does not declare is
 * SILENTLY DISCARDED during validation: the call succeeds, the value never
 * reaches QuickBooks, and the caller has no way to find out. In practice this
 * surfaced as an invoice sent to a customer with a blank Ship Date — the caller
 * passed `ship_date`, `create_invoice` did not declare it, and nothing said so.
 *
 * Hard-failing on unknown keys would turn a harmless stray parameter into a
 * failed transaction, so instead the schema is registered permissively (unknown
 * keys survive validation and can therefore be seen), the wrapper STRIPS them
 * before the handler runs, and the response names them.
 */

/** Top-level keys a tool's params schema declares, or null if not an object schema. */
export function knownParamKeys(schema: unknown): Set<string> | null {
  const shape = (schema as any)?._def?.shape;
  if (!shape) return null;
  try {
    return new Set(Object.keys(typeof shape === "function" ? shape() : shape));
  } catch {
    return null;
  }
}

/** Keep unknown keys through validation so they can be reported rather than vanish. */
export function permissiveParamsSchema<T>(schema: T): T {
  const anySchema = schema as any;
  return typeof anySchema?.passthrough === "function" ? anySchema.passthrough() : schema;
}

/** Human-readable notice naming parameters the tool does not support. */
export function unsupportedParamsWarning(
  toolName: string,
  known: Set<string> | null,
  params: unknown
): string | null {
  if (!known || !params || typeof params !== "object" || Array.isArray(params)) return null;
  const extras = Object.keys(params as Record<string, unknown>).filter((k) => !known.has(k));
  if (extras.length === 0) return null;
  return (
    `WARNING: ${toolName} does not support ${extras.length === 1 ? "this parameter" : "these parameters"}: ` +
    `${extras.join(", ")}. ${extras.length === 1 ? "It was" : "They were"} IGNORED - the value did not reach ` +
    `QuickBooks. Supported parameters: ${[...known].sort().join(", ")}.`
  );
}

/**
 * realm_id injection (ADR 0001: one multi-realm connector, not one per
 * Company).
 *
 * Every tool acts on one Company (QuickBooks realm). Rather than declaring
 * `realm_id` on each tool schema by hand, it is injected here, the single
 * chokepoint every tool passes through on its way to the server, and
 * stripped before the handler runs so handlers still see exactly the
 * parameters they declare. A write can never inherit an ambient or stale
 * Company, so it is REQUIRED for WRITE/UPDATE/DELETE tools; reads may fall
 * back to the session Company, so it is optional for them. When present, it
 * routes the call to the named Company via the AsyncLocalStorage context in
 * ../context/company-context.js.
 */

const REALM_ID_DESCRIPTION_REQUIRED =
  "The Id of the QuickBooks Company (realm) to act on. REQUIRED: writes never fall back to a default " +
  "or ambient Company.";
const REALM_ID_DESCRIPTION_OPTIONAL =
  "The Id of the QuickBooks Company (realm) to read from. Optional - falls back to the current " +
  "session's Company when omitted.";

/**
 * Adds `realm_id` to a tool's params schema: required for writes, optional
 * for reads. Every tool schema in this codebase is a `z.object(...)`, so
 * `.extend()` is always available; there is no fallback for a non-object
 * schema.
 */
function withRealmId<T extends z.ZodType<any, any>>(schema: T, category: CrudCategory): T {
  const required = category !== CRUD_CATEGORY.READ;
  const realmIdField = required
    ? z.string().min(1, "realm_id is required").describe(REALM_ID_DESCRIPTION_REQUIRED)
    : z.string().optional().describe(REALM_ID_DESCRIPTION_OPTIONAL);
  return (schema as unknown as z.AnyZodObject).extend({ realm_id: realmIdField }) as unknown as T;
}

/**
 * Tools that don't act on a single Company at all, so `realm_id` (per-Company
 * by definition, ADR 0001) is never injected onto them (issue #9). Without
 * this exemption every READ tool — including one that spans every Company
 * the employee holds a grant for — would get the misleading "falls back to
 * the session Company" note.
 */
const NO_REALM_ID_TOOLS = new Set<string>(["list_companies"]);

/** Appends a realm_id note to a tool's description so its meaning is unmissable. */
function describeRealmId(description: string, category: CrudCategory): string {
  const note =
    category === CRUD_CATEGORY.READ
      ? "Accepts realm_id naming which QuickBooks Company to read from; falls back to the session " +
        "Company when omitted."
      : "REQUIRES realm_id naming which QuickBooks Company to act on - there is no default Company " +
        "for writes.";
  return `${description} ${note}`;
}

/** Refusal for a write missing realm_id. Shaped like every handler's { content } response. */
function missingRealmIdResponse(toolName: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${toolName} requires "realm_id" naming which QuickBooks Company to act on, and it was not ` +
          `provided. A write is never allowed to fall back to an ambient or stale Company, so this call ` +
          `was refused before reaching QuickBooks. Retry with the realm_id of the intended Company.`,
      },
    ],
  };
}

/**
 * Company-authorization checkpoint (issue #8, ADR 0002). Set once by the HTTP
 * entry point (see ../http/create-streamable-http-server.ts) once a grant
 * store is available; left unset for stdio and for tests that don't exercise
 * multi-tenant authorization, in which case the checkpoint below is skipped
 * entirely — every existing single-tenant/stdio call is unaffected.
 */
let companyAuthorizationDeps: CompanyAuthorizationDeps | undefined;

export function setCompanyAuthorizationDeps(deps: CompanyAuthorizationDeps | undefined): void {
  companyAuthorizationDeps = deps;
}

/**
 * Write audit trail (issue #10). Set once by the HTTP entry point (see
 * ../http/create-streamable-http-server.ts) alongside companyAuthorizationDeps
 * above; left unset for stdio and for tests that don't exercise it, in which
 * case logging below is skipped entirely - same fallback shape as the
 * Company-authorization checkpoint.
 */
let auditLogger: AuditLogger | undefined;

export function setAuditLogger(logger: AuditLogger | undefined): void {
  auditLogger = logger;
}

/**
 * Backslash-escapes the Markdown link syntax characters (and strips
 * newlines), for untrusted text embedded in a tool result's Markdown link.
 * Narrow on purpose: only "\", "[", "]", "(", ")" can prematurely close the
 * "]" or "(" in `[label](url)` and rewrite the link's actual target: other
 * Markdown metacharacters (e.g. "-", "*", "_") can't redirect a link, so
 * leaving them alone keeps an ordinary Company name readable.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\[\]()]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

/**
 * Prompt to authorize, in place of a QuickBooks call, when the calling
 * employee holds no healthy grant for realmId. `reason` (issue #9)
 * distinguishes a Company never authorized at all from one whose connection
 * has since died, so the message never tells someone re-authorizing a dead
 * connection that they "have not yet authorized" it. `companyName`, when
 * known (a grant already exists to read it from), names the Company the way
 * the employee actually refers to it rather than by its opaque realm id —
 * the whole point of `list_companies` (also issue #9).
 */
function authorizationNeededResponse(
  toolName: string,
  realmId: string,
  authorizeUrl: string,
  reason: "missing" | "unhealthy",
  companyName: string | undefined
) {
  // companyName comes from QuickBooks' own CompanyInfo (issue #9) - set by
  // whoever administers that Company, not by this app - so it is untrusted
  // input. Escaping Markdown metacharacters (and stripping newlines) before
  // it goes into link text stops a crafted name from prematurely closing
  // the "]" or "(" below and rewriting the rendered link's actual target.
  const companyLabel = escapeMarkdown(companyName ?? realmId);
  const explanation =
    reason === "unhealthy"
      ? `your QuickBooks connection to Company "${companyLabel}" is no longer valid and must be re-authorized`
      : `you have not yet authorized QuickBooks Company "${companyLabel}"`;
  return {
    content: [
      {
        type: "text" as const,
        // Markdown link, not a bare URL: clients that render tool-result
        // text as Markdown (e.g. claude.ai relaying this in its own reply)
        // then show a clickable link rather than pasted text. There is no
        // MCP content type for an actual "Connect" button/widget today -
        // that needs an MCP App UI resource (tracked separately: #28).
        text:
          `${toolName} could not run: ${explanation}. [Authorize QuickBooks Company "${companyLabel}"](${authorizeUrl}) ` +
          `by signing in with your Intuit account, then retry the call.`,
      },
    ],
  };
}

export function RegisterTool<T extends z.ZodType<any, any>>(
  server: McpServer,
  toolDefinition: ToolDefinition<T>
) {
  if (isToolDisabled(toolDefinition.name)) return;

  const category = getCrudCategory(toolDefinition.name);
  const spansAllCompanies = NO_REALM_ID_TOOLS.has(toolDefinition.name);
  const requiresRealmId = category !== CRUD_CATEGORY.READ && !spansAllCompanies;
  const schemaWithRealmId = spansAllCompanies ? toolDefinition.schema : withRealmId(toolDefinition.schema, category);

  const known = knownParamKeys(schemaWithRealmId);
  const paramsSchema = permissiveParamsSchema(schemaWithRealmId);
  const baseHandler = toolDefinition.handler as unknown as (...a: any[]) => Promise<any>;

  const handler = (async (...a: any[]) => {
    let callArgs = a;
    let warning: string | null = null;
    let realmId: string | undefined;
    // Set alongside realmId, below, whenever the incoming params are an
    // object: the same cleaned params callArgs is rebuilt with, kept here so
    // the audit trail (issue #10) can log exactly what the handler receives
    // without re-deriving or re-asserting it later.
    let cleanedParams: Record<string, unknown> | undefined;
    try {
      const params = (a[0] as any)?.params;
      warning = unsupportedParamsWarning(toolDefinition.name, known, params);
      if (params && typeof params === "object" && !Array.isArray(params)) {
        const rawRealmId = (params as Record<string, unknown>).realm_id;
        realmId = typeof rawRealmId === "string" && rawRealmId.length > 0 ? rawRealmId : undefined;

        // Strip realm_id unconditionally (the handler never declares it) and,
        // when the schema's shape is known, any other undeclared key too.
        // This cannot wait until a warning is present: a rest-spread search
        // tool (search-bills, search-customers, search-estimates,
        // search-vendors) forwards its remainder straight into QuickBooks
        // query criteria, so realm_id left in place would become a stray
        // filter rather than routing information.
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
          if (k === "realm_id") continue;
          if (known && !known.has(k)) continue;
          cleaned[k] = v;
        }
        cleanedParams = cleaned;
        callArgs = [{ ...(a[0] as any), params: cleaned }, ...a.slice(1)];
      }
    } catch {
      /* diagnostics must never break a working call */
    }

    if (requiresRealmId && !realmId) {
      return missingRealmIdResponse(toolDefinition.name);
    }

    // The single checkpoint every Company resolution passes through
    // (issue #8). Only applies when a Company was actually named and an
    // authenticated employee is active (HTTP multi-tenant mode) — stdio and
    // any call that fell back to the ambient/default Company are untouched.
    if (realmId && companyAuthorizationDeps) {
      const employee = getCurrentEmployeeContext();
      if (employee) {
        const origin = getCurrentRequestContext()?.origin ?? "";
        const authorization = await checkCompanyAuthorization(companyAuthorizationDeps, employee, realmId, origin);
        if (!authorization.authorized) {
          return authorizationNeededResponse(
            toolDefinition.name,
            realmId,
            authorization.authorizeUrl,
            authorization.reason,
            authorization.companyName
          );
        }
      }
    }

    // Independent write audit trail (issue #10): recorded before the write is
    // attempted, so a call that throws or a QuickBooks outage never leaves a
    // write unaccounted for. Only WRITE/UPDATE/DELETE tools that actually
    // named a Company are logged - a call refused above (missing realm_id, or
    // failed authorization) never reaches QuickBooks and is not logged as a
    // write. Requires an authenticated employee, same as the authorization
    // checkpoint above: without one there is no identity to attribute the
    // write to.
    if (category !== CRUD_CATEGORY.READ && realmId && auditLogger) {
      const employee = getCurrentEmployeeContext();
      if (employee) {
        try {
          // realmId is only ever set alongside cleanedParams (above), so
          // cleanedParams is always defined here.
          await auditLogger.record({
            employeeSub: employee.sub,
            employeeEmail: employee.email,
            realmId,
            toolName: toolDefinition.name,
            params: cleanedParams as Record<string, unknown>,
          });
        } catch {
          /* logging a write must never prevent or alter the write itself */
        }
      }
    }

    const invoke = () => baseHandler(...callArgs);
    const result = realmId ? await runWithCompanyContext({ realmId }, invoke) : await invoke();

    try {
      if (warning && result && Array.isArray(result.content)) {
        // Prepended so it cannot be missed, and added even on error responses.
        result.content.unshift({ type: "text" as const, text: warning });
      }
    } catch {
      /* diagnostics must never break a working call */
    }
    return result;
  }) as typeof toolDefinition.handler;

  server.tool(
    toolDefinition.name,
    spansAllCompanies ? toolDefinition.description : describeRealmId(toolDefinition.description, category),
    { params: paramsSchema },
    handler
  );
}