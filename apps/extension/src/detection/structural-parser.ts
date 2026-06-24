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

// ─── Prose key:value parser ──────────────────────────────────────────────────
// Recognizes inline labeled fields in natural-language prose, e.g.
//   "Patient Jane Miller, MRN: MED-789012, DOB: 08/14/1965. Insurance ID:
//    BCBS-2024-456789. Member: Lisa Park, Group #GRP-9012. Account: 483726159"
// This is the architectural fix for labeled identifiers leaking: the LABEL
// (MRN, Insurance ID, Account, …) is the sensitivity signal, so the value is
// protected REGARDLESS of its format — no per-format regex whack-a-mole.
//
// Design: generic SEGMENTATION here (any "Label: value" / "Label #value"),
// SENSITIVITY decided downstream by key-name-sensitivity.classifyKeyName().
// A mis-segmented non-sensitive label is harmless — its value just gets the
// same format-regex scan it would have gotten as free text; protection only
// happens for vocabulary labels.

const CLAUSE_BOUNDARY = /[,.;\n]/;
// Scheme-like words that precede ':' but are NOT field labels (URLs, times).
const NON_LABEL = new Set(['http', 'https', 'ftp', 'ftps', 'ssh', 'ws', 'wss', 'mailto', 'tel', 'file', 'data']);

interface SepMarker { sepIdx: number; labelStart: number; labelEnd: number; key: string; valueStart: number; }

// Words that, when they are the word right before the separator, indicate a
// MULTI-word label (the preceding word is part of the label, not the previous
// value): "Insurance ID", "Account Number", "Sort Code", "Medical Record".
const LABEL_CONTINUATION = new Set(['id', 'ids', 'no', 'num', 'number', 'code', 'record', 'name', 'type', 'key']);

// One pure-letter word ending at `end` (exclusive). Returns null if the char
// before `end` (after skipping spaces) isn't a letter.
function letterWordBefore(text: string, end: number): { word: string; start: number } | null {
  let we = end;
  while (we > 0 && text[we - 1] === ' ') we--;
  let ws = we;
  while (ws > 0 && /[A-Za-z]/.test(text[ws - 1])) ws--;
  if (ws === we) return null;
  return { word: text.substring(ws, we), start: ws };
}

// Extract the field label immediately before a separator. Default: the single
// word before the sep. Extended to a second (and third) word ONLY when the
// trailing word is a continuation word (ID/Number/Code/…). This correctly
// keeps "Insurance ID" whole while yielding just "Bank" from
// "...Global Trading LLC Bank:" — the disambiguation needed for delimiter-less
// prose like wire instructions.
function extractLabel(text: string, sepIdx: number): { key: string; start: number; end: number } | null {
  let end = sepIdx;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  const labelEnd = end;

  const w1 = letterWordBefore(text, labelEnd);
  if (!w1) return null;
  let start = w1.start;

  // Extend left while the CURRENT leftmost word is a continuation word and the
  // preceding char is a single space (i.e. another label word, not a boundary).
  let leftmost = w1.word.toLowerCase();
  let guard = 0;
  while (guard++ < 2 && LABEL_CONTINUATION.has(leftmost) && start > 0 && text[start - 1] === ' ') {
    const prev = letterWordBefore(text, start);
    if (!prev) break;
    start = prev.start;
    leftmost = prev.word.toLowerCase();
  }

  const key = text.substring(start, labelEnd).trim();
  if (key.length < 2 || key.length > 40) return null;
  if (NON_LABEL.has(key.toLowerCase())) return null;
  return { key, start, end: labelEnd };
}

function findProseMarkers(text: string): SepMarker[] {
  const markers: SepMarker[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== ':' && c !== '#') continue;
    if (c === ':' && text.substr(i + 1, 2) === '//') continue; // URL scheme
    const label = extractLabel(text, i);
    if (!label) continue;
    let vs = i + 1;
    while (vs < text.length && /\s/.test(text[vs])) vs++;
    markers.push({ sepIdx: i, labelStart: label.start, labelEnd: label.end, key: label.key, valueStart: vs });
  }
  return markers;
}

function parseProseKv(text: string): ParsedRecord[] {
  const markers = findProseMarkers(text);
  if (markers.length === 0) return [];
  const records: ParsedRecord[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    // Value ends at the first clause boundary at/after valueStart, OR at the
    // start of the next field's label (so "Routing: 021000021 Account: ..."
    // splits even without a comma), whichever comes first.
    let valueEnd = text.length;
    for (let j = cur.valueStart; j < text.length; j++) {
      if (CLAUSE_BOUNDARY.test(text[j])) { valueEnd = j; break; }
    }
    if (next && next.labelStart < valueEnd && next.labelStart > cur.valueStart) {
      valueEnd = next.labelStart;
    }
    const trimmedEnd = trimTrailingWs(text, valueEnd, cur.valueStart);
    if (trimmedEnd <= cur.valueStart) continue; // empty value
    const value = text.substring(cur.valueStart, trimmedEnd);
    if (value.trim().length < 2) continue; // degenerate value
    records.push({
      kind: 'prose_kv',
      key: cur.key,
      value,
      keySpan: [cur.labelStart, cur.labelEnd],
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

  // Phase 1: env-var records (KEY=VALUE). Highest precedence.
  const envRecords = parseEnvVars(text);

  // Phase 2: prose key:value records ("MRN: MED-789012"). Drop any that
  // overlap an env-var record so all spans stay pairwise non-overlapping.
  const envCovers = (s: number, e: number): boolean =>
    envRecords.some((r) => s < r.valueSpan[1] && e > r.keySpan[0]);
  const proseRecords = parseProseKv(text).filter(
    (r) => !envCovers(r.keySpan[0], r.valueSpan[1]),
  );

  const records = [...envRecords, ...proseRecords];

  // Sort records by keySpan start so free-text gap computation is correct.
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
