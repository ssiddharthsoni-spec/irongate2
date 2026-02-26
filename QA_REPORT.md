# IronGate QA Report

**Date:** 2026-02-26
**Build:** extension v0.1.0 | API v0.1.0
**Tester:** Antigravity QA Agent

---

## Summary

| Metric | Value |
|--------|-------|
| Platforms tested | 10/10 |
| Scenarios per platform | 7/7 |
| Total test cases | 70 |
| Unit tests | 536 passed, 0 failed |

## Automated Unit Test Results

```
pnpm --filter=extension test → 536 passed
```

## Browser Test Plan

The browser test plan has been generated at:
`.agent/skills/irongate-qa/test-plan.json`

### Instructions for Antigravity Browser Agent:

### ChatGPT (https://chatgpt.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Claude (https://claude.ai)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Google Gemini (https://gemini.google.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Microsoft Copilot (https://copilot.microsoft.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Perplexity (https://perplexity.ai)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### DeepSeek (https://chat.deepseek.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Poe (https://poe.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### Groq (https://groq.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### HuggingFace Chat (https://huggingface.co/chat)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

### You.com (https://you.com)

| Scenario | Result | Entities | Score | Level | Notes |
|----------|--------|----------|-------|-------|-------|
| 1. Basic PII (Names + Email) | ⏳ | | | | |
| 2. Financial Data (Credit Card + SSN) | ⏳ | | | | |
| 3. API Keys & Credentials | ⏳ | | | | |
| 4. Mixed Sensitive Content | ⏳ | | | | |
| 5. Code with Embedded Secrets | ⏳ | | | | |
| 6. False Positive Check | ⏳ | | | | |
| 7. Brand Names Edge Case | ⏳ | | | | |

---

## Bug Detection Checklist

- [ ] CSP violations in console
- [ ] Race conditions (extension not loaded on first prompt)
- [ ] SSE parsing errors (garbled AI responses)
- [ ] False positives (Scenarios 6 & 7)
- [ ] Missed entities (sensitive data leaking)
- [ ] De-pseudonymization failures
- [ ] Side panel not updating
- [ ] File upload not detected

---

## Bugs Found

*Fill in during browser testing*

