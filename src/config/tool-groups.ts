/**
 * Tool group configuration (issue #11, ADR 0001 "Tool surface").
 *
 * Which tools are registered is configuration, not a fixed list. Tools are
 * partitioned into named groups; the enabled set of groups defaults to the
 * finance-workflow subset the team actually uses, and can be widened (or
 * narrowed) with QUICKBOOKS_ENABLED_TOOL_GROUPS - no code change required.
 *
 * This is orthogonal to the existing CRUD disable flags (QUICKBOOKS_DISABLE_*
 * in register-tool.ts): a tool must belong to an enabled group AND not be
 * suppressed by its CRUD category to be registered.
 */

export const TOOL_GROUPS = {
  REPORTS: "reports",
  INVOICES: "invoices",
  BILLS: "bills",
  PAYMENTS: "payments",
  CUSTOMERS: "customers",
  VENDORS: "vendors",
  ACCOUNTS: "accounts",
  JOURNAL_ENTRIES: "journal_entries",
  SALES_RECEIPTS: "sales_receipts",
  DEPOSITS: "deposits",
  CLASSES: "classes",
  DEPARTMENTS: "departments",
  ESTIMATES: "estimates",
  ITEMS: "items",
  EMPLOYEES: "employees",
  PURCHASES: "purchases",
  CREDIT_MEMOS: "credit_memos",
  REFUND_RECEIPTS: "refund_receipts",
  PURCHASE_ORDERS: "purchase_orders",
  VENDOR_CREDITS: "vendor_credits",
  TRANSFERS: "transfers",
  TIME_ACTIVITIES: "time_activities",
  TERMS: "terms",
  PAYMENT_METHODS: "payment_methods",
  BUDGETS: "budgets",
  TAX_CODES: "tax_codes",
  TAX_RATES: "tax_rates",
  TAX_AGENCIES: "tax_agencies",
  COMPANY_INFO: "company_info",
  PREFERENCES: "preferences",
  ATTACHABLES: "attachables",
} as const;

export type ToolGroup = (typeof TOOL_GROUPS)[keyof typeof TOOL_GROUPS];

/**
 * Finance-workflow subset (issue #1, "Tool surface"). Classes and departments
 * are load-bearing for fund accounting, contribution journal entries and
 * special-event tracking, so they ship enabled rather than in the optional
 * tail.
 */
export const DEFAULT_ENABLED_TOOL_GROUPS: readonly ToolGroup[] = [
  TOOL_GROUPS.REPORTS,
  TOOL_GROUPS.INVOICES,
  TOOL_GROUPS.BILLS,
  TOOL_GROUPS.PAYMENTS,
  TOOL_GROUPS.CUSTOMERS,
  TOOL_GROUPS.VENDORS,
  TOOL_GROUPS.ACCOUNTS,
  TOOL_GROUPS.JOURNAL_ENTRIES,
  TOOL_GROUPS.SALES_RECEIPTS,
  TOOL_GROUPS.DEPOSITS,
  TOOL_GROUPS.CLASSES,
  TOOL_GROUPS.DEPARTMENTS,
];

export const ENABLED_TOOL_GROUPS_ENV = "QUICKBOOKS_ENABLED_TOOL_GROUPS";

/**
 * Reads the enabled tool groups from QUICKBOOKS_ENABLED_TOOL_GROUPS (a
 * comma-separated list), falling back to DEFAULT_ENABLED_TOOL_GROUPS when the
 * variable is unset or blank. Read fresh on every call (not cached at module
 * load) so it reflects the environment at server start, and so tests can
 * mutate process.env between calls.
 */
export function getEnabledToolGroups(): Set<ToolGroup> {
  const raw = process.env[ENABLED_TOOL_GROUPS_ENV];
  if (!raw || raw.trim() === "") return new Set(DEFAULT_ENABLED_TOOL_GROUPS);
  const groups = raw
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
  return new Set(groups as ToolGroup[]);
}

/**
 * Filters a list of {tool, group} entries down to those whose group is
 * enabled, preserving order. Pure and independent of the MCP SDK so it can be
 * exercised with fake tools rather than importing the full tool surface.
 */
export function selectEnabledTools<T>(
  entries: readonly { tool: T; group: ToolGroup }[],
  enabledGroups: ReadonlySet<ToolGroup>
): T[] {
  return entries.filter((entry) => enabledGroups.has(entry.group)).map((entry) => entry.tool);
}
