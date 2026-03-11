/**
 * Data Structure Detector — Contextual Intelligence Engine Layer 2
 *
 * Detects structural data patterns that indicate pasted documents,
 * tabular data, forms, or record collections — independent of
 * entity detection.
 *
 * Structure detection is a strong signal: tabular data with PII
 * is almost always a data dump, never a casual question.
 *
 * Output: { structureType, multiplier, confidence }
 *   multiplier > 1.0 amplifies sensitivity (tabular data)
 *   multiplier < 1.0 would suppress (not used — structure = risk)
 */

export type StructureType =
  | 'tabular'        // CSV/TSV/pipe-delimited rows
  | 'key_value'      // "Name: John Smith\nDOB: 1990-01-15"
  | 'email_headers'  // Forwarded email with From/To/Subject
  | 'document_block' // Multi-paragraph with headers
  | 'entity_list'    // Bullet/numbered list of names/orgs
  | 'code_block'     // Code (suppresses — entities in code are usually examples)
  | 'none';

export interface StructureDetectionResult {
  type: StructureType;
  multiplier: number;
  confidence: number;
}

// ── Structure multipliers ────────────────────────────────────────────────────

const STRUCTURE_MULTIPLIERS: Record<StructureType, number> = {
  tabular: 1.5,
  key_value: 1.4,
  email_headers: 1.3,
  document_block: 1.2,
  entity_list: 1.3,
  code_block: 0.5,
  none: 1.0,
};

// ── Detectors ────────────────────────────────────────────────────────────────

/**
 * Detect structural patterns in text.
 * Returns the highest-confidence structure found.
 */
export function detectStructure(text: string): StructureDetectionResult {
  if (!text || text.length < 10) {
    return { type: 'none', multiplier: 1.0, confidence: 0 };
  }

  // Priority order — most specific first
  const detectors: Array<() => StructureDetectionResult | null> = [
    () => detectCodeBlock(text),
    () => detectTabular(text),
    () => detectKeyValue(text),
    () => detectEmailHeaders(text),
    () => detectEntityList(text),
    () => detectDocumentBlock(text),
  ];

  for (const detect of detectors) {
    const result = detect();
    if (result) return result;
  }

  return { type: 'none', multiplier: 1.0, confidence: 0 };
}

function detectCodeBlock(text: string): StructureDetectionResult | null {
  // Fenced code blocks
  if (/```[\s\S]{20,}```/.test(text)) {
    return { type: 'code_block', multiplier: STRUCTURE_MULTIPLIERS.code_block, confidence: 0.9 };
  }

  // Heavy code indicators: multiple import/const/function/class statements
  const codeLines = text.split('\n').filter(line =>
    /^\s*(?:import\s|from\s|const\s|let\s|var\s|function\s|class\s|def\s|public\s|private\s|export\s|#include|package\s|using\s)/.test(line)
  );
  if (codeLines.length >= 3) {
    return { type: 'code_block', multiplier: STRUCTURE_MULTIPLIERS.code_block, confidence: 0.8 };
  }

  return null;
}

function detectTabular(text: string): StructureDetectionResult | null {
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  // Pipe-delimited tables (Markdown or CSV-like)
  const pipeLines = lines.filter(l => (l.match(/\|/g) || []).length >= 2);
  if (pipeLines.length >= 3) {
    return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.9 };
  }

  // Tab-delimited (TSV) — 3+ rows with 2+ tabs each
  const tsvLines = lines.filter(l => (l.match(/\t/g) || []).length >= 2);
  if (tsvLines.length >= 3) {
    return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.85 };
  }

  // Comma-delimited with consistent column count (3+ rows, 3+ columns)
  const commaLines = lines.filter(l => (l.match(/,/g) || []).length >= 2);
  if (commaLines.length >= 3) {
    const columnCounts = commaLines.map(l => (l.match(/,/g) || []).length);
    const consistent = columnCounts.every(c => c === columnCounts[0]);
    if (consistent) {
      return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.8 };
    }
  }

  return null;
}

function detectKeyValue(text: string): StructureDetectionResult | null {
  // "Key: Value" or "Key = Value" patterns — 3+ consecutive lines
  const kvLines = text.split('\n').filter(l =>
    /^\s*[\w\s]{2,30}\s*[:=]\s*\S/.test(l)
  );

  if (kvLines.length >= 3) {
    return { type: 'key_value', multiplier: STRUCTURE_MULTIPLIERS.key_value, confidence: 0.85 };
  }

  return null;
}

function detectEmailHeaders(text: string): StructureDetectionResult | null {
  const headerPattern = /(?:^|\n)\s*(?:From|To|Cc|Bcc|Subject|Date|Sent|Reply-To)\s*:\s*.+/gi;
  const matches = text.match(headerPattern);

  if (matches && matches.length >= 3) {
    return { type: 'email_headers', multiplier: STRUCTURE_MULTIPLIERS.email_headers, confidence: 0.9 };
  }

  return null;
}

function detectEntityList(text: string): StructureDetectionResult | null {
  // Bullet or numbered lists with 5+ items
  const listItems = text.split('\n').filter(l =>
    /^\s*(?:[-•*]|\d+[.)]\s)/.test(l)
  );

  if (listItems.length >= 5) {
    return { type: 'entity_list', multiplier: STRUCTURE_MULTIPLIERS.entity_list, confidence: 0.7 };
  }

  return null;
}

function detectDocumentBlock(text: string): StructureDetectionResult | null {
  // Multiple paragraphs (3+ blocks separated by blank lines) with headers
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 20);

  if (blocks.length < 3) return null;

  // Check for header-like lines (short, possibly uppercase or title case)
  const headerLines = text.split('\n').filter(l => {
    const trimmed = l.trim();
    return trimmed.length > 0 && trimmed.length < 60 &&
      (/^[A-Z][A-Z\s:]+$/.test(trimmed) || /^#+\s/.test(trimmed) || /^[A-Z][\w\s]+:$/.test(trimmed));
  });

  if (headerLines.length >= 2) {
    return { type: 'document_block', multiplier: STRUCTURE_MULTIPLIERS.document_block, confidence: 0.7 };
  }

  // Even without headers, 3+ substantial paragraphs = document
  if (blocks.length >= 4) {
    return { type: 'document_block', multiplier: STRUCTURE_MULTIPLIERS.document_block, confidence: 0.6 };
  }

  return null;
}
