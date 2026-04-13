# IronGate Security Whitepaper

**Version:** 1.0
**Last updated:** April 2026
**Audience:** CISOs, IT security teams, compliance officers evaluating IronGate for enterprise deployment
**Distribution:** Confidential — share under NDA only

---

## Executive Summary

IronGate is a browser-based data loss prevention (DLP) product that protects sensitive information from being leaked to AI tools like ChatGPT, Claude, Gemini, and Copilot. Unlike traditional DLP tools that monitor from the outside, IronGate operates inside the browser itself — detecting sensitive data in the moment before it would reach any AI service, and replacing it with cryptographically-generated stand-ins so the AI never sees the original.

The product's core security claim is **architectural, not policy-based**: sensitive prompt content cannot leave the employee's device because the software that could send it does not exist in our infrastructure. Detection runs in-browser. Pseudonymization runs in-browser. Our backend database has no column capable of storing prompt text. A malicious insider at IronGate, a subpoena to IronGate, or a breach of IronGate's infrastructure cannot yield customer prompts — because those prompts were never collected.

This document describes exactly what IronGate processes, where it processes it, what it stores, what it never stores, and why. It is intended to satisfy the security review process for regulated industries: legal (attorney-client privilege), healthcare (HIPAA PHI), financial services (SEC / MNPI), and government contractors (CUI / ITAR adjacent).

---

## 1. Product Overview

### 1.1 What IronGate does

IronGate is a Chrome / Chromium extension that:

1. Intercepts outbound requests to 10 supported AI tools (ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Poe, Groq, HuggingFace, You.com) before they leave the browser
2. Analyzes the prompt content against a multi-layered detection engine
3. Replaces detected sensitive values (names, SSNs, client matters, credentials, etc.) with deterministic pseudonyms
4. Forwards the sanitized prompt to the AI tool
5. Intercepts the response stream and restores the original values on-the-fly
6. Emits anonymized event metadata (entity categories, counts, severity score) to a customer-facing admin dashboard

The employee uses their AI tool normally. The AI tool receives sanitized content. The admin gets compliance-grade visibility without ever seeing prompt content.

### 1.2 What IronGate does not do

- **Does not replace AI tools.** Employees still use ChatGPT, Claude, etc. IronGate sits between the employee and the AI tool; it is not a substitute for either.
- **Does not store prompts.** There is no API endpoint, no database column, and no backend service capable of receiving prompt content in IronGate's infrastructure.
- **Does not send prompts to third parties.** The only third party that sees any prompt content is the AI provider the employee chose to use (e.g., OpenAI), and that provider receives only the pseudonymized version.
- **Does not require a proxy server.** IronGate operates in the browser process. No TLS termination, no MITM, no network rerouting.

### 1.3 Who IronGate is for

Primary customer profile: knowledge-work firms where employees use cloud AI tools, and where client data, regulated data, or internal sensitive content must not leak to those tools.

Typical customers: law firms, medical practices, accounting firms, financial services, government contractors, tech companies with MNPI concerns.

---

## 2. Architecture

### 2.1 Component overview

```
┌────────────────────────────────────────────────────────────────┐
│  EMPLOYEE'S BROWSER (Chromium-based)                            │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Content     │  │  Main-world  │  │  Service Worker      │  │
│  │  Scripts     │  │  Interceptor │  │  (auth, storage,     │  │
│  │  (UI badges, │  │  (fetch/XHR  │  │   managed policy)    │  │
│  │   tooltips)  │  │   patching)  │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                 │                     │               │
│         └─────────────────┴─────────────────────┘               │
│                           │                                     │
│                  ┌────────┴────────┐                            │
│                  │ Detection       │                            │
│                  │ Pipeline        │                            │
│                  │  (in-browser)   │                            │
│                  └─────────────────┘                            │
│                           │                                     │
│                  ┌────────┴────────┐                            │
│                  │ Pseudonymization│                            │
│                  │ (browser crypto)│                            │
│                  └─────────────────┘                            │
└────────────────────────────────────────────────────────────────┘
            │                                   │
            │ pseudonymized prompt              │ anonymized event metadata
            │ (over employee's                  │ (no prompt text)
            │  existing AI provider link)       │
            ▼                                   ▼
   ┌────────────────────────┐        ┌────────────────────────┐
   │  AI PROVIDER           │        │  IRONGATE BACKEND      │
   │  (OpenAI / Anthropic / │        │  (Render + Supabase)   │
   │   Google / others)     │        │                        │
   │                        │        │  - Event log (schema   │
   │  Sees sanitized text   │        │    has no raw text     │
   │  only. IronGate has    │        │    column)             │
   │  zero access.          │        │  - Firm config         │
   │                        │        │  - Admin auth (Clerk)  │
   └────────────────────────┘        └────────────────────────┘
```

### 2.2 Detection pipeline (in-browser)

Detection runs in three layers, all on the employee's device:

**Layer 1 — Pattern and context analysis**
A pure-JavaScript engine that identifies structural patterns (IDs, account numbers, credentials) and contextual signals (legal terminology, financial language, medical terminology) in under 10ms per prompt. No network calls. No machine learning model. No data leaves the browser.

**Layer 2 — On-device language model (optional)**
For ambiguous cases where pattern analysis alone is insufficient, IronGate can optionally consult a small language model running on the employee's machine (via a local inference service). This resolves cases like *"Confidential: we're evaluating an acquisition"* where the sensitivity depends on context that regex cannot capture. The model runs entirely on-device; IronGate's infrastructure is not involved. This layer is skipped gracefully if the local service is not installed.

**Layer 3 — Metadata classifier (in-browser)**
A lightweight in-browser classifier that examines entity structure, frequency, and co-occurrence patterns to catch "document paste" scenarios where many pieces of moderately sensitive data appear together.

All three layers run in the browser. **No prompt text leaves the device during detection.**

### 2.3 Deployment modes

IronGate supports three deployment modes, configurable via managed policy:

| Mode | Detection | Cloud LLM usage | Use case |
|---|---|---|---|
| **local-only** (default) | Layers 1, 2, 3 on-device | None | Default; sovereign-data firms |
| **hybrid** (opt-in) | Layers 1-3 local + optional cloud LLM escalation on sanitized text | Sanitized tokens only, never raw text | Firms prioritizing detection accuracy over strict locality |
| **server-only** (legacy) | Layer 3 only; cloud LLM for classification | Sanitized tokens only | Legacy customers; not recommended |

The default mode is **local-only**. Cloud LLM escalation requires explicit IT opt-in via managed policy, and even then, only *sanitized* text (PII already replaced with category tokens) is transmitted.

### 2.4 Pseudonymization

Pseudonymization is performed in the browser using the native Web Crypto API (`SubtleCrypto`). Key properties:

- **Deterministic within a firm:** The same input value always produces the same pseudonym for a given firm. An employee referring to "Robert Johnson" in Monday's prompt and "Robert Johnson" in Friday's prompt will see the same pseudonym both times — preserving conversation continuity.
- **Distinct across firms:** Each firm has its own pseudonymization key (128+ bits of entropy). "Robert Johnson" at Sterling Law and "Robert Johnson" at another firm will produce different pseudonyms.
- **Not reversible without the key:** The pseudonymization function is a one-way derivation. Without the firm's key, pseudonyms cannot be mapped back to originals.
- **Reverse map is in memory only:** The in-browser extension maintains a forward/reverse map for the active session to restore originals in AI responses. This map lives in the extension's memory space only; it is never written to disk, never synced, never transmitted. It is destroyed when the tab closes.

The pseudonymization key is derived from a firm-specific secret that is set via managed policy at deployment time and stored in browser-level managed storage (writable only by the IT admin, never by the user or page scripts).

---

## 3. Data Flow and Storage

### 3.1 What crosses each network boundary

| Boundary | Data that crosses | Data that does NOT cross |
|---|---|---|
| Employee's browser → AI provider (e.g., OpenAI) | Pseudonymized prompt with fakes in place of sensitive values | Original PII values, real names, real IDs, real monetary amounts |
| Employee's browser → IronGate backend | Anonymized event metadata (categories, counts, severity score, SHA-256 hash of prompt) | Prompt text, entity values, response content, any PII |
| IronGate backend → Any third party | Nothing | Nothing — IronGate does not share data with third parties |

### 3.2 What IronGate's database stores

The event log schema (`events` table) contains these columns and only these columns:

| Column | Type | Contains |
|---|---|---|
| `id` | UUID | Event identifier |
| `firm_id` | UUID | Customer organization reference |
| `user_id` | UUID | Anonymized user reference (device-scoped by default) |
| `ai_tool_id` | varchar | Which AI tool (e.g., "chatgpt") |
| `ai_tool_url` | text | The URL pattern (not the full request) |
| `prompt_hash` | varchar(64) | **SHA-256 hash of the prompt — irreversible, one-way** |
| `prompt_length` | integer | Character count only |
| `sensitivity_score` | real | 0-100 score |
| `sensitivity_level` | enum | "low" / "medium" / "high" / "critical" |
| `entities` | jsonb | Array of *entity type names and counts* (e.g., `[{type: "SSN", count: 1}]`) — no values |
| `action` | enum | "pass" / "warn" / "block" / "proxy" / "override" |
| `override_reason` | text | If the user forced the request through, their stated reason (not prompt content) |
| `capture_method` | varchar | How the prompt was captured (e.g., "fetch") |
| `session_id` | UUID | Session grouping |
| `metadata` | jsonb | Non-PII metadata (timestamps, version, etc.) |
| `event_hash` | varchar(64) | Cryptographic chain of custody |
| `previous_hash` | varchar(64) | Previous event hash (chain integrity) |
| `server_signature` | varchar(64) | Server-side HMAC for tamper-evident audit |
| `created_at` | timestamp | Event time |

**Critical:** There is no column named `prompt_text`, `prompt_content`, `entities_raw`, or any equivalent. The schema was deliberately designed to make raw-text storage impossible at the database layer — not merely discouraged by policy.

### 3.3 What is never stored

- **Prompt content:** Not in any column, log, or file.
- **Entity values:** The actual name "Robert Johnson" is never stored; only the category `PERSON` and the count.
- **AI response content:** Never captured or transmitted to IronGate.
- **Pseudonymization reverse maps:** Held in browser memory only; discarded on tab close.
- **Browser history or activity outside AI tools:** IronGate has no visibility into non-AI-tool browsing.
- **Files or attachments:** File contents are not transmitted to IronGate.

### 3.4 Data retention

Default retention for the event log: **90 days**. Customer-configurable from 30 days to 7 years (for regulated compliance requirements).

Event records can be deleted on request (GDPR Article 17 / CCPA). Because no prompt content is ever stored, "right to be forgotten" requests are satisfied by deleting the anonymized event records alone.

---

## 4. Cryptography

### 4.1 Standards used

IronGate uses industry-standard, well-reviewed cryptographic primitives throughout. Specific algorithms and parameters are documented in the customer-facing Technical Security Addendum (provided separately under NDA upon request during procurement).

At a high level:

- **Pseudonymization:** Key-derivation-function-based deterministic hashing with firm-scoped keys
- **At-rest encryption:** Symmetric authenticated encryption for any non-anonymized fields at rest
- **In-transit encryption:** TLS 1.2 or higher for all network communication
- **Audit log integrity:** Cryptographic hash chains with server-signed records
- **Policy signing:** Asymmetric signatures for the customer-signed policy bundle mechanism
- **Extension integrity:** Chrome Web Store's automatic signing (when deployed via the store)

### 4.2 Key management

- **Per-firm pseudonymization keys** are generated at firm creation and stored in IronGate's backend (for audit correlation) AND pushed to customer endpoints via managed policy. Customers with strict requirements can rotate keys.
- **Customer tenant keys** are derived from a master secret using standard KDF practices; each firm has its own derived key so cross-tenant access is cryptographically prevented, not just policy-prevented.
- **Master secret** is stored in the backend's secrets manager (environment variables on Render; never in code repository; rotated annually).
- **Browser-side keys** are derived at startup from the firm's managed configuration and held only in the extension's memory; they are not persisted to local storage.

### 4.3 What this means in practice

If an attacker compromises IronGate's backend entirely, they obtain:
- Anonymized event metadata (counts, categories, scores, hashes)
- Firm configurations
- Admin login information (via Clerk, MFA-protected)

They do not obtain:
- Prompt content (not stored anywhere)
- Entity values (not stored anywhere)
- Response content (not stored anywhere)
- Pseudonymization reverse maps (only exist in end-user browsers, ephemerally)

---

## 5. Chrome Extension Permissions

IronGate requests the minimum set of Chrome permissions needed to operate. Each is justified below.

### 5.1 Permissions and justifications

| Permission | Why IronGate needs it |
|---|---|
| `storage` | To store the firm's API key and configuration in the employee's browser. Managed storage is used for IT-set policy. |
| `sidePanel` | To render the IronGate sidepanel UI (entity tooltip, detection log, managed-mode banner). |
| `activeTab` | To examine the currently active tab's content when the employee is interacting with an AI tool. Only triggered when the user is on a supported AI tool URL. |
| `scripting` | To inject the interceptor script into supported AI tool pages. |
| `declarativeNetRequest` | For URL-based traffic controls (block rules for specific AI tools if configured by IT). |

### 5.2 Host permissions

IronGate requests host permissions for the 10 supported AI tool domains only:

- `chatgpt.com`
- `claude.ai`
- `gemini.google.com`
- `copilot.microsoft.com`
- `perplexity.ai`
- `chat.deepseek.com`
- `poe.com`
- `groq.com`
- `huggingface.co/chat`
- `you.com`

**IronGate does not request `<all_urls>` permission.** The extension cannot read, inject into, or intercept traffic on any site outside this list.

### 5.3 What the extension cannot do

By virtue of the permission set:
- Cannot read Gmail, Outlook, Slack, or any communication tool
- Cannot read banking websites or other financial portals
- Cannot read healthcare portals (EHR, patient portals)
- Cannot read the employee's browsing history
- Cannot read cookies or credentials of non-AI-tool sites
- Cannot take screenshots or record the screen
- Cannot capture keystrokes outside of AI tool input fields

---

## 6. Threat Model

### 6.1 Threats IronGate protects against

| Threat | How IronGate addresses it |
|---|---|
| Employee accidentally pastes client name into ChatGPT | Detection catches the name; pseudonymization replaces it before send |
| Employee intentionally tries to paste SSN into Claude | Same — detection is inline and cannot be bypassed without disabling the extension (which an MDM-managed install prevents) |
| Shadow IT: employee uses an AI tool IT hasn't approved | Allowlist of AI tools can be configured via managed policy; unapproved tools are blocked |
| Compliance audit: auditor asks for record of AI usage | Tamper-evident audit log with signed events, exportable as CSV |
| Insider threat: IronGate employee wants to read customer prompts | **Impossible by architecture** — prompt content is never transmitted to IronGate |
| Subpoena of IronGate: regulator demands customer prompts | **Impossible to comply with for prompts** — we do not possess them |
| Breach of IronGate's backend | Attacker obtains anonymized metadata only; no prompts |
| Man-in-the-middle between browser and AI provider | Not IronGate's threat model — that's a standard TLS problem already handled by Chrome |

### 6.2 Threats IronGate does NOT protect against

IronGate is a DLP tool, not a universal security product. Threats outside scope:

- **Malware on the employee's machine.** If the device is already compromised, everything is compromised.
- **Employees typing sensitive data into non-AI-tool apps** (Gmail, Slack, personal email). IronGate only operates on the 10 supported AI tool domains.
- **Employees taking screenshots or photos of sensitive content.** IronGate is a network-interception product, not a UI-level DLP.
- **Employees using personal devices without IronGate installed.** BYOD enforcement requires MDM, not IronGate.
- **Prompt injection attacks against the AI tool itself.** These are security issues for the AI provider, not IronGate.
- **The AI provider misbehaving with sanitized content.** IronGate limits what the provider sees, but cannot dictate what they do with it.

### 6.3 Residual risks

- **Pseudonymization depends on detection.** If a piece of sensitive data is not detected by the pipeline, it will not be pseudonymized. IronGate's detection targets a broad set of patterns (30+ categories) but no DLP tool is 100% accurate. Customers should treat IronGate as high-accuracy protection, not absolute guarantee.
- **Sanitized content may still be sensitive in aggregate.** A pseudonymized prompt is still a prompt. If the structural content reveals strategy ("we're acquiring a competitor for $2B") even after PII removal, that business sensitivity remains exposed to the AI provider. Customers with extreme business-sensitivity concerns should combine IronGate with policy-level restrictions on which AI tools can be used for which content.
- **Browser-level compromise defeats IronGate.** Like any browser-based tool, IronGate relies on the browser's security model. A compromised browser can be made to bypass IronGate's interception.

---

## 7. Compliance Framework Mapping

### 7.1 HIPAA (healthcare)

IronGate's architecture supports HIPAA compliance for covered entities using AI tools with PHI:

- **PHI does not reach IronGate:** No storage, no transit of raw PHI — satisfies §164.502(e) business associate requirements by eliminating the need for an agreement entirely for prompt content.
- **Tamper-evident audit log:** Satisfies §164.312(b) audit control requirements.
- **Encryption in transit and at rest** for metadata (required fields encrypted): satisfies §164.312(a)(2)(iv) and §164.312(e)(1).
- **Access controls via managed policy + admin RBAC:** satisfies §164.312(a)(1).

A signed Business Associate Agreement (BAA) template is available at [/legal/baa](/legal/baa) for customers that prefer formal coverage despite the architectural guarantee.

### 7.2 SOC 2 (general enterprise)

IronGate is targeting SOC 2 Type I certification in [timeline]. Controls already in place:

- **CC6.1 Logical access:** Admin RBAC; per-firm tenant isolation; MFA required for admin actions.
- **CC6.6 Encryption:** TLS 1.2+ for transport, authenticated encryption at rest.
- **CC7.1 System monitoring:** Audit log with tamper-evident chain.
- **CC7.2 Security incidents:** Documented incident response (Section 10 below).

### 7.3 GDPR / UK GDPR (EU + UK)

- **Article 5 data minimization:** IronGate collects only metadata necessary for audit and billing. Prompt content is never collected.
- **Article 17 right to erasure:** Satisfied by deleting anonymized event records; prompt content is never stored so erasure of that is trivially complete.
- **Article 25 data protection by design:** Architecture enforces privacy by construction (schema has no prompt-text column).
- **Article 32 security of processing:** Encryption, tamper-evident logs, role-based access.
- **Article 33 breach notification:** Process documented in Section 10.

A Data Processing Agreement (DPA) template is available at [/legal/dpa](/legal/dpa).

### 7.4 PCI-DSS (payment card data)

IronGate's detection includes PCI-covered data (credit card numbers, CVVs) but IronGate itself is **not a cardholder data environment (CDE)** because:

- Credit card numbers are never stored by IronGate (not in any form, hashed or otherwise).
- Only the *category* "CREDIT_CARD" and the count are logged as metadata.

This means IronGate does not add PCI scope to your environment when deployed. Customers that process card data should still use IronGate as part of a layered defense and follow their PCI DSS v4.0 obligations in full.

### 7.5 Attorney-Client Privilege

For law firms:

- **Privilege is preserved** because communications with AI tools containing client-identifying information are sanitized before leaving the firm's network. The AI provider never receives the client identity, so no third-party disclosure occurs.
- **Work-product doctrine** similarly protected — case names, matter details, and legal strategy markers are detected and pseudonymized.
- IronGate does not itself receive privileged content — we never see prompts.

---

## 8. Deployment Modes and Controls

### 8.1 Managed policy (IT-controlled deployment)

When deployed via an enterprise MDM (Google Workspace, Microsoft Intune, Jamf Pro, VMware Workspace ONE), the following settings are controlled by IT and cannot be modified by the end user:

- `deploymentMode` — forces local-only, hybrid, or server-only
- `enrollmentCode` — organization association
- `allowedAITools` — whitelist of AI tools that employees can use
- `killSwitch` — emergency disable-all-AI setting
- `auditLogDestination` — where events are sent (can be customer-controlled SIEM)
- `localEndpoint` + `localModel` — on-device inference service configuration

Managed settings are pushed via `chrome.storage.managed`, which is read-only at runtime and writable only by the OS-level MDM agent. End users cannot disable, weaken, or circumvent these settings from Chrome's UI, DevTools, or any page script.

### 8.2 Kill switch

For incident response, compliance hold, or legal matter freezes, the admin can flip a kill switch that instantly blocks all AI tool traffic for the organization. The kill switch:

- Takes effect within minutes across all deployed browsers (as managed policy propagates)
- Displays a configurable notice to employees (e.g., "AI tools disabled — contact IT at security@firm.com")
- Cannot be bypassed by the end user
- Is logged with timestamp, reason, and admin who activated it

### 8.3 AI tool allowlist

IT admins can restrict which of the 10 supported AI tools employees may use. Example policies:

- Law firm: ChatGPT and Claude allowed; all others blocked
- Healthcare: only Copilot (HIPAA BAA in place) allowed; others blocked
- Finance: Claude only (perceived safety for financial content)

Unapproved tools show a block message with a contact for IT.

---

## 9. Infrastructure and Third Parties

### 9.1 IronGate's infrastructure

| Service | Used for | Provider | Location |
|---|---|---|---|
| Dashboard hosting | Admin web application | Vercel | Global edge (US primary) |
| API backend | Event ingestion, config, admin | Render | US (Oregon by default; other regions available) |
| Database | Firm configs, anonymized events | Supabase (Postgres) | US (customer-configurable region) |
| Authentication | Admin login | Clerk | US |
| Error telemetry | Application error monitoring | Sentry (optional) | US |
| Email delivery | Admin notifications | Resend (optional) | US |

All providers are SOC 2 Type II certified. Data Processing Agreements with sub-processors are maintained and available for customer review.

### 9.2 What each sub-processor sees

- **Vercel:** The admin dashboard HTML/JS; no prompt content ever.
- **Render:** The anonymized event metadata and firm configs; no prompt content ever.
- **Supabase:** The anonymized event metadata at rest; no prompt content ever.
- **Clerk:** Admin email addresses and authentication tokens; no prompt content ever.
- **Sentry:** Application-level errors (stack traces with PII automatically scrubbed); no prompt content ever.
- **Resend:** Admin email addresses for notifications; no prompt content ever.

### 9.3 Data residency

Customer data can be hosted in:
- US (default)
- EU (Frankfurt or Ireland regions of our sub-processors)
- Private cloud / on-premises (Enterprise plan only)

For EU residency requirements, the IronGate backend and database can be provisioned in EU regions, and the dashboard is globally edge-distributed with no customer data cached.

For the highest-assurance customers (government, defense), on-premises deployment is available: IronGate's API backend and database can be deployed in a customer-controlled Kubernetes cluster with no connection to IronGate's infrastructure.

---

## 10. Incident Response

### 10.1 Types of incidents

IronGate differentiates incidents by severity:

- **P1 — Customer data exposure:** Exposure of anonymized customer metadata. (Note: because prompt content is never stored, a P1 here does not involve prompts.)
- **P2 — Service availability:** Dashboard or extension service disruption.
- **P3 — Detection quality issue:** A significant false-negative or false-positive pattern discovered in production.
- **P4 — Routine vulnerability:** A vulnerability discovered through bounty, research, or internal review.

### 10.2 Response SLAs

| Severity | Acknowledgement | Initial response | Resolution target |
|---|---|---|---|
| P1 | 30 minutes | 2 hours | 24 hours |
| P2 | 2 hours | 8 hours | 72 hours |
| P3 | 24 hours | 72 hours | 14 days |
| P4 | 5 business days | 30 days | 90 days |

### 10.3 Customer notification

For any incident involving customer data, IronGate will notify affected customers within 72 hours of confirmation, consistent with GDPR Article 33 requirements. Notifications include:

- Nature of the incident
- Data categories affected (note: prompt content is never stored, so never affected)
- Timeline of discovery and response
- Mitigation steps
- Recommended customer actions (if any)

### 10.4 Security contact

Report security issues to: **security@irongate.ai**

For bounty-eligible findings, responsible disclosure is requested. Terms and rewards are published at irongate.ai/security.

---

## 11. Change Management and Versioning

### 11.1 Extension updates

Chrome Web Store–distributed extensions auto-update. Enterprise deployments can pin to specific versions via managed policy for change-control requirements.

Security-critical patches are backported to supported prior versions and pushed as patch releases.

### 11.2 Backend updates

Dashboard and API updates are continuously deployed. Breaking changes are preceded by:
- 30 days notice to enterprise customers
- Backward-compatible fallback for at least 30 days after release
- Changelog published at irongate.ai/changelog

### 11.3 Whitepaper versioning

This document is versioned. Prior versions are available at irongate.ai/security-whitepaper/archive. Customers signing an MSA can request notification of whitepaper updates.

---

## 12. Customer-Side Controls

Customers retain the following controls:

- **Export all audit data:** Via dashboard or API, at any time, in CSV or JSON format.
- **Delete all data:** Via admin dashboard or a written request to privacy@irongate.ai. 30-day standard turnaround; expedited available.
- **Rotate pseudonymization keys:** Via admin dashboard, at any time. Does not affect historical records.
- **Revoke API keys:** Via admin dashboard, immediate effect.
- **Disable the product:** Via kill switch, immediate effect across all deployed browsers.
- **Audit access:** Admin activity log records which admin took which action at what time.

---

## 13. Open Questions and Customer Diligence

This whitepaper covers IronGate's architecture and security posture at a level suitable for initial diligence. The following deeper-dive artifacts are available during procurement, under NDA:

- **Technical Security Addendum** — specific cryptographic algorithms, key sizes, and parameters
- **Threat Model Deep Dive** — STRIDE/DREAD analysis for each architectural component
- **Penetration Test Reports** — most recent third-party pentest (annual cadence)
- **SOC 2 Type I Report** — available upon achievement (target: Q3 2026)
- **SBOM (Software Bill of Materials)** — dependency inventory for the extension and backend
- **Code Review Access** — for customers under Enterprise plans, source-code review access can be arranged

Contact **security@irongate.ai** or your IronGate account executive to request any of these.

---

## Appendix A — Glossary

- **DLP (Data Loss Prevention):** Class of security products designed to prevent sensitive data from leaving an organization.
- **PII (Personally Identifiable Information):** Data that can identify an individual (names, SSNs, etc.).
- **PHI (Protected Health Information):** Health data covered under HIPAA.
- **MNPI (Material Non-Public Information):** Corporate information that, if disclosed, could affect a company's stock price.
- **Pseudonymization:** Replacing identifying data with artificial identifiers, such that the original data can be restored with the right key (vs. anonymization, which is one-way).
- **Managed Policy:** Configuration pushed to Chrome extensions by the organization's MDM (Mobile Device Management) system.
- **MDM:** Software (Google Admin Console, Microsoft Intune, Jamf Pro, etc.) that enterprises use to control configuration on managed devices.

---

## Appendix B — Contact

**Security issues:** security@irongate.ai
**Compliance questions:** compliance@irongate.ai
**Sales / enterprise inquiries:** sales@irongate.ai
**General:** hello@irongate.ai

---

*End of document. Distribution: Confidential — NDA required.*
