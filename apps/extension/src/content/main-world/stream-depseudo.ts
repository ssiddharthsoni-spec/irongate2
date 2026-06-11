/**
 * Stream De-pseudonymization Cores — extracted from main-world.ts
 *
 * Pure relocation (June 2026): the bodies of depseudonymizeResponseRaw and
 * depseudonymizeResponse moved here UNCHANGED so unit tests can exercise the
 * SHIPPED stream-wrapping code instead of mirror copies. All main-world
 * module-state (igLog, _activeStreamCount, _onStreamEnd, recordReplacements,
 * replacePseudonyms cache wrapper, activeAdapter) is injected via the factory
 * context — this module must never reference main-world state directly.
 *
 * IMPORTANT: This module runs in MAIN world (page context). No chrome.* APIs.
 */

import { buildRegexCache, HoldbackReplacer } from './depseudo-engine';

// Fields we KEEP inside message.metadata. Anything else gets dropped.
// This is an inverted whitelist: instead of chasing ChatGPT's evolving list
// of offset-based citation/entity fields (displayedContentReferences,
// cite_metadata, content_references, and whatever they add next), we drop
// the entire metadata bag and only put back fields we know are needed for
// basic rendering. New ChatGPT metadata fields can no longer break us by
// leaving offset-shifted markers in the rendered output.
export const KEEP_METADATA_FIELDS = new Set<string>([
  'message_type',
  'model_slug',
  'default_model_slug',
  'parent_id',
  'request_id',
  'timestamp_',
  'finish_details',
  'status',
  'is_complete',
  'voice_mode_message',
]);

export interface StreamDepseudoContext {
  /** main-world's stateful cache wrapper around replacePseudonymsCore */
  replacePseudonyms: (text: string, map: Record<string, string>) => string;
  /** main-world's igLog (debug-gated) */
  log: (...args: any[]) => void;
  /** main-world's _IG_DEBUG flag (read once at factory creation, same as the original const) */
  isDebug: () => boolean;
  /** main-world increments _activeStreamCount (M-4 deferred clear) */
  onStreamStart: () => void;
  /** main-world's _onStreamEnd (M-4) */
  onStreamEnd: () => void;
  /** WP2 per-mechanism replacement telemetry */
  recordReplacements: (mechanism: 'wire-raw' | 'wire-sse', count: number) => void;
  /** activeAdapter?.id — for the strategy-dispatch debug log */
  getAdapterId: () => string | undefined;
  /** activeAdapter?.responseStreamStrategy — live strategy dispatch */
  getResponseStreamStrategy: () => 'sse-content' | 'raw-chunk' | 'none' | undefined;
  /** activeAdapter.extractResponseContent (bound), when the adapter provides one */
  extractResponseContent?: (parsed: any) => { mode: 'accumulated' | 'delta'; content: string } | null;
  /** activeAdapter.injectResponseContent (bound), when the adapter provides one */
  injectResponseContent?: (parsed: any, mode: 'accumulated' | 'delta', content: string) => void;
}

export function createStreamDepseudo(ctx: StreamDepseudoContext): {
  depseudonymizeResponseRaw(response: Response, reverseMap: Record<string, string>): Response;
  depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response;
} {
  const { replacePseudonyms, log: igLog, recordReplacements } = ctx;
  const _IG_DEBUG = ctx.isDebug();

  /**
   * Raw-chunk response de-pseudonymization.
   * Decodes each chunk, runs replacePseudonyms on the full decoded text,
   * re-encodes and passes through. No SSE parsing — works with any format.
   * Best for platforms with non-standard SSE (Claude.ai).
   */
  function depseudonymizeResponseRaw(response: Response, reverseMap: Record<string, string>): Response {
    if (!response.body || response.bodyUsed) return response;

    // M-6 fix: Snapshot the reverse map at stream-creation time so that
    // concurrent pseudonymization from another prompt cannot pollute this stream.
    const snapshotMap = { ...reverseMap };
    const mapKeys = Object.keys(snapshotMap);
    if (mapKeys.length === 0) return response;

    // BUG-35: Use igLog only (rate-limited) — console.log here caused spam with 100+ entity convos
    igLog(`depseudonymizeResponseRaw: wrapping stream with ${mapKeys.length} mappings (raw-chunk mode)`);

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader();
    } catch (readerErr) {
      console.warn('[Iron Gate MAIN] depseudonymizeResponseRaw: getReader() failed —', readerErr instanceof Error ? readerErr.message : String(readerErr));
      return response;
    }

    // M-4: Track active stream for deferred clear
    ctx.onStreamStart();

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let chunkCount = 0;

    // DEF-031: prefix-aware holdback (extracted to depseudo-engine.ts so the
    // chunk-boundary logic is unit-tested against the SHIPPED code). The
    // previous inline version split before replacing, leaking pseudonyms that
    // straddled the cut, and flushed the holdback unreplaced on error.
    // Candidate tokens come from the real regex cache so fragment entries
    // (first names of multi-word fakes) are held back too.
    const hb = new HoldbackReplacer(
      (text) => replacePseudonyms(text, snapshotMap),
      buildRegexCache(snapshotMap).map((e) => e.pseudonym),
    );

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            const remainder = hb.flush();
            if (remainder.length > 0) controller.enqueue(encoder.encode(remainder));
            igLog(`depseudonymizeResponseRaw: stream complete — ${chunkCount} chunks, ${hb.replacedCount} replacements`);
            recordReplacements('wire-raw', hb.replacedCount);
            controller.close();
            ctx.onStreamEnd(); // M-4
            return;
          }

          chunkCount++;
          const safeText = hb.push(decoder.decode(value, { stream: true }));
          if (safeText.length > 0) {
            controller.enqueue(encoder.encode(safeText));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isAbort = msg.includes('aborted') || msg.includes('abort') || msg.includes('cancel');
          if (!isAbort) {
            console.warn('[Iron Gate MAIN] depseudonymizeResponseRaw: stream error', msg);
          }
          try {
            const remainder = hb.flush();
            if (remainder.length > 0) controller.enqueue(encoder.encode(remainder));
            controller.close();
          } catch {
            try { controller.error(err); } catch { /* already closed */ }
          }
          ctx.onStreamEnd(); // M-4
        }
      },
    });

    const wrappedHeaders = new Headers(response.headers);
    wrappedHeaders.delete('Content-Encoding');
    wrappedHeaders.delete('Content-Length');

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: wrappedHeaders,
    });
  }

  /**
   * Content-level SSE de-pseudonymization.
   *
   * Architecture: instead of replacing pseudonyms in raw SSE transport text
   * (where "James Park" is split across two JSON objects and never contiguous),
   * we operate at the CONTENT level:
   *
   *   SSE bytes → line splitter → JSON parser → content extractor
   *     → content accumulator → pseudonym replacer → SSE rebuilder → output
   *
   * Two SSE content formats are supported:
   *   1. Accumulated (ChatGPT): each event has full text so far in parts[0]
   *   2. Delta (OpenAI API / Claude): each event has only the new token
   *
   * For accumulated format: replace in the full content; the frontend naturally
   * shows the latest version (corrections appear seamlessly).
   *
   * For delta format: accumulate deltas into a running buffer, replace in the
   * full buffer, diff against previously emitted content to compute the
   * corrected delta.
   *
   * Fallback: non-JSON or unrecognized SSE lines get raw text replacement.
   */
  function depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response {
    if (!response.body) {
      igLog('depseudonymizeResponse: no response body — skipping');
      return response;
    }
    // Guard: if body is already locked/consumed, we can't wrap it
    if (response.bodyUsed) {
      igLog('depseudonymizeResponse: body already used — skipping');
      return response;
    }

    // M-6 fix: Snapshot the reverse map at stream-creation time so that
    // concurrent pseudonymization from another prompt cannot pollute this stream.
    const snapshotMap = { ...reverseMap };
    const mapKeys = Object.keys(snapshotMap);
    if (mapKeys.length === 0) {
      igLog('depseudonymizeResponse: no mappings — returning response as-is');
      return response;
    }

    // Check adapter strategy — dispatch to raw-chunk mode for platforms like Claude
    const strategy = ctx.getResponseStreamStrategy() || 'sse-content';
    if (_IG_DEBUG) {
      igLog(`depseudonymizeResponse strategy dispatch: adapter=${ctx.getAdapterId() || 'null'}, strategy=${strategy}, adapterProp=${ctx.getResponseStreamStrategy() ?? 'MISSING'}`);
    }
    if (strategy === 'raw-chunk') {
      return depseudonymizeResponseRaw(response, snapshotMap);
    }
    if (strategy === 'none') {
      return response;
    }

    if (_IG_DEBUG) {
      igLog(`depseudonymizeResponse wrapping stream — ${mapKeys.length} mappings (sse-content): ${mapKeys.join(', ')}`);
    }

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader();
    } catch (readerErr) {
      console.warn('[Iron Gate MAIN] depseudonymizeResponse: getReader() failed —', readerErr instanceof Error ? readerErr.message : String(readerErr));
      return response;
    }

    // M-4: Track active stream for deferred clear
    ctx.onStreamStart();

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Longest pseudonym — used as holdback margin for partial matches at content tail
    const maxPseudoLen = Math.min(Math.max(...mapKeys.map(k => k.length), 0), 200);

    // ── State ──
    let lineBuffer = '';           // Raw bytes → complete lines
    let deltaAccumulator = '';     // Running content for delta-style SSE
    let emittedDeltaLen = 0;       // How much of replaced delta content we've emitted
    let chunkCount = 0;
    let totalReplacements = 0;

    // ── Content extraction: find the text content in an SSE JSON object ──
    // Returns { mode, content } or null if no content found.
    // Uses adapter-specific extractor when available, falls back to generic patterns.
    function extractContent(parsed: any): { mode: 'accumulated' | 'delta'; content: string } | null {
      // Try adapter-specific extraction first
      if (ctx.extractResponseContent) {
        const result = ctx.extractResponseContent(parsed);
        if (result) return result;
      }

      // Generic fallbacks — covers ChatGPT, OpenAI API, Anthropic API, Claude.ai
      // ChatGPT accumulated: message.content.parts[0] has full text so far
      const parts = parsed?.message?.content?.parts;
      if (Array.isArray(parts) && typeof parts[0] === 'string') {
        return { mode: 'accumulated', content: parts[0] };
      }
      // OpenAI API delta: choices[0].delta.content
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        return { mode: 'delta', content: delta };
      }
      // Anthropic Messages API stream: delta.text (content_block_delta events)
      const anthropicDelta = parsed?.delta?.text;
      if (typeof anthropicDelta === 'string') {
        return { mode: 'delta', content: anthropicDelta };
      }
      // Claude.ai web: { completion: "accumulated text so far" }
      const completion = parsed?.completion;
      if (typeof completion === 'string') {
        return { mode: 'accumulated', content: completion };
      }
      // ChatGPT 2025+ JSON patch: {"o":"append/add/patch","v":"text or [ops]"}
      // Match on operation type broadly — path format varies across versions
      if (parsed?.o === 'append' && typeof parsed?.v === 'string' && parsed.v.length > 0) {
        return { mode: 'delta', content: parsed.v };
      }
      if (parsed?.o === 'add' && typeof parsed?.v === 'string' && parsed.v.length > 0 && parsed?.p?.includes('content')) {
        return { mode: 'accumulated', content: parsed.v };
      }
      if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
        for (const op of parsed.v) {
          if (op?.o === 'append' && typeof op?.v === 'string' && op.v.length > 0) {
            return { mode: 'delta', content: op.v };
          }
        }
      }
      if (parsed?.v?.message?.content?.parts) {
        const vParts = parsed.v.message.content.parts;
        if (Array.isArray(vParts) && typeof vParts[0] === 'string') {
          return { mode: 'accumulated', content: vParts[0] };
        }
      }
      return null;
    }

    // ── Content injection: put modified content back into SSE JSON ──
    // Uses adapter-specific injector when available, falls back to generic patterns.
    function injectContent(parsed: any, mode: 'accumulated' | 'delta', content: string): void {
      // Try adapter-specific injection first
      if (ctx.injectResponseContent) {
        ctx.injectResponseContent(parsed, mode, content);
        return;
      }

      // Generic fallbacks
      if (mode === 'accumulated') {
        if (parsed?.message?.content?.parts) {
          parsed.message.content.parts[0] = content;
        } else if (parsed?.v?.message?.content?.parts) {
          parsed.v.message.content.parts[0] = content;
        } else if (parsed?.completion !== undefined) {
          parsed.completion = content;
        } else if (parsed?.o === 'add' && typeof parsed?.v === 'string') {
          parsed.v = content;
        }
      } else {
        if (parsed?.choices?.[0]?.delta?.content !== undefined) {
          parsed.choices[0].delta.content = content;
        } else if (parsed?.delta?.text !== undefined) {
          parsed.delta.text = content;
        } else if (parsed?.o === 'append' && typeof parsed?.v === 'string') {
          parsed.v = content;
        } else if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
          for (const op of parsed.v) {
            if ((op?.o === 'append' || op?.o === 'add') && typeof op?.v === 'string') {
              op.v = content;
              break;
            }
          }
        }
      }
    }

    // ── Strip offset annotations from parsed ChatGPT SSE ──
    // Inverted whitelist (see KEEP_METADATA_FIELDS at top of file): drop
    // everything in metadata except the small set we know is needed for
    // basic rendering. This protects us from ChatGPT adding new offset-based
    // metadata fields whose offsets are invalidated by pseudonym replacement.
    function stripAnnotations(parsed: any): void {
      const meta = parsed?.message?.metadata;
      if (!meta || typeof meta !== 'object') return;
      for (const key of Object.keys(meta)) {
        if (!KEEP_METADATA_FIELDS.has(key)) delete meta[key];
      }
    }

    // ── Process one complete SSE line ──
    // Returns the modified line string, or null to suppress (holdback for delta mode).
    function processSSELine(line: string): string | null {
      // Pass through empty lines (SSE event separators)
      if (line === '') return '';
      // Non-data lines: could be event types, comments, or raw JSON lines.
      // ChatGPT 2025+ sends raw JSON patch lines without "data: " prefix:
      //   {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"text"}]}
      // These MUST be parsed and content-extracted, not just raw-replaced.
      if (!line.startsWith('data: ')) {
        // Try JSON parsing for raw JSON lines (ChatGPT 2025+ patch format)
        if (line.startsWith('{') && line.length > 10) {
          try {
            const parsed = JSON.parse(line);
            const extracted = extractContent(parsed);
            if (extracted) {
              chunkCount++;
              const { mode, content } = extracted;
              if (mode === 'accumulated') {
                const replaced = replacePseudonyms(content, snapshotMap);
                if (replaced !== content) totalReplacements++;
                stripAnnotations(parsed);
                injectContent(parsed, mode, replaced);
                return JSON.stringify(parsed);
              } else {
                deltaAccumulator += content;
                const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
                if (replaced !== deltaAccumulator) totalReplacements++;
                // Hold back the last maxPseudoLen chars of the REPLACED text.
                // A pseudonym that's only partially in the accumulator (e.g.,
                // "Robert Ch" — first 9 chars of "Robert Chen") wouldn't have
                // matched yet, so it sits unchanged at the tail of `replaced`.
                // Holding back maxPseudoLen there guarantees we never emit a
                // partial pseudonym. This is exact in replaced-coords — no
                // ratio approximation, no risk of advancing past a replacement.
                const safeLen = Math.max(emittedDeltaLen, replaced.length - maxPseudoLen);
                const newDelta = replaced.substring(emittedDeltaLen, safeLen);
                emittedDeltaLen = safeLen;
                injectContent(parsed, mode, newDelta.length > 0 ? newDelta : '');
                return JSON.stringify(parsed);
              }
            }
            // Parsed but no content — raw replacement on serialized JSON
            const reser = JSON.stringify(parsed);
            const replaced = replacePseudonyms(reser, snapshotMap);
            if (replaced !== reser) totalReplacements++;
            return replaced;
          } catch {
            // Not valid JSON — fall through to raw replacement
          }
        }
        if (line.length > 10) {
          const replaced = replacePseudonyms(line, snapshotMap);
          if (replaced !== line) totalReplacements++;
          return replaced;
        }
        return line;
      }
      // Pass through stream terminator
      const payload = line.substring(6);
      if (payload === '[DONE]' || payload.trim() === '[DONE]') return line;
      // Pass through non-JSON payloads
      if (!payload.startsWith('{') && !payload.startsWith('[')) {
        // Raw text replacement fallback
        const replaced = replacePseudonyms(payload, snapshotMap);
        if (replaced !== payload) totalReplacements++;
        return 'data: ' + replaced;
      }

      // ── JSON SSE line: parse, extract content, replace, rebuild ──
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Invalid JSON — raw text replacement fallback
        const replaced = replacePseudonyms(payload, snapshotMap);
        if (replaced !== payload) totalReplacements++;
        return 'data: ' + replaced;
      }

      const extracted = extractContent(parsed);
      if (!extracted) {
        // Log first few non-content events to understand format
        if (_IG_DEBUG && chunkCount <= 3) {
          igLog(`DEPSEUDO no content extracted from SSE (chunk ${chunkCount}):`, JSON.stringify(parsed).substring(0, 200));
        }
        // No content field (metadata event, etc.) — pass through with raw replacement
        const reser = JSON.stringify(parsed);
        const replaced = replacePseudonyms(reser, snapshotMap);
        if (replaced !== reser) totalReplacements++;
        return 'data: ' + replaced;
      }

      // Log first content extraction to verify format
      if (_IG_DEBUG && chunkCount <= 2 && extracted) {
        igLog(`DEPSEUDO content extracted (${extracted.mode}): "${extracted.content.substring(0, 50)}"`);
      }

      const { mode, content } = extracted;

      if (mode === 'accumulated') {
        // ── Accumulated format (ChatGPT) ──
        // Each event has the FULL text so far. Once both "James" and " Park"
        // are in the accumulated text, "James Park" appears contiguously.
        // Replace in the full content — the frontend always shows the latest
        // version, so corrections appear seamlessly with no flicker.
        const replaced = replacePseudonyms(content, snapshotMap);
        if (replaced !== content) totalReplacements++;
        stripAnnotations(parsed);
        injectContent(parsed, mode, replaced);
        return 'data: ' + JSON.stringify(parsed);
      }

      // ── Delta format (OpenAI API / Claude / others) ──
      // Each event has only the new token. Accumulate into a running buffer,
      // replace in the full buffer, diff to compute the corrected delta.
      deltaAccumulator += content;
      const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
      if (replaced !== deltaAccumulator) totalReplacements++;

      // Hold back the last maxPseudoLen chars of the REPLACED text. A
      // pseudonym only partially in the accumulator (e.g. "Robert Ch" out of
      // "Robert Chen") didn't match yet, so it sits unchanged at the tail of
      // `replaced`. Holding maxPseudoLen there guarantees we never emit a
      // partial pseudonym.
      //
      // Earlier this was a ratio-based mapping from unreplaced→replaced coords,
      // which produced fractional emit boundaries that landed inside or past
      // a replacement region — the source of the "Pantoprazoledication" /
      // "Patient Jane Millermary" corruption when chunks split across token
      // boundaries near a pseudonym.
      const safeLen = Math.max(emittedDeltaLen, replaced.length - maxPseudoLen);
      const newDelta = replaced.substring(emittedDeltaLen, safeLen);
      emittedDeltaLen = safeLen;

      if (newDelta.length === 0) {
        // Held back — but we MUST still emit the event to preserve SSE structure.
        // Claude/Anthropic SSE parsers expect a data line for every event: line.
        // Suppressing the data line breaks their JSON parser.
        // Emit with empty content — the frontend handles empty deltas gracefully.
        injectContent(parsed, mode, '');
        return 'data: ' + JSON.stringify(parsed);
      }

      injectContent(parsed, mode, newDelta);
      return 'data: ' + JSON.stringify(parsed);
    }

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            // ── Flush remaining data ──
            // Process any remaining complete lines in lineBuffer
            if (lineBuffer.length > 0) {
              const remaining = lineBuffer;
              lineBuffer = '';
              const lines = remaining.split('\n');
              for (const line of lines) {
                const result = processSSELine(line);
                if (result !== null) {
                  controller.enqueue(encoder.encode(result + '\n'));
                }
              }
            }

            // Flush held-back delta content
            if (emittedDeltaLen < deltaAccumulator.length) {
              const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
              const finalDelta = replaced.substring(emittedDeltaLen);
              if (finalDelta.length > 0) {
                // Emit as a raw data line (the stream is ending, format doesn't matter)
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":' + JSON.stringify(finalDelta) + '}}]}\n'));
              }
            }

            if (_IG_DEBUG) {
              igLog(`depseudonymizeResponse stream complete — ${chunkCount} chunks, ${totalReplacements} replacements, deltaAccum=${deltaAccumulator.length} chars`);
              recordReplacements('wire-sse', totalReplacements);
            }
            controller.close();
            ctx.onStreamEnd(); // M-4
            return;
          }

          chunkCount++;
          lineBuffer += decoder.decode(value, { stream: true });

          // Split into complete lines. SSE events are delimited by \n.
          // Keep the last segment (might be incomplete) in lineBuffer.
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            const result = processSSELine(line);
            if (result !== null) {
              controller.enqueue(encoder.encode(result + '\n'));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isAbort = msg.includes('aborted') || msg.includes('abort') || msg.includes('cancel');
          if (!isAbort) {
            console.warn('[Iron Gate MAIN] depseudonymizeResponse: stream error', msg);
            try {
              window.postMessage({
                type: 'IRON_GATE_DEPSEUDO_FAILURE',
                detail: 'De-pseudonymization stream error — some fake names may appear in the AI response.',
              }, window.location.origin);
            } catch { /* ignore */ }
          }
          // Fail gracefully: flush whatever we have and close.
          try {
            if (lineBuffer.length > 0) {
              controller.enqueue(encoder.encode(lineBuffer));
              lineBuffer = '';
            }
            controller.close();
          } catch {
            try { controller.error(err); } catch { /* already closed */ }
          }
          ctx.onStreamEnd(); // M-4
        }
      },
    });

    // Strip Content-Encoding and Content-Length from the wrapped response.
    // The original response body is already decompressed by the browser;
    // copying these headers to our wrapped Response could cause issues
    // (e.g., frontend expecting compressed data but getting plaintext,
    // or Content-Length mismatch after replacement changes text length).
    const wrappedHeaders = new Headers(response.headers);
    wrappedHeaders.delete('Content-Encoding');
    wrappedHeaders.delete('Content-Length');

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: wrappedHeaders,
    });
  }

  return { depseudonymizeResponseRaw, depseudonymizeResponse };
}
