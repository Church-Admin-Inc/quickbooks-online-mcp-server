# Deploying to Cloud Run (issue #13)

The streamable-HTTP server (`npm run start:http`) deploys to Cloud Run,
backed by Firestore in native mode for grants and the audit log (the latter
under a TTL policy, below), with Cloud Scheduler driving the maintenance job
(#12). No Cloud NAT or static egress
IP is provisioned — Intuit's Geolocation IP field is optional, and this
service never needs outbound access from a fixed address.

## One-time project setup

```
gcloud services enable run.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com --project=<PROJECT_ID>

gcloud firestore databases create --project=<PROJECT_ID> \
  --location=<REGION> --type=firestore-native

gcloud artifacts repositories create qbo-mcp-server --project=<PROJECT_ID> \
  --repository-format=docker --location=<REGION>

gcloud iam service-accounts create qbo-mcp-server --project=<PROJECT_ID>
gcloud iam service-accounts create qbo-scheduler --project=<PROJECT_ID>

# The service account the Cloud Run service and jobs run as needs Firestore
# access; Secret Manager access is granted per-secret below.
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role=roles/datastore.user
```

Intuit's `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` live in Secret
Manager, not in an env var baked into a manifest — see
`scripts/wizard-*.sh` (generated per the `/wizard` skill; not committed) for
the interactive walkthrough that pulls them from
https://developer.intuit.com/app/developer/myapps and writes them with:

```
gcloud secrets create QUICKBOOKS_CLIENT_ID --project=<PROJECT_ID> --replication-policy=automatic
printf '%s' "$VALUE" | gcloud secrets versions add QUICKBOOKS_CLIENT_ID --project=<PROJECT_ID> --data-file=-
# ...and the same for QUICKBOOKS_CLIENT_SECRET

gcloud secrets add-iam-policy-binding QUICKBOOKS_CLIENT_ID --project=<PROJECT_ID> \
  --member="serviceAccount:qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
# ...and the same for QUICKBOOKS_CLIENT_SECRET
```

## Build and deploy the service

```
gcloud builds submit --project=<PROJECT_ID> --region=<REGION> \
  --tag=<REGION>-docker.pkg.dev/<PROJECT_ID>/qbo-mcp-server/qbo-mcp-server:latest .

gcloud run deploy qbo-mcp-server --project=<PROJECT_ID> --region=<REGION> \
  --image=<REGION>-docker.pkg.dev/<PROJECT_ID>/qbo-mcp-server/qbo-mcp-server:latest \
  --service-account=qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com \
  --min-instances=0 --max-instances=3 \
  --allow-unauthenticated \
  --set-env-vars="HOST=0.0.0.0,QUICKBOOKS_ENVIRONMENT=sandbox,GOOGLE_CLOUD_PROJECT=<PROJECT_ID>" \
  --set-secrets="QUICKBOOKS_CLIENT_ID=QUICKBOOKS_CLIENT_ID:latest,QUICKBOOKS_CLIENT_SECRET=QUICKBOOKS_CLIENT_SECRET:latest"
```

`GOOGLE_CLOUD_PROJECT` must be set explicitly — unlike App Engine or Cloud
Functions, Cloud Run does **not** inject it automatically. Without it,
`createFirestore()` (src/clients/cloud-firestore.ts) silently falls back to
the in-process store: every request appears to work (grants "persist"
within one warm container), but nothing survives a cold start or is shared
across concurrent instances, and nothing lands in Firestore at all. This
was caught live during #13's verification — `gcloud firestore` showed an
empty `grants` collection despite successful tool calls, because two
requests in the same warm container shared in-memory state that looked like
persistence but wasn't. Redeploying with this var set, then re-authorizing,
produced a real Firestore document keyed `{employeeSub}:{realmId}`.

`--allow-unauthenticated` is required — claude.ai must reach `/authorize`
and `/token` over open HTTPS. Cloud Run's own IAM gate would sit in front of
this server's already-enforced OAuth (#6) and block every connector before
it ever got there; it is not "no auth", it is "one fewer redundant gate".

`--min-instances=0` keeps scale-to-zero; `QUICKBOOKS_ENVIRONMENT` selects
sandbox vs. production per deployment (the acceptance criterion in #13) —
point a second Cloud Run service/revision at production keys the same way.

Once the service has a URL, set the two env vars that depend on it and
redeploy:

```
gcloud run services update qbo-mcp-server --project=<PROJECT_ID> --region=<REGION> \
  --update-env-vars="MCP_OAUTH_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,MCP_HTTP_ALLOWED_HOSTS=<the run.app hostname, no scheme>"
```

`MCP_HTTP_ALLOWED_HOSTS` guards against DNS rebinding (see
`create-streamable-http-server.ts`); it must list the exact Cloud Run
hostname or every request gets a 400.

## Audit log retention (issue #33)

Audit entries (`audit-log` collection) carry the tool parameters of every
write, which for bookkeeping operations is a Company's financial detail. Each
document is stamped with an `expiresAt` Timestamp seven years out
(`AUDIT_LOG_RETENTION_YEARS` in `src/audit/audit-log.ts`), and a Firestore
TTL policy on that field does the deleting:

```
gcloud firestore fields ttls update expiresAt --project=<PROJECT_ID> \
  --database='(default)' --collection-group=audit-log --enable-ttl
```

`--database` must name the same database the service writes to — the one
`FIRESTORE_DATABASE_ID` selects (`(default)` unless that var is set,
see `createFirestore()`). Pointed at the wrong database the command succeeds
and nothing ever expires. The same goes for `--collection-group`: it must
match the collection `FirestoreAuditLog` was constructed with, which is
`audit-log` everywhere this server wires itself up.

TTL rather than the maintenance job below, deliberately: the retention period
is stated in the published Privacy Policy, so it has to hold even if no
scheduled job ever runs again. Firestore deletes expired documents within 24
hours of their expiry, on its own schedule and at no read/write cost.
Applying the policy backfills nothing: a document written before the field
existed would have no `expiresAt` and so would never expire. That case turned
out not to exist — when the policy was applied, `audit-log` had never been
written to in the deployed database (only `grants` was there), so every entry
the deployment will ever hold is stamped. Worth re-checking if this is ever
applied to a database that has been running longer.

Applied to the deployed database on 2026-09-22; `gcloud firestore fields ttls
list` shows it `ACTIVE`. It is a one-time change made by hand, not a build
step — `cloudbuild.yaml` rolls the image only, and putting this there would
mean granting the build service account Firestore admin to re-assert an
unchanged policy on every push.

## Scheduled grant maintenance (issue #12)

Two Cloud Run Jobs run the same image with `daily`/`weekly` as the command
argument, invoked by Cloud Scheduler over the Cloud Run Admin API (Jobs have
no public HTTP endpoint of their own):

```
gcloud run jobs create qbo-grant-maintenance-<daily|weekly> \
  --project=<PROJECT_ID> --region=<REGION> \
  --image=<REGION>-docker.pkg.dev/<PROJECT_ID>/qbo-mcp-server/qbo-mcp-server:latest \
  --service-account=qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars="QUICKBOOKS_ENVIRONMENT=sandbox,GOOGLE_CLOUD_PROJECT=<PROJECT_ID>" \
  --set-secrets="QUICKBOOKS_CLIENT_ID=QUICKBOOKS_CLIENT_ID:latest,QUICKBOOKS_CLIENT_SECRET=QUICKBOOKS_CLIENT_SECRET:latest" \
  --command="node" --args="dist/grant-maintenance-index.js,<daily|weekly>" \
  --max-retries=0 --task-timeout=300

gcloud iam service-accounts create qbo-scheduler --project=<PROJECT_ID>
gcloud run jobs add-iam-policy-binding qbo-grant-maintenance-<daily|weekly> \
  --project=<PROJECT_ID> --region=<REGION> \
  --member="serviceAccount:qbo-scheduler@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role=roles/run.invoker

gcloud scheduler jobs create http qbo-grant-maintenance-daily \
  --project=<PROJECT_ID> --location=<REGION> --schedule="0 3 * * *" \
  --uri="https://<REGION>-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<PROJECT_ID>/jobs/qbo-grant-maintenance-daily:run" \
  --http-method=POST --oauth-service-account-email=qbo-scheduler@<PROJECT_ID>.iam.gserviceaccount.com \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"

# weekly: --schedule="0 4 * * 1", :run URI for qbo-grant-maintenance-weekly
```

`--max-retries=0`: a failed sweep already alerts per #12's job semantics
(non-zero exit on any failed grant); an automatic retry would double-run a
refresh against Intuit's roughly-daily token rotation.

## Free-tier fit

At agency scale (a handful of employees, a few dozen Companies), this stays
within Cloud Run's, Firestore's, and Cloud Scheduler's always-free
allowances: scale-to-zero means no charge while idle, Firestore native mode
has a permanent free tier for reads/writes/storage at this volume, and
Scheduler's free tier covers far more than two jobs a day.

## Connecting claude.ai

Once deployed, add a connector in claude.ai pointing at
`https://<the run.app URL>/mcp`, complete Intuit sign-in, and run a tool
call — this is the acceptance criterion in #13 that only a human, signed
into claude.ai, can actually exercise.

## Continuous deployment from `main` (Cloud Build)

`cloudbuild.yaml` at the repo root runs the test suite, builds the image, and
rolls all three targets — the service and both maintenance jobs — pinned to
`:$SHORT_SHA`. A release is only whole when all three move: the daily sweep
is where a stale image does real harm, and rolling it by hand is exactly the
step that gets forgotten.

One-time setup. Connecting the GitHub repository is interactive (it installs
the Cloud Build GitHub App, which needs admin on the `Church-Admin-Inc` org),
so it is done in the console at Cloud Build → Repositories → Create host
connection, then Link repository. Afterwards:

```
# The build's service account deploys as the runtime service account.
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com" \
  --role=roles/run.admin

gcloud iam service-accounts add-iam-policy-binding \
  qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com --project=<PROJECT_ID> \
  --member="serviceAccount:<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser

gcloud builds triggers create github --project=<PROJECT_ID> --region=<REGION> \
  --name=deploy-main --repo-name=quickbooks-online-mcp-server \
  --repo-owner=Church-Admin-Inc --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml
```

`roles/run.admin` is broad: it lets any build on `main` reconfigure the
service, not merely swap its image. The narrower `roles/run.developer` is
enough for `run deploy --image` and `run jobs update --image`, and is worth
preferring if the trigger is ever widened beyond this one build config.

Note that a merge to `main` now reaches production with no human in between,
and there is no staging environment. The test suite is the only gate. If that
becomes uncomfortable, the cheapest change is to trigger on a tag rather than
a branch, leaving `main` merges to build but not deploy.
