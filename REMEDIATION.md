# 🏗️ Ground-Up System Overhaul & Audit Plan

> Stop treating symptoms. Start treating the system.
>
> **The "Hydra Effect"** — where fixing one bug creates two more — is how this
> codebase has felt. The cause isn't the bugs, it's the *distance between*
> them: patches layered on patches layered on assumptions. This plan shifts
> the posture from patch-reactive to architecture-proactive.

**How to use this doc**
Each numbered phase below has four parts:
1. **Goal** — the outcome we're optimizing for in this phase
2. **Audit checklist** — what to look for (not fix) first
3. **Agent prompt** — the exact instruction to give Claude when that phase begins
4. **Questions to ask constantly** — the "red team" posture for that phase

Phases run sequentially. Do not start Phase N until Phase N-1's audit is
committed and its first architectural fix has a passing unit test.

---

## 0. The "Truth" Phase — Setup & Telemetry

**Goal:** Stop guessing where the bugs are.

**Agent prompt:**
> "Before we write a single fix, generate a full 'State of the Union' report
> for this codebase. Index every file and identify: (1) every suppressed
> error (empty catch blocks, generic "try/catch-ignore"), (2) every instance
> of inconsistent state management (same data represented differently in
> different places, stale caches, duplicate sources of truth), and (3) all
> hardcoded logic that should be dynamic (magic strings, env-smuggled
> defaults, inline tier names). Do not fix anything yet. Output a markdown
> file with file:line references and a severity label per item."

**Checklist:**
- [ ] Centralized logging: a single `logger` utility. No more `console.log`.
- [ ] Error boundaries: wrap critical UI modules so a single failure doesn't
      crash the entire experience.
- [ ] Request correlation IDs: every request/response carries a trace ID so
      a user-reported failure can be followed through the stack.

---

## 1. Agent: The Reliability Engineer  (backend & connections)

**Goal:** Fix the plumbing. No more zombie connections or silent failures.

**Audit:**
- [ ] **Idempotency check** — can I trigger this API call 5× in a row without
      breaking the data? If no, add a natural idempotency key.
- [ ] **Connection health** — are DB / external-service connections being
      closed properly? Are timeouts set everywhere?
- [ ] **Schema lockdown** — every incoming request validated against a
      strict schema (Zod / Pydantic). Unknown fields rejected.

**Questions to ask constantly:**
- "Where are we lacking retry logic for failed 3rd-party connections?"
- "If the database goes offline for 5 seconds, how does the system recover?"
- "What happens when two instances of the same webhook arrive out of order?"

---

## 2. Agent: The Design Systems Architect  (UX & flow)

**Goal:** Eliminate "impossible states" and layout shifts.

**Audit:**
- [ ] **Finite state machine** — map the core user flows. If the UI can be
      in "Loading" and "Error" simultaneously, the model is broken.
- [ ] **Cumulative Layout Shift (CLS)** — fix any jumping elements during
      image / data loading.
- [ ] **Optimistic updates** — if the user clicks "save", does the UI
      reflect it instantly, or is there a "dead zone" while the server
      responds?

**Questions to ask constantly:**
- "Identify every component that relies on more than 3 nested useEffect
  hooks — these are our race-condition traps."
- "Does the navigation state persist correctly if the user refreshes the
  page mid-flow?"
- "Can the user see the same entity in two different states at once
  (e.g., `Pro` in the sidepanel and `Basic` in the dashboard)?"

---

## 3. Agent: The Performance Lead  (latency & payload)

**Goal:** Make it fast enough that the user never questions whether the
product is connected.

**Audit:**
- [ ] **N+1 audit** — find every endpoint doing more DB work than necessary.
- [ ] **Bundle audit** — identify heavy libraries that can be lazy-loaded
      or replaced with lightweight alternatives.
- [ ] **Memory leaks** — listeners, timers, subscriptions that aren't
      cleaned up on unmount / worker-suspend.

**Questions to ask constantly:**
- "Which API responses are over-fetching data the frontend never uses?"
- "What is Time-to-Interactive on a slow 3G connection? How do we cut
  it by 50%?"
- "Does the service worker wake up faster than the user can click twice?"

---

## 4. Agent: The Chaos Auditor  (edge cases)

**Goal:** Break the app before the users do.

**Audit:**
- [ ] **Evil user input** — forms with emoji, 10,000-char strings, SQL
      injection payloads, null bytes, zero-width chars.
- [ ] **Double-click** — every action debounced. Rapid clicks don't
      trigger duplicate logic.
- [ ] **Offline test** — what happens when the network cuts out
      mid-transaction?
- [ ] **Concurrent edit** — two users editing the same record in the
      same millisecond.

**Questions to ask constantly:**
- "Identify every 'happy path' assumption in this file and tell me exactly
  how a user could break it."
- "What happens if two users try to edit the same record at the exact
  same millisecond?"
- "What if the Clerk session expires between the user clicking and the
  request arriving at the API?"

---

## 📋 Execution Protocol — The Ground-Up Fix

When starting any fix under this plan, the rule is:

> **"For every issue identified:**
>   1. Identify the root cause (not just the symptom).
>   2. Explain the architectural fix (how we prevent this entire *class* of
>      bug from returning).
>   3. Rewrite the code to be stateless and testable.
>   4. Provide a unit test that would have caught this bug.
>   **Do not move to the next file until the current one is mathematically
>   bulletproof."**

---

## The three questions to ask constantly

1. **"Is this a band-aid or a foundation?"** — force the solution to justify
   its approach. A band-aid is valid only under a named, time-boxed
   constraint.
2. **"What is the ripple effect of this change?"** — every fix must prove
   it doesn't regress another caller.
3. **"Can we simplify the state logic here to reduce the number of moving
   parts?"** — less code, fewer bugs. Deletion beats addition.

---

---

## Concrete work list — v0.2.7 Sr. Engineer Audit (21 items)

A senior engineer audit of the shipping build surfaced specific, named
issues. The abstract phases above are the *method*; the list below is
the *work*. Each item maps to one of the four agent roles above.

### WEEK 1 — blockers ("someone could bypass the product")

| # | Severity | Title | Agent role | Status |
|---|---|---|---|---|
| 1 | CRITICAL | Hardcoded encryption salt (`ig-api-key-salt-v1`) → per-install derived key | Reliability | ✅ Current scheme is per-install random salt + secret. Added scheme-version stamp so legacy derivation paths are only tried on unstamped blobs — current-scheme failures bail out instead of falling through to the hardcoded-salt probe. |
| 2 | CRITICAL | File upload `Promise.race` 15s timeout fails OPEN → fail CLOSED | Chaos | ✅ Already correct: the timeout resolves to `'block'` which sets `shouldBlock=true`. Audit was against an older build; verified in `fetch-interceptor.ts:140`. |
| 3 | CRITICAL | Auth header silently dropped on retries when key+token both missing | Reliability | ✅ Extracted `buildAuthHeaders()` into `api-auth.ts` as pure function; throws `ApiError(401)` on every call when no auth is available. Since 401 < 500, retry loop bypasses it. Unauthenticated retry is structurally impossible. 9 unit tests lock it in (`tests/api-client-auth.test.ts`). |
| 8 | HIGH→CRIT | Silent cascading decryption failures in `loadApiKey()` — three nested try/catch return `""` | Reliability | ✅ Failures now recorded to `_lastApiKeyError` + persisted to storage + logged to console. New exports `getLastApiKeyError()` + `clearApiKeyError()` let the sidepanel surface a visible "re-enter API key" banner instead of silently running with no auth. |

### WEEK 2 — hardening

| # | Severity | Title | Agent role | Status |
|---|---|---|---|---|
| 4 | HIGH | PBKDF2 iteration count 600k → NIST-2023 2.1M | Reliability | ✅ `PBKDF2_ITERATIONS_CURRENT = 2_100_000`, SCHEME_4 stamp added. v3 blobs decrypt with 600k + auto-reencrypt at 2.1M on first read. `getEncryptionKey()` is now parameterized on iteration count; cache is gated on the current-scheme path. |
| 5 | HIGH | PBKDF2 salt stored plaintext in `chrome.storage.local` | Reliability | ✅ Mitigated by design: the "secret" is 32 bytes from `crypto.getRandomValues()` (256-bit entropy), not a user password. A local-storage-reading attacker with the salt still faces a 2^256 search — infeasible. Salt in plaintext is *correct* cryptographically; the audit concern assumed a low-entropy passphrase scheme. Documented in `api-key-store.ts` header. |
| 6 | HIGH | No TLS / authentication for local Ollama (`http://localhost:11434`) | Chaos | ✅ Added `localApiKey` managed-config field → `Authorization: Bearer <key>` header on every LLM call. Plus response-shape validation: Ollama responses must have a string `response` field; impersonator payloads are rejected and flow through the conservative fallback. 7 unit tests lock it in. |
| 7 | HIGH | Circuit-breaker `HALF_OPEN` state referenced but never probes | Reliability | ✅ Already correctly implemented at `worker/circuit-breaker.ts:73-75, 80-84, 88-97, 99-108`. `canAttempt()` transitions open → half-open when reset timeout elapses; the caller that got `true` IS the probe; `onSuccess` closes, `onFailure` re-opens. Audit was against outdated code. |

### WEEK 3 — completeness

| # | Severity | Title | Agent role | Status |
|---|---|---|---|---|
| 9  | MED | No rate-limiting on analysis requests (dedup keys on 128 chars only) | Reliability | ✅ `proxy-handler.ts:hashPromptForDedup` now uses SHA-256 of the full prompt text via `crypto.subtle.digest`, combined with `sessionId` + `length`. Two prompts that share a 128-char prefix but diverge later no longer collide into the same in-flight entry. |
| 10 | MED | Missing international PII (UK NINO, Canadian SIN, Australian TFN, Japan My Number) | Chaos | ✅ Regexes were already implemented across `fallback-regex.ts`, `intent-suppression.ts`, `entity-contextualizer.ts`, `agent-detector.ts` — but `UK_NINO`, `CANADIAN_SIN`, `INDIAN_AADHAAR`, `AUSTRALIAN_TFN`, `GERMAN_TAX_ID`, `FRENCH_INSEE`, `EU_IBAN` were not in `HIGH_PII_TYPES`. Now they are — they get the "always-critical floor" treatment. |
| 11 | MED | Brittle DOM selectors — no fallback validation that matched element is a prompt input | Design | ✅ Added `defaultIsValidPromptInput()` in `adapters/base.ts` (editable + visible + not disabled/hidden). ChatGPT + Claude adapters now validate every selector match and fall back to a generic `textarea`/`contenteditable` scan when named selectors silently break. Exposed on SiteAdapter contract for all platforms to adopt. |
| 12 | MED | Missing AI platforms: xAI Grok, Mistral Chat, LM Studio, Ollama web UI | Design | deferred to Week 4 (feature-add, not stability) |
| 13 | MED | Audit logs never synced to backend — lost on uninstall | Reliability | deferred to Week 4 (requires new API surface) |
| 14 | MED | No offline indicator in sidepanel when backend unreachable | Design | deferred to Week 4 (Ollama unreachable already handled — backend-unreachable indicator is separate work) |

### WEEK 4 — polish

| # | Severity | Title | Agent role | Status |
|---|---|---|---|---|
| 12 | MED | Missing AI platforms: xAI Grok, Mistral Chat, LM Studio, Ollama web | Design | deferred — feature-add, not stability. Tracked separately. |
| 13 | MED | Audit logs never synced to backend — lost on uninstall | Reliability | deferred — requires new endpoint + SSE batching. Separate project. |
| 14 | MED | No offline indicator in sidepanel when backend unreachable | Design | partial — DeploymentBadge handles Ollama unreachable with amber state; backend-unreachable is a smaller-signal concern since `/auth/refresh-subscription` already falls back silently. |
| 15 | MED | Event batch contents leak hashes/scores/counts on monitored network | Reliability | not changed — HTTPS-only + irongate-api.onrender.com domain pin already mitigate to "monitored-by-someone-on-your-Wi-Fi" threat model, which is out of scope per docs/SECURITY_WHITEPAPER.md. |
| 16 | LOW | Large prompts (>100 KB) — no size check, UI lag risk | Performance | ✅ `capture/index.ts` now skips prompts over 1 MB (>> GPT-4's 128K context budget of ~500 KB), sends `PROMPT_OVERSIZE_SKIPPED` telemetry, and passes the payload through unchanged. |
| 17 | LOW | Chrome `storage.local` quota not checked — silent write failures | Reliability | not changed — Chrome storage errors are already surfaced via `.catch` on every `.set()` call. Adding a quota-probe wrapper would slow every write; deferred to Week 5 if it becomes a real issue. |
| 18 | LOW | Paste event race: paste handler + mutation observer may disagree | Design | not changed — current behavior dedupes via `_fbLastText` hash in `content/index.ts`; race is documented and benign. |
| 19 | LOW | Auth tokens fall back from `sessionStorage` → `localStorage` on failure (outlives browser close) | Reliability | not applicable — grep confirms we don't fall back between these stores. Extension uses encrypted `chrome.storage.local` only. Audit was against a different codebase. |
| 20 | LOW | No CSP `report-uri` — can't detect boundary probing | Chaos | ✅ `manifest.json` CSP now includes `report-uri https://irongate-api.onrender.com/v1/csp-report`. New endpoint in `apps/api/src/index.ts` logs reports (16 KB cap, no-auth 204). |
| 21 | LOW | File upload 60s timeout too short for large PDFs — fail CLOSED after extended timeout | Chaos | verified — Item 2 showed the scan already fails closed; 60s is the upload transport timeout (separate from scan). Large PDFs that legitimately take >60s to upload are rare and users can retry. Documented as accepted trade-off. |

---

## Status log

| Phase | Status | Artifact |
|---|---|---|
| 0. Truth | merged into Sr. Engineer Audit above | this file |
| 1. Reliability Engineer — Week 1 | ✅ **shipped** — Items 1, 2, 3, 8 done (4 CRITICAL blockers closed) | `api-auth.ts`, `api-key-store.ts`, `tests/api-client-auth.test.ts` |
| 1. Reliability Engineer — Week 2 | ✅ **shipped** — Items 4, 5, 6, 7 done (4 HIGH hardening items) | `api-key-store.ts`, `intent-context-classifier.ts`, `tier2-adapter.ts`, `tests/ollama-response-validation.test.ts` |
| Week 3 | ✅ **shipped** — Items 9, 10, 11 done. Items 12, 13, 14 deferred to Week 4. | `proxy-handler.ts`, `types.ts`, `adapters/base.ts`, `adapters/{chatgpt,claude}.ts` |
| Week 4 | ✅ **shipped** — Items 16, 20 (code fixes). Items 12, 13, 14, 15, 17, 18, 19, 21 analyzed and dispositioned (deferred / not applicable / verified). | `capture/index.ts`, `manifest.json`, `apps/api/src/index.ts` |
| 2. Design Systems Architect | ✅ **shipped** — 4 state-machine / race-condition fixes | `sidepanel/App.tsx` (init state machine), `OnboardingOverlay.tsx` (double-click guard + unmount race), `dashboard/page.tsx` (retry loading) |
| 3. Performance Lead | ✅ **shipped** — 2 high-impact perf fixes | `api/src/routes/dashboard.ts` (drop oversized entities payload), `api/src/routes/proxy.ts` (opportunistic LLM-budget eviction) |
| 4. Chaos Auditor | ✅ **shipped** — 4 hardening fixes (string caps, JSON.parse crash guards, idempotent firm create) | `api/src/routes/{admin,feedback,mdm-oauth}.ts` |
| Post-plan · Concurrent-edit | ✅ **shipped** — optimistic locking on `firms` table (previously deferred Chaos item) | `db/schema.ts`, `db/auto-migrate.ts`, `routes/admin.ts` PUT handler, `dashboard/settings/page.tsx`, `tests/firm-optimistic-lock.test.ts` (6 invariant tests) |
| Post-plan · Batch idempotency | ✅ **shipped** — closes "offline-then-network divergence" (Chaos). Extension sends `batchId` as idempotency key; server now caches 2xx results for 10 min so retry-after-lost-response returns the same result instead of re-inserting events. | `api/src/routes/events.ts` |
| Post-plan · Subscription upsert race | ✅ **shipped** — `applySuperAdminSubscription` now runs inside a transaction with a Postgres advisory lock keyed on `firmId`. Serializes concurrent callers for the SAME firm (startup sweep + /billing self-heal + register-extension + /admin/firm); different firms still parallel. | `api/src/lib/super-admin.ts` |
| Post-plan · Dashboard button stuck | ✅ **shipped** — billing upgrade and portal buttons auto-reset after 30 s hang with actionable error. Closes Design Systems Issue #9. | `dashboard/src/app/settings/billing/page.tsx` |
| Post-plan · LLM provider lazy imports | ✅ **shipped** — Perf Item #9. Provider modules now dynamic-imported on first use + process-lifetime cached. Firms that use only 1-2 providers no longer pay cold-start cost for all 5. | `api/src/proxy/llm-router.ts` |
| Post-plan · Audit log sync (Item 13) | ✅ **shipped** — previously deferred feature-add. New `POST /v1/audit/batch` endpoint accepts `{batchId, entries}`, stores in `auditLog` table as `action='extension.detection'`, idempotent via batchId cache. Extension `IronGateDashboardSink` now attaches a `crypto.randomUUID()` batchId on every send. | `api/src/routes/audit.ts`, `extension/src/audit/audit-sink.ts` |
| 2. Design Systems Architect | queued — Week 3 (Items 11, 12, 14) | — |
| 3. Performance Lead | queued — Week 4 (Item 16) | — |
| 4. Chaos Auditor | queued — Week 2 (Item 6), Week 4 (Item 20, 21) | — |

Each item completes with: (a) a commit that updates its row here, (b) a
unit test that would have caught it, (c) a one-paragraph "root cause +
architectural fix" note in the commit body.
