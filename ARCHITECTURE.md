# IronGate v2.0 — Per-Platform Interception Strategy

> Based on deep audit of 3,351-line main-world.ts monolith
> 10 AI platforms analyzed | 4 transport patterns | 2 interception strategies

---

## The Problem

The current `main-world.ts` is a monolith where:
- Platform-specific logic is scattered across 3,000+ lines
- Three interception layers (fetch, XHR, WebSocket) have inconsistent skip logic
- `domPseudonymize`, `copilotDetectAndQueue`, `geminiDomPseudonymize` are near-identical copies
- Each new platform fix risks breaking another platform
- Adding a platform requires editing 5+ locations in a single file

---

## Discovery: There Are Only 4 Transport Patterns

After analyzing all 10 platforms, every AI tool uses one of these wire protocols:

| Pattern | Mechanism | Platforms |
|---------|-----------|-----------|
| **Standard Fetch** | POST JSON body, SSE streaming response | ChatGPT, Claude, DeepSeek, Poe, Groq, HuggingFace, You.com |
| **SignalR WebSocket** | Binary frames, `\x1e` record separator, type 1 = chat | Copilot |
| **Socket.IO WebSocket** | `42["event","data",{options}]` text frames | Perplexity |
| **Google batchexecute** | URL-encoded `f.req=` with double-escaped nested JSON | Gemini |

---

## Discovery: There Are Only 2 Interception Strategies

| Strategy | How It Works | When To Use |
|----------|-------------|-------------|
| **Wire-level** | Intercept fetch/WS.send, modify body before it leaves browser | Works when we can parse the wire format |
| **DOM pre-submit** | Modify textarea text before framework reads it, re-trigger submit | Needed when wire format is opaque (binary protobuf, encrypted, double-encoded) |

---

## Per-Platform Strategy

### 1. ChatGPT — `chatgpt.com`, `chat.openai.com`

**Transport:** Fetch POST to `/backend-api/conversation` (auth) or `/backend-anon/conversation` (anon). Binary WebSocket frames (protobuf-like, ChatGPT 5.2+). SSE streaming responses.

**Interception: DOM pre-submit + Wire fallback**

Why DOM pre-submit is primary:
- ChatGPT 5.2 sends binary WebSocket frames where string replacement corrupts length prefixes
- ProseMirror contenteditable can be written to via `execCommand` before framework reads state
- DOM pre-submit ensures the binary frame is BUILT with pseudonymized text

Why wire-level is fallback:
- Catches cases where DOM write fails (React state desync)
- Provides audit logging even when DOM interception missed

**Extraction:** `messages[last].content.parts.join('\n')` where `author.role === "user"`

**Replacement:** Set `messages[last].content.parts = [pseudonymizedText]`

**De-pseudo:** DOM MutationObserver (primary — survives React re-renders) + SSE stream wrapping (secondary)

**Selectors:**
- Input: `#prompt-textarea`, `div[contenteditable="true"][data-placeholder]`, `div[contenteditable="true"].ProseMirror`
- Submit: `button[data-testid="send-button"]`, `button[data-testid="composer-send-button"]`, `button[aria-label="Send message"]`
- Response: `[data-message-author-role="assistant"]`, `[class*="markdown"]`, `[class*="result-streaming"]`

**Notice stripping:** Both `[All personally identifiable...]` bracketed and unbracketed forms. Trigger: text contains "personally identifiable information" or "enterprise privacy tool".

**Known edge cases:**
- Anonymous mode uses `/backend-anon/conversation` (not `/backend-api/`)
- ProseMirror write strategies: execCommand → DataTransfer paste → direct DOM manipulation
- React re-renders overwrite stream-level de-pseudo (DOM observer is the real safety net)

---

### 2. Claude — `claude.ai`

**Transport:** Fetch POST to `/api/organizations/*/chat_conversations/*/completion`. SSE streaming. Also opens WebSocket connections.

**Interception: Wire-level (fetch proxy)**

Why fetch-only works:
- Claude's API uses standard JSON with `messages[]` or `prompt` field
- No binary encoding, no double-escaping
- ProseMirror editor state is complex — DOM pre-submit not worth the fragility risk

**Extraction:**
- Primary: `messages[last].content` (string) where `role === "user"`
- Secondary: `messages[last].content[]` (array of `{type: "text", text}`)
- Tertiary: `parsed.prompt` (string)

**Replacement:** Set `msg.content = pseudonymizedText` or `msg.content[0].text = pseudonymizedText`

**De-pseudo:** SSE stream wrapping (primary) + DOM MutationObserver (safety net)

**Selectors:**
- Input: `[contenteditable="true"].ProseMirror`, `div[contenteditable="true"]`
- Submit: `button[aria-label="Send Message"]`, `button[aria-label="Send message"]`, `fieldset button[type="button"]:last-child`
- Response: `[data-is-streaming]`, `.font-claude-message`

**Known edge cases:**
- ProseMirror paragraph structure: text is in `<p>` elements, not direct textContent
- Organization ID in URL path varies per account

---

### 3. Gemini — `gemini.google.com`

**Transport:** Fetch/XHR POST to `/_/BardChatUi/data/` or `/v1beta/models/`. URL-encoded form body with `f.req=` parameter containing double-escaped nested JSON arrays. Quill rich text editor.

**Interception: DOM pre-submit ONLY**

Why DOM pre-submit is the only option:
- batchexecute body contains base64/encrypted data that `extractPrompt` misidentifies
- Double-escaped nested JSON is extremely fragile to modify at wire level
- `f.req` replacement requires precise double-escaping that's error-prone
- Writing to Quill editor via `execCommand` is reliable

Why fetch/XHR proxy is explicitly SKIPPED:
- `skipFetchProxy` and `skipXHRProxy` flags both check for `gemini.google.com`
- Attempting wire-level interception breaks requests

**De-pseudo:** DOM MutationObserver (only option — no fetch response wrapping since we skip the proxy)

**Selectors:**
- Input: `.ql-editor[contenteditable="true"]`, `rich-textarea .ql-editor`, `div[contenteditable="true"][role="textbox"]`
- Submit: `button[aria-label="Send message"]`, `button[aria-label*="send" i]`, `.send-button`
- Response: `model-response`, `.response-container`
- Shadow DOM: Deep query needed — `deepQuery()` pierces open shadow roots recursively

**Write strategy:** `execCommand('insertText')` → verify → direct DOM manipulation fallback

**Known edge cases:**
- Uses custom `<model-response>` elements
- Shadow DOM components may hide textarea/buttons
- Quill editor wraps text in `<p>` tags — extraction must handle this

---

### 4. Copilot — `copilot.microsoft.com`

**Transport:** SignalR over WebSocket. Frames separated by `\x1e` (record separator). Type 1 = Invocation (chat), Type 3 = Completion, Type 6 = Ping. React-managed textarea input.

**Interception: DOM capture + WebSocket.prototype.send patch**

Why this two-phase approach:
- React's internal state overwrites DOM changes — `writeCopilotInput()` is useless
- DOM pre-submit cannot work because React builds the SignalR frame from its own state
- Instead: capture the text on Enter/click (Phase 1), let Copilot submit normally, then intercept the outgoing WebSocket frame and swap the text (Phase 2)

**Phase 1 — DOM Capture (does NOT modify DOM or preventDefault):**
- Enter key handler reads textarea text
- Detects entities, pseudonymizes
- Stores `pendingCopilotPseudo = { original, maskedText }`
- Lets Enter propagate to Copilot normally

**Phase 2 — WebSocket.prototype.send patch:**
- Intercepts ALL ws.send calls on Copilot/Bing/Sydney URLs
- Checks if `pendingCopilotPseudo` is set
- Finds the original text (JSON-escaped) in the SignalR frame
- Replaces with pseudonymized text
- Clears pending state
- Fallback strategies: exact match → normalized → deep walk → entity-by-entity

**Why prototype.send and NOT instance.send:**
- Modifying WS instance properties (send, addEventListener, onmessage) breaks SignalR's internal validation
- Prototype patch is invisible to SignalR

**Extraction:** Parse SignalR frames (split by `\x1e`), find type 1 invocations, walk `arguments[]` recursively for strings > 50 chars

**De-pseudo:** DOM MutationObserver (Copilot renders with Adaptive Card containers `.ac-container`)

**Selectors:**
- Input: `#searchbox`, `textarea[placeholder]`, `div[contenteditable="true"]`
- Shadow DOM: `cib-serp → cib-action-bar → textarea` (Web Components)
- Submit: `button[aria-label="Submit"]`, `button[aria-label="Send"]`
- Response: `.ac-container`

**Fetch/XHR proxy:** SKIPPED (both `skipFetchProxy` and `skipXHRProxy` flags)

**Known edge cases:**
- 10-second timeout on `pendingCopilotPseudo` (prevents stale pseudonymization)
- SignalR handshake/ping/completion frames must pass through untouched
- Copilot may use Shadow DOM Web Components (cib-*) that need special traversal

---

### 5. Perplexity — `perplexity.ai`, `www.perplexity.ai`

**Transport:** Socket.IO over WebSocket (`42["perplexity_ask","query",{options}]`). Also some Fetch POST to `/api/query` or `/api/search`. Next.js app.

**Interception: Wire-level (WebSocket + Fetch dual proxy)**

Why wire-level works:
- Socket.IO text frames are easily parseable (strip `42` prefix, JSON.parse the array)
- Fetch fallback catches any REST API calls
- No need for DOM pre-submit — both transport paths are interceptable

**WebSocket extraction:**
- Socket.IO frame format: `42["event_name","query_text",{options}]`
- Strip numeric prefix, JSON.parse → array
- Event name check: `/^perplexity_/i` → second element is the query
- Fallback: `findDeepestString()` for generic array handling

**Fetch extraction:** `parsed.query`, `parsed.query_str`, `parsed.text`, `parsed.params.query`

**WebSocket replacement:** JSON-escape the pseudonymized text, replace in the raw frame string (preserving Socket.IO prefix and options object)

**De-pseudo:** DOM MutationObserver targeting `.prose` response containers

**Selectors:**
- Input: `textarea[placeholder*="Ask"]`, `textarea`
- Submit: `button[aria-label="Submit"]`, `button[type="submit"]`
- Response: `.prose`

**Manifest patterns:** Must include `perplexity.ai/*`, `www.perplexity.ai/*`, AND `*.perplexity.ai/*`

**Known edge cases:**
- Socket.IO control frames (ping `2`, pong `3`, connect `40`) must pass through
- Short queries (< 15 chars) might have event name "perplexity_ask" as longest string — specific Socket.IO handler prevents this
- Chrome may load extension from unexpected folder — deploy to both paths

---

### 6. DeepSeek — `chat.deepseek.com`

**Transport:** Fetch POST to `/api/*`. Standard JSON body. SSE streaming responses.

**Interception: Wire-level (fetch proxy)**

Simplest platform. Standard fetch with JSON body containing `prompt`, `query`, or `messages[]`.

**Extraction:** `parsed.prompt`, `parsed.query`, `parsed.input`, or `messages[last].content`

**Replacement:** Direct field replacement in parsed JSON

**De-pseudo:** SSE stream wrapping + DOM MutationObserver (`.markdown-body`)

**Selectors:**
- Input: `#chat-input`, `textarea`
- Submit: `#chat-input-send-btn`, `button[aria-label="Send"]`
- Response: `.markdown-body`

---

### 7. Poe — `poe.com`

**Transport:** Fetch POST to `/api/*`. GraphQL mutations. SSE streaming.

**Interception: Wire-level (fetch proxy)**

**Extraction:** GraphQL mutation body — `parsed.query` (GraphQL query string) + `parsed.variables.input.text` or similar nested structure. Falls back to `findLongestStringValue()` generic extraction.

**Replacement:** Generic string replacement in JSON body (works for GraphQL variables)

**De-pseudo:** SSE stream wrapping + DOM MutationObserver (`[class*="Message_botMessageBubble"]`)

**Selectors:**
- Input: `textarea[class*="TextArea"]`, `textarea.GrowingTextArea_textArea__*` (hash-based), `textarea`
- Submit: `button[class*="sendButton"]`, `button[aria-label="Send message"]`
- Response: `[class*="Message_botMessageBubble"]`

**Known edge cases:** Poe uses CSS Modules with hash-based class names that change across deployments

---

### 8. Groq — `groq.com`

**Transport:** Fetch POST to API. OpenAI-compatible JSON format.

**Interception: Wire-level (fetch proxy)**

Uses standard `messages[]` format identical to OpenAI API.

**Extraction:** `messages[last].content` where `role === "user"`

**Replacement:** Set `msg.content = pseudonymizedText`

**De-pseudo:** SSE stream wrapping + DOM MutationObserver

---

### 9. HuggingFace Chat — `huggingface.co/chat`

**Transport:** Fetch POST to `/chat/*/message`. SSE streaming.

**Interception: Wire-level (fetch proxy)**

**Extraction:** `parsed.inputs`, `parsed.text`, or generic `findLongestStringValue()`

**De-pseudo:** SSE stream wrapping + DOM MutationObserver

---

### 10. You.com — `you.com`

**Transport:** Fetch POST to `/api/*`. Standard JSON.

**Interception: Wire-level (fetch proxy)**

**Extraction:** `parsed.query`, `parsed.q`, or generic fallback

**De-pseudo:** SSE stream wrapping + DOM MutationObserver

---

## Summary Matrix

| Platform | Transport | Interception | Extract Method | Replace Method | De-pseudo | Status |
|----------|-----------|-------------|----------------|----------------|-----------|--------|
| ChatGPT | Fetch + Binary WS | DOM pre-submit + Wire fallback | `messages[].content.parts[]` | `parts = [text]` | DOM observer | Working (fragile) |
| Claude | Fetch + SSE | Wire (fetch proxy) | `messages[].content` | `msg.content = text` | Stream + DOM | Working |
| Gemini | batchexecute | DOM pre-submit ONLY | Read Quill editor | Write Quill editor | DOM observer | Working |
| Copilot | SignalR WS | DOM capture + WS.prototype.send | Walk SignalR arguments | String replace in frame | DOM observer | New, needs testing |
| Perplexity | Socket.IO WS + Fetch | Wire (WS + fetch dual) | Socket.IO array[1] | String replace in frame | DOM observer | New, needs testing |
| DeepSeek | Fetch | Wire (fetch proxy) | `prompt/query/input` | Field replace | Stream + DOM | Working |
| Poe | Fetch (GraphQL) | Wire (fetch proxy) | GraphQL variables | String replace | Stream + DOM | Partial |
| Groq | Fetch | Wire (fetch proxy) | `messages[].content` | `msg.content = text` | Stream + DOM | Working |
| HuggingFace | Fetch | Wire (fetch proxy) | `inputs/text` | Field replace | Stream + DOM | Working |
| You.com | Fetch | Wire (fetch proxy) | `query/q` | Field replace | Stream + DOM | Working |

---

## Refactor Architecture

### From: 3,351-line monolith
### To: Modular adapter system

```
src/content/main-world/
├── index.ts                 # Entry point, duplicate guard, state, heartbeat
├── engine.ts                # Shared: detectEntities, pseudonymize, score, generateFake
├── transport/
│   ├── fetch-proxy.ts       # Patches window.fetch, delegates to active adapter
│   ├── xhr-proxy.ts         # Patches XMLHttpRequest.send
│   ├── ws-proxy.ts          # Patches WebSocket constructor + prototype.send
│   └── dom-presubmit.ts     # Enter/click capture, textarea read/write
├── depseudo/
│   ├── stream-wrapper.ts    # Wraps SSE Response streams for de-pseudonymization
│   ├── dom-observer.ts      # MutationObserver + periodic scan
│   └── notice-stripper.ts   # Removes de-identification notices from DOM
├── adapters/
│   ├── base.ts              # Abstract SiteAdapter interface
│   ├── chatgpt.ts           # ChatGPT adapter
│   ├── claude.ts            # Claude adapter
│   ├── gemini.ts            # Gemini adapter
│   ├── copilot.ts           # Copilot adapter
│   ├── perplexity.ts        # Perplexity adapter
│   ├── deepseek.ts          # DeepSeek adapter
│   ├── poe.ts               # Poe adapter
│   ├── groq.ts              # Groq adapter
│   ├── huggingface.ts       # HuggingFace adapter
│   ├── you.ts               # You.com adapter
│   └── registry.ts          # Maps hostname → adapter
└── compliance/
    ├── profiles.ts           # SOC2, HIPAA, GDPR, PCI DSS, CCPA configs
    ├── role-policies.ts      # Department-level policies
    └── document-classifier.ts # File type detection + risk multipliers
```

### CRITICAL CONSTRAINT: main-world.ts must remain self-contained

CRXJS MAIN world loaders resolve dynamic imports against the page's origin (not the extension). This means **no imports work in MAIN world**. The entire adapter system must be compiled into a single self-contained bundle.

**Solution:** Use the modular file structure for development, but configure the build (Vite) to inline everything into a single IIFE bundle for the MAIN world output. This gives us:
- Clean modular code during development
- Single self-contained file at runtime (no imports needed)

---

## Implementation Phases

### Phase 1: Adapter Architecture (Week 1-2)
- Extract shared engine (detection, pseudonymization, scoring, fake generation)
- Create SiteAdapter interface
- Implement all 10 adapters
- Create registry that auto-selects adapter by hostname
- Refactor transport proxies (fetch, WS, XHR) to delegate to active adapter
- Configure Vite to bundle into single MAIN world file
- Verify each platform works identically to current behavior

### Phase 2: Compliance Framework (Week 3-4)
- Compliance profiles (SOC2, HIPAA, GDPR, PCI DSS, CCPA)
- Role-based policies (Legal, Finance, Engineer, HR)
- Risk multiplier system per compliance profile
- Settings UI with profile dropdown, role selector, threshold slider
- Persistence via chrome.storage.sync

### Phase 3: Audit Trail & Dashboard (Week 5-7)
- Audit manager (10K entry limit, auto-prune, never stores PII)
- Shadow AI detector (30+ AI domains categorized)
- Chart.js dashboard (per-platform bar, entity type pie, 30-day trend line)
- CSV export for any date range
- Red badge on blocks

### Phase 4: Document & Upload Protection (Week 8-9)
- FormData.prototype.append override in MAIN world
- Document classifier (MIME + extension + keyword detection)
- Clipboard paste monitor with coaching warnings
- Risk multipliers per document type

### Phase 5: Coaching & Onboarding (Week 10-12)
- Toast notification system (green/yellow/red with details)
- 3-step onboarding flow (explain → demo → configure)
- Popup with real-time protection status
- Weekly summary notifications

### Phase 6: Enterprise Readiness (Week 13-16)
- chrome.storage.managed for MDM/Group Policy
- Performance optimization (<100ms p99 detection)
- False positive rate reduction (<5%)
- 105 tests, >80% coverage
- Chrome Web Store submission
