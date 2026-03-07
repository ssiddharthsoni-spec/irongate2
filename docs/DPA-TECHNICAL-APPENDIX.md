# Data Processing Agreement — Technical Appendix

**For use with:** Iron Gate Enterprise Pilot Agreement
**Version:** 1.0
**Last Updated:** March 2026

---

## Schedule 1: Data Processing Details

### 1.1 Categories of Data Subjects
- Employees of the Client ("End Users") who use AI tools monitored by Iron Gate

### 1.2 Categories of Personal Data Processed

| Category | Examples | Processing Purpose |
|---|---|---|
| Account identifiers | Email address, display name | Authentication, audit attribution |
| Usage metadata | AI tool used, timestamp, sensitivity score | Risk assessment, compliance reporting |
| Prompt hashes | SHA-256 hash of prompt text | Deduplication, audit trail (not reversible) |
| Entity classifications | Type detected (e.g., "PERSON", "SSN") | Sensitivity scoring |
| Pseudonym mappings | Encrypted reversible pseudonyms | De-pseudonymization for authorized review |

### 1.3 Data NOT Processed
- Raw prompt text (never transmitted to server in gate mode)
- Original entity values (only hashes or encrypted pseudonyms)
- Browsing history
- File contents (beyond document scanning if enabled)
- Keystrokes or screen captures

### 1.4 Processing Activities

| Activity | Lawful Basis | Retention |
|---|---|---|
| Prompt sensitivity analysis | Legitimate interest (DLP) | Client-configurable (default 90 days) |
| Pseudonym mapping storage | Contractual necessity | Session-scoped, auto-expires |
| Audit trail maintenance | Legal obligation (compliance) | Per compliance framework (min 365 days) |
| Compliance score calculation | Contractual necessity | Real-time, not stored |
| Alert generation | Legitimate interest | 90 days |

---

## Schedule 2: Technical & Organizational Measures

### 2.1 Encryption

| Measure | Standard | Implementation |
|---|---|---|
| Encryption at rest (application) | AES-256-GCM | Per-firm derived keys, PBKDF2 600K iterations |
| Encryption at rest (database) | AES-256 | Supabase-managed, transparent |
| Encryption in transit | TLS 1.3 | HSTS preload, Expect-CT enforced |
| Key separation | Split secrets | Encryption and signing use independent keys |
| Key derivation | PBKDF2-SHA256 | 600,000 iterations (encryption), 100,000 (signing) |

### 2.2 Access Control

| Measure | Implementation |
|---|---|
| Authentication | Clerk-managed JWT with session management |
| Authorization | Role-based (user/admin/owner) |
| Database isolation | PostgreSQL Row-Level Security on all 22 firm-scoped tables |
| API key security | SHA-256 hashed, only prefix stored in plaintext |
| Admin operations | Dual admin key requirement with timing-safe comparison |
| Session management | JWT revocation via Redis + in-memory fallback, fail-closed in production |

### 2.3 Data Minimization

| Measure | Implementation |
|---|---|
| Prompt text | Never stored — only SHA-256 hash (irreversible) |
| Entity values | Replaced with pseudonyms or hashed before server storage |
| Log sanitization | Emails, SSNs, cards, JWTs, DB URIs automatically redacted |
| Error reporting | Request bodies, auth headers stripped before Sentry transmission |
| Override reasons | Limited to 500 characters, stored within RLS-protected table |

### 2.4 Integrity & Availability

| Measure | Implementation |
|---|---|
| Audit trail integrity | Hash-chained events with HMAC-SHA256 server signatures |
| Kill switch | Dual-key authenticated, rate-limited, fail-safe (extension halts if server unreachable) |
| Rate limiting | Redis-backed with in-memory fallback |
| Input validation | Zod schema validation, 10 MB body size limit |
| Graceful shutdown | Connection draining, worker cleanup, Sentry flush |
| Migration safety | PostgreSQL advisory locks prevent concurrent migration races |

### 2.5 Monitoring & Incident Detection

| Measure | Implementation |
|---|---|
| Structured logging | JSON-formatted, PII-sanitized |
| Error tracking | Sentry (PII-stripped) |
| Anomaly detection | Network guard violations, security header validation |
| Audit chain verification | Programmatic integrity verification endpoint |
| Health monitoring | Deep health checks (database connectivity) |

---

## Schedule 3: Sub-Processors

| Sub-Processor | Purpose | Location | Data Accessed | Security Certification |
|---|---|---|---|---|
| Supabase, Inc. | Database hosting | US-West-2 | All stored data (encrypted at rest) | SOC 2 Type II |
| Render, Inc. | API hosting | US | In-memory during request processing | SOC 2 Type II |
| Clerk, Inc. | Authentication | US | User emails, auth tokens | SOC 2 Type II |
| Functional Software (Sentry) | Error tracking | US | Error metadata only (PII stripped) | SOC 2 Type II |
| Upstash, Inc. | Redis caching | US | Rate limit counters, token hashes | SOC 2 Type II |

**Processor agrees to:**
- Notify Controller 30 days before adding or replacing sub-processors
- Ensure equivalent data protection obligations in sub-processor agreements
- Remain fully liable for sub-processor compliance

---

## Schedule 4: Data Deletion & Return

### 4.1 Upon Contract Termination

Within 30 days of contract termination:
1. Export all firm data via API endpoints (audit logs, compliance reports)
2. Initiate data deletion via `DELETE /v1/security/firm/data`
3. 24-hour grace period allows cancellation
4. All firm-scoped data deleted across all tables
5. Encryption salt destroyed (renders encrypted data unrecoverable)
6. Written confirmation of deletion provided

### 4.2 Data Covered by Deletion

- Events (audit trail)
- Pseudonym mappings
- Feedback records
- Entity co-occurrences
- Inferred entities
- Sensitivity patterns
- Client matters
- Weight overrides
- Webhook subscriptions
- Firm plugins
- API keys
- Alerts
- Invites
- Extension heartbeats
- Department policies
- Feature flags

### 4.3 Data Retained After Deletion

- Anonymized, aggregated usage metrics (no firm-identifiable data)
- System logs older than 90 days (PII-sanitized)

---

## Schedule 5: Data Subject Rights

| Right | Implementation |
|---|---|
| Access | `GET /v1/user/data` — returns all data associated with a user |
| Rectification | Users can update profile via dashboard |
| Erasure | Admin-initiated via data deletion endpoint |
| Portability | JSON export via API endpoints |
| Restriction | Kill switch halts processing immediately |
| Objection | Kill switch + data deletion |

---

## Schedule 6: Breach Notification

### Notification Obligations

The Processor shall notify the Controller without undue delay (and in any event within 24 hours) after becoming aware of a personal data breach. Notification shall include:

1. Nature of the breach, including categories and approximate number of data subjects affected
2. Name and contact details of the data protection point of contact
3. Likely consequences of the breach
4. Measures taken or proposed to address the breach

### Breach Determination

Iron Gate classifies incidents using a four-tier severity system (SEV-1 through SEV-4). Client notification is required for SEV-1 (within 24 hours) and SEV-2 (within 48 hours) incidents. See Incident Response Plan for full details.
