/**
 * Contextual Keyword Detector
 *
 * Detects business-sensitive content that goes BEYOND traditional PII.
 * Trained from 130 labeled examples across 7 industries (legal, finance,
 * tech, healthcare, general, investment banking, tech enterprise).
 *
 * Key insight: most CRITICAL content (deal codenames, litigation strategy,
 * MNPI, unreleased products, layoff plans) contains ZERO PII entities.
 * This module fills that gap.
 */

export interface ContextualMarker {
  category: ContextualCategory;
  sensitivityType: string;
  matchedText: string;
  start: number;
  end: number;
  weight: number; // Score contribution (0-30)
  confidence: number; // 0-1
}

export type ContextualCategory =
  | 'ma_deal'          // M&A / Deal Intelligence
  | 'legal_strategy'   // Litigation & Legal Strategy
  | 'corporate_governance' // Board actions, executive changes
  | 'financial_intel'  // MNPI, trading, pre-release data
  | 'tech_security'    // Vulnerabilities, breaches, infrastructure
  | 'healthcare_phi'   // Clinical trials, patient safety
  | 'competitive_intel' // Trade secrets, competitive analysis
  | 'hr_workforce'     // Layoffs, compensation, morale
  | 'insurance_claims' // Claims reserves, actuarial, underwriting
  | 'education_ferpa'  // Student records, Title IX, research
  | 'government_classified' // Classified info, export control, procurement
  | 'energy_operations' // Reserves, exploration, regulatory filings
  | 'real_estate_deals'; // Off-market deals, valuations, tenant data

interface KeywordPattern {
  pattern: RegExp;
  sensitivityType: string;
  category: ContextualCategory;
  weight: number;
  confidence: number;
}

// ── M&A / Deal Intelligence ─────────────────────────────────────────────────
// From: L005, L010, F009, G010, IB009-IB030

const MA_DEAL_PATTERNS: KeywordPattern[] = [
  // Deal codenames: "Project Falcon", "Project Granite", "codename: X"
  {
    pattern: /\b(?:project|codename|code\s*name)[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/gi,
    sensitivityType: 'DEAL_CODENAME',
    category: 'ma_deal',
    weight: 30,
    confidence: 0.92,
  },
  // Acquisition language with specific entities
  {
    pattern: /\b(?:acquir\w*|acquisition|merger|merg\w*)\b.*?\b(?:for|at|valued?\s+at)\b.*?\$[\d,.]+\s*(?:M|B|million|billion)?/gi,
    sensitivityType: 'DEAL_TERMS',
    category: 'ma_deal',
    weight: 25,
    confidence: 0.92,
  },
  // Due diligence references
  {
    pattern: /\bdue\s+diligence\b.*?\b(?:uncover\w*|discover\w*|reveal\w*|found|identified)\b/gi,
    sensitivityType: 'DUE_DILIGENCE_FINDING',
    category: 'ma_deal',
    weight: 20,
    confidence: 0.85,
  },
  // IPO / offering details with specifics
  {
    pattern: /\b(?:IPO|initial\s+public\s+offering)\b.*?\b(?:pric(?:e|ing|ed)|range|valuation|shares?)\b/gi,
    sensitivityType: 'IPO_DETAILS',
    category: 'ma_deal',
    weight: 25,
    confidence: 0.9,
  },
  // SPAC merger language
  {
    pattern: /\bSPAC\b.*?\b(?:merg(?:er|ing)|valuation|ticker|blank.?check)\b/gi,
    sensitivityType: 'SPAC_DETAILS',
    category: 'ma_deal',
    weight: 25,
    confidence: 0.88,
  },
  // LBO / leveraged buyout
  {
    pattern: /\b(?:LBO|leveraged\s+buyout|secondary\s+buyout)\b.*?\b(?:equity|debt|leverage|EBITDA)\b/gi,
    sensitivityType: 'LBO_DETAILS',
    category: 'ma_deal',
    weight: 22,
    confidence: 0.87,
  },
  // Fairness opinion / valuation work
  {
    pattern: /\b(?:fairness\s+opinion|purchase\s+price\s+allocation|earnout|go-shop)\b/gi,
    sensitivityType: 'DEAL_MECHANICS',
    category: 'ma_deal',
    weight: 18,
    confidence: 0.85,
  },
  // Data room / sale process
  {
    pattern: /\b(?:data\s+room|sale\s+process|strategic\s+review|(?:potential|exploring\s+a)\s+sale|(?:buyer|strategic\s+buyer)\w*\s+(?:interest|indication))\b/gi,
    sensitivityType: 'SALE_PROCESS',
    category: 'ma_deal',
    weight: 20,
    confidence: 0.85,
  },
  // Sponsor / PE specific language
  {
    pattern: /\b(?:sponsor|PE\s+firm|private\s+equity)\b.*?\b(?:exit|return|IRR|MOIC|dividend\s+recap)\b/gi,
    sensitivityType: 'SPONSOR_RETURNS',
    category: 'ma_deal',
    weight: 22,
    confidence: 0.87,
  },
  // Specific deal valuation multiples with context
  {
    pattern: /\b(?:\d+(?:\.\d+)?x)\s+(?:EBITDA|revenue|LTM|NTM|ARR|AFFO)\b/gi,
    sensitivityType: 'VALUATION_MULTIPLE',
    category: 'ma_deal',
    weight: 12,
    confidence: 0.7,
  },
];

// ── Legal / Litigation Strategy ──────────────────────────────────────────────
// From: L005-L015, L017, L019-L020

const LEGAL_STRATEGY_PATTERNS: KeywordPattern[] = [
  // Settlement strategy / authority
  {
    pattern: /\b(?:settl\w*)\b.*?\b(?:bottom\s+line|open(?:ing)?\s+at|range|authority|recommend)\b/gi,
    sensitivityType: 'SETTLEMENT_STRATEGY',
    category: 'legal_strategy',
    weight: 25,
    confidence: 0.92,
  },
  // Bottom line / opening position (negotiation strategy without "settle")
  {
    pattern: /\b(?:bottom\s+line\s+is|(?:we(?:'ll|\s+will))\s+open\s+at)\b/gi,
    sensitivityType: 'SETTLEMENT_STRATEGY',
    category: 'legal_strategy',
    weight: 25,
    confidence: 0.9,
  },
  // Case assessment / strength evaluation
  {
    pattern: /\b(?:plaintiff|defendant|case)\b.*?\b(?:strong|weak|likely|unlikely|best\s+option|exposure)\b/gi,
    sensitivityType: 'CASE_ASSESSMENT',
    category: 'legal_strategy',
    weight: 20,
    confidence: 0.8,
  },
  // Deposition content
  {
    pattern: /\bdeposition\b.*?\b(?:testif|admitted|stated|revealed|prior\s+knowledge)\b/gi,
    sensitivityType: 'DEPOSITION_CONTENT',
    category: 'legal_strategy',
    weight: 22,
    confidence: 0.88,
  },
  // Spoliation / evidence concerns
  {
    pattern: /\b(?:spoliation|smoking\s+gun|evidence\s+(?:destruction|preservation)|litigation\s+hold)\b/gi,
    sensitivityType: 'EVIDENCE_CONCERN',
    category: 'legal_strategy',
    weight: 22,
    confidence: 0.9,
  },
  // Discovery material references
  {
    pattern: /\b(?:discovery\s+batch|documents?\s+produced|production\s+(?:log|set))\b/gi,
    sensitivityType: 'DISCOVERY_MATERIAL',
    category: 'legal_strategy',
    weight: 18,
    confidence: 0.85,
  },
  // Mediator / judge assessment
  {
    pattern: /\b(?:mediator|judge)\b.*?\b(?:tends?\s+to|reputation|hostile|favorable|push(?:es)?)\b/gi,
    sensitivityType: 'JUDICIAL_ASSESSMENT',
    category: 'legal_strategy',
    weight: 20,
    confidence: 0.85,
  },
  // Trade secret theft (forward: "proprietary code ... took")
  {
    pattern: /\b(?:trade\s+secret|proprietary\s+(?:source\s+code|algorithm|formula))\b.*?\b(?:took|stole|copied|misappropriat\w*|TRO)\b/gi,
    sensitivityType: 'TRADE_SECRET_THEFT',
    category: 'legal_strategy',
    weight: 25,
    confidence: 0.9,
  },
  // Trade secret theft (reverse: "took ... proprietary code")
  {
    pattern: /\b(?:took|stole|copied|misappropriat\w*)\b.*?\b(?:trade\s+secret|proprietary\s+(?:source\s+code|algorithm|formula))\b/gi,
    sensitivityType: 'TRADE_SECRET_THEFT',
    category: 'legal_strategy',
    weight: 25,
    confidence: 0.9,
  },
  // Whistleblower intent
  {
    pattern: /\b(?:whistleblow\w*|whistle[\s-]?blow\w*)\b.*?\b(?:SEC|fraud|report|filing|dodd[\s-]?frank)\b/gi,
    sensitivityType: 'WHISTLEBLOWER_MATTER',
    category: 'legal_strategy',
    weight: 25,
    confidence: 0.92,
  },
  // Conflict of interest / ethics
  {
    pattern: /\b(?:conflict\s+of\s+interest|ethics\s+committee|disqualif)\b/gi,
    sensitivityType: 'ETHICS_CONFLICT',
    category: 'legal_strategy',
    weight: 20,
    confidence: 0.88,
  },
];

// ── Corporate Governance ─────────────────────────────────────────────────────
// From: L020, G003, G004

const CORPORATE_GOVERNANCE_PATTERNS: KeywordPattern[] = [
  // Executive termination
  {
    pattern: /\b(?:terminat(?:e|ing|ion)|fir(?:e|ing|ed))\b.*?\b(?:CEO|CFO|CTO|COO|executive|president|officer)\b/gi,
    sensitivityType: 'EXECUTIVE_TERMINATION',
    category: 'corporate_governance',
    weight: 30,
    confidence: 0.92,
  },
  // Reverse: "CEO" then "terminate"
  {
    pattern: /\b(?:CEO|CFO|CTO|COO|executive|president|officer)\b.*?\b(?:terminat|fir(?:e|ing|ed)|remov|replac)\b/gi,
    sensitivityType: 'EXECUTIVE_TERMINATION',
    category: 'corporate_governance',
    weight: 30,
    confidence: 0.92,
  },
  // Board actions / resolutions
  {
    pattern: /\b(?:board\s+(?:vote|resolution|approval|meeting))\b.*?\b(?:terminat\w*|approv\w*|reject\w*|secret|confidential|transaction)\b/gi,
    sensitivityType: 'BOARD_ACTION',
    category: 'corporate_governance',
    weight: 22,
    confidence: 0.87,
  },
  // Succession planning
  {
    pattern: /\b(?:interim\s+(?:CEO|CFO|CTO)|succession\s+plan|press\s+release\s+(?:goes|tomorrow|scheduled))\b/gi,
    sensitivityType: 'SUCCESSION_PLAN',
    category: 'corporate_governance',
    weight: 22,
    confidence: 0.88,
  },
  // Internal survey / morale data
  {
    pattern: /\b(?:engagement\s+survey|employee\s+survey|morale)\b.*?\b(?:\d+%|results?|scores?|complaints?|department|below)\b/gi,
    sensitivityType: 'INTERNAL_SURVEY',
    category: 'corporate_governance',
    weight: 22,
    confidence: 0.85,
  },
];

// ── Financial Intelligence / MNPI ────────────────────────────────────────────
// From: F003-F014

const FINANCIAL_INTEL_PATTERNS: KeywordPattern[] = [
  // Pre-release earnings / revenue
  {
    pattern: /\b(?:Q[1-4]|quarterly|annual)\s+(?:revenue|earnings|results?)\b.*?\b(?:will\s+(?:come|be)|expect|project|estimat|consensus)\b/gi,
    sensitivityType: 'PRE_RELEASE_EARNINGS',
    category: 'financial_intel',
    weight: 28,
    confidence: 0.93,
  },
  // Trading strategy / position building
  {
    pattern: /\b(?:position|buying|accumulating)\b.*?\b(?:ahead\s+of|before|catalyst|upside|cost\s+basis)\b/gi,
    sensitivityType: 'TRADING_STRATEGY',
    category: 'financial_intel',
    weight: 25,
    confidence: 0.88,
  },
  // Portfolio details with values
  {
    pattern: /\b(?:portfolio|allocation)\b.*?\b(?:equit|fixed\s+income|alternative|total\s+value|allocated)\b.*?\$[\d,.]+/gi,
    sensitivityType: 'CLIENT_PORTFOLIO',
    category: 'financial_intel',
    weight: 22,
    confidence: 0.87,
  },
  // Front-running / trading misconduct
  {
    pattern: /\b(?:front.?running|insider\s+trading|personal\s+account|ahead\s+of\s+(?:our|the\s+fund))\b/gi,
    sensitivityType: 'TRADING_MISCONDUCT',
    category: 'financial_intel',
    weight: 28,
    confidence: 0.92,
  },
  // Wire transfer instructions
  {
    pattern: /\b(?:wire|transfer)\b.*?\b(?:IBAN|SWIFT|BIC|beneficiary|routing)\b/gi,
    sensitivityType: 'WIRE_INSTRUCTION',
    category: 'financial_intel',
    weight: 22,
    confidence: 0.9,
  },
  // Fund performance (pre-release)
  {
    pattern: /\b(?:fund|strategy)\s+(?:returned|performance|net\s+to\s+investors)\b.*?\b(?:\d+(?:\.\d+)?%|YTD|investor\s+letter)\b/gi,
    sensitivityType: 'UNRELEASED_PERFORMANCE',
    category: 'financial_intel',
    weight: 22,
    confidence: 0.85,
  },
  // Redemption / AUM impact
  {
    pattern: /\b(?:redeem\w*|redemption)\b.*?\b(?:\$[\d,.]+|AUM|below|cut|close\s+(?:the|a)\s+(?:fund|strategy))\b/gi,
    sensitivityType: 'REDEMPTION_DATA',
    category: 'financial_intel',
    weight: 20,
    confidence: 0.85,
  },
  // Proprietary model parameters
  {
    pattern: /\b(?:VaR|risk\s+model|Monte\s+Carlo|correlation\s+(?:of|assumption))\b.*?\b(?:\d+(?:\.\d+)?%?|percentile|confidence)\b/gi,
    sensitivityType: 'PROPRIETARY_MODEL',
    category: 'financial_intel',
    weight: 18,
    confidence: 0.8,
  },
];

// ── Tech Security & Infrastructure ───────────────────────────────────────────
// From: T003-T015, TE009-TE030

const TECH_SECURITY_PATTERNS: KeywordPattern[] = [
  // Zero-day / active vulnerability
  {
    pattern: /\b(?:zero.?day|0.?day|active\s+vulnerabilit|unpatched|CVE-\d{4})\b/gi,
    sensitivityType: 'ACTIVE_VULNERABILITY',
    category: 'tech_security',
    weight: 28,
    confidence: 0.93,
  },
  // Security breach with specifics
  {
    pattern: /\b(?:data\s+breach|security\s+breach|breach\s+incident|was\s+(?:exploited|compromised|accessed))\b/gi,
    sensitivityType: 'SECURITY_BREACH',
    category: 'tech_security',
    weight: 25,
    confidence: 0.9,
  },
  // Default credentials / exposed systems
  {
    pattern: /\b(?:default\s+credentials?|admin\/admin|password\s*[:=]\s*['"]?\w+|exposed\s+(?:without|for\s+\d+))\b/gi,
    sensitivityType: 'DEFAULT_CREDENTIALS',
    category: 'tech_security',
    weight: 25,
    confidence: 0.9,
  },
  // Unreleased product with specifics
  {
    pattern: /\b(?:launching|releasing|announcing|unreleased|unannounced)\b.*?\b(?:haven't\s+(?:disclosed|announced)|not\s+(?:been\s+)?(?:disclosed|announced|public)|before\s+(?:the\s+)?announcement|will\s+be\s+announced|announced\s+at)\b/gi,
    sensitivityType: 'UNRELEASED_PRODUCT',
    category: 'tech_security',
    weight: 28,
    confidence: 0.9,
  },
  // Unreleased product with training data / model details
  {
    pattern: /\b(?:training\s+data\s+includes|fine[\s-]?tuned\s+(?:model|LLaMA|GPT|BERT))\b.*?\b(?:customer|internal|proprietary|will\s+be|announced|launch)\b/gi,
    sensitivityType: 'UNRELEASED_PRODUCT',
    category: 'tech_security',
    weight: 30,
    confidence: 0.9,
  },
  // Proprietary algorithm / model architecture
  {
    pattern: /\b(?:proprietary|our)\s+(?:algorithm|model|engine)\b.*?\b(?:architecture|trained\s+on|embedding|neural\s+network|transformer)\b/gi,
    sensitivityType: 'PROPRIETARY_ALGORITHM',
    category: 'tech_security',
    weight: 20,
    confidence: 0.83,
  },
  // Internal infrastructure details (hostnames, ARNs)
  {
    pattern: /\b(?:arn:aws|\.internal\.|prod[-.]|staging[-.])\b/gi,
    sensitivityType: 'INFRASTRUCTURE_DETAIL',
    category: 'tech_security',
    weight: 15,
    confidence: 0.8,
  },
  // Infrastructure vendor stack disclosure
  {
    pattern: /\b(?:deploy\s+to|hosted\s+(?:on|in|at))\b.*?\b(?:EKS|GKE|AKS|us-east|eu-west|ap-southeast)\b/gi,
    sensitivityType: 'INFRASTRUCTURE_DETAIL',
    category: 'tech_security',
    weight: 15,
    confidence: 0.78,
  },
  // Penetration test results
  {
    pattern: /\b(?:pentest|penetration\s+test|security\s+audit)\b.*?\b(?:critical|high.severity|vulnerabilit|finding)\b/gi,
    sensitivityType: 'PENTEST_RESULTS',
    category: 'tech_security',
    weight: 20,
    confidence: 0.85,
  },
  // Production incident with financial impact
  {
    pattern: /\b(?:outage|incident|downtime)\b.*?\b(?:lost|revenue|impact|\$[\d,.]+|MTTR|MTTD)\b/gi,
    sensitivityType: 'INCIDENT_IMPACT',
    category: 'tech_security',
    weight: 18,
    confidence: 0.8,
  },
  // Disaster recovery / business continuity
  {
    pattern: /\b(?:RTO|RPO|disaster\s+recovery)\b.*?\b(?:minutes?|hours?|active.active|replication)\b/gi,
    sensitivityType: 'DR_STRATEGY',
    category: 'tech_security',
    weight: 15,
    confidence: 0.78,
  },
];

// ── Healthcare ───────────────────────────────────────────────────────────────
// From: H002, H004-H010

const HEALTHCARE_PATTERNS: KeywordPattern[] = [
  // Clinical trial results (unpublished)
  {
    pattern: /\b(?:phase\s+[1-4]|clinical\s+trial)\b.*?\b(?:showed|improvement|progression.free|p\s*[=<>]\s*[\d.]+|NDA|haven't\s+disclosed|not\s+disclosed)\b/gi,
    sensitivityType: 'UNPUBLISHED_TRIAL',
    category: 'healthcare_phi',
    weight: 30,
    confidence: 0.92,
  },
  // Sentinel events / safety incidents
  {
    pattern: /\b(?:sentinel\s+event|wrong.site\s+surgery|medication\s+(?:error|overdose)|patient\s+fall|adverse\s+event)\b/gi,
    sensitivityType: 'SAFETY_INCIDENT',
    category: 'healthcare_phi',
    weight: 22,
    confidence: 0.88,
  },
  // Physician performance / credentialing
  {
    pattern: /\b(?:malpractice|complication\s+rate|credentialing|surgical\s+privileges?|peer\s+review)\b.*?\b(?:restrict|revoke|suspend|claims?|rate)\b/gi,
    sensitivityType: 'PHYSICIAN_PERFORMANCE',
    category: 'healthcare_phi',
    weight: 22,
    confidence: 0.87,
  },
  // VIP / celebrity patient
  {
    pattern: /\b(?:celebrity|VIP|high.profile)\s+(?:patient|admission|case)\b/gi,
    sensitivityType: 'VIP_PATIENT',
    category: 'healthcare_phi',
    weight: 22,
    confidence: 0.88,
  },
  // Patient with full identifiers (PHI triad)
  {
    pattern: /\b(?:patient|pt)\b.*?\b(?:DOB|MRN|date\s+of\s+birth|medical\s+record)\b/gi,
    sensitivityType: 'PHI_TRIAD',
    category: 'healthcare_phi',
    weight: 25,
    confidence: 0.9,
  },
];

// ── HR / Workforce ───────────────────────────────────────────────────────────
// From: T013, G004, F014

const HR_WORKFORCE_PATTERNS: KeywordPattern[] = [
  // Layoff plans with specifics
  {
    pattern: /\b(?:lay\s*off|layoff|RIF|reduction\s+in\s+force|headcount\s+reduction)\b.*?\b(?:\d+%|\d+\s+people|affected|cut)\b/gi,
    sensitivityType: 'LAYOFF_PLAN',
    category: 'hr_workforce',
    weight: 30,
    confidence: 0.92,
  },
  // Reverse: percentage then layoff
  {
    pattern: /\b\d+%\b.*?\b(?:lay\s*off|layoff|RIF|reduction|cut|eliminat)\b/gi,
    sensitivityType: 'LAYOFF_PLAN',
    category: 'hr_workforce',
    weight: 30,
    confidence: 0.9,
  },
  // Layoff plans with "positions" or "roles" (not just "people")
  {
    pattern: /\b(?:eliminat\w*|restructur\w*|reorganiz\w*)\b.*?\b(?:\d+\s+(?:positions?|roles?|jobs?|FTEs?)|headcount)\b/gi,
    sensitivityType: 'LAYOFF_PLAN',
    category: 'hr_workforce',
    weight: 30,
    confidence: 0.9,
  },
  // WARN Act / mass layoff compliance
  {
    pattern: /\b(?:WARN\s+(?:Act|notice|filing)|mass\s+layoff|plant\s+closing)\b/gi,
    sensitivityType: 'LAYOFF_PLAN',
    category: 'hr_workforce',
    weight: 28,
    confidence: 0.92,
  },
  // Compensation / equity packages (recruiting)
  {
    pattern: /\b(?:equity\s+package|compensation|salary)\b.*?\b(?:match|offer|\$[\d,.]+|recruit)\b/gi,
    sensitivityType: 'COMPENSATION_DETAILS',
    category: 'hr_workforce',
    weight: 18,
    confidence: 0.8,
  },
  // Executive compensation / RSU / equity grants with dollar amounts
  {
    pattern: /\b(?:RSU|restricted\s+stock|equity\s+grant|stock\s+option|compensation\s+(?:committee|package))\b.*?\b(?:\$[\d,.]+\s*(?:M|million)?|vest(?:ing)?|above\s+(?:our|the)\s+(?:band|range))\b/gi,
    sensitivityType: 'EXECUTIVE_COMPENSATION',
    category: 'hr_workforce',
    weight: 22,
    confidence: 0.87,
  },
  // Employee attrition data
  {
    pattern: /\b(?:attrition|turnover|resign|quit|accepted\s+offers?)\b.*?\b(?:\d+\s+(?:engineers?|employees?|people)|competitor|last\s+(?:month|quarter))\b/gi,
    sensitivityType: 'ATTRITION_DATA',
    category: 'hr_workforce',
    weight: 18,
    confidence: 0.82,
  },
  // Performance management / PIP with specifics
  {
    pattern: /\b(?:PIP|performance\s+improvement\s+plan|performance\s+review)\b.*?\b(?:terminat\w*|below\s+expectations?|unsatisfactory|manage\s+out)\b/gi,
    sensitivityType: 'PERFORMANCE_ACTION',
    category: 'hr_workforce',
    weight: 18,
    confidence: 0.82,
  },
];

// ── Competitive Intelligence ─────────────────────────────────────────────────
// From: G006, G008, TE022

const COMPETITIVE_INTEL_PATTERNS: KeywordPattern[] = [
  // Vendor negotiation with specifics
  {
    pattern: /\b(?:negotiat|counteroffer|renewal)\b.*?\b(?:spend|discount|\d+%|backup\s+plan|migrat)\b/gi,
    sensitivityType: 'VENDOR_NEGOTIATION',
    category: 'competitive_intel',
    weight: 18,
    confidence: 0.8,
  },
  // Pricing strategy changes
  {
    pattern: /\b(?:pricing|price)\s+(?:change|cut|increase|reduction|new)\b.*?\b(?:\$[\d,.]+|tier|ARPU|effective)\b/gi,
    sensitivityType: 'PRICING_STRATEGY',
    category: 'competitive_intel',
    weight: 22,
    confidence: 0.85,
  },
  // Competitive analysis with specifics
  {
    pattern: /\b(?:competitor\w*|competing|market\s+share|losing\s+(?:market|customer|share))\b.*?\b(?:customer\w*|grow\w*|pricing|switch\w*|evaluat\w*|share)\b/gi,
    sensitivityType: 'COMPETITIVE_ANALYSIS',
    category: 'competitive_intel',
    weight: 20,
    confidence: 0.82,
  },
  // Proprietary pricing formula
  {
    pattern: /\b(?:pricing\s+formula|discount\s+(?:cascade|logic|calculation)|enterprise\s+pricing)\b/gi,
    sensitivityType: 'PRICING_LOGIC',
    category: 'competitive_intel',
    weight: 20,
    confidence: 0.85,
  },
];

// ── Insurance / Claims ──────────────────────────────────────────────────────

const INSURANCE_CLAIMS_PATTERNS: KeywordPattern[] = [
  // Claims reserve / IBNR data
  {
    pattern: /\b(?:claims?\s+reserve|loss\s+reserve|IBNR|incurred\s+but\s+not\s+reported)\b.*?\b(?:\$[\d,.]+|increase|decrease|adverse|favorable|development)\b/gi,
    sensitivityType: 'CLAIMS_RESERVE',
    category: 'insurance_claims',
    weight: 25,
    confidence: 0.9,
  },
  // Catastrophe model results
  {
    pattern: /\b(?:cat(?:astrophe)?\s+model|PML|probable\s+maximum\s+loss|aggregate\s+exceedance)\b.*?\b(?:\$[\d,.]+|return\s+period|percentile|scenario)\b/gi,
    sensitivityType: 'CAT_MODEL_RESULTS',
    category: 'insurance_claims',
    weight: 22,
    confidence: 0.88,
  },
  // Actuarial analysis with specifics
  {
    pattern: /\b(?:actuarial|loss\s+ratio|combined\s+ratio)\b.*?\b(?:\d+(?:\.\d+)?%|deteriorat|improv|adverse|triangle)\b/gi,
    sensitivityType: 'ACTUARIAL_DATA',
    category: 'insurance_claims',
    weight: 20,
    confidence: 0.85,
  },
  // Bad faith / coverage dispute
  {
    pattern: /\b(?:bad\s+faith|coverage\s+denial|denial\s+of\s+(?:claim|coverage)|extra[\s-]?contractual)\b/gi,
    sensitivityType: 'BAD_FAITH_CLAIM',
    category: 'insurance_claims',
    weight: 25,
    confidence: 0.9,
  },
  // Reinsurance treaty details
  {
    pattern: /\b(?:reinsurance|treaty|facultative|retrocession)\b.*?\b(?:attachment|retention|\$[\d,.]+|layer|quota\s+share|excess\s+of\s+loss)\b/gi,
    sensitivityType: 'REINSURANCE_TERMS',
    category: 'insurance_claims',
    weight: 20,
    confidence: 0.85,
  },
];

// ── Education / FERPA ───────────────────────────────────────────────────────

const EDUCATION_FERPA_PATTERNS: KeywordPattern[] = [
  // Student disciplinary / Title IX
  {
    pattern: /\b(?:Title\s+IX|sexual\s+(?:misconduct|harassment|assault)|disciplinary\s+(?:hearing|action|committee))\b.*?\b(?:student|complaint|investigation|respondent|finding)\b/gi,
    sensitivityType: 'TITLE_IX_MATTER',
    category: 'education_ferpa',
    weight: 28,
    confidence: 0.92,
  },
  // FERPA-protected records
  {
    pattern: /\b(?:FERPA|student\s+(?:record|transcript|file)|education\s+record)\b.*?\b(?:disclose|release|request|subpoena|parent|guardian)\b/gi,
    sensitivityType: 'FERPA_DISCLOSURE',
    category: 'education_ferpa',
    weight: 22,
    confidence: 0.88,
  },
  // Unpublished research / grant data
  {
    pattern: /\b(?:unpublished|pre[\s-]?publication|preliminary)\s+(?:research|data|findings|results)\b.*?\b(?:grant|NIH|NSF|DARPA|patent|IP)\b/gi,
    sensitivityType: 'UNPUBLISHED_RESEARCH',
    category: 'education_ferpa',
    weight: 22,
    confidence: 0.85,
  },
  // IRB / human subjects
  {
    pattern: /\b(?:IRB|institutional\s+review\s+board|human\s+subjects?)\b.*?\b(?:protocol|adverse|violation|consent|suspension)\b/gi,
    sensitivityType: 'IRB_MATTER',
    category: 'education_ferpa',
    weight: 22,
    confidence: 0.87,
  },
  // NCAA / athlete eligibility
  {
    pattern: /\b(?:NCAA|athlete|eligibility|NIL)\b.*?\b(?:violation|infraction|ineligible|investigation|compliance)\b/gi,
    sensitivityType: 'NCAA_VIOLATION',
    category: 'education_ferpa',
    weight: 20,
    confidence: 0.85,
  },
];

// ── Government / Classified ─────────────────────────────────────────────────

const GOVERNMENT_CLASSIFIED_PATTERNS: KeywordPattern[] = [
  // Classification markings in context
  {
    pattern: /\b(?:classified|top\s+secret|SCI|SAP|special\s+access)\b.*?\b(?:brief(?:ing)?|program|compartment|clearance|need[\s-]to[\s-]know)\b/gi,
    sensitivityType: 'CLASSIFIED_INFO',
    category: 'government_classified',
    weight: 30,
    confidence: 0.93,
  },
  // Export control / ITAR violations
  {
    pattern: /\b(?:ITAR|export\s+control|EAR|munitions|defense\s+article)\b.*?\b(?:violat|unauthorized|foreign\s+(?:national|person)|deemed\s+export|disclosure)\b/gi,
    sensitivityType: 'EXPORT_CONTROL_VIOLATION',
    category: 'government_classified',
    weight: 30,
    confidence: 0.92,
  },
  // CFIUS / national security review
  {
    pattern: /\b(?:CFIUS|national\s+security\s+review|foreign\s+investment)\b.*?\b(?:filing|review|mitigat|block|divest)\b/gi,
    sensitivityType: 'CFIUS_REVIEW',
    category: 'government_classified',
    weight: 25,
    confidence: 0.9,
  },
  // Procurement / source selection
  {
    pattern: /\b(?:source\s+selection|procurement\s+sensitive|bid\s+(?:evaluation|protest)|sole\s+source\s+justification)\b/gi,
    sensitivityType: 'PROCUREMENT_SENSITIVE',
    category: 'government_classified',
    weight: 22,
    confidence: 0.88,
  },
  // Sanctions / OFAC
  {
    pattern: /\b(?:OFAC|sanction|SDN\s+list|specially\s+designated|embargo)\b.*?\b(?:screening|hit|match|blocked|reject)\b/gi,
    sensitivityType: 'SANCTIONS_DATA',
    category: 'government_classified',
    weight: 25,
    confidence: 0.9,
  },
  // Inspector General / audit findings
  {
    pattern: /\b(?:inspector\s+general|IG\s+(?:report|finding|investigation)|qui\s+tam|False\s+Claims)\b/gi,
    sensitivityType: 'IG_INVESTIGATION',
    category: 'government_classified',
    weight: 22,
    confidence: 0.87,
  },
];

// ── Energy / Operations ─────────────────────────────────────────────────────

const ENERGY_OPERATIONS_PATTERNS: KeywordPattern[] = [
  // Reserve estimates (proved/probable)
  {
    pattern: /\b(?:proved|probable|possible)\s+(?:reserves?|resources?)\b.*?\b(?:BOE|MBOE|barrels?|MCF|BCF|estimate|report)\b/gi,
    sensitivityType: 'RESERVE_ESTIMATE',
    category: 'energy_operations',
    weight: 25,
    confidence: 0.9,
  },
  // Exploration / seismic data
  {
    pattern: /\b(?:seismic|exploration|wildcat|prospect)\b.*?\b(?:data|survey|results?|proprietary|interpretations?|promising|dry\s+hole)\b/gi,
    sensitivityType: 'EXPLORATION_DATA',
    category: 'energy_operations',
    weight: 25,
    confidence: 0.88,
  },
  // PPA / offtake with terms
  {
    pattern: /\b(?:PPA|power\s+purchase\s+agreement|offtake)\b.*?\b(?:\$[\d,.]+|per\s+(?:MWh|kWh)|term|escalat|renewable)\b/gi,
    sensitivityType: 'PPA_TERMS',
    category: 'energy_operations',
    weight: 22,
    confidence: 0.87,
  },
  // Environmental liability / remediation
  {
    pattern: /\b(?:environmental\s+(?:liability|remediation|contamination)|CERCLA|superfund|decommission)\b.*?\b(?:\$[\d,.]+|cost|estimat|reserve|provision)\b/gi,
    sensitivityType: 'ENVIRONMENTAL_LIABILITY',
    category: 'energy_operations',
    weight: 22,
    confidence: 0.87,
  },
  // Rate case / tariff filing
  {
    pattern: /\b(?:rate\s+case|tariff\s+(?:filing|proposal)|FERC\s+(?:filing|order|docket))\b.*?\b(?:revenue\s+requirement|\$[\d,.]+|ROE|rate\s+base)\b/gi,
    sensitivityType: 'REGULATORY_FILING',
    category: 'energy_operations',
    weight: 20,
    confidence: 0.85,
  },
];

// ── Real Estate / Deals ─────────────────────────────────────────────────────

const REAL_ESTATE_DEALS_PATTERNS: KeywordPattern[] = [
  // Off-market / pocket listing
  {
    pattern: /\b(?:off[\s-]?market|pocket\s+listing|pre[\s-]?market|not\s+(?:yet\s+)?listed)\b.*?\b(?:deal|property|opportunit|buyer|seller)\b/gi,
    sensitivityType: 'OFF_MARKET_DEAL',
    category: 'real_estate_deals',
    weight: 22,
    confidence: 0.88,
  },
  // Cap rate / valuation with specifics
  {
    pattern: /\b(?:cap\s+rate|NOI|net\s+operating\s+income)\b.*?\b(?:\d+(?:\.\d+)?%|\$[\d,.]+|valuation|appraised)\b/gi,
    sensitivityType: 'PROPERTY_VALUATION',
    category: 'real_estate_deals',
    weight: 18,
    confidence: 0.83,
  },
  // Tenant / lease data with financial details
  {
    pattern: /\b(?:rent\s+roll|tenant\s+(?:list|roster|data)|lease\s+(?:expiration|abstract))\b.*?\b(?:\$[\d,.]+|per\s+(?:SF|sq\.?\s*ft)|occupancy|vacancy)\b/gi,
    sensitivityType: 'TENANT_DATA',
    category: 'real_estate_deals',
    weight: 20,
    confidence: 0.85,
  },
  // 1031 exchange / tax strategy
  {
    pattern: /\b(?:1031\s+exchange|opportunity\s+zone|tax\s+abatement|like[\s-]kind)\b.*?\b(?:property|gain|defer|identif|deadline)\b/gi,
    sensitivityType: 'TAX_STRATEGY',
    category: 'real_estate_deals',
    weight: 18,
    confidence: 0.83,
  },
  // Development / entitlement
  {
    pattern: /\b(?:entitlement|rezoning|variance|zoning\s+(?:change|approval))\b.*?\b(?:approv|deny|hearing|council|commission|FAR|density)\b/gi,
    sensitivityType: 'ENTITLEMENT_DATA',
    category: 'real_estate_deals',
    weight: 18,
    confidence: 0.82,
  },
];

// ── Confidential Intent / Implicit Sensitivity ────────────────────────────────
// Catches language that signals the user KNOWS this is sensitive, even when
// no specific industry keywords or PII entities are present.
// "Between us", "don't share this", "internal only" — a CEO/GC would flag
// any content preceded by these signals as requiring governance review.

const CONFIDENTIAL_INTENT_PATTERNS: KeywordPattern[] = [
  // Explicit confidentiality markers
  {
    pattern: /\b(?:between\s+(?:us|you\s+and\s+me)|off\s+the\s+record|don'?t\s+share|keep\s+this\s+(?:quiet|confidential|between\s+us))\b/gi,
    sensitivityType: 'CONFIDENTIAL_INTENT',
    category: 'corporate_governance',
    weight: 15,
    confidence: 0.82,
  },
  // Distribution restriction
  {
    pattern: /\b(?:internal\s+only|not\s+for\s+(?:distribution|external|public)|eyes\s+only|need[\s-]to[\s-]know\s+(?:only|basis))\b/gi,
    sensitivityType: 'DISTRIBUTION_RESTRICTION',
    category: 'corporate_governance',
    weight: 18,
    confidence: 0.88,
  },
  // Embargo / timing sensitivity
  {
    pattern: /\b(?:embargoed?|not\s+(?:yet\s+)?(?:public|announced|disclosed)|do\s+not\s+(?:disclose|announce|share)|pre[\s-]?announcement)\b/gi,
    sensitivityType: 'EMBARGO_MARKER',
    category: 'corporate_governance',
    weight: 20,
    confidence: 0.88,
  },
  // Implied stock / trading sensitivity
  {
    pattern: /\b(?:should(?:n'?t)?\s+(?:sell|buy|trade|hold)\s+(?:our\s+)?stock|material\s+(?:information|event|change)|stock\s+(?:will|could|should|might)\s+(?:move|jump|drop|tank))\b/gi,
    sensitivityType: 'IMPLIED_MNPI',
    category: 'financial_intel',
    weight: 25,
    confidence: 0.85,
  },
];

// ── All patterns ─────────────────────────────────────────────────────────────

const ALL_PATTERNS: KeywordPattern[] = [
  ...MA_DEAL_PATTERNS,
  ...LEGAL_STRATEGY_PATTERNS,
  ...CORPORATE_GOVERNANCE_PATTERNS,
  ...FINANCIAL_INTEL_PATTERNS,
  ...TECH_SECURITY_PATTERNS,
  ...HEALTHCARE_PATTERNS,
  ...HR_WORKFORCE_PATTERNS,
  ...COMPETITIVE_INTEL_PATTERNS,
  ...INSURANCE_CLAIMS_PATTERNS,
  ...EDUCATION_FERPA_PATTERNS,
  ...GOVERNMENT_CLASSIFIED_PATTERNS,
  ...ENERGY_OPERATIONS_PATTERNS,
  ...REAL_ESTATE_DEALS_PATTERNS,
  ...CONFIDENTIAL_INTENT_PATTERNS,
];

// Category weights: how much each category contributes to the overall score
const CATEGORY_WEIGHTS: Record<ContextualCategory, number> = {
  ma_deal: 1.0,
  legal_strategy: 1.0,
  corporate_governance: 1.0,
  financial_intel: 1.0,
  tech_security: 1.0,
  healthcare_phi: 1.0,
  competitive_intel: 0.85,
  hr_workforce: 1.0,
  insurance_claims: 1.0,
  education_ferpa: 1.0,
  government_classified: 1.0,
  energy_operations: 1.0,
  real_estate_deals: 0.9,
};

// Negation prefixes that invalidate a keyword match.
// "there was no breach", "not a merger", "didn't involve any acquisition"
const NEGATION_PATTERN = /\b(?:no|not|n['']t|never|without|lack(?:s|ing)?|absence\s+of|don['']t|doesn['']t|didn['']t|isn['']t|aren['']t|wasn['']t|weren['']t)\s+$/i;

/**
 * Check if the 30 chars before a match contain a negation that invalidates it.
 */
function isNegated(text: string, matchStart: number): boolean {
  const lookback = text.substring(Math.max(0, matchStart - 30), matchStart);
  return NEGATION_PATTERN.test(lookback);
}

/**
 * Detect contextual sensitivity markers in text.
 * Returns markers with categories, sensitivity types, and score contributions.
 */
export function detectContextualSensitivity(text: string): ContextualMarker[] {
  const markers: ContextualMarker[] = [];
  const seen = new Set<string>();

  for (const kp of ALL_PATTERNS) {
    // Reset regex state
    kp.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    let matchCount = 0;
    const MAX_MATCHES_PER_PATTERN = 100;
    while ((match = kp.pattern.exec(text)) !== null) {
      // Guard against zero-length matches causing infinite loops
      if (match[0].length === 0) {
        kp.pattern.lastIndex++;
        continue;
      }
      if (++matchCount > MAX_MATCHES_PER_PATTERN) break;

      const key = `${kp.sensitivityType}-${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Negation check: "no breach", "not a merger" → skip this match
      if (isNegated(text, match.index)) continue;

      markers.push({
        category: kp.category,
        sensitivityType: kp.sensitivityType,
        matchedText: match[0],
        start: match.index,
        end: match.index + match[0].length,
        weight: kp.weight * CATEGORY_WEIGHTS[kp.category],
        confidence: kp.confidence,
      });
    }
  }

  // Temporal signal adjustment: past tense ("had a breach last year") is less
  // actionable than present/future tense ("will acquire", "planning to").
  // Reduce weight for markers preceded by past-tense signals.
  const PAST_TENSE_SIGNAL = /\b(?:last\s+(?:year|quarter|month|week)|previously|in\s+\d{4}|years?\s+ago|back\s+(?:in|when)|used\s+to|formerly|historical(?:ly)?)\b/i;
  const FUTURE_TENSE_SIGNAL = /\b(?:will\s+(?:be|have|launch|announce)|going\s+to|planning\s+to|about\s+to|scheduled\s+(?:for|to)|upcoming|imminent|tomorrow|next\s+(?:week|month|quarter))\b/i;

  for (const marker of markers) {
    const surroundStart = Math.max(0, marker.start - 80);
    const surroundEnd = Math.min(text.length, marker.end + 80);
    const surrounding = text.substring(surroundStart, surroundEnd);

    if (PAST_TENSE_SIGNAL.test(surrounding) && !FUTURE_TENSE_SIGNAL.test(surrounding)) {
      // Past tense context → reduce weight by 40% (still flagged, but lower score)
      marker.weight *= 0.6;
      marker.confidence *= 0.85;
    } else if (FUTURE_TENSE_SIGNAL.test(surrounding)) {
      // Future tense context → boost weight by 15% (active MNPI)
      marker.weight *= 1.15;
    }
  }

  // Sort by position
  markers.sort((a, b) => a.start - b.start);

  // Deduplicate overlapping markers of the same category (keep higher weight)
  return deduplicateMarkers(markers);
}

function deduplicateMarkers(markers: ContextualMarker[]): ContextualMarker[] {
  if (markers.length <= 1) return markers;

  const result: ContextualMarker[] = [];

  for (const current of markers) {
    // Check for overlap with ANY existing marker in same category (not just adjacent)
    let merged = false;
    for (let j = 0; j < result.length; j++) {
      const existing = result[j];
      if (
        current.category === existing.category &&
        current.start < existing.end &&
        current.end > existing.start
      ) {
        // Overlapping same-category markers — keep the higher weight one
        if (current.weight > existing.weight) {
          result[j] = current;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      result.push(current);
    }
  }

  return result;
}

/**
 * Categories whose presence alone warrants critical-level scoring.
 * These represent content that a CEO/GC would flag regardless of PII entities.
 */
const CRITICAL_CONTEXT_CATEGORIES: ReadonlySet<ContextualCategory> = new Set([
  'ma_deal',              // M&A deals are MNPI by definition
  'legal_strategy',       // Litigation strategy is privileged
  'financial_intel',      // MNPI / trading intelligence
  'healthcare_phi',       // Clinical trials, sentinel events
  'government_classified', // Classified info = federal crime
]);

/**
 * Compute a contextual sensitivity score from detected markers.
 * Returns 0-70 (raised cap to allow contextual-only scenarios to reach critical).
 *
 * Design rationale: The original cap of 50 meant scenarios with ZERO PII entities
 * but CRITICAL contextual risk (whistleblower + SEC, unreleased clinical trial,
 * classified briefing) could never score above "medium". A CEO/GC would consider
 * these scenarios far more dangerous than a stray phone number. The cap of 70
 * allows critical contextual patterns with document-type multipliers to reach
 * the "critical" threshold (86+) without PII entities.
 */
export function computeContextualScore(markers: ContextualMarker[]): number {
  if (markers.length === 0) return 0;

  let score = 0;

  // Sum weighted contributions (with confidence)
  for (const marker of markers) {
    score += marker.weight * marker.confidence;
  }

  // Multi-category bonus: sensitivity across multiple categories is more concerning
  const uniqueCategories = new Set(markers.map(m => m.category));
  if (uniqueCategories.size >= 3) {
    score *= 1.3;
  } else if (uniqueCategories.size >= 2) {
    score *= 1.15;
  }

  // Critical-context floor: if ANY marker belongs to a critical category with
  // high confidence, ensure a minimum score that reflects the severity.
  // A single "deal codename" or "settlement authority" marker should never
  // score below 35 — that's the floor for "this matters to the GC."
  const hasCriticalCategory = markers.some(
    m => CRITICAL_CONTEXT_CATEGORIES.has(m.category) && m.confidence >= 0.85
  );
  if (hasCriticalCategory && score < 35) {
    score = 35;
  }

  // Cap at 70 to leave room for PII entity scoring while allowing
  // contextual-only scenarios to reach critical with document-type multipliers
  return Math.min(70, Math.round(score));
}

/**
 * Generate a human-readable explanation of detected contextual sensitivity.
 */
export function explainContextualMarkers(markers: ContextualMarker[]): string {
  if (markers.length === 0) return '';

  const categoryLabels: Record<ContextualCategory, string> = {
    ma_deal: 'M&A/deal intelligence',
    legal_strategy: 'litigation/legal strategy',
    corporate_governance: 'corporate governance action',
    financial_intel: 'material non-public financial information',
    tech_security: 'security/infrastructure details',
    healthcare_phi: 'protected health information context',
    competitive_intel: 'competitive intelligence',
    hr_workforce: 'workforce/HR sensitive data',
    insurance_claims: 'insurance claims/actuarial data',
    education_ferpa: 'FERPA-protected education records',
    government_classified: 'government classified/export-controlled information',
    energy_operations: 'energy reserves/operations data',
    real_estate_deals: 'real estate deal intelligence',
  };

  const categories = [...new Set(markers.map(m => m.category))];
  const labels = categories.map(c => categoryLabels[c]).filter(Boolean);

  if (labels.length === 0) return '';

  return `Contains ${labels.join(', ')}`;
}
