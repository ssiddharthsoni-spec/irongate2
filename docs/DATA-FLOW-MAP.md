# Iron Gate Data Flow Map

**Purpose:** Trace every path where personal data enters, moves through, and exits the Iron Gate system.
**Audience:** CISO, DPO, compliance auditors
**Last Updated:** March 2026

---

## Flow 1: Gate Mode (Primary — No Data Leaves Browser)

```
Employee types prompt in ChatGPT/Claude/Gemini
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Chrome Extension (Content Script)              │
│                                                 │
│  1. Intercept prompt text before submission     │
│  2. Run detection engine (regex + ML)           │
│  3. Classify entities (PERSON, SSN, etc.)       │
│  4. Calculate sensitivity score (0-100)         │
│                                                 │
│  IF score < threshold:                          │
│    → Allow prompt to submit (no modification)   │
│                                                 │
│  IF score >= threshold:                         │
│    → Replace entities with pseudonyms           │
│    → Store pseudonym map in chrome.storage      │
│    → Submit modified prompt to AI tool          │
│                                                 │
│  5. Hash prompt text (SHA-256)                  │
│  6. Send to API:                                │
│     • prompt_hash (SHA-256, irreversible)       │
│     • sensitivity_score (number)                │
│     • entity_types (["PERSON","SSN"])            │
│     • action_taken ("pass"/"warn"/"block")      │
│     • ai_tool_id ("chatgpt"/"claude")           │
│     • prompt_length (number)                    │
│                                                 │
│  ⚠ NEVER SENT: raw prompt text, entity values  │
└─────────────────────────────────────────────────┘
         │
         │ TLS 1.3 (HSTS, Expect-CT)
         ▼
┌─────────────────────────────────────────────────┐
│  Iron Gate API                                  │
│                                                 │
│  Receives ONLY:                                 │
│  • prompt_hash (can't reverse to original)      │
│  • sensitivity_score                            │
│  • entity_types (categories, not values)        │
│  • action                                       │
│  • metadata (tool, timestamp, method)           │
│                                                 │
│  Processes:                                     │
│  1. Validate input (Zod schema)                 │
│  2. Set RLS context (firm isolation)            │
│  3. Compute audit chain hash                    │
│  4. Sign with HMAC-SHA256                       │
│  5. Insert into events table                    │
│  6. Trigger async jobs (webhooks, co-occ.)      │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  PostgreSQL (Supabase)                          │
│                                                 │
│  Stored (all encrypted at rest by Supabase):    │
│  • Event record with hash chain + HMAC          │
│  • RLS ensures firm A can't see firm B          │
│                                                 │
│  NOT stored:                                    │
│  • Raw prompt text                              │
│  • Original entity values                       │
└─────────────────────────────────────────────────┘
```

**Data at risk:** NONE. Raw PII never leaves the browser.

---

## Flow 2: Proxy Mode (Server-Side Detection)

```
Employee submits prompt
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Chrome Extension                               │
│                                                 │
│  1. Intercept prompt text                       │
│  2. Send FULL prompt to Iron Gate API           │
│     (required for server-side detection)        │
└─────────────────────────────────────────────────┘
         │
         │ TLS 1.3 — RAW PROMPT IN TRANSIT
         ▼
┌─────────────────────────────────────────────────┐
│  Iron Gate API — /v1/proxy/analyze              │
│                                                 │
│  1. Receive raw prompt text ⚠                   │
│  2. Run server-side detection                   │
│  3. Pseudonymize detected entities              │
│  4. Encrypt pseudonym map (AES-256-GCM)         │
│  5. Store encrypted map in DB                   │
│  6. Hash original prompt (SHA-256)              │
│  7. Return modified prompt to extension         │
│  8. Clear prompt from memory                    │
│                                                 │
│  ⚠ RAW PROMPT EXISTS IN SERVER MEMORY           │
│  Duration: ~100-500ms (processing time only)    │
│  NOT written to disk or logs                    │
│  PII sanitization prevents log leakage          │
└─────────────────────────────────────────────────┘
         │
         │ Encrypted pseudonym map
         ▼
┌─────────────────────────────────────────────────┐
│  PostgreSQL                                     │
│                                                 │
│  Stored:                                        │
│  • Encrypted pseudonym map (AES-256-GCM)        │
│    - Per-firm encryption key                    │
│    - Random IV per encryption                   │
│    - Authenticated (GCM auth tag)               │
│  • Prompt hash (SHA-256, irreversible)          │
│  • Sensitivity metadata                         │
│                                                 │
│  NOT stored:                                    │
│  • Raw prompt text                              │
│  • Plaintext entity values                      │
│  • Unencrypted pseudonym mappings               │
└─────────────────────────────────────────────────┘
```

**Data at risk:** Raw prompt temporarily in server memory during proxy processing. Mitigated by: memory cleared after processing, PII log sanitization, Sentry PII stripping.

---

## Flow 3: De-Pseudonymization (Response Processing)

```
AI tool returns response with pseudonyms
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Chrome Extension / API                         │
│                                                 │
│  1. Load encrypted pseudonym map from DB        │
│  2. Decrypt with firm's AES-256-GCM key         │
│  3. Replace pseudonyms with original values     │
│  4. Return de-pseudonymized response to user    │
│  5. Clear decrypted map from memory             │
│                                                 │
│  Pseudonym map auto-expires after session       │
└─────────────────────────────────────────────────┘
```

**Data at risk:** Decrypted pseudonym map briefly in memory. Session-scoped, auto-expires.

---

## Flow 4: Override (User Bypasses Block)

```
Extension blocks a prompt (sensitivity too high)
User clicks "Override" and provides reason
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Chrome Extension                               │
│                                                 │
│  1. Capture override reason (max 500 chars)     │
│  2. Submit prompt to AI tool as-is              │
│  3. Send event to API with action="override"    │
│     and overrideReason text                     │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Iron Gate API                                  │
│                                                 │
│  Store in events table:                         │
│  • action = "override"                          │
│  • override_reason = user's text (max 500 ch.)  │
│  • Hash chain + HMAC signature                  │
│                                                 │
│  ⚠ override_reason stored as plaintext          │
│  Protected by: RLS (firm isolation),            │
│  Supabase encryption at rest, access control    │
└─────────────────────────────────────────────────┘
```

**Data at risk:** Override reason may contain PII (user free text). Protected by RLS and at-rest encryption. Limited to 500 characters.

---

## Flow 5: Authentication

```
User opens Iron Gate dashboard
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Clerk (Third-Party Auth Provider)              │
│                                                 │
│  Processes:                                     │
│  • Email address                                │
│  • Password (hashed by Clerk, never seen by IG) │
│  • Session tokens (JWT)                         │
│                                                 │
│  Returns: signed JWT to browser                 │
│  SOC 2 Type II certified                        │
└─────────────────────────────────────────────────┘
         │
         │ JWT (signed, expiring)
         ▼
┌─────────────────────────────────────────────────┐
│  Iron Gate API                                  │
│                                                 │
│  1. Verify JWT signature (Clerk public key)     │
│  2. Check JWT revocation (Redis + local cache)  │
│  3. Extract user ID, firm ID                    │
│  4. Set RLS context for database queries        │
│  5. Enforce RBAC permissions                    │
└─────────────────────────────────────────────────┘
```

**Data at risk:** Email stored in Iron Gate DB for display/audit. Protected by RLS.

---

## Flow 6: Error Reporting

```
Unhandled exception in Iron Gate API
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Sentry beforeSend Hook                         │
│                                                 │
│  STRIPS before transmission:                    │
│  ✗ Request bodies (may contain prompts)         │
│  ✗ Cookies                                      │
│  ✗ Authorization headers (JWTs)                 │
│  ✗ X-API-Key headers                            │
│  ✗ X-Admin-Key headers                          │
│                                                 │
│  SENDS (metadata only):                         │
│  ✓ Error message (PII-sanitized)                │
│  ✓ Stack trace                                  │
│  ✓ Request method + path (no body)              │
│  ✓ Firm ID, User ID (UUIDs, not PII)            │
│  ✓ Request ID (correlation UUID)                │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Sentry Cloud (Third Party)                     │
│                                                 │
│  Receives: error metadata only                  │
│  Does NOT receive: PII, prompt text, auth creds │
│  SOC 2 Type II certified                        │
└─────────────────────────────────────────────────┘
```

**Data at risk:** NONE. All PII stripped before transmission.

---

## Flow 7: Logging

```
Any API operation generates a log entry
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Logger (PII Sanitization Layer)                │
│                                                 │
│  Before JSON.stringify:                         │
│  • Emails      → [EMAIL_REDACTED]               │
│  • SSNs        → [SSN_REDACTED]                  │
│  • Credit cards → [CARD_REDACTED]                │
│  • API keys    → [API_KEY_REDACTED]              │
│  • DB URIs     → [DB_URI_REDACTED]               │
│  • Redis URIs  → [REDIS_URI_REDACTED]            │
│  • JWTs        → [JWT_REDACTED]                  │
│                                                 │
│  Output: sanitized JSON to stdout               │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Render Log Aggregation                         │
│                                                 │
│  Receives: PII-sanitized structured logs        │
│  Retention: Render default (configurable)       │
└─────────────────────────────────────────────────┘
```

**Data at risk:** NONE after sanitization. All PII patterns redacted before output.

---

## Summary: Data Exposure Matrix

| Data Element | Browser | In Transit | API Memory | Database | Logs | Sentry |
|---|---|---|---|---|---|---|
| Raw prompt text | Yes (gate) | No (gate) / Yes (proxy) | No (gate) / Brief (proxy) | Never | Never | Never |
| Entity values | Yes | No (gate) / Encrypted (proxy) | No (gate) / Brief (proxy) | Encrypted pseudonyms only | Never | Never |
| Prompt hash | Yes | Yes (TLS) | Yes | Yes (RLS) | Possible | No |
| Sensitivity score | Yes | Yes (TLS) | Yes | Yes (RLS) | Possible | No |
| Entity types | Yes | Yes (TLS) | Yes | Yes (RLS) | Possible | No |
| User email | Clerk | Yes (TLS) | Yes | Yes (RLS) | Redacted | No |
| Override reason | Yes | Yes (TLS) | Yes | Yes (RLS, plaintext) | Redacted | No |
| API keys | Extension | Yes (TLS, hashed) | Hashed | Hashed (SHA-256) | Redacted | No |
| Admin keys | Environment | Yes (TLS) | In memory | Environment only | Never | No |
