/**
 * Structural Parser — recognizes common record formats inside a prompt
 * (env vars, prose key:value pairs, etc.) and yields TYPED, BOUNDED records.
 *
 * Why this exists: detection used to run flat regex over the raw prompt. That
 * had two failure modes the rest of the system kept paying for:
 *   1. Greedy regexes (e.g. `postgres://[^\s"']+`) crossed logical boundaries
 *      when whitespace was missing between values. A run-on `.env` paste
 *      collapsed three env vars into one URL match.
 *   2. The variable name (`AWS_SECRET_ACCESS_KEY=`) is itself the strongest
 *      sensitivity signal for many credentials, but flat regex could only
 *      look at value formats. Anything not matching a known format slipped
 *      through, even when the name made the value's role obvious.
 *
 * The parser fixes both at the data-shape level: detectors run PER-RECORD,
 * within bounded `valueSpan`, with the `key` available as a separate signal.
 * Greedy matching becomes safe; key-name detection becomes possible.
 */

export type RecordKind = 'env_var' | 'prose_kv';

export interface ParsedRecord {
  kind: RecordKind;
  key: string;
  value: string;
  /** Span of the key in the original text, or undefined for un-keyed records. */
  keySpan: [number, number];
  /** Span of the value in the original text. Detection runs in this range. */
  valueSpan: [number, number];
}

export interface FreeTextSpan {
  text: string;
  /** Span in the original text. */
  span: [number, number];
}

export interface ParsedPrompt {
  records: ParsedRecord[];
  /** Text NOT covered by any record. Free-text detectors run here. */
  freeText: FreeTextSpan[];
}

// ─── Env-var parser ─────────────────────────────────────────────────────────
// Recognizes `KEY=VALUE` records where KEY is uppercase + digits + underscore,
// at least 2 chars, starts with a letter. The value extends from after `=`
// until the *next* `KEY=` boundary or end-of-text — newlines are NOT required.
// This is what makes the parser correct on run-on input.

// Conservative: KEY must start with uppercase letter, then 2+ uppercase/digit/_.
// Length floor of 3 chars total avoids matching incidental things like "T=foo".
const ENV_KEY_RE = /([A-Z][A-Z0-9_]{2,})\s*=/g;

interface RawEnvMatch {
  key: string;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
}

function findEnvKeyBoundaries(text: string): RawEnvMatch[] {
  const out: RawEnvMatch[] = [];
  ENV_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENV_KEY_RE.exec(text)) !== null) {
    if (m[0].length === 0) { ENV_KEY_RE.lastIndex++; continue; }
    out.push({
      key: m[1],
      keyStart: m.index,
      keyEnd: m.index + m[1].length,
      valueStart: m.index + m[0].length,
    });
  }
  return out;
}

function trimTrailingWs(text: string, end: number, start: number): number {
  let e = end;
  while (e > start && /\s/.test(text.charAt(e - 1))) e--;
  return e;
}

function parseEnvVars(text: string): ParsedRecord[] {
  const matches = findEnvKeyBoundaries(text);
  if (matches.length === 0) return [];

  const records: ParsedRecord[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];

    // Value extends to the next KEY= boundary or end-of-text. We DO NOT
    // require a newline between records — a paste with stripped newlines
    // (the bug we hit) still parses correctly because the next KEY=
    // boundary is the natural stop.
    let valueEnd = next ? next.keyStart : text.length;
    // Prefer to stop at a newline if one occurs before the next boundary
    // (env files conventionally use newline separation).
    const nl = text.indexOf('\n', cur.valueStart);
    if (nl !== -1 && nl < valueEnd) valueEnd = nl;

    const trimmedEnd = trimTrailingWs(text, valueEnd, cur.valueStart);
    if (trimmedEnd <= cur.valueStart) continue; // empty value — skip

    records.push({
      kind: 'env_var',
      key: cur.key,
      value: text.substring(cur.valueStart, trimmedEnd),
      keySpan: [cur.keyStart, cur.keyEnd],
      valueSpan: [cur.valueStart, trimmedEnd],
    });
  }
  return records;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Parse the prompt text into typed records plus the free-text gaps between
 * them. Detectors should run per-record (within `valueSpan`) for any record,
 * and over each `freeText` span for the rest. By construction, all spans
 * returned here are pairwise non-overlapping.
 */
export function parseStructured(text: string): ParsedPrompt {
  if (!text || text.length === 0) {
    return { records: [], freeText: [] };
  }

  // Phase 1: env-var records. Other parsers (JSON, headers, query strings)
  // can be added here as siblings — each yields ParsedRecord[] over disjoint
  // spans, and the merge step ensures none of them claim the same character.
  const records = parseEnvVars(text);

  // Sort records by keySpan start (defensive — ENV_KEY_RE already iterates
  // left-to-right, but other parsers might not).
  records.sort((a, b) => a.keySpan[0] - b.keySpan[0]);

  // Compute free-text gaps between record spans.
  const freeText: FreeTextSpan[] = [];
  let cursor = 0;
  for (const r of records) {
    const recStart = r.keySpan[0];
    if (recStart > cursor) {
      const gap = text.substring(cursor, recStart);
      if (gap.length > 0) freeText.push({ text: gap, span: [cursor, recStart] });
    }
    cursor = r.valueSpan[1];
  }
  if (cursor < text.length) {
    const tail = text.substring(cursor, text.length);
    if (tail.length > 0) freeText.push({ text: tail, span: [cursor, text.length] });
  }

  return { records, freeText };
}
