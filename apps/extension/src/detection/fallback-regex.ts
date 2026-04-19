/**
 * Regex-based PII detection as fallback when GLiNER/WebGPU is unavailable.
 * Less accurate than the ML model but works everywhere.
 */

import type { DetectedEntity } from './types';
import { isKnownNonPII } from './known-phrases';

// ── M-12: Stopwords that look like first names but are common English words ──
// Only suppress when context suggests they're used as common words (lowercase
// or followed by verbs/articles). When title-cased and in PII context, allow them.
const FIRST_NAME_STOPWORDS = new Set([
  'will', 'may', 'mark', 'bill', 'grace', 'hope', 'faith',
  'chase', 'grant', 'art', 'dawn', 'joy', 'august', 'lance',
  'wade', 'cliff', 'brook', 'dale', 'glen', 'heath', 'holly',
  'iris', 'ivy', 'jasmine', 'lily', 'olive', 'pearl', 'robin',
  'rose', 'ruby', 'sage', 'violet', 'sterling', 'chance',
]);

/**
 * M-12: Check if a PERSON match is likely a false positive because the first
 * word is a common English word used in non-name context.
 * Returns true if the match should be SUPPRESSED (is a false positive).
 */
function isStopwordFalsePositive(text: string, matchStart: number, matchText: string): boolean {
  const firstName = matchText.split(/\s+/)[0];
  if (!firstName || !FIRST_NAME_STOPWORDS.has(firstName.toLowerCase())) return false;

  // If preceded by a title (Dr., Mr., etc.), it's likely a real name
  const before = text.substring(Math.max(0, matchStart - 10), matchStart);
  if (/(?:Dr|Mr|Mrs|Ms|Prof|Rev)\.?\s*$/i.test(before)) return false;

  // If preceded by a name-context keyword, it's likely a real name
  if (/(?:employee|patient|client|named|called|name[:\s])\s*$/i.test(before)) return false;

  // If preceded by an article/pronoun/preposition that suggests common-word usage, suppress
  if (/\b(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|I|we|they|you|he|she|it|to|can|could|would|should|shall|must|might)\s+$/i.test(before)) return true;

  // If followed by a verb suggesting common-word usage (e.g., "Will travel", "May cause")
  const after = text.substring(matchStart + matchText.length, matchStart + matchText.length + 30);
  if (/^\s+(?:be\b|have\b|has\b|had\b|do\b|does\b|did\b|is\b|are\b|was\b|were\b|not\b|also\b|likely\b|cause\b|help\b|need\b|want\b|require\b|come\b|go\b|make\b|take\b|get\b|give\b|keep\b|let\b|begin\b|seem\b|show\b|try\b|use\b|work\b|call\b|provide\b|become\b|leave\b|remain\b|result\b|happen\b|continue\b)/i.test(after)) return true;

  return false;
}

/**
 * ABA routing number checksum validation.
 * ABA routing numbers are 9 digits. The checksum is:
 *   (3*d1 + 7*d2 + d3 + 3*d4 + 7*d5 + d6 + 3*d7 + 7*d8 + d9) mod 10 === 0
 * Also, the leading two digits must be in 00-12, 21-32, 61-72, or 80
 * (valid Federal Reserve routing symbols).
 */
function isValidABARouting(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const n = digits.split('').map(d => parseInt(d, 10));
  const checksum = (3 * n[0] + 7 * n[1] + n[2] + 3 * n[3] + 7 * n[4] + n[5] + 3 * n[6] + 7 * n[7] + n[8]) % 10;
  if (checksum !== 0) return false;
  const prefix = parseInt(digits.substring(0, 2), 10);
  const validPrefix =
    (prefix >= 0 && prefix <= 12) ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80;
  return validPrefix;
}

// ── M-14: Port numbers and version strings that trigger PHONE_NUMBER false positives ──
const COMMON_PORT_NUMBERS = new Set([
  '80', '443', '3000', '3001', '3306', '4200', '4443', '5000', '5432', '5500',
  '6379', '8000', '8080', '8443', '8888', '9000', '9090', '9200', '9300',
  '27017', '27018',
]);

/**
 * M-14: Check if a PHONE_NUMBER match is actually a port number, version string,
 * or code-like context that should be excluded.
 */
function isCodeLikeFalsePositive(text: string, matchStart: number, matchText: string): boolean {
  // Check for version strings: v1.2.3, 1.2.3, version 2.0.1
  const before30 = text.substring(Math.max(0, matchStart - 30), matchStart);
  if (/(?:v(?:ersion)?\s*\.?\s*|@)\s*$/i.test(before30)) return true;
  // Version-like pattern: short digits separated by dots (e.g., "1.2.3", "10.0.1")
  // Exclude phone-like patterns where segments are 3+ digits (e.g., "555.123.4567")
  const dotDigits = matchText.replace(/[\s()-+]/g, '');
  if (/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(dotDigits)) {
    const segments = dotDigits.split('.');
    // Phone numbers have at least one segment with 3+ digits; versions have short segments
    const maxSegmentLen = Math.max(...segments.map(s => s.length));
    if (maxSegmentLen <= 2) return true; // e.g., "1.2.3", "10.0.1" — version
  }

  // Check for port numbers: ":8080", "port 3000", "localhost:5000"
  const beforeContext = text.substring(Math.max(0, matchStart - 20), matchStart);
  const digits = matchText.replace(/[\s\-().+]/g, '');
  if (COMMON_PORT_NUMBERS.has(digits)) {
    if (/(?::|port\s*|localhost\s*:?\s*)$/i.test(beforeContext)) return true;
  }

  // Check for code-like context: preceded by common code patterns
  if (/(?:0x[0-9a-f]*|0b[01]*|port|listen|bind|connect|localhost|127\.0\.0\.1|::)\s*[:=]?\s*$/i.test(beforeContext)) return true;

  return false;
}

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  contextual?: boolean; // if true, extract only the name portion (last two words)
}

// Business suffixes that indicate an ORGANIZATION, not a PERSON.
// Used to reclassify PERSON matches whose last word is a business term.
// e.g. "Proseware Solutions" matched as PERSON → reclassified to ORGANIZATION.
const ORG_SUFFIX_SET = new Set([
  'inc', 'corp', 'corporation', 'llc', 'ltd', 'llp',
  'associates', 'partners', 'group', 'foundation',
  'hospital', 'center', 'centre', 'university', 'college',
  'bank', 'insurance', 'industries', 'enterprises', 'holdings',
  'capital', 'trust', 'fund', 'technologies', 'tech',
  'solutions', 'services', 'consulting', 'management',
  'investments', 'advisors', 'advisory', 'labs', 'laboratories',
  'media', 'energy', 'resources', 'dynamics', 'systems',
  'international', 'global', 'worldwide', 'agency',
  'commission', 'authority', 'bureau', 'institute', 'council',
  'pharma', 'pharmaceuticals', 'mining', 'logistics', 'motors',
  'financial', 'securities', 'networks', 'electric',
  'communications', 'telecom', 'exchange', 'petroleum',
  'aerospace', 'aviation', 'defense', 'studio', 'studios',
  'healthcare', 'health', 'ventures', 'platform', 'platforms',
  'software', 'analytics', 'robotics', 'automation',
  'engineering', 'constructions', 'construction',
  'properties', 'realty', 'brands', 'foods', 'beverages',
]);

const REGEX_PATTERNS: RegexPattern[] = [
  // ── Person Names ──────────────────────────────────────────────────────
  // Titled names: Dr. John Smith, Mr. Jane Doe
  {
    type: 'PERSON',
    pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g,
    confidence: 0.9,
  },
  // Names after contextual keywords: employee/patient/client/CEO/etc.
  {
    type: 'PERSON',
    pattern: /\b(?:employee|patient|client|manager|contact|attending|plaintiff|defendant|counsel|attorney|doctor|nurse|therapist|spouse|wife|husband|CEO|CFO|CTO|COO|CMO|VP|director|analyst|engineer)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi,
    confidence: 0.85,
    contextual: true,
  },
  // Names before parenthetical or comma + context: "Sarah Chen (email..." or "David Park, Employee ID"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=\(|\[|<|,\s*(?:who|our|the|is|at|from|[Ee]mployee|[Ss]taff|[Aa]ge|[Bb]orn|[Bb]adge|ID|[Dd]ob|[Ss]sn|an?\s))/g,
    confidence: 0.8,
  },
  // Names after prepositions: "for Sarah Chen", "from John Smith"
  {
    type: 'PERSON',
    pattern: /\b(?:for|from|to|by|with|about|cc|re|dear|hi|hey|hello|regarding)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.82,
    contextual: true,
  },
  // Names followed by action verbs: "John Smith mentioned", "Sarah Chen emailed"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s+(?:told|said|mentioned|emailed|called|asked|informed|reported|confirmed|denied|stated|claimed|suggested|proposed|recommended|approved|rejected|signed|authorized)\b/g,
    confidence: 0.7,
  },
  // Names in possessive context: "John Smith's account", "Sarah Chen's file"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}(?:'s|'s)\s+(?:account|file|case|record|report|email|salary|position|team|department|performance|review|contract|agreement)\b/g,
    confidence: 0.75,
  },
  // Names after action verbs (reverse): "told John Smith", "emailed Sarah Chen"
  {
    type: 'PERSON',
    pattern: /\b(?:told|asked|emailed|called|informed|notified|briefed|contacted|assigned|promoted|terminated|hired|fired|invited)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.7,
    contextual: true,
  },
  // Names in structured/delimited data: "| Sarah Chen |", "| F David Park |"
  // Uses lookbehind for delimiter so match[0] starts at the name.
  // Optional prefix (gender marker M/F or column header) is consumed by lookbehind.
  {
    type: 'PERSON',
    pattern: /(?<=[\|,\t]\s*(?:[A-Za-z]+\s+)*)[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}(?=\s*[\|,\t])/g,
    confidence: 0.78,
  },
  // Names near colons/dashes (form-like context): "Name: Felix Drummond", "Patient — Lena Kovacs"
  {
    type: 'PERSON',
    pattern: /(?<=(?:name|patient|client|employee|contact|applicant|candidate|borrower|insured|claimant|beneficiary|guardian|witness|tenant|landlord|sender|recipient|author|reviewer|assignee|owner|requestor)\s*(?::|—|-|–)\s*)[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.85,
    contextual: true,
  },
  // Standalone names after conjunctions/enumerations: "and Felix Drummond", "including Lena Kovacs"
  {
    type: 'PERSON',
    pattern: /\b(?:and|or|between|involving|versus|vs\.?|notify|include|includes|including|namely|specifically)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.6,
    contextual: true,
  },
  // Names at start of line in structured HR/legal docs: "Felix Drummond, age 34"
  {
    type: 'PERSON',
    pattern: /(?:^|\n)\s*[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=,\s*(?:age|born|dob|ssn|employee|male|female|\d{1,3}\s*(?:years?|yr)|residing))/gim,
    confidence: 0.85,
  },
  // ── Organization Names ────────────────────────────────────────────────
  // Multi-word capitalized names with common org suffixes
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|Corporation|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Health|Healthcare|Medical|Clinic|Physicians|Pharmacy|Center|Centre|University|College|Bank|Insurance|Industries|Enterprises|Holdings|Capital|Trust|Fund|Technologies|Tech|Solutions|Services|Consulting|Management|Investments|Advisors|Advisory|Labs|Laboratories|Media|Energy|Resources|Dynamics|Systems|International|Global|Worldwide|Agency|Commission|Authority|Bureau|Institute|Council|Society|Government|Aerospace|Aviation|Defense|Pharma|Pharmaceuticals|Mining|Logistics|Motors|Financial|Securities|Exchange|Telecom|Communications|Networks|Electric|Petroleum|Oil|Gas)\b\.?/g,
    confidence: 0.8,
  },
  // Law firms: "Name & Name" or "Name, Name & Name" patterns
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*\s*&\s*[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*\b/g,
    confidence: 0.75,
  },
  // Organizations after contextual keywords (multi-word names)
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:company|firm|corporation|organization|entity|employer|contractor|vendor|supplier|subsidiary|parent\s+company|activist(?:\s+fund)?|investor|fund|bank|lender|customer|client|account|partner|prospect|tenant|portfolio\s+company)\s*(?::|called|named|is|,)?\s+[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|&|No\.\s*\d+|of|the|and))+\b/gi,
    confidence: 0.75,
    contextual: true,
  },
  // Organizations after contextual keywords (single-word names like "Blackstone", "ModaGlobal")
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:company|firm|corporation|organization|entity|employer|contractor|vendor|supplier|subsidiary|parent\s+company|activist(?:\s+fund)?|investor|fund|bank|lender|PE\s+firm|PE\s+owner|backed\s+by|acquired\s+by|owned\s+by|customer|client|account|partner|prospect|tenant)\s*(?::|called|named|is|,)?\s+([A-Z][a-zA-Z]{2,})\b/gi,
    confidence: 0.7,
    contextual: true,
  },
  // CamelCase single-word company names (ModaGlobal, DeepSeek, OpenAI, etc.)
  // Requires at least 2 capital letters within the word
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g,
    confidence: 0.6,
  },
  // "with/from/at/by + ALLCAPS + Capitalized" org names (JP Morgan, BNP Paribas)
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:with|from|at|by|to)\s+[A-Z]{2,5}\s+[A-Z][a-z]{2,}\b/gi,
    confidence: 0.7,
    contextual: true,
  },
  // Institutional names: 3+ capitalized words after "at/to/from" (Memorial Sloan Kettering,
  // Mount Sinai Medical Center, Johns Hopkins University Hospital). 3+ words makes
  // PERSON collision unlikely. Uses lookbehind so match[0] is just the org name.
  {
    type: 'ORGANIZATION',
    pattern: /(?<=\b(?:at|to|from|with|by|referred\s+to|transferred\s+to|admitted\s+to|visited|consulted|scheduled\s+at|evaluated\s+at)\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,4}\b/g,
    confidence: 0.7,
  },
  // Institutional-prefix safety net: common hospital / university / research
  // institution name openings that appear anywhere in the text, regardless
  // of preceding verb. Catches "Memorial Sloan Kettering" mid-sentence when
  // the lookbehind variants miss, and "Mount Sinai", "Johns Hopkins", "Saint
  // Jude", etc. Requires at least 1 additional capitalized word after the
  // known prefix so we don't false-match on a person's first name alone.
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:Memorial|Mount|Saint|St\.?|Johns|Children's|Presbyterian|Cleveland|Mayo|Stanford|Harvard|Yale|Princeton|Columbia|Duke|MIT|NYU|UCLA|UCSF|Northwestern|Vanderbilt|Emory)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g,
    confidence: 0.75,
  },
  // Parenthetical org names in financial writing: "Top customer (Fabrikam)",
  // "acquired by (Alpine Systems)", "vendor (DeltaCore)". Very common in P&L
  // summaries and board memos where the entity name is parenthetical.
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:customer|client|account|vendor|partner|acquir\w*|target|prospect|portfolio)\s*\(\s*([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-z]+)*)\s*\)/gi,
    confidence: 0.8,
    contextual: true,
  },
  // Known financial entity patterns: "Name + Capital/Partners/Asset Management"
  // Also handles single-word names before role descriptors
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?:,\s*|\s+)(?:is\s+)?(?:considering|planning|executing|proposing|demanding|seeking|offering)\b/gi,
    confidence: 0.5,
    contextual: true,
  },
  // Standalone org names followed by business-activity nouns.
  // Catches "Fabrikam deal", "Acme merger", "Northwind acquisition".
  // Lookahead ensures match[0] is just the org name (not "deal"/"merger"/etc.)
  // so pseudonymization replaces only the entity, not the surrounding text.
  // NOTE: deliberately NO /i flag — org names must start with an uppercase
  // letter. Case-insensitive matching caused false positives like
  // "evaluating an" being classified as ORGANIZATION.
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]{3,}(?:\s+[A-Z][a-z]+)?(?=\s+(?:deal|acquisition|merger|contract|partnership|engagement|lawsuit|expansion|valuation|buyout|takeover|divestiture|spin[\s-]?off|restructuring|bankruptcy|IPO|bid|tender|settlement|litigation|arbitration)\b)/g,
    confidence: 0.7,
  },
  // Stock tickers: (TSX: THI), (NYSE: AAPL), NASDAQ: TSLA
  {
    type: 'TICKER',
    pattern: /\(?\b(?:TSX|NYSE|NASDAQ|LSE|ASX|HKEX|JSE|BSE|NSE|TSE|KRX|SGX|AMEX|OTC)\s*:\s*[A-Z]{1,5}\b\)?/g,
    confidence: 0.85,
  },
  // ── Employee / Record IDs ─────────────────────────────────────────────
  {
    type: 'EMPLOYEE_ID',
    pattern: /\b(?:EMP|HR|FMLA|RSU|REQ|WO|PO|INV)[-#]?\d{4,8}\b/g,
    confidence: 0.85,
  },
  // "Employee ID 4523", "Staff ID 12345", "Badge #67890"
  {
    type: 'EMPLOYEE_ID',
    pattern: /\b(?:employee|staff|badge|worker|personnel)\s*(?:ID|id|Id|#|number|no\.?)\s*:?\s*#?\d{3,8}\b/gi,
    confidence: 0.85,
  },
  // Generic reference numbers with prefix labels
  {
    type: 'RECORD_ID',
    pattern: /\b(?:#(?:RSU|HR|FMLA|EMP|REQ|INV|PO|WO|TKT)[-‑]?\d{4,10})\b/g,
    confidence: 0.8,
  },
  // ── Social Security Numbers ───────────────────────────────────────────
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}\.\d{2}\.\d{4}\b/g,
    confidence: 0.9,
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}\s\d{2}\s\d{4}\b/g,
    confidence: 0.9,
  },
  // Bare 9-digit SSN after contextual keyword (lookbehind so match[0] is just the digits)
  {
    type: 'SSN',
    pattern: /(?<=(?:ssn|social\s*security(?:\s*(?:number|num|no|#))?|ss#)\s*(?:is|:|=|#)?\s*)\d{9}(?!\d)/gi,
    confidence: 0.95,
  },
  // ── Credit Card Numbers ───────────────────────────────────────────────
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
  // ── Email Addresses ───────────────────────────────────────────────────
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.95,
  },
  // ── Phone Numbers (US formats) ────────────────────────────────────────
  {
    type: 'PHONE_NUMBER',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
  },
  // ── IP Addresses (IPv4) ───────────────────────────────────────────────
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.9,
  },
  // ── Dates ─────────────────────────────────────────────────────────────
  {
    type: 'DATE',
    pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g,
    confidence: 0.7,
  },
  // Spelled-out dates: "March 12, 1990", "12 March 1990", "March 12th, 1990"
  {
    type: 'DATE',
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
    confidence: 0.65,
  },
  {
    type: 'DATE',
    pattern: /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}\b/gi,
    confidence: 0.65,
  },
  // ── Monetary Amounts ──────────────────────────────────────────────────
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:million|billion|M|B|k|K)?\b/g,
    confidence: 0.85,
  },
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi,
    confidence: 0.8,
  },
  // ── Percentages (only with business-sensitive context) ──────────────
  // Standalone percentages are too common to flag universally.
  // Only catch when paired with sensitive context like ownership, stakes, reductions, targets.
  {
    type: 'PERCENTAGE',
    pattern: /\b\d{1,3}(?:\.\d{1,2})?%\s*(?:stake|interest|ownership|reduction|target|threshold|cap|floor|bonus|commission|royalty|fee|discount|premium|margin|EBITDA|equity|dilution|vesting|of\s+(?:current|total|gross|net|revenue|EBITDA|assets|income))\b/gi,
    confidence: 0.75,
  },
  {
    type: 'PERCENTAGE',
    pattern: /\b(?:stake|interest|ownership|reduction|target|cap|floor|EBITDA|equity|dilution|vesting|divestiture|allocation|share|bonus|inventory|revenue|margin|cost|debt)\s+(?:of\s+|by\s+)?\d{1,3}(?:\.\d{1,2})?%/gi,
    confidence: 0.75,
  },
  // "by N%" after reduction verbs: "reducing by 80%", "cut by 30%", "decreased by 15%"
  {
    type: 'PERCENTAGE',
    pattern: /\b(?:reduc\w{0,10}|cut\w{0,8}|decreas\w{0,10}|increas\w{0,10}|grow\w{0,8}|rais\w{0,10}|lower\w{0,8}|slash\w{0,8}|trim\w{0,8}|shrink\w{0,8}|expand\w{0,8})\b[^.]{0,30}\b(\d{1,3}(?:\.\d{1,2})?%)/gi,
    confidence: 0.7,
  },
  // ── Named Locations (geographic, facilities) ────────────────────────
  // "Lake/River/Mount/Fort/Port + Name" patterns
  {
    type: 'LOCATION',
    pattern: /\b(?:Lake|River|Mount|Fort|Port|Cape|Gulf|Bay|Isle|Island|Valley|Creek|Falls|Canyon|Peak|Ridge|Point|Harbor|Harbour)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    confidence: 0.7,
  },
  // "Name + Lake/River/Mountain/Dam/Pond/Reservoir" patterns
  {
    type: 'LOCATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Lake|River|Mountain|Dam|Pond|Reservoir|Creek|Falls|Canyon|Basin|Ridge|Valley|Harbor|Harbour|Bay|Strait|Channel|Forest|Park|Mine|Quarry|Field)\b/g,
    confidence: 0.7,
  },
  // ── Project / Code Names ────────────────────────────────────────────
  // Quoted names in business context: "Green Horizon", "Project Phoenix"
  {
    type: 'PROJECT_NAME',
    pattern: /(?<=[""\u201C])[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}(?=[""\u201D])/g,
    confidence: 0.6,
  },
  // "Project Atlas", "Project Phoenix", "Operation Sunrise" (unquoted)
  {
    type: 'PROJECT_NAME',
    pattern: /\b(?:Project|Operation|Initiative|Program|Campaign)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    confidence: 0.75,
  },
  // ── Date of Birth ────────────────────────────────────────────────────
  // "DOB: 03/15/1990", "date of birth: March 15, 1990", "born on 1990-03-15"
  {
    type: 'DATE_OF_BIRTH',
    pattern: /(?<=(?:DOB|dob|date\s+of\s+birth|birth\s*date|born\s+on|d\.o\.b\.?)\s*(?::|is|=)?\s*)\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi,
    confidence: 0.9,
  },
  {
    type: 'DATE_OF_BIRTH',
    pattern: /(?<=(?:DOB|dob|date\s+of\s+birth|birth\s*date|born\s+on|d\.o\.b\.?)\s*(?::|is|=)?\s*)(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi,
    confidence: 0.9,
  },
  {
    type: 'DATE_OF_BIRTH',
    pattern: /(?<=(?:DOB|dob|date\s+of\s+birth|birth\s*date|born\s+on|d\.o\.b\.?)\s*(?::|is|=)?\s*)\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/gi,
    confidence: 0.9,
  },
  // ── Street Addresses ────────────────────────────────────────────────
  // "123 Main Street", "4567 Oak Ave, Suite 200"
  {
    type: 'ADDRESS',
    pattern: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy)\.?(?:\s*,?\s*(?:Suite|Ste|Apt|Unit|#)\s*\.?\s*\d{1,5})?\b/gi,
    confidence: 0.8,
  },
  // Address with city/state/zip: "..., Springfield, IL 62704"
  {
    type: 'ADDRESS',
    pattern: /\b\d{1,5}\s+[A-Za-z][\w\s]{2,30},\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
    confidence: 0.85,
  },
  // ── Bank Account / Routing Numbers ──────────────────────────────────
  // "routing number: 021000021", "bank account: 1234567890"
  {
    type: 'BANK_ACCOUNT',
    pattern: /(?<=(?:bank\s+account|checking\s+account|savings\s+account|account\s+number|acct)\s*(?:#|number|no\.?)?\s*(?::|is|=)?\s*)\d{8,17}(?!\d)/gi,
    confidence: 0.85,
  },
  {
    type: 'ROUTING_NUMBER',
    pattern: /(?<=(?:routing\s+(?:number|no\.?|#)|ABA|RTN)\s*(?::|is|=)?\s*)\d{9}(?!\d)/gi,
    confidence: 0.85,
  },
  // ── Employer Identification Number (EIN) ────────────────────────────
  // "EIN: 82-4491023", "tax ID: 12-3456789"
  {
    type: 'EIN',
    pattern: /(?<=(?:EIN|employer\s+identification\s+number|tax\s+(?:ID|identification)\s*(?:number)?|FEIN|federal\s+(?:EIN|tax\s+ID))\s*(?::|is|=|#)?\s*)\d{2}-\d{7}/gi,
    confidence: 0.9,
  },
  // Also match standalone XX-XXXXXXX format near business context
  {
    type: 'EIN',
    pattern: /\b\d{2}-\d{7}\b/g,
    confidence: 0.6,
  },
  // ── Vehicle Identification Number (VIN) ──────────────────────────────
  // 17-character alphanumeric, excluding I, O, Q.
  // Match any 17-char alphanumeric run (no I/O/Q) and filter post-match for
  // the has-letter + has-digit property. The old nested lookahead + greedy
  // alternation pattern was brittle and missed valid VINs like "1HGBH41JXMN109186";
  // the simpler form relies on the validator in isValidVIN() below.
  {
    type: 'VIN',
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
    confidence: 0.85,
  },
  // VIN after contextual keyword: "VIN: 1HGBH41JXMN109186", "vehicle ID 1HG..."
  {
    type: 'VIN',
    pattern: /(?<=(?:VIN|vehicle\s+(?:identification\s+number|ID|id)|chassis\s+(?:number|no\.?))\s*[:#]?\s*)[A-HJ-NPR-Z0-9]{17}\b/gi,
    confidence: 0.95,
  },
  // ── Passport Numbers (US format) ──────────────────────────────────────
  {
    type: 'PASSPORT_NUMBER',
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.6,
  },
  // ── Driver's License ──────────────────────────────────────────────────
  {
    type: 'DRIVERS_LICENSE',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.5,
  },
  // State-format driver's licenses: WA-SMITH-J-1234567, CA-DL-12345678, etc.
  {
    type: 'DRIVERS_LICENSE',
    pattern: /\b[A-Z]{2}-[A-Z]+-[A-Z]-\d{5,9}\b/g,
    confidence: 0.7,
  },
  // ── CVV / CVC / Security Codes ─────────────────────────────────────
  // Only match 3-4 digit numbers preceded by CVV/CVC/security code context
  {
    type: 'CVV',
    pattern: /\b(?:CVV|CVC|CVV2|CVC2|security\s+code|verification\s+(?:code|number|value))\s*[:#]?\s*(\d{3,4})\b/gi,
    confidence: 0.9,
  },
  // ── Bank Routing Numbers ───────────────────────────────────────────
  // US ABA routing numbers: 9 digits, often preceded by "routing" context
  {
    type: 'ROUTING_NUMBER',
    pattern: /\b(?:routing|ABA|transit)\s*(?:#|no\.?|number)?\s*[:#]?\s*(0[0-9]\d{7})\b/gi,
    confidence: 0.85,
  },
  // Standalone 9-digit routing number (starts with 0-3, specific to US banks)
  {
    type: 'ROUTING_NUMBER',
    pattern: /\brouting\s*[:#]?\s*(\d{9})\b/gi,
    confidence: 0.7,
  },
  // Standalone 9-digit number that passes the ABA checksum.
  // Validated post-match via isValidABARouting(); false positives are filtered.
  {
    type: 'ROUTING_NUMBER',
    pattern: /\b\d{9}\b/g,
    confidence: 0.75,
  },
  // ── Account Numbers ───────────────────────────────────────────────────
  {
    type: 'ACCOUNT_NUMBER',
    pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi,
    confidence: 0.8,
  },
  // ── Medical Record Numbers ────────────────────────────────────────────
  {
    type: 'MEDICAL_RECORD',
    pattern: /\b(?:MRN|medical\s+record(?:\s+number)?)\s*[:#]?\s*\d{4,10}\b/gi,
    confidence: 0.85,
  },
  // ── Matter / Case Numbers ─────────────────────────────────────────────
  {
    type: 'MATTER_NUMBER',
    pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi,
    confidence: 0.75,
  },
  // ── UK National Insurance Number (NINO) ─────────────────────────────
  // Format: 2 alpha + 6 digits + 1 alpha suffix (A-D)
  // Excludes prefixes: BG, GB, NK, KN, TN, NT, ZZ and those starting D, F, I, Q, U, V
  {
    type: 'UK_NINO',
    pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
    confidence: 0.7,
  },
  // NINO with context keyword boosts confidence
  {
    type: 'UK_NINO',
    pattern: /(?<=(?:NINO|nino|national\s+insurance(?:\s+number)?|NI\s*(?:number|no|#))\s*(?::|is|=)?\s*)[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi,
    confidence: 0.9,
  },
  // ── EU IBAN ──────────────────────────────────────────────────────────
  // Format: 2-letter country code + 2 check digits + up to 30 alphanumeric chars
  {
    type: 'EU_IBAN',
    pattern: /\b[A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?(?:[A-Z0-9]{4}[\s-]?){2,7}[A-Z0-9]{1,4}\b/g,
    confidence: 0.85,
  },
  // IBAN with context keyword
  {
    type: 'EU_IBAN',
    pattern: /(?<=(?:IBAN|iban|bank\s+account|international\s+bank)\s*(?::|is|=|#)?\s*)[A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?(?:[A-Z0-9]{4}[\s-]?){2,7}[A-Z0-9]{1,4}\b/gi,
    confidence: 0.9,
  },
  // ── Canadian Social Insurance Number (SIN) ──────────────────────────
  // Format: 3 groups of 3 digits. Only match with context to avoid false positives.
  {
    type: 'CANADIAN_SIN',
    pattern: /(?<=(?:SIN|sin|social\s+insurance(?:\s+number)?|canadian\s+(?:social|sin))\s*(?::|is|=|#)?\s*)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/gi,
    confidence: 0.85,
  },
  // Bare SIN pattern (low confidence — 9 digits are common)
  {
    type: 'CANADIAN_SIN',
    pattern: /\b\d{3}-\d{3}-\d{3}\b/g,
    confidence: 0.5,
  },
  // ── Indian Aadhaar Number ───────────────────────────────────────────
  // Format: 12 digits starting with 2-9, optionally grouped as 4-4-4
  {
    type: 'INDIAN_AADHAAR',
    pattern: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    confidence: 0.6,
  },
  // Aadhaar with context keyword
  {
    type: 'INDIAN_AADHAAR',
    pattern: /(?<=(?:aadhaar|aadhar|uidai|uid|aadhaar\s+(?:number|no|#|card))\s*(?::|is|=|#)?\s*)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/gi,
    confidence: 0.9,
  },
  // ── Australian Tax File Number (TFN) ────────────────────────────────
  // Format: 9 digits, optionally grouped as 3-3-3. Only with context to avoid false positives.
  {
    type: 'AUSTRALIAN_TFN',
    pattern: /(?<=(?:TFN|tfn|tax\s+file(?:\s+number)?|australian\s+tax(?:\s+number)?)\s*(?::|is|=|#)?\s*)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/gi,
    confidence: 0.85,
  },
  // ── German Tax ID (Steuerliche Identifikationsnummer) ───────────────
  // Format: 11 digits, optionally grouped as 2-3-3-3
  {
    type: 'GERMAN_TAX_ID',
    pattern: /(?<=(?:steuer[-\s]?id|steuerliche\s+identifikationsnummer|tax\s+id(?:entification)?|german\s+tax|IdNr)\s*(?::|is|=|#)?\s*)\d{2}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/gi,
    confidence: 0.85,
  },
  // Bare German Tax ID with separators (more specific pattern)
  {
    type: 'GERMAN_TAX_ID',
    pattern: /\b\d{2}\s\d{3}\s\d{3}\s\d{3}\b/g,
    confidence: 0.5,
  },
  // ── French INSEE / NIR (Social Security Number) ─────────────────────
  // Format: 1 or 2 (sex) + 2 (year) + 2 (month 01-12 or 20+) + 2-3 (dept) + 3 (commune) + 3 (order) + 2 (key)
  {
    type: 'FRENCH_INSEE',
    pattern: /\b[12]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)\d{2,3}\d{3}\d{3}\d{2}\b/g,
    confidence: 0.7,
  },
  // INSEE with context keyword
  {
    type: 'FRENCH_INSEE',
    pattern: /(?<=(?:INSEE|NIR|nir|num[eé]ro\s+de\s+s[eé]curit[eé]\s+sociale|s[eé]curit[eé]\s+sociale|french\s+social\s+security)\s*(?::|is|=|#)?\s*)[12]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)\d{2,3}\d{3}\d{3}\d{2}(?!\d)/gi,
    confidence: 0.9,
  },
  // ── Cloud Credentials ──────────────────────────────────────────────
  // AWS Access Key ID (starts with AKIA, ASIA, or AIDA)
  {
    type: 'AWS_CREDENTIAL',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|AIDA)[A-Z0-9]{16}\b/g,
    confidence: 0.95,
  },
  // AWS Secret Access Key (40-char base64-ish after context)
  {
    type: 'AWS_CREDENTIAL',
    pattern: /(?<=(?:aws_secret_access_key|secret_access_key|aws_secret|SecretAccessKey)\s*(?:=|:|")\s*"?)[A-Za-z0-9/+=]{40}(?!\w)/gi,
    confidence: 0.95,
  },
  // GCP Service Account Key (JSON private_key field)
  {
    type: 'GCP_CREDENTIAL',
    pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]{50,}?-----END (?:RSA )?PRIVATE KEY-----/g,
    confidence: 0.95,
  },
  // GCP API Key
  {
    type: 'GCP_CREDENTIAL',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    confidence: 0.9,
  },
  // Azure Storage Account Key (base64, 88 chars)
  {
    type: 'AZURE_CREDENTIAL',
    pattern: /(?<=(?:AccountKey|azure_storage_key|AZURE_STORAGE_KEY)\s*(?:=|:)\s*"?)[A-Za-z0-9+/]{86}==(?!"?\w)/gi,
    confidence: 0.9,
  },
  // Azure AD Client Secret
  {
    type: 'AZURE_CREDENTIAL',
    pattern: /(?<=(?:client_secret|AZURE_CLIENT_SECRET|clientSecret)\s*(?:=|:|")\s*"?)[A-Za-z0-9~._-]{34,}(?!"?\w)/gi,
    confidence: 0.85,
  },
  // Generic API Keys (long hex or base64 strings after key-like labels)
  {
    type: 'API_KEY',
    pattern: /(?<=(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token|access[_-]?token|auth[_-]?token|bearer)\s*(?:=|:|")\s*"?)[A-Za-z0-9_\-./+=]{20,}(?!"?\w)/gi,
    confidence: 0.85,
  },
  // Database Connection Strings
  {
    type: 'DATABASE_URI',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss?):\/\/[^\s"'<>]{10,}\b/gi,
    confidence: 0.9,
  },
  // GitHub / GitLab Personal Access Tokens
  {
    type: 'API_KEY',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|glpat)-[A-Za-z0-9_]{36,}\b/g,
    confidence: 0.95,
  },
  // Slack Bot / User / Webhook tokens
  {
    type: 'API_KEY',
    pattern: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g,
    confidence: 0.9,
  },
  // Stripe API Keys
  {
    type: 'API_KEY',
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    confidence: 0.95,
  },
  // SendGrid API Keys
  {
    type: 'API_KEY',
    pattern: /\bSG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}\b/g,
    confidence: 0.9,
  },
  // JWT tokens — M-16: match 2+ base64url segments (standard 3-part and 2-part/multi-part)
  // 3-part JWTs (header.payload.signature) — highest confidence
  {
    type: 'AUTH_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    confidence: 0.85,
  },
  // 2-part JWTs (header.payload, unsigned) — lower confidence
  {
    type: 'AUTH_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\b(?!\.[A-Za-z0-9_-])/g,
    confidence: 0.7,
  },
  // Multi-segment tokens (4+ segments, e.g., nested/extended JWTs)
  {
    type: 'AUTH_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,}){3,}\b/g,
    confidence: 0.8,
  },
  // Anthropic API Keys (M-15)
  {
    type: 'API_KEY',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    confidence: 0.95,
  },
  // Generic OpenAI-style sk- keys, including prefixed variants like sk-proj-*, sk-svc-*.
  // Allows hyphens/underscores inside the body so the pattern doesn't terminate
  // at the hyphen after the "proj"/"svc" prefix segment.
  {
    type: 'API_KEY',
    pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{19,}(?![A-Za-z0-9_-])/g,
    confidence: 0.9,
  },
  // HuggingFace API Tokens (M-15)
  {
    type: 'API_KEY',
    pattern: /\bhf_[A-Za-z0-9]{20,}/g,
    confidence: 0.95,
  },

  // ── Insurance / Actuarial ──────────────────────────────────────────────
  // Policy numbers: common formats like PLY-123456, POL-2024-12345
  {
    type: 'POLICY_NUMBER',
    pattern: /\b(?:PO?L(?:ICY)?|PLY|CLM|CLAIM)[-\s]?\d{4,}(?:[-]\d{2,})*\b/gi,
    confidence: 0.75,
  },
  // NAIC codes (5-digit insurer identifiers)
  {
    type: 'NAIC_CODE',
    pattern: /\bNAIC\s*(?:#|code|number)?[:\s]*\d{5}\b/gi,
    confidence: 0.8,
  },

  // ── Education ──────────────────────────────────────────────────────────
  // Student ID numbers (common university formats)
  {
    type: 'STUDENT_ID',
    pattern: /\b(?:student\s*(?:ID|number|#)|SID)[:\s]*[A-Z]?\d{6,10}\b/gi,
    confidence: 0.8,
  },
  // FERPA-protected records context
  {
    type: 'EDUCATION_RECORD',
    pattern: /\b(?:transcript|GPA|grade\s*point|academic\s*record|disciplinary\s*record)\b[^.]{0,60}\b(?:\d\.\d{1,2}|Dean'?s?\s*list|probation|expelled|suspended)\b/gi,
    confidence: 0.8,
  },

  // ── Government / Defense ───────────────────────────────────────────────
  // Classification markings
  {
    type: 'CLASSIFICATION_MARKING',
    pattern: /\b(?:TOP\s+SECRET|SECRET|CONFIDENTIAL)(?:\s*\/\/\s*(?:SCI|NOFORN|REL\s+TO|ORCON|HCS|SI|TK|GAMMA))+\b/g,
    confidence: 0.95,
  },
  // CUI markings
  {
    type: 'CUI_MARKING',
    pattern: /\b(?:CUI|CONTROLLED\s+UNCLASSIFIED|FOUO|FOR\s+OFFICIAL\s+USE\s+ONLY|LAW\s+ENFORCEMENT\s+SENSITIVE)\b/g,
    confidence: 0.85,
  },
  // ITAR/EAR export control
  {
    type: 'EXPORT_CONTROL',
    pattern: /\b(?:ITAR|EAR|ECCN\s*\d[A-E]\d{3}|USML\s*(?:Category|Cat)\.?\s*(?:[IVX]+|\d+))\b/g,
    confidence: 0.85,
  },

  // ── Energy ─────────────────────────────────────────────────────────────
  // Well API numbers (14-digit petroleum well identifiers)
  {
    type: 'WELL_IDENTIFIER',
    pattern: /\bAPI\s*(?:#|number)?[:\s]*\d{2}[-\s]?\d{3}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d{2}\b/gi,
    confidence: 0.85,
  },
  // FERC docket numbers
  {
    type: 'REGULATORY_DOCKET',
    pattern: /\b(?:FERC|NERC|NRC|EPA)\s*(?:Docket|Case|Proceeding)\s*(?:#|No\.?)?\s*[A-Z]{1,3}[-\s]?\d{2,4}[-\s]?\d{2,6}\b/gi,
    confidence: 0.8,
  },

  // ── Real Estate ────────────────────────────────────────────────────────
  // Parcel / APN numbers
  {
    type: 'PARCEL_NUMBER',
    pattern: /\b(?:APN|parcel|tax\s*lot|folio)\s*(?:#|number|no\.?)?[:\s]*\d{3,4}[-.\s]\d{3,4}[-.\s]\d{3,6}\b/gi,
    confidence: 0.75,
  },
  // MLS listing numbers
  {
    type: 'MLS_NUMBER',
    pattern: /\bMLS\s*(?:#|number|listing)?[:\s]*[A-Z]?\d{6,10}\b/gi,
    confidence: 0.75,
  },
];

// ── Anti-evasion: strip zero-width characters and detect base64-encoded PII ──

// ── Brand Dictionary (C-3 from architect audit) ─────────────────────────────
// Single-word brand names that regex patterns miss because they have no
// corporate suffix (Inc, Corp, LLC) and no CamelCase internal caps.
// This is data-driven: adding a brand is a one-line entry, not a regex patch.
// Confidence is lower (0.55) because single words can be ambiguous in some
// contexts ("Notion" = the app vs "notion" = concept). The scorer's context
// layers handle disambiguation.
const KNOWN_BRAND_ORGS: ReadonlySet<string> = new Set([
  // Top SaaS / Tech
  'Salesforce', 'Stripe', 'Shopify', 'Notion', 'Figma', 'Datadog',
  'Twilio', 'Snowflake', 'Palantir', 'Databricks', 'Confluent',
  'Cloudflare', 'Okta', 'Zendesk', 'Atlassian', 'Workday',
  'ServiceNow', 'Splunk', 'Elasticsearch', 'MongoDB', 'Supabase',
  'Vercel', 'Netlify', 'Fastly', 'Akamai', 'Zscaler',
  'CrowdStrike', 'SentinelOne', 'Fortinet', 'Palo',
  // FAANG / Big Tech
  'Google', 'Apple', 'Amazon', 'Microsoft', 'Meta', 'Netflix',
  'Tesla', 'Nvidia', 'Intel', 'AMD', 'Qualcomm', 'Broadcom',
  'Oracle', 'SAP', 'Adobe', 'Autodesk', 'Intuit',
  // Finance
  'Blackstone', 'Citadel', 'Bloomberg', 'Fidelity', 'Schwab',
  'Vanguard', 'Visa', 'Mastercard', 'PayPal', 'Square', 'Robinhood',
  'Coinbase', 'Binance', 'Revolut', 'Plaid', 'Marqeta',
  // Enterprise / Industrial
  'Siemens', 'Honeywell', 'Caterpillar', 'Deere', 'Boeing',
  'Airbus', 'Raytheon', 'Lockheed', 'Northrop',
  // Consulting / Professional Services
  'Deloitte', 'Accenture', 'McKinsey', 'Gartner', 'Forrester',
  // Pharma / Health
  'Pfizer', 'Moderna', 'Merck', 'Novartis', 'Roche',
  'AstraZeneca', 'Amgen', 'Gilead', 'Regeneron', 'Illumina',
  // Consumer
  'Nike', 'Adidas', 'Starbucks', 'Walmart', 'Costco', 'Target',
  'Disney', 'Spotify', 'Uber', 'Airbnb', 'DoorDash', 'Instacart',
  // Fictional test companies (used in Iron Gate testing)
  'Fabrikam', 'Contoso', 'Proseware', 'Northwind', 'Adatum',
]);

/** Detect known single-word brand names as ORGANIZATION entities. */
function detectKnownBrands(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  for (const brand of KNOWN_BRAND_ORGS) {
    // Word-boundary search, case-sensitive (brands are proper nouns)
    const re = new RegExp(`\\b${brand}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      entities.push({
        type: 'ORGANIZATION',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        confidence: 0.55,
        source: 'regex',
      });
    }
  }
  return entities;
}

/** Zero-width and invisible characters that can be inserted to evade detection */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u00AD\u034F\u061C\u180E\u2060\u2061\u2062\u2063\u2064\u206A-\u206F]/g;

/** Detect base64-encoded strings that decode to PII-like content.
 * Returns both the ENCODED_PII marker (for the base64 blob) AND individual
 * entities extracted from the decoded content (SSN, PERSON, EMAIL, etc.)
 * so the scorer treats them with full weight. */
function detectBase64PII(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  // Match base64 strings of reasonable length (24-500 chars)
  const b64re = /(?:[A-Za-z0-9+/]{4}){6,125}={0,2}/g;
  let m: RegExpExecArray | null;
  while ((m = b64re.exec(text)) !== null) {
    // Skip excessively long base64 strings to avoid performance issues
    if (m[0].length > 2000) continue;
    // Skip JWT token segments — JWTs are "header.payload.signature" where each segment
    // is base64url. These are handled by the secret scanner, not base64 PII detection.
    const before = text.substring(Math.max(0, m.index - 1), m.index);
    const after = text.substring(m.index + m[0].length, m.index + m[0].length + 1);
    if (before === '.' || after === '.') continue;
    // Also skip if the match looks like a JWT header (starts with eyJ)
    if (m[0].startsWith('eyJ')) continue;
    try {
      const decoded = atob(m[0]);
      // Only flag if decoded text looks like ASCII text with PII markers
      if (!/^[\x20-\x7E\r\n\t]+$/.test(decoded)) continue;

      let hasPII = false;

      // Check for SSN — extract the actual SSN from decoded text
      const ssnMatch = decoded.match(/\b(\d{3}-\d{2}-\d{4})\b/);
      if (ssnMatch) {
        hasPII = true;
        entities.push({
          type: 'SSN',
          text: m[0], // Keep the base64 blob as the entity text for pseudonymization
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.95,
          source: 'regex',
        });
      }

      // Check for person names
      const nameMatches = decoded.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g);
      if (nameMatches) {
        hasPII = true;
        // Add first name as PERSON entity (maps to the base64 blob position)
        entities.push({
          type: 'PERSON',
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.85,
          source: 'regex',
        });
      }

      // Check for email
      if (/\b[\w.-]+@[\w.-]+\.\w{2,}\b/.test(decoded)) {
        hasPII = true;
        entities.push({
          type: 'EMAIL',
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.9,
          source: 'regex',
        });
      }

      // Check for credit card
      if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(decoded)) {
        hasPII = true;
        entities.push({
          type: 'CREDIT_CARD',
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.9,
          source: 'regex',
        });
      }

      // Always add an ENCODED_PII marker if any PII was found
      if (hasPII) {
        entities.push({
          type: 'ENCODED_PII',
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.95,
          source: 'regex',
        });
      }
    } catch {
      // Not valid base64 — skip
    }
  }
  return entities;
}

/** Run all regex patterns against the given text and return matches. */
function runRegexPatterns(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Map<string, number>();

  for (const { type, pattern, confidence, contextual } of REGEX_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let matchText = match[0];
      let matchStart = match.index;
      let matchEnd = match.index + match[0].length;

      // For contextual patterns, extract just the name part (last capitalized words).
      // Trim first — patterns like pipe-delimited may capture trailing whitespace
      // before a lookahead, which breaks the $ anchor.
      // Also strip trailing punctuation (parentheses, brackets) that wraps org names
      // in financial text like "Top customer (Fabrikam):" — the closing ')' prevents
      // the $ anchor from matching the capitalized name.
      if (contextual) {
        // If the pattern has a capturing group, prefer it — it's the most precise
        // extraction (e.g., parenthetical org pattern captures just the org name).
        if (match[1] && /[A-Z]/.test(match[1])) {
          const capturedName = match[1].trim();
          const capturedStart = match[0].indexOf(capturedName);
          if (capturedStart >= 0) {
            matchText = capturedName;
            matchStart = match.index + capturedStart;
            matchEnd = matchStart + matchText.length;
          } else {
            continue;
          }
        } else {
          const cleaned = match[0].trimEnd().replace(/[)\]}>:;,]+$/, '').trimEnd();
          const nameMatch = cleaned.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/);
          if (nameMatch) {
            const nameStart = match[0].lastIndexOf(nameMatch[0]);
            matchText = nameMatch[0];
            matchStart = match.index + nameStart;
            matchEnd = matchStart + matchText.length;
          } else {
            continue;
          }
        }
      }

      // Bounds check: ensure start/end are within text range
      if (matchStart < 0 || matchEnd > text.length || matchStart >= matchEnd) continue;

      // Suppress PERSON entities that match known non-PII phrases (companies, places, tech terms)
      if (type === 'PERSON' && isKnownNonPII(matchText)) {
        continue;
      }

      // M-12: Suppress PERSON matches where first name is a common English word in non-name context
      if (type === 'PERSON' && isStopwordFalsePositive(text, matchStart, matchText)) {
        continue;
      }

      // M-14: Suppress PHONE_NUMBER matches that are port numbers, version strings, or code patterns
      if (type === 'PHONE_NUMBER' && isCodeLikeFalsePositive(text, matchStart, matchText)) {
        continue;
      }

      // Standalone ROUTING_NUMBER candidates (bare 9-digit) must pass ABA checksum.
      // Routing matches that had a contextual prefix keep capture group 1 as the digits;
      // standalone matches are all 9 digits in match[0].
      if (type === 'ROUTING_NUMBER') {
        const digits = (match[1] ?? match[0]).replace(/\D/g, '');
        if (digits.length === 9 && !isValidABARouting(digits)) continue;
      }

      // VIN post-match validation: a real VIN has BOTH at least one letter
      // and at least one digit — that filters out 17-char accession numbers,
      // hex-like strings, or all-digit identifiers that happen to match the
      // character class. Also must not be purely alphabetic (e.g., a long
      // word like "ABCDEFGHIJKLMNOPQ") — those are not vehicle IDs.
      if (type === 'VIN') {
        const hasLetter = /[A-HJ-NPR-Z]/.test(matchText);
        const hasDigit = /\d/.test(matchText);
        if (!hasLetter || !hasDigit) continue;
      }

      const key = `${matchStart}-${matchEnd}-${type}`;
      if (!seen.has(key)) {
        seen.set(key, entities.length);
        entities.push({
          type,
          text: matchText,
          start: matchStart,
          end: matchEnd,
          confidence,
          source: 'regex',
        });
      } else {
        // If we already have a match at the same position+type, keep the higher confidence one
        const existingIdx = seen.get(key);
        if (existingIdx === undefined) continue;
        if (entities[existingIdx].confidence < confidence) {
          entities[existingIdx] = {
            type,
            text: matchText,
            start: matchStart,
            end: matchEnd,
            confidence,
            source: 'regex',
          };
        }
      }
    }
  }

  // ── Post-detection: reclassify PERSON → ORGANIZATION ──────────────────
  // If a PERSON entity's last word is a known business suffix, it's an org.
  // This catches all patterns systematically instead of patching each regex.
  //
  // Also check the FIRST word — institutional names like "Memorial Sloan",
  // "Mount Sinai", "Johns Hopkins" routinely get caught by broad PERSON
  // regexes ("to Memorial Sloan"). Reclassifying on known institutional
  // prefixes prevents those false-person-positives without weakening the
  // broad PERSON patterns that catch real names.
  const ORG_PREFIX_SET: ReadonlySet<string> = new Set([
    'memorial', 'mount', 'saint', 'st', 'st.', 'johns', "children's",
    'presbyterian', 'cleveland', 'mayo', 'stanford', 'harvard', 'yale',
    'princeton', 'columbia', 'duke', 'mit', 'nyu', 'ucla', 'ucsf',
    'northwestern', 'vanderbilt', 'emory', 'massachusetts', 'general',
  ]);
  for (const entity of entities) {
    if (entity.type !== 'PERSON') continue;
    const words = entity.text.trim().split(/\s+/);
    const lastWord = words[words.length - 1];
    const firstWord = words[0];
    if (lastWord && ORG_SUFFIX_SET.has(lastWord.toLowerCase())) {
      entity.type = 'ORGANIZATION';
    } else if (firstWord && ORG_PREFIX_SET.has(firstWord.toLowerCase())) {
      entity.type = 'ORGANIZATION';
    }
  }

  // Remove duplicate spans where the same text is now both PERSON and ORGANIZATION
  // at the same position (keep ORGANIZATION — it's the higher-signal classification).
  const deduped: DetectedEntity[] = [];
  const spanMap = new Map<string, DetectedEntity>();
  for (const entity of entities) {
    const spanKey = `${entity.start}-${entity.end}`;
    const existing = spanMap.get(spanKey);
    if (!existing) {
      spanMap.set(spanKey, entity);
      deduped.push(entity);
    } else if (existing.type === 'PERSON' && entity.type === 'ORGANIZATION') {
      // Replace PERSON with ORGANIZATION at same span
      const idx = deduped.indexOf(existing);
      if (idx >= 0) deduped[idx] = entity;
      spanMap.set(spanKey, entity);
    } else if (existing.type === entity.type) {
      // Same type at same span — keep higher confidence
      if (entity.confidence > existing.confidence) {
        const idx = deduped.indexOf(existing);
        if (idx >= 0) deduped[idx] = entity;
        spanMap.set(spanKey, entity);
      }
    } else {
      // Different types, neither is PERSON→ORG conflict — keep both
      deduped.push(entity);
    }
  }

  return deduped;
}

/**
 * Run regex-based PII detection as fallback.
 * Returns detected entities with spans and confidence scores.
 *
 * Anti-evasion: strips zero-width characters and checks for base64-encoded PII.
 */
export function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  // Anti-evasion: Unicode NFKC normalization to defeat homoglyph attacks.
  // Converts Cyrillic/Greek/mathematical look-alikes to ASCII equivalents
  // so regex patterns like [A-Z][a-z]+ match regardless of character origin.
  text = text.normalize('NFKC');

  // Anti-evasion: detect base64-encoded PII in the original text
  entities.push(...detectBase64PII(text));

  // Anti-evasion: strip zero-width characters for pattern matching
  // (positions may shift — we still scan against original for non-evasion matches)
  const cleanText = text.replace(ZERO_WIDTH_RE, '');
  if (cleanText !== text && cleanText.length > 0) {
    // Run detection on cleaned text too and merge results
    const cleanEntities = runRegexPatterns(cleanText);
    for (const e of cleanEntities) {
      entities.push({ ...e, confidence: Math.min(e.confidence, 0.75) });
    }
  }

  // Run patterns on original text
  entities.push(...runRegexPatterns(text));

  // ── Brand dictionary scan (C-3 from architect audit) ────────────────────
  // Single-word brands like "Salesforce", "Stripe", "Snowflake" are invisible
  // to regex (no suffix, no CamelCase). A data-driven dictionary separates
  // policy (which brands matter) from mechanism (how we match).
  // Only match when word-boundary delimited to avoid substring false positives.
  entities.push(...detectKnownBrands(text));

  // ── PII-proximity name scan ──────────────────────────────────────────────
  // If the text already has high-value PII (SSN, DOB, phone, email, etc.),
  // scan for standalone two-word capitalized names that regex patterns missed.
  // Rationale: "Felix Drummond" alone is ambiguous, but "Felix Drummond" next to
  // an SSN or DOB is almost certainly a person name.
  const highValuePII = entities.some(e =>
    ['SSN', 'CREDIT_CARD', 'DATE_OF_BIRTH', 'PHONE_NUMBER', 'EMAIL',
     'MEDICAL_RECORD', 'BANK_ACCOUNT', 'DRIVERS_LICENSE', 'PASSPORT_NUMBER',
     'INSURANCE_ID', 'ADDRESS'].includes(e.type)
  );
  if (highValuePII) {
    const existingPersonSpans = new Set(
      entities.filter(e => e.type === 'PERSON').map(e => `${e.start}-${e.end}`)
    );
    const nameRe = /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/g;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(text)) !== null) {
      const spanKey = `${m.index}-${m.index + m[0].length}`;
      if (existingPersonSpans.has(spanKey)) continue;
      if (isKnownNonPII(m[0])) continue;
      // Check it's not an org suffix match
      const words = m[0].split(/\s+/);
      const lastWord = words[words.length - 1];
      if (lastWord && ORG_SUFFIX_SET.has(lastWord.toLowerCase())) continue;
      entities.push({
        type: 'PERSON',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        confidence: 0.6,
        source: 'regex',
      });
    }
  }

  // Suppress PERSON entities that overlap with ORGANIZATION entities at same span
  const orgSpans = new Set(
    entities.filter(e => e.type === 'ORGANIZATION').map(e => `${e.start}-${e.end}`)
  );
  const filtered = entities.filter(e => {
    if (e.type !== 'PERSON') return true;
    return !orgSpans.has(`${e.start}-${e.end}`);
  });

  // Sort by position in text
  filtered.sort((a, b) => a.start - b.start);

  // Remove overlapping entities (keep higher confidence)
  return removeOverlaps(filtered);
}

function removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;

  // Sort by confidence descending, then by span length descending (prefer longer matches).
  // Special case: PERSON beats LOCATION at same span, because names like "David Park",
  // "John Lake", "Sarah Hill" contain geographic words but are people in business context.
  const sorted = [...entities].sort((a, b) => {
    // PERSON vs LOCATION tiebreak: prefer PERSON when both match same text
    if (a.type === 'PERSON' && b.type === 'LOCATION' &&
        a.start === b.start && a.end === b.end) return -1;
    if (b.type === 'PERSON' && a.type === 'LOCATION' &&
        a.start === b.start && a.end === b.end) return 1;
    // PERSON vs ORGANIZATION tiebreak: prefer PERSON when spans overlap.
    // "Client Teresa Finch" matches ORG (via "client" keyword) AND PERSON
    // (via "client + Name Name" pattern). Person names are higher priority
    // when paired with high-value PII like SSN. DEF-010 fix.
    if (a.type === 'PERSON' && b.type === 'ORGANIZATION' &&
        a.start < b.end && a.end > b.start) return -1;
    if (b.type === 'PERSON' && a.type === 'ORGANIZATION' &&
        a.start < b.end && a.end > b.start) return 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.end - b.start) - (a.end - a.start);
  });

  const kept: DetectedEntity[] = [];

  for (const entity of sorted) {
    const overlaps = kept.some(k =>
      entity.start < k.end && entity.end > k.start
    );
    if (!overlaps) {
      kept.push(entity);
    }
  }

  // Return sorted by position for consistent output
  return kept.sort((a, b) => a.start - b.start);
}
