/**
 * Monkey-patches window.fetch() and XMLHttpRequest to capture
 * the actual API payload being sent to the AI tool's backend.
 *
 * This is the GROUND TRUTH capture — it shows exactly what data
 * is leaving the browser, even if DOM-based capture misses something.
 *
 * MUST be injected at document_start before the page's scripts load.
 */

export interface InterceptedRequest {
  url: string;
  method: string;
  body: any;
  timestamp: number;
}

/** Known LLM API endpoint patterns */
const LLM_API_PATTERNS: RegExp[] = [
  // OpenAI / ChatGPT
  /api\.openai\.com\/v1\/chat\/completions/,
  /chatgpt\.com\/backend-api\/conversation/,
  /chat\.openai\.com\/backend-api\/conversation/,
  // Anthropic / Claude
  /api\.anthropic\.com\/v1\/messages/,
  /claude\.ai\/api/,
  // Google / Gemini
  /generativelanguage\.googleapis\.com/,
  /gemini\.google\.com\/app\/_\/api/,
  // Microsoft / Copilot
  /copilot\.microsoft\.com\/c\/api/,
  /sydney\.bing\.com\/sydney/,
  // DeepSeek
  /chat\.deepseek\.com\/api/,
  // Poe
  /poe\.com\/api/,
  // Perplexity
  /api\.perplexity\.ai/,
  /perplexity\.ai\/api/,
  // Groq
  /api\.groq\.com/,
];

function isLLMEndpoint(url: string): boolean {
  return LLM_API_PATTERNS.some((pattern) => pattern.test(url));
}

function extractPromptFromPayload(body: any): string | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    // OpenAI format: { messages: [{ role, content }] }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUserMsg = [...parsed.messages]
        .reverse()
        .find((m: any) => m.role === 'user');
      if (lastUserMsg) {
        if (typeof lastUserMsg.content === 'string') return lastUserMsg.content;
        if (Array.isArray(lastUserMsg.content)) {
          return lastUserMsg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        }
      }
    }

    // ChatGPT backend format: { action, messages: [{ content: { parts } }] }
    if (parsed?.messages?.[0]?.content?.parts) {
      const lastMsg = parsed.messages[parsed.messages.length - 1];
      if (lastMsg?.content?.parts) return lastMsg.content.parts.join('\n');
      return parsed.messages[0].content.parts.join('\n');
    }

    // Anthropic format: { messages: [{ role, content }] } (same as OpenAI)
    // Already handled above

    // Generic: look for common prompt fields
    if (parsed?.prompt) return parsed.prompt;
    if (parsed?.query) return parsed.query;
    if (parsed?.input) return typeof parsed.input === 'string' ? parsed.input : null;

    return null;
  } catch {
    return null;
  }
}

/** Timeout for file scanning before defaulting to allow (15 seconds) */
const FILE_SCAN_TIMEOUT_MS = 15_000;

/**
 * Optional callback to transform the request body before sending.
 * Return null to send the original body, or return a new body string to replace it.
 */
export type BodyTransformer = (url: string, body: any) => { transformed: string; originalPrompt: string; maskedPrompt: string } | null;

export function installFetchInterceptor(
  onRequest: (request: InterceptedRequest) => void,
  onFileInFormData?: (file: File) => Promise<'allow' | 'block'>,
  bodyTransformer?: BodyTransformer
): () => void {
  // Save original implementations
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  // Patch window.fetch
  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || 'GET';
    const body = init?.body;

    if (isLLMEndpoint(url) && body) {
      try {
        let parsedBody: any = body;
        let shouldBlock = false;

        if (typeof body === 'string') {
          parsedBody = JSON.parse(body);
        } else if (body instanceof FormData) {
          // Detect file uploads in FormData — scan before allowing through
          parsedBody = '[FormData]';
          if (onFileInFormData) {
            for (const [, value] of (body as FormData).entries()) {
              if (value instanceof File && value.size > 0) {
                try {
                  // Hold the fetch until scanning completes (with timeout)
                  // Fail-closed: timeout and errors block the request
                  const decision = await Promise.race([
                    onFileInFormData(value),
                    new Promise<'block'>((resolve) =>
                      setTimeout(() => resolve('block'), FILE_SCAN_TIMEOUT_MS)
                    ),
                  ]);
                  if (decision === 'block') {
                    shouldBlock = true;
                    break; // One blocked file blocks the entire request
                  }
                } catch {
                  // Fail-closed: scan error blocks the request
                  shouldBlock = true;
                  break;
                }
              }
            }
          }
        } else if (body instanceof ReadableStream) {
          // Can't easily read streams without consuming them
          parsedBody = '[ReadableStream]';
        }

        onRequest({
          url,
          method,
          body: parsedBody,
          timestamp: Date.now(),
        });

        // If a file was blocked, return a fake response instead of sending to LLM
        if (shouldBlock) {
          console.log('[Iron Gate] File upload BLOCKED — sensitive content detected');
          return new Response(JSON.stringify({ blocked: true, reason: 'Iron Gate: sensitive document blocked' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {
        // Don't break the original request on parse errors
      }
    }

    // In proxy mode, transform the body before sending
    if (isLLMEndpoint(url) && bodyTransformer && init?.body && typeof init.body === 'string') {
      try {
        const result = bodyTransformer(url, init.body);
        if (result) {
          console.log(`[Iron Gate] Fetch interceptor: pseudonymized prompt before sending to ${url}`);
          return originalFetch.apply(this, [input, { ...init, body: result.transformed }]);
        }
      } catch (err) {
        console.warn('[Iron Gate] Body transform error, sending original:', err);
        // Warn user that pseudonymization failed — data is being sent unprotected
        try {
          window.postMessage({
            type: 'IRON_GATE_DEPSEUDO_FAILURE',
            detail: 'Pseudonymization failed — your prompt was sent without PII protection. Consider deleting the message.',
          }, window.location.origin);
        } catch { /* ignore */ }
      }
    }

    // Pass through to original
    return originalFetch.apply(this, [input, init]);
  };

  // Patch XMLHttpRequest
  const xhrUrlMap = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    ...args: any[]
  ) {
    xhrUrlMap.set(this, { url: url.toString(), method });
    return originalXHROpen.apply(this, [method, url, ...args] as any);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body?: any) {
    const info = xhrUrlMap.get(this);
    if (info && isLLMEndpoint(info.url) && body) {
      try {
        const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
        onRequest({
          url: info.url,
          method: info.method,
          body: parsedBody,
          timestamp: Date.now(),
        });
      } catch {
        // Don't break original request
      }
    }

    return originalXHRSend.apply(this, [body]);
  };

  // Return cleanup function
  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXHROpen;
    XMLHttpRequest.prototype.send = originalXHRSend;
  };
}

/**
 * Replace the prompt text inside a request payload with pseudonymized text.
 * Supports ChatGPT backend format, OpenAI format, and generic formats.
 */
function replacePromptInPayload(body: any, replacement: string): any {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    // ChatGPT backend format: { action, messages: [{ content: { parts: [...] } }] }
    if (parsed?.messages?.[0]?.content?.parts) {
      const lastIdx = parsed.messages.length - 1;
      const lastMsg = parsed.messages[lastIdx];
      if (lastMsg?.content?.parts) {
        lastMsg.content.parts = [replacement];
      } else if (lastMsg) {
        lastMsg.content = { content_type: 'text', parts: [replacement] };
      }
      return parsed;
    }

    // OpenAI format: { messages: [{ role, content }] }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUserIdx = parsed.messages.map((m: any) => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        if (typeof parsed.messages[lastUserIdx].content === 'string') {
          parsed.messages[lastUserIdx].content = replacement;
        } else if (Array.isArray(parsed.messages[lastUserIdx].content)) {
          const textParts = parsed.messages[lastUserIdx].content.filter((c: any) => c.type === 'text');
          if (textParts.length > 0) {
            textParts[0].text = replacement;
          }
        }
      }
      return parsed;
    }

    // Generic formats
    if (parsed?.prompt) { parsed.prompt = replacement; return parsed; }
    if (parsed?.query) { parsed.query = replacement; return parsed; }
    if (typeof parsed?.input === 'string') { parsed.input = replacement; return parsed; }

    return null; // Unknown format — don't transform
  } catch {
    return null;
  }
}

export { extractPromptFromPayload, replacePromptInPayload };
