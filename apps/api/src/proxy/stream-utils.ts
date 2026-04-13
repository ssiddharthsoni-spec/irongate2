// ============================================================================
// Streaming Utilities for LLM Providers
// ============================================================================
//
// Helpers shared by OpenAI, Gemini, Azure, and Anthropic streaming
// implementations. Handles SSE parsing, chunked de-pseudonymization with
// buffer safety, and safe passthrough formatting.

/**
 * Parse an SSE-style streamed response into text chunks.
 * Works for OpenAI-compatible endpoints (`data: {...}\n\n`).
 *
 * Yields the incremental content string from each `choices[0].delta.content`
 * field. Skips non-JSON lines, heartbeats, and the `[DONE]` terminator.
 */
export async function* parseOpenAISseChunks(
  response: Response,
): AsyncGenerator<string, void, unknown> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep partial last line

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Ignore unparseable frames (keepalives, provider-specific noise)
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/**
 * Parse an Anthropic-format SSE stream.
 * Anthropic uses `event: <type>` + `data: {...}` pairs. For text generation,
 * the relevant events are `content_block_delta` with a `text_delta` payload.
 */
export async function* parseAnthropicSseChunks(
  response: Response,
): AsyncGenerator<string, void, unknown> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const text = parsed.delta.text;
            if (text) yield text;
          }
        } catch {
          // Ignore unparseable frames
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/**
 * Buffered de-pseudonymizer for streaming output.
 *
 * Pseudonyms can span chunk boundaries ("Emily" + " Rogers"). This holds the
 * last `bufferSize` characters back before emitting, guaranteeing any
 * pseudonym up to `bufferSize` characters long will be fully present in the
 * buffer when we de-pseudonymize.
 *
 * Usage:
 *   const buf = new StreamDepseudoBuffer(50, (text) => depseudo(text));
 *   for await (const chunk of stream) {
 *     for (const out of buf.push(chunk)) yield out;
 *   }
 *   for (const out of buf.flush()) yield out;
 */
export class StreamDepseudoBuffer {
  private buffer = '';
  private readonly bufferSize: number;
  private readonly transform: (text: string) => string;

  constructor(bufferSize: number, transform: (text: string) => string) {
    this.bufferSize = bufferSize;
    this.transform = transform;
  }

  /** Push a new chunk. Returns any text ready to emit (may be empty). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length <= this.bufferSize) return [];

    // Emit everything except the tail we need to keep for cross-chunk safety
    const toEmitRaw = this.buffer.slice(0, this.buffer.length - this.bufferSize);
    this.buffer = this.buffer.slice(this.buffer.length - this.bufferSize);
    const transformed = this.transform(toEmitRaw);
    return transformed.length > 0 ? [transformed] : [];
  }

  /** Flush the remaining buffer at stream end. */
  flush(): string[] {
    if (this.buffer.length === 0) return [];
    const transformed = this.transform(this.buffer);
    this.buffer = '';
    return transformed.length > 0 ? [transformed] : [];
  }
}

/**
 * Format a text chunk as an OpenAI-style SSE frame.
 */
export function formatOpenAIStreamChunk(
  text: string,
  params: { id: string; model: string; created: number; finishReason?: string | null },
): string {
  const payload = {
    id: params.id,
    object: 'chat.completion.chunk',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: params.finishReason ?? null,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * The "done" terminator frame expected by OpenAI-compatible SDKs.
 */
export const OPENAI_STREAM_DONE = 'data: [DONE]\n\n';

/**
 * Format an Anthropic-style SSE text_delta frame.
 */
export function formatAnthropicStreamChunk(text: string, index = 0): string {
  const payload = {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(payload)}\n\n`;
}
