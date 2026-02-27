/**
 * VS Code Scanner — uses the same detection logic as the Chrome extension.
 *
 * Since we can't directly import the browser extension's modules (different
 * runtime), this module reimplements the core scanner for Node.js.
 * The entity types, patterns, and scoring logic are identical.
 */

export interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface ScanResult {
  entities: DetectedEntity[];
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  contextual?: boolean;
}

const PATTERNS: RegexPattern[] = [
  { type: 'PERSON', pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g, confidence: 0.9 },
  { type: 'PERSON', pattern: /\b(?:employee|patient|client|manager|contact|plaintiff|defendant|counsel|attorney|doctor|CEO|CFO|CTO)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi, confidence: 0.85, contextual: true },
  { type: 'ORGANIZATION', pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Center|University|College|Bank|Insurance)\b\.?/g, confidence: 0.8 },
  { type: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },
  { type: 'CREDIT_CARD', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, confidence: 0.9 },
  { type: 'CREDIT_CARD', pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g, confidence: 0.85 },
  { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, confidence: 0.95 },
  { type: 'PHONE_NUMBER', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, confidence: 0.8 },
  { type: 'IP_ADDRESS', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, confidence: 0.9 },
  { type: 'DATE', pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g, confidence: 0.7 },
  { type: 'MONETARY_AMOUNT', pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g, confidence: 0.85 },
  { type: 'ACCOUNT_NUMBER', pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi, confidence: 0.8 },
  { type: 'MEDICAL_RECORD', pattern: /\b(?:MRN|medical\s+record(?:\s+number)?)\s*[:#]?\s*\d{4,10}\b/gi, confidence: 0.85 },
  { type: 'API_KEY', pattern: /\b(?:sk|pk|api|key|token|secret|bearer)[-_]?(?:live|test|prod)?[-_][A-Za-z0-9]{16,}\b/g, confidence: 0.9 },
  { type: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, confidence: 0.99 },
  { type: 'DATABASE_URI', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]+/g, confidence: 0.95 },
];

const ENTITY_WEIGHTS: Record<string, number> = {
  PERSON: 10, ORGANIZATION: 8, LOCATION: 3, DATE: 2,
  PHONE_NUMBER: 15, EMAIL: 12, CREDIT_CARD: 30, SSN: 40,
  MONETARY_AMOUNT: 12, ACCOUNT_NUMBER: 25, IP_ADDRESS: 8,
  MEDICAL_RECORD: 35, PASSPORT_NUMBER: 35, DRIVERS_LICENSE: 30,
  API_KEY: 30, PRIVATE_KEY: 40, DATABASE_URI: 35, AWS_CREDENTIAL: 35,
};

export class Scanner {
  scan(text: string): ScanResult {
    const entities = this.detectEntities(text);
    return this.computeScore(text, entities);
  }

  detectEntities(text: string): DetectedEntity[] {
    const entities: DetectedEntity[] = [];
    const seen = new Set<string>();

    for (const { type, pattern, confidence, contextual } of PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        let matchText = match[0];
        let matchStart = match.index;
        let matchEnd = match.index + match[0].length;

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
          seen.add(key);
          entities.push({ type, text: matchText, start: matchStart, end: matchEnd, confidence });
        }
      }
    }

    entities.sort((a, b) => a.start - b.start);
    return this.removeOverlaps(entities);
  }

  private removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
    if (entities.length <= 1) return entities;
    const result: DetectedEntity[] = [entities[0]];
    for (let i = 1; i < entities.length; i++) {
      const current = entities[i];
      const last = result[result.length - 1];
      if (current.start < last.end) {
        if (current.confidence > last.confidence) result[result.length - 1] = current;
      } else {
        result.push(current);
      }
    }
    return result;
  }

  private computeScore(text: string, entities: DetectedEntity[]): ScanResult {
    if (entities.length === 0) {
      return { entities, score: 0, level: 'low', explanation: 'No sensitive information detected.' };
    }

    let entityScore = 0;
    for (const e of entities) {
      const weight = ENTITY_WEIGHTS[e.type] || 5;
      entityScore += weight * e.confidence;
    }

    const uniqueTypes = new Set(entities.map((e) => e.type));
    if (uniqueTypes.size >= 3) entityScore *= 1.3;
    else if (uniqueTypes.size >= 2) entityScore *= 1.15;
    if (entities.length >= 10) entityScore *= 1.4;
    else if (entities.length >= 5) entityScore *= 1.2;
    entityScore = Math.min(70, entityScore);

    // Volume
    let volumeScore = 0;
    if (text.length >= 5000) volumeScore = 20;
    else if (text.length >= 2000) volumeScore = 10;
    else if (text.length >= 500) volumeScore = 5;

    const score = Math.min(100, Math.max(0, Math.round(entityScore + volumeScore)));
    const level = score <= 25 ? 'low' : score <= 60 ? 'medium' : score <= 85 ? 'high' : 'critical';

    const typeCounts = new Map<string, number>();
    for (const e of entities) typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
    const parts = Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')}${count > 1 ? 's' : ''}`);

    return { entities, score, level, explanation: `Detected ${parts.join(', ')}.` };
  }
}
