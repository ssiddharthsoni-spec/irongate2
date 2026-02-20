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
      return lastMsg.content.parts.join('\n');
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

export function installFetchInterceptor(
  onRequest: (request: InterceptedRequest) => void
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
        if (typeof body === 'string') {
          parsedBody = JSON.parse(body);
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
      } catch {
        // Don't break the original request on parse errors
      }
    }

    // Always pass through to original
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

export { extractPromptFromPayload };
