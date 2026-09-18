import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The authenticated employee for the current async chain, established by the
 * HTTP transport's bearer-token check (see ../auth) once issue #6's OAuth
 * flow has federated them to Intuit. Unlike ../context/company-context.ts
 * there is no process-wide default: the stdio transport has no employee
 * identity at all (single local user, no auth), so callers outside an
 * authenticated HTTP request simply see `undefined`.
 */
export interface EmployeeContext {
  /** Intuit's stable subject identifier for the employee. */
  sub: string;
  /** The employee's Intuit account email, the identity QuickBooks' own audit log records. */
  email: string;
}

const employeeContextStorage = new AsyncLocalStorage<EmployeeContext>();

/** Runs `fn` with `context` as the active employee for its whole async chain. */
export function runWithEmployeeContext<T>(context: EmployeeContext, fn: () => T): T {
  return employeeContextStorage.run(context, fn);
}

/**
 * The authenticated employee for the current async chain, or undefined when
 * none is active (e.g. the stdio transport, or a test that never called
 * runWithEmployeeContext()).
 */
export function getCurrentEmployeeContext(): EmployeeContext | undefined {
  return employeeContextStorage.getStore();
}
