// ==========================================
// Iron Gate Phase 2 — Pseudonymization Engine
// ==========================================

import type { DetectedEntity, EntityType } from '@iron-gate/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PseudonymMap {
  sessionId: string;
  firmId: string;
  mappings: Map<string, PseudonymEntry>;
  createdAt: Date;
  expiresAt: Date;
}

export interface PseudonymEntry {
  original: string;
  originalHash: string; // SHA-256 of original
  pseudonym: string;
  entityType: EntityType;
}

export interface PseudonymizeResult {
  maskedText: string;
  entitiesReplaced: number;
  map: PseudonymMap;
}

// ---------------------------------------------------------------------------
// Fake-value pools
// ---------------------------------------------------------------------------

const FAKE_PERSONS: string[] = [
  'James Mitchell', 'Sarah Chen', 'Robert Alvarez', 'Emily Nakamura',
  'David Kowalski', 'Maria Rossi', 'Michael Okonkwo', 'Lisa Johansson',
  'Thomas Brennan', 'Amanda Singh', 'William Park', 'Rachel Moreau',
  'Christopher Tanaka', 'Jennifer O\'Brien', 'Daniel Ivanov', 'Laura Schmidt',
  'Andrew Petrov', 'Stephanie Kim', 'Matthew Dubois', 'Nicole Andersen',
  'Brian Herrera', 'Karen Yamamoto', 'Patrick Sullivan', 'Megan Becker',
  'Jonathan Larsen', 'Allison Fernandez', 'Steven Ito', 'Rebecca Malone',
  'Gregory Novak', 'Catherine Lindqvist',
];

const FAKE_ORGANIZATIONS: string[] = [
  'Meridian Holdings', 'Atlas Group', 'Pinnacle Advisors', 'Summit Capital',
  'Horizon Legal Partners', 'Apex Dynamics', 'Cornerstone Ventures',
  'Landmark Financial', 'Silver Creek Industries', 'Ironwood Consulting',
  'Blue Harbor Technologies', 'Granite Peak Solutions', 'Compass Rose Partners',
  'Keystone Analytics', 'Northstar Global', 'Pacific Ridge Corp',
  'Sterling Bridge LLC', 'Westfield Associates', 'Crescent Bay Holdings',
  'Redwood Capital Group',
];

const FAKE_LOCATIONS: string[] = [
  '742 Evergreen Terrace, Springfield, IL 62704',
  '1234 Maple Drive, Suite 300, Portland, OR 97201',
  '567 Oak Boulevard, Austin, TX 78701',
  '890 Pine Street, Denver, CO 80202',
  '2345 Elm Avenue, Boston, MA 02108',
  '678 Cedar Lane, Seattle, WA 98101',
  '1011 Birch Road, Nashville, TN 37201',
  '1213 Walnut Court, Miami, FL 33101',
  '1415 Spruce Way, Chicago, IL 60601',
  '1617 Aspen Circle, San Francisco, CA 94102',
  '1819 Willow Path, Phoenix, AZ 85001',
  '2021 Chestnut Drive, Philadelphia, PA 19101',
  '2223 Poplar Street, Atlanta, GA 30301',
  '2425 Magnolia Blvd, Dallas, TX 75201',
  '2627 Cypress Lane, Minneapolis, MN 55401',
];

const FAKE_DEAL_CODENAMES: string[] = [
  'Project Falcon', 'Project Orion', 'Project Nexus', 'Project Horizon',
  'Project Zenith', 'Project Apex', 'Project Titan', 'Project Nova',
  'Project Eclipse', 'Project Vanguard', 'Project Aurora', 'Project Summit',
  'Project Atlas', 'Project Pinnacle', 'Project Compass',
];

const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// SHA-256 helper (uses crypto.subtle, available in Bun)
// ---------------------------------------------------------------------------

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Synchronous SHA-256 using Node crypto (works in Bun too)
function sha256Sync(input: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// Deterministic seeded random helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic index from a string hash so the same original value
 * always picks the same fake from a given pool within the same session.
 */
function pickFromPool<T>(pool: T[], hash: string): T {
  // Use the first 8 hex chars of the hash as a 32-bit seed
  const seed = parseInt(hash.slice(0, 8), 16);
  return pool[seed % pool.length];
}

/**
 * Generate a deterministic "random" number in [0, 1) from a hash string,
 * using a different slice than pickFromPool to avoid correlation.
 */
function deterministicRandom(hash: string): number {
  const seed = parseInt(hash.slice(8, 16), 16);
  return seed / 0xffffffff;
}

// ---------------------------------------------------------------------------
// Fake value generators (all deterministic on hash)
// ---------------------------------------------------------------------------

function generateFakePerson(hash: string): string {
  return pickFromPool(FAKE_PERSONS, hash);
}

function generateFakeOrganization(hash: string): string {
  return pickFromPool(FAKE_ORGANIZATIONS, hash);
}

function generateFakeEmail(hash: string): string {
  const person = generateFakePerson(hash);
  const [first, last] = person.replace(/'/g, '').toLowerCase().split(' ');
  const domains = ['example.com', 'example.org', 'test.example.net', 'mail.example.com'];
  const domain = pickFromPool(domains, hash.slice(4));
  return `${first}.${last}@${domain}`;
}

function generateFakePhone(hash: string): string {
  const areaDigits = (parseInt(hash.slice(0, 3), 16) % 800) + 200; // 200-999
  const mid = (parseInt(hash.slice(3, 6), 16) % 900) + 100;       // 100-999
  const last = (parseInt(hash.slice(6, 10), 16) % 9000) + 1000;   // 1000-9999
  return `(${areaDigits}) ${mid}-${last}`;
}

function generateFakeSSN(hash: string): string {
  const a = (parseInt(hash.slice(0, 3), 16) % 899) + 100;  // 100-998
  const b = (parseInt(hash.slice(3, 5), 16) % 90) + 10;    // 10-99
  const c = (parseInt(hash.slice(5, 9), 16) % 9000) + 1000; // 1000-9999
  return `${a}-${b}-${c}`;
}

function generateFakeCreditCard(hash: string): string {
  // Generate a 16-digit number that looks like a Visa card
  let card = '4';
  for (let i = 1; i < 16; i++) {
    card += (parseInt(hash.slice(i % hash.length, (i % hash.length) + 2), 16) % 10).toString();
  }
  // Format with dashes
  return `${card.slice(0, 4)}-${card.slice(4, 8)}-${card.slice(8, 12)}-${card.slice(12, 16)}`;
}

function generateFakeMonetaryAmount(original: string, hash: string): string {
  // Extract numeric value from original, jitter by +/-20%
  const numericMatch = original.replace(/[^0-9.]/g, '');
  const value = parseFloat(numericMatch);

  if (isNaN(value) || value === 0) {
    return '$1,234.56';
  }

  const rnd = deterministicRandom(hash);
  // jitter: scale between 0.8 and 1.2
  const jitter = 0.8 + rnd * 0.4;
  const newValue = value * jitter;

  // Detect if original had a currency symbol/prefix
  const currencyMatch = original.match(/^[^\d]*/)
  const prefix = currencyMatch ? currencyMatch[0].trim() : '$';

  // Format with commas and 2 decimal places
  const formatted = newValue
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return prefix ? `${prefix}${formatted}` : `$${formatted}`;
}

function generateFakeLocation(hash: string): string {
  return pickFromPool(FAKE_LOCATIONS, hash);
}

function generateFakeMatterNumber(hash: string): string {
  const prefix = (parseInt(hash.slice(0, 4), 16) % 9000) + 1000;
  const suffix = (parseInt(hash.slice(4, 8), 16) % 900) + 100;
  return `M-${prefix}-${suffix}`;
}

function generateFakeClientMatterPair(hash: string): string {
  const client = generateFakeOrganization(hash);
  const matterNum = generateFakeMatterNumber(hash.slice(8));
  return `${client} / ${matterNum}`;
}

function generateFakeDealCodename(hash: string): string {
  return pickFromPool(FAKE_DEAL_CODENAMES, hash);
}

function generateFakeAccountNumber(hash: string): string {
  let acct = '';
  for (let i = 0; i < 10; i++) {
    acct += (parseInt(hash.slice(i, i + 2), 16) % 10).toString();
  }
  return acct;
}

function generateFakeIPAddress(hash: string): string {
  // RFC 5737 documentation range: 192.0.2.0/24
  const lastOctet = (parseInt(hash.slice(0, 4), 16) % 254) + 1; // 1-254
  return `192.0.2.${lastOctet}`;
}

// ---------------------------------------------------------------------------
// Entity classification: identifying vs computational
// ---------------------------------------------------------------------------

/**
 * Entity types that ALWAYS reveal identity — always pseudonymized regardless of context.
 */
const ALWAYS_IDENTIFYING_TYPES: Set<string> = new Set([
  'PERSON', 'ORGANIZATION', 'EMAIL', 'PHONE_NUMBER', 'SSN',
  'CREDIT_CARD', 'ACCOUNT_NUMBER', 'PASSPORT_NUMBER',
  'DRIVERS_LICENSE', 'IP_ADDRESS', 'LOCATION', 'MEDICAL_RECORD',
]);

// ---------------------------------------------------------------------------
// Holistic Context Intelligence
// ---------------------------------------------------------------------------
// Instead of keyword-matching near each entity, we analyze the WHOLE document
// like a human would:
//
//   1. What kind of document is this? (legal memo, casual question, etc.)
//   2. Are there real people identified? (names + SSNs = real case)
//   3. Are numbers tied to those people? (her salary, his account balance)
//   4. Does the user need computation on those numbers?
//
// The COMBINATION determines the strategy:
//   - Generic math, no people → keep numbers real, any route
//   - Real people's numbers, no math needed → pseudonymize, cloud route
//   - Real people's numbers, math needed → keep real, PRIVATE LLM route
// ---------------------------------------------------------------------------

export interface ExecutiveFlag {
  category: string;
  label: string;
  action: 'private_llm' | 'pseudonymize';
  reason: string;
  hits: number;
}

export interface ContextAnalysis {
  /** Is this a confidential document overall? */
  isConfidentialDocument: boolean;
  /** Are there identified real people in the prompt? */
  hasIdentifiedPersons: boolean;
  /** Does the user want the LLM to do math/computation? */
  needsComputation: boolean;
  /** Strategy for handling values */
  valueStrategy: 'pseudonymize' | 'keep_real' | 'private_llm';
  /** Human-readable reasoning */
  reasoning: string;
  /** Detected industry vertical (null if no strong signal) */
  detectedIndustry: string | null;
  /** Executive Lens flags — semantic IP risks detected by CEO/GC lens */
  executiveFlags: ExecutiveFlag[];
  /** Role that reviewed (e.g., "CEO + VP R&D") */
  executiveRole: string | null;
  /** Highest-priority executive action */
  executiveAction: 'private_llm' | 'pseudonymize' | null;
}

// ---------------------------------------------------------------------------
// EXECUTIVE LENS — "Would the CEO + General Counsel approve sharing this?"
// ---------------------------------------------------------------------------
// For each industry, we define what content the CEO and GC would NEVER allow
// to leave the building. This goes beyond PII — it covers trade secrets,
// strategies, formulas, and competitive intelligence.
// ---------------------------------------------------------------------------
interface ExecutiveLensRule {
  category: string;
  label: string;
  patterns: RegExp[];
  action: 'private_llm' | 'pseudonymize';
  reason: string;
}

interface ExecutiveLensEntry {
  role: string;
  neverShare: ExecutiveLensRule[];
  okToShare: string[];
}

const EXECUTIVE_LENS: Record<string, ExecutiveLensEntry> = {
  manufacturing: {
    role: 'CEO + VP R&D',
    neverShare: [
      { category: 'PROPRIETARY_FORMULA', label: 'Proprietary Formula / Recipe',
        patterns: [/\d+(\.\d+)?%\s*(?:sodium|potassium|sulfate|betaine|acid|hydroxide|surfactant|glycol|silicone|preservative|oxide|chloride|limonene|phenoxyethanol|isothiazolinone|laureth|cocamido)/gi,
                   /\bpH\s*(?:of\s*)?\d+(\.\d+)?/gi,
                   /\bheat(?:ed)?\s+to\s+\d+\s*°?[CF]?\b/gi,
                   /\bformul(?:a|ation)\b/gi,
                   /\bproprietary\s+(?:blend|formula|process|recipe|formulation)\b/gi,
                   /\bq\.?\s*s\.?\s*to\s*100\s*%/gi,
                   /\bviscosity\s*(?:\(|target|of)?\s*\d/gi],
        action: 'private_llm', reason: 'Trade secret — formulation IP cannot be sent externally' },
      { category: 'MANUFACTURING_PROCESS', label: 'Manufacturing Process Parameters',
        patterns: [/\b(?:reactor|batch|mixing|curing|distill|extrusion|ferment)\s+(?:temp|temperature|time|speed|size|pressure)/gi,
                   /\b\d+\s*(?:RPM|rpm|psi|bar|cP|mPa)\b/g,
                   /\b\d+\s*°[CF]\b/g,
                   /\byield[:\s]+\d+(\.\d+)?%/gi,
                   /\bbatch\s+(?:size|cycle|process)\b/gi],
        action: 'private_llm', reason: 'Proprietary manufacturing process — competitive advantage' },
      { category: 'SUPPLIER_TERMS', label: 'Supplier Pricing / Terms',
        patterns: [/\bsupplier[:\s]+[A-Z]/gi,
                   /\$\d+(\.\d+)?\/(?:kg|lb|ton|liter|gallon|unit)\b/gi,
                   /\bcost\s+per\s+(?:unit|kg|lb|ton|liter|gallon|batch)\b/gi,
                   /\braw\s+material\s+cost/gi],
        action: 'pseudonymize', reason: 'Supplier relationships are competitively sensitive' },
    ],
    okToShare: ['general chemistry', 'safety data sheets', 'published regulations'],
  },
  legal: {
    role: 'General Counsel',
    neverShare: [
      { category: 'LEGAL_STRATEGY', label: 'Litigation / Negotiation Strategy',
        patterns: [/\b(?:our|we|firm'?s?)\s+(?:strategy|position|argument|approach|theory)\b/gi,
                   /\bwe\s+(?:plan|intend|will|should)\s+to\s+(?:argue|file|settle|motion|depose)\b/gi,
                   /\bsettlement\s+(?:demand|offer|position|range|authority)\b/gi,
                   /\bprepared\s+to\s+(?:offer|settle|accept)\b/gi],
        action: 'private_llm', reason: 'Legal strategy is work product — privileged, cannot be pseudonymized' },
      { category: 'CLIENT_MATTER', label: 'Client-Matter Data',
        patterns: [/\battorney[- ]client\s+privilege\b/gi,
                   /\bprivileged\s+and\s+confidential\b/gi,
                   /\bwork\s+product\b/gi],
        action: 'private_llm', reason: 'Attorney-client privilege — entire communication must stay on-prem' },
    ],
    okToShare: ['case law citations', 'statutes', 'general legal principles'],
  },
  healthcare: {
    role: 'Chief Medical Officer + Privacy Officer',
    neverShare: [
      { category: 'PATIENT_DATA', label: 'Protected Health Information',
        patterns: [/\bpatient\b.*\b(?:diagnos|condition|medication|treatment|procedure)\b/gi,
                   /\bprotected\s+health\b/gi,
                   /\bHIPAA\b/g],
        action: 'pseudonymize', reason: 'HIPAA: PHI must be de-identified before external transmission' },
      { category: 'CLINICAL_IP', label: 'Unpublished Clinical / Drug Data',
        patterns: [/\bproprietary\s+(?:drug|compound|therapy|formulation|protocol)\b/gi,
                   /\bclinical\s+trial\s+(?:data|results|phase)\b/gi,
                   /\bunpublished\s+(?:data|findings|results|study)\b/gi],
        action: 'private_llm', reason: 'Pre-publication clinical IP — premature disclosure could void patent rights' },
    ],
    okToShare: ['published clinical guidelines', 'FDA-approved drug info', 'general medical knowledge'],
  },
  finance: {
    role: 'Chief Compliance Officer',
    neverShare: [
      { category: 'MNPI', label: 'Material Non-Public Information',
        patterns: [/\b(?:non-public|unreleased|pre-announcement|insider)\b/gi,
                   /\bacquisition\s+target\b/gi,
                   /\bproject\s+[A-Z][a-z]+\b/g,
                   /\bunder\s+NDA\b/gi,
                   /\bcap\s+table\b/gi,
                   /\bwire\s+(?:instructions|transfer)\b/gi],
        action: 'private_llm', reason: 'MNPI — deal structure itself is material, pseudonymizing alone insufficient' },
      { category: 'CLIENT_PORTFOLIO', label: 'Client Portfolio / Positions',
        patterns: [/\b\d[\d,]*\s+shares?\s+@\s*\$/gi,
                   /\bface\s+value\b/gi,
                   /\bcurrent\s+positions?\b/gi,
                   /\btarget\s+allocation\b/gi],
        action: 'private_llm', reason: 'Portfolio positions reveal trading strategy — pattern itself is identifiable' },
    ],
    okToShare: ['published market data', 'SEC filings', 'general financial concepts'],
  },
  technology: {
    role: 'CTO + CISO',
    neverShare: [
      { category: 'CREDENTIALS', label: 'API Keys / Secrets / Credentials',
        patterns: [/\b(?:sk_|api_key_|svc_key_|secret_|token_|key_)[A-Za-z0-9_]{8,}/g,
                   /\bpassword\s*[:=]\s*['"][^'"]+['"]/gi,
                   /['"][A-Za-z0-9+/]{32,}['"]/g],
        action: 'pseudonymize', reason: 'Credentials — immediate security risk if exposed' },
      { category: 'INTERNAL_INFRA', label: 'Internal Infrastructure',
        patterns: [/\b\w+\.(?:internal|corp|local)\b/g,
                   /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
                   /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g],
        action: 'pseudonymize', reason: 'Internal network topology — security risk' },
    ],
    okToShare: ['open-source patterns', 'general algorithms', 'public documentation'],
  },
  consulting: {
    role: 'Managing Partner + Chief Risk Officer',
    neverShare: [
      { category: 'CLIENT_STRATEGY', label: 'Client Strategic Recommendations',
        patterns: [/\b(?:recommend|advise|propose)\b.*\b(?:divest|acquire|merge|restructur|expand|exit|cost\s+reduction)\b/gi,
                   /\bstrategic\s+(?:assessment|recommendation|option|direction|review)\b/gi,
                   /\bboard\s+(?:talking\s+points|presentation|meeting|materials)\b/gi,
                   /\bactivist\s+(?:investor|pressure|response|engagement)\b/gi],
        action: 'private_llm', reason: 'Client strategy IS the deliverable — reveals advice even without names' },
      { category: 'COMPETITIVE_INTEL', label: 'Competitive Intelligence',
        patterns: [/\bmarket\s+share\s+(?:declined|grew|gained|lost|dropped|increased)\b/gi,
                   /\bcompetitor\b.*\b(?:revenue|margin|pricing|strategy|share)\b/gi,
                   /\b(?:private|estimated)\s*,?\s*~?\s*\$[\d.]+\s*(?:billion|million|B|M)\s+revenue\b/gi],
        action: 'private_llm', reason: 'Competitive intelligence IS the IP — data patterns identify client even without names' },
    ],
    okToShare: ['published frameworks', 'general business concepts', 'public company filings'],
  },
};

/**
 * Analyze the full document context to decide how to handle values.
 * Thinks like a human: "Who are these numbers about? What's the situation?"
 */
export function analyzeContext(text: string, entities: DetectedEntity[]): ContextAnalysis {
  // ===================================================================
  // STEP 0: Detect industry context
  // ===================================================================
  const industrySignals: Record<string, RegExp[]> = {
    legal:         [/\battorney\b/i, /\blitigation\b/i, /\bcounsel\b/i, /\bdeposition\b/i, /\bplaintiff\b/i, /\bdefendant\b/i, /\bstatute\b/i, /\bfiduciary\b/i, /\bcease.and.desist\b/i, /\btrade secret/i, /\bsettlement\b/i, /\bprejudgment/i],
    healthcare:    [/\bpatient\b/i, /\bdiagnos/i, /\bmedication\b/i, /\bdosage\b/i, /\bMRN\b/i, /\bclinical\b/i, /\bHIPAA\b/i, /\bdischarge\b/i, /\bprescri/i, /\bsurgery\b/i, /\binsulin\b/i, /\beGFR\b/i],
    finance:       [/\bportfolio\b/i, /\bEBITDA\b/i, /\bDCF\b/i, /\bacquisition\b/i, /\bvaluation\b/i, /\bIPO\b/i, /\bequities\b/i, /\bfixed income\b/i, /\bWACC\b/i, /\bterminal value\b/i, /\bcap table\b/i],
    technology:    [/\bAPI\b/, /\bendpoint\b/i, /\bserver\b/i, /\bmiddleware\b/i, /\bauthenticat/i, /\btoken\b/i, /\bdebug/i, /\bsource code\b/i],
    consulting:    [/\bengagement\b/i, /\bmarket share\b/i, /\bTAM\b/i, /\bSWOT\b/i, /\bFive Forces\b/i, /\bboard meeting\b/i, /\bactivist\b/i, /\bprojection\b/i],
    manufacturing: [/\bformul(?:a|ation)\b/i, /\bsurfactant\b/i, /\bbatch\b/i, /\breactor\b/i, /\byield\b/i, /\bviscosity\b/i, /\bpH\b/, /\bsodium\b/i, /\bpreservative\b/i, /\braw\s+material/i, /\bsupplier\b/i, /\bchemical\b/i, /\bmanufactur/i, /\bproduction\s+line/i],
  };
  let detectedIndustry: string | null = null;
  let bestIndustryScore = 0;
  for (const [industry, patterns] of Object.entries(industrySignals)) {
    const hits = patterns.filter(p => p.test(text)).length;
    if (hits > bestIndustryScore) {
      bestIndustryScore = hits;
      detectedIndustry = industry;
    }
  }

  // ===================================================================
  // STEP 0.5: EXECUTIVE LENS — "Would the CEO + GC approve sharing this?"
  // ===================================================================
  const executiveFlags: ExecutiveFlag[] = [];
  let executiveAction: ContextAnalysis['executiveAction'] = null;
  let executiveRole: string | null = null;
  const lens = detectedIndustry ? EXECUTIVE_LENS[detectedIndustry] : undefined;

  if (lens) {
    executiveRole = lens.role;
    for (const rule of lens.neverShare) {
      const hits = rule.patterns.filter(p => {
        p.lastIndex = 0;
        return p.test(text);
      }).length;
      if (hits >= 2) {
        executiveFlags.push({
          category: rule.category,
          label: rule.label,
          action: rule.action,
          reason: rule.reason,
          hits,
        });
        if (rule.action === 'private_llm') {
          executiveAction = 'private_llm';
        } else if (rule.action === 'pseudonymize' && executiveAction !== 'private_llm') {
          executiveAction = 'pseudonymize';
        }
      }
    }
  }
  const hasExecutiveFlags = executiveFlags.length > 0;

  // ===================================================================
  // STEP 1: Are there identified real people?
  // ===================================================================
  const hasPersons = entities.some(e => e.type === 'PERSON');
  const hasSSN = entities.some(e => e.type === 'SSN');
  const hasEmail = entities.some(e => e.type === 'EMAIL');
  const hasIdentifiedPersons = hasPersons || hasSSN || hasEmail;

  // ===================================================================
  // STEP 2: Is this a confidential document?
  // ===================================================================
  const confidentialSignals = [
    /privileged/i, /confidential/i, /attorney[- ]client/i,
    /work product/i, /do not distribute/i, /under seal/i,
    /\bNDA\b/, /memorandum/i, /settlement/i,
  ];
  const financialSignals = [
    /revenue/i, /ebitda/i, /valuation/i, /cap table/i,
    /acquisition/i, /earnings report/i, /balance sheet/i,
  ];
  const hasConfidentialMarkers = confidentialSignals.some(p => p.test(text));
  const hasFinancialContext = financialSignals.some(p => p.test(text));
  const healthcareSignals = [
    /\bHIPAA\b/i, /protected health/i, /\bPHI\b/, /discharge summary/i,
    /medical record/i, /\bMRN\b/,
  ];
  const hasHealthcareContext = healthcareSignals.some(p => p.test(text));
  const isConfidentialDocument = hasConfidentialMarkers || hasFinancialContext ||
    (detectedIndustry === 'healthcare' && hasIdentifiedPersons) ||
    hasHealthcareContext || hasExecutiveFlags;

  // ===================================================================
  // STEP 3: Does the user need computation?
  // ===================================================================
  const computationSignals = [
    /\bcalculate\b/i, /\bcompute\b/i, /\btotal\b/i,
    /\bmultip/i, /\bdivide\b/i, /\bpercentage\b/i,
    /\d+\s*[x×]\s*(of|the|medical|total)/i,
    /\d+(\.\d+)?%/,
    /how much/i, /what is.*\$/i, /add.*interest/i,
    /\byield\s+improv/i, /\bArrhenius\b/i, /\bROI\b/i, /\bbreak[\s-]even\b/i,
    /\bannual\s+savings\b/i,
  ];
  const needsComputation = computationSignals.some(p => p.test(text));

  // ===================================================================
  // STEP 4: Decide strategy — EXECUTIVE LENS OVERRIDES basic PII logic
  // ===================================================================
  let valueStrategy: ContextAnalysis['valueStrategy'];
  let reasoning: string;

  if (hasExecutiveFlags && executiveAction === 'private_llm') {
    valueStrategy = 'private_llm';
    const topFlag = executiveFlags.find(f => f.action === 'private_llm')!;
    reasoning = `${executiveRole}: ${topFlag.reason}`;
  } else if (hasExecutiveFlags && executiveAction === 'pseudonymize') {
    valueStrategy = 'pseudonymize';
    reasoning = `${executiveRole}: ${executiveFlags[0].reason}`;
  } else if (hasIdentifiedPersons && needsComputation) {
    valueStrategy = 'private_llm';
    const industryReasons: Record<string, string> = {
      healthcare: 'Patient data + dosage calculation needed — routing to HIPAA-compliant private LLM',
      legal: 'Privileged legal data + computation — routing to private LLM',
      finance: 'Sensitive financial data + computation — routing to private LLM',
      consulting: 'Confidential engagement data + computation — routing to private LLM',
      technology: 'Sensitive system data + computation — routing to private LLM',
      manufacturing: 'Proprietary process data + optimization math — routing to private LLM',
    };
    reasoning = (detectedIndustry && industryReasons[detectedIndustry])
      || 'Numbers tied to identified persons + computation — routing to private LLM';
  } else if (hasIdentifiedPersons || isConfidentialDocument) {
    valueStrategy = 'pseudonymize';
    const industryReasons: Record<string, string> = {
      healthcare: 'Patient health information detected — pseudonymizing to protect PHI',
      legal: 'Attorney-client privileged content — pseudonymizing identifiers',
      finance: 'Confidential financial data — pseudonymizing deal-sensitive values',
      consulting: 'Confidential engagement data — pseudonymizing client identifiers',
      technology: 'Sensitive system identifiers — pseudonymizing infrastructure data',
      manufacturing: 'Identified persons in manufacturing context — pseudonymizing identifiers',
    };
    reasoning = (detectedIndustry && industryReasons[detectedIndustry])
      || `Numbers linked to ${hasIdentifiedPersons ? 'identified persons' : 'confidential document'} — pseudonymizing values`;
  } else {
    valueStrategy = 'keep_real';
    reasoning = 'No identified persons, confidential markers, or executive flags — safe to send';
  }

  return {
    isConfidentialDocument,
    hasIdentifiedPersons,
    needsComputation,
    valueStrategy,
    reasoning,
    detectedIndustry,
    executiveFlags,
    executiveRole,
    executiveAction,
  };
}

/**
 * Determine if a specific entity should be pseudonymized, given the holistic context.
 */
export function shouldPseudonymize(
  entityType: string,
  contextAnalysis: ContextAnalysis,
): boolean {
  // Identity entities are ALWAYS pseudonymized
  if (ALWAYS_IDENTIFYING_TYPES.has(entityType)) return true;

  // For value entities (amounts, dates, matter numbers):
  // the holistic context analysis decides
  if (contextAnalysis.valueStrategy === 'pseudonymize') return true;
  if (contextAnalysis.valueStrategy === 'keep_real') return false;
  if (contextAnalysis.valueStrategy === 'private_llm') return false; // sent to private LLM with real data

  return true; // unknown → safe default
}

// ---------------------------------------------------------------------------
// Main generator dispatcher
// ---------------------------------------------------------------------------

function generatePseudonym(entityType: EntityType, original: string, hash: string): string {
  switch (entityType) {
    case 'PERSON':
      return generateFakePerson(hash);
    case 'ORGANIZATION':
      return generateFakeOrganization(hash);
    case 'EMAIL':
      return generateFakeEmail(hash);
    case 'PHONE_NUMBER':
      return generateFakePhone(hash);
    case 'SSN':
      return generateFakeSSN(hash);
    case 'CREDIT_CARD':
      return generateFakeCreditCard(hash);
    case 'MONETARY_AMOUNT':
      return generateFakeMonetaryAmount(original, hash);
    case 'LOCATION':
      return generateFakeLocation(hash);
    case 'MATTER_NUMBER':
      return generateFakeMatterNumber(hash);
    case 'CLIENT_MATTER_PAIR':
      return generateFakeClientMatterPair(hash);
    case 'DEAL_CODENAME':
      return generateFakeDealCodename(hash);
    case 'ACCOUNT_NUMBER':
      return generateFakeAccountNumber(hash);
    case 'IP_ADDRESS':
      return generateFakeIPAddress(hash);
    default:
      return `[REDACTED_${entityType}]`;
  }
}

// ---------------------------------------------------------------------------
// Pseudonymizer Class
// ---------------------------------------------------------------------------

export class Pseudonymizer {
  private sessionId: string;
  private firmId: string;
  private mappings: Map<string, PseudonymEntry>;
  private reverseMappings: Map<string, string>; // pseudonym -> original
  private createdAt: Date;
  private expiresAt: Date;

  constructor(sessionId: string, firmId: string) {
    this.sessionId = sessionId;
    this.firmId = firmId;
    this.mappings = new Map();
    this.reverseMappings = new Map();
    this.createdAt = new Date();
    this.expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Replace all detected entities in `text` with deterministic pseudonyms.
   * The same original entity value will always map to the same pseudonym
   * within this session.
   */
  pseudonymize(text: string, entities: DetectedEntity[]): PseudonymizeResult {
    if (this.isExpired()) {
      throw new Error(`Pseudonym session ${this.sessionId} has expired`);
    }

    // Holistic context analysis — run once for the whole document.
    // Thinks like a human: who are these numbers about? What's the situation?
    const context = analyzeContext(text, entities);

    // Sort entities by start position descending so we can replace from the
    // end of the string without invalidating earlier offsets.
    const sorted = [...entities].sort((a, b) => b.start - a.start);

    let maskedText = text;
    let entitiesReplaced = 0;

    for (const entity of sorted) {
      if (!shouldPseudonymize(entity.type, context)) {
        continue;
      }

      const entry = this.getOrCreateEntry(entity.text, entity.type);
      maskedText =
        maskedText.slice(0, entity.start) +
        entry.pseudonym +
        maskedText.slice(entity.end);
      entitiesReplaced++;
    }

    return {
      maskedText,
      entitiesReplaced,
      map: this.getMap(),
    };
  }

  /**
   * Reverse all pseudonyms found in `text` back to their original values.
   * Used to de-pseudonymize LLM responses before returning them to the user.
   */
  depseudonymize(text: string): string {
    if (this.isExpired()) {
      throw new Error(`Pseudonym session ${this.sessionId} has expired`);
    }

    let result = text;

    // Sort reverse mappings by pseudonym length descending to avoid
    // partial replacements (e.g., replace "James Mitchell" before "James").
    const sortedEntries = [...this.reverseMappings.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    );

    for (const [pseudonym, original] of sortedEntries) {
      // Use a global replace in case the LLM repeated the pseudonym
      result = result.split(pseudonym).join(original);
    }

    return result;
  }

  /**
   * Return a snapshot of the current pseudonym map for persistence.
   */
  getMap(): PseudonymMap {
    return {
      sessionId: this.sessionId,
      firmId: this.firmId,
      mappings: new Map(this.mappings),
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }

  /**
   * Load an existing pseudonym map (e.g., from the database) to restore
   * session continuity.
   */
  loadMap(map: PseudonymMap): void {
    this.sessionId = map.sessionId;
    this.firmId = map.firmId;
    this.createdAt = map.createdAt;
    this.expiresAt = map.expiresAt;
    this.mappings = new Map(map.mappings);

    // Rebuild reverse mappings
    this.reverseMappings.clear();
    for (const [, entry] of this.mappings) {
      this.reverseMappings.set(entry.pseudonym, entry.original);
    }
  }

  /**
   * Check whether this session has exceeded its time-to-live.
   */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Look up or create a pseudonym entry for a given original value.
   * Uses the original text as the mapping key so identical values always
   * receive the same pseudonym within a session.
   */
  private getOrCreateEntry(original: string, entityType: EntityType): PseudonymEntry {
    const key = `${entityType}::${original}`;

    const existing = this.mappings.get(key);
    if (existing) {
      return existing;
    }

    const hash = sha256Sync(original);
    const pseudonym = generatePseudonym(entityType, original, hash);

    const entry: PseudonymEntry = {
      original,
      originalHash: hash,
      pseudonym,
      entityType,
    };

    this.mappings.set(key, entry);
    this.reverseMappings.set(pseudonym, original);

    return entry;
  }
}
