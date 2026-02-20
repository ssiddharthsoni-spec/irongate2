/**
 * Regex-based entity detection for the API server.
 * Ported from the Chrome extension's fallback-regex.ts with additional
 * legal-domain recognizers (PERSON, ORGANIZATION, PRIVILEGE_MARKER).
 */

// Entity types matching @iron-gate/types EntityType
type EntityType =
  | 'PERSON'
  | 'ORGANIZATION'
  | 'LOCATION'
  | 'DATE'
  | 'PHONE_NUMBER'
  | 'EMAIL'
  | 'CREDIT_CARD'
  | 'SSN'
  | 'MONETARY_AMOUNT'
  | 'ACCOUNT_NUMBER'
  | 'IP_ADDRESS'
  | 'MEDICAL_RECORD'
  | 'PASSPORT_NUMBER'
  | 'DRIVERS_LICENSE'
  | 'MATTER_NUMBER'
  | 'CLIENT_MATTER_PAIR'
  | 'PRIVILEGE_MARKER'
  | 'DEAL_CODENAME'
  | 'OPPOSING_COUNSEL';

type Source = 'gliner' | 'regex' | 'presidio' | 'keyword';

interface DetectedEntity {
  type: EntityType;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: Source;
}

interface RegexPattern {
  type: EntityType;
  pattern: RegExp;
  confidence: number;
}

const REGEX_PATTERNS: RegexPattern[] = [
  // Social Security Numbers
  { type: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },

  // Credit Card Numbers (major card formats)
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: 0.9,
  },
  // Credit Card with separators
  { type: 'CREDIT_CARD', pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g, confidence: 0.85 },

  // Email Addresses
  { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.95 },

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
  { type: 'MONETARY_AMOUNT', pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g, confidence: 0.85 },
  { type: 'MONETARY_AMOUNT', pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi, confidence: 0.8 },

  // Passport Numbers (US format)
  { type: 'PASSPORT_NUMBER', pattern: /\b[A-Z]\d{8}\b/g, confidence: 0.6 },

  // Driver's License (common US formats)
  { type: 'DRIVERS_LICENSE', pattern: /\b[A-Z]\d{7,8}\b/g, confidence: 0.5 },

  // Account Numbers (generic)
  { type: 'ACCOUNT_NUMBER', pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi, confidence: 0.8 },

  // Matter Numbers (legal format)
  { type: 'MATTER_NUMBER', pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi, confidence: 0.75 },
  // Standalone legal reference numbers (e.g., M-2024-001, CLT-2024-0847)
  { type: 'MATTER_NUMBER', pattern: /\b#?[A-Z]{1,4}-\d{4}-\d{3,6}\b/g, confidence: 0.7 },

  // Privilege Markers
  { type: 'PRIVILEGE_MARKER', pattern: /\b(?:attorney[- ]client privilege|work product doctrine|privileged and confidential|attorney work product|protected communication|legal professional privilege)\b/gi, confidence: 0.95 },

  // Person Names (title-case heuristic — two consecutive capitalized words)
  // Lower confidence since regex is imprecise for names
  { type: 'PERSON', pattern: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g, confidence: 0.8 },
  { type: 'PERSON', pattern: /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g, confidence: 0.55 },

  // Organizations (common suffixes)
  { type: 'ORGANIZATION', pattern: /\b[A-Z][A-Za-z&\s]*(?:LLC|LLP|Inc\.?|Corp\.?|Ltd\.?|& Associates|& Co\.?|Group|Holdings|Partners|PLC)\b/g, confidence: 0.8 },
];

// Common words that look like person names but aren't
const NAME_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which',
  'Who', 'How', 'Why', 'Dear', 'Please', 'Thank', 'Hello', 'Good', 'Best',
  'Kind', 'From', 'Dear', 'Your', 'Their', 'Some', 'Each', 'Every', 'More',
  'Most', 'Such', 'Very', 'Much', 'Well', 'Also', 'Just', 'Even', 'Only',
  'Case', 'Matter', 'Client', 'Court', 'State', 'United', 'Federal',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Dear Sir', 'New York', 'Los Angeles', 'San Francisco',
]);

/**
 * Detect entities using regex patterns.
 */
export function detect(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, confidence } of REGEX_PATTERNS) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const matchText = match[0];

      // Filter out false-positive person names
      if (type === 'PERSON') {
        const firstName = matchText.split(/\s+/)[0];
        if (NAME_STOPWORDS.has(firstName)) continue;
        // Skip if the match is at the very start of a sentence (likely not a name)
        if (match.index === 0 && text[matchText.length] === ' ') {
          const secondWord = matchText.split(/\s+/)[1];
          if (NAME_STOPWORDS.has(secondWord)) continue;
        }
      }

      const key = `${match.index}-${match.index + matchText.length}-${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        const entity: DetectedEntity = {
          type,
          text: matchText,
          start: match.index,
          end: match.index + matchText.length,
          confidence,
          source: 'regex',
        };
        entities.push(entity);
      }
    }
  }

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
      // Overlapping — keep higher confidence
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }

  return result;
}
