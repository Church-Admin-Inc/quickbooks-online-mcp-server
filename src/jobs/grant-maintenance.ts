import OAuthClient from "intuit-oauth";
import type { Grant, GrantHandle, GrantKey, GrantStore } from "../clients/firestore-grant-store.js";
import { isAuthInvalidationError } from "../helpers/intuit-auth-errors.js";
import { IntuitCompanyInfoProvider, type CompanyInfoProvider } from "../auth/company-info-provider.js";
import type { IntuitFederationConfig } from "../auth/oauth-config.js";

/**
 * Scheduled grant maintenance (issue #12, ADR 0002). Per-employee grants
 * only stay cheap to operate if they look after themselves: a daily sweep
 * keeps every grant inside Intuit's rolling 100-day refresh-token window,
 * a weekly sweep re-validates that Intuit still honours each grant (not
 * just that its refresh token still rotates - ADR 0002 notes Intuit does
 * not appear to enforce the authorizing employee's in-Company role after
 * grant time), and dormant grants expire after 30 days unused. None of
 * this is wired to an actual scheduler here (Cloud Run deployment is issue
 * #13) - GrantMaintenanceJob is the unit a Cloud Scheduler-triggered
 * endpoint or a Cloud Run Job's entry point calls into.
 */

/**
 * Same {clientId, clientSecret, environment} shape ../clients/grant-quickbooks-clients.ts
 * and ../auth/oauth-config.ts's own loadIntuitFederationConfig() already use for
 * this same Intuit app (ADR 0002) - reused rather than redefined a third time.
 */
export type GrantMaintenanceConfig = IntuitFederationConfig;

/** Raised when a Company's grant transitions from healthy to unhealthy, so an administrator hears about it before the finance team does. */
export interface GrantAlert {
  employeeSub: string;
  realmId: string;
  companyName: string;
  reason: string;
}

export interface AlertNotifier {
  notify(alert: GrantAlert): Promise<void>;
}

/**
 * Logs to stderr, same as every other "no real infrastructure wired up yet"
 * default in this codebase (see createDefaultAuditLog in ../audit/audit-log.ts).
 * A deployed environment overrides this with a real paging/notification
 * integration (issue #13's concern, not this one's).
 */
export class ConsoleAlertNotifier implements AlertNotifier {
  async notify(alert: GrantAlert): Promise<void> {
    console.error(
      `[grant-maintenance] ALERT: Company "${alert.companyName}" (realm ${alert.realmId}) is unhealthy for ` +
        `employee "${alert.employeeSub}": ${alert.reason}`
    );
  }
}

export function createDefaultAlertNotifier(): AlertNotifier {
  return new ConsoleAlertNotifier();
}

export interface GrantMaintenanceRunResult {
  total: number;
  succeeded: number;
  failed: { key: GrantKey; error: unknown }[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** A revalidation call rejected because Intuit no longer honours this grant, as opposed to a transient network/5xx blip. */
function isCompanyInfoAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\breturned (401|403)\b/.test(message);
}

export class GrantMaintenanceJob {
  private config?: GrantMaintenanceConfig;
  private oauthClient?: OAuthClient;

  constructor(
    private readonly grantStore: GrantStore,
    private readonly loadConfig: () => GrantMaintenanceConfig,
    private readonly alertNotifier: AlertNotifier = createDefaultAlertNotifier(),
    private readonly companyInfoProvider: CompanyInfoProvider = new IntuitCompanyInfoProvider()
  ) {}

  private ensureConfig(): GrantMaintenanceConfig {
    if (!this.config) {
      this.config = this.loadConfig();
      // redirectUri is irrelevant to a refresh-token exchange (mirrors
      // ../clients/grant-quickbooks-clients.ts's own reasoning).
      this.oauthClient = new OAuthClient({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        environment: this.config.environment,
        redirectUri: "https://unused.invalid/callback",
      });
    }
    return this.config;
  }

  /**
   * Daily job: refreshes every grant through the exact single-flight path
   * an on-demand refresh uses (GrantHandle.refresh, see
   * ../clients/firestore-grant-store.ts), keeping each refresh token inside
   * Intuit's rolling 100-day window. One grant failing to refresh never
   * stops the run - each grant's outcome is isolated and collected.
   */
  async refreshAllGrants(): Promise<GrantMaintenanceRunResult> {
    const grants = await this.grantStore.listAll();
    return this.runPerGrant(grants, (grant) => this.refreshOne(grant));
  }

  /**
   * Weekly job: re-validates every grant with a live QuickBooks call, on
   * top of the same refresh a daily run performs. Catches the case ADR 0002
   * calls out - the refresh token still rotates fine, but the employee's
   * actual access to this Company's data was revoked in QuickBooks.
   */
  async revalidateAllGrants(): Promise<GrantMaintenanceRunResult> {
    const grants = await this.grantStore.listAll();
    return this.runPerGrant(grants, (grant) => this.revalidateOne(grant));
  }

  /**
   * Any grant unused for 30 days expires (ADR 0002), so dormant access
   * decays on its own. Only ever downgrades a currently-healthy grant - an
   * already-unhealthy one has nothing left to expire, and re-alerting it
   * would just be noise.
   */
  async expireStaleGrants(now: Date = new Date()): Promise<GrantMaintenanceRunResult> {
    const grants = await this.grantStore.listAll();
    return this.runPerGrant(grants, (grant) => this.expireOneIfStale(grant, now));
  }

  private async runPerGrant(
    grants: Grant[],
    run: (grant: Grant) => Promise<void>
  ): Promise<GrantMaintenanceRunResult> {
    const outcomes = await Promise.allSettled(grants.map((grant) => run(grant)));
    const failed: { key: GrantKey; error: unknown }[] = [];
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") {
        const grant = grants[index];
        failed.push({ key: { employeeSub: grant.employeeSub, realmId: grant.realmId }, error: outcome.reason });
      }
    });
    return { total: grants.length, succeeded: grants.length - failed.length, failed };
  }

  private handleFor(grant: Grant): GrantHandle {
    return this.grantStore.forGrant({ employeeSub: grant.employeeSub, realmId: grant.realmId });
  }

  private async refreshOne(grant: Grant): Promise<void> {
    const handle = this.handleFor(grant);
    try {
      await handle.refresh((currentRefreshToken) => this.exchangeToken(currentRefreshToken));
    } catch (error) {
      if (!isAuthInvalidationError(error)) throw error;
      await this.markUnhealthy(handle, grant, "the refresh token was rejected by Intuit");
    }
  }

  private async revalidateOne(grant: Grant): Promise<void> {
    const handle = this.handleFor(grant);
    let accessToken: string | undefined;
    try {
      await handle.refresh(async (currentRefreshToken) => {
        const exchanged = await this.exchangeTokenWithAccessToken(currentRefreshToken);
        accessToken = exchanged.accessToken;
        return { refreshToken: exchanged.refreshToken };
      });
    } catch (error) {
      if (!isAuthInvalidationError(error)) throw error;
      await this.markUnhealthy(handle, grant, "the refresh token was rejected by Intuit");
      return;
    }

    try {
      const config = this.ensureConfig();
      // accessToken is always set here: the refresh above either populated
      // it or threw, and the throw path already returned.
      await this.companyInfoProvider.fetchCompanyName({
        accessToken: accessToken as string,
        realmId: grant.realmId,
        environment: config.environment,
      });
    } catch (error) {
      if (!isCompanyInfoAuthFailure(error)) throw error;
      await this.markUnhealthy(handle, grant, "QuickBooks rejected access to this Company's data");
    }
  }

  private async expireOneIfStale(grant: Grant, now: Date): Promise<void> {
    if (grant.health !== "healthy") return;
    const lastActivity = grant.lastUsedAt ?? grant.createdAt;
    if (now.getTime() - lastActivity.getTime() < THIRTY_DAYS_MS) return;
    await this.markUnhealthy(this.handleFor(grant), grant, "unused for 30 days");
  }

  /** Only records+alerts on the healthy -> unhealthy transition, so a grant that is already unhealthy is never re-alerted on every subsequent sweep. */
  private async markUnhealthy(handle: GrantHandle, grant: Grant, reason: string): Promise<void> {
    if (grant.health !== "healthy") return;
    await handle.recordHealth("unhealthy");
    await this.alertNotifier.notify({
      employeeSub: grant.employeeSub,
      realmId: grant.realmId,
      companyName: grant.companyName,
      reason,
    });
  }

  private async exchangeToken(currentRefreshToken: string): Promise<{ refreshToken: string }> {
    const { refreshToken } = await this.exchangeTokenWithAccessToken(currentRefreshToken);
    return { refreshToken };
  }

  private async exchangeTokenWithAccessToken(
    currentRefreshToken: string
  ): Promise<{ refreshToken: string; accessToken: string }> {
    this.ensureConfig();
    const authResponse = await this.oauthClient!.refreshUsingToken(currentRefreshToken);
    const token = authResponse.token as unknown as { access_token: string; refresh_token?: string };
    return { refreshToken: token.refresh_token ?? currentRefreshToken, accessToken: token.access_token };
  }
}

export function createDefaultGrantMaintenanceJob(
  grantStore: GrantStore,
  loadConfig: () => GrantMaintenanceConfig
): GrantMaintenanceJob {
  return new GrantMaintenanceJob(grantStore, loadConfig);
}
