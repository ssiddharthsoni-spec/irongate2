import type { SiteAdapter } from './base';
import { defaultIsValidPromptInput } from './base';

/**
 * ChatGPT Adapter — chatgpt.com, chat.openai.com
 *
 * Transport: Fetch POST to /backend-api/conversation (auth) or /backend-anon/conversation (anon)
 *            SSE streaming responses
 *
 * Strategy: Wire (fetch body modification)
 * - Modify the fetch request body, NOT the ProseMirror editor
 * - The user's message bubble shows the ORIGINAL text (from React state)
 * - Pseudonymized text is only in the HTTP body sent to OpenAI
 * - Response stream is de-pseudonymized before React renders it
 * - Eliminates flicker caused by DOM de-pseudonymizer fighting React re-renders
 */

function jsonStringEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export const ChatGPTAdapter: SiteAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',

  hostPatterns: [/chatgpt\.com/, /chat\.openai\.com/],

  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [
    /chatgpt\.com\/backend-api\/(?:f\/)?conversation/,   // covers /backend-api/conversation AND /backend-api/f/conversation (2025+ routing)
    /chat\.openai\.com\/backend-api\/(?:f\/)?conversation/,
    /\/backend-api\/(?:f\/)?conversation/,               // generic fallback — matches both old + new ChatGPT routing
    /\/backend-anon\/(?:f\/)?conversation/,
    /api\.openai\.com\/v1\/chat\/completions/,
  ],

  // The user submit POSTs to …/conversation EXACTLY; secondary calls add
  // path segments (/gen_title/<id>, /textdocs, …) and must not match.
  primaryEndpointPatterns: [
    /\/backend-(?:api|anon)\/(?:f\/)?conversation(?:\?|$)/,
    /api\.openai\.com\/v1\/chat\/completions(?:\?|$)/,
  ],

  fileUploadPatterns: [/\/backend-api\/files/, /files\.oaiusercontent\.com/],

  // ── Response-stream strategy: 'none' (DOM-level de-pseudo only) ────────
  //
  // ChatGPT's SSE content embeds *inline entity markers* of the form
  // `entity["category","name"]` next to the visible text. Their front-end
  // renderer uses byte offsets stored in `message.metadata.*` (citations,
  // entity references, etc.) to convert these markers into hover-cards and
  // clean them from the final DOM.
  //
  // When Iron Gate's wire-level de-pseudonymizer substitutes a pseudonym
  // for its original in the streaming SSE, the byte length of the text
  // changes (e.g. 24-char pseudonym → 16-char original = -8 bytes). Every
  // offset further down the response is now wrong. ChatGPT's renderer
  // either (a) eats the wrong characters around the marker, producing
  // strings like `Pancreatitischarge summary` (lost "dis"), or (b) gives
  // up and leaves the raw marker as visible text, producing
  // `entity["people",Dr. Richard Lee]` in the response.
  //
  // We tried two fixes in earlier sessions:
  //   1. `stripOffsetAnnotations` — inverted whitelist on
  //      `message.metadata.*` so new offset-based fields can't break us
  //   2. `stripInlineMarkers` — regex strippers for the visible markers
  // Both were brittle: ChatGPT keeps introducing new marker variants
  // (quoted, unquoted, mixed-quoting, missing closing brackets) and
  // the byte-offset problem is structural — the renderer offsets are
  // computed against the bytes ChatGPT emitted, not what we delivered.
  //
  // The architectural fix: **let ChatGPT render the response with its
  // pseudonyms intact**, so its renderer sees correct byte offsets and
  // cleans markers properly. Then the persistent DOM observer (started
  // by `startPersistentDomDepseudo()` in main-world.ts) walks text
  // nodes in the rendered DOM and swaps pseudonyms → originals using
  // boundary-aware matching. The user sees originals; ChatGPT's
  // renderer is undisturbed.
  //
  // Tradeoff: every characterData mutation during streaming fires the
  // observer, which calls `replacePseudonyms` on the changed text node.
  // For long responses this is more CPU work than the wire-level path,
  // but the fast-reject inside `replacePseudonymsCore` short-circuits
  // tokens that don't contain a pseudonym.
  //
  // Outbound (request → ChatGPT) pseudonymization is UNCHANGED — that's
  // the security-critical path and stays at wire-level.
  responseStreamStrategy: 'none',

  extractResponseContent(parsed: any) {
    // ChatGPT accumulated: message.content.parts[0] has full text so far
    const parts = parsed?.message?.content?.parts;
    if (Array.isArray(parts) && typeof parts[0] === 'string') {
      return { mode: 'accumulated' as const, content: parts[0] };
    }
    // ChatGPT 2025+ JSON SSE format: {"p":"path","o":"add/patch","v":{...}}
    // The text content is nested inside the "v" object at varying paths.
    // Common patterns:
    //   {"p":"/message/content/parts/0","o":"append","v":"text chunk"}
    //   {"p":"/message/content/parts/0","o":"add","v":"full text"}
    //   {"p":"...","o":"patch","v":[{"p":"...","o":"append","v":"chunk"}]}
    // ChatGPT 2025+ JSON patch format — match on operation type.
    // The path "p" varies across ChatGPT versions, so we match broadly:
    //   {"o":"append","v":"text chunk","p":"/message/content/parts/0"}
    //   {"o":"append","v":"text","p":"/conversation/messages/.../content/parts/0"}
    //   {"o":"add","v":"full text","p":"..."}
    if (parsed?.o === 'append' && typeof parsed?.v === 'string' && parsed.v.length > 0) {
      return { mode: 'delta' as const, content: parsed.v };
    }
    if (parsed?.o === 'add' && typeof parsed?.v === 'string' && parsed.v.length > 0 && parsed?.p?.includes('content')) {
      return { mode: 'accumulated' as const, content: parsed.v };
    }
    // Nested patch format: v is an array of operations
    if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
      for (const op of parsed.v) {
        if (op?.o === 'append' && typeof op?.v === 'string' && op.v.length > 0) {
          return { mode: 'delta' as const, content: op.v };
        }
        if (op?.o === 'add' && typeof op?.v === 'string' && op.v.length > 0 && op?.p?.includes('content')) {
          return { mode: 'accumulated' as const, content: op.v };
        }
      }
    }
    // Deeply nested: v.message.content.parts[0]
    if (parsed?.v?.message?.content?.parts) {
      const vParts = parsed.v.message.content.parts;
      if (Array.isArray(vParts) && typeof vParts[0] === 'string') {
        return { mode: 'accumulated' as const, content: vParts[0] };
      }
    }
    // OpenAI API delta: choices[0].delta.content
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') {
      return { mode: 'delta' as const, content: delta };
    }
    return null;
  },

  injectResponseContent(parsed: any, mode: 'accumulated' | 'delta', content: string) {
    if (mode === 'accumulated' && parsed?.message?.content?.parts) {
      parsed.message.content.parts[0] = content;
    } else if (mode === 'accumulated' && parsed?.v?.message?.content?.parts) {
      parsed.v.message.content.parts[0] = content;
    } else if (parsed?.o === 'append' && typeof parsed?.v === 'string') {
      parsed.v = content;
    } else if (parsed?.o === 'add' && typeof parsed?.v === 'string') {
      parsed.v = content;
    } else if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
      for (const op of parsed.v) {
        if (op?.o === 'append' && typeof op?.v === 'string') {
          op.v = content;
          break;
        }
        if (op?.o === 'add' && typeof op?.v === 'string') {
          op.v = content;
          break;
        }
      }
    } else if (parsed?.choices?.[0]?.delta?.content !== undefined) {
      parsed.choices[0].delta.content = content;
    }
  },

  skipFetchProxy: false, // Fetch proxy handles request pseudonymization
  skipXhrProxy: false,

  inputSelectors: [
    '#prompt-textarea',
    'div[contenteditable="true"][id*="prompt"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"].ProseMirror',
    'textarea[data-id="root"]',
  ],

  submitSelectors: [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
  ],

  responseSelectors: [
    '[data-message-author-role="assistant"]',
    '[class*="markdown"]',
    '[class*="result-streaming"]',
    '.agent-turn',
    'article',
    '[class*="prose"]',
    'main [class*="text-base"]',
    // User messages (for notice stripping)
    '[data-message-author-role="user"]',
    '.whitespace-pre-wrap',
  ],

  extractPrompt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      if (!parsed?.messages || !Array.isArray(parsed.messages)) {
        // ── DIAGNOSTIC: Log what we got if not messages format ──
        console.log(
          '%c[Iron Gate DIAG] ChatGPT extractPrompt: body is NOT messages format',
          'color: #f59e0b; font-weight: bold',
          // SECURITY: structural fields only — never log raw body text
          // (prompt content) to the page console.
          { topLevelKeys: Object.keys(parsed || {}), bodyLength: body.length }
        );
        return null;
      }

      // ── DIAGNOSTIC: Log full message structure for debugging ──
      const msgs = parsed.messages;
      console.log(
        '%c[Iron Gate DIAG] ChatGPT extractPrompt: message structure',
        'color: #f59e0b; font-weight: bold',
        {
          messageCount: msgs.length,
          messages: msgs.map((m: any, i: number) => ({
            index: i,
            role: m.role,
            authorRole: m.author?.role,
            author: typeof m.author === 'string' ? m.author : undefined,
            contentType: typeof m.content,
            hasContentParts: !!(m.content?.parts),
            contentPartsCount: m.content?.parts?.length,
            contentPartTypes: m.content?.parts?.map((p: any) => typeof p),
            // SECURITY: length only — never log message text to the page console.
            contentLength: typeof m.content === 'string' ? m.content.length
              : m.content?.parts?.[0] ? String(m.content.parts[0]).length : 0,
          })),
        }
      );

      // Find the LAST user message — ChatGPT sends full conversation history,
      // the current prompt is always the last user message.
      // Must check multiple author formats: ChatGPT uses author.role, OpenAI uses role.
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const isUser = m.role === 'user'
          || m.author === 'user'
          || m.author?.role === 'user';
        if (!isUser) continue;

        // ChatGPT backend format: { content: { content_type: 'text', parts: ['...'] } }
        if (m.content?.parts && Array.isArray(m.content.parts)) {
          const text = m.content.parts
            .filter((p: any) => typeof p === 'string')
            .join('\n');
          if (text.length > 0) {
            console.log(
              '%c[Iron Gate DIAG] ChatGPT extractPrompt: found user msg at index ' + i,
              'color: #22c55e; font-weight: bold',
              { textLength: text.length }
            );
            return text;
          }
        }
        // String content (OpenAI API format)
        if (typeof m.content === 'string' && m.content.length > 0) {
          console.log(
            '%c[Iron Gate DIAG] ChatGPT extractPrompt: found user msg (string content) at index ' + i,
            'color: #22c55e; font-weight: bold',
            { textLength: m.content.length }
          );
          return m.content;
        }
        // Text field variant
        if (typeof m.text === 'string' && m.text.length > 0) return m.text;
        // Array content (multi-part OpenAI format)
        if (Array.isArray(m.content)) {
          const text = m.content
            .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text)
            .join('\n');
          if (text.length > 0) return text;
        }

        // ── DIAGNOSTIC: User message found but no extractable text ──
        console.warn(
          '%c[Iron Gate DIAG] ChatGPT extractPrompt: user msg at index ' + i + ' has NO extractable text',
          'color: #ef4444; font-weight: bold',
          // SECURITY: shape only — never dump the raw content object.
          { contentType: typeof m.content, contentKeys: m.content && typeof m.content === 'object' ? Object.keys(m.content) : undefined }
        );
      }

      console.warn(
        '%c[Iron Gate DIAG] ChatGPT extractPrompt: NO user message found in ' + msgs.length + ' messages',
        'color: #ef4444; font-weight: bold'
      );
      return null;
    } catch (err) {
      console.warn('[Iron Gate DIAG] ChatGPT extractPrompt: JSON parse failed', err);
      return null;
    }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(body);

      // ChatGPT backend format
      if (parsed?.messages && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        const lastIdx = parsed.messages.length - 1;
        const lastMsg = parsed.messages[lastIdx];
        if (lastMsg?.content?.parts) {
          lastMsg.content.parts = [replacement];
        } else if (lastMsg) {
          // Preserve original content structure (plain string for OpenAI API format)
          lastMsg.content = typeof lastMsg.content === 'string' ? replacement : { content_type: 'text', parts: [replacement] };
        }
        return JSON.stringify(parsed);
      }

      // OpenAI API format
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          const msg = parsed.messages[i];
          if (msg.role === 'user' || msg.author === 'user' || msg.author?.role === 'user') {
            if (typeof msg.content === 'string') {
              msg.content = replacement;
            } else if (typeof msg.text === 'string') {
              msg.text = replacement;
            } else if (Array.isArray(msg.content)) {
              const textParts = msg.content.filter((c: any) => c.type === 'text');
              if (textParts.length > 0) textParts[0].text = replacement;
            }
            break;
          }
        }
        return JSON.stringify(parsed);
      }

      // Generic fallback: string replacement
      if (original.length >= 20) {
        const escaped = jsonStringEscape(original);
        const escapedRepl = jsonStringEscape(replacement);
        if (body.includes(escaped)) {
          return body.replace(escaped, escapedRepl);
        }
      }

      return null;
    } catch {
      return null;
    }
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement) return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },

  writeInput(el: HTMLElement, text: string): boolean {
    if (el instanceof HTMLTextAreaElement) {
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (desc?.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // Strategy 1: execCommand (ProseMirror-compatible)
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        const after = this.readInput(el);
        if (after.includes(text.substring(0, 50))) return true;
      }
    }

    // Strategy 2: DataTransfer paste event
    try {
      el.focus();
      const s = window.getSelection();
      if (s) {
        const r = document.createRange();
        r.selectNodeContents(el);
        s.removeAllRanges();
        s.addRange(r);
      }
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt,
      } as any);
      el.dispatchEvent(pasteEvent);
      const after = this.readInput(el);
      if (after.includes(text.substring(0, 50))) return true;
    } catch { /* paste failed */ }

    // Strategy 3: Direct DOM manipulation
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: text,
    }));
    return true;
  },

  findInput(): HTMLElement | null {
    // Sr. Engineer Audit · Item 11: validate every candidate. A platform UI
    // update that silently renames #prompt-textarea to something else used
    // to yield a random matching div with zero bounds — IronGate would
    // "work" (no visible error) but never actually intercept anything.
    // Now we skip candidates that aren't truly editable + visible.
    for (const sel of this.inputSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && defaultIsValidPromptInput(el)) return el;
    }
    // Last-ditch fallback: any visible textarea on the page. ChatGPT only
    // has one real composer at a time, so the semantic-first approach is
    // robust to ID churn.
    const fallback = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
      .find(defaultIsValidPromptInput) as HTMLElement | undefined;
    return fallback ?? null;
  },

  findSubmitButton(): HTMLElement | null {
    for (const sel of this.submitSelectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    // Fallback: button near the textarea
    const textarea = this.findInput();
    if (textarea) {
      const form = textarea.closest('form');
      if (form) {
        const btn = form.querySelector('button[type="submit"], button:last-of-type') as HTMLElement;
        if (btn) return btn;
      }
    }
    return null;
  },

  isGenerating(): boolean {
    return !!(
      document.querySelector('button[aria-label="Stop generating"]') ||
      document.querySelector('button[data-testid="stop-button"]')
    );
  },

  getConversationId(): string | null {
    // ChatGPT URL format: /c/UUID
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  isWsEndpoint(url: string): boolean {
    return /chatgpt\.com|chat\.openai\.com/.test(url);
  },

  extractFromWsFrame(frame: string): string | null {
    // ChatGPT 5.2+ uses binary WebSocket frames (protobuf-like).
    // Text frames may still occur for some payloads. Try JSON extraction.
    try {
      const parsed = JSON.parse(frame);
      // Check for messages-style payload
      if (parsed?.messages?.[0]?.content?.parts) {
        const last = parsed.messages[parsed.messages.length - 1];
        if (last?.content?.parts) return last.content.parts.join('\n');
        return parsed.messages[0].content.parts.join('\n');
      }
      if (parsed?.message?.content?.parts) {
        return parsed.message.content.parts.join('\n');
      }
      // Simple text fields
      if (typeof parsed?.body === 'string' && parsed.body.length > 10) return parsed.body;
      if (typeof parsed?.text === 'string' && parsed.text.length > 10) return parsed.text;
      return null;
    } catch {
      // Not JSON — may be binary protobuf frame.
      // Try to extract readable UTF-8 text for audit (best-effort).
      const textMatch = frame.match(/[\x20-\x7E]{20,}/g);
      if (textMatch) {
        const longest = textMatch.reduce((a, b) => a.length >= b.length ? a : b);
        if (longest.length >= 20) return longest;
      }
      return null;
    }
  },

  // Binary WS frames cannot be safely modified (byte count changes corrupt protobuf).
  // Replacement is handled via DOM pre-submit: the pseudonymized text is written to the
  // ProseMirror editor BEFORE the framework builds the binary frame.
  replaceInWsFrame(): string | null {
    return null;
  },
};
