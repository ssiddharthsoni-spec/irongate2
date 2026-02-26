/**
 * Iron Gate — Interceptor Logic Test Suite
 *
 * Tests the core interception functions (extractPrompt, replacePrompt,
 * detectWithRegex, pseudonymizeLocal, quickScore) against simulated
 * request body formats from all supported AI tools.
 *
 * Run: npx tsx apps/extension/tests/interceptor-test.ts
 */

// ─── Inline the functions from main-world.ts ──────────────────────────────
// (These are copied verbatim so we test the exact same logic)

interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex';
}

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  contextual?: boolean;
}

const REGEX_PATTERNS: RegexPattern[] = [
  { type: 'PERSON', pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g, confidence: 0.9 },
  { type: 'PERSON', pattern: /\b(?:employee|patient|client|manager|contact|attending|plaintiff|defendant|counsel|attorney|doctor|nurse|therapist|spouse|wife|husband|CEO|CFO|CTO|COO|CMO|VP|director|analyst|engineer)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi, confidence: 0.85, contextual: true },
  { type: 'PERSON', pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=\(|\[|<|,\s*(?:who|our|the|is|at|from))/g, confidence: 0.8 },
  { type: 'PERSON', pattern: /\b(?:for|from|to|by|with|about|cc|re|dear|hi|hey|hello|regarding)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi, confidence: 0.75, contextual: true },
  { type: 'ORGANIZATION', pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Center|University|College|Bank|Insurance)\b\.?/g, confidence: 0.8 },
  { type: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },
  { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, confidence: 0.95 },
  { type: 'PHONE_NUMBER', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, confidence: 0.8 },
  { type: 'MONETARY_AMOUNT', pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:million|billion|M|B|k|K)?\b/g, confidence: 0.85 },
  { type: 'DATE', pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g, confidence: 0.7 },
  { type: 'MONETARY_AMOUNT', pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi, confidence: 0.8 },
  // Business context detection
  { type: 'TICKER', pattern: /\b(?:NYSE|NASDAQ|AMEX|LSE|TSX|NIKKEI|FTSE|DAX|CAC)\s*:\s*[A-Z]{1,5}\b/g, confidence: 0.95 },
  { type: 'TICKER', pattern: /\$[A-Z]{2,5}\b/g, confidence: 0.8 },
  { type: 'PERCENTAGE', pattern: /\b\d{1,3}(?:\.\d{1,2})?%/g, confidence: 0.8 },
  { type: 'DATE', pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, confidence: 0.75 },
  { type: 'FISCAL_PERIOD', pattern: /\b(?:[QH][1-4]|FY)\s*(?:'?\d{2,4})?\b/g, confidence: 0.75 },
  { type: 'PROJECT_NAME', pattern: /\b(?:Project|Operation|Initiative|Program|Codename)\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g, confidence: 0.9 },
  { type: 'ORGANIZATION', pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Management|Capital|Partners|Holdings|Securities|Advisors|Consulting|Analytics|Investments|Solutions|Technologies|Financial|Ventures|Research|Services|Labs|Systems|Industries|Dynamics|Media|Health|Pharma|Energy|Realty|Properties)\b/g, confidence: 0.8 },
  { type: 'ORGANIZATION', pattern: /\b[A-Z][a-z]{1,10}[A-Z][a-zA-Z]{1,10}\b/g, confidence: 0.7 },
  { type: 'ORGANIZATION', pattern: /\b(?:at|firm|company|investor|partner|vendor|supplier|competitor|acquirer|subsidiary|conglomerate|startup|unicorn|acquired|acquiring|target)\s*[,:]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g, confidence: 0.7, contextual: true },
  { type: 'ORGANIZATION', pattern: /\b(?:discussions?\s+with|partnership\s+with|deal\s+with|investment\s+(?:in|from|by)|acquired\s+by|merger\s+with|contract\s+with|agreement\s+with|lawsuit\s+(?:against|from)|counsel\s+at)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g, confidence: 0.75, contextual: true },
  { type: 'HEADCOUNT', pattern: /\b\d{2,5}\s*(?:headcount|employees?|people|workers|staff|positions|roles|FTEs?|hires?|cuts?|layoffs?|terminations?)\b/gi, confidence: 0.8 },
  { type: 'LEGAL_REFERENCE', pattern: /\b(?:Section|Rule|Regulation|Article|Clause)\s+\d+[A-Za-z]?(?:[-]\d+)?\b/g, confidence: 0.75 },
  { type: 'MONETARY_AMOUNT', pattern: /\b\d{1,4}(?:\.\d{1,2})?\s*[BMK]\s*(?:valuation|market\s*cap|revenue|ARR|MRR|EBITDA|profit|loss|deal|round)\b/gi, confidence: 0.8 },
];

function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Set<string>();
  for (const { type, pattern, confidence, contextual } of REGEX_PATTERNS) {
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
          continue; // No proper noun found — false positive
        }
      }
      const key = `${matchStart}-${matchEnd}-${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ type, text: matchText, start: matchStart, end: matchEnd, confidence, source: 'regex' });
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
      if (current.confidence > last.confidence) result[result.length - 1] = current;
    } else {
      result.push(current);
    }
  }
  return result;
}

// Pseudonymizer with realistic fake data generation
interface PseudonymMapping { original: string; pseudonym: string; type: string; }
interface PseudonymResult { maskedText: string; mappings: PseudonymMapping[]; }

const FAKE_NAMES_F = [
  'Emily Rogers', 'Anna Peterson', 'Lisa Chang', 'Maria Santos', 'Rachel Kim',
  'Diana Walsh', 'Nicole Foster', 'Amanda Brooks', 'Jennifer Liu', 'Stephanie Barnes',
  'Katherine Hayes', 'Laura Bennett', 'Olivia Porter', 'Samantha Reed', 'Victoria Lane',
];
const FAKE_NAMES_M = [
  'James Mitchell', 'David Kumar', 'Robert Chen', 'William Taylor', 'Thomas Garcia',
  'Andrew Watson', 'Daniel Price', 'Christopher Lee', 'Michael Brown', 'Steven Park',
  'Jonathan Reed', 'Matthew Cole', 'Benjamin Hart', 'Patrick Quinn', 'Marcus Webb',
];
const FEMALE_FIRST = new Set([
  'sarah','jennifer','lisa','maria','anna','rachel','diana','nicole','amanda','jessica',
  'emily','laura','stephanie','katherine','olivia','samantha','victoria','helen','jane','margaret',
  'susan','karen','nancy','betty','sandra','ashley','dorothy','kimberly','elizabeth','donna',
]);
const FAKE_ORGS = [
  'Northwind Technologies', 'Contoso Holdings', 'Adatum Corp', 'Fabrikam Industries',
  'Proseware Solutions', 'Woodgrove Financial', 'Tailspin Partners', 'Lucerne Media',
  'Alpine Securities', 'Meridian Dynamics', 'Coastal Ventures', 'Summit Analytics',
  'Vertex Research', 'Pinnacle Systems', 'Horizon Labs',
];
const FAKE_TICKERS = [
  'NWND', 'CTSO', 'ADTM', 'FBRK', 'PRWL', 'WDGV', 'TLSP', 'LCNE', 'ALPS', 'MRDX',
  'CSVT', 'SMTA', 'VTXR', 'PNCL', 'HRZL',
];
const FAKE_PROJECTS = [
  'Project Aurora', 'Project Meridian', 'Project Catalyst', 'Project Zenith',
  'Project Atlas', 'Project Nexus', 'Project Titan', 'Project Vanguard',
  'Project Ember', 'Project Falcon',
];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const _usedFakes: Record<string, number> = {};

function _pickUnused(pool: string[], type: string): string {
  if (!_usedFakes[type]) _usedFakes[type] = 0;
  const idx = _usedFakes[type] % pool.length;
  _usedFakes[type]++;
  return pool[idx];
}

function _isFemaleFirst(name: string): boolean {
  const first = name.split(/\s+/)[0].toLowerCase();
  return FEMALE_FIRST.has(first);
}

function _randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateFake(type: string, original: string): string {
  switch (type) {
    case 'PERSON': {
      const pool = _isFemaleFirst(original) ? FAKE_NAMES_F : FAKE_NAMES_M;
      return _pickUnused(pool, type + (_isFemaleFirst(original) ? '_F' : '_M'));
    }
    case 'ORGANIZATION':
      return _pickUnused(FAKE_ORGS, type);
    case 'TICKER': {
      const m = original.match(/^([A-Z]+\s*:\s*)/);
      if (m) return m[1] + _pickUnused(FAKE_TICKERS, type);
      return _pickUnused(FAKE_TICKERS, type);
    }
    case 'PROJECT_NAME':
      return _pickUnused(FAKE_PROJECTS, type);
    case 'MONETARY_AMOUNT': {
      const cleaned = original.replace(/[,$\s]/g, '');
      const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(million|billion|M|B|k|K|dollars?|USD|EUR|GBP)?/i);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const suffix = numMatch[2] || '';
        const shifted = num * _randBetween(0.7, 1.35);
        const hasDecimal = numMatch[1].includes('.');
        const decPlaces = hasDecimal ? (numMatch[1].split('.')[1]?.length || 1) : 1;
        const formatted = hasDecimal ? shifted.toFixed(decPlaces) : Math.round(shifted).toString();
        const prefix = original.startsWith('$') ? '$' : '';
        return prefix + formatted + suffix;
      }
      return original;
    }
    case 'PERCENTAGE': {
      const numMatch = original.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const offset = _randBetween(3, 8) * (Math.random() > 0.5 ? 1 : -1);
        const shifted = Math.max(0.1, Math.min(99.9, num + offset));
        const hasDecimal = numMatch[1].includes('.');
        return (hasDecimal ? shifted.toFixed(1) : Math.round(shifted).toString()) + '%';
      }
      return original;
    }
    case 'DATE': {
      const dateMatch = original.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(.*)$/i);
      if (dateMatch) {
        const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === dateMatch[1].toLowerCase());
        if (monthIdx >= 0) {
          const newMonthIdx = (monthIdx + Math.floor(_randBetween(1, 4))) % 12;
          const newDay = Math.max(1, Math.min(28, parseInt(dateMatch[2]) + Math.floor(_randBetween(-10, 10))));
          const suffix = newDay === 1 || newDay === 21 || newDay === 31 ? 'st' : newDay === 2 || newDay === 22 ? 'nd' : newDay === 3 || newDay === 23 ? 'rd' : 'th';
          return MONTHS[newMonthIdx] + ' ' + newDay + suffix + (dateMatch[3] || '');
        }
      }
      const numDate = original.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
      if (numDate) {
        const m = Math.max(1, Math.min(12, parseInt(numDate[1]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(numDate[3]) + Math.floor(_randBetween(-5, 5))));
        return m + numDate[2] + d + numDate[2] + numDate[4];
      }
      return original;
    }
    case 'FISCAL_PERIOD': {
      const qMatch = original.match(/^([QH])(\d)/);
      if (qMatch) {
        const shifted = ((parseInt(qMatch[2]) + Math.floor(_randBetween(1, 3)) - 1) % 4) + 1;
        return qMatch[1] + shifted + original.substring(2);
      }
      return original;
    }
    case 'EMAIL': {
      const fakeName = _pickUnused(FAKE_NAMES_F.concat(FAKE_NAMES_M), 'EMAIL_NAME');
      const parts = fakeName.toLowerCase().split(' ');
      const domains = ['northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io'];
      const domain = domains[Math.floor(Math.random() * domains.length)];
      return parts[0] + '.' + parts[1] + '@' + domain;
    }
    case 'SSN': {
      const a = Math.floor(_randBetween(100, 899));
      const b = Math.floor(_randBetween(10, 99));
      const c = Math.floor(_randBetween(1000, 9999));
      return a + '-' + b + '-' + c;
    }
    case 'PHONE_NUMBER': {
      const a = Math.floor(_randBetween(200, 899));
      const b = Math.floor(_randBetween(200, 899));
      const c = Math.floor(_randBetween(1000, 9999));
      if (original.includes('(')) return '(' + a + ') ' + b + '-' + c;
      if (original.includes('-')) return a + '-' + b + '-' + c;
      return a + ' ' + b + ' ' + c;
    }
    case 'CREDIT_CARD': {
      const groups = [
        Math.floor(_randBetween(4000, 4999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
      ];
      if (original.includes('-')) return groups.join('-');
      if (original.includes(' ')) return groups.join(' ');
      return groups.join('');
    }
    case 'HEADCOUNT': {
      const hcMatch = original.match(/^(\d+)\s*(.*)/);
      if (hcMatch) {
        const num = parseInt(hcMatch[1]);
        const shifted = Math.round(num * _randBetween(0.7, 1.35));
        return shifted + (hcMatch[2] ? ' ' + hcMatch[2] : '');
      }
      return original;
    }
    case 'LEGAL_REFERENCE': {
      const lrMatch = original.match(/^(\w+)\s+(\d+)(.*)/);
      if (lrMatch) {
        const shifted = parseInt(lrMatch[2]) + Math.floor(_randBetween(2, 8));
        return lrMatch[1] + ' ' + shifted + (lrMatch[3] || '');
      }
      return original;
    }
    case 'IP_ADDRESS': {
      const octets = Array.from({ length: 4 }, () => Math.floor(_randBetween(1, 254)));
      return octets.join('.');
    }
    case 'EMPLOYEE_ID':
    case 'RECORD_ID': {
      const idMatch = original.match(/^([A-Z#-]+)(\d+)$/);
      if (idMatch) {
        const len = idMatch[2].length;
        const newNum = Math.floor(_randBetween(10 ** (len - 1), 10 ** len - 1));
        return idMatch[1] + newNum;
      }
      return original;
    }
    default:
      return `[${type}]`;
  }
}

// Global forward map for conversation persistence
let currentForwardMap: Record<string, string> = {};

function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) return { maskedText: text, mappings: [] };
  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;
  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    let pseudonym = seen.get(normalizedText);
    if (!pseudonym) {
      pseudonym = currentForwardMap[normalizedText];
    }
    if (!pseudonym) {
      pseudonym = generateFake(entity.type, normalizedText);
      seen.set(normalizedText, pseudonym);
      currentForwardMap[normalizedText] = pseudonym;
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
    } else if (!mappings.some(m => m.original === normalizedText)) {
      if (!seen.has(normalizedText)) seen.set(normalizedText, pseudonym);
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
    }
    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }
  mappings.reverse();
  return { maskedText, mappings };
}

// Scoring
function quickScore(entities: Array<{ type: string; confidence: number }>): { level: 'low' | 'medium' | 'high' | 'critical'; score: number } {
  if (entities.length === 0) return { level: 'low', score: 0 };
  const HIGH_RISK_TYPES = new Set(['SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'PRIVATE_KEY', 'DATABASE_URI', 'AUTH_TOKEN', 'MEDICAL_RECORD', 'TICKER']);
  const MED_RISK_TYPES = new Set(['PERSON', 'PHONE_NUMBER', 'EMAIL', 'MONETARY_AMOUNT', 'ACCOUNT_NUMBER', 'EMPLOYEE_ID', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE', 'ORGANIZATION', 'PROJECT_NAME', 'PERCENTAGE', 'HEADCOUNT', 'LEGAL_REFERENCE', 'FISCAL_PERIOD']);
  let score = 0;
  for (const e of entities) {
    if (HIGH_RISK_TYPES.has(e.type)) score += 25;
    else if (MED_RISK_TYPES.has(e.type)) score += 10;
    else score += 5;
  }
  const uniqueTypes = new Set(entities.map(e => e.type)).size;
  if (uniqueTypes >= 3) score += 15;
  score = Math.min(score, 100);
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 86) level = 'critical';
  else if (score >= 61) level = 'high';
  else if (score >= 26) level = 'medium';
  else level = 'low';
  return { level, score };
}

// JSON escape
function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

// extractPrompt
function findLongestStringValue(obj: any, maxDepth = 5): string | null {
  if (maxDepth <= 0) return null;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) {
    let best: string | null = null;
    for (const item of obj) {
      const found = findLongestStringValue(item, maxDepth - 1);
      if (found && (!best || found.length > best.length)) best = found;
    }
    return best;
  }
  if (obj && typeof obj === 'object') {
    let best: string | null = null;
    for (const val of Object.values(obj)) {
      const found = findLongestStringValue(val, maxDepth - 1);
      if (found && (!best || found.length > best.length)) best = found;
    }
    return best;
  }
  return null;
}

function findDeepestString(arr: any[]): string | null {
  let best: string | null = null;
  for (const item of arr) {
    if (typeof item === 'string' && (!best || item.length > best.length)) best = item;
    else if (Array.isArray(item)) {
      const found = findDeepestString(item);
      if (found && (!best || found.length > best.length)) best = found;
    }
  }
  return best;
}

function extractPrompt(body: any): string | null {
  if (typeof body === 'string' && (body.includes('f.req=') || body.includes('f.req%3D'))) {
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq) {
        const outer = JSON.parse(fReq);
        const deep = findDeepestString(Array.isArray(outer) ? outer : [outer]);
        if (deep) {
          try {
            const inner = JSON.parse(deep);
            const innerDeep = findDeepestString(Array.isArray(inner) ? inner : [inner]);
            if (innerDeep && innerDeep.length > 10) return innerDeep;
          } catch {}
          if (deep.length > 10) return deep;
        }
      }
    } catch {}
  }
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsed?.messages?.[0]?.content?.parts) {
      const last = parsed.messages[parsed.messages.length - 1];
      return last.content.parts.join('\n');
    }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUser = [...parsed.messages].reverse().find((m: any) => m.role === 'user' || m.author === 'user');
      if (lastUser) {
        if (typeof lastUser.content === 'string') return lastUser.content;
        if (Array.isArray(lastUser.content)) return lastUser.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      }
    }
    if (parsed?.message) {
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.message?.text === 'string') return parsed.message.text;
      if (typeof parsed.message?.content === 'string') return parsed.message.content;
    }
    if (typeof parsed?.content === 'string' && parsed.content.length > 5) return parsed.content;
    if (typeof parsed?.q === 'string') return parsed.q;
    if (typeof parsed?.question === 'string') return parsed.question;
    if (typeof parsed?.prompt === 'string') return parsed.prompt;
    if (typeof parsed?.query === 'string') return parsed.query;
    if (typeof parsed?.input === 'string') return parsed.input;
    if (typeof parsed?.text === 'string' && parsed.text.length > 5) return parsed.text;
    if (typeof parsed?.query_str === 'string') return parsed.query_str;
    if (Array.isArray(parsed) && parsed.length >= 2) {
      const deep = findDeepestString(parsed);
      if (deep && deep.length > 10) return deep;
    }
    const longest = findLongestStringValue(parsed);
    if (longest && longest.length >= 20) return longest;
    return null;
  } catch { return null; }
}

// replacePrompt
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) { if (predicate(arr[i])) return i; }
  return -1;
}

function replacePrompt(body: string, originalPrompt: string, replacement: string): string | null {
  if (body.includes('f.req=') || body.includes('f.req%3D')) {
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq && originalPrompt.length >= 10) {
        const escapedOrig = jsonStringEscape(originalPrompt);
        const escapedRepl = jsonStringEscape(replacement);
        if (fReq.includes(escapedOrig)) {
          const modifiedFReq = fReq.replace(escapedOrig, escapedRepl);
          params.set('f.req', modifiedFReq);
          return params.toString();
        }
        const doubleEscapedOrig = jsonStringEscape(escapedOrig);
        const doubleEscapedRepl = jsonStringEscape(escapedRepl);
        if (fReq.includes(doubleEscapedOrig)) {
          const modifiedFReq = fReq.replace(doubleEscapedOrig, doubleEscapedRepl);
          params.set('f.req', modifiedFReq);
          return params.toString();
        }
        if (fReq.includes(originalPrompt)) {
          const modifiedFReq = fReq.replace(originalPrompt, replacement);
          params.set('f.req', modifiedFReq);
          return params.toString();
        }
      }
    } catch {}
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed?.messages?.[0]?.content?.parts) {
      const lastIdx = parsed.messages.length - 1;
      parsed.messages[lastIdx].content.parts = [replacement];
      return JSON.stringify(parsed);
    }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUserIdx = findLastIndex(parsed.messages, (m: any) => m.role === 'user' || m.author === 'user' || m.author?.role === 'user');
      if (lastUserIdx >= 0) {
        const msg = parsed.messages[lastUserIdx];
        if (typeof msg.content === 'string') msg.content = replacement;
        else if (typeof msg.text === 'string') msg.text = replacement;
        else if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((c: any) => c.type === 'text');
          if (textParts.length > 0) textParts[0].text = replacement;
        }
      }
      return JSON.stringify(parsed);
    }
    if (parsed?.message) {
      if (typeof parsed.message === 'string') { parsed.message = replacement; return JSON.stringify(parsed); }
      if (typeof parsed.message?.text === 'string') { parsed.message.text = replacement; return JSON.stringify(parsed); }
      if (typeof parsed.message?.content === 'string') { parsed.message.content = replacement; return JSON.stringify(parsed); }
    }
    if (typeof parsed?.content === 'string' && parsed.content.length > 5) { parsed.content = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.q === 'string') { parsed.q = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.question === 'string') { parsed.question = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.prompt === 'string') { parsed.prompt = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.query === 'string') { parsed.query = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.input === 'string') { parsed.input = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.text === 'string' && parsed.text.length > 5) { parsed.text = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.query_str === 'string') { parsed.query_str = replacement; return JSON.stringify(parsed); }
    if (originalPrompt && originalPrompt.length >= 20) {
      const escapedOriginal = jsonStringEscape(originalPrompt);
      const escapedReplacement = jsonStringEscape(replacement);
      if (body.includes(escapedOriginal)) return body.replace(escapedOriginal, escapedReplacement);
    }
    return null;
  } catch { return null; }
}

// ─── TEST HARNESS ──────────────────────────────────────────────────────────

const SENSITIVE_PROMPT = `Create a financial model for Project Nighthawk — the proposed $2.8B acquisition of TechNova Inc (NASDAQ: TNVA) by our client Meridian Capital Partners. The target's Q4 EBITDA was $187M with 34% margins. We're modeling a 6.2x EV/EBITDA entry multiple. Key terms from the draft LOI signed 02/12/2026: $42/share cash offer (23% premium to undisturbed price), $450M bridge financing from Goldman Sachs (commitment letter ref: GS-2026-CL-8847), and a $140M breakup fee. The deal team includes managing director Helen Park (helen.park@jpmorgan.com) and our MNPI list has 47 restricted persons. Do not share outside the Chinese Wall. The HSR filing deadline is March 28th.`;

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}${details ? ` — ${details}` : ''}`);
  }
}

// ─── Test: Entity Detection ──────────────────────────────────────────────

console.log('\n═══ Entity Detection ═══');
const entities = detectWithRegex(SENSITIVE_PROMPT);
assert(entities.length >= 5, `Detected ${entities.length} entities (expect >= 5)`);

const entityTypes = new Set(entities.map(e => e.type));
assert(entityTypes.has('PERSON'), 'Detected PERSON entities');
assert(entityTypes.has('MONETARY_AMOUNT'), 'Detected MONETARY_AMOUNT entities');
assert(entityTypes.has('EMAIL'), 'Detected EMAIL entities');
assert(entityTypes.has('DATE'), 'Detected DATE entities');

const personEntities = entities.filter(e => e.type === 'PERSON');
assert(personEntities.some(e => e.text.includes('Helen Park')), 'Found "Helen Park" as PERSON');

// ─── Test: MNPI / Business Context Detection ────────────────────────────

console.log('\n═══ MNPI / Business Context Detection ═══');
const MNPI_PROMPT = `Prepare talking points for the emergency board meeting on March 5th. We need to present the pivot strategy for NovaTech (NYSE: NVTK, current market cap $3.1B). Our SaaS revenue declined 18% QoQ to $47M in Q4, and enterprise churn hit 14.2% — the highest since IPO. The board will ask about Project Horizon, our pivot to vertical AI agents. The internal P&L model shows we need to cut 340 headcount (22% of workforce) to fund the pivot, saving $62M annually. The restructuring charge will be $28M in Q1. CEO Sarah Chen and CFO Michael Torres have been in confidential discussions with Salesforce about a potential strategic investment of $200M for a 12% stake (implying $1.67B valuation — a 46% discount to current market cap). The activist investor, Elliot Management, acquired a 7.2% position last month and is pushing for a full sale. Our poison pill triggers at 15%. The draft proxy statement references golden parachute provisions totaling $34M for the C-suite. Legal counsel at Davis Polk (Jennifer Walsh, jennifer.walsh@davispolk.com) is advising on the Section 13D response. Confidential — do not distribute beyond the board.`;

const mnpiEntities = detectWithRegex(MNPI_PROMPT);
const mnpiTypes = new Set(mnpiEntities.map(e => e.type));

// Verify all critical entity types are detected
assert(mnpiTypes.has('PERSON'), 'MNPI: Detected PERSON entities');
assert(mnpiTypes.has('MONETARY_AMOUNT'), 'MNPI: Detected MONETARY_AMOUNT entities');
assert(mnpiTypes.has('EMAIL'), 'MNPI: Detected EMAIL entities');
assert(mnpiTypes.has('TICKER'), 'MNPI: Detected TICKER (NYSE: NVTK)');
assert(mnpiTypes.has('PERCENTAGE'), 'MNPI: Detected PERCENTAGE entities');
assert(mnpiTypes.has('PROJECT_NAME'), 'MNPI: Detected PROJECT_NAME (Project Horizon)');
assert(mnpiTypes.has('ORGANIZATION'), 'MNPI: Detected ORGANIZATION entities');
assert(mnpiTypes.has('HEADCOUNT'), 'MNPI: Detected HEADCOUNT (340 headcount)');
assert(mnpiTypes.has('LEGAL_REFERENCE'), 'MNPI: Detected LEGAL_REFERENCE (Section 13D)');
assert(mnpiTypes.has('FISCAL_PERIOD'), 'MNPI: Detected FISCAL_PERIOD (Q4, Q1)');

// Verify specific entities
const mnpiOrgs = mnpiEntities.filter(e => e.type === 'ORGANIZATION');
const mnpiOrgTexts = mnpiOrgs.map(e => e.text);
assert(mnpiOrgTexts.some(t => t.includes('NovaTech')), `MNPI: Detected "NovaTech" as ORGANIZATION (found: ${mnpiOrgTexts.join(', ')})`);
assert(mnpiOrgTexts.some(t => t.includes('Elliot Management')), `MNPI: Detected "Elliot Management" as ORGANIZATION (found: ${mnpiOrgTexts.join(', ')})`);

const mnpiPercentages = mnpiEntities.filter(e => e.type === 'PERCENTAGE');
assert(mnpiPercentages.length >= 6, `MNPI: Detected ${mnpiPercentages.length} percentages (expect >= 6: 18%, 14.2%, 22%, 12%, 46%, 7.2%, 15%)`);

const mnpiProjects = mnpiEntities.filter(e => e.type === 'PROJECT_NAME');
assert(mnpiProjects.some(e => e.text.includes('Horizon')), 'MNPI: Detected "Project Horizon"');

const mnpiTickers = mnpiEntities.filter(e => e.type === 'TICKER');
assert(mnpiTickers.some(e => e.text.includes('NVTK')), 'MNPI: Detected ticker "NVTK"');

const mnpiHeadcount = mnpiEntities.filter(e => e.type === 'HEADCOUNT');
assert(mnpiHeadcount.some(e => e.text.includes('340')), 'MNPI: Detected "340 headcount"');

const mnpiLegal = mnpiEntities.filter(e => e.type === 'LEGAL_REFERENCE');
assert(mnpiLegal.some(e => e.text.includes('13D')), 'MNPI: Detected "Section 13D"');

// Pseudonymize and verify the result strips ALL sensitive context
const mnpiPseudo = pseudonymizeLocal(MNPI_PROMPT, mnpiEntities);
console.log(`\n  Pseudonymized MNPI prompt (${mnpiEntities.length} entities replaced):`);
console.log(`  "${mnpiPseudo.maskedText.substring(0, 200)}..."`);

assert(!mnpiPseudo.maskedText.includes('NovaTech'), 'MNPI pseudonymized: no "NovaTech"');
assert(!mnpiPseudo.maskedText.includes('NVTK'), 'MNPI pseudonymized: no "NVTK"');
// Note: We skip checking "18%" specifically because a random fake for another
// percentage (e.g., 22% offset -4) could coincidentally produce "18%".
// The entity detection test above already verifies 18% is detected as PERCENTAGE.
assert(!mnpiPseudo.maskedText.includes('14.2%'), 'MNPI pseudonymized: no "14.2%"');
assert(!mnpiPseudo.maskedText.includes('Project Horizon'), 'MNPI pseudonymized: no "Project Horizon"');
assert(!mnpiPseudo.maskedText.includes('Sarah Chen'), 'MNPI pseudonymized: no "Sarah Chen"');
assert(!mnpiPseudo.maskedText.includes('Elliot Management'), 'MNPI pseudonymized: no "Elliot Management"');
assert(!mnpiPseudo.maskedText.includes('340 headcount'), 'MNPI pseudonymized: no "340 headcount"');
assert(!mnpiPseudo.maskedText.includes('Section 13D'), 'MNPI pseudonymized: no "Section 13D"');
assert(!mnpiPseudo.maskedText.includes('jennifer.walsh'), 'MNPI pseudonymized: no email');

console.log(`\n  Total entities detected in MNPI prompt: ${mnpiEntities.length}`);
console.log(`  Entity types: ${[...mnpiTypes].join(', ')}`);

// ─── Test: Scoring ──────────────────────────────────────────────────────

console.log('\n═══ Sensitivity Scoring ═══');
const scoreResult = quickScore(entities);
assert(scoreResult.score > 50, `Score = ${scoreResult.score} (expect > 50)`);
assert(scoreResult.level === 'high' || scoreResult.level === 'critical', `Level = ${scoreResult.level} (expect high or critical)`);

// ─── Test: Pseudonymization ─────────────────────────────────────────────

console.log('\n═══ Pseudonymization ═══');
const pseudoResult = pseudonymizeLocal(SENSITIVE_PROMPT, entities);
assert(pseudoResult.mappings.length > 0, `Generated ${pseudoResult.mappings.length} pseudonym mappings`);
assert(!pseudoResult.maskedText.includes('Helen Park'), 'Masked text does NOT contain "Helen Park"');
assert(!pseudoResult.maskedText.includes('helen.park@jpmorgan.com'), 'Masked text does NOT contain email');
// With realistic fakes, the pseudonyms should be real-looking names, not [TYPE-N] tokens
assert(!pseudoResult.maskedText.includes('[PERSON-'), 'Masked text does NOT use old token format [PERSON-*]');
assert(!pseudoResult.maskedText.includes('[EMAIL-'), 'Masked text does NOT use old token format [EMAIL-*]');
// Verify realistic fakes are present in the masked text
const personMapping = pseudoResult.mappings.find(m => m.type === 'PERSON');
assert(personMapping !== undefined, 'Has a PERSON mapping');
if (personMapping) {
  const allFakeNames = [...FAKE_NAMES_F, ...FAKE_NAMES_M];
  assert(allFakeNames.includes(personMapping.pseudonym), `PERSON fake "${personMapping.pseudonym}" is from fake name pool`);
  assert(pseudoResult.maskedText.includes(personMapping.pseudonym), 'Masked text contains the fake name');
}
const emailMapping = pseudoResult.mappings.find(m => m.type === 'EMAIL');
assert(emailMapping !== undefined, 'Has an EMAIL mapping');
if (emailMapping) {
  assert(emailMapping.pseudonym.includes('@'), `EMAIL fake "${emailMapping.pseudonym}" looks like an email`);
}

// ─── Test: De-pseudonymization via reverse map ─────────────────────────

console.log('\n═══ De-pseudonymization ═══');
const reverseMap: Record<string, string> = {};
for (const m of pseudoResult.mappings) {
  reverseMap[m.pseudonym] = m.original;
}
let depseudonymized = pseudoResult.maskedText;
for (const [pseudonym, original] of Object.entries(reverseMap)) {
  depseudonymized = depseudonymized.split(pseudonym).join(original);
}
assert(depseudonymized.includes('Helen Park'), 'De-pseudonymized text contains "Helen Park"');
assert(depseudonymized.includes('helen.park@jpmorgan.com'), 'De-pseudonymized text contains email');

// ─── Test: ChatGPT Body Format ──────────────────────────────────────────

console.log('\n═══ ChatGPT Backend Format ═══');
const chatgptBody = JSON.stringify({
  action: 'next',
  messages: [{
    id: 'aaa2e5b5-0c40-4c9f-8dd1-1234567890ab',
    author: { role: 'user' },
    content: { content_type: 'text', parts: [SENSITIVE_PROMPT] },
    metadata: {}
  }],
  parent_message_id: 'bbb2e5b5-0c40-4c9f-8dd1-1234567890ab',
  model: 'gpt-4',
  timezone_offset_min: -480,
  conversation_mode: { kind: 'primary_assistant' }
});

const chatgptExtracted = extractPrompt(chatgptBody);
assert(chatgptExtracted !== null, 'extractPrompt returns non-null for ChatGPT');
assert(chatgptExtracted!.includes('Helen Park'), 'ChatGPT: extracted prompt contains "Helen Park"');

// Test direct string replacement (new approach)
const chatgptEntities = detectWithRegex(chatgptExtracted!);
const chatgptPseudo = pseudonymizeLocal(chatgptExtracted!, chatgptEntities);
const escapedOrig = jsonStringEscape(chatgptExtracted!);
const escapedRepl = jsonStringEscape(chatgptPseudo.maskedText);
const chatgptDirect = chatgptBody.includes(escapedOrig) ? chatgptBody.replace(escapedOrig, escapedRepl) : null;
assert(chatgptDirect !== null, 'ChatGPT: direct string replacement works');
if (chatgptDirect) {
  const reparsed = JSON.parse(chatgptDirect);
  assert(reparsed.action === 'next', 'ChatGPT: direct replacement preserves "action" field');
  assert(reparsed.model === 'gpt-4', 'ChatGPT: direct replacement preserves "model" field');
  assert(!reparsed.messages[0].content.parts[0].includes('Helen Park'), 'ChatGPT: direct replacement removes "Helen Park"');
}

// Also test replacePrompt (fallback)
const chatgptReplaced = replacePrompt(chatgptBody, chatgptExtracted!, chatgptPseudo.maskedText);
assert(chatgptReplaced !== null, 'ChatGPT: replacePrompt returns non-null');

// ─── Test: Copilot Body Format (message string) ─────────────────────────

console.log('\n═══ Microsoft Copilot Format (message string) ═══');
const copilotBody1 = JSON.stringify({
  message: SENSITIVE_PROMPT,
  conversationId: '51D|BingProd|abc123',
  participant: { id: '1234567890' },
  source: 'cib',
  traceId: 'trace-123-abc',
  optionsSets: ['nlu_direct_response_filter', 'deepleo', 'enable_debug_commands'],
  isStartOfSession: true,
  tone: 'balanced',
});

const copilot1Extracted = extractPrompt(copilotBody1);
assert(copilot1Extracted !== null, 'Copilot (message): extractPrompt returns non-null');
assert(copilot1Extracted!.includes('Helen Park'), 'Copilot (message): extracted prompt contains "Helen Park"');

// Test direct string replacement
const copilot1Entities = detectWithRegex(copilot1Extracted!);
const copilot1Pseudo = pseudonymizeLocal(copilot1Extracted!, copilot1Entities);
const copilot1EscOrig = jsonStringEscape(copilot1Extracted!);
const copilot1EscRepl = jsonStringEscape(copilot1Pseudo.maskedText);
const copilot1Direct = copilotBody1.includes(copilot1EscOrig) ? copilotBody1.replace(copilot1EscOrig, copilot1EscRepl) : null;
assert(copilot1Direct !== null, 'Copilot (message): direct string replacement works');
if (copilot1Direct) {
  const reparsed = JSON.parse(copilot1Direct);
  assert(reparsed.conversationId === '51D|BingProd|abc123', 'Copilot: direct replacement preserves conversationId');
  assert(reparsed.tone === 'balanced', 'Copilot: direct replacement preserves tone');
  assert(reparsed.traceId === 'trace-123-abc', 'Copilot: direct replacement preserves traceId');
  assert(!reparsed.message.includes('Helen Park'), 'Copilot: direct replacement removes "Helen Park"');
  assert(!reparsed.message.includes('Helen Park'), 'Copilot: direct replacement has no original name');
}

// Compare: replacePrompt re-serializes (this was the old approach)
const copilot1Replaced = replacePrompt(copilotBody1, copilot1Extracted!, copilot1Pseudo.maskedText);
assert(copilot1Replaced !== null, 'Copilot (message): replacePrompt returns non-null');
if (copilot1Direct && copilot1Replaced) {
  // Check if replacePrompt changed the JSON format
  const directParsed = JSON.parse(copilot1Direct);
  const replacedParsed = JSON.parse(copilot1Replaced);
  const directKeys = Object.keys(directParsed).sort().join(',');
  const replacedKeys = Object.keys(replacedParsed).sort().join(',');
  assert(directKeys === replacedKeys, 'Both methods preserve the same keys');

  // KEY CHECK: Does replacePrompt change the raw JSON format?
  const formatDiffers = copilot1Direct !== copilot1Replaced;
  if (formatDiffers) {
    console.log(`  ⚠️  replacePrompt changes JSON format (${copilot1Replaced.length} vs ${copilot1Direct.length} chars)`);
    console.log(`      Direct:  "${copilot1Direct.substring(0, 80)}..."`);
    console.log(`      Replace: "${copilot1Replaced.substring(0, 80)}..."`);
  } else {
    console.log('  ✅ Both methods produce identical output');
  }
}

// ─── Test: Copilot Body Format (nested message object) ──────────────────

console.log('\n═══ Microsoft Copilot Format (nested message.text) ═══');
const copilotBody2 = JSON.stringify({
  message: { text: SENSITIVE_PROMPT, locale: 'en-US' },
  conversationId: '51D|BingProd|def456',
  participant: { id: '9876543210' },
  tone: 'creative',
});

const copilot2Extracted = extractPrompt(copilotBody2);
assert(copilot2Extracted !== null, 'Copilot (message.text): extractPrompt returns non-null');
assert(copilot2Extracted!.includes('Helen Park'), 'Copilot (message.text): extracted prompt contains "Helen Park"');

// Direct string replacement
const copilot2Entities = detectWithRegex(copilot2Extracted!);
const copilot2Pseudo = pseudonymizeLocal(copilot2Extracted!, copilot2Entities);
const copilot2EscOrig = jsonStringEscape(copilot2Extracted!);
const copilot2EscRepl = jsonStringEscape(copilot2Pseudo.maskedText);
const copilot2Direct = copilotBody2.includes(copilot2EscOrig) ? copilotBody2.replace(copilot2EscOrig, copilot2EscRepl) : null;
assert(copilot2Direct !== null, 'Copilot (message.text): direct string replacement works');

// ─── Test: OpenAI API Format ─────────────────────────────────────────────

console.log('\n═══ OpenAI API Format ═══');
const openaiBody = JSON.stringify({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: SENSITIVE_PROMPT },
  ],
  temperature: 0.7,
  stream: true,
});

const openaiExtracted = extractPrompt(openaiBody);
assert(openaiExtracted !== null, 'OpenAI: extractPrompt returns non-null');
assert(openaiExtracted!.includes('Helen Park'), 'OpenAI: extracted prompt contains "Helen Park"');

// Direct string replacement
const openaiEntities = detectWithRegex(openaiExtracted!);
const openaiPseudo = pseudonymizeLocal(openaiExtracted!, openaiEntities);
const openaiEscOrig = jsonStringEscape(openaiExtracted!);
const openaiEscRepl = jsonStringEscape(openaiPseudo.maskedText);
const openaiDirect = openaiBody.includes(openaiEscOrig) ? openaiBody.replace(openaiEscOrig, openaiEscRepl) : null;
assert(openaiDirect !== null, 'OpenAI: direct string replacement works');

// ─── Test: Claude / Anthropic Format ─────────────────────────────────────

console.log('\n═══ Anthropic Claude Format ═══');
const anthropicBody = JSON.stringify({
  model: 'claude-opus-4-6',
  messages: [
    { role: 'user', content: SENSITIVE_PROMPT }
  ],
  max_tokens: 4096,
  stream: true,
});

const anthropicExtracted = extractPrompt(anthropicBody);
assert(anthropicExtracted !== null, 'Anthropic: extractPrompt returns non-null');
assert(anthropicExtracted!.includes('Helen Park'), 'Anthropic: extracted prompt contains "Helen Park"');

// ─── Test: DeepSeek Format ──────────────────────────────────────────────

console.log('\n═══ DeepSeek Format ═══');
const deepseekBody = JSON.stringify({
  prompt: SENSITIVE_PROMPT,
  model: 'deepseek-chat',
  stream: true,
});

const deepseekExtracted = extractPrompt(deepseekBody);
assert(deepseekExtracted !== null, 'DeepSeek: extractPrompt returns non-null');
assert(deepseekExtracted!.includes('Helen Park'), 'DeepSeek: extracted prompt contains "Helen Park"');

// ─── Test: Perplexity Format ────────────────────────────────────────────

console.log('\n═══ Perplexity Format ═══');
const perplexityBody = JSON.stringify({
  query_str: SENSITIVE_PROMPT,
  search_focus: 'internet',
  mode: 'copilot',
});

const perplexityExtracted = extractPrompt(perplexityBody);
assert(perplexityExtracted !== null, 'Perplexity: extractPrompt returns non-null');
assert(perplexityExtracted!.includes('Helen Park'), 'Perplexity: extracted prompt contains "Helen Park"');

// ─── Test: Gemini URL-encoded Format ────────────────────────────────────

console.log('\n═══ Google Gemini (URL-encoded f.req) ═══');
const geminiInnerPayload = JSON.stringify([SENSITIVE_PROMPT, null, null, [], null, null, null, null, null, null, null, null]);
const geminiOuterPayload = JSON.stringify([[[
  'MfsCee',
  geminiInnerPayload,
  null,
  'generic',
]]]);
const geminiBody = `f.req=${encodeURIComponent(geminiOuterPayload)}&at=AG4vRfUAAAA&`;

const geminiExtracted = extractPrompt(geminiBody);
assert(geminiExtracted !== null, 'Gemini: extractPrompt returns non-null');
if (geminiExtracted) {
  assert(geminiExtracted.includes('Helen Park'), `Gemini: extracted prompt contains "Helen Park" (got ${geminiExtracted.length} chars)`);
}

// Direct string replacement won't work for Gemini (URL-encoded), so replacePrompt must handle it
const geminiEntities = detectWithRegex(geminiExtracted || '');
if (geminiEntities.length > 0) {
  const geminiPseudo = pseudonymizeLocal(geminiExtracted!, geminiEntities);
  const geminiReplaced = replacePrompt(geminiBody, geminiExtracted!, geminiPseudo.maskedText);
  assert(geminiReplaced !== null, 'Gemini: replacePrompt returns non-null');
  if (geminiReplaced) {
    // Verify the replacement happened by extracting from the modified body
    const reExtracted = extractPrompt(geminiReplaced);
    assert(reExtracted !== null && !reExtracted.includes('Helen Park'), 'Gemini: replaced body no longer contains "Helen Park"');
  }
}

// ─── Test: Body format preservation (critical for Copilot) ──────────────

console.log('\n═══ Body Format Preservation (Copilot-critical) ═══');
// Simulate a Copilot body with specific formatting
const copilotOriginal = '{"message":"Create a financial model for Project Nighthawk by our client Meridian Capital Partners. Contact Helen Park (helen.park@jpmorgan.com) for the $2.8B deal details.","conversationId":"51D|BingProd|xyz789","participant":{"id":"1234"},"source":"cib","traceId":"t-123","optionsSets":["nlu","deepleo"],"isStartOfSession":true,"tone":"balanced"}';

const copilotParsedAndReserialized = JSON.stringify(JSON.parse(copilotOriginal));
const formatsMatch = copilotOriginal === copilotParsedAndReserialized;
console.log(`  JSON.parse→stringify preserves format: ${formatsMatch ? '✅ YES' : '❌ NO'}`);
if (!formatsMatch) {
  console.log(`  Original:     "${copilotOriginal.substring(0, 60)}..."`);
  console.log(`  Reserialized: "${copilotParsedAndReserialized.substring(0, 60)}..."`);
  console.log('  ⚠️  This confirms replacePrompt (which re-serializes) changes the format!');
  console.log('  ⚠️  Direct string replacement is REQUIRED for Copilot.');
}

// Test that direct replacement preserves format exactly
const coExtracted = extractPrompt(copilotOriginal);
if (coExtracted) {
  const coEntities = detectWithRegex(coExtracted);
  const coPseudo = pseudonymizeLocal(coExtracted, coEntities);
  const coEsc = jsonStringEscape(coExtracted);
  const coReplEsc = jsonStringEscape(coPseudo.maskedText);

  if (copilotOriginal.includes(coEsc)) {
    const directResult = copilotOriginal.replace(coEsc, coReplEsc);
    // Verify the result is valid JSON
    try {
      const parsed = JSON.parse(directResult);
      assert(true, 'Direct replacement produces valid JSON');
      assert(parsed.conversationId === '51D|BingProd|xyz789', 'Direct replacement preserves conversationId');
      assert(parsed.tone === 'balanced', 'Direct replacement preserves tone');
      assert(!parsed.message.includes('Helen Park'), 'Direct replacement removes sensitive data');
    } catch (e) {
      assert(false, 'Direct replacement produces valid JSON', String(e));
    }
  } else {
    assert(false, 'Escaped prompt found in body string');
  }
}

// ─── Test: SignalR WebSocket Frame Handling ──────────────────────────────

console.log('\n═══ SignalR WebSocket Frame Handling (Copilot) ═══');

const RECORD_SEP = '\u001e';

// Simulate a SignalR WebSocket message with multiple frames
// Type 6 = Ping, Type 1 = Invocation (chat), Type 3 = Completion
const signalRPing = '{"type":6}';
const signalRChat = '{"type":1,"target":"chat","arguments":[{"message":"Create a financial model for Project Nighthawk by our client Meridian Capital Partners. Contact Helen Park (helen.park@jpmorgan.com) for the $2.8B deal details.","conversationId":"51D|BingProd|abc"}]}';
const signalRCompletion = '{"type":3,"invocationId":"1"}';

// Full WebSocket message = multiple frames separated by record separator
const fullWsMessage = signalRPing + RECORD_SEP + signalRChat + RECORD_SEP + signalRCompletion + RECORD_SEP;

// Test 1: Parse frames correctly
const frames = fullWsMessage.split(RECORD_SEP).filter(f => f.length > 0);
assert(frames.length === 3, 'SignalR: splits into 3 frames');

// Test 2: Identify chat frame
function testIsSignalRChatFrame(frame: string): boolean {
  try {
    const parsed = JSON.parse(frame);
    if (parsed?.type !== 1) return false;
    if (!parsed?.target) return false;
    if (!Array.isArray(parsed?.arguments) || parsed.arguments.length === 0) return false;
    return true;
  } catch { return false; }
}

assert(testIsSignalRChatFrame(signalRPing) === false, 'SignalR: ping frame is NOT chat');
assert(testIsSignalRChatFrame(signalRChat) === true, 'SignalR: chat frame IS chat');
assert(testIsSignalRChatFrame(signalRCompletion) === false, 'SignalR: completion frame is NOT chat');

// Test 3: Extract prompt from chat frame only
const chatPrompt = extractPrompt(signalRChat);
assert(chatPrompt !== null, 'SignalR: extracts prompt from chat frame');
assert(chatPrompt !== null && chatPrompt.includes('Helen Park'), 'SignalR: extracted prompt contains "Helen Park"');

const pingPrompt = extractPrompt(signalRPing);
assert(pingPrompt === null || (pingPrompt && pingPrompt.length < 10), 'SignalR: no prompt from ping frame');

// Test 4: Pseudonymize ONLY the chat frame, preserve others
if (chatPrompt) {
  const chatEntities = detectWithRegex(chatPrompt);
  assert(chatEntities.length > 0, `SignalR: detected ${chatEntities.length} entities in chat frame`);

  const chatPseudo = pseudonymizeLocal(chatPrompt, chatEntities);

  // Direct string replacement on the CHAT FRAME ONLY
  const escapedOrig = jsonStringEscape(chatPrompt);
  const escapedRepl = jsonStringEscape(chatPseudo.maskedText);

  let modifiedChatFrame = signalRChat;
  if (signalRChat.includes(escapedOrig)) {
    modifiedChatFrame = signalRChat.replace(escapedOrig, escapedRepl);
  }

  assert(modifiedChatFrame !== signalRChat, 'SignalR: chat frame was modified');
  assert(!modifiedChatFrame.includes('Helen Park'), 'SignalR: modified chat frame no longer contains "Helen Park"');

  // Verify the modified frame is still valid JSON
  try {
    const parsedModified = JSON.parse(modifiedChatFrame);
    assert(parsedModified.type === 1, 'SignalR: modified frame still type 1');
    assert(parsedModified.target === 'chat', 'SignalR: modified frame still targets chat');
    assert(parsedModified.arguments[0].conversationId === '51D|BingProd|abc', 'SignalR: modified frame preserves conversationId');
    assert(true, 'SignalR: modified chat frame is valid JSON');
  } catch (e) {
    assert(false, 'SignalR: modified chat frame is valid JSON', String(e));
  }

  // Test 5: Reconstruct full message with record separators
  const newFrames = [signalRPing, modifiedChatFrame, signalRCompletion];
  const reconstructed = newFrames.join(RECORD_SEP) + RECORD_SEP;

  // Verify ping and completion frames are UNTOUCHED
  const reParsedFrames = reconstructed.split(RECORD_SEP).filter(f => f.length > 0);
  assert(reParsedFrames[0] === signalRPing, 'SignalR: ping frame untouched after reconstruction');
  assert(reParsedFrames[2] === signalRCompletion, 'SignalR: completion frame untouched after reconstruction');
  assert(reParsedFrames[1] !== signalRChat, 'SignalR: chat frame was modified in reconstruction');
  assert(!reParsedFrames[1].includes('Helen Park'), 'SignalR: reconstructed chat frame has no PII');
}

// ─── Test: Realistic Fake Data Generation ────────────────────────────────

console.log('\n═══ Realistic Fake Data Generation ═══');

// Test PERSON fakes are gender-consistent
const fakeHelenPark = generateFake('PERSON', 'Helen Park');
const allFemaleFakes = FAKE_NAMES_F;
assert(allFemaleFakes.includes(fakeHelenPark), `Female name "Helen Park" → female fake "${fakeHelenPark}"`);

const fakeMichaelTorres = generateFake('PERSON', 'Michael Torres');
const allMaleFakes = FAKE_NAMES_M;
assert(allMaleFakes.includes(fakeMichaelTorres), `Male name "Michael Torres" → male fake "${fakeMichaelTorres}"`);

// Test ORG fakes come from pool
const fakeOrg = generateFake('ORGANIZATION', 'NovaTech');
assert(FAKE_ORGS.includes(fakeOrg), `ORG fake "${fakeOrg}" is from fake org pool`);

// Test TICKER preserves exchange prefix
const fakeTicker = generateFake('TICKER', 'NYSE: NVTK');
assert(fakeTicker.startsWith('NYSE: '), `Ticker fake "${fakeTicker}" preserves "NYSE: " prefix`);
assert(FAKE_TICKERS.includes(fakeTicker.replace('NYSE: ', '')), `Ticker symbol is from pool`);

// Test standalone ticker (e.g., $AAPL)
const fakeTickerPlain = generateFake('TICKER', '$AAPL');
assert(FAKE_TICKERS.includes(fakeTickerPlain), `Plain ticker fake "${fakeTickerPlain}" is from pool`);

// Test MONETARY_AMOUNT preserves magnitude
const fakeAmount1 = generateFake('MONETARY_AMOUNT', '$47M');
assert(fakeAmount1.startsWith('$'), `Amount fake "${fakeAmount1}" keeps $ prefix`);
assert(fakeAmount1.endsWith('M'), `Amount fake "${fakeAmount1}" keeps M suffix`);
const amt1Num = parseFloat(fakeAmount1.replace(/[$M]/g, ''));
assert(amt1Num >= 32 && amt1Num <= 64, `Amount "${fakeAmount1}" within 0.7-1.35x of $47M (got ${amt1Num})`);

// Test PERCENTAGE
const fakePct = generateFake('PERCENTAGE', '18%');
assert(fakePct.endsWith('%'), `Percentage fake "${fakePct}" ends with %`);
const pctNum = parseFloat(fakePct.replace('%', ''));
assert(pctNum >= 0.1 && pctNum <= 99.9, `Percentage "${fakePct}" in valid range`);
assert(pctNum !== 18, `Percentage "${fakePct}" differs from original 18%`);

// Test PROJECT_NAME
const fakeProject = generateFake('PROJECT_NAME', 'Project Horizon');
assert(FAKE_PROJECTS.includes(fakeProject), `Project fake "${fakeProject}" is from pool`);

// Test DATE (written)
const fakeDate = generateFake('DATE', 'March 5th');
assert(/^[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)/.test(fakeDate), `Date fake "${fakeDate}" looks like a written date`);
assert(!fakeDate.startsWith('March 5'), `Date fake "${fakeDate}" differs from original`);

// Test FISCAL_PERIOD
const fakeFP = generateFake('FISCAL_PERIOD', 'Q4');
assert(/^Q[1-4]/.test(fakeFP), `Fiscal period fake "${fakeFP}" looks like a quarter`);

// Test EMAIL
const fakeEmail = generateFake('EMAIL', 'helen.park@jpmorgan.com');
assert(fakeEmail.includes('@'), `Email fake "${fakeEmail}" has @`);
assert(fakeEmail.includes('.'), `Email fake "${fakeEmail}" has domain`);
assert(!fakeEmail.includes('jpmorgan'), `Email fake "${fakeEmail}" has no original domain`);

// Test SSN
const fakeSSN = generateFake('SSN', '123-45-6789');
assert(/^\d{3}-\d{2}-\d{4}$/.test(fakeSSN), `SSN fake "${fakeSSN}" preserves format`);
assert(fakeSSN !== '123-45-6789', `SSN fake "${fakeSSN}" differs from original`);

// Test HEADCOUNT
const fakeHC = generateFake('HEADCOUNT', '340 headcount');
assert(fakeHC.includes('headcount'), `Headcount fake "${fakeHC}" keeps suffix`);
const hcNum = parseInt(fakeHC);
assert(hcNum >= 238 && hcNum <= 459, `Headcount "${fakeHC}" within 0.7-1.35x of 340 (got ${hcNum})`);

// Test LEGAL_REFERENCE
const fakeLR = generateFake('LEGAL_REFERENCE', 'Section 13D');
assert(fakeLR.startsWith('Section '), `Legal ref fake "${fakeLR}" keeps prefix`);
assert(!fakeLR.includes('13D'), `Legal ref fake "${fakeLR}" differs from original`);

// ─── Test: Conversation Persistence (forward map) ────────────────────────

console.log('\n═══ Conversation Persistence (Forward Map) ═══');

// Reset forward map for this test
currentForwardMap = {};
Object.keys(_usedFakes).forEach(k => delete _usedFakes[k]);

// Use text where "Helen Park" is detected via the lookahead pattern (comma + "who")
const textA = 'Helen Park, who leads the team, sent the email to helen.park@jpmorgan.com.';
const entitiesA = detectWithRegex(textA);
const resultA = pseudonymizeLocal(textA, entitiesA);

// Second message with same entity — use "for Helen Park" contextual trigger
const textB = 'The report was prepared for Helen Park by the analyst.';
const entitiesB = detectWithRegex(textB);
const resultB = pseudonymizeLocal(textB, entitiesB);

// Helen Park should map to the SAME fake in both messages
const helenMappingA = resultA.mappings.find(m => m.original === 'Helen Park');
const helenMappingB = resultB.mappings.find(m => m.original === 'Helen Park');
assert(helenMappingA !== undefined, `Persistence: found Helen Park mapping in message A (entities: ${entitiesA.map(e => e.text).join(', ')})`);
assert(helenMappingB !== undefined, `Persistence: found Helen Park mapping in message B (entities: ${entitiesB.map(e => e.text).join(', ')})`);
if (helenMappingA && helenMappingB) {
  assert(helenMappingA.pseudonym === helenMappingB.pseudonym,
    `Persistence: same fake "${helenMappingA.pseudonym}" used across messages`);
}

// ─── Test: Realistic fakes produce natural-looking text ──────────────────

console.log('\n═══ Natural-Looking Pseudonymized Text ═══');

// Reset for this test
currentForwardMap = {};
Object.keys(_usedFakes).forEach(k => delete _usedFakes[k]);

// Use context keywords so names are detected (CEO, CFO trigger the contextual pattern)
const naturalText = 'CEO Sarah Chen and CFO Michael Torres at NovaTech (NYSE: NVTK) discussed the $200M deal on March 5th. The Q4 revenue was $47M with 18% margins. Contact jennifer.walsh@davispolk.com regarding Section 13D.';
const naturalEntities = detectWithRegex(naturalText);
const naturalResult = pseudonymizeLocal(naturalText, naturalEntities);

// Verify NO bracket tokens remain
assert(!naturalResult.maskedText.includes('['), `No bracket tokens in: "${naturalResult.maskedText.substring(0, 100)}..."`);

// Verify original sensitive data is removed
assert(!naturalResult.maskedText.includes('Sarah Chen'), 'Natural: no original name "Sarah Chen"');
assert(!naturalResult.maskedText.includes('NovaTech'), 'Natural: no original org "NovaTech"');
assert(!naturalResult.maskedText.includes('NVTK'), 'Natural: no original ticker "NVTK"');
assert(!naturalResult.maskedText.includes('jennifer.walsh'), 'Natural: no original email');

// Verify the text still reads naturally (has fake names, amounts, etc.)
assert(naturalResult.maskedText.length > 100, `Natural text has substantial length: ${naturalResult.maskedText.length} chars`);
assert(naturalResult.mappings.length >= 5, `Natural: ${naturalResult.mappings.length} mappings (expect >= 5)`);

console.log(`  Pseudonymized (realistic fakes):`);
console.log(`  "${naturalResult.maskedText.substring(0, 200)}..."`);

// ─── Summary ─────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
