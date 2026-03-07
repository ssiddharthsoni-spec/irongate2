# Iron Gate Incident Response Plan

**Version:** 1.0
**Classification:** Confidential — Internal Use Only
**Last Updated:** March 2026
**Plan Owner:** [CISO / Security Lead]

---

## 1. Purpose

This document defines how Iron Gate detects, responds to, and recovers from security incidents affecting client data or platform availability.

---

## 2. Severity Classification

### SEV-1: Critical
- Confirmed data breach (client data exposed to unauthorized parties)
- Encryption key compromise (IRON_GATE_ENCRYPTION_SECRET or IRON_GATE_SIGNING_SECRET)
- Kill switch failure (unable to halt monitoring when required)
- Database compromise (unauthorized access to production PostgreSQL)

**Response time:** 15 minutes
**Notification:** All stakeholders immediately

### SEV-2: High
- Attempted data breach (blocked but detected)
- Authentication bypass (Clerk or API key vulnerability)
- RLS policy circumvention (detected via audit)
- Unauthorized admin access attempt
- Redis compromise (JWT revocation affected)

**Response time:** 1 hour
**Notification:** Security team + affected clients within 4 hours

### SEV-3: Medium
- Anomalous API traffic patterns (potential probing)
- Failed kill switch activations (authentication failures)
- Extension network guard violations
- Certificate transparency violations
- Elevated error rates in production

**Response time:** 4 hours
**Notification:** Security team within 24 hours

### SEV-4: Low
- Individual failed authentication attempts
- Rate limit triggers
- Non-exploitable vulnerability discovered
- Configuration drift detected

**Response time:** Next business day
**Notification:** Logged for weekly review

---

## 3. Incident Response Team

| Role | Responsibility | Contact |
|---|---|---|
| **Incident Commander** | Coordinates response, makes decisions | [Name, Phone, Email] |
| **Security Lead** | Technical investigation, containment | [Name, Phone, Email] |
| **Engineering Lead** | Code-level fixes, deployment | [Name, Phone, Email] |
| **Communications Lead** | Client notification, public statements | [Name, Phone, Email] |
| **Legal Counsel** | Regulatory obligations, breach notification | [Name, Phone, Email] |

---

## 4. Detection

### Automated Detection
- **Sentry alerts:** Unhandled exceptions, elevated error rates
- **Audit chain verification:** Scheduled integrity checks detect tampering
- **Kill switch monitoring:** Extension polls every 60 seconds; unreachable = fail-safe
- **Rate limiting:** Anomalous traffic triggers automatic throttling
- **JWT revocation checks:** Fail-closed in production when Redis unavailable
- **Network guard:** Blocked outbound requests logged as security anomalies
- **Response integrity:** Missing security headers trigger anomaly reports

### Manual Detection
- Security team reviews audit logs weekly
- Penetration test findings (when conducted)
- Client-reported anomalies
- Vendor security advisories (Supabase, Render, Clerk)

---

## 5. Response Procedures

### 5.1 Immediate Containment (First 15 Minutes)

**Step 1: Activate kill switch (if data is actively leaking)**
```bash
curl -X POST https://irongate-api.onrender.com/v1/security/kill-switch \
  -H "X-Admin-Key-1: $ADMIN_KEY_1" \
  -H "X-Admin-Key-2: $ADMIN_KEY_2" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "scope": "global"}'
```

**Step 2: Revoke compromised credentials**
- Rotate API keys via dashboard
- Revoke active JWT sessions via logout endpoint
- Rotate Clerk signing keys if JWT compromise suspected

**Step 3: Preserve evidence**
- Export audit chain: `GET /v1/audit/export?firmId=<id>`
- Verify chain integrity: `GET /v1/audit/verify?firmId=<id>`
- Capture Render deployment logs
- Capture Supabase query logs

### 5.2 Investigation (1-4 Hours)

1. **Identify scope:** Which firms affected? Which data elements?
2. **Determine root cause:** Code vulnerability, credential compromise, vendor breach?
3. **Verify audit chain integrity:** Run chain verification for affected firms
4. **Check RLS effectiveness:** Were RLS policies active during the incident?
5. **Review access logs:** Who accessed what, when?

### 5.3 Remediation

| Scenario | Action |
|---|---|
| **Encryption key compromised** | Rotate IRON_GATE_ENCRYPTION_SECRET and IRON_GATE_SIGNING_SECRET. Re-encrypt all pseudonym maps. Re-sign audit chain (append notation, don't modify). |
| **Database access compromised** | Rotate database credentials. Review RLS policy effectiveness. Rotate all firm encryption salts. |
| **API key leaked** | Revoke affected key. Generate new key. Notify client. |
| **Clerk breach** | Rotate Clerk signing keys. Force re-authentication for all users. |
| **Extension compromised** | Push emergency update via Chrome Web Store. Activate global kill switch until verified. |

### 5.4 Recovery

1. Verify containment is effective (no ongoing unauthorized access)
2. Deploy fixes to staging first, verify with smoke tests
3. Deploy to production
4. Deactivate kill switch (if activated)
5. Monitor for 48 hours for recurrence

---

## 6. Client Notification

### Notification Timeline

| Severity | Internal | Client | Regulatory |
|---|---|---|---|
| SEV-1 | Immediate | Within 24 hours | Per DPA (typically 72 hours for GDPR) |
| SEV-2 | Within 1 hour | Within 48 hours | If required by DPA |
| SEV-3 | Within 4 hours | Weekly summary | Not required |
| SEV-4 | Next business day | Not required | Not required |

### Notification Content

Client breach notifications must include:
1. Date and time of discovery
2. Nature of the incident
3. Data elements potentially affected
4. Actions taken to contain the incident
5. Steps the client should take
6. Point of contact for questions

---

## 7. Post-Incident

### Post-Mortem (Within 5 Business Days)

Every SEV-1 and SEV-2 incident requires a written post-mortem containing:
1. Timeline of events
2. Root cause analysis
3. Impact assessment
4. Actions taken during response
5. Lessons learned
6. Preventive measures to implement

### Metrics

Track and report quarterly:
- Mean time to detect (MTTD)
- Mean time to respond (MTTR)
- Mean time to resolve
- Number of incidents by severity
- Number of client notifications sent

---

## 8. Testing

### Tabletop Exercises
- Quarterly simulated incident scenarios
- Rotate through SEV-1 through SEV-3 scenarios
- Include all response team members

### Kill Switch Testing
- Monthly kill switch activation/deactivation test on staging
- Verify extension fail-safe behavior quarterly

### Audit Chain Verification
- Automated daily chain integrity verification for all active firms
- Manual verification after any database maintenance

---

## 9. Regulatory Reference

| Regulation | Breach Notification Requirement |
|---|---|
| GDPR (EU) | 72 hours to supervisory authority |
| CCPA (California) | "Most expedient time possible" |
| HIPAA (US Healthcare) | 60 days to HHS, individuals, media (if >500) |
| SOC 2 | Report to auditor in next assessment period |
| State laws (varies) | Typically 30-60 days |

---

## 10. Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | March 2026 | [Author] | Initial version |
