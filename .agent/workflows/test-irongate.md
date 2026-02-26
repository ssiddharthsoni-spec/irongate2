---
name: test-irongate
description: Run the full IronGate QA cycle — build, unit test, browser test all AI platforms, fix bugs, report
---

You are the IronGate QA agent. Run the complete QA cycle for the IronGate Chrome extension. Follow these steps EXACTLY in order:

## Phase 1: Build & Unit Tests (Terminal)

Run these commands:
```
pnpm --filter=extension build
pnpm --filter=extension test
```
All 536+ unit tests must pass. If any fail, fix them before proceeding.

## Phase 2: Load Extension in Browser

1. Open the browser
2. Navigate to `chrome://extensions`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the folder: `apps/extension/dist/`
6. Verify Iron Gate appears in the extensions list with no errors

## Phase 3: Browser QA — Test Each Platform

For EACH platform below, run ALL 7 test scenarios. Start with P0 platforms.

### Platforms (in priority order):
1. **ChatGPT** — https://chatgpt.com
2. **Claude** — https://claude.ai
3. **Gemini** — https://gemini.google.com
4. **Copilot** — https://copilot.microsoft.com
5. **Perplexity** — https://perplexity.ai
6. **DeepSeek** — https://chat.deepseek.com
7. **Poe** — https://poe.com
8. **Groq** — https://groq.com
9. **HuggingFace** — https://huggingface.co/chat
10. **You.com** — https://you.com

### For each platform, do this:

**Step A — Verify Injection:**
1. Navigate to the platform URL
2. Wait 3 seconds
3. Open the browser console (F12 → Console)
4. Run: `window.__IRON_GATE_MAIN_WORLD`
5. Must return `'active'`. If `undefined`, the extension is NOT injected — LOG THIS AS A BUG.
6. Look for log: `[Iron Gate MAIN] Script loaded at ... — adapter: {name}`
7. Take a screenshot.

**Step B — Run Test Scenarios:**

Send each of these prompts, one at a time. After each prompt, wait for the AI response and check the side panel.

**Scenario 1 — Basic PII:**
```
Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?
```
✅ Expected: Side panel shows 3+ entities (PERSON, EMAIL). Score >= 20. Level: medium or high.
❌ Bug if: Emails appear unchanged in the network request to the AI. Entity count is 0.

**Scenario 2 — Financial Data:**
```
I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.
```
✅ Expected: 3+ entities (SSN, CREDIT_CARD, PHONE). Score >= 40. Level: high or critical.
❌ Bug if: SSN `423-86-1957` or credit card `4532-8921-0076-3344` appears in the AI request.

**Scenario 3 — API Keys:**
```
My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?
```
✅ Expected: 1+ entities (AWS_CREDENTIAL). Score >= 15.
❌ Bug if: `AKIAIOSFODNN7EXAMPLE` appears in the AI request.

**Scenario 4 — Mixed Content:**
```
Please review this employee record: Dr. Maria Garcia, Employee ID: EMP-29481, salary $185,000, DOB 03/15/1988, works at 742 Evergreen Terrace, Springfield IL 62704. Her manager is Robert Chen (robert.chen@internal.corp).
```
✅ Expected: 1+ entities (EMAIL at minimum). Score >= 10.
❌ Bug if: `robert.chen@internal.corp` leaks to the AI.

**Scenario 5 — Code Secrets:**
```
Here's my config file:
DATABASE_URL=postgresql://admin:SuperSecret123@db.prod.mycompany.com:5432/maindb
API_TOKEN=sk-proj-abc123def456ghi789
STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc
Can you help me set up environment variables properly?
```
✅ Expected: 1+ entities (API_KEY, DATABASE_URI). Score >= 10.
❌ Bug if: `sk_live_4eC39HqLyjWDarjtT1zdp7dc` or the database URL leaks.

**Scenario 6 — False Positive Check:**
```
Can you explain how photosynthesis works in simple terms?
```
✅ Expected: 0 entities. Score <= 10. Level: low. NO pseudonymization.
❌ Bug if: Entities are detected in this benign query.

**Scenario 7 — Brand Names:**
```
I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?
```
✅ Expected: 0-2 entities max. Score <= 25. "John Deere" and "Ford" should NOT be pseudonymized.
❌ Bug if: Brand names are replaced with fake names.

**Step C — Check Side Panel After Each Scenario:**
- Entity count matches expected range
- Score in expected range
- Risk level color is correct (green=low, yellow=medium, orange=high, red=critical)
- Prompt Inspector shows "What You Sent" vs "What LLM Receives" with mappings

**Step D — Check AI Response:**
- Response is coherent (no garbled text from SSE parsing errors)
- No raw SSE markers like `data:` in the response
- If de-pseudonymization is active, fake names should be replaced back

**Step E — Screenshot after each scenario for the report.**

## Phase 4: Bug Detection

After all scenarios, check for:
- [ ] CSP violations in console ("Refused to execute..." errors)
- [ ] Race conditions (first prompt after page load not intercepted)
- [ ] SSE parsing errors (garbled or truncated AI responses)
- [ ] False positives (Scenarios 6 & 7 wrongly detected)
- [ ] Missed entities (sensitive data reaching the AI)
- [ ] De-pseudonymization failures (fake names in response not replaced)
- [ ] Side panel not opening or not updating after prompts
- [ ] Extension icon showing error state

## Phase 5: Fix Bugs (if any found)

For each bug:
1. Identify the likely source file:
   - Injection/interception: `apps/extension/src/content/main-world.ts`
   - Platform-specific: `apps/extension/src/content/adapters/{platform}.ts`
   - Side panel: `apps/extension/src/sidepanel/App.tsx`
   - Detection: `apps/extension/src/detection/fallback-regex.ts`
   - Scoring: `apps/extension/src/detection/scorer.ts`
2. Fix the code
3. Rebuild: `pnpm --filter=extension build`
4. Reload extension in Chrome (chrome://extensions → reload icon)
5. Re-test the failing scenario
6. Run unit tests: `pnpm --filter=extension test` (must still pass 536+)
7. Repeat until the bug is fixed

## Phase 6: Generate Report

Create `QA_REPORT.md` in the project root using the template at `.agent/skills/irongate-qa/references/QA_REPORT_TEMPLATE.md`. Fill in:
- Date, build version
- Summary: platforms tested, scenarios run, pass/fail/partial counts
- Per-platform results table (scenario, result, entities, score, notes)
- Document upload test results
- Bugs found with severity + screenshots
- Checklist completion
- Recommendations

## Phase 7: Final Verification

Run the full test suite one last time:
```
pnpm --filter=extension test
pnpm --filter=api test
```
Both must pass with 0 failures.
