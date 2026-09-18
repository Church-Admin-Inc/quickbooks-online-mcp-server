import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The resolved Company (QuickBooks realm) for the current async chain. Later
 * tickets add fields as multi-Company configuration lands; today it carries
 * only what `QuickbooksClient` needs to pick an instance.
 */
export interface CompanyContext {
  realmId: string;
}

const companyContextStorage = new AsyncLocalStorage<CompanyContext>();

// Process-wide fallback for async chains that never call
// runWithCompanyContext() — i.e. every request today, since single-tenant
// stdio has no per-request Company parameter yet. Set once at startup from
// the existing environment variables.
let defaultCompanyContext: CompanyContext | undefined;

export function setDefaultCompanyContext(context: CompanyContext): void {
  defaultCompanyContext = context;
}

/** Runs `fn` with `context` as the active Company for its whole async chain. */
export function runWithCompanyContext<T>(context: CompanyContext, fn: () => T): T {
  return companyContextStorage.run(context, fn);
}

/**
 * The Company for the current async chain: an explicitly active context if
 * one was established via runWithCompanyContext(), otherwise the process-wide
 * default derived from environment variables.
 */
export function getCurrentCompanyContext(): CompanyContext {
  const active = companyContextStorage.getStore();
  if (active) return active;
  if (defaultCompanyContext) return defaultCompanyContext;
  throw new Error(
    "No Company context is active and no default context has been configured. " +
      "Call setDefaultCompanyContext() at startup, or wrap the call in runWithCompanyContext()."
  );
}
