---
name: Invisible Pseudonymization Principle
description: Pseudonymization must be invisible to the user — they should never see fake names in their own messages or AI responses. The wire layer modifies API requests, de-pseudo layer restores originals in responses AND user message bubbles.
type: feedback
---

**Core product principle**: Iron Gate's pseudonymization is an INVISIBLE layer.

1. **Detection & Pseudonymization**: Detects sensitive data in prompts before they reach LLMs and replaces them with realistic fake pseudonyms in real-time — on the wire only.
2. **Response De-pseudonymization**: Streams the AI response back and replaces fake names with originals, so the user sees natural context while actual PII never leaves the browser.
3. **User message bubble**: The user must NEVER see pseudonymized text in their own message. On platforms where the UI renders from the API payload (Claude, Gemini), the user's message bubble must be de-pseudonymized in the DOM after rendering.

The user should NEVER be aware that pseudonymization happened — the only indication is the sidepanel showing what was protected. Input and output should always show original text to the user.
