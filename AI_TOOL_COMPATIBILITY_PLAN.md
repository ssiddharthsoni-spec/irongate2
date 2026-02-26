# Iron Gate — Per-AI Tool Compatibility Plan

## Architecture Overview

Iron Gate intercepts LLM API requests via three strategies:
1. **Wire interception** — Patch `window.fetch` / `XMLHttpRequest` / `WebSocket.prototype.send` in the MAIN world, modify JSON body in-flight
2. **DOM pre-submit** — Write pseudonymized text to the input element BEFORE the framework reads it and builds the request
3. **DOM capture-wire** — Capture text on submit, store pending pseudonym, then replace in the WebSocket frame via `WS.prototype.send`

De-pseudonymization uses two paths:
- **Stream wrapping** — Wrap the fetch `Response` with a `TransformStream` that replaces pseudonyms in SSE chunks
- **DOM MutationObserver** — Scan rendered text nodes and replace pseudonyms after the AI generates its response

---

## Per-AI Tool Analysis

---

### 1. ChatGPT (chatgpt.com)

**Transport:** Fetch + Binary WebSocket (5.2+ protobuf)
**Interception:** Wire (fetch) + DOM pre-submit (WS binary)
**De-pseudo:** Stream wrapping (fetch) + DOM observer (WS binary)

**How it works:**
- Fetch requests to `/backend-api/conversation` carry `messages[].content.parts[]`
- Iron Gate extracts the last user message, pseudonymizes entities, replaces in JSON body
- A system message is injected: `{ author: { role: "system" }, content: { parts: [notice] } }`
- Response stream is wrapped with `depseudonymizeResponse()` which replaces pseudonyms in SSE chunks
- For WebSocket binary frames (protobuf), fetch interception still handles the initial request; the DOM observer handles response de-pseudonymization

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| System message 4xx rejection | HIGH | ChatGPT sometimes rejects the injected system message (400/403). Fallback prepends notice to user text, but if that also fails, the request dies with no recovery. |
| Binary WS frame corruption | HIGH | ChatGPT 5.2+ uses binary protobuf WS frames. String replacement changes byte lengths, corrupting length-prefixed fields. Same-byte-length padding is best-effort and can fail. Pseudonyms leak into visible AI responses. |
| `isGenerating()` selector drift | HIGH | Detects generation via `button[aria-label="Stop generating"]` and `button[data-testid="stop-button"]`. Any ChatGPT UI update that renames these breaks the DOM observer's disconnect/reconnect cycle, causing React `replaceTextWithDirectives` errors. |
| DOM pre-submit race condition | MEDIUM | ProseMirror `writeInput` uses `execCommand('insertText')`. If React's async state update reverts the input before the framework reads it, original text is sent. |
| Response selector drift | MEDIUM | Uses `[data-message-author-role="assistant"]`, `[class*="markdown"]`, etc. ChatGPT UI updates frequently change these class names. |

**Fix plan:**
1. **System message fallback chain**: Add a third strategy — if both system message and notice-in-text fail, send pseudonymized text WITHOUT notice (protection > attribution)
2. **Binary WS frames**: Don't attempt same-byte-length replacement. Instead, rely entirely on DOM pre-submit for WS-transported prompts (write pseudonymized text to ProseMirror before the binary frame is built) and DOM observer for response de-pseudonymization
3. **Resilient `isGenerating()` check**: Add fallback heuristics — check for any button with "stop" in aria-label (case-insensitive), or detect active SSE connections via performance observer
4. **ProseMirror write verification**: After `writeInput`, verify the text was actually written by re-reading the element. If it reverts, retry once after a 50ms delay
5. **Dynamic response selectors**: Instead of hardcoded selectors, find the response container by walking up from the streaming text node. Cache the container once found

---

### 2. Claude (claude.ai)

**Transport:** Fetch (primary) + WebSocket (JSON text frames)
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- Fetch requests to `/api` carry Anthropic format: `messages[].content` (string or `[{type:"text", text:"..."}]`)
- Also supports `prompt` field for older Claude web format
- Iron Gate extracts, pseudonymizes, replaces in JSON body
- Response stream wrapping handles SSE de-pseudonymization
- WebSocket text frames also carry JSON — `extractFromWsFrame` / `replaceInWsFrame` handle these

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| ProseMirror paragraph extraction | LOW | `readInput` queries `<p>` tags inside ProseMirror. If Claude changes its editor implementation, DOM reading breaks. But since Claude uses wire interception (not DOM pre-submit), this only affects the capture engine, not pseudonymization. |
| `writeInput` returns false | INFO | Claude adapter doesn't implement DOM writing (wire-only). This is by design, not a bug. |
| Content array format | LOW | If Claude sends content as `[{type:"image"}, {type:"text"}]`, the text extraction only gets text blocks. Images are not scanned (by design). |

**Status:** Claude is the **most stable** adapter. Standard JSON body, standard SSE streaming, no binary encoding, no shadow DOM. Wire interception is clean and reliable.

**Fix plan:**
1. No critical fixes needed
2. **Nice-to-have**: Add support for Claude's `thinking` blocks in extended thinking mode — currently these pass through unscanned

---

### 3. Google Gemini (gemini.google.com)

**Transport:** Fetch (batchexecute URL-encoded form body)
**Interception:** DOM pre-submit ONLY (wire is skipped)
**De-pseudo:** DOM observer ONLY (stream wrapping is skipped)

**How it works:**
- Gemini's API uses `f.req=` URL-encoded form body containing **triple-nested, double-escaped JSON**
- Wire-level extraction/replacement is explicitly skipped because the body is opaque
- Instead, Iron Gate writes pseudonymized text to the Quill editor (`ql-editor`) before submit
- The framework then builds the opaque body with the pseudonymized text
- Response de-pseudonymization uses DOM MutationObserver on `model-response` containers
- Deep Shadow DOM traversal via `deepQuery()` to find input and submit elements

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| Zero wire fallback | CRITICAL | If DOM pre-submit fails (input element not found), there is NO fallback. The request goes through unmodified with zero pseudonymization. No logging or user notification. |
| Shadow DOM `deepQuery()` performance | HIGH | Recursively walks ALL elements and shadow roots. On complex Gemini pages with 1000+ elements, blocks main thread for 100+ ms causing UI lag. |
| Quill editor selector drift | HIGH | Relies on `.ql-editor[contenteditable="true"]`. If Gemini switches to a different editor (they've done this before), all input detection breaks. |
| `isGenerating()` unreliable | MEDIUM | Checks `.loading-indicator`, `[aria-label="Stop"]`, `.response-streaming`. Gemini's Material UI components change frequently. |
| batchexecute body misidentification | LOW | The `extractPrompt` for Gemini's URL-encoded body tries to parse `f.req` but can misidentify random strings in the nested JSON as prompts. This doesn't affect pseudonymization (DOM pre-submit handles it) but pollutes audit logs. |

**Fix plan:**
1. **Add wire-level fallback for Gemini**: Even though batchexecute is opaque, attempt entity-by-entity replacement in the raw body string as a last resort. If `promptText` is found in the body (even double-escaped), replace each entity individually
2. **Cache `deepQuery()` results**: Once the input element is found, cache it and only re-query if the element is detached from DOM. Avoids repeated full-page traversal
3. **Add `writeInput` verification**: After writing to Quill editor, verify the text was actually accepted by re-reading. Log a warning if write failed
4. **Broader `isGenerating()` heuristics**: Check for any element with `aria-busy="true"` or any active XHR to `/batchexecute`
5. **DOM pre-submit failure notification**: If input element not found after 3 retries, set a flag that the side panel can read to show "Protection degraded on this page"

---

### 4. Microsoft Copilot (copilot.microsoft.com)

**Transport:** SignalR WebSocket (primary) + Fetch (secondary)
**Interception:** DOM capture-wire (WS.prototype.send patch)
**De-pseudo:** DOM observer

**How it works:**
- Copilot uses SignalR over WebSocket for real-time chat
- SignalR frames are separated by `\x1e` (record separator), type 1 = Invocation (chat)
- Iron Gate patches `WebSocket.prototype.send` to intercept outgoing frames
- On submit: captures text from input, pseudonymizes, stores as `pendingCopilotPseudo`
- On WS.send: if pending pseudo exists, finds original text in SignalR frame and replaces
- `skipFetchProxy: true` — fetch requests are NOT intercepted
- Response de-pseudonymization uses DOM observer on `.ac-container` elements
- Uses Shadow DOM (`cib-serp > cib-action-bar`)

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| Fetch requests skipped entirely | HIGH | `skipFetchProxy: true` means file uploads, image descriptions, and search queries sent via fetch are NOT scanned or pseudonymized. |
| SignalR frame reconstruction | HIGH | `_walkPseudoSignalR` recursively walks arguments to find/replace text. If SignalR adds additional nesting or changes argument structure, replacement silently fails and original text is sent. |
| React state overwrites DOM | HIGH | `writeInput` returns false because React's internal state overwrites DOM changes. The pending pseudo approach works around this, but if the WS frame is built before the pending pseudo is stored (race condition), original text leaks. |
| Shadow DOM selector drift | MEDIUM | `cib-serp > cib-action-bar > textarea` selector depends on Copilot's specific Shadow DOM structure. Microsoft updates Copilot frequently. |
| Pending pseudo timing | MEDIUM | `pendingCopilotPseudo` is set on submit event, then consumed on next `WS.prototype.send`. If there's an unexpected WS frame between submit and the chat frame (e.g., a ping), the pseudo is NOT consumed (only consumed for SignalR type 1 frames). But if the timing is off, it could be consumed by the wrong frame. |

**Fix plan:**
1. **Enable fetch interception for Copilot file uploads**: Keep `skipFetchProxy: true` for chat endpoints but add an exception: if the URL matches `fileUploadPatterns`, intercept anyway
2. **Verify pending pseudo application**: After `WS.prototype.send` replaces text, verify the replacement happened by checking if the modified frame still contains original entity text. If not applied, log and attempt entity-by-entity replacement
3. **Timeout pending pseudo**: If `pendingCopilotPseudo` isn't consumed within 5 seconds, clear it and log a warning
4. **Broader Shadow DOM discovery**: Instead of hardcoded `cib-serp > cib-action-bar`, use `deepQuery()` (like Gemini) to find input elements
5. **Add audit logging for skipped fetch requests**: Even if fetch proxy is skipped, still run entity detection and log results to the side panel

---

### 5. Perplexity (perplexity.ai)

**Transport:** Socket.IO WebSocket (primary) + Fetch (secondary)
**Interception:** Wire (both fetch and WS)
**De-pseudo:** Stream wrapping (fetch) + WS message listener wrapping

**How it works:**
- Perplexity uses Socket.IO for real-time queries: `42["perplexity_ask","query text",{options}]`
- Iron Gate intercepts WS.send, extracts prompt from Socket.IO event frames (type 42)
- Only user-initiated events are intercepted: `perplexity_ask`, `perplexity_search`, `perplexity_query`
- Control frames (heartbeats `2`, pongs `3`, connects `40`, acks) are passed through
- Fetch API calls to `/api/` are also intercepted for non-WS queries
- Response de-pseudonymization wraps WS `addEventListener('message')` and `onmessage` property

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| `chrome.storage.session` access error | FIXED | Was throwing "Cannot read properties of undefined (reading 'welcomeShown')" — fixed by adding try/catch and null safety. |
| Side panel shows "Not on AI tool page" | FIXED | URL-based fallback and periodic re-check added. |
| Socket.IO frame format changes | MEDIUM | If Perplexity changes event names (e.g., `perplexity_ask` → `pplx_ask`), WS interception silently stops working. The regex `/^perplexity_/i` would not match. |
| WS response de-pseudo skips binary | MEDIUM | If Perplexity switches to binary WS frames (unlikely but possible), de-pseudonymization is skipped entirely. |
| Dual transport confusion | LOW | Perplexity uses both fetch and WS. A query might be sent via fetch on one page load and WS on another. Both paths are handled, but state (reverseMap) is tracked separately. |

**Fix plan:**
1. **Broaden Socket.IO event detection**: Instead of only matching `perplexity_ask/search/query`, intercept ALL Socket.IO events where element[1] is a string > 20 chars that passes `isNaturalLanguage()` check
2. **Event name monitoring**: Log unrecognized Socket.IO events (in debug mode) so developers can detect format changes early
3. **Unified reverse map**: Ensure the fetch and WS de-pseudonymization paths share the same `currentReverseMap` (currently they do via the global variable)

---

### 6. DeepSeek (chat.deepseek.com)

**Transport:** Fetch
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- Standard JSON body with `prompt`, `query`, or `messages[]` fields
- Extract → pseudonymize → replace → send
- SSE streaming response wrapped for de-pseudonymization

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| None critical | — | DeepSeek has the simplest implementation. Standard JSON, standard fetch, standard SSE. |
| Selector drift | LOW | `#chat-input` and `#chat-input-send-btn` are specific IDs that could change. But since DeepSeek uses wire interception, DOM selectors only affect the capture engine, not pseudonymization. |

**Status:** DeepSeek is **fully stable**. No special handling needed.

**Fix plan:** No fixes needed. Monitor for API format changes.

---

### 7. Poe (poe.com)

**Transport:** Fetch (GraphQL)
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- GraphQL mutations: `variables.input.text` or `variables.message`
- Fallback: `findLongestString()` recursively searches payload for longest string ≥ 20 chars
- Extract → pseudonymize → replace → send
- SSE streaming response wrapped

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| CSS hash class selectors | MEDIUM | DOM selectors like `textarea.GrowingTextArea_textArea__ZWQbP` include Poe's CSS Modules hash, which changes on every deployment. Only affects capture engine, not wire interception. |
| GraphQL mutation format changes | LOW | If Poe changes from `variables.input.text` to a different structure, `extractPrompt` falls back to `findLongestString()`. This works but could match metadata strings instead of user prompts. |

**Fix plan:**
1. **Remove hardcoded CSS hash selectors**: Use `textarea[class*="TextArea"]` instead of the hash-specific class
2. **Add GraphQL operation name check**: Only intercept mutations with specific operation names (e.g., `sendMessage`, `sendChatMessage`) to reduce false positives

---

### 8. Groq (groq.com)

**Transport:** Fetch
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- OpenAI-compatible JSON format: `messages[].content`
- Standard wire interception, standard SSE de-pseudonymization

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| None | — | OpenAI-compatible format is the most well-tested path in the codebase. |

**Status:** **Fully stable.** Same format as ChatGPT's API mode.

---

### 9. HuggingFace Chat (huggingface.co/chat)

**Transport:** Fetch
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- JSON body with `inputs`, `text`, or `messages[]` fields
- Fetch POST to `/chat/{id}/message`
- SSE streaming response wrapped

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| URL pattern specificity | LOW | API pattern `/huggingface\.co\/chat\/.*\/message/` only matches the message endpoint. Other HF endpoints (e.g., inference API) are not intercepted. |

**Status:** **Stable.** HuggingFace Chat uses a straightforward API.

---

### 10. You.com (you.com)

**Transport:** Fetch
**Interception:** Wire
**De-pseudo:** Stream wrapping

**How it works:**
- JSON body with `query`, `q`, `input`, or `prompt` fields
- Standard wire interception
- SSE streaming response wrapped

**Known bugs / fragilities:**

| Bug | Severity | Description |
|-----|----------|-------------|
| Multiple field names | LOW | You.com uses `query`, `q`, `input`, or `prompt` — the adapter tries all four. If You.com adds a new field name, it would need to be added. |

**Status:** **Stable.**

---

## Cross-Cutting Issues (Affect All AIs)

### 1. Silent Failure on Unrecognized Body Format
When `replacePrompt()` returns null (body format not recognized), the original unmodified request is sent. The user believes they're protected but their data leaks.

**Fix:** Add a last-resort entity-by-entity replacement: even if the body structure isn't understood, find each entity string in the raw body and replace it with the pseudonym.

### 2. Audit Trail Integrity
When WS replacement fails, the code still logs "entities detected and replaced" to the audit trail. This creates false audit records.

**Fix:** Add a `replacementSucceeded` flag to audit events. Only mark as "replaced" when replacement is verified.

### 3. Fetch Patch Verification
If `window.fetch` isn't successfully patched (CSP, non-writable, overwritten by page script), all wire interception silently fails.

**Fix:** Add a periodic health check (every 30s) that verifies `window.fetch === patchedFetch`. If not, re-patch and log a warning.

### 4. Model Loading Fallback
GLiNER model download failure silently degrades to regex-only detection. Users see no notification.

**Fix:** Surface model loading status in the side panel health indicator. Show "Basic detection (offline mode)" when model is unavailable.

---

## Priority Matrix

| Priority | AI Tool | Issue | Impact |
|----------|---------|-------|--------|
| P0 | **Gemini** | Zero wire fallback — if DOM pre-submit fails, no protection | Silent data leak |
| P0 | **ChatGPT** | Binary WS frame corruption → pseudonyms in responses | User sees fake data |
| P0 | **All** | Silent failure on unrecognized body format | Silent data leak |
| P1 | **Copilot** | Fetch requests (file uploads) not scanned | File content unprotected |
| P1 | **ChatGPT** | System message rejection cascade | Request failure |
| P1 | **ChatGPT** | `isGenerating()` selector drift → React errors | UI corruption |
| P1 | **Gemini** | Shadow DOM traversal performance | UI lag |
| P2 | **Copilot** | SignalR frame reconstruction fragility | Rare silent failure |
| P2 | **Perplexity** | Socket.IO event name changes | Detection stops |
| P2 | **Poe** | CSS hash class selectors | Capture engine breaks |
| P3 | **All** | Audit trail integrity | False records |
| P3 | **All** | Fetch patch verification | Already handled by retry |
| P3 | **All** | Model loading notification | UX improvement |

---

## Stability Ranking (Most → Least Stable)

1. **DeepSeek** — Simplest API, standard JSON, zero quirks
2. **Groq** — OpenAI-compatible, well-tested format
3. **Claude** — Standard Anthropic API, clean wire interception
4. **HuggingFace Chat** — Standard JSON, straightforward SSE
5. **You.com** — Standard JSON, multiple field fallbacks
6. **Poe** — GraphQL adds complexity but fallback is robust
7. **Perplexity** — Dual transport (fetch + Socket.IO) adds surface area
8. **ChatGPT** — Binary WS frames, ProseMirror, system message injection, frequent UI changes
9. **Copilot** — SignalR, Shadow DOM, fetch skipped, React state conflicts
10. **Gemini** — DOM-only with zero fallback, Shadow DOM, opaque body, frequent UI changes
