/**
 * Regex-based PII detection as fallback when GLiNER/WebGPU is unavailable.
 * Less accurate than the ML model but works everywhere.
 */

import type { DetectedEntity } from './types';

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
}

const REGEX_PATTERNS: RegexPattern[] = [
  // Social Security Numbers
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  // Credit Card Numbers (major card formats)
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: 0.9,
  },
  // Credit Card with separators
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
  // Dates (various formats)
  {
    type: 'DATE',
    pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g,
    confidence: 0.7,
  },
  // Monetary Amounts
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g,
    confidence: 0.85,
  },
  // Monetary with words
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi,
    confidence: 0.8,
  },
  // Passport Numbers (US format)
  {
    type: 'PASSPORT_NUMBER',
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.6,
  },
  // Driver's License (common US formats)
  {
    type: 'DRIVERS_LICENSE',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.5,
  },
  // Account Numbers (generic)
  {
    type: 'ACCOUNT_NUMBER',
    pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi,
    confidence: 0.8,
  },
  // Matter Numbers (legal format: YYYY-NNNN or NN-NNNN)
  {
    type: 'MATTER_NUMBER',
    pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi,
    confidence: 0.75,
  },
];

/**
 * Run regex-based PII detection as fallback.
 * Returns detected entities with spans and confidence scores.
 */
export function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Set<string>(); // Dedupe overlapping matches

  for (const { type, pattern, confidence } of REGEX_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const key = `${match.index}-${match.index + match[0].length}-${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          type,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence,
          source: 'regex',
        });
      }
    }
  }

  // Sort by position in text
  entities.sort((a, b) => a.start - b.start);

  // Remove overlapping entities (keep higher confidence)
  return removeOverlaps(entities);
}

function removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;

  const result: DetectedEntity[] = [entities[0]];

  for (let i = 1; i < entities.length; i++) {
    const current = entities[i];
    const last = result[result.length - 1];

    // Check for overlap
    if (current.start < last.end) {
      // Keep the one with higher confidence
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }

  return result;
}
