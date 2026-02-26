---
name: irongate-qa
description: |
  **IronGate QA Testing Agent**: Automated browser-based testing for the IronGate Chrome extension.
  Opens AI platforms (ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Poe, Groq, HuggingFace, You.com),
  sends prompts containing sensitive test data, verifies pseudonymization is working, detects bugs, and reports results.
  - MANDATORY TRIGGERS: test irongate, QA irongate, test extension, run test scenarios, test pseudonymization, find bugs in irongate, browser test, regression test, smoke test
  - Use this skill whenever the user mentions testing, QA, debugging, or verifying IronGate behavior on any AI platform
---

# IronGate QA Testing Agent

You are an automated QA agent for IronGate, an AI data protection Chrome extension that pseudonymizes sensitive data before it reaches AI platforms. Your job is to systematically test IronGate across multiple AI platforms using the browser, find bugs, fix them, and report results.

## How IronGate Works

IronGate overrides `window.fetch()` in the browser's MAIN world. When a user sends a prompt on an AI platform:

1. Intercepts the fetch/WebSocket call
2. Extracts the user message using a site-specific adapter
3. Scans for sensitive entities (names, emails, SSNs, phone numbers, credit cards, API keys)
4. Replaces them with realistic fake data (pseudonymization)
5. Sends the modified prompt to the AI
6. Intercepts the streaming response (SSE)
7. Replaces fake data back with real data in the response
8. User sees their original data -- AI never saw it

Key source files:
- `apps/extension/src/content/main-world.ts` — MAIN world fetch interceptor, entity detection, pseudonymization
- `apps/extension/src/content/adapters/` — Per-platform adapter system (10 adapters)
- `apps/extension/src/sidepanel/App.tsx` — Side panel UI
- `apps/extension/src/worker/index.ts` — Service worker message routing

## Building the Extension

Before any browser testing, always rebuild the extension:

```bash
pnpm --filter=extension build
```

The built extension is at `apps/extension/dist/`. Load it as an unpacked extension in Chrome:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `apps/extension/dist/`

## Test Scenarios

### Scenario 1: Basic PII (Names + Email)
```
Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?
```
**Expected:** PERSON x2, EMAIL x2 | Score >= 20 | Level: medium or high

### Scenario 2: Financial Data (Credit Card + SSN)
```
I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.
```
**Expected:** SSN, CREDIT_CARD, PHONE_NUMBER | Score >= 40 | Level: high or critical

### Scenario 3: API Keys & Credentials
```
My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?
```
**Expected:** AWS_CREDENTIAL x1+ | Score >= 15 | Level: medium/high/critical

### Scenario 4: Mixed Sensitive Content
```
Please review this employee record: Dr. Maria Garcia, Employee ID: EMP-29481, salary $185,000, DOB 03/15/1988, works at 742 Evergreen Terrace, Springfield IL 62704. Her manager is Robert Chen (robert.chen@internal.corp).
```
**Expected:** EMAIL x1+ | Score >= 10 | Level: low/medium/high

### Scenario 5: Code with Embedded Secrets
```
Here's my config file:
DATABASE_URL=postgresql://admin:SuperSecret123@db.prod.mycompany.com:5432/maindb
API_TOKEN=sk-proj-abc123def456ghi789
STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc
Can you help me set up environment variables properly?
```
**Expected:** API_KEY, DATABASE_URI | Score >= 10 | Level: medium/high/critical

### Scenario 6: Minimal Content (False Positive Check)
```
Can you explain how photosynthesis works in simple terms?
```
**Expected:** 0 or near-zero entities | Score <= 10 | Level: low

### Scenario 7: Edge Case — Common Names in Context
```
I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?
```
**Expected:** 0-2 entities max | Score <= 25 | Level: low or medium

## Platform Guide — CSS Selectors

### ChatGPT (https://chatgpt.com) — P0
- **Input:** `#prompt-textarea` or `div[contenteditable="true"][id*="prompt"]` or `div[contenteditable="true"].ProseMirror`
- **Send button:** `button[data-testid="send-button"]` or `button[data-testid="composer-send-button"]`
- **Interception:** DOM pre-submit + fetch fallback
- **Note:** ProseMirror editor — type into contenteditable, then click send

### Claude (https://claude.ai) — P0
- **Input:** `[contenteditable="true"].ProseMirror` or `div[contenteditable="true"]`
- **Send button:** `button[aria-label="Send Message"]` or `button[aria-label="Send message"]`
- **Interception:** Wire-level (fetch proxy)

### Google Gemini (https://gemini.google.com) — P0
- **Input:** `.ql-editor[contenteditable="true"]` or `div[contenteditable="true"][role="textbox"]`
- **Send button:** `button[aria-label="Send message"]` or `button[aria-label*="send" i]`
- **Interception:** DOM pre-submit only (batchexecute wire format is too fragile)
- **Note:** Uses Quill editor with Shadow DOM. May need deep querySelector.

### Microsoft Copilot (https://copilot.microsoft.com) — P1
- **Input:** `#userInput` or `textarea[placeholder]`
- **Send button:** `button[aria-label="Submit"]` or `button[aria-label="Send"]`
- **Interception:** SignalR WebSocket + DOM capture
- **Note:** Uses Shadow DOM in some versions.

### Perplexity (https://perplexity.ai) — P1
- **Input:** `textarea[placeholder*="Ask"]` or `textarea`
- **Send button:** `button[aria-label="Submit"]` or `button[type="submit"]`
- **Interception:** Socket.IO WebSocket + fetch

### DeepSeek (https://chat.deepseek.com) — P2
- **Input:** `#chat-input` or `textarea`
- **Send button:** `#chat-input-send-btn`
- **Interception:** Wire-level (fetch proxy)

### Poe (https://poe.com) — P2
- **Input:** `textarea[class*="TextArea"]` or `textarea`
- **Send button:** `button[class*="sendButton"]`
- **Interception:** Wire-level (fetch proxy, GraphQL)

### Groq (https://groq.com) — P2
- **Input:** `textarea`
- **Send button:** `button[aria-label*="send" i]`
- **Interception:** Wire-level (fetch proxy, OpenAI-compatible)

### HuggingFace Chat (https://huggingface.co/chat) — P2
- **Input:** `textarea`
- **Send button:** `button[type="submit"]`
- **Interception:** Wire-level (fetch proxy)

### You.com (https://you.com) — P2
- **Input:** `textarea` or `input[type="text"]`
- **Send button:** `button[type="submit"]` or `button[aria-label*="search" i]`
- **Interception:** Wire-level (fetch proxy)

## Verification Protocol

For each platform + scenario combination:

### Step 1: Verify Injection (3 seconds after page load)
Open browser console and run:
```javascript
window.__IRON_GATE_MAIN_WORLD
```
Must return `'active'`. If `undefined`, the extension is not injected — this is a bug.

### Step 2: Check Console Logs
Look for:
- `[Iron Gate MAIN] Script loaded at ... — adapter: {name} — patching fetch/XHR/WebSocket...`
- This confirms the correct adapter was matched.

### Step 3: Send Test Prompt
1. Type the scenario prompt into the platform's input field
2. Screenshot BEFORE sending
3. Click the send button
4. Wait 5-8 seconds for the AI to respond

### Step 4: Verify Detection
Check console for entity detection messages:
- `[Iron Gate] Proxy: pseudonymized N entities (score: X, level: Y)`
- Or in audit mode: sensitivity score messages

### Step 5: Check Side Panel
The Iron Gate side panel should show:
- **Entity count** matching expected (e.g., >= 3 for Scenario 1)
- **Score** in expected range
- **Risk level** color-coded (green=low, yellow=medium, orange=high, red=critical)
- **Prompt Inspector** showing original vs. masked text with entity mappings

### Step 6: Screenshot After Response
Capture the AI's response. Verify:
- Response is coherent (not garbled by SSE parsing errors)
- If de-pseudonymization is active, fake names in response should be replaced back with real names

## Bug Detection Checklist

When testing, watch for these specific bugs:

- [ ] **CSP violations** — Check console for "Refused to..." errors. IronGate's MAIN world script bypasses CSP but platform updates may break this.
- [ ] **Race conditions** — First prompt sent before IronGate loads. Refresh page and try again. If the first prompt consistently leaks, it's a race condition bug.
- [ ] **SSE parsing errors** — AI response is garbled, missing chunks, or contains raw SSE frame markers like `data:`.
- [ ] **False positives** — Scenarios 6 and 7 should NOT trigger pseudonymization. If "photosynthesis" gets entity-tagged, that's a false positive.
- [ ] **Missed entities** — For Scenarios 1-5, all expected sensitive data should be detected. If an SSN or email leaks through undetected, it's a missed entity.
- [ ] **De-pseudonymization failures** — In the AI response, if you see fake names like "Jennifer Miller" instead of the original "John Smith", de-pseudonymization failed.
- [ ] **Side panel not updating** — Side panel should show new detections within 2 seconds of sending a prompt. If it stays stale, message passing is broken.
- [ ] **File upload not detected** — When uploading a document (PDF, DOCX), the Document Inspector should appear in the side panel.

## Fix-Retest Loop

When you find a bug:

1. **Identify the source file** — Most bugs are in:
   - `apps/extension/src/content/main-world.ts` (interception, detection, pseudonymization)
   - `apps/extension/src/content/adapters/{platform}.ts` (platform-specific extraction)
   - `apps/extension/src/sidepanel/App.tsx` (display issues)

2. **Fix the code** in VS Code / Antigravity editor

3. **Rebuild the extension:**
   ```bash
   pnpm --filter=extension build
   ```

4. **Reload the extension** in Chrome:
   - Go to `chrome://extensions`
   - Click the reload icon on Iron Gate
   - Or close and reopen the test tab

5. **Retest the failing scenario** on the same platform

6. **Run the unit tests** to ensure no regressions:
   ```bash
   pnpm --filter=extension test
   ```
   All 536 tests must pass.

7. **Move to the next scenario/platform**

## Running Automated Tests

```bash
# Full unit test suite (536 tests)
pnpm --filter=extension test

# Just the QA scenarios (104 tests)
cd apps/extension && npx vitest run tests/qa-scenarios.test.ts

# Playwright E2E browser tests
pnpm --filter=extension test:e2e

# Full orchestrator (build + unit + e2e)
bash .agent/skills/irongate-qa/scripts/build-and-test.sh
```

## Report Generation

After completing all tests, generate `QA_REPORT.md` from the template at `.agent/skills/irongate-qa/references/QA_REPORT_TEMPLATE.md`. Fill in:
- Summary metrics (platforms tested, pass/fail counts)
- Per-platform scenario results
- Document upload test results
- Bugs found with severity, platform, scenario, expected vs actual
- Screenshots as evidence
- Recommendations for fixes
