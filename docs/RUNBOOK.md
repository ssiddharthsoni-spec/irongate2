# Iron Gate -- Admin Operations Runbook

> **Product:** Iron Gate -- AI Data Protection (Browser Extension + API + Dashboard)
> **API Base URL:** `https://irongate-api.onrender.com`
> **Dashboard:** `https://irongate-dashboard.vercel.app`
> **Last updated:** 2026-02-26

---

## Table of Contents

1. [Emergency Kill Switch](#1-emergency-kill-switch)
2. [Admin Key Rotation](#2-admin-key-rotation)
3. [Database Backup & Restore](#3-database-backup--restore)
4. [Incident Response Checklist](#4-incident-response-checklist)
5. [Health Check & Monitoring](#5-health-check--monitoring)
6. [Common Operational Tasks](#6-common-operational-tasks)

---

## 1. Emergency Kill Switch

The kill switch immediately halts all data processing by the Iron Gate extension for all users (global) or a specific firm. It is protected by **dual admin key authentication** with constant-time comparison to prevent timing attacks.

**Rate Limit:** 5 requests/minute per IP on the kill switch endpoint.

### Required Headers

| Header | Description |
|---|---|
| `X-Admin-Key-1` | Must match `ADMIN_KEY_1` env var on the server |
| `X-Admin-Key-2` | Must match `ADMIN_KEY_2` env var on the server |

Both keys are required for every kill switch request. If either is missing or incorrect, the request is rejected (401/403).

### Activate -- Global Kill Switch

Stops all data processing across every firm and user.

```bash
curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "X-Admin-Key-1: $ADMIN_KEY_1" \
  -H "X-Admin-Key-2: $ADMIN_KEY_2" \
  -d '{"enabled": true, "scope": "global"}'
```

**Expected response (200):**

```json
{
  "status": "activated",
  "scope": "global",
  "activated_at": "2026-02-26T12:00:00.000Z"
}
```

### Activate -- Firm-Scoped Kill Switch

Stops processing for a single firm only. Other firms continue operating normally.

```bash
curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "X-Admin-Key-1: $ADMIN_KEY_1" \
  -H "X-Admin-Key-2: $ADMIN_KEY_2" \
  -d '{"enabled": true, "scope": "firm", "firm_id": "6a3de5b8-2ad3-4d94-9171-c02951e09e4e"}'
```

### Deactivate Kill Switch

To resume normal operations, set `enabled: false`. The in-memory state is removed and the `kill_switch` DB table is updated.

```bash
# Deactivate global
curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "X-Admin-Key-1: $ADMIN_KEY_1" \
  -H "X-Admin-Key-2: $ADMIN_KEY_2" \
  -d '{"enabled": false, "scope": "global"}'

# Deactivate firm-scoped
curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "X-Admin-Key-1: $ADMIN_KEY_1" \
  -H "X-Admin-Key-2: $ADMIN_KEY_2" \
  -d '{"enabled": false, "scope": "firm", "firm_id": "6a3de5b8-2ad3-4d94-9171-c02951e09e4e"}'
```

### Kill Switch Fallback

If the API is unreachable, you can activate the kill switch via environment variable:

```bash
# On the hosting platform (Render), set:
KILL_SWITCH=true
```

This is evaluated as a fallback when neither an in-memory global nor firm-scoped switch is active. Set it to `true` or `1` to activate, remove or set to any other value to deactivate.

### How Extensions Detect the Kill Switch

Extensions poll `GET /v1/security/extension/status` (authenticated). The response includes `"kill_switch": true|false`. When `true`, the extension stops intercepting prompts.

---

## 2. Admin Key Rotation

`ADMIN_KEY_1` and `ADMIN_KEY_2` are the dual keys protecting the kill switch. Rotate them periodically or immediately if a compromise is suspected.

### Zero-Downtime Rotation Procedure

Since both keys are checked on every request, you must rotate one at a time to avoid locking yourself out.

**Step 1: Generate new keys**

```bash
# Generate two cryptographically strong keys
NEW_KEY_1=$(openssl rand -hex 32)
NEW_KEY_2=$(openssl rand -hex 32)
echo "New ADMIN_KEY_1: $NEW_KEY_1"
echo "New ADMIN_KEY_2: $NEW_KEY_2"
```

**Step 2: Rotate ADMIN_KEY_1 first**

1. Update `ADMIN_KEY_1` in your hosting environment (Render dashboard > Environment):
   ```
   ADMIN_KEY_1=<new-value-from-step-1>
   ```
2. Wait for the service to redeploy (Render auto-redeploys on env var changes).
3. Verify the kill switch endpoint still works using the **new** `ADMIN_KEY_1` and the **old** `ADMIN_KEY_2`:
   ```bash
   curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CLERK_JWT" \
     -H "X-Admin-Key-1: $NEW_KEY_1" \
     -H "X-Admin-Key-2: $OLD_KEY_2" \
     -d '{"enabled": false, "scope": "global"}'
   ```
   Expect `200` with `"status": "deactivated"`.

**Step 3: Rotate ADMIN_KEY_2**

1. Update `ADMIN_KEY_2` in your hosting environment:
   ```
   ADMIN_KEY_2=<new-value-from-step-1>
   ```
2. Wait for redeploy.
3. Verify with both new keys:
   ```bash
   curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CLERK_JWT" \
     -H "X-Admin-Key-1: $NEW_KEY_1" \
     -H "X-Admin-Key-2: $NEW_KEY_2" \
     -d '{"enabled": false, "scope": "global"}'
   ```

**Step 4: Record the new keys**

Store both keys in your team's secrets manager (1Password, HashiCorp Vault, etc.). Delete the old values from all local records.

### If You Get Locked Out

If both keys are lost or mis-set, the kill switch endpoint returns `500` ("Kill switch admin keys are not configured on the server") or `403` ("Invalid admin keys"). Fix by setting the correct values in the hosting environment and redeploying.

---

## 3. Database Backup & Restore

Iron Gate uses Supabase (PostgreSQL) as its primary database.

### Automated Backups (Supabase)

- **Supabase Pro plan** includes daily automated backups and **Point-in-Time Recovery (PITR)**.
- PITR allows restoring the database to any second within the retention window.
- Access via: Supabase Dashboard > Project Settings > Database > Backups.

### Manual Backup (Ad-Hoc)

Use the included backup script before running migrations or making destructive changes.

**Prerequisites:** `pg_dump`, `gzip`, `DATABASE_URL` environment variable.

```bash
# Run from the repository root
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-us-west-2.pooler.supabase.com:6543/postgres" \
  ./scripts/db-backup.sh
```

The script:
1. Creates a `backups/` directory if it does not exist (configurable via `BACKUP_DIR`).
2. Runs `pg_dump` with `--no-owner --no-privileges` and compresses with gzip.
3. Outputs a timestamped file: `backups/irongate_backup_YYYYMMDD_HHMMSS.sql.gz`.

**Custom output directory:**

```bash
BACKUP_DIR=/mnt/secure-backups DATABASE_URL="..." ./scripts/db-backup.sh
```

### Restore from Backup

```bash
# Decompress and pipe into psql
gunzip -c backups/irongate_backup_20260226_120000.sql.gz | psql "$DATABASE_URL"
```

**WARNING:** This restores on top of the existing database. For a clean restore:

```bash
# 1. Drop and recreate the database (DESTRUCTIVE)
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2. Restore
gunzip -c backups/irongate_backup_20260226_120000.sql.gz | psql "$DATABASE_URL"

# 3. Run migrations to ensure schema is current
cd apps/api && npx drizzle-kit push
```

### Restore via Supabase PITR

1. Go to Supabase Dashboard > Project > Database > Backups > Point in Time Recovery.
2. Select the target timestamp.
3. Confirm the restore. This replaces the current database state.
4. Verify: `curl https://irongate-api.onrender.com/health?deep=true` should show `"database": "connected"`.

---

## 4. Incident Response Checklist

### 4A. Data Breach Suspected

| Step | Action |
|---|---|
| 1 | **Activate global kill switch** immediately (see Section 1). This halts all data interception by the extension. |
| 2 | **Identify scope** -- which firms/users are affected? Check audit logs: `GET /v1/audit`. |
| 3 | **Rotate compromised credentials** -- `IRON_GATE_MASTER_SECRET`, firm encryption salts (`POST /v1/security/firm/rotate-keys`), admin keys, Clerk keys as needed. |
| 4 | **Snapshot the database** -- run `./scripts/db-backup.sh` before any forensic changes. |
| 5 | **Review events table** -- look for anomalous event volume or unexpected source IPs. |
| 6 | **Notify affected firms** -- use the notifications endpoint or direct email. |
| 7 | **Engage legal/compliance** -- document the timeline and affected data categories. |
| 8 | **Deactivate kill switch** only after the root cause is identified and mitigated. |

### 4B. API Down / Unreachable

| Step | Action |
|---|---|
| 1 | **Check health endpoint:** `curl https://irongate-api.onrender.com/health` |
| 2 | **Check deep health:** `curl https://irongate-api.onrender.com/health?deep=true` -- if `"database": "disconnected"`, the issue is DB connectivity. |
| 3 | **Check Render dashboard** for deploy failures, resource exhaustion, or region outages. |
| 4 | **Check Supabase status** at [status.supabase.com](https://status.supabase.com) for DB outages. |
| 5 | **Check Sentry** for unhandled exceptions that might be crashing the server. |
| 6 | **Review metrics:** `curl https://irongate-api.onrender.com/health/metrics` -- look for high error rates or latency spikes. |
| 7 | **Restart the service** via Render dashboard if the process is stuck. |
| 8 | **Verify DNS and TLS** -- ensure the domain is resolving and the certificate is valid. |

### 4C. Extension Malfunction

| Step | Action |
|---|---|
| 1 | **Check extension status endpoint:** authenticate and call `GET /v1/security/extension/status`. Verify `"active": true` and `"kill_switch": false`. |
| 2 | **Check the Chrome Web Store** for any review/suspension notices. |
| 3 | **Reproduce locally** -- load the unpacked extension from `apps/extension/dist/` in Chrome. Open DevTools > Console for errors. |
| 4 | **Verify CORS** -- if the extension cannot reach the API, check that `CHROME_EXTENSION_ID` or `ALLOWED_EXTENSION_IDS` matches the installed extension ID. |
| 5 | **Check content script injection** -- visit a monitored AI tool site. The content script should inject at `document_start` (MAIN world) and `document_idle`. |
| 6 | **If blocking users:** activate a firm-scoped kill switch for the affected firm while debugging, so the extension enters passthrough mode. |
| 7 | **Hot-fix path:** update the extension, rebuild (`cd apps/extension && npm run build`), repackage, and submit to Chrome Web Store or distribute the `.zip` for side-loading. |

### 4D. Billing Issues

| Step | Action |
|---|---|
| 1 | **Check Stripe dashboard** for failed payments, disputed charges, or webhook delivery failures. |
| 2 | **Verify webhook secret:** ensure `STRIPE_WEBHOOK_SECRET` env var matches the signing secret in Stripe Dashboard > Webhooks. |
| 3 | **Check API logs** for errors on `POST /v1/webhooks/stripe`. This route is unauthenticated but verified via Stripe signature. |
| 4 | **Retry failed webhooks** from Stripe Dashboard > Webhooks > select endpoint > Attempted Webhooks. |
| 5 | **Manual override:** if a firm's subscription state is stale, update the firm record in Supabase directly via the SQL editor. |

---

## 5. Health Check & Monitoring

### Endpoints

All health endpoints are **unauthenticated** and safe to call from external monitoring.

#### `GET /health` -- Basic Health

Returns server status and version. No database check.

```bash
curl https://irongate-api.onrender.com/health
```

```json
{
  "status": "ok",
  "version": "0.3.0",
  "timestamp": "2026-02-26T12:00:00.000Z"
}
```

| `status` value | Meaning |
|---|---|
| `ok` | Server is running and healthy |
| `degraded` | Server is running but a subsystem (e.g., database) is failing |

#### `GET /health?deep=true` -- Deep Health (includes DB check)

Runs `SELECT 1` against the database and reports connectivity.

```bash
curl "https://irongate-api.onrender.com/health?deep=true"
```

```json
{
  "status": "ok",
  "version": "0.3.0",
  "timestamp": "2026-02-26T12:00:00.000Z",
  "database": "connected"
}
```

If the database is unreachable:

```json
{
  "status": "degraded",
  "version": "0.3.0",
  "timestamp": "2026-02-26T12:00:00.000Z",
  "database": "disconnected",
  "dbError": "connection refused"
}
```

**Use this for uptime monitors** (e.g., UptimeRobot, Pingdom). Alert when `status` is not `ok` or `database` is not `connected`.

#### `GET /v1/health` -- Extension Health

A mirror of the basic health check mounted under `/v1` so the extension can verify connectivity without authentication.

```bash
curl https://irongate-api.onrender.com/v1/health
```

#### `GET /health/metrics` -- Operational Metrics

Returns in-memory request/error/latency metrics since the last server restart.

```bash
curl https://irongate-api.onrender.com/health/metrics
```

```json
{
  "uptimeMs": 86400000,
  "totalRequests": 15230,
  "totalErrors": 12,
  "errorRate": 0.0008,
  "latency": {
    "p50": 23,
    "p95": 142,
    "p99": 380
  },
  "routes": {
    "/v1/events": { "count": 8200, "errors": 3, "avgLatencyMs": 45 },
    "/v1/dashboard/stats": { "count": 520, "errors": 0, "avgLatencyMs": 120 }
  }
}
```

**Key metrics to monitor:**

| Metric | Healthy Threshold | Action if exceeded |
|---|---|---|
| `errorRate` | < 0.01 (1%) | Investigate Sentry, check recent deploys |
| `latency.p95` | < 500ms | Check DB query performance, connection pool |
| `latency.p99` | < 2000ms | Check for slow queries, resource contention |
| `totalErrors` (increasing rapidly) | Depends on traffic | Check logs for repeating error patterns |

### Recommended Monitoring Setup

- **Uptime monitor:** Poll `GET /health?deep=true` every 60 seconds. Alert on non-200 or `status != "ok"`.
- **Metrics dashboard:** Poll `GET /health/metrics` every 5 minutes. Graph error rate and p95 latency.
- **Error tracking:** Sentry is configured when `SENTRY_DSN` is set. Check Sentry for unhandled exceptions.
- **Log monitoring:** Render provides log streaming. Filter for `ERROR` and `FATAL` log levels.

---

## 6. Common Operational Tasks

### 6A. Rotate Clerk Authentication Keys

Clerk keys (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`) authenticate all user/JWT operations.

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) > API Keys.
2. Roll the secret key. Clerk supports key rolling with a grace period.
3. Update `CLERK_SECRET_KEY` in the API hosting environment (Render).
4. Update `CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the dashboard hosting environment (Vercel).
5. Wait for both services to redeploy.
6. Verify: sign in to the dashboard and confirm authenticated API calls succeed.

```bash
# Quick verification -- this should return 401 (proving auth middleware is active)
curl -s -o /dev/null -w "%{http_code}" https://irongate-api.onrender.com/v1/events
# Expected: 401
```

### 6B. Update Extension ID in CORS

When publishing a new extension or changing Chrome Web Store listings, the extension ID changes. The API must allow CORS requests from the new ID.

1. Find the new extension ID: `chrome://extensions` > Iron Gate > copy the ID string.
2. Update environment variables on the API host (Render):
   ```
   CHROME_EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456
   ```
   For multiple extension IDs (e.g., production + beta):
   ```
   ALLOWED_EXTENSION_IDS=abcdefghijklmnop,qrstuvwxyz123456
   ```
   The API parses `ALLOWED_EXTENSION_IDS` as a comma-separated list. It falls back to `CHROME_EXTENSION_ID` if the former is not set.
3. Wait for the API to redeploy.
4. Verify by opening the extension on an AI tool site and checking that API calls do not fail with CORS errors.

**How CORS works internally:** The API checks if the `Origin` header starts with `chrome-extension://`, extracts the ID, and checks it against the allowed list. If no IDs are configured, all extension origins are rejected.

### 6C. Add a New AI Tool Host Permission

To monitor a new AI tool (e.g., `https://newai.example.com`), you need to update three places:

**1. Extension manifest** (`apps/extension/manifest.json`):

Add to `host_permissions`:
```json
"host_permissions": [
  "https://chatgpt.com/*",
  ...
  "https://newai.example.com/*"
]
```

Add to both `content_scripts[].matches` arrays (MAIN world and default world):
```json
"content_scripts": [
  {
    "matches": [
      ...
      "https://newai.example.com/*"
    ],
    "js": ["src/content/main-world.ts"],
    "run_at": "document_start",
    "world": "MAIN"
  },
  {
    "matches": [
      ...
      "https://newai.example.com/*"
    ],
    "js": ["src/content/index.ts"],
    "run_at": "document_idle"
  }
]
```

**2. Default monitored domains** (`apps/api/src/routes/security.ts`):

Add the domain to the `monitoredDomains` fallback list in the `/extension/status` handler:
```typescript
let monitoredDomains: string[] = [
  'chat.openai.com',
  ...
  'newai.example.com',
];
```

**3. Rebuild and publish:**

```bash
cd apps/extension
npm run build
# Package the dist/ folder and upload to Chrome Web Store
# or distribute the .zip for enterprise side-loading
```

**Note:** Adding a new host permission triggers a Chrome permission re-prompt for existing users. Plan the rollout accordingly.

### 6D. Rotate IRON_GATE_MASTER_SECRET

The master secret derives per-firm AES-256-GCM encryption keys for pseudonym storage. Rotating it invalidates all existing pseudonym mappings.

1. **Take a database backup** first: `./scripts/db-backup.sh`
2. Generate a new secret (minimum 16 characters):
   ```bash
   openssl rand -hex 32
   ```
3. Update `IRON_GATE_MASTER_SECRET` in the API hosting environment.
4. After redeploy, existing pseudonym mappings will fail to decrypt. You must re-encrypt them or clear and regenerate.
5. For each affected firm, trigger key rotation via the API:
   ```bash
   curl -X POST https://irongate-api.onrender.com/v1/security/firm/rotate-keys \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CLERK_JWT" \
     -d '{"confirm": true}'
   ```

**WARNING:** This is a destructive operation. Coordinate with affected firms before proceeding.

### 6E. View Firm Security Posture

Check a firm's encryption status, key rotation history, and kill switch state:

```bash
curl https://irongate-api.onrender.com/v1/security/firm/security-status \
  -H "Authorization: Bearer $CLERK_JWT"
```

```json
{
  "encryption": "active",
  "rls": "enabled",
  "public_key_uploaded": true,
  "retention_days": 90,
  "last_key_rotation": "2026-01-15T08:30:00.000Z",
  "kill_switch": false
}
```

### 6F. Schedule Firm Data Deletion

To delete all data for a firm (24-hour grace period):

```bash
curl -X DELETE https://irongate-api.onrender.com/v1/security/firm/data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{"confirm": true, "reason": "Client offboarding per request #12345"}'
```

Tables affected: `events`, `pseudonym_maps`, `feedback`, `entity_co_occurrences`, `inferred_entities`, `sensitivity_patterns`, `client_matters`, `weight_overrides`, `firm_plugins`, `webhook_subscriptions`.

---

## Quick Reference: Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` or `SUPABASE_DB_URL` | Yes (one of) | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Yes (prod) | Clerk JWT verification |
| `IRON_GATE_MASTER_SECRET` | Recommended | Pseudonym encryption key derivation |
| `ADMIN_KEY_1` | Recommended | Kill switch auth (key 1 of 2) |
| `ADMIN_KEY_2` | Recommended | Kill switch auth (key 2 of 2) |
| `CHROME_EXTENSION_ID` | Recommended | CORS allowlist for extension |
| `ALLOWED_EXTENSION_IDS` | Optional | Comma-separated list of extension IDs |
| `DASHBOARD_URL` | Optional | CORS allowlist for dashboard |
| `REDIS_URL` | Optional | Distributed rate limiting (falls back to in-memory) |
| `STRIPE_SECRET_KEY` | Optional | Billing (mock mode if unset) |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook signature verification |
| `SENTRY_DSN` | Optional | Error tracking |
| `RESEND_API_KEY` | Optional | Email notifications (console fallback) |
| `DETECTION_SERVICE_URL` | Optional | Python gRPC detection service |
| `KILL_SWITCH` | Optional | Env-level kill switch fallback (`true`/`1`) |
| `LOG_LEVEL` | Optional | `debug`, `info`, `warn`, `error` (default: `info`) |
| `PORT` | Optional | Server port (default: `3000`) |
