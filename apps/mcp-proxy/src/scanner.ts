/**
 * PII Scanner for MCP tool call arguments and results.
 *
 * Uses regex patterns adapted from the Iron Gate extension's fallback-regex.ts
 * to detect sensitive data in tool call arguments and results.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface ScanResult {
  hasSensitiveData: boolean;
  entities: DetectedEntity[];
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
}

// ── Regex Patterns (adapted from extension's fallback-regex.ts) ───────────────

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  /** If true, extract only the name portion (last two capitalized words) */
  contextual?: boolean;
}

const REGEX_PATTERNS: RegexPattern[] = [
  // Person Names — titled
  {
    type: 'PERSON',
    pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g,
    confidence: 0.9,
  },
  // Person Names — after contextual keywords
  {
    type: 'PERSON',
    pattern: /\b(?:employee|patient|client|manager|contact|plaintiff|defendant|counsel|attorney|doctor|nurse|CEO|CFO|CTO)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi,
    confidence: 0.85,
    contextual: true,
  },

  // Social Security Numbers
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}\s\d{2}\s\d{4}\b/g,
    confidence: 0.9,
  },

  // Credit Card Numbers
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: 0.9,
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g,
    confidence: 0.85,
  },

  // Email Addresses
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.95,
  },

  // Phone Numbers (US formats)
  {
    type: 'PHONE_NUMBER',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
  },

  // IP Addresses (IPv4)
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.9,
  },

  // Account Numbers
  {
    type: 'ACCOUNT_NUMBER',
    pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi,
    confidence: 0.8,
  },

  // Medical Record Numbers
  {
    type: 'MEDICAL_RECORD',
    pattern: /\b(?:MRN|medical\s+record(?:\s+number)?)\s*[:#]?\s*\d{4,10}\b/gi,
    confidence: 0.85,
  },

  // Passport Numbers (US format)
  {
    type: 'PASSPORT_NUMBER',
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.6,
  },

  // Driver's License
  {
    type: 'DRIVERS_LICENSE',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.5,
  },

  // Monetary Amounts
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g,
    confidence: 0.85,
  },

  // Employee / Record IDs
  {
    type: 'EMPLOYEE_ID',
    pattern: /\b(?:EMP|HR|FMLA|RSU|REQ|WO|PO|INV)[-#]?\d{4,8}\b/g,
    confidence: 0.85,
  },

  // API Keys / Secrets (common patterns)
  {
    type: 'API_KEY',
    pattern: /\b(?:sk|pk|api|key|token|secret)[-_][a-zA-Z0-9]{20,}\b/gi,
    confidence: 0.85,
  },

  // AWS Access Keys
  {
    type: 'AWS_CREDENTIAL',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: 0.95,
  },

  // Private Keys
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    confidence: 0.99,
  },

  // Database URIs
  {
    type: 'DATABASE_URI',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/gi,
    confidence: 0.9,
  },

  // UK NINO
  {
    type: 'UK_NINO',
    pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
    confidence: 0.7,
  },

  // EU IBAN
  {
    type: 'EU_IBAN',
    pattern: /\b[A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?(?:[A-Z0-9]{4}[\s-]?){2,7}[A-Z0-9]{1,4}\b/g,
    confidence: 0.85,
  },
];

// ── Entity type weights (same as extension scorer.ts) ─────────────────────────

const ENTITY_WEIGHTS: Record<string, number> = {
  PERSON: 10,
  ORGANIZATION: 8,
  EMAIL: 12,
  PHONE_NUMBER: 15,
  SSN: 40,
  CREDIT_CARD: 30,
  ACCOUNT_NUMBER: 25,
  IP_ADDRESS: 8,
  MEDICAL_RECORD: 35,
  PASSPORT_NUMBER: 35,
  DRIVERS_LICENSE: 30,
  MONETARY_AMOUNT: 12,
  EMPLOYEE_ID: 15,
  API_KEY: 30,
  AWS_CREDENTIAL: 35,
  PRIVATE_KEY: 40,
  DATABASE_URI: 35,
  UK_NINO: 25,
  EU_IBAN: 22,
};

/** Entity types that are always high-risk (mirrors extension's types.ts) */
const HIGH_PII_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI', 'PRIVATE_KEY', 'AUTH_TOKEN',
]);

// ── Core Detection ────────────────────────────────────────────────────────────

function detectEntities(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Map<string, number>();

  for (const { type, pattern, confidence, contextual } of REGEX_PATTERNS) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let matchText = match[0];
      let matchStart = match.index;
      let matchEnd = match.index + match[0].length;

      // For contextual patterns, extract just the name part
      if (contextual) {
        const nameMatch = match[0].match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/);
        if (nameMatch) {
          const nameStart = match[0].lastIndexOf(nameMatch[0]);
          matchText = nameMatch[0];
          matchStart = match.index + nameStart;
          matchEnd = matchStart + matchText.length;
        } else {
          continue;
        }
      }

      const key = `${matchStart}-${matchEnd}-${type}`;
      if (!seen.has(key)) {
        seen.set(key, entities.length);
        entities.push({ type, text: matchText, start: matchStart, end: matchEnd, confidence });
      } else {
        const existingIdx = seen.get(key)!;
        if (entities[existingIdx].confidence < confidence) {
          entities[existingIdx] = { type, text: matchText, start: matchStart, end: matchEnd, confidence };
        }
      }
    }
  }

  // Sort by position, remove overlaps (keep higher confidence)
  entities.sort((a, b) => a.start - b.start);
  return removeOverlaps(entities);
}

function removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;

  const result: DetectedEntity[] = [entities[0]];
  for (let i = 1; i < entities.length; i++) {
    const current = entities[i];
    const last = result[result.length - 1];

    if (current.start < last.end) {
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

function computeScore(entities: DetectedEntity[]): number {
  if (entities.length === 0) return 0;

  let score = 0;
  for (const entity of entities) {
    const weight = ENTITY_WEIGHTS[entity.type] || 5;
    score += weight * entity.confidence;
  }

  // Combination bonus
  const uniqueTypes = new Set(entities.map(e => e.type));
  if (uniqueTypes.size >= 3) {
    score *= 1.3;
  } else if (uniqueTypes.size >= 2) {
    score *= 1.15;
  }

  // Volume bonus
  if (entities.length >= 10) {
    score *= 1.4;
  } else if (entities.length >= 5) {
    score *= 1.2;
  }

  // Auto-critical for high-PII types
  if (entities.some(e => HIGH_PII_TYPES.has(e.type) && e.confidence >= 0.8)) {
    score = Math.max(score, 86);
  }

  return Math.min(100, Math.round(score));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Flatten an arbitrary value into a single string for scanning.
 * Handles nested objects, arrays, and primitives.
 */
function flattenToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenToString).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(flattenToString).join(' ');
  }
  return String(value);
}

/**
 * Scan MCP tool call arguments for PII and sensitive data.
 */
export function scanToolCallArgs(args: Record<string, unknown>): ScanResult {
  const text = flattenToString(args);
  const entities = detectEntities(text);
  const score = computeScore(entities);

  return {
    hasSensitiveData: entities.length > 0,
    entities,
    score,
    level: scoreToLevel(score),
  };
}

/**
 * Scan an MCP tool result for PII and sensitive data.
 */
export function scanToolResult(result: unknown): ScanResult {
  const text = flattenToString(result);
  const entities = detectEntities(text);
  const score = computeScore(entities);

  return {
    hasSensitiveData: entities.length > 0,
    entities,
    score,
    level: scoreToLevel(score),
  };
}

/**
 * Expose detectEntities for direct use (e.g., by interceptor for pseudonymization).
 */
export { detectEntities, flattenToString, HIGH_PII_TYPES };
