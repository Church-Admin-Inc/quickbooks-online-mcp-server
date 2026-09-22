import {
  CompanyAuthorizationStore,
  mintCompanyAuthorizeUrl,
} from "../auth/company-authorization.js";
import { getCurrentEmployeeContext } from "../context/employee-context.js";
import { getCurrentRequestContext } from "../context/request-context.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Connection half of issue #29. The Company-authorization flow (issue #8) is
 * otherwise only reachable by naming a Company that already has a Realm ID
 * the employee knows, which leaves no way to connect a Company for the first
 * time: `list_companies` (issue #9) only ever lists Companies that already
 * have grants, so there is no discovery path either, and the claude.ai
 * connector's own re-authorization is the *MCP connection* (issue #6), which
 * is independent of a QuickBooks connection (see CONTEXT.md, "Connection").
 *
 * So this mints the same one-time link as the realm-directed checkpoint, but
 * names no Company: the employee picks one on Intuit's consent screen, which
 * they must pass through regardless, and the callback stores whichever they
 * picked.
 */
export interface AuthorizeCompanyDeps {
  pending: CompanyAuthorizationStore;
}

let deps: AuthorizeCompanyDeps | undefined;

/**
 * Set once by the HTTP entry point (see ../http/create-streamable-http-server.ts),
 * mirroring setListCompaniesDeps and setCompanyAuthorizationDeps. Left unset
 * for stdio, which reaches exactly one Company configured by environment
 * variables and has no browser to send anywhere.
 */
export function setAuthorizeCompanyDeps(newDeps: AuthorizeCompanyDeps | undefined): void {
  deps = newDeps;
}

export interface AuthorizeCompanyResult {
  authorize_url: string;
}

export async function authorizeCompany(): Promise<ToolResponse<AuthorizeCompanyResult>> {
  const employee = getCurrentEmployeeContext();
  if (!employee || !deps) {
    return {
      result: null,
      isError: true,
      error:
        "authorize_company is only meaningful in multi-Company mode (this server's streamable HTTP transport " +
        "with an authenticated employee). This process is running single-tenant/stdio, which reaches exactly " +
        "one Company configured by its own environment variables, so there is nothing to connect.",
    };
  }

  // Same requirement as the realm-directed checkpoint: the link the employee
  // opens in a browser has to be absolute, and the only source of this
  // server's own public origin is the request being served.
  const origin = getCurrentRequestContext()?.origin;
  if (!origin) {
    return {
      result: null,
      isError: true,
      error:
        "authorize_company could not determine this server's public address, so it cannot build the " +
        "authorization link. Retry the call; if it keeps failing, this server is misconfigured.",
    };
  }

  try {
    const authorizeUrl = mintCompanyAuthorizeUrl(deps.pending, { employeeSub: employee.sub }, origin);
    return { result: { authorize_url: authorizeUrl }, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
