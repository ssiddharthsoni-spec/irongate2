/**
 * Regex-based PII detection as fallback when GLiNER/WebGPU is unavailable.
 * Less accurate than the ML model but works everywhere.
 */

import type { DetectedEntity } from './types';
import { isKnownNonPII } from './known-phrases';

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  contextual?: boolean; // if true, extract only the name portion (last two words)
}

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
  // Names before parenthetical contact info: "Sarah Chen (email..." or "Sarah Chen,"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=\(|\[|<|,\s*(?:who|our|the|is|at|from))/g,
    confidence: 0.8,
  },
  // Names after prepositions: "for Sarah Chen", "from John Smith"
  {
    type: 'PERSON',
    pattern: /\b(?:for|from|to|by|with|about|cc|re|dear|hi|hey|hello|regarding)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.65,
    contextual: true,
  },
  // ── Organization Names ────────────────────────────────────────────────
  // Multi-word capitalized names with common org suffixes
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|Corporation|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Center|Centre|University|College|Bank|Insurance|Industries|Enterprises|Holdings|Capital|Trust|Fund|Technologies|Tech|Solutions|Services|Consulting|Management|Investments|Advisors|Advisory|Labs|Laboratories|Media|Energy|Resources|Dynamics|Systems|International|Global|Worldwide|Agency|Commission|Authority|Bureau|Institute|Council|Society|Government|Aerospace|Aviation|Defense|Pharma|Pharmaceuticals|Mining|Logistics|Motors|Financial|Securities|Exchange|Telecom|Communications|Networks|Electric|Petroleum|Oil|Gas)\b\.?/g,
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
    pattern: /\b(?:company|firm|corporation|organization|entity|employer|contractor|vendor|supplier|client|subsidiary|parent\s+company|activist(?:\s+fund)?|investor|fund|bank|lender)\s*(?::|called|named|is|,)?\s+[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|&|No\.\s*\d+|of|the|and))+\b/gi,
    confidence: 0.75,
    contextual: true,
  },
  // Organizations after contextual keywords (single-word names like "Blackstone", "ModaGlobal")
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:company|firm|corporation|organization|entity|employer|contractor|vendor|supplier|client|subsidiary|parent\s+company|activist(?:\s+fund)?|investor|fund|bank|lender|PE\s+firm|PE\s+owner|backed\s+by|acquired\s+by|owned\s+by)\s*(?::|called|named|is|,)?\s+([A-Z][a-zA-Z]{2,})\b/gi,
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
  // Known financial entity patterns: "Name + Capital/Partners/Asset Management"
  // Also handles single-word names before role descriptors
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?:,\s*|\s+)(?:is\s+)?(?:considering|planning|executing|proposing|demanding|seeking|offering)\b/gi,
    confidence: 0.5,
    contextual: true,
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
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
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
  // ── Monetary Amounts ──────────────────────────────────────────────────
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g,
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
    pattern: /\b(?:reduc\w+|cut\w*|decreas\w+|increas\w+|grow\w*|rais\w+|lower\w*|slash\w*|trim\w*|shrink\w*|expand\w*)\b[^.]{0,30}\b(\d{1,3}(?:\.\d{1,2})?%)/gi,
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
  // JWT tokens
  {
    type: 'AUTH_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    confidence: 0.85,
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

/** Zero-width and invisible characters that can be inserted to evade detection */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u00AD\u034F\u061C\u180E\u2060\u2061\u2062\u2063\u2064\u206A-\u206F]/g;

/** Detect base64-encoded strings that decode to PII-like content */
function detectBase64PII(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  // Match base64 strings of reasonable length (24-500 chars)
  const b64re = /(?:[A-Za-z0-9+/]{4}){6,125}={0,2}/g;
  let m: RegExpExecArray | null;
  while ((m = b64re.exec(text)) !== null) {
    try {
      const decoded = atob(m[0]);
      // Only flag if decoded text looks like ASCII text with PII markers
      if (!/^[\x20-\x7E\r\n\t]+$/.test(decoded)) continue;
      // Check if decoded text contains common PII patterns
      if (/\b\d{3}-\d{2}-\d{4}\b/.test(decoded) ||                   // SSN
          /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(decoded) ||           // Names
          /\b[\w.-]+@[\w.-]+\.\w{2,}\b/.test(decoded) ||              // Email
          /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(decoded)) { // CC
        entities.push({
          type: 'ENCODED_PII',
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          confidence: 0.8,
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

      // For contextual patterns, extract just the name part (last two capitalized words)
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

      // Suppress PERSON entities that match known non-PII phrases (companies, places, tech terms)
      if (type === 'PERSON' && isKnownNonPII(matchText)) {
        continue;
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
        const existingIdx = seen.get(key)!;
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

  return entities;
}

/**
 * Run regex-based PII detection as fallback.
 * Returns detected entities with spans and confidence scores.
 *
 * Anti-evasion: strips zero-width characters and checks for base64-encoded PII.
 */
export function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

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

  // Sort by confidence descending, then by span length descending (prefer longer matches)
  const sorted = [...entities].sort((a, b) => {
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
