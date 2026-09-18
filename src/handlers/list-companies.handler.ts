import type { GrantStore } from "../clients/firestore-grant-store.js";
import { getCurrentEmployeeContext } from "../context/employee-context.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Discovery half of issue #9. `list_companies` tells Claude which Companies
 * the calling employee can reach, under what name, and whether the
 * connection is healthy — resolved entirely from the grants that employee
 * already holds (see ADR 0002 / issue #1's "Enumerating an accountant firm's
 * client list automatically" out-of-scope note: Companies become known as
 * employees authorize them, so there is no separate Company registry to
 * consult here).
 */
export interface ListCompaniesDeps {
  grantStore: GrantStore;
}

let deps: ListCompaniesDeps | undefined;

/**
 * Set once by the HTTP entry point (see ../http/create-streamable-http-server.ts)
 * once a grant store is available — mirrors setCompanyAuthorizationDeps in
 * ../helpers/register-tool.ts. Left unset for stdio and for tests that don't
 * exercise multi-tenant mode.
 */
export function setListCompaniesDeps(newDeps: ListCompaniesDeps | undefined): void {
  deps = newDeps;
}

export interface CompanySummary {
  name: string;
  realm_id: string;
  health: "healthy" | "unhealthy";
}

export async function listCompanies(): Promise<ToolResponse<CompanySummary[]>> {
  const employee = getCurrentEmployeeContext();
  if (!employee || !deps) {
    return {
      result: null,
      isError: true,
      error:
        "list_companies is only meaningful in multi-Company mode (this server's streamable HTTP transport with " +
        "an authenticated employee). This process is running single-tenant/stdio, which reaches exactly one " +
        "Company configured by its own environment variables, so there is no list to return.",
    };
  }

  try {
    const grants = await deps.grantStore.listForEmployee(employee.sub);
    const companies: CompanySummary[] = grants
      .map((grant) => ({ name: grant.companyName, realm_id: grant.realmId, health: grant.health }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { result: companies, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
