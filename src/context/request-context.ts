import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The current HTTP request's origin (scheme + host, see
 * ../http/oauth-http.js's resolveOrigin), needed by the Company-authorization
 * checkpoint (issue #8) to build an absolute authorize URL. Mirrors
 * employee-context.ts: HTTP-only, no process-wide default, so stdio and
 * tests that never call runWithRequestContext() simply see `undefined`.
 */
export interface RequestContext {
  origin: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
