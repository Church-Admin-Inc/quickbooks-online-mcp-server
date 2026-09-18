# Deploying to Cloud Run (issue #13)

The streamable-HTTP server (`npm run start:http`) deploys to Cloud Run,
backed by Firestore in native mode for grants and the audit log, with Cloud
Scheduler driving the maintenance job (#12). No Cloud NAT or static egress
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
  --set-env-vars="HOST=0.0.0.0,QUICKBOOKS_ENVIRONMENT=sandbox" \
  --set-secrets="QUICKBOOKS_CLIENT_ID=QUICKBOOKS_CLIENT_ID:latest,QUICKBOOKS_CLIENT_SECRET=QUICKBOOKS_CLIENT_SECRET:latest"
```

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

## Scheduled grant maintenance (issue #12)

Two Cloud Run Jobs run the same image with `daily`/`weekly` as the command
argument, invoked by Cloud Scheduler over the Cloud Run Admin API (Jobs have
no public HTTP endpoint of their own):

```
gcloud run jobs create qbo-grant-maintenance-<daily|weekly> \
  --project=<PROJECT_ID> --region=<REGION> \
  --image=<REGION>-docker.pkg.dev/<PROJECT_ID>/qbo-mcp-server/qbo-mcp-server:latest \
  --service-account=qbo-mcp-server@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars="QUICKBOOKS_ENVIRONMENT=sandbox" \
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
