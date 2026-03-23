/**
 * SiteAdapter — the contract every AI platform adapter must implement.
 *
 * Each adapter encapsulates ALL platform-specific knowledge:
 * - How to detect the platform (URL patterns)
 * - How the platform sends prompts (transport type)
 * - How to extract the user's prompt from the wire format
 * - How to replace the prompt with pseudonymized text
 * - DOM selectors for textarea, send button, response container
 * - Whether to use wire-level or DOM pre-submit interception
 *
 * The shared engine (detection, pseudonymization, scoring) is transport-agnostic
 * and delegates all platform-specific logic to the active adapter.
 */

export type TransportType =
  | 'fetch'              // Standard fetch POST with JSON body (ChatGPT, Claude, DeepSeek, Poe, Groq, HuggingFace, You.com)
  | 'websocket-signalr'  // SignalR over WebSocket with \x1e separators (Copilot)
  | 'websocket-socketio'  // Socket.IO over WebSocket with 42["event","data"] frames (Perplexity)
  | 'dom-only';          // No wire interception possible; DOM pre-submit only (Gemini batchexecute)

export type InterceptionStrategy =
  | 'wire'              // Intercept network request, modify body (works for fetch, WS)
  | 'dom-presubmit'     // Modify textarea before framework reads it, re-trigger submit
  | 'dom-capture-wire'; // Capture from DOM, let framework submit, modify at wire level (Copilot)

export interface SiteAdapter {
  /** Unique identifier (e.g., 'chatgpt', 'claude') */
  id: string;

  /** Display name shown in sidepanel */
  name: string;

  /** URL patterns that activate this adapter */
  hostPatterns: RegExp[];

  /** How the platform sends data to its backend */
  transport: TransportType;

  /** How IronGate intercepts the data */
  interception: InterceptionStrategy;

  /**
   * URL patterns for LLM API endpoints (used by fetch/XHR proxy to filter requests).
   * Only POST/PUT/PATCH requests matching these patterns are intercepted.
   */
  apiPatterns: RegExp[];

  /**
   * Should the fetch proxy skip this site?
   * True for platforms where DOM pre-submit handles everything (Gemini)
   * or where fetch isn't the primary transport (Copilot).
   */
  skipFetchProxy: boolean;

  /**
   * Should the XHR proxy skip this site?
   */
  skipXhrProxy: boolean;

  /**
   * CSS selectors for the prompt input element (tried in order).
   */
  inputSelectors: string[];

  /**
   * CSS selectors for the send/submit button (tried in order).
   */
  submitSelectors: string[];

  /**
   * CSS selectors for response containers (for DOM de-pseudonymization targeting).
   */
  responseSelectors: string[];

  /**
   * Extract the user's prompt text from a request body string.
   * Returns the prompt text or null if this request isn't a chat prompt.
   */
  extractPrompt(body: string): string | null;

  /**
   * Replace the original prompt in the request body with the pseudonymized text.
   * Returns the modified body or null if replacement failed.
   */
  replacePrompt(body: string, original: string, replacement: string): string | null;

  /**
   * Read the current text from the input element.
   */
  readInput(el: HTMLElement): string;

  /**
   * Write pseudonymized text into the input element (for DOM pre-submit strategy).
   * Returns true if the write was successful.
   */
  writeInput(el: HTMLElement, text: string): boolean;

  /**
   * Find the input element in the DOM (may include Shadow DOM traversal).
   */
  findInput(): HTMLElement | null;

  /**
   * Find the submit button in the DOM.
   */
  findSubmitButton(): HTMLElement | null;

  /**
   * Returns true if the platform is currently generating a response.
   */
  isGenerating(): boolean;

  /**
   * Optional: Extract prompt from a WebSocket frame (for WS-based transports).
   * Returns the prompt text or null.
   */
  extractFromWsFrame?(frame: string): string | null;

  /**
   * Optional: Replace prompt in a WebSocket frame.
   * Returns the modified frame or null.
   */
  replaceInWsFrame?(frame: string, original: string, replacement: string): string | null;

  /**
   * Optional: Check if a WebSocket URL belongs to this platform's chat backend.
   */
  isWsEndpoint?(url: string): boolean;

  /**
   * Optional: Whether this adapter uses Shadow DOM (needs deep querying).
   */
  usesShadowDom?: boolean;

  /**
   * Optional: Get conversation ID from the current page (for audit trail).
   */
  getConversationId?(): string | null;

  /**
   * Optional: URL patterns for file upload endpoints (separate from LLM API endpoints).
   * Used to detect file uploads at the network level (e.g., /backend-api/files,
   * /api/convert_document, /images/kblob).
   */
  fileUploadPatterns?: RegExp[];

  /**
   * Response stream de-pseudonymization strategy.
   *
   * - 'sse-content': Parse SSE lines, extract content from JSON, replace in content
   *   field, re-serialize. Best for ChatGPT (accumulated) and OpenAI API (delta).
   * - 'raw-chunk': Direct text replacement on each decoded chunk. Best for platforms
   *   with non-standard SSE or where SSE parsing is unreliable (Claude.ai).
   * - 'none': No wire response de-pseudo (DOM pre-submit platforms like Gemini).
   *
   * Default: 'sse-content'
   */
  responseStreamStrategy?: 'sse-content' | 'raw-chunk' | 'none';

  /**
   * Optional: Extract content from a parsed SSE JSON event for response de-pseudo.
   * Returns { mode, content } or null if this event has no text content.
   * Only used when responseStreamStrategy is 'sse-content'.
   */
  extractResponseContent?(parsed: any): { mode: 'accumulated' | 'delta'; content: string } | null;

  /**
   * Optional: Inject modified content back into a parsed SSE JSON event.
   * Only used when responseStreamStrategy is 'sse-content'.
   */
  injectResponseContent?(parsed: any, mode: 'accumulated' | 'delta', content: string): void;

}
