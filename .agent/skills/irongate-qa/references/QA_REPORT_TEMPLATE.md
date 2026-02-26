# IronGate QA Report

**Date:** YYYY-MM-DD
**Build:** extension vX.Y.Z | API vX.Y.Z
**Tester:**

---

## Summary

| Metric | Value |
|--------|-------|
| Platforms tested | /10 |
| Scenarios run | /7 |
| Pass | |
| Fail | |
| Partial | |
| Critical bugs | |
| Minor bugs | |

## Automated Test Results

```
pnpm --filter=extension test
pnpm --filter=api test
```

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| Extension — Detection Pipeline | | | |
| Extension — Adapter Pseudonym | | | |
| Extension — E2E Full Pipeline | | | |
| Extension — QA Scenarios | | | |
| Extension — WS False Positive | | | |
| API — Extraction | | | |
| API — Route Validation | | | |
| API — Detection Pipeline | | | |
| **Total** | | | |

---

## Results by Platform

### ChatGPT (chatgpt.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1. Basic PII | | | | |
| 2. Financial Data | | | | |
| 3. API Keys | | | | |
| 4. Mixed Content | | | | |
| 5. Code Secrets | | | | |
| 6. False Positive | | | | |
| 7. Brand Names | | | | |
| Doc Upload (PDF) | | | | |

### Claude (claude.ai)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### Gemini (gemini.google.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### Copilot (copilot.microsoft.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### Perplexity (perplexity.ai)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### DeepSeek (chat.deepseek.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### Poe (poe.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### Groq (groq.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### HuggingFace (huggingface.co/chat)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

### You.com (you.com)

| Scenario | Result | Entities | Score | Notes |
|----------|--------|----------|-------|-------|
| 1-7 | | | | |
| Doc Upload | | | | |

---

## Document Upload Detection

| File Type | Supported | Backend Extraction | Test Result |
|-----------|-----------|-------------------|-------------|
| PDF | Yes | pdf-parse | |
| DOCX | Yes | mammoth | |
| XLSX | Yes | xlsx | |
| PPTX | Yes | jszip | |
| TXT | Yes | utf-8 | |
| CSV | Yes | utf-8 | |
| RTF | Yes | regex strip | |
| HTML | Yes | tag strip | |
| MD | Yes | utf-8 | |
| JSON | Yes | recursive extract | |

---

## Bugs Found

### BUG-001: [Title]
- **Severity:** Critical / High / Medium / Low
- **Platform:**
- **Scenario:**
- **Expected:**
- **Actual:**
- **Screenshot:**
- **Suggested fix:** `file:line`

---

## Checklist

- [ ] CSP violations in console
- [ ] Race conditions (IronGate not loaded on first prompt)
- [ ] SSE parsing errors (garbled AI responses)
- [ ] False positives (Scenario 6 & 7)
- [ ] Missed entities (sensitive data leaking through)
- [ ] De-pseudonymization failures (fake names in AI responses)
- [ ] Side panel not opening or updating
- [ ] File upload not detected
- [ ] Document Inspector shows correct score/entities

---

## Recommendations

1.
2.
3.
