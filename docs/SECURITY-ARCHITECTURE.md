# Iron Gate Security Architecture

**Version:** 0.2.7
**Classification:** Confidential — For CISO / Security Review
**Last Updated:** March 2026

---

## 1. Executive Summary

Iron Gate is a data loss prevention (DLP) platform for enterprises using AI tools (ChatGPT, Claude, Gemini, Copilot). It detects, classifies, and protects sensitive information before it leaves the organization's network.

**Core security principle:** Sensitive data never leaves the client browser in its original form. Detection runs client-side; only hashes, scores, and encrypted pseudonyms reach the server.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Employee's Browser                                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Iron Gate Chrome Extension (Manifest V3)       │    │
│  │  ┌───────────┐  ┌───────────┐  ┌────────────┐  │    │
│  │  │ Content   │  │ Detection │  │ Pseudonym  │  │    │
│  │  │ Script    │  │ Engine    │  │ Engine     │  │    │
│  │  │ (observe) │  │ (classify)│  │ (replace)  │  │    │
│  │  └───────────┘  └───────────┘  └────────────┘  │    │
│  │  ┌───────────┐  ┌───────────┐  ┌────────────┐  │    │
│  │  │ Network   │  │ Kill      │  │ Audit      │  │    │
│  │  │ Guard     │  │ Switch    │  │ Trail      │  │    │
│  │  │ (restrict)│  │ (halt)    │  │ (log)      │  │    │
│  │  └───────────┘  └───────────┘  └────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│        │ Only hashes, scores, encrypted pseudonyms      │
│        ▼                                                │
│  ┌─────────────────┐                                    │
│  │ TLS 1.3 + HSTS  │                                    │
│  └────────┬────────┘                                    │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  Iron Gate API (Hono / Node.js on Render)               │
│  ┌───────────┐  ┌───────────┐  ┌────────────────────┐  │
│  │ Auth      │  │ RLS       │  │ Cryptographic      │  │
│  │ Middleware│  │ Context   │  │ Audit Chain        │  │
│  │ (Clerk)   │  │ (pg)      │  │ (HMAC-SHA256)      │  │
│  └───────────┘  └───────────┘  └────────────────────┘  │
│  ┌───────────┐  ┌───────────┐  ┌────────────────────┐  │
│  │ Rate      │  │ JWT       │  │ PII Log            │  │
│  │ Limiter   │  │ Revocation│  │ Sanitization       │  │
│  │ (Redis)   │  │ (Redis)   │  │ (regex)            │  │
│  └───────────┘  └───────────┘  └────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL (Supabase)                                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Row-Level Security on ALL 22 firm-scoped tables  │   │
│  │ AES-256-GCM encrypted pseudonym maps             │   │
│  │ AES-256-GCM encrypted webhook secrets            │   │
│  │ Hash-chained, HMAC-signed event audit trail      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Data Classification

### What Iron Gate Stores

| Data Element | Storage | Encryption | Retention |
|---|---|---|---|
| Prompt hash (SHA-256) | PostgreSQL | At rest (Supabase) | Configurable per framework |
| Sensitivity score (0-100) | PostgreSQL | At rest (Supabase) | Configurable per framework |
| Entity types detected | PostgreSQL | At rest (Supabase) | Configurable per framework |
| Pseudonym mappings | PostgreSQL | AES-256-GCM per-firm | Session-scoped, auto-expire |
| Webhook secrets | PostgreSQL | AES-256-GCM | Until deleted |
| Audit chain hashes | PostgreSQL | HMAC-SHA256 signed | Immutable, retained per policy |
| API key hashes | PostgreSQL | SHA-256 (one-way) | Until revoked |
| User email addresses | PostgreSQL | At rest (Supabase) + RLS | Account lifetime |

### What Iron Gate Does NOT Store

- Raw prompt text (only SHA-256 hash)
- Original entity values (only pseudonyms or hashes)
- User passwords (delegated to Clerk)
- Browser history or browsing data
- Screenshots or screen captures

---

## 4. Encryption Architecture

### 4.1 Key Hierarchy

```
IRON_GATE_ENCRYPTION_SECRET          IRON_GATE_SIGNING_SECRET
         │                                    │
    PBKDF2 (600K iterations)             PBKDF2 (100K iterations)
         │                                    │
    ┌────┴────────┐                     ┌─────┴─────┐
    │             │                     │           │
Per-firm AES   Webhook AES           HMAC-SHA256  (future)
encryption     encryption            signing key
key            key
    │             │                     │
Pseudonym     Webhook               Audit chain
maps          secrets               event signatures
```

**Key isolation:** Encryption and signing use completely separate secrets. Compromise of one does not affect the other.

**Per-firm keys:** Each firm gets a unique AES-256-GCM key derived from:
- The encryption secret (server-side)
- A random 128-bit salt (unique per firm, stored in DB)
- PBKDF2 with 600,000 iterations and SHA-256

### 4.2 Encryption at Rest

| Component | Algorithm | Key Length | IV Length | Auth Tag |
|---|---|---|---|---|
| Pseudonym maps | AES-256-GCM | 256-bit | 96-bit (random) | 128-bit |
| Webhook secrets | AES-256-GCM | 256-bit | 96-bit (random) | 128-bit |
| Audit signatures | HMAC-SHA256 | 256-bit | N/A | 256-bit |
| API keys | SHA-256 | N/A (one-way) | N/A | N/A |
| DB backups | AES-256 | Supabase-managed | Supabase-managed | Supabase-managed |

### 4.3 Encryption in Transit

- TLS 1.3 enforced (TLS 1.2 and below rejected at load balancer)
- HSTS with preload (max-age=31536000, includeSubDomains)
- Certificate Transparency enforced via Expect-CT header
- Cipher suites: TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256, TLS_AES_128_GCM_SHA256

---

## 5. Access Control

### 5.1 Authentication

- **Dashboard users:** Clerk-managed authentication with JWT tokens
- **Extension:** API key (SHA-256 hashed) or JWT Bearer token
- **Admin operations:** Dual admin key requirement (two separate keys, both required)
- **Kill switch:** Dual admin keys + rate limiting (5 req/min) + timing-safe comparison

### 5.2 Authorization (RBAC)

| Role | Permissions |
|---|---|
| `user` | View own events, submit prompts, provide feedback |
| `admin` | All user permissions + manage users, view dashboard, manage API keys, configure compliance |
| `owner` | All admin permissions + billing, data deletion, key rotation |

### 5.3 Row-Level Security (Database)

Every firm-scoped table (22 total) has PostgreSQL RLS enabled:

```sql
CREATE POLICY firm_isolation_<table> ON <table>
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());
```

The API sets a session-scoped variable before every query:
```sql
SELECT set_config('app.current_firm_id', '<uuid>', true);
```

Even if application code has a bug, one firm's data is unreachable from another firm's context at the database engine level.

---

## 6. Audit Trail

### 6.1 Cryptographic Chain

Every event is hash-chained using SHA-256:

```
Event N hash = SHA-256(canonical_json(event_data) + Event N-1 hash)
```

The first event in a chain uses the genesis value `'GENESIS'` as its previous hash.

### 6.2 Server Signatures

Each event is signed with HMAC-SHA256:

```
signature = HMAC-SHA256("v1:" + event_hash + ":" + timestamp, signing_key)
```

Signatures use a dedicated signing key derived from `IRON_GATE_SIGNING_SECRET`, separate from encryption keys.

### 6.3 Tamper Detection

- Chain integrity is verifiable by recomputing hashes from genesis
- Any modification to any event breaks the chain from that point forward
- HMAC signatures prove events were created by the Iron Gate server
- UNIQUE constraint on (firm_id, chain_position) prevents insertion attacks

---

## 7. Network Security

### 7.1 Extension Network Guard

The Chrome extension enforces a strict host allowlist:
- `api.irongate.ai`
- `irongate-api.onrender.com`

All outbound requests are validated against this list before being sent. Blocked requests are logged as security anomalies.

### 7.2 Content Security Policy

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'; connect-src https://irongate-api.onrender.com 'self';"
}
```

### 7.3 CORS

The API only accepts requests from:
- The registered Chrome extension ID
- The dashboard URL
- localhost (development only)

### 7.4 Response Integrity

The extension validates that API responses include expected security headers (HSTS, Expect-CT). Missing headers trigger security anomaly reports.

---

## 8. Logging & Monitoring

### 8.1 PII Sanitization

All log output is sanitized before emission. The following patterns are automatically redacted:

| Pattern | Replacement |
|---|---|
| Email addresses | `[EMAIL_REDACTED]` |
| Social Security Numbers | `[SSN_REDACTED]` |
| Credit card numbers | `[CARD_REDACTED]` |
| API keys (sk_, pk_, ig_) | `[API_KEY_REDACTED]` |
| Database connection strings | `[DB_URI_REDACTED]` |
| Redis connection strings | `[REDIS_URI_REDACTED]` |
| JWT tokens | `[JWT_REDACTED]` |

### 8.2 Sentry Error Tracking

Sentry is configured with a `beforeSend` hook that strips:
- Request bodies
- Cookies
- Authorization headers
- API key headers
- Admin key headers

No PII reaches the error tracking service.

---

## 9. Emergency Controls

### 9.1 Kill Switch

A dual-key authenticated kill switch can instantly halt all AI tool monitoring:

- **Global scope:** Stops monitoring for all firms
- **Firm scope:** Stops monitoring for a specific firm
- **Activation:** Requires both `X-Admin-Key-1` and `X-Admin-Key-2` headers
- **Rate limited:** 5 requests per minute per IP
- **Fail-safe:** Extension treats unreachable server as active kill switch

### 9.2 Key Rotation

Firm encryption salts can be rotated via `POST /v1/security/firm/rotate-keys`:
- Generates new 256-bit random salt
- Increments key version counter
- Existing encrypted data remains decryptable until re-encrypted

### 9.3 Data Deletion

`DELETE /v1/security/firm/data` schedules complete firm data deletion:
- 24-hour grace period (reversible)
- Covers all 10+ data tables
- Admin-only, requires explicit confirmation

---

## 10. Compliance Framework Support

Iron Gate supports configurable compliance profiles:
- SOC 2 Type II
- HIPAA
- GDPR
- CCPA
- Custom frameworks

Each framework defines:
- Entity detection rules (what to redact, pseudonymize, or block)
- Risk multipliers
- Auto-block thresholds
- Data retention policies
- Required controls checklist

Compliance scores are calculated from actual control verification, not hardcoded values.

---

## 11. Infrastructure

| Component | Provider | Region | Encryption |
|---|---|---|---|
| API Server | Render | US (configurable) | TLS 1.3 in transit |
| Database | Supabase (PostgreSQL) | US-West-2 | AES-256 at rest + RLS |
| Authentication | Clerk | US | SOC 2 Type II certified |
| Rate Limiting | Redis (optional) | Co-located | TLS in production |
| Error Tracking | Sentry (optional) | US | PII stripped before send |
| CI/CD | GitHub Actions | N/A | Secrets in GitHub vault |

### 11.1 Staging Environment

A dedicated staging environment (`irongate-api-staging`) runs on a separate branch with:
- Separate database instance
- Separate Clerk instance
- Separate encryption secrets
- Automated smoke tests on deploy

---

## 12. Vendor Security

| Vendor | Purpose | SOC 2 | Encryption | Data Access |
|---|---|---|---|---|
| Supabase | Database | Type II | AES-256 at rest, TLS in transit | DB connection only |
| Render | API hosting | Type II | TLS in transit | No data access |
| Clerk | Authentication | Type II | AES-256 at rest | User emails, auth tokens |
| Sentry | Error tracking | Type II | TLS in transit | Error metadata only (PII stripped) |
| Redis (Upstash) | Caching | Type II | TLS in transit | Rate limit counters, token hashes |

---

## 13. Security Controls Summary

| Control | Implementation | Status |
|---|---|---|
| Encryption at rest (pseudonyms) | AES-256-GCM, per-firm keys | Active |
| Encryption at rest (database) | Supabase AES-256 | Active |
| Encryption in transit | TLS 1.3, HSTS preload | Active |
| Row-Level Security | PostgreSQL RLS, 22 tables | Active |
| Authentication | Clerk JWT + API keys | Active |
| Authorization | RBAC (user/admin/owner) | Active |
| Audit trail | Hash-chained, HMAC-signed | Active |
| PII log sanitization | Regex-based redaction | Active |
| Rate limiting | Redis + in-memory fallback | Active |
| Kill switch | Dual-key, rate-limited | Active |
| Key rotation | Admin-initiated, versioned | Active |
| Data deletion | Scheduled with grace period | Active |
| Input validation | Zod schemas, size limits | Active |
| CSRF protection | Middleware-enforced | Active |
| JWT revocation | Redis + local, fail-closed | Active |
| Secret separation | Encryption vs. signing | Active |
| Sentry PII stripping | beforeSend hook | Active |
| Network guard | Host allowlist | Active |
| Certificate Transparency | Expect-CT header | Active |
| Body size limits | 10 MB max | Active |
| Department policies | Per-department entity blocking | Active |
| SCIM provisioning | RFC 7644 user/group sync | Active |
| Compliance enforcement | Framework-level entity blocking | Active |
| MCP interception | Tool call/result scanning | Active |
| OCR detection | Image PII scanning (Tesseract.js) | Active |
| SIEM forwarding | Webhook + ASIM format | Active |
| Circuit breaker | Detection service resilience | Active |

---

## 14. Threat Model

### 14.1 Trust Boundaries

```
┌──────────────────────────────────────────────────┐
│ TRUST BOUNDARY 1: User's Browser                  │
│ • Extension content scripts (MAIN world)          │
│ • Extension content scripts (ISOLATED world)      │
│ • Extension service worker                         │
│ • chrome.storage.session (encrypted)              │
├──────────────────────────────────────────────────┤
│ TRUST BOUNDARY 2: Network (TLS 1.3)              │
├──────────────────────────────────────────────────┤
│ TRUST BOUNDARY 3: Iron Gate API                   │
│ • Hono middleware chain                            │
│ • Business logic layer                             │
│ • Database access layer (RLS-enforced)            │
├──────────────────────────────────────────────────┤
│ TRUST BOUNDARY 4: Database (Supabase PostgreSQL)  │
│ • Row-Level Security policies                      │
│ • Encrypted at rest                                │
└──────────────────────────────────────────────────┘
```

### 14.2 Threat Categories

| Threat | Mitigation | Residual Risk |
|---|---|---|
| Malicious browser extension competing for DOM | Content scripts run at document_start; network guard restricts outbound | Low |
| Prompt injection via AI response | De-pseudonymization only operates on known pseudonym tokens | Low |
| Man-in-the-middle | TLS 1.3, HSTS preload, certificate transparency | Very Low |
| Insider threat (rogue admin) | Dual-key kill switch, audit trail, HMAC signatures | Low |
| Database compromise | RLS isolation, AES-256-GCM encryption, per-firm keys | Low |
| Extension compromise (CWS) | CSP, network guard, managed config, MDM force-install | Medium |
| API key theft | SHA-256 hashed storage, key rotation, expiration enforcement | Low |
| Supply chain attack (npm) | Lockfile pinning, CI checks, minimal dependencies | Medium |
| Reverse map extraction | AES-256-GCM encrypted in chrome.storage.session, session-scoped keys | Low |
| SSRF via webhook URLs | URL validation, private IP blocking, timeout enforcement | Low |

### 14.3 Attack Surface

| Surface | Exposure | Controls |
|---|---|---|
| Chrome Web Store listing | Public | Code review, CSP, managed schema |
| API endpoints (28 routes) | Authenticated | JWT/API key auth, rate limiting, input validation |
| Admin endpoints (12 routes) | Admin-only | Role check, dual-key for destructive ops |
| SCIM endpoints | Bearer token | Firm-scoped token validation |
| Webhook delivery | Outbound | HMAC-SHA256 signatures, URL validation |
| Dashboard (Next.js) | Authenticated | Clerk middleware, CSP headers |

---

## 15. Penetration Testing Scope

### 15.1 In-Scope

- API authentication and authorization bypass
- Cross-firm data access (RLS bypass)
- Pseudonym map decryption without key
- Kill switch activation without dual keys
- Rate limit bypass
- Input validation bypass (XSS, SQLi, NoSQLi)
- SSRF via webhook/SIEM URLs
- Extension privilege escalation
- Reverse map extraction from browser storage
- Audit trail tampering

### 15.2 Out-of-Scope

- Supabase infrastructure (covered by Supabase's own audit)
- Clerk authentication service (covered by Clerk's SOC 2)
- Render hosting infrastructure (covered by Render's SOC 2)
- Social engineering attacks
- Physical security

### 15.3 Responsible Disclosure

Security vulnerabilities should be reported to security@irongate.dev. We commit to:
- Acknowledging receipt within 24 hours
- Providing an initial assessment within 72 hours
- Issuing a fix for critical vulnerabilities within 7 days
- Crediting researchers (with permission) in our security changelog

---

## 16. Incident Response Integration

Iron Gate integrates with enterprise incident response workflows:

- **Automated incident narratives:** `GET /v1/incidents/:id/narrative` generates human-readable incident summaries from event metadata
- **SIEM forwarding:** Real-time event streaming to Splunk, Datadog, Sentinel (ASIM format), and generic webhook endpoints
- **Data provenance:** `GET /v1/provenance/:entityHash` traces entity lineage across all events
- **Governance reports:** `GET /v1/compliance/governance` generates zero-knowledge aggregate reports (no raw PII)
- **Kill switch:** Immediate halt capability with dual-key authentication

See [INCIDENT-RESPONSE-PLAN.md](./INCIDENT-RESPONSE-PLAN.md) for the complete IRP.

---

## 17. Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.2.7 | March 2026 | Iron Gate Engineering | Initial security architecture |
| 0.3.0 | March 2026 | Iron Gate Engineering | Added threat model, pentest scope, incident response, department policies, SCIM, MCP, OCR, SIEM ASIM, circuit breaker |
