/**
 * Entity Detection — Regex Patterns & Secret Scanner
 *
 * Pure-function entity detection extracted from main-world.ts.
 * Includes regex pattern matching, overlap removal, secret scanning,
 * and natural language filtering.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DetectedEntity {
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

interface SecretPattern {
  type: string;
  patterns: RegExp[];
  confidence: number;
}

// ─── CamelCase Allowlist ────────────────────────────────────────────────────
// Known products/tech terms that are NOT real organizations.
// Prevents false-positive ORGANIZATION detection and pseudonymization flicker.

const CAMELCASE_ALLOWLIST = new Set([
  // Iron Gate itself
  'irongate', 'irongateai',
  // AI tools the extension monitors
  'chatgpt', 'openai', 'deepseek', 'copilot', 'huggingface', 'huggingchat',
  'gemini', 'claude', 'anthropic', 'perplexity', 'phind', 'mistral',
  // Common tech / product names
  'javascript', 'typescript', 'postgresql', 'mongodb', 'mysql', 'graphql',
  'github', 'gitlab', 'bitbucket', 'stackoverflow', 'youtube', 'linkedin',
  'facebook', 'instagram', 'tiktok', 'snapchat', 'whatsapp', 'telegram',
  'powerpoint', 'powerbi', 'onenote', 'onedrive', 'sharepoint', 'outlook',
  'webpack', 'nextjs', 'nodejs', 'expressjs', 'reactjs', 'vuejs', 'angularjs',
  'tailwindcss', 'tensorflow', 'pytorch', 'jupyter', 'colab',
  'codecademy', 'freecodecamp', 'leetcode', 'hackerrank',
  'macos', 'iphone', 'ipad', 'macbook', 'airpods', 'appstore', 'playstore',
  'dockerfile', 'kubernetes', 'localhost', 'vercel', 'netlify', 'cloudflare',
  'datadog', 'pagerduty', 'elasticsearch', 'logstash', 'opensearch',
  'redis', 'dynamodb', 'couchdb', 'firebase', 'supabase', 'cockroachdb',
  'chatbot', 'midjourney', 'stablediffusion',
  // Enterprise / business software (common false positives in enterprise prompts)
  'salesforce', 'hubspot', 'marketo', 'workday', 'servicenow', 'zendesk',
  'jira', 'confluence', 'asana', 'monday', 'clickup', 'basecamp',
  'docusign', 'adobesign', 'dropbox', 'slack', 'microsoft', 'google',
  'quickbooks', 'netsuite', 'sap', 'oracle', 'snowflake', 'databricks',
  'tableau', 'looker', 'mixpanel', 'amplitude', 'segment', 'twilio',
  // Infrastructure / DevOps terms
  'terraform', 'ansible', 'jenkins', 'circleci', 'travisci', 'argocd',
  'prometheus', 'grafana', 'kibana', 'splunk', 'newrelic', 'sentry',
  'heroku', 'digitalocean', 'linode', 'vultr', 'hetzner',
  'nginx', 'apache', 'caddy', 'envoy', 'istio', 'consul', 'nomad',
  // Programming languages / frameworks
  'python', 'golang', 'kotlin', 'swift', 'flutter', 'django', 'fastapi',
  'springboot', 'dotnet', 'blazor', 'svelte', 'nuxtjs', 'gatsby', 'remix',
  // Finance / legal terms that look like org names
  'bloomberg', 'reuters', 'moody', 'nasdaq', 'finra',
]);

// ─── Regex Patterns ─────────────────────────────────────────────────────────

const REGEX_PATTERNS: RegexPattern[] = [
  // Person Names — titled (Dr. John Smith, Mr. Jane Doe)
  {
    type: 'PERSON',
    pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g,
    confidence: 0.9,
  },
  // Person Names — contextual (employee Sarah Chen, patient Maria Gonzalez)
  {
    type: 'PERSON',
    pattern: /\b(?:employee|patient|client|manager|contact|attending|plaintiff|defendant|counsel|attorney|doctor|nurse|therapist|spouse|wife|husband|CEO|CFO|CTO|COO|CMO|VP|director|analyst|engineer)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi,
    confidence: 0.85,
    contextual: true,
  },
  // Person Names — before parenthetical contact info: "Sarah Chen (email..." or "Sarah Chen,"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=\(|\[|<|,\s*(?:who|our|the|is|at|from))/g,
    confidence: 0.8,
  },
  // Person Names — after "for" / "from" / "to" / "by" / "with" / "about" / "cc" / "re"
  {
    type: 'PERSON',
    pattern: /\b(?:for|from|to|by|with|about|cc|re|dear|hi|hey|hello|regarding)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.75,
    contextual: true,
  },
  // Organization Names
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Center|University|College|Bank|Insurance)\b\.?/g,
    confidence: 0.8,
  },
  // Employee / Record IDs
  {
    type: 'EMPLOYEE_ID',
    pattern: /\b(?:EMP|HR|FMLA|RSU|REQ|WO|PO|INV)[-#]?\d{4,8}\b/g,
    confidence: 0.85,
  },
  // Generic reference numbers with prefix labels
  {
    type: 'RECORD_ID',
    pattern: /\b(?:#(?:RSU|HR|FMLA|EMP|REQ|INV|PO|WO|TKT)[-\u2011]?\d{4,10})\b/g,
    confidence: 0.8,
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
  {
    type: 'SSN',
    pattern: /(?<=(?:ssn|social\s*security(?:\s*(?:number|num|no|#))?|ss#)\s*(?:is|:|=|#)?\s*)\d{9}(?!\d)/gi,
    confidence: 0.95,
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
  // Dates
  {
    type: 'DATE',
    pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g,
    confidence: 0.7,
  },
  // Monetary Amounts
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
  // Matter / Case Numbers
  {
    type: 'MATTER_NUMBER',
    pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi,
    confidence: 0.75,
  },

  // ─── Business Context Detection (prevents MNPI leakage) ─────────────────

  // Stock tickers with exchange prefix (NYSE: NVTK, NASDAQ: AAPL)
  {
    type: 'TICKER',
    pattern: /\b(?:NYSE|NASDAQ|AMEX|LSE|TSX|NIKKEI|FTSE|DAX|CAC)\s*:\s*[A-Z]{1,5}\b/g,
    confidence: 0.95,
  },
  // Cashtag tickers ($AAPL, $NVTK)
  {
    type: 'TICKER',
    pattern: /\$[A-Z]{2,5}\b/g,
    confidence: 0.8,
  },

  // Percentages — critical for financial MNPI (18%, 14.2%, etc.)
  {
    type: 'PERCENTAGE',
    pattern: /\b\d{1,3}(?:\.\d{1,2})?%/g,
    confidence: 0.8,
  },

  // Written dates (March 5th, January 2024, December 15, 2025)
  {
    type: 'DATE',
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
    confidence: 0.75,
  },

  // Fiscal quarters and periods (Q1, Q4 2024, FY2024, H1)
  {
    type: 'FISCAL_PERIOD',
    pattern: /\b(?:[QH][1-4]|FY)\s*(?:'?\d{2,4})?\b/g,
    confidence: 0.75,
  },

  // Project / Operation code names (Project Horizon, Operation Nighthawk)
  {
    type: 'PROJECT_NAME',
    pattern: /\b(?:Project|Operation|Initiative|Program|Codename)\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g,
    confidence: 0.9,
  },

  // Organization names — broader suffixes (Elliot Management, Meridian Capital Partners)
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Management|Capital|Partners|Holdings|Securities|Advisors|Consulting|Analytics|Investments|Solutions|Technologies|Financial|Ventures|Research|Services|Labs|Systems|Industries|Dynamics|Media|Health|Pharma|Energy|Realty|Properties)\b/g,
    confidence: 0.8,
  },

  // CamelCase company names (NovaTech, DeepSeek, OpenAI, DataDog)
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]{1,10}[A-Z][a-zA-Z]{1,10}\b/g,
    confidence: 0.7,
  },

  // Contextual organization (at/firm/company/investor + Proper Noun, 1-3 words)
  // No 'i' flag — trigger words must be lowercase, proper nouns must be capitalized
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:at|firm|company|investor|partner|vendor|supplier|competitor|acquirer|subsidiary|conglomerate|startup|unicorn|acquired|acquiring|target)\s*[,:]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
    confidence: 0.7,
    contextual: true,
  },

  // Contextual organization — business activity (discussions with X, deal with X)
  // No 'i' flag — prevents matching lowercase words as proper nouns
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:discussions?\s+with|partnership\s+with|deal\s+with|investment\s+(?:in|from|by)|acquired\s+by|merger\s+with|contract\s+with|agreement\s+with|lawsuit\s+(?:against|from)|counsel\s+at)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
    confidence: 0.75,
    contextual: true,
  },

  // Headcount / workforce numbers (340 headcount, 500 employees, 200 layoffs)
  {
    type: 'HEADCOUNT',
    pattern: /\b\d{2,5}\s*(?:headcount|employees?|people|workers|staff|positions|roles|FTEs?|hires?|cuts?|layoffs?|terminations?)\b/gi,
    confidence: 0.8,
  },

  // Legal section references (Section 13D, Rule 10b-5, Regulation S-K)
  {
    type: 'LEGAL_REFERENCE',
    pattern: /\b(?:Section|Rule|Regulation|Article|Clause)\s+\d+[A-Za-z]?(?:[-]\d+)?\b/g,
    confidence: 0.75,
  },

  // Valuation / market cap amounts without $ sign (3.1B market cap, 1.67B valuation)
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\b\d{1,4}(?:\.\d{1,2})?\s*[BMK]\s*(?:valuation|market\s*cap|revenue|ARR|MRR|EBITDA|profit|loss|deal|round)\b/gi,
    confidence: 0.8,
  },
];

// ─── Secret Scanner Patterns ────────────────────────────────────────────────

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'API_KEY',
    patterns: [
      /\bsk-[a-zA-Z0-9]{20,}\b/g,
      /\bsk_live_[a-zA-Z0-9]{24,}\b/g,
      /\bsk-ant-[a-zA-Z0-9\-]{20,}\b/g,
      /\bghp_[a-zA-Z0-9]{36}\b/g,
      /\bgho_[a-zA-Z0-9]{36}\b/g,
      /\bghs_[a-zA-Z0-9]{36}\b/g,
      /\bxoxb-[0-9]+-[a-zA-Z0-9]+\b/g,
      /\bxoxp-[0-9]+-[a-zA-Z0-9]+\b/g,
      /\bSG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}\b/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'AWS_CREDENTIAL',
    patterns: [
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bASIA[0-9A-Z]{16}\b/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'GCP_CREDENTIAL',
    patterns: [
      /\bAIza[0-9A-Za-z_-]{35}\b/g,
    ],
    confidence: 0.9,
  },
  {
    type: 'DATABASE_URI',
    patterns: [
      /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^\s"']+/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'AUTH_TOKEN',
    patterns: [
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    ],
    confidence: 0.9,
  },
  {
    type: 'PRIVATE_KEY',
    patterns: [
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    ],
    confidence: 0.99,
  },
];

// ─── Natural Language Filter ────────────────────────────────────────────────

/**
 * Determines whether extracted text looks like natural language (user content)
 * vs protocol/control data (Socket.IO frames, JSON metadata, heartbeats).
 * Used to filter WS frame extraction before running entity detection.
 */
export function isNaturalLanguage(text: string): boolean {
  const trimmed = text.trim();

  // Too short to be meaningful user content
  if (trimmed.length < 15) return false;

  // Pure numeric / hex — likely protocol frame IDs or timestamps
  if (/^[\d\s.,:;%\-+#/\\]+$/.test(trimmed)) return false;

  // JSON structure — protocol metadata, not user text
  if (/^\s*[\[{]/.test(trimmed) && /[\]}]\s*$/.test(trimmed)) return false;

  // Socket.IO control frames: digits followed by optional JSON
  if (/^\d{1,3}(\[|$)/.test(trimmed)) return false;

  // Must contain at least one space (natural text has word boundaries)
  // Exception: very short single-word queries are fine if they look like words
  if (!trimmed.includes(' ') && trimmed.length < 30) return false;

  // Count ratio of alphanumeric + space chars vs total — protocol data has lots of punctuation/special chars
  const alphaSpaceCount = (trimmed.match(/[a-zA-Z\s]/g) || []).length;
  const ratio = alphaSpaceCount / trimmed.length;
  if (ratio < 0.4) return false;

  return true;
}

// ─── Detection Functions ────────────────────────────────────────────────────

export function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, confidence, contextual } of REGEX_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let matchCount = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) { pattern.lastIndex++; continue; }
      if (++matchCount > 500) break;
      let matchText = match[0];
      let matchStart = match.index;
      let matchEnd = match.index + match[0].length;

      if (contextual) {
        // Extract the proper noun portion (1-3 capitalized words at end of match)
        const nameMatch = match[0].match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/);
        if (nameMatch) {
          const nameStart = match[0].lastIndexOf(nameMatch[0]);
          matchText = nameMatch[0];
          matchStart = match.index + nameStart;
          matchEnd = matchStart + matchText.length;
        } else {
          // No proper noun found — likely a false positive (e.g., "for the emergency")
          continue;
        }
      }

      // Skip known product/tech names that the CamelCase pattern over-matches
      if (type === 'ORGANIZATION' && CAMELCASE_ALLOWLIST.has(matchText.toLowerCase())) {
        continue;
      }

      const key = `${matchStart}-${matchEnd}-${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          type,
          text: matchText,
          start: matchStart,
          end: matchEnd,
          confidence,
          source: 'regex',
        });
      }
    }
  }

  entities.sort((a, b) => a.start - b.start);
  return removeOverlaps(entities);
}

function removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;
  if (!entities[0]) return [];
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

export function scanForSecrets(text: string): DetectedEntity[] {
  const secrets: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, patterns, confidence } of SECRET_PATTERNS) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      let matchCount = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match[0].length === 0) { pattern.lastIndex++; continue; }
        if (++matchCount > 200) break;
        const key = `${match.index}-${match.index + match[0].length}-${type}`;
        if (!seen.has(key)) {
          seen.add(key);
          secrets.push({
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
  }

  return secrets;
}
