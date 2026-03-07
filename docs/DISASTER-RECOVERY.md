# Disaster Recovery Runbook

**Owner:** Engineering Team
**Last Updated:** 2026-03-06
**Review Cadence:** Quarterly (or after any incident)

---

## 1. RTO / RPO Targets

| Metric | Target | Mechanism |
|--------|--------|-----------|
| **RPO** (Recovery Point Objective) | 1 hour | Supabase point-in-time recovery via WAL archiving |
| **RTO** (Recovery Time Objective) | 4 hours | Full service restoration across all components |

These targets apply to a full-site disaster. Partial outages (single service) should resolve faster since unaffected components remain online.

---

## 2. Infrastructure Components

| Component | Provider | Role | Recovery Model |
|-----------|----------|------|----------------|
| PostgreSQL Database | Supabase | Primary data store (events, pseudonym maps, firms, audit logs) | Managed backups + WAL PITR |
| API Server | Render | Hono API, LLM proxy, webhook dispatcher | Auto-deploy from GitHub `main` branch |
| Dashboard | Vercel | Next.js admin dashboard | Auto-deploy from GitHub `main` branch |
| Authentication | Clerk | User/org authentication (external SaaS) | Managed by Clerk; no self-hosted state |
| Billing | Stripe | Subscription and payment processing (external SaaS) | Managed by Stripe; no self-hosted state |
| Browser Extension | Chrome Web Store | End-user PII detection and interception | Distributed via Chrome Web Store |
| VS Code Extension | VS Code Marketplace | IDE-level PII detection | Distributed via marketplace |

---

## 3. Backup Strategy

### 3.1 Database

- **Automated daily backups** managed by Supabase with **30-day retention**.
- **Point-in-time recovery (PITR)** available via WAL archiving, enabling restoration to any point within the retention window (RPO: 1 hour).
- Backups are stored in Supabase's managed infrastructure (encrypted at rest).

### 3.2 Application Code

- All source code is stored in **GitHub** (distributed Git -- multiple developer clones exist).
- Deployment is automated: pushes to `main` trigger builds on Render (API) and Vercel (Dashboard).
- Tagged releases correspond to Chrome Web Store and VS Code Marketplace submissions.

### 3.3 Browser Extension

- Published builds are distributed through the **Chrome Web Store**.
- Source code and build pipeline live in the monorepo under `apps/extension/`.
- A new build can be submitted from any developer machine with store credentials.

### 3.4 Secrets and Environment Variables

- **Render** and **Vercel** each store their own environment variables (API keys, database URLs, signing keys, etc.).
- All secrets MUST be independently documented in the team **password manager** (1Password / Bitwarden vault).
- Rotate secrets after any suspected compromise -- see Section 4.5.

---

## 4. Restoration Procedures

### 4.1 Database Restoration (Supabase)

1. Log in to the [Supabase Dashboard](https://app.supabase.com).
2. Navigate to the affected project > **Settings > Backups**.
3. For daily backup restore: select the most recent backup and click **Restore**.
4. For point-in-time recovery: select **Point-in-Time Recovery**, choose the target timestamp (within WAL retention window), and confirm.
5. Wait for the restore operation to complete (typically 10-30 minutes depending on database size).
6. Verify connectivity from the API by checking the `/health` endpoint.
7. Run a spot-check query to confirm data integrity:
   ```sql
   SELECT COUNT(*) FROM events;
   SELECT COUNT(*) FROM firms;
   SELECT id, created_at FROM events ORDER BY created_at DESC LIMIT 5;
   ```

### 4.2 API Service Restoration (Render)

1. Log in to the [Render Dashboard](https://dashboard.render.com).
2. Navigate to the Iron Gate API service.
3. If the service is down but the deploy is intact: click **Manual Deploy > Deploy latest commit**.
4. If the service or configuration was deleted:
   a. Create a new Web Service pointing to the GitHub repo, branch `main`, root directory `apps/api`.
   b. Set the build command: `pnpm install && pnpm build`
   c. Set the start command: `node dist/index.js`
   d. Re-enter all environment variables from the password manager.
   e. Update DNS records if the service URL has changed.
5. Verify the API is responding: `curl https://<api-domain>/health`

### 4.3 Dashboard Restoration (Vercel)

1. Log in to the [Vercel Dashboard](https://vercel.com).
2. Navigate to the Iron Gate Dashboard project.
3. If the deployment is failing: check build logs, fix the issue, and redeploy.
4. If the project was deleted:
   a. Import the GitHub repo, set the root directory to `apps/dashboard`.
   b. Re-enter all environment variables from the password manager (Clerk keys, API URL, etc.).
   c. Update DNS/domain settings in Vercel and your registrar.
5. Verify the dashboard loads and Clerk authentication works.

### 4.4 DNS / Domain Recovery

1. Log in to the domain registrar.
2. Verify A/CNAME records point to the correct Render and Vercel endpoints.
3. If records were tampered with, restore from the documented DNS configuration in the password manager.
4. Allow up to 1 hour for DNS propagation (TTL-dependent).

### 4.5 Secret Rotation (Post-Incident)

If a breach or compromise is suspected, rotate the following in order:

1. Supabase database password and connection string.
2. Clerk API keys (revoke old keys in Clerk dashboard).
3. Stripe API keys (revoke old keys in Stripe dashboard).
4. `SIGNING_KEY` and `AES_KEY` used by the API.
5. Update all environment variables in Render and Vercel.
6. Redeploy API and Dashboard.
7. Update the password manager with new values.

---

## 5. Monthly Restore Test Procedure

Perform this test on the **first Tuesday of each month**. Document results for SOC 2 evidence.

### Steps

1. **Create a test Supabase project.**
   - Log in to Supabase and create a new project in a non-production organization (or use an existing test project).

2. **Restore the latest backup to the test project.**
   - Download the latest production backup or use Supabase migration tooling to replicate the schema and data.
   - Alternatively, use `pg_dump` / `pg_restore` against the production read-replica (if available) to populate the test project.

3. **Verify table counts match production.**
   ```sql
   -- Run against both production and test, compare results
   SELECT 'events' AS tbl, COUNT(*) FROM events
   UNION ALL
   SELECT 'firms', COUNT(*) FROM firms
   UNION ALL
   SELECT 'pseudonym_maps', COUNT(*) FROM pseudonym_maps
   UNION ALL
   SELECT 'audit_logs', COUNT(*) FROM audit_logs;
   ```

4. **Verify a sample of event records.**
   - Pick 5 recent event IDs from production.
   - Confirm the same records exist in the restored database with identical field values.

5. **Verify encryption/decryption works with a test firm.**
   - Point a local API instance at the test database.
   - Send a test event containing PII through the proxy pipeline.
   - Confirm pseudonymization and de-pseudonymization produce correct results.
   - Verify AES-GCM encryption/decryption round-trips successfully.

6. **Document results in the SOC 2 evidence log.**
   - Record: date, tester name, backup timestamp used, table count comparison (pass/fail), sample record check (pass/fail), encryption test (pass/fail).
   - File the entry in the shared compliance folder.

7. **Tear down the test project.**
   - Delete or pause the test Supabase project to avoid unnecessary costs.

---

## 6. Communication Plan

### 6.1 Severity Levels

| Severity | Definition | Example |
|----------|-----------|---------|
| **P1 - Critical** | Complete service outage or data breach | Database down, API unreachable, data exfiltration |
| **P2 - Major** | Significant degradation affecting multiple customers | Dashboard inaccessible, extension proxy failures |
| **P3 - Minor** | Limited impact, workaround available | Single-tenant issue, non-critical feature broken |

### 6.2 Internal Communication

- **Primary channel:** Slack `#incidents`
- Post an incident summary within **15 minutes** of detection.
- Update the channel every **30 minutes** until resolution.
- Post a final summary and link to the post-mortem within **24 hours**.

### 6.3 External Communication

| Action | Trigger | Owner | Timeline |
|--------|---------|-------|----------|
| Status page update | P1 or P2 incident confirmed | On-call engineer | Within 30 minutes |
| Customer email notification | P1 or P2 affecting active customers | Customer Success | Within 2 hours |
| Status page resolution update | Incident resolved | On-call engineer | Immediately on resolution |
| Post-mortem shared with affected customers | P1 incidents | Engineering Lead | Within 5 business days |

### 6.4 Regulatory Notification

| Regulation | Requirement | Deadline |
|------------|-------------|----------|
| **GDPR** (Art. 33) | Notify supervisory authority of personal data breach | **72 hours** from awareness |
| **GDPR** (Art. 34) | Notify affected data subjects if high risk | Without undue delay |
| **HIPAA** (Breach Notification Rule) | Notify HHS and affected individuals | **60 days** from discovery |
| **State breach laws** | Varies by jurisdiction | Check applicable state requirements |

---

## 7. Contact Matrix

> **Action required:** Fill in actual names, emails, and phone numbers. Store sensitive contact details in the password manager and reference them here.

| Role | Name | Email | Phone | Escalation Order |
|------|------|-------|-------|------------------|
| **Incident Commander** | _TBD_ | _TBD_ | _TBD_ | 1st |
| **Engineering Lead** | _TBD_ | _TBD_ | _TBD_ | 2nd |
| **DevOps / Infrastructure** | _TBD_ | _TBD_ | _TBD_ | 2nd |
| **Customer Success Lead** | _TBD_ | _TBD_ | _TBD_ | 3rd |
| **Legal / DPO** | _TBD_ | _TBD_ | _TBD_ | As needed (breach) |
| **CEO / Executive Sponsor** | _TBD_ | _TBD_ | _TBD_ | P1 only |

### External Vendor Contacts

| Vendor | Support Channel | Account ID |
|--------|----------------|------------|
| **Supabase** | https://supabase.com/dashboard/support | _TBD_ |
| **Render** | https://render.com/support | _TBD_ |
| **Vercel** | https://vercel.com/support | _TBD_ |
| **Clerk** | https://clerk.com/support | _TBD_ |
| **Stripe** | https://support.stripe.com | _TBD_ |
| **Domain Registrar** | _TBD_ | _TBD_ |

---

## Appendix: Quick Reference Checklist

Use this during an active incident:

- [ ] Identify affected component(s)
- [ ] Post to Slack `#incidents` with initial assessment
- [ ] Assign Incident Commander
- [ ] Determine severity (P1/P2/P3)
- [ ] Update status page (P1/P2)
- [ ] Begin restoration per Section 4
- [ ] Verify service health after restoration
- [ ] Send customer communication (P1/P2)
- [ ] Assess regulatory notification obligations
- [ ] Schedule post-mortem within 48 hours
- [ ] File post-mortem and update this runbook if needed
