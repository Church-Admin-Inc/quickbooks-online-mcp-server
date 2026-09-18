import crypto from "node:crypto";
import type { EmployeeContext } from "../context/employee-context.js";

/**
 * Server-side state for the federated login flow (issue #6). Unlike the
 * per-request McpServer/transport (stateless by design — see
 * create-streamable-http-server.ts), this state genuinely must survive
 * across requests within the same process: the /authorize redirect, the
 * Intuit callback, and the /token exchange are three separate HTTP requests
 * tied together only by these records. An in-memory Map is sufficient here
 * (unlike the QuickBooks grants in ADR 0002) because this is login state,
 * not a durable grant — losing it on a restart just means the employee signs
 * in again.
 */

export interface PendingLogin {
  claudeClientId: string;
  claudeRedirectUri: string;
  claudeState: string | undefined;
  codeChallenge: string;
  expiresAt: number;
}

export interface IssuedAuthorizationCode {
  identity: EmployeeContext;
  claudeClientId: string;
  claudeRedirectUri: string;
  codeChallenge: string;
  expiresAt: number;
  used: boolean;
}

export interface IssuedAccessToken {
  identity: EmployeeContext;
  expiresAt: number;
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class OAuthStore {
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly authorizationCodes = new Map<string, IssuedAuthorizationCode>();
  private readonly accessTokens = new Map<string, IssuedAccessToken>();

  /**
   * Expired records are otherwise only removed when something happens to
   * look them up again (consumePendingLogin, peekAuthorizationCode,
   * resolveAccessToken) — a public, unauthenticated endpoint like /authorize
   * lets anyone mint pending logins that are never followed up on, so
   * without this sweep the maps would grow without bound for the life of
   * the process. Called on every write, which keeps each map bounded to
   * roughly its live entries rather than requiring a background timer.
   */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.pendingLogins) {
      if (value.expiresAt < now) this.pendingLogins.delete(key);
    }
    for (const [key, value] of this.authorizationCodes) {
      if (value.used || value.expiresAt < now) this.authorizationCodes.delete(key);
    }
    for (const [key, value] of this.accessTokens) {
      if (value.expiresAt < now) this.accessTokens.delete(key);
    }
  }

  /** Current entry counts, exposed for tests and operational visibility into sweepExpired()'s effect. */
  sizes(): { pendingLogins: number; authorizationCodes: number; accessTokens: number } {
    return {
      pendingLogins: this.pendingLogins.size,
      authorizationCodes: this.authorizationCodes.size,
      accessTokens: this.accessTokens.size,
    };
  }

  createPendingLogin(login: Omit<PendingLogin, "expiresAt">, ttlSeconds: number): string {
    this.sweepExpired();
    const state = randomToken();
    this.pendingLogins.set(state, { ...login, expiresAt: Date.now() + ttlSeconds * 1000 });
    return state;
  }

  /** Looks up and removes a pending login (single use), or undefined if unknown/expired. */
  consumePendingLogin(state: string): PendingLogin | undefined {
    const login = this.pendingLogins.get(state);
    this.pendingLogins.delete(state);
    if (!login || login.expiresAt < Date.now()) return undefined;
    return login;
  }

  issueAuthorizationCode(
    record: Omit<IssuedAuthorizationCode, "expiresAt" | "used">,
    ttlSeconds: number
  ): string {
    this.sweepExpired();
    const code = randomToken();
    this.authorizationCodes.set(code, {
      ...record,
      expiresAt: Date.now() + ttlSeconds * 1000,
      used: false,
    });
    return code;
  }

  /**
   * Looks up an authorization code without consuming it, so the token
   * endpoint can validate the request (client_id, redirect_uri, PKCE) before
   * deciding whether to burn the code. Callers that accept the code must
   * follow up with markAuthorizationCodeUsed() (RFC 6749 §4.1.2: a code MUST
   * NOT be usable twice).
   */
  peekAuthorizationCode(code: string): IssuedAuthorizationCode | undefined {
    const record = this.authorizationCodes.get(code);
    if (!record || record.used || record.expiresAt < Date.now()) return undefined;
    return record;
  }

  markAuthorizationCodeUsed(code: string): void {
    const record = this.authorizationCodes.get(code);
    if (record) record.used = true;
  }

  issueAccessToken(identity: EmployeeContext, ttlSeconds: number): { token: string; expiresIn: number } {
    this.sweepExpired();
    const token = randomToken();
    this.accessTokens.set(token, { identity, expiresAt: Date.now() + ttlSeconds * 1000 });
    return { token, expiresIn: ttlSeconds };
  }

  /** The identity behind a bearer token, or undefined if unknown/expired. */
  resolveAccessToken(token: string): EmployeeContext | undefined {
    const record = this.accessTokens.get(token);
    if (!record || record.expiresAt < Date.now()) return undefined;
    return record.identity;
  }
}
