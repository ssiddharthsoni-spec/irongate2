/**
 * Data Structure Detector — Server-side contextual intelligence.
 *
 * Detects structural data patterns that indicate pasted documents,
 * tabular data, forms, or record collections.
 *
 * Structure detection is a strong signal: tabular data with PII
 * is almost always a data dump, never a casual question.
 *
 * Multipliers: tabular=2.0, key_value=1.8, email_headers=1.8,
 * document_block=1.5, entity_list=2.0, paste_signal=1.3,
 * code_block=0.3 (suppresses)
 */

export type StructureType =
  | 'tabular'
  | 'key_value'
  | 'email_headers'
  | 'document_block'
  | 'entity_list'
  | 'code_block'
  | 'none';

export interface StructureDetectionResult {
  type: StructureType;
  multiplier: number;
  confidence: number;
}

const STRUCTURE_MULTIPLIERS: Record<StructureType, number> = {
  tabular: 2.0,
  key_value: 1.8,
  email_headers: 1.8,
  document_block: 1.5,
  entity_list: 2.0,
  code_block: 0.3,
  none: 1.0,
};

export function detectStructure(text: string): StructureDetectionResult {
  if (!text || text.length < 10) {
    return { type: 'none', multiplier: 1.0, confidence: 0 };
  }

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
  if (/```[\s\S]{20,}```/.test(text)) {
    return { type: 'code_block', multiplier: STRUCTURE_MULTIPLIERS.code_block, confidence: 0.9 };
  }
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
  const pipeLines = lines.filter(l => (l.match(/\|/g) || []).length >= 2);
  if (pipeLines.length >= 3) {
    return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.9 };
  }
  const tsvLines = lines.filter(l => (l.match(/\t/g) || []).length >= 2);
  if (tsvLines.length >= 3) {
    return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.85 };
  }
  const commaLines = lines.filter(l => (l.match(/,/g) || []).length >= 2);
  if (commaLines.length >= 3) {
    const columnCounts = commaLines.map(l => (l.match(/,/g) || []).length);
    if (columnCounts.every(c => c === columnCounts[0])) {
      return { type: 'tabular', multiplier: STRUCTURE_MULTIPLIERS.tabular, confidence: 0.8 };
    }
  }
  return null;
}

function detectKeyValue(text: string): StructureDetectionResult | null {
  const kvLines = text.split('\n').filter(l => /^\s*[\w\s]{2,30}\s*[:=]\s*\S/.test(l));
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
  const listItems = text.split('\n').filter(l => /^\s*(?:[-•*]|\d+[.)]\s)/.test(l));
  if (listItems.length >= 5) {
    return { type: 'entity_list', multiplier: STRUCTURE_MULTIPLIERS.entity_list, confidence: 0.7 };
  }
  return null;
}

function detectDocumentBlock(text: string): StructureDetectionResult | null {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 20);
  if (blocks.length < 3) return null;
  const headerLines = text.split('\n').filter(l => {
    const trimmed = l.trim();
    return trimmed.length > 0 && trimmed.length < 60 &&
      (/^[A-Z][A-Z\s:]+$/.test(trimmed) || /^#+\s/.test(trimmed) || /^[A-Z][\w\s]+:$/.test(trimmed));
  });
  if (headerLines.length >= 2) {
    return { type: 'document_block', multiplier: STRUCTURE_MULTIPLIERS.document_block, confidence: 0.7 };
  }
  if (blocks.length >= 4) {
    return { type: 'document_block', multiplier: STRUCTURE_MULTIPLIERS.document_block, confidence: 0.6 };
  }
  return null;
}
