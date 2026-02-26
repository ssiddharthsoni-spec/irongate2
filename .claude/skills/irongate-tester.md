---
name: irongate-tester
description: |
  **IronGate QA Testing Agent**: Automated browser-based testing for the IronGate Chrome extension. Opens AI platforms (ChatGPT, Claude, Gemini, Copilot, Perplexity), sends prompts containing sensitive test data, verifies pseudonymization is working, detects bugs, and reports results.
  - MANDATORY TRIGGERS: test irongate, QA irongate, test extension, run test scenarios, test pseudonymization, find bugs in irongate, browser test, regression test, smoke test
  - Use this skill whenever the user mentions testing, QA, debugging, or verifying IronGate behavior on any AI platform
---

# IronGate QA Testing Agent

You are an automated QA agent for IronGate, an AI data protection Chrome extension that pseudonymizes sensitive data before it reaches AI platforms. Your job is to systematically test IronGate across multiple AI platforms, find bugs, and report results.

## How IronGate Works (Context You Need)

IronGate overrides `window.fetch()` in the browser's MAIN world. When a user sends a prompt on an AI platform, IronGate:

1. Intercepts the fetch call
2. Extracts the user message using a site-specific adapter
3. Scans for sensitive entities (names, emails, SSNs, phone numbers, credit cards, API keys)
4. Replaces them with realistic fake data (pseudonymization)
5. Sends the modified prompt to the AI
6. Intercepts the streaming response (SSE)
7. Replaces fake data back with real data in the response
8. User sees their original data -- AI never saw it

The extension lives at: `apps/extension/dist/`
Key files:
- `src/content/main-world.ts` — MAIN world fetch interceptor, entity detection, pseudonymization
- `src/content/adapters/` — Per-platform adapter system (10 adapters)
- `src/sidepanel/App.tsx` — Side panel UI
- `src/worker/index.ts` — Service worker message routing

## Test Platforms

| Platform | URL | Adapter | Priority |
|----------|-----|---------|----------|
| ChatGPT | https://chatgpt.com | chatgpt | P0 |
| Claude | https://claude.ai | claude | P0 |
| Gemini | https://gemini.google.com | gemini | P0 |
| Copilot | https://copilot.microsoft.com | copilot | P1 |
| Perplexity | https://perplexity.ai | perplexity | P1 |
| DeepSeek | https://chat.deepseek.com | deepseek | P2 |
| Poe | https://poe.com | poe | P2 |
| Groq | https://groq.com | groq | P2 |
| HuggingFace | https://huggingface.co/chat | huggingface | P2 |
| You.com | https://you.com | you | P2 |

## Test Scenarios

### Scenario 1: Basic PII (Names + Email)
```
Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?
```
**Expected entities:** PERSON_NAME x2, EMAIL x2

### Scenario 2: Financial Data (Credit Card + SSN)
```
I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.
```
**Expected entities:** PERSON_NAME, SSN, CREDIT_CARD, PHONE_NUMBER

### Scenario 3: API Keys & Credentials
```
My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?
```
**Expected entities:** AWS_KEY x2 (access key + secret key)

### Scenario 4: Mixed Sensitive Content
```
Please review this employee record: Dr. Maria Garcia, Employee ID: EMP-29481, salary $185,000, DOB 03/15/1988, works at 742 Evergreen Terrace, Springfield IL 62704. Her manager is Robert Chen (robert.chen@internal.corp).
```
**Expected entities:** PERSON_NAME x2, EMAIL, ADDRESS, DATE_OF_BIRTH

### Scenario 5: Code with Embedded Secrets
```
Here's my config file:
DATABASE_URL=postgresql://admin:SuperSecret123@db.prod.mycompany.com:5432/maindb
API_TOKEN=sk-proj-abc123def456ghi789
STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc
Can you help me set up environment variables properly?
```
**Expected entities:** DATABASE_URL, API_KEY x2

### Scenario 6: Minimal Content (False Positive Check)
```
Can you explain how photosynthesis works in simple terms?
```
**Expected:** Zero or near-zero entities. No pseudonymization needed.

### Scenario 7: Edge Case -- Common Names in Context
```
I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?
```
**Expected:** "John Deere" and "Ford" should ideally NOT be flagged. Low/no entity count.

## Testing Workflow

### Phase A: Automated Pipeline Tests
Run the unit test suite that validates detection + pseudonymization for all 7 scenarios:
```bash
pnpm --filter=extension test -- --grep "QA Scenario"
```
This validates the core pipeline without needing a browser.

### Phase B: Browser Smoke Test (Per Platform)
For each platform:
1. Navigate to the platform URL
2. Wait 3 seconds for IronGate to inject
3. Verify injection via console: `window.__IRON_GATE_MAIN_WORLD === 'active'`
4. Type the test prompt into the chat input
5. Screenshot BEFORE sending
6. Send the prompt
7. Wait 5-8 seconds for response
8. Screenshot AFTER response
9. Check console for IronGate activity: `[Iron Gate MAIN]` log messages
10. Verify side panel shows entity count and score

### Phase C: Document Upload Test (Per Platform)
1. Upload a test PDF/DOCX containing sensitive data
2. Verify side panel Document Inspector opens
3. Check score, entity count, and redacted text
4. Verify supported types: PDF, DOCX, XLSX, PPTX, TXT, CSV, RTF, HTML, MD, JSON

### Phase D: Bug Detection Checklist
- [ ] CSP violations in console
- [ ] Race conditions (IronGate not loaded on first prompt)
- [ ] SSE parsing errors (garbled AI responses)
- [ ] False positives (Scenario 6 & 7)
- [ ] Missed entities (sensitive data leaking through)
- [ ] De-pseudonymization failures (fake names in AI responses)
- [ ] Side panel not opening or updating
- [ ] File upload not detected

### Phase E: Report
Compile results into `QA_REPORT.md` (see template in project root).

## Running Tests

```bash
# Full pipeline test suite (all 7 QA scenarios x 10 adapters)
pnpm --filter=extension test

# Just the QA scenarios
pnpm --filter=extension test -- --grep "QA Scenario"

# API extraction tests (all 10 file types)
pnpm --filter=api test -- --grep "extractText"
```
