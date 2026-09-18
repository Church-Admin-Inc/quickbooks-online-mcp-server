/**
 * Shared classifier distinguishing a genuinely dead Intuit refresh token
 * (revoked, expired, or rotated out — Intuit answers HTTP 400 invalid_grant,
 * or 401) from a transient failure (5xx, 429, network timeout). Only the
 * former means the connection needs re-authorization; a transient failure
 * must stay retryable so it self-heals.
 *
 * Extracted from ../clients/quickbooks-client.ts's own (identical) checks so
 * ../clients/grant-quickbooks-clients.ts (issue #9) can classify a refresh
 * failure the same way without duplicating the empirically-verified shape
 * matching below. See quickbooks-client.ts's own docstring for the shape
 * notes this was lifted from: intuit-oauth 4.x does not surface invalid_grant
 * in a tidy field, so the reliably available signal is the HTTP status
 * embedded in the axios-style error message.
 */
export function isAuthInvalidationError(error: unknown): boolean {
  // Walk the error's cause chain (bounded) so a wrapped error still classifies
  // correctly regardless of how many layers deep the real signal sits.
  let cur: unknown = error;
  for (let depth = 0; depth < 4 && cur != null; depth++) {
    if (classifyOneError(cur)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Classify a SINGLE error object (no cause traversal — the caller walks the
// chain). Returns true only for a genuine auth-invalidation.
function classifyOneError(raw: unknown): boolean {
  const asObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;

  // Explicit OAuth error fields, when populated.
  const errField = String(asObj?.error ?? "").toLowerCase();
  const errDesc = String(asObj?.error_description ?? "").toLowerCase();
  if (errField.includes("invalid_grant") || errDesc.includes("invalid_grant")) return true;

  // Numeric HTTP status from whichever field carries it (incl. intuit-oauth's
  // authResponse.status() accessor).
  let status: number | undefined;
  const ar = asObj?.authResponse as { status?: unknown; response?: { status?: unknown } } | undefined;
  if (ar) {
    if (typeof ar.status === "function") {
      try {
        const s = Number((ar.status as () => unknown)());
        if (!Number.isNaN(s)) status = s;
      } catch {
        /* accessor threw — fall through to message parsing */
      }
    } else if (typeof ar.status === "number") {
      status = ar.status;
    }
    if (status === undefined && ar.response && typeof ar.response.status === "number") {
      status = ar.response.status;
    }
  }
  if (status === undefined && typeof asObj?.status === "number") status = asObj.status as number;

  // Fallback: parse the axios-style message ("Request failed with status code
  // NNN") — the only signal intuit-oauth 4.x reliably exposes on invalid_grant
  // (its response body is discarded). The \b prevents a 4-digit number from
  // matching its 3-digit prefix.
  // `raw` is never null/undefined here: the caller's loop only invokes this
  // for `cur != null`.
  const message = (raw instanceof Error ? raw.message : String(raw)).toLowerCase();
  if (message.includes("invalid_grant")) return true;
  if (status === undefined) {
    const m = message.match(/status code (\d{3})\b/);
    if (m) status = Number(m[1]);
  }

  return status === 400 || status === 401;
}
