#!/usr/bin/env node
/**
 * Scheduled grant maintenance entry point (issue #12). Deployment wiring
 * this up to an actual schedule - Cloud Scheduler hitting a Cloud Run Job,
 * a cron trigger, or anything else - is issue #13's concern; this is the
 * process such a trigger runs, once a day and once a week respectively:
 *
 *   node dist/grant-maintenance-index.js daily
 *   node dist/grant-maintenance-index.js weekly
 *
 * Exits non-zero if any individual grant failed its sweep, so the scheduler
 * itself surfaces a failed run - on top of (not instead of) the per-Company
 * alerts GrantMaintenanceJob raises for a grant that actually went
 * unhealthy.
 */
import { FirestoreGrantStore } from "./clients/firestore-grant-store.js";
import { createFirestore } from "./clients/cloud-firestore.js";
import { loadIntuitFederationConfig } from "./auth/oauth-config.js";
import { GrantMaintenanceJob, type GrantMaintenanceRunResult } from "./jobs/grant-maintenance.js";

type Mode = "daily" | "weekly";

function readMode(): Mode {
  const arg = process.argv[2];
  if (arg === "daily" || arg === "weekly") return arg;
  throw new Error(`Usage: grant-maintenance-index.js <daily|weekly>, got "${arg ?? ""}"`);
}

function report(label: string, result: GrantMaintenanceRunResult): void {
  console.log(`[grant-maintenance] ${label}: ${result.succeeded}/${result.total} grants succeeded`);
  for (const failure of result.failed) {
    console.error(
      `[grant-maintenance] ${label} failed for employee "${failure.key.employeeSub}", realm "${failure.key.realmId}":`,
      failure.error
    );
  }
}

async function main(): Promise<void> {
  const mode = readMode();
  // Backed by real Firestore when GOOGLE_CLOUD_PROJECT is set (issue #13's
  // deployment — see createFirestore()), in-process otherwise.
  const grantStore = new FirestoreGrantStore(createFirestore());
  const job = new GrantMaintenanceJob(grantStore, loadIntuitFederationConfig);

  const results: GrantMaintenanceRunResult[] = [];
  if (mode === "daily") {
    const refreshResult = await job.refreshAllGrants();
    report("daily refresh", refreshResult);
    const expiryResult = await job.expireStaleGrants();
    report("30-day expiry", expiryResult);
    results.push(refreshResult, expiryResult);
  } else {
    const revalidateResult = await job.revalidateAllGrants();
    report("weekly re-validation", revalidateResult);
    results.push(revalidateResult);
  }

  const anyFailed = results.some((result) => result.failed.length > 0);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error("[grant-maintenance] Fatal error:", error);
  process.exit(1);
});
