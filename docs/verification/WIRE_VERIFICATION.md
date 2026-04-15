# Wire-Level Verification — "Did the pseudonym actually make it to the wire?"

## TL;DR — two levels of evidence

| Level | Who runs it | What it proves | Where |
|---|---|---|---|
| **Automated** (primary) | CI + anyone locally | The extension's fetch interceptor + body transformer strip PII before the request leaves the browser | `pnpm --filter @iron-gate/extension test:wire` — runs in CI via `.github/workflows/wire-verification.yml` |
| **Live** (corroborating) | Pilot security team, release QA | The same assertion against *production* chatgpt.com / claude.ai / gemini.google.com | This document's mitmproxy procedure, below |

The automated path is the gate. It loads the real extension into a real
Chromium, drives mocked ChatGPT / Claude / Gemini pages whose backend logs
every received body, and fails the build if any original PII string leaks
into an outbound request. Every PR that touches detection or content code
runs it.

The live mitmproxy path exists because an enterprise security team will,
rightly, want to *watch the bytes on the wire against production endpoints*
before they deploy to 200 lawyers. The assertion is identical; the target
is a real account instead of a mock.

## Why this document exists

IronGate's central claim to an enterprise customer is: **the raw prompt does
not leave the device**. We assert this architecturally — via CSP, via the
network guard, via the pseudonymization path — and we now also assert it by
bytes-in-bytes-out in CI. This runbook lets a customer's security team
reproduce the live variant on their own infrastructure if they want
corroborating evidence.

It runs against the three most consequential platforms:

| Platform | Adapter | Endpoint we expect to see pseudonymized |
|---|---|---|
| ChatGPT | `chatgpt` | `https://chatgpt.com/backend-api/conversation` |
| Claude | `claude` | `https://claude.ai/api/organizations/.../completion` |
| Gemini | `gemini` | `https://gemini.google.com/_/BardChatUi/data/...` |

## Prerequisites

- macOS or Linux (Windows works with WSL)
- `mitmproxy` ≥ 10.0 (`brew install mitmproxy` or `pip install mitmproxy`)
- Chrome/Edge with IronGate installed and enrolled to a test firm
- Ollama running locally with `gemma4:e2b` pulled
- **Test accounts** on ChatGPT, Claude, Gemini — do NOT run this against a
  real firm account; use a throwaway.

## The procedure

### 1. Boot mitmproxy

```sh
# Start mitmproxy in transparent mode on :8080
mitmweb --listen-port 8080 \
        --set save_stream_file=./wire-capture.mitm \
        --set flow_detail=3
```

The web UI opens at `http://127.0.0.1:8081`. Leave it running.

### 2. Install the mitmproxy CA

```sh
# mitmproxy generates its CA on first run; add to system trust
# macOS:
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem

# Linux:
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem \
  /usr/local/share/ca-certificates/mitmproxy.crt
sudo update-ca-certificates
```

Chrome needs a restart after cert install.

### 3. Route Chrome through the proxy

Start Chrome with proxy flags (this is the ONLY reliable way — system proxy
settings are bypassed by HTTP/3, which AI platforms use):

```sh
# macOS
open -na "Google Chrome" --args --proxy-server=http://127.0.0.1:8080 \
     --user-data-dir=/tmp/chrome-wire-test

# Linux
google-chrome --proxy-server=http://127.0.0.1:8080 \
              --user-data-dir=/tmp/chrome-wire-test
```

The separate user-data-dir keeps this out of your real Chrome profile.

### 4. Load IronGate into this throwaway Chrome

- `chrome://extensions` → enable Developer mode
- Load Unpacked → `apps/extension/dist/`
- Open the sidepanel, enroll in `Proxy (auto-pseudonymize)` mode

### 5. Run the harness

```sh
pnpm tsx scripts/verify-wire.ts
```

This opens the test prompts one by one (you paste them into ChatGPT/Claude/
Gemini) and the script watches mitmproxy's output for the pseudonymized
payload.

### 6. What "pass" looks like

For every scenario in the harness, the mitmproxy capture file must show:

1. **Outbound request body** containing the pseudonym, **not** the original.
   e.g., `"Robert Johnson"` becomes `"Felix Drummond"` (or whatever this
   firm's key produces).
2. **No occurrence** of the original PII string anywhere in the outbound
   request body, URL parameters, or cookies.
3. The *inbound* response body may contain the pseudonym — that's expected;
   the AI platform sees the pseudonymized text. The de-pseudonymization
   happens in the extension's stream-rewriter, not on the wire.

If any scenario shows the original PII in the outbound body, the run fails
and the capture is attached to the release ticket for triage.

### 7. Minimum scenarios (curated subset from the 166-battery)

| Category | Prompt | Expected pseudonym on wire |
|---|---|---|
| Legal | "Draft a settlement for my client Robert Johnson SSN 423-55-8901" | Robert Johnson → pseudonym; SSN → redacted |
| Healthcare | "Patient MRN 2024-88341 diagnosed with hypertension" | MRN → redacted |
| M&A | "Confidential: acquiring Meridian Health for $2.8B" | Meridian Health → pseudonym |
| Credentials | "Debug: Authorization: Bearer sk-proj-RealLookingKey…" | key → redacted |
| Personal | "Improve my resume: worked at Blackstone 2019-2022" | Blackstone → pseudonym (or kept, per firm policy) |

The harness script [scripts/verify-wire.ts](../../scripts/verify-wire.ts)
runs through these and prints a green/red verdict per scenario.

## What this does NOT verify

- It does not guarantee the extension won't exfiltrate on a FUTURE build —
  re-run the harness after every release.
- It does not test WebSocket or H3 traffic paths that bypass the proxy. In
  practice the major AI platforms fall back to HTTP/1.1 behind a proxy, but
  this should be re-verified periodically.
- It does not test the side-channel (clipboard, DOM capture) — those are
  covered by the unit-test suite (`tests/production-bugs-regression.test.ts`).

## Cadence

- **Every release**: run the full harness against all three platforms.
- **Every quarter**: re-run with a fresh mitmproxy capture and attach it
  to a security review report. Customers under a pilot MSA should be able
  to request this report.
