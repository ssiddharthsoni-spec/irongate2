# IronGate Enterprise Security Whitepaper

**Document version:** 1.0
**Schema:** irongate.security.v1
**Audience:** Customer security teams, CISOs, compliance officers, vendor risk management
**Read time:** 30-45 minutes

---

## 1. Executive summary

IronGate is an AI Data Loss Prevention (DLP) product for Chrome that prevents employees from pasting sensitive data into AI tools (ChatGPT, Claude, Gemini, Copilot, and 6 others). It is the only AI DLP product where, in its default deployment mode, **no prompt content ever leaves the user's device**.

This document is for your security team. It explains:

1. The architecture, with a complete data flow diagram
2. Every network egress path and what triggers it
3. The threat model (what we defend against, what we don't)
4. The cryptographic primitives we use
5. How to verify the privacy contract independently

The most important thing to know: **the privacy contract is enforced by code and tests, not by policy or trust**. Our architecture invariant test suite (`apps/extension/tests/architecture-invariants.test.ts`) verifies on every commit that no code path can bypass the local-only mode. You can read the tests yourself.

---

## 2. Deployment modes

IronGate Enterprise supports three deployment modes, set by your IT team via Chrome Enterprise managed policy at install time:

### 2.1 `local-only` (Sovereign Mode — recommended for regulated firms)

- All detection runs on the user's device
- Tier 1 (regex) is in the extension itself
- Tier 2 (LLM classification) calls a local Ollama service on `127.0.0.1:11434`
- The extension refuses to call ANY non-localhost classification endpoint
- The extension fails CLOSED if the local LLM is unreachable — it will not silently fall back to a cloud service
- The deployment mode is locked at extension startup via `chrome.storage.managed`. Users, page scripts, and extension UI cannot override it.
- **This is the only mode that supports the "your prompts never leave your device" claim.**

### 2.2 `hybrid`

- Tier 1 runs locally
- Tier 2 prefers the local LLM but falls back to the IronGate server-side classification API if the local LLM is unreachable
- Used by customers transitioning from cloud DLP who want a safety net
- Sanitized text (entity types and counts only — no raw PII) may be sent to the IronGate API in fallback scenarios

### 2.3 `server-only` (legacy)

- Tier 1 runs locally
- Tier 2 disabled; AMBER-zone escalation goes to IronGate server-side classification
- Available for backwards compatibility with pre-1.0 deployments
- Deprecated for new customers

**Throughout this document, "Sovereign Mode" refers to deployment mode `local-only`.**

---

## 3. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         User's laptop                            │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  Chrome browser  │    │  Ollama service (localhost only) │   │
│  │                  │    │  127.0.0.1:11434                 │   │
│  │  ┌─────────────┐ │    │                                  │   │
│  │  │ AI tool tab │ │    │  ┌─────────────────────────────┐ │   │
│  │  │ (ChatGPT,   │ │    │  │ Llama 3.2 3B (2 GB on disk) │ │   │
│  │  │  Claude,    │ │    │  └─────────────────────────────┘ │   │
│  │  │  Gemini..)  │ │    │                                  │   │
│  │  └─────────────┘ │    │  Bound to localhost              │   │
│  │        │         │    │  (refuses external connections)  │   │
│  │        ▼         │    └──────────────────────────────────┘   │
│  │  ┌─────────────┐ │              ▲                            │
│  │  │  IronGate   │─┼──────────────┘                            │
│  │  │  extension  │ │  HTTP POST classification request         │
│  │  │             │ │  (only if Tier 1 marks AMBER zone)        │
│  │  └─────────────┘ │                                           │
│  │        │         │                                           │
│  └────────┼─────────┘                                           │
│           │                                                     │
│           ▼ (pseudonymized prompt only)                         │
└───────────┼─────────────────────────────────────────────────────┘
            │
            ▼
   ┌────────────────────────┐
   │ AI tool (ChatGPT etc.) │
   │  receives PSEUDONYMIZED│
   │  prompt — never the    │
   │  original PII          │
   └────────────────────────┘
```

In Sovereign Mode, **the only outbound network call from the user's device during detection** is to the AI tool itself, with already-pseudonymized prompt content. There is no other call. There is no IronGate cloud. There is no OpenAI or Anthropic call from IronGate.

---

## 4. Data flow

### 4.1 The detection pipeline

For each prompt the user submits to ChatGPT (or any supported AI tool):

1. **The IronGate content script intercepts** the network request via a `fetch` proxy installed in the page's MAIN world (per-page JavaScript isolated context).
2. **Tier 1 runs** in <5 ms — regex entity detection for SSN, credit cards, emails, phones, API keys, addresses, etc. Plus contextual scoring (keywords, document type, intent suppression).
3. **If Tier 1 returns RED** (score 61+), the prompt is pseudonymized using either the firm's deterministic pseudonymizer (if configured) or random fakes. The original prompt is replaced with the pseudonymized version inside the fetch request. **Original PII never leaves the device.**
4. **If Tier 1 returns AMBER** (score 26-60), the prompt is sent to the local Tier 2 LLM at `127.0.0.1:11434` for nuanced classification. The Tier 2 model responds with a refined score. If RED, the prompt is pseudonymized. If GREEN, it passes through.
5. **If Tier 1 returns GREEN** (score 0-25), the prompt passes through unmodified.
6. **The AI tool's response stream is wrapped** by IronGate to de-pseudonymize fake names back to originals before they're shown to the user. This happens in the page context — the de-pseudonymized text never touches a server.

### 4.2 What about server-side processing?

In Sovereign Mode, **none**. The Tier 3 server-side classification path is architecturally disabled. The relevant code is:

```typescript
// apps/extension/src/detection/tier2-adapter.ts
export function assertCloudCallsPermitted(callSite: string): void {
  const cfg = getLockedDeploymentConfig();
  if (cfg.deploymentMode === 'local-only') {
    throw new LocalDeploymentError(
      `Cloud call attempted from "${callSite}" but deployment mode is local-only.`,
      'CLOUD_CALL_IN_LOCAL_MODE',
    );
  }
}
```

Any code path that would make a Tier 3 server call is required to call this assertion first. In Sovereign Mode, the assertion throws. The architecture invariant tests verify that this assertion exists and is called from the Tier 3 code paths.

---

## 5. Network egress paths

This is the complete list of network destinations the IronGate extension will reach in Sovereign Mode. No other destinations are reachable.

| # | Destination | Triggered by | Purpose | Customer-controlled? |
|---|-------------|--------------|---------|---------------------|
| 1 | `127.0.0.1:11434` | Every AMBER-zone classification | Local LLM inference | N/A (localhost) |
| 2 | The AI tool's own API (e.g., `chatgpt.com/backend-api`) | User submits a prompt | Modified prompt with pseudonyms is sent here. This call would happen anyway — IronGate does not add it. | N/A |
| 3 | `policyBundleUrl` (if configured) | Once per hour | Fetch the customer's signed detection policy bundle | **Yes** — set by IT |
| 4 | `auditLogConfig.url` (if `auditLogDestination` is set) | Every 5s or 50 entries | Send audit log batch to customer's S3/syslog/webhook | **Yes** — set by IT |

That's it. Four destinations. Two of them are localhost or the AI tool itself. The other two are customer-controlled and only active if the customer chose to enable them.

In `auditLogDestination = 'none'` (the default), there is no audit log egress. Audit entries are stored in IndexedDB on the user's device for the user's own session view but never transmitted anywhere.

### 5.1 What is NOT in the egress list

In Sovereign Mode, IronGate does NOT reach:

- `irongate-api.onrender.com` (IronGate's API server)
- `api.openai.com`, `api.anthropic.com`, or any other cloud LLM provider
- Any IronGate-controlled domain
- Any Google, Microsoft, Amazon, or third-party telemetry endpoint
- Any analytics service (Datadog, Sentry, Mixpanel, etc.)

This is enforced by:
1. The Tier 2 adapter validates that `localEndpoint` is `localhost` or `127.0.0.1` — non-localhost URLs are rejected with `NON_LOCAL_ENDPOINT_IN_LOCAL_MODE`
2. The Tier 3 server adapter checks `assertCloudCallsPermitted()` and throws in local-only mode
3. The CSP in `manifest.json` restricts `connect-src` to the configured local endpoints

---

## 6. Threat model

### 6.1 Threats we defend against

| Threat | Mitigation |
|---|---|
| **Employee accidentally pastes PII into ChatGPT** | Tier 1 detects, Tier 2 confirms, content is pseudonymized before leaving the page |
| **IronGate's servers get breached** | We don't have your data — there's nothing to breach |
| **IronGate gets subpoenaed for customer prompts** | We have nothing to produce |
| **A cloud LLM provider trains on customer data** | The provider only sees pseudonymized text |
| **Network man-in-the-middle on classification calls** | Classification is `127.0.0.1` — no MITM possible without compromising the device itself |
| **Page script attempts to disable IronGate** | The deployment mode is read from `chrome.storage.managed` (admin-only) and frozen via `Object.freeze`. Page scripts cannot mutate it. |
| **User attempts to disable IronGate** | Sovereign Mode is locked by Chrome Enterprise managed policy. Users have no UI to disable it. |
| **Extension auto-update changes behavior** | Architecture invariant tests in source code prevent code changes that would weaken the contract from passing CI |
| **Detection rules are tampered with** | Customer-controlled signed policy bundles use Ed25519 signatures verified against a write-once bound public key |

### 6.2 Threats we do NOT defend against

We are honest about what is and isn't in scope. IronGate is one layer of defense; it does not replace endpoint security, network monitoring, or DLP-at-egress.

| Threat | Why not in scope | What you should do |
|---|---|---|
| **A compromised endpoint with malware** | If the user's laptop is owned, the attacker can read clipboard, screen, and bypass any browser-based DLP | Endpoint EDR (CrowdStrike, SentinelOne, etc.) |
| **A user takes a screenshot and emails it** | IronGate is browser-based; we can't see screenshots | Network DLP, email security |
| **A user manually retypes data into a non-supported AI tool** | We support 10 platforms; new ones appear regularly | Block unsupported platforms via firewall |
| **The local LLM hallucinates a wrong classification** | Tier 1 regex is the safety net for high-confidence PII; Tier 2 LLM is for ambiguity. We pick a model with 93%+ accuracy and validate on every release. | Combine with periodic random sampling audit |
| **The user disables Ollama / kills the service** | Detection degrades to Tier 1 only. We surface this in the sidepanel + via desktop notification + via the audit log. | Monitor via `irongate-healthcheck.mjs` and your fleet management system |

---

## 7. Cryptographic primitives

### 7.1 Signed policy bundles (Ed25519)

When a customer hosts their own detection policy bundles, the bundles are signed with the customer's Ed25519 private key. The corresponding public key is bound to the device via `bindPolicyPublicKey()` at install time and stored in `chrome.storage.local` as a write-once value.

```
bundle.signature = ed25519_sign(canonical_json(bundle without signature), customer_private_key)
verify = ed25519_verify(bundle.signature, canonical_json(bundle), bound_public_key)
```

The canonical JSON serialization sorts object keys recursively to ensure the producer and verifier compute the same bytes.

Implemented via WebCrypto SubtleCrypto Ed25519 (Chrome 113+). Key rotation requires uninstalling and reinstalling the extension on the device.

### 7.2 Per-firm deterministic pseudonymization (HKDF-SHA256)

When a customer configures `pseudonymKey` in managed policy, IronGate derives consistent fake names per firm using HKDF:

```
pseudonym = pickFromPool(HKDF-SHA256(firmKey, salt=entityType, info=originalText))
```

This means:
- User A and user B at the same firm both pseudonymize "Sarah Chen" to the same fake name
- A different firm pseudonymizes "Sarah Chen" to a different fake name
- An attacker who obtains audit logs from one firm cannot use them to deanonymize logs from another firm

The `firmKey` is a 32-byte secret (64 hex chars) generated by `openssl rand -hex 32` and pushed to devices via managed config. It must be rotated periodically and stored in your secrets management system (Vault, AWS Secrets Manager, etc.).

### 7.3 SubtleCrypto-based hashing for audit correlation

Device hashes in audit logs are SHA-256 of a per-device random UUID stored in `chrome.storage.local`. The hash is non-reversible — IronGate cannot recover the device identity from the hash. The customer can correlate logs from the same device because the same hash appears across entries.

---

## 8. The architecture invariant tests

This is the most important section of this document for your security team.

IronGate enforces its privacy contract via tests that run on every commit to source. If a code change violates the contract, the test fails and the change cannot be merged. You can read the tests directly:

**File:** `apps/extension/tests/architecture-invariants.test.ts`

The tests verify, among other things:

1. `addReverseMapping(currentReverseMap, ...)` is called from exactly **one** place in the extension (the centralized hook). Any direct call elsewhere is a bug.
2. The Tier 2 adapter validates that `localEndpoint` is `localhost` or `127.0.0.1` in local-only mode.
3. The Tier 2 adapter throws `LocalDeploymentError` when local LLM fails — no silent cloud fallback.
4. The locked deployment config uses `Object.freeze` so it cannot be mutated post-init.
5. The manifest references `managed_schema.json` and the schema defines `deploymentMode` as required.
6. The default `auditLogDestination` is `'none'` — privacy-first.
7. The worker calls `initLocalLlmDeployment()` at startup before any classification.
8. The worker exposes deployment status to the sidepanel.
9. The Tier 2 system prompt includes corrections for the two known model failure modes.
10. JSON parsing uses brace-counting (not regex) for nested object support.
11. All deployment templates default to local-only with the validated default model.
12. The IT health check tool is standalone (no third-party dependencies).
13. `Symbol.for()` is not used for security guards (per the H-15 fix).
14. `originalPrompt` is not transmitted via `postMessage` (per the M-7 fix).
15. `encryptedGet` does not fall back to plaintext on decryption failure (per the CRIT-4 fix).

There are 33 tests total. They run on every commit and every push. They are in source. They are auditable.

**Your security team should read them as part of your review.** They are the specification of the privacy contract, written in code rather than English.

---

## 9. Deployment

### 9.1 What gets installed

1. **The IronGate Chrome extension** — installed via Chrome Enterprise managed policy (force-install)
2. **Ollama** — local LLM inference runtime, ~50 MB binary, runs as a system service on `127.0.0.1:11434`
3. **Llama 3.2 3B model** — ~2 GB GGUF file, pulled by Ollama on first run

### 9.2 Hardware requirements

| Component | Minimum | Recommended |
|---|---|---|
| **OS** | macOS 13+, Windows 10+, modern Linux | macOS 14+, Windows 11 |
| **CPU** | 4 cores | 8 cores |
| **RAM** | 8 GB | 16 GB |
| **Disk** | 4 GB free (1 GB Ollama + 2 GB model + headroom) | 10 GB free |
| **Network** | None for inference; unmetered for first-time model pull | Same |

**Note on Apple Silicon:** M-series Macs use unified memory; the 8 GB requirement is shared between CPU and GPU. M1/M2 with 16 GB is comfortable.

### 9.3 Distribution channels

Enterprise customers get IronGate through Chrome Enterprise managed policy plus an installer for Ollama:

| Tool | Format | Template provided |
|---|---|---|
| Microsoft Intune | Configuration Profile (XML) | `enterprise/deployment-templates/intune-policy.xml` |
| Jamf Pro | Configuration Profile (plist) | `enterprise/deployment-templates/jamf-policy.plist` |
| Google Workspace Admin | Managed policy (JSON) | `enterprise/deployment-templates/workspace-policy.json` |

The deployment templates include placeholders for your firm's specific values (firm ID, policy bundle URL, audit log destination, pseudonym key). Replace the placeholders, push the policy, validate on a pilot machine with `irongate-healthcheck.mjs`, then roll out.

---

## 10. Compliance posture

### 10.1 GDPR

**Data processor status:** None. IronGate does not process customer personal data because customer personal data never reaches IronGate's infrastructure in Sovereign Mode.

**Data protection impact assessment (DPIA):** IronGate's role in your DPIA is to *reduce* data exposure, not introduce it. The DPIA should note that IronGate runs locally and does not share data with subprocessors.

**Cross-border transfers:** None. There is no transfer to assess.

### 10.2 HIPAA

**Business Associate status:** None required. IronGate does not see, store, transmit, or process Protected Health Information. We are not a Business Associate because there is no PHI to handle.

This is the same architectural posture as Apple's on-device dictation: the vendor's product runs locally, the vendor never sees the data, no BAA is required.

### 10.3 SOC 2

IronGate Sovereign Mode has a dramatically reduced SOC 2 scope because the data flows that are typically in scope (customer data ingestion, processing, storage) do not exist. The relevant trust services criteria are:

- **Security:** Apply to the extension code itself (signing, vulnerability management, secure development lifecycle)
- **Availability:** Apply to model distribution and policy bundle hosting (customer-controlled)
- **Confidentiality:** Trivially satisfied — no customer data ever exists in IronGate's infrastructure

A standard SOC 2 Type II audit takes IronGate ~6 weeks because there is so little to audit.

### 10.4 Industry-specific

| Framework | IronGate posture |
|---|---|
| **HIPAA** | Not a Business Associate; PHI never leaves device |
| **GLBA** | Customer financial data never leaves the firm's network |
| **CMMC** | Compatible with Level 3 air-gapped requirements |
| **FedRAMP** | Not applicable (no cloud service to authorize) |
| **PCI-DSS** | Cardholder data is detected by Tier 1 regex and pseudonymized; no transmission to third parties |
| **ABA Model Rule 1.6** | Attorney-client privileged content never leaves the device |

---

## 11. Independent verification

You don't have to take our word for any of this. Here is how to verify the privacy contract independently:

### 11.1 Verify the source code

The IronGate extension source is available under NDA for security review. Read:

1. `apps/extension/src/detection/tier2-adapter.ts` — the Tier 2 adapter and its hard fail-closed contract
2. `apps/extension/src/worker/index.ts` — the service worker startup that locks the deployment mode
3. `apps/extension/managed_schema.json` — the IT-deployable contract
4. `apps/extension/tests/architecture-invariants.test.ts` — the test suite that enforces the contract

### 11.2 Verify the network behavior on a deployed device

After deploying to a pilot machine, run a packet capture (Wireshark, tcpdump) for 1 hour while the user does normal work in ChatGPT/Claude/Gemini. You should see:

- Requests to the AI tool's domain (e.g., `chatgpt.com`)
- Local connections to `127.0.0.1:11434` (Ollama)
- Optionally: requests to your own audit sink and policy bundle URLs (if configured)

You should NOT see requests to `irongate-api.onrender.com`, `api.openai.com`, `api.anthropic.com`, or any other cloud LLM provider.

### 11.3 Verify the model weights

The Gemma 4 e2b model is published by Google under the Gemma Terms of Use. Download it independently from `https://ollama.com/library/gemma4:e2b` and verify the SHA-256 matches what we ship.

### 11.4 Run the health check

```bash
node scripts/irongate-healthcheck.mjs --json
```

This is a standalone tool with no dependencies. It runs 5 checks:
1. Ollama endpoint reachable
2. Expected model loaded
3. Cold inference works
4. Latency under tolerance
5. Classification accuracy on a 6-scenario sanity test

JSON output for SIEM ingestion. Exit code 0 = healthy, 1 = degraded, 2 = unhealthy.

---

## 12. Contact

For security-specific questions: **security@irongate.ai**
For deployment support: **enterprise@irongate.ai**

We respond to security inquiries within 1 business day. We are happy to do a live walkthrough of the source code with your security team — schedule via the contact above.

---

**Document end. This whitepaper is part of the IronGate Enterprise deployment package.
The architecture it describes is enforced by the test suite at apps/extension/tests/architecture-invariants.test.ts.
If you find a discrepancy between this document and the source code, report it to security@irongate.ai immediately.**
