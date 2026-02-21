/**
 * SSE Streaming Transformer.
 * Depseudonymizes text content in Server-Sent Events streams.
 *
 * Strategy: Buffer-and-flush with lookahead.
 * We hold back up to maxPseudonymLength chars to avoid splitting
 * a pseudonym across chunks. Once the buffer exceeds that length,
 * we flush the safe prefix through depseudonymize().
 */

import type { Pseudonymizer } from '../../../api/src/proxy/pseudonymizer';

// Max pseudonym length across all fake-value pools.
// Longest: "742 Evergreen Terrace, Springfield, IL 62704" = 45 chars
const MAX_PSEUDONYM_LENGTH = 50;

/**
 * Stream depseudonymizer that buffers text to handle pseudonyms split across chunks.
 */
class StreamDepseudonymizer {
  private buffer = '';

  constructor(private pseudonymizer: Pseudonymizer) {}

  processChunk(chunk: string): string {
    this.buffer += chunk;

    if (this.buffer.length <= MAX_PSEUDONYM_LENGTH) {
      return ''; // Not enough data yet — keep buffering
    }

    const safeLength = this.buffer.length - MAX_PSEUDONYM_LENGTH;
    const safeText = this.buffer.slice(0, safeLength);
    this.buffer = this.buffer.slice(safeLength);

    return this.pseudonymizer.depseudonymize(safeText);
  }

  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    if (!remaining) return '';
    return this.pseudonymizer.depseudonymize(remaining);
  }
}

/**
 * Create a TransformStream that depseudonymizes OpenAI SSE chunks.
 * OpenAI format: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 */
export function createOpenAIStreamTransformer(
  pseudonymizer: Pseudonymizer,
): TransformStream<Uint8Array, Uint8Array> {
  const depseud = new StreamDepseudonymizer(pseudonymizer);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = '';

  return new TransformStream({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            // Flush remaining buffered text as a final delta
            const remaining = depseud.flush();
            if (remaining) {
              const finalChunk = {
                choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content.length > 0) {
              const depseudonymized = depseud.processChunk(content);
              if (depseudonymized) {
                parsed.choices[0].delta.content = depseudonymized;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
              }
              // If empty, we're still buffering — don't emit
              continue;
            }
          } catch {
            // Non-JSON data line, pass through
          }
        }

        // Non-data lines (comments, empty lines) pass through
        controller.enqueue(encoder.encode(line + '\n'));
      }
    },

    flush(controller) {
      const remaining = depseud.flush();
      if (remaining) {
        const finalChunk = {
          choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      }
      if (lineBuffer) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  });
}

/**
 * Create a TransformStream that depseudonymizes Anthropic SSE chunks.
 * Anthropic format:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 */
export function createAnthropicStreamTransformer(
  pseudonymizer: Pseudonymizer,
): TransformStream<Uint8Array, Uint8Array> {
  const depseud = new StreamDepseudonymizer(pseudonymizer);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = '';

  return new TransformStream({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          try {
            const parsed = JSON.parse(data);

            // Handle content_block_delta with text_delta
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text;
              if (typeof text === 'string' && text.length > 0) {
                const depseudonymized = depseud.processChunk(text);
                if (depseudonymized) {
                  parsed.delta.text = depseudonymized;
                  controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(parsed)}\n\n`));
                }
                continue;
              }
            }

            // Handle message_stop — flush remaining
            if (parsed.type === 'message_stop') {
              const remaining = depseud.flush();
              if (remaining) {
                const flushEvent = {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: remaining },
                };
                controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(flushEvent)}\n\n`));
              }
              controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify(parsed)}\n\n`));
              continue;
            }
          } catch {
            // Non-JSON, pass through
          }
        }

        // Pass through event lines, comments, empty lines
        controller.enqueue(encoder.encode(line + '\n'));
      }
    },

    flush(controller) {
      const remaining = depseud.flush();
      if (remaining) {
        const flushEvent = {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: remaining },
        };
        controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(flushEvent)}\n\n`));
      }
      if (lineBuffer) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  });
}
