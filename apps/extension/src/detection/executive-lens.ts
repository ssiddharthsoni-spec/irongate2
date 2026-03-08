/**
 * Executive Lens — Client-Side Routing Intelligence
 *
 * Ported from the API-side pseudonymizer.ts to run 100% in-browser.
 * Applies industry-specific "Would the CEO + General Counsel approve
 * sharing this with a public AI?" analysis to determine routing:
 *
 *   - pseudonymize:  Replace identifying values, send to user's chosen AI tool
 *   - passthrough:   Safe to send unmodified
 *   - private_llm:   Must route to firm's on-premise LLM (no cloud exposure)
 *
 * Coverage: Manufacturing, Legal, Healthcare, Finance, Technology,
 * Consulting, Insurance, Real Estate, Energy, Education, Government
 */

import type { DetectedEntity } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RouteDecision = 'pseudonymize' | 'passthrough' | 'private_llm';

export interface ExecutiveLensResult {
  /** Recommended routing action */
  route: RouteDecision;
  /** Detected industry (null if none matched) */
  industry: string | null;
  /** Executive rules that fired (category names) */
  triggeredRules: string[];
  /** Whether identified persons are present */
  hasIdentifiedPersons: boolean;
  /** Whether computation is needed (math on sensitive values) */
  needsComputation: boolean;
  /** Whether confidentiality markers are present */
  isConfidential: boolean;
  /** Human-readable explanation */
  explanation: string;
}

// ─── Industry Detection ─────────────────────────────────────────────────────

interface IndustrySignals {
  [industry: string]: RegExp[];
}

const INDUSTRY_SIGNALS: IndustrySignals = {
  legal: [
    /\battorney\b/i, /\blitigation\b/i, /\bcounsel\b/i, /\bdeposition\b/i,
    /\bplaintiff\b/i, /\bdefendant\b/i, /\bstatute\b/i, /\bfiduciary\b/i,
    /\bcease-and-desist\b/i, /\btrade secret\b/i, /\bsettlement\b/i,
    /\bprejudgment\b/i, /\bprivilege\b/i, /\bwork product\b/i,
  ],
  healthcare: [
    /\bpatient\b/i, /\bdiagnos/i, /\bmedication\b/i, /\bdosage\b/i,
    /\bMRN\b/, /\bclinical\b/i, /\bHIPAA\b/i, /\bdischarge\b/i,
    /\bprescri/i, /\bsurgery\b/i, /\binsulin\b/i, /\beGFR\b/i,
  ],
  finance: [
    /\bportfolio\b/i, /\bEBITDA\b/i, /\bDCF\b/i, /\bacquisition\b/i,
    /\bvaluation\b/i, /\bIPO\b/i, /\bequities\b/i, /\bfixed income\b/i,
    /\bWACC\b/i, /\bterminal value\b/i, /\bcap table\b/i,
  ],
  technology: [
    /\bAPI\b/, /\bendpoint\b/i, /\bserver\b/i, /\bmiddleware\b/i,
    /\bauthenticat/i, /\btoken\b/i, /\bdebug\b/i, /\bsource code\b/i,
  ],
  consulting: [
    /\bengagement\b/i, /\bmarket share\b/i, /\bTAM\b/, /\bSWOT\b/i,
    /\bFive Forces\b/i, /\bboard meeting\b/i, /\bactivist\b/i,
    /\bprojection\b/i,
  ],
  manufacturing: [
    /\bformul/i, /\bsurfactant\b/i, /\bbatch\b/i, /\breactor\b/i,
    /\byield\b/i, /\bviscosity\b/i, /\bpH\b/, /\bsodium\b/i,
    /\bpreservative\b/i, /\braw material\b/i, /\bsupplier\b/i,
    /\bchemical\b/i, /\bmanufactur/i, /\bproduction line\b/i,
  ],
  insurance: [
    /\bactuarial\b/i, /\bunderwriting\b/i, /\bclaims reserve\b/i,
    /\bloss ratio\b/i, /\bcombined ratio\b/i, /\bIBNR\b/,
    /\breinsurance\b/i, /\bpolicyholder\b/i, /\bcatastrophe model\b/i,
    /\bsolvency\b/i, /\bpremium\b/i, /\bclaimant\b/i,
  ],
  real_estate: [
    /\bcap rate\b/i, /\bNOI\b/, /\brent roll\b/i, /\boccupancy\b/i,
    /\bvacancy\b/i, /\btenant\b/i, /\blease\b/i, /\b1031 exchange\b/i,
    /\bzoning\b/i, /\bentitlement\b/i, /\bappraisal\b/i, /\bAPN\b/,
  ],
  energy: [
    /\breserves\b/i, /\bBOE\b/, /\bseismic\b/i, /\bwell log\b/i,
    /\bdrilling\b/i, /\bPPA\b/, /\bFERC\b/, /\bNERC\b/,
    /\bpipeline\b/i, /\bupstream\b/i, /\bmidstream\b/i, /\bLCOE\b/,
  ],
  education: [
    /\bFERPA\b/, /\bstudent record\b/i, /\btranscript\b/i, /\bGPA\b/,
    /\bTitle IX\b/i, /\baccreditation\b/i, /\bIRB\b/, /\btenure\b/i,
    /\bNCAA\b/, /\bfinancial aid\b/i, /\benrollment\b/i,
  ],
  government: [
    /\bclassified\b/i, /\btop secret\b/i, /\bFOUO\b/, /\bCUI\b/,
    /\bITAR\b/, /\bexport control\b/i, /\bCFIUS\b/, /\bOFAC\b/,
    /\bsanction\b/i, /\bprocurement\b/i, /\bclearance\b/i, /\bFedRAMP\b/,
  ],
};

function detectIndustry(text: string): string | null {
  let bestIndustry: string | null = null;
  let bestScore = 0;

  for (const [industry, patterns] of Object.entries(INDUSTRY_SIGNALS)) {
    let hits = 0;
    for (const pat of patterns) {
      if (pat.test(text)) hits++;
    }
    if (hits > bestScore) {
      bestScore = hits;
      bestIndustry = industry;
    }
  }

  // Require at least 2 signal matches to declare an industry
  return bestScore >= 2 ? bestIndustry : null;
}

// ─── Executive Rules (per-industry "never share" patterns) ──────────────────

interface ExecutiveRule {
  name: string;
  action: RouteDecision;
  patterns: RegExp[];
  /** Minimum pattern matches to trigger (default: 2) */
  threshold?: number;
}

const EXECUTIVE_RULES: Record<string, ExecutiveRule[]> = {
  manufacturing: [
    {
      name: 'Proprietary Formula',
      action: 'private_llm',
      patterns: [
        /\d+(\.\d+)?%\s*(sodium|potassium|sulfate|chloride|hydroxide|acid|carbonate|phosphate)/i,
        /\bpH\s*[:=]?\s*\d/i, /\bheat\b.*\d+\s*°/i, /\bformul(a|ation)\b/i,
        /\bproprietary\s+(blend|formula|process|recipe)\b/i,
        /\bq\.?s\.?\s+to\s+100/i, /\bviscosity\b/i,
      ],
    },
    {
      name: 'Manufacturing Process Parameters',
      action: 'private_llm',
      patterns: [
        /\b(reactor|batch|mixing|curing|distill|extrusion|ferment)\b.*\b(temp|time|duration)\b/i,
        /\b\d+\s*(RPM|psi|bar|cP|mPa)\b/i, /\d+\s*°[CF]\b/,
        /\byield\s*[:=]?\s*\d+(\.\d+)?%/i, /\bbatch\s+(size|cycle|process)\b/i,
      ],
    },
    {
      name: 'Supplier Terms',
      action: 'pseudonymize',
      patterns: [
        /\bsupplier\b/i,
        /\$\s*\d+(\.\d+)?\s*\/(kg|lb|ton|liter|gallon|unit)\b/i,
        /\bcost per\s+(unit|kg|lb|ton)\b/i,
      ],
    },
  ],

  legal: [
    {
      name: 'Litigation/Negotiation Strategy',
      action: 'private_llm',
      patterns: [
        /\b(our|we|firm'?s)\s+(strategy|position|argument|approach|theory)\b/i,
        /\bwe\s+(plan|intend|will|should)\s+(argue|file|settle|motion|depose)\b/i,
        /\bsettlement\s+(demand|offer|position|range|authority)\b/i,
        /\bprepared to\s+(offer|settle|accept)\b/i,
      ],
    },
    {
      name: 'Attorney-Client Privilege',
      action: 'private_llm',
      patterns: [
        /\battorney[- ]client\s+privilege\b/i,
        /\bprivileged and confidential\b/i,
        /\bwork product\b/i,
      ],
    },
  ],

  healthcare: [
    {
      name: 'Patient Data (HIPAA)',
      action: 'pseudonymize',
      patterns: [
        /\bpatient\b.*\b(diagnos|condition|medication|treatment|procedure)\b/i,
        /\bprotected health\b/i, /\bHIPAA\b/i,
      ],
    },
    {
      name: 'Unpublished Clinical IP',
      action: 'private_llm',
      patterns: [
        /\bproprietary\s+(drug|compound|therapy|formulation|protocol)\b/i,
        /\bclinical trial\s+(data|results|phase)\b/i,
        /\bunpublished\s+(data|findings|results|study)\b/i,
      ],
    },
  ],

  finance: [
    {
      name: 'Material Non-Public Information (MNPI)',
      action: 'private_llm',
      patterns: [
        /\bnon-public\b/i, /\bunreleased\b/i, /\bpre-announcement\b/i,
        /\binsider\b/i, /\bacquisition target\b/i,
        /\bproject\s+[A-Z][a-z]+\b/, /\bunder NDA\b/i,
        /\bcap table\b/i, /\bwire\s+(instructions|transfer)\b/i,
      ],
    },
    {
      name: 'Client Portfolio/Positions',
      action: 'private_llm',
      patterns: [
        /\d+\s*shares?\s*@\s*\$/i, /\bface value\b/i,
        /\bcurrent positions\b/i, /\btarget allocation\b/i,
      ],
    },
  ],

  technology: [
    {
      name: 'Credentials & Secrets',
      action: 'pseudonymize',
      patterns: [
        /\b(sk_|api_key_|svc_key_|secret_|token_|key_)\w{8,}/i,
        /\bpassword\s*[:=]\b/i, /[A-Za-z0-9+/]{40,}={0,2}/,
      ],
    },
    {
      name: 'Internal Infrastructure',
      action: 'pseudonymize',
      patterns: [
        /\w+\.(internal|corp|local)\b/i,
        /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
        /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
      ],
    },
  ],

  consulting: [
    {
      name: 'Client Strategic Recommendations',
      action: 'private_llm',
      patterns: [
        /\b(recommend|advise|propose)\b.*\b(divest|acquire|merge|restructur|expand|exit|cost reduction)\b/i,
        /\bstrategic\s+(assessment|recommendation|option|direction|review)\b/i,
        /\bboard\s+(talking points|presentation|meeting|materials)\b/i,
        /\bactivist\s+(investor|pressure|response|engagement)\b/i,
      ],
    },
    {
      name: 'Competitive Intelligence',
      action: 'private_llm',
      patterns: [
        /\bmarket share\s+(declined|grew|gained|lost|dropped|increased)\b/i,
        /\bcompetitor\s+(revenue|margin|pricing|strategy|share)\b/i,
        /\b(private|estimated)\s+~?\$\d+\s*(billion|million)\s+revenue\b/i,
      ],
    },
  ],

  insurance: [
    {
      name: 'Claims Reserves / IBNR',
      action: 'private_llm',
      patterns: [
        /\bclaims?\s+reserve\b/i, /\bIBNR\b/, /\bloss\s+reserve\b/i,
        /\bloss\s+development\b/i, /\badverse\s+development\b/i,
      ],
    },
    {
      name: 'Catastrophe Model Results',
      action: 'private_llm',
      patterns: [
        /\b(cat|catastrophe)\s+model\b/i, /\bPML\b/,
        /\bprobable maximum loss\b/i, /\baggregate exceedance\b/i,
      ],
    },
    {
      name: 'Reinsurance Treaty Terms',
      action: 'pseudonymize',
      patterns: [
        /\breinsurance\s+(treaty|program)\b/i, /\bretrocession\b/i,
        /\bquota share\b/i, /\bexcess of loss\b/i,
      ],
    },
  ],

  real_estate: [
    {
      name: 'Off-Market Deal Terms',
      action: 'pseudonymize',
      patterns: [
        /\boff-market\b/i, /\bpocket listing\b/i, /\basking price\b/i,
        /\bcap rate\b.*\d/i,
      ],
    },
    {
      name: 'Rent Roll / Tenant Data',
      action: 'pseudonymize',
      patterns: [
        /\brent roll\b/i, /\btenant\s+(roster|list|data)\b/i,
        /\blease\s+(expiration|abstract)\b/i,
      ],
    },
  ],

  energy: [
    {
      name: 'Reserve Data / Exploration',
      action: 'private_llm',
      patterns: [
        /\b(proved|probable|possible)\s+reserves\b/i,
        /\bseismic\s+(data|survey|interpretation)\b/i,
        /\bwell log\b/i, /\bdecline curve\b/i,
      ],
    },
    {
      name: 'Power Purchase Agreement Terms',
      action: 'pseudonymize',
      patterns: [
        /\bPPA\b.*\$\d/i, /\bpower purchase agreement\b/i,
        /\bofftake\s+(agreement|contract)\b/i,
      ],
    },
  ],

  education: [
    {
      name: 'FERPA-Protected Student Records',
      action: 'pseudonymize',
      patterns: [
        /\bFERPA\b/, /\bstudent\s+(record|transcript|file)\b/i,
        /\bdisciplinar/i, /\bexpulsion\b/i,
      ],
    },
    {
      name: 'Title IX Matters',
      action: 'private_llm',
      patterns: [
        /\bTitle IX\b/i, /\bsexual\s+(misconduct|harassment|assault)\b/i,
        /\bTitle IX\s+(investigation|complaint|hearing)\b/i,
      ],
    },
    {
      name: 'Unpublished Research / Patent-Pending',
      action: 'private_llm',
      patterns: [
        /\bunpublished\s+(research|data|findings)\b/i,
        /\bpatent[- ]pending\b/i, /\bpre-publication\b/i,
      ],
    },
  ],

  government: [
    {
      name: 'Classified / SCI Information',
      action: 'private_llm',
      patterns: [
        /\bclassified\b/i, /\btop secret\b/i, /\bSCI\b/,
        /\bspecial access program\b/i, /\bneed-to-know\b/i,
      ],
    },
    {
      name: 'ITAR / EAR Export-Controlled',
      action: 'private_llm',
      patterns: [
        /\bITAR\b/, /\bexport control\b/i, /\bmunitions list\b/i,
        /\bECCN\b/, /\bdeemed export\b/i,
      ],
    },
    {
      name: 'Procurement Sensitive',
      action: 'pseudonymize',
      patterns: [
        /\bsource selection\b/i, /\bprocurement sensitive\b/i,
        /\bbid\s+(evaluation|protest)\b/i, /\bsole source justification\b/i,
      ],
    },
  ],
};

// ─── Confidentiality & Computation Detection ────────────────────────────────

const CONFIDENTIALITY_MARKERS: RegExp[] = [
  /\bprivileged\b/i, /\bconfidential\b/i, /\battorney[- ]client\b/i,
  /\bwork product\b/i, /\bdo not distribute\b/i, /\bunder seal\b/i,
  /\bNDA\b/, /\bmemorandum\b/i, /\bsettlement\b/i,
];

const FINANCIAL_CONTEXT: RegExp[] = [
  /\brevenue\b/i, /\bebitda\b/i, /\bvaluation\b/i, /\bcap table\b/i,
  /\bacquisition\b/i, /\bearnings report\b/i, /\bbalance sheet\b/i,
];

const HEALTHCARE_CONTEXT: RegExp[] = [
  /\bHIPAA\b/i, /\bprotected health\b/i, /\bPHI\b/,
  /\bdischarge summary\b/i, /\bmedical record\b/i, /\bMRN\b/,
];

const COMPUTATION_SIGNALS: RegExp[] = [
  /\bcalculate\b/i, /\bcompute\b/i, /\btotal\b/i, /\bmultip/i,
  /\bdivide\b/i, /\bpercentage\b/i,
  /\d+\s*[x×]\s*(of|the|medical|total)/i, /\d+(\.\d+)?%/,
  /\bhow much\b/i, /\bwhat is\b.*\$/i, /\badd\b.*\binterest\b/i,
  /\byield\s+improv/i, /\bArrhenius\b/i, /\bROI\b/i,
  /\bbreak[\s-]even\b/i, /\bannual\s+savings\b/i,
];

function hasMarkers(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

// ─── Person Detection ───────────────────────────────────────────────────────

const IDENTITY_ENTITY_TYPES = new Set([
  'PERSON', 'SSN', 'EMAIL', 'CREDIT_CARD', 'PASSPORT_NUMBER',
  'DRIVERS_LICENSE', 'MEDICAL_RECORD', 'PHONE_NUMBER',
]);

function hasIdentifiedPersons(entities: DetectedEntity[]): boolean {
  return entities.some(e => IDENTITY_ENTITY_TYPES.has(e.type));
}

// ─── Executive Rules Evaluation ─────────────────────────────────────────────

interface RuleMatch {
  name: string;
  action: RouteDecision;
  hits: number;
}

function evaluateRules(text: string, industry: string): RuleMatch[] {
  const rules = EXECUTIVE_RULES[industry];
  if (!rules) return [];

  const matches: RuleMatch[] = [];
  for (const rule of rules) {
    let hits = 0;
    for (const pat of rule.patterns) {
      if (pat.test(text)) hits++;
    }
    const threshold = rule.threshold ?? 2;
    if (hits >= threshold) {
      matches.push({ name: rule.name, action: rule.action, hits });
    }
  }
  return matches;
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Analyze a prompt through the Executive Lens and determine the routing
 * decision. Runs entirely client-side, < 2ms.
 *
 * Decision hierarchy:
 *   1. Executive rules fired with private_llm → private_llm
 *   2. Executive rules fired with pseudonymize → pseudonymize
 *   3. Identified persons + computation needed → private_llm
 *   4. Identified persons OR confidential document → pseudonymize
 *   5. Otherwise → passthrough
 */
export function analyzeWithExecutiveLens(
  text: string,
  entities: DetectedEntity[],
): ExecutiveLensResult {
  const industry = detectIndustry(text);
  const personsPresent = hasIdentifiedPersons(entities);
  const isConfidential =
    hasMarkers(text, CONFIDENTIALITY_MARKERS) ||
    hasMarkers(text, FINANCIAL_CONTEXT) ||
    hasMarkers(text, HEALTHCARE_CONTEXT);
  const needsComputation = hasMarkers(text, COMPUTATION_SIGNALS);

  // Evaluate industry-specific executive rules
  const ruleMatches = industry ? evaluateRules(text, industry) : [];
  const triggeredRules = ruleMatches.map(r => r.name);

  // Find the most restrictive executive rule action
  const hasPrivateLlmRule = ruleMatches.some(r => r.action === 'private_llm');
  const hasPseudonymizeRule = ruleMatches.some(r => r.action === 'pseudonymize');

  // Decision hierarchy
  let route: RouteDecision;
  let explanation: string;

  if (hasPrivateLlmRule) {
    route = 'private_llm';
    const ruleName = ruleMatches.find(r => r.action === 'private_llm')!.name;
    explanation = `${industry} industry: "${ruleName}" detected — routing to private LLM.`;
  } else if (hasPseudonymizeRule) {
    route = 'pseudonymize';
    const ruleName = ruleMatches.find(r => r.action === 'pseudonymize')!.name;
    explanation = `${industry} industry: "${ruleName}" detected — pseudonymizing before sending.`;
  } else if (personsPresent && needsComputation) {
    route = 'private_llm';
    explanation = 'Identified persons with computation needed — routing to private LLM to preserve accuracy.';
  } else if (personsPresent || isConfidential) {
    route = 'pseudonymize';
    explanation = personsPresent
      ? 'Identified persons detected — pseudonymizing to protect identity.'
      : 'Confidential document markers detected — pseudonymizing.';
  } else if (entities.length > 0) {
    // Has entities but no persons/confidentiality — still pseudonymize
    route = 'pseudonymize';
    explanation = `${entities.length} entities detected — pseudonymizing as precaution.`;
  } else {
    route = 'passthrough';
    explanation = 'No sensitive content detected — safe to send.';
  }

  return {
    route,
    industry,
    triggeredRules,
    hasIdentifiedPersons: personsPresent,
    needsComputation,
    isConfidential,
    explanation,
  };
}

/**
 * Check if a private LLM is available and reachable.
 * Used to gracefully fall back to pseudonymize when private LLM is down.
 */
export function resolveRoute(
  lensResult: ExecutiveLensResult,
  hasPrivateLlm: boolean,
): RouteDecision {
  if (lensResult.route === 'private_llm' && !hasPrivateLlm) {
    // Private LLM not configured — fall back to pseudonymize (safer than passthrough)
    return 'pseudonymize';
  }
  return lensResult.route;
}
