/**
 * Risk Assessor — The "General Counsel Review" Layer
 *
 * This is the intelligence layer that sits ABOVE entity detection.
 * Entity detection answers: "WHAT is in the text?"
 * Risk assessment answers: "SO WHAT? WHY does it matter? WHAT happens if it leaks?"
 *
 * Think of it as four executives reviewing every message:
 *
 *   CEO:  "What's the business risk? Could this kill a deal or tank our stock?"
 *   CTO:  "Are there credentials or system access details that could be exploited?"
 *   CIO:  "What regulations apply? HIPAA? GDPR? ITAR? Are we compliant?"
 *   CISO: "Is this an active threat? Could this enable an attack?"
 *
 * The assessor takes:
 *   - Detected entities (from regex + LLM + dictionary)
 *   - Document classification (from keyword patterns)
 *   - The raw text
 *
 * And produces a structured risk assessment with:
 *   - Risk categories (MNPI, HIPAA, ITAR, discrimination, etc.)
 *   - Consequence analysis (what happens if this leaks)
 *   - Regulatory exposure (which laws/regulations apply)
 *   - Recommended action (BLOCK / WARN / ALLOW)
 *   - Human-readable explanation (why this is dangerous)
 *
 * Two modes:
 *   1. FAST (rule-based): ~2ms, runs always. Catches obvious risks.
 *   2. DEEP (LLM-assisted): ~300ms, runs when fast mode is uncertain.
 *      Uses the model runtime to reason about context, relationships,
 *      indirect identifiers, and domain-specific regulations.
 */

import type { DetectedEntity } from '../detection/types';
import type { ModelRuntime } from './model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskCategory =
  | 'MNPI'               // Material non-public information (securities)
  | 'HIPAA_PHI'          // Protected health information
  | 'ATTORNEY_PRIVILEGE'  // Attorney-client privileged communication
  | 'TRADE_SECRET'       // Proprietary/trade secret information
  | 'ITAR_EXPORT'        // Export-controlled / ITAR
  | 'CLASSIFIED'         // Government classified information
  | 'FERPA'              // Student education records
  | 'GDPR_PII'           // EU personal data under GDPR
  | 'DISCRIMINATION'     // Content that could enable discrimination
  | 'CREDENTIAL_LEAK'    // Active credentials / system access
  | 'RETALIATION'        // Whistleblower / complainant identity exposure
  | 'IDENTITY_THEFT'     // Sufficient PII for identity theft
  | 'INSIDER_THREAT'     // Content about active investigations
  | 'COMPETITIVE_INTEL'  // Competitive intelligence / strategy
  | 'RE_IDENTIFICATION'  // Indirect identifiers that can ID someone
  | 'FINANCIAL_FRAUD'    // Content enabling financial fraud
  | 'CHILD_PRIVACY'      // Minor's personal information
  | 'AML_BSA'            // Anti-money laundering / BSA
  | 'EMPLOYMENT_LAW';    // Wrongful termination, harassment, etc.

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RecommendedAction = 'ALLOW' | 'WARN' | 'REDACT' | 'BLOCK';

export interface RiskSignal {
  category: RiskCategory;
  severity: RiskSeverity;
  /** What was detected */
  signal: string;
  /** Why it's dangerous */
  consequence: string;
  /** Which regulation/law applies */
  regulation?: string;
  /** Which C-suite role cares most */
  owner: 'CEO' | 'CTO' | 'CIO' | 'CISO';
  /** Confidence in this assessment (0-1) */
  confidence: number;
}

export interface RiskAssessment {
  /** Overall risk level */
  level: RiskSeverity;
  /** Overall risk score (0-100) */
  score: number;
  /** All identified risk signals */
  risks: RiskSignal[];
  /** What to do */
  action: RecommendedAction;
  /** One-sentence summary a CEO would understand */
  headline: string;
  /** Detailed explanation */
  explanation: string;
  /** Which regulations are implicated */
  regulations: string[];
  /** Was the LLM used for deep analysis? */
  usedDeepAnalysis: boolean;
  /** Processing time */
  latencyMs: number;
}

export interface RiskAssessorInput {
  text: string;
  entities: DetectedEntity[];
  documentType?: string;
  contextualMarkers?: Array<{ category: string; weight: number; confidence: number; matched?: string }>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createRiskAssessor(runtime?: ModelRuntime) {
  /**
   * Assess the risk of content being sent to an AI tool.
   *
   * Always runs fast (rule-based) assessment.
   * Optionally runs deep (LLM) assessment when:
   *   - Fast assessment is uncertain (medium zone)
   *   - Content has contextual signals but few entities
   *   - High-value document types (board minutes, legal memos)
   */
  async function assess(input: RiskAssessorInput): Promise<RiskAssessment> {
    const start = performance.now();

    // Step 1: Fast rule-based assessment (always runs, <2ms)
    const fastRisks = fastAssess(input);

    // Step 2: Determine if deep analysis is needed
    const fastScore = computeRiskScore(fastRisks);
    const fastLevel = scoreToSeverity(fastScore);
    const needsDeep = shouldRunDeep(fastRisks, fastScore, input);

    // Step 3: Deep LLM assessment (conditional)
    let deepRisks: RiskSignal[] = [];
    let usedDeep = false;

    if (needsDeep && runtime) {
      try {
        deepRisks = await deepAssess(runtime, input, fastRisks);
        usedDeep = true;
      } catch {
        // LLM failed — fast assessment is our answer
      }
    }

    // Step 4: Merge fast + deep risks (dedup by category)
    const allRisks = mergeRisks(fastRisks, deepRisks);
    const finalScore = computeRiskScore(allRisks);
    const finalLevel = scoreToSeverity(finalScore);
    const action = levelToAction(finalLevel);

    // Step 5: Generate human-readable output
    const headline = generateHeadline(allRisks, finalLevel);
    const explanation = generateExplanation(allRisks);
    const regulations = extractRegulations(allRisks);

    return {
      level: finalLevel,
      score: finalScore,
      risks: allRisks,
      action,
      headline,
      explanation,
      regulations,
      usedDeepAnalysis: usedDeep,
      latencyMs: performance.now() - start,
    };
  }

  return { assess };
}

// ── Fast Assessment (Rule-Based, <2ms) ──────────────────────────────────────

function fastAssess(input: RiskAssessorInput): RiskSignal[] {
  const risks: RiskSignal[] = [];
  const { text, entities, documentType, contextualMarkers } = input;
  const lower = text.toLowerCase();

  // ── CISO Lens: Credential & Infrastructure Risk ─────────────────────────

  const credentialTypes = new Set(['API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL',
    'AZURE_CREDENTIAL', 'DATABASE_URI', 'AUTH_TOKEN', 'PRIVATE_KEY']);
  const credentials = entities.filter(e => credentialTypes.has(e.type));

  if (credentials.length > 0) {
    const isProduction = /\b(prod|production|live|sk_live)\b/i.test(text);
    risks.push({
      category: 'CREDENTIAL_LEAK',
      severity: isProduction ? 'critical' : 'high',
      signal: `${credentials.length} credential(s) detected${isProduction ? ' (PRODUCTION)' : ''}`,
      consequence: isProduction
        ? 'Production system compromise — immediate unauthorized access to live systems, databases, or payment processing'
        : 'Credential exposure — potential unauthorized system access',
      regulation: 'SOC 2, PCI-DSS',
      owner: 'CISO',
      confidence: 0.95,
    });
  }

  const ipAddresses = entities.filter(e => e.type === 'IP_ADDRESS');
  if (ipAddresses.length > 0 && /\b(internal|prod|staging|10\.|172\.|192\.168)\b/i.test(text)) {
    risks.push({
      category: 'CREDENTIAL_LEAK',
      severity: 'high',
      signal: 'Internal IP addresses exposed',
      consequence: 'Network topology revelation enables targeted attacks',
      owner: 'CISO',
      confidence: 0.8,
    });
  }

  // ── CEO Lens: Business & Deal Risk ──────────────────────────────────────

  // MNPI Detection
  const hasDealLanguage = /\b(acqui|merger|LOI|term\s+sheet|buyout|LBO|IPO|spin[\s-]?off|debt[\s-]for[\s-]equity|recapitaliz|restructur)\b/i.test(text);
  const hasFinancialTerms = /\b(valuation|pre[\s-]?money|EBITDA|revenue\s+miss|earnings|guidance|EPS|consensus|net\s+IRR|TVPI|DPI|reserve|write[\s-]?down)\b/i.test(text);
  const hasMonetaryEntities = entities.filter(e => e.type === 'MONETARY_AMOUNT').length > 0;
  const isConfidential = /\b(confidential|strictly\s+confidential|do\s+not\s+(distribute|forward|share)|internal\s+only|embargoed?|not\s+(?:yet\s+)?(?:public|announced|disclosed)|eyes\s+only|pre[\s-]?announcement|do\s+not\s+discuss\b.*?\bexternally)\b/i.test(text);
  const hasTickerSymbol = /\b(NYSE|NASDAQ|TSX|LSE|FTSE)\s*:\s*[A-Z]+\b/.test(text) ||
    /\b(?:ticker|symbol)\s*:\s*[A-Z]{2,5}\b/i.test(text) ||
    /\([A-Z]+:\s*[A-Z]{2,5}\)/i.test(text);
  const hasPreRelease = /\b(pre[\s-]?release|embargo|before\s+(?:market|announcement|earnings)|will\s+be\s+announced|press\s+release.*?draft|not\s+yet\s+filed)\b/i.test(text);

  if ((hasDealLanguage || hasTickerSymbol) && hasMonetaryEntities && isConfidential) {
    risks.push({
      category: 'MNPI',
      severity: 'critical',
      signal: 'Unannounced deal/transaction with financial details',
      consequence: 'Trading on this information constitutes securities fraud (Section 10(b), Rule 10b-5). Deal leak could collapse the transaction.',
      regulation: 'Securities Exchange Act, Reg FD, MAR (EU)',
      owner: 'CEO',
      confidence: 0.92,
    });
  } else if (hasPreRelease && hasMonetaryEntities && (hasFinancialTerms || hasTickerSymbol)) {
    risks.push({
      category: 'MNPI',
      severity: 'critical',
      signal: 'Pre-release financial data with embargo or timing sensitivity',
      consequence: 'Pre-announcement financial data could enable insider trading. Embargo violation triggers Reg FD liability.',
      regulation: 'Securities Exchange Act, Reg FD',
      owner: 'CEO',
      confidence: 0.88,
    });
  } else if (hasFinancialTerms && isConfidential && hasMonetaryEntities) {
    risks.push({
      category: 'MNPI',
      severity: 'high',
      signal: 'Confidential financial information',
      consequence: 'Pre-release financial data could enable insider trading',
      regulation: 'Securities Exchange Act, Reg FD',
      owner: 'CEO',
      confidence: 0.75,
    });
  } else if (hasTickerSymbol && hasFinancialTerms && hasMonetaryEntities) {
    risks.push({
      category: 'MNPI',
      severity: 'high',
      signal: 'Financial data referencing publicly traded company',
      consequence: 'Non-public financial details about a public company could constitute insider information',
      regulation: 'Securities Exchange Act, Reg FD',
      owner: 'CEO',
      confidence: 0.7,
    });
  }

  // Board minutes / executive compensation
  if (/\b(board\s+(of\s+directors|meeting|minutes|resolution)|compensation\s+committee)\b/i.test(text)) {
    if (entities.filter(e => e.type === 'PERSON').length >= 3 && hasMonetaryEntities) {
      risks.push({
        category: 'MNPI',
        severity: 'critical',
        signal: 'Board-level discussion with named executives and financial details',
        consequence: 'Board deliberations are among the most sensitive corporate documents. Leak triggers shareholder litigation and SEC scrutiny.',
        regulation: 'Securities laws, fiduciary duty, Reg FD',
        owner: 'CEO',
        confidence: 0.9,
      });
    }
  }

  // Layoff / restructuring
  if (/\b(layoff|restructur|reduction[\s-]in[\s-]force|RIF|headcount\s+reduction|termination|severance)\b/i.test(text)) {
    const hasEmbargoDate = /\b(announcement\s+date|embargo|not\s+announce|before\s+\w+\s+\d)\b/i.test(text);
    const hasNames = entities.filter(e => e.type === 'PERSON').length > 0;
    if (hasNames || hasEmbargoDate) {
      risks.push({
        category: 'EMPLOYMENT_LAW',
        severity: hasEmbargoDate ? 'critical' : 'high',
        signal: 'Workforce reduction plan with employee details',
        consequence: 'Pre-announcement leak violates WARN Act. Named employees could face premature disclosure of termination.',
        regulation: 'WARN Act, state mini-WARN laws',
        owner: 'CEO',
        confidence: 0.85,
      });
    }
  }

  // ── CIO Lens: Regulatory & Compliance Risk ──────────────────────────────

  // HIPAA / PHI
  const hasMedicalTerms = /\b(patient|diagnosis|treatment|medication|clinical|PHI|HIPAA|medical\s+record|MRN)\b/i.test(text);
  const hasMedicalEntities = entities.some(e => e.type === 'MEDICAL_RECORD');
  const hasSSNinMedical = hasMedicalTerms && entities.some(e => e.type === 'SSN');
  const hasPersonInMedical = hasMedicalTerms && entities.some(e => e.type === 'PERSON');

  if (hasMedicalTerms && (hasPersonInMedical || hasMedicalEntities || hasSSNinMedical)) {
    // Check for psychotherapy notes (highest HIPAA protection)
    const isPsychotherapy = /\b(psychotherapy|therapy\s+notes?|progress\s+note|GAD-7|PHQ-9|suicid|mental\s+health)\b/i.test(text);
    risks.push({
      category: 'HIPAA_PHI',
      severity: 'critical',
      signal: isPsychotherapy
        ? 'Psychotherapy notes with patient identity — highest HIPAA protection level'
        : 'Protected health information with patient identity',
      consequence: isPsychotherapy
        ? 'Psychotherapy notes have special protection under HIPAA (45 CFR §164.508(a)(2)). Unauthorized disclosure: $50K-$1.5M per violation.'
        : 'HIPAA violation — $100-$50K per violation, up to $1.5M annually. Criminal penalties for knowing disclosure.',
      regulation: isPsychotherapy ? 'HIPAA, 42 CFR Part 2' : 'HIPAA Privacy Rule, HITECH Act',
      owner: 'CIO',
      confidence: 0.93,
    });
  }

  // FERPA
  if (/\b(FERPA|student\s+(record|ID|disciplin)|IEP|504\s+plan)\b/i.test(text) && entities.some(e => e.type === 'PERSON')) {
    risks.push({
      category: 'FERPA',
      severity: 'critical',
      signal: 'Student education record with identifiable student',
      consequence: 'FERPA violation — school risks losing ALL federal funding. Student disability/disciplinary records have heightened protection.',
      regulation: 'FERPA (20 U.S.C. §1232g), IDEA',
      owner: 'CIO',
      confidence: 0.9,
    });
  }

  // GDPR
  if (/\b(GDPR|DSAR|data\s+subject|Steuer[\s-]?ID|IBAN\s*:|BDSG|Datenschutz)\b/i.test(text)) {
    risks.push({
      category: 'GDPR_PII',
      severity: 'critical',
      signal: 'EU personal data subject to GDPR',
      consequence: 'GDPR violation — fine up to 4% of global annual revenue or €20M, whichever is greater.',
      regulation: 'GDPR Art. 5/6/9, BDSG (Germany)',
      owner: 'CIO',
      confidence: 0.9,
    });
  }

  // Attorney-client privilege
  if (/\b(attorney[\s-]client\s+privilege|privileged\s+and\s+confidential|work\s+product\s+doctrine|privilege\s+circle)\b/i.test(text)) {
    risks.push({
      category: 'ATTORNEY_PRIVILEGE',
      severity: 'critical',
      signal: 'Attorney-client privileged communication',
      consequence: 'Sending privileged content to AI waives privilege over THIS communication AND potentially all related communications. Irreversible.',
      regulation: 'Federal Rules of Evidence 502, ABA Model Rules',
      owner: 'CEO',
      confidence: 0.95,
    });
  }

  // ITAR / Export Control
  if (/\b(ITAR|USML|export\s+control|ECCN\s+\d|EAR\s+99|controlled\s+technology|defense\s+article)\b/i.test(text)) {
    risks.push({
      category: 'ITAR_EXPORT',
      severity: 'critical',
      signal: 'Export-controlled technical data',
      consequence: 'ITAR violation — criminal penalties up to 20 years imprisonment, $1M per violation. Debarment from government contracts.',
      regulation: 'ITAR (22 CFR 120-130), EAR (15 CFR 730-774)',
      owner: 'CIO',
      confidence: 0.92,
    });
  }

  // Classified information and law enforcement sensitive
  if (/\b(SECRET\/\/|TOP\s+SECRET|TS\/\/SCI|NOFORN|SAPCO|classified\s+information|law\s+enforcement\s+sensitive|FISA|sealed|grand\s+jury|intelligence\s+assessment|SIGINT|HUMINT|safeguards\s+information)\b/i.test(text)) {
    risks.push({
      category: 'CLASSIFIED',
      severity: 'critical',
      signal: 'Government classified information',
      consequence: 'Unauthorized disclosure of classified information — federal crime under Espionage Act (18 U.S.C. §793). Imprisonment up to 10 years.',
      regulation: 'Espionage Act, EO 13526',
      owner: 'CISO',
      confidence: 0.98,
    });
  }

  // AML / BSA
  if (/\b(SAR|suspicious\s+activity|money\s+laundering|BSA|peel\s+chain|structuring|smurfing)\b/i.test(text)) {
    risks.push({
      category: 'AML_BSA',
      severity: 'critical',
      signal: 'Anti-money laundering investigation or suspicious activity report',
      consequence: 'Tipping off the subject of a SAR is a federal crime (31 U.S.C. §5318(g)(2)). Imprisonment up to 5 years.',
      regulation: 'Bank Secrecy Act, FinCEN regulations',
      owner: 'CIO',
      confidence: 0.88,
    });
  }

  // ── Cross-Role: Identity Theft Risk ─────────────────────────────────────

  const ssnCount = entities.filter(e => e.type === 'SSN').length;
  const hasAddress = /\b\d+\s+\w+\s+(street|st|drive|dr|avenue|ave|lane|ln|blvd|road|rd)\b/i.test(text);
  const hasDOB = /\bDOB\b|date\s+of\s+birth/i.test(text) || entities.some(e => e.type === 'DATE');
  const hasName = entities.some(e => e.type === 'PERSON');

  const hasAccountNum = entities.some(e => e.type === 'ACCOUNT_NUMBER' || e.type === 'EU_IBAN');
  const hasInsuranceId = /\b(?:insurance\s+ID|policy\s+(?:#|number|no)|group\s*#?:?\s*\d|member\s+ID)\b/i.test(text);
  const hasAlienNumber = /\b(?:A-?\s*(?:number|#)|alien\s+(?:number|registration)|USCIS)\b/i.test(text);
  const identifiers = [ssnCount > 0, hasAddress, hasDOB, hasName, hasAccountNum, hasInsuranceId, hasAlienNumber].filter(Boolean).length;

  if (ssnCount > 0 && hasName) {
    risks.push({
      category: 'IDENTITY_THEFT',
      severity: identifiers >= 3 ? 'critical' : 'high',
      signal: `${identifiers} identity authenticators present (name${ssnCount > 0 ? ' + SSN' : ''}${hasDOB ? ' + DOB' : ''}${hasAddress ? ' + address' : ''})`,
      consequence: identifiers >= 3
        ? 'Complete identity theft package — sufficient to open accounts, file fraudulent tax returns, or commit medical identity fraud'
        : 'Partial identity theft risk — SSN + name enables significant fraud',
      regulation: 'FTC Red Flags Rule, state breach notification laws',
      owner: 'CISO',
      confidence: 0.9,
    });
  } else if (hasName && identifiers >= 3 && !ssnCount) {
    risks.push({
      category: 'IDENTITY_THEFT',
      severity: 'high',
      signal: `${identifiers} identity authenticators present without SSN (name${hasDOB ? ' + DOB' : ''}${hasAddress ? ' + address' : ''}${hasAccountNum ? ' + account' : ''}${hasInsuranceId ? ' + insurance ID' : ''}${hasAlienNumber ? ' + alien number' : ''})`,
      consequence: 'Multiple identity authenticators together enable identity fraud even without SSN — sufficient for account takeover, insurance fraud, or immigration fraud.',
      regulation: 'FTC Red Flags Rule, state breach notification laws',
      owner: 'CISO',
      confidence: 0.8,
    });
  }

  // ── Cross-Role: Discrimination Risk ─────────────────────────────────────

  // Pregnancy + employment action
  if (/\b(pregnan|FMLA|maternity)\b/i.test(text) &&
      /\b(terminat|PIP|performance\s+(improvement|review)|severance|layoff)\b/i.test(text)) {
    risks.push({
      category: 'DISCRIMINATION',
      severity: 'critical',
      signal: 'Pregnancy/FMLA status mentioned alongside adverse employment action',
      consequence: 'Pregnancy Discrimination Act violation. The document itself becomes evidence of discriminatory intent in litigation.',
      regulation: 'Title VII, Pregnancy Discrimination Act, FMLA',
      owner: 'CEO',
      confidence: 0.92,
    });
  }

  // Disability + employment
  if (/\b(disabilit|ADA|IEP|accommodat|ADHD|mental\s+health)\b/i.test(text) &&
      /\b(terminat|review|disciplin|complaint)\b/i.test(text) &&
      hasName) {
    risks.push({
      category: 'DISCRIMINATION',
      severity: 'high',
      signal: 'Disability/health status in employment or education context',
      consequence: 'ADA/IDEA violation risk — disability information linked to adverse action creates discrimination liability',
      regulation: 'ADA, IDEA, Section 504',
      owner: 'CEO',
      confidence: 0.8,
    });
  }

  // Visa status + termination
  if (/\b(H-1B|visa|immigration|work\s+permit|green\s+card|USCIS)\b/i.test(text) &&
      /\b(terminat|layoff|severance|restructur)\b/i.test(text)) {
    risks.push({
      category: 'EMPLOYMENT_LAW',
      severity: 'high',
      signal: 'Immigration status disclosed in termination context',
      consequence: 'Visa-holder faces deportation. Immigration status in termination documents creates national origin discrimination risk.',
      regulation: 'INA, Title VII (national origin)',
      owner: 'CEO',
      confidence: 0.82,
    });
  }

  // ── CIO Lens: Substance Abuse Records (42 CFR Part 2) ──────────────

  if (/\b(42\s+CFR|substance\s+abuse|drug\s+(?:test|screen)|narco(?:tic|an)|opioid|fentanyl|methamphetamine|cocaine|buprenorphine|methadone|naltrexone|naloxone|sobriety|sober|relapse|overdose|detox|MAT|medication[\s-]assisted)\b/i.test(text) &&
      hasName) {
    risks.push({
      category: 'HIPAA_PHI',
      severity: 'critical',
      signal: 'Substance abuse treatment record with identifiable individual',
      consequence: '42 CFR Part 2 provides STRICTER protection than HIPAA — substance abuse records cannot be disclosed even to other healthcare providers without specific written consent.',
      regulation: 'HIPAA, 42 CFR Part 2, ADA',
      owner: 'CIO',
      confidence: 0.9,
    });
  }

  // ── Cross-Role: Harassment / Investigation ────────────────────────────

  if (/\b(sexual\s+harassment|hostile\s+work\s+environment|Title\s+IX|investigation\s+report|harassment\s+complaint|harassment\s+allegation)\b/i.test(text) &&
      hasName) {
    risks.push({
      category: 'EMPLOYMENT_LAW',
      severity: 'critical',
      signal: 'Harassment investigation with named individuals',
      consequence: 'Investigation reports sent to AI risk waiving investigation privilege. Named complainants and witnesses face retaliation risk.',
      regulation: 'Title VII, Title IX, state anti-harassment laws',
      owner: 'CEO',
      confidence: 0.88,
    });
  }

  // ── Cross-Role: Gender/Race Pay Analysis ──────────────────────────────

  if (/\b(pay\s+(?:gap|equity|analysis|disparity)|gender\s+pay|compensation\s+(?:analysis|gap))\b/i.test(text) &&
      /\b(male|female|gender|race|ethnicity|statistically\s+significant)\b/i.test(text)) {
    risks.push({
      category: 'DISCRIMINATION',
      severity: 'critical',
      signal: 'Compensation analysis revealing demographic pay disparities',
      consequence: 'Statistical pay gap analysis is litigation evidence. Document itself proves employer awareness of disparity — triggering affirmative obligation to remediate.',
      regulation: 'Equal Pay Act, Title VII, state pay equity laws',
      owner: 'CEO',
      confidence: 0.9,
    });
  }

  // ── Cross-Role: Whistleblower / Retaliation ─────────────────────────────

  if (/\b(whistleblower|anonymous\s+(report|complaint|submission)|retaliation|qui\s+tam)\b/i.test(text)) {
    risks.push({
      category: 'RETALIATION',
      severity: 'critical',
      signal: 'Whistleblower identity or complaint details',
      consequence: 'Exposing whistleblower identity is a federal crime under Dodd-Frank and SOX. Retaliation triggers treble damages.',
      regulation: 'Dodd-Frank §922, SOX §806, False Claims Act',
      owner: 'CEO',
      confidence: 0.9,
    });
  }

  // ── Cross-Role: Trade Secret ────────────────────────────────────────────

  if (/\b(trade\s+secret|proprietary|do\s+not\s+distribute|formulation|patent\s+(?:application|pending|provisional))\b/i.test(text) &&
      isConfidential) {
    risks.push({
      category: 'TRADE_SECRET',
      severity: 'high',
      signal: 'Proprietary information or pending patent details',
      consequence: 'Trade secret misappropriation under DTSA. Sending to AI tool may destroy trade secret status (loss of secrecy).',
      regulation: 'Defend Trade Secrets Act (DTSA), Uniform Trade Secrets Act',
      owner: 'CEO',
      confidence: 0.78,
    });
  }

  // ── Cross-Role: Competitive Intelligence ────────────────────────────────

  if (/\b(competitor|competitive\s+intelligence|market\s+share|pricing\s+strategy|benchmark.*vs)\b/i.test(text) &&
      entities.some(e => e.type === 'ORGANIZATION')) {
    risks.push({
      category: 'COMPETITIVE_INTEL',
      severity: 'medium',
      signal: 'Competitive intelligence with named competitors',
      consequence: 'Competitive strategy leak — gives rivals insight into positioning, pricing, or market plans',
      owner: 'CEO',
      confidence: 0.65,
    });
  }

  // ── Cross-Role: Child Privacy ───────────────────────────────────────────

  if (/\b(minor|child|age\s+\d{1,2}\b|DOB.*20[12]\d|under\s+1[38]|grade\s+[1-9K]|kindergarten|elementary)\b/i.test(text)) {
    if (/\b(custody|divorce|disciplin|medical|therapy|abuse|neglect|CPS|child\s+protective|mandatory\s+report|bruising|injury)\b/i.test(text)) {
      risks.push({
        category: 'CHILD_PRIVACY',
        severity: 'critical',
        signal: 'Minor child in sensitive context (abuse, custody, medical, disciplinary)',
        consequence: 'Children have heightened privacy protections. Child abuse reports are confidential by law. Disclosure creates safety risks for the child.',
        regulation: 'COPPA, CAPTA, state child privacy/abuse reporting laws, FERPA',
        owner: 'CIO',
        confidence: 0.9,
      });
    }
  }

  // ── Indirect Identifier Detection (rule-based heuristic) ────────────────

  // Count "quasi-identifiers" — data points that together can re-identify
  const quasiIdentifiers = [
    /\b(VP|Director|Senior|Chief|Head)\s+of\s+\w+/i.test(text),         // Title
    /\b(joined|started|hired)\s+in\s+20\d\d/i.test(text),              // Join date
    /\b(only\s+person|only\s+one|sole)\b/i.test(text),                 // Uniqueness marker
    /\b(reports?\s+to|manager|supervisor)\b/i.test(text),               // Reporting line
    /\b(Austin|Seattle|NYC|SF|London)\s+(office|team)/i.test(text),     // Office location
    /\b(department|division|team)\b.*\b(engineering|product|sales|legal|finance)\b/i.test(text), // Department
  ].filter(Boolean).length;

  if (quasiIdentifiers >= 3 && !hasName) {
    risks.push({
      category: 'RE_IDENTIFICATION',
      severity: 'high',
      signal: `${quasiIdentifiers} quasi-identifiers present without explicit name — likely re-identifiable`,
      consequence: 'Combination of title + location + tenure + uniqueness markers can uniquely identify an individual. GDPR/CCPA treat this as personal data.',
      regulation: 'GDPR Art. 4(1) (identifiable person), CCPA §1798.140(o)',
      owner: 'CIO',
      confidence: 0.7 + (quasiIdentifiers * 0.05),
    });
  }

  return risks;
}

// ── Deep Assessment (LLM-Assisted) ──────────────────────────────────────────

const RISK_ASSESSMENT_PROMPT = `You are a Chief Legal & Compliance Officer reviewing content before it's sent to an AI assistant. Your job is to identify ALL risks that rule-based systems miss.

Think like four executives simultaneously:
- CEO: Business risk, deal exposure, shareholder liability
- CTO: Technical exploitation, infrastructure compromise
- CIO: Regulatory violations, compliance failures, data governance
- CISO: Active threats, attack vectors, security incidents

OUTPUT FORMAT: Return ONLY a valid JSON array. No markdown, no explanation.

Each risk object:
{"category": "RISK_CATEGORY", "severity": "low|medium|high|critical", "signal": "what you found", "consequence": "what happens if leaked", "regulation": "applicable law/regulation", "owner": "CEO|CTO|CIO|CISO", "confidence": 0.0-1.0}

RISK CATEGORIES: MNPI, HIPAA_PHI, ATTORNEY_PRIVILEGE, TRADE_SECRET, ITAR_EXPORT, CLASSIFIED, FERPA, GDPR_PII, DISCRIMINATION, CREDENTIAL_LEAK, RETALIATION, IDENTITY_THEFT, INSIDER_THREAT, COMPETITIVE_INTEL, RE_IDENTIFICATION, FINANCIAL_FRAUD, CHILD_PRIVACY, AML_BSA, EMPLOYMENT_LAW

FOCUS ON WHAT RULES MISS:
1. INDIRECT IDENTIFIERS: "VP of Engineering, Austin office, joined 2019" = re-identifiable even without a name
2. COMBINED RISK: Pregnancy + PIP = discrimination evidence. SSN + DOB + address = identity theft package.
3. TIMING: "embargo until March 15" means leaking NOW is different from leaking later
4. INTENT: "do not share with JV partner" reveals internal strategy
5. REGULATORY CONTEXT: Is this MNPI? HIPAA? ITAR? Which specific law applies?
6. CONSEQUENCE CHAIN: "CFO resigned during bankruptcy" → leadership vacuum → creditor panic → deal collapse

Return [] if no additional risks beyond what entities/keywords already catch.`;

async function deepAssess(
  runtime: ModelRuntime,
  input: RiskAssessorInput,
  existingRisks: RiskSignal[],
): Promise<RiskSignal[]> {
  const truncated = input.text.length > 4000 ? input.text.substring(0, 4000) + '\n[...truncated]' : input.text;

  // Summarize what we already found so the LLM focuses on what's MISSING
  const existingSummary = existingRisks.length > 0
    ? '\n\nALREADY DETECTED:\n' + existingRisks.map(r => `- ${r.category}: ${r.signal}`).join('\n')
    : '';

  const entitySummary = input.entities.length > 0
    ? '\n\nENTITIES FOUND:\n' + input.entities.slice(0, 20).map(e => `- ${e.type}: "${e.text}"`).join('\n')
    : '';

  const userPrompt = `TEXT TO ASSESS:\n\n${truncated}${entitySummary}${existingSummary}\n\nWhat risks did the automated system MISS? Focus on contextual intelligence, indirect identifiers, regulatory implications, and consequence chains.`;

  const response = await Promise.race([
    runtime.complete({
      systemPrompt: RISK_ASSESSMENT_PROMPT,
      userPrompt,
      temperature: 0.05,
      maxTokens: 2048,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Risk assessment timed out')), 5000)
    ),
  ]);

  return parseLLMRisks(response.text);
}

function parseLLMRisks(output: string): RiskSignal[] {
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];

    const validCategories = new Set([
      'MNPI', 'HIPAA_PHI', 'ATTORNEY_PRIVILEGE', 'TRADE_SECRET', 'ITAR_EXPORT',
      'CLASSIFIED', 'FERPA', 'GDPR_PII', 'DISCRIMINATION', 'CREDENTIAL_LEAK',
      'RETALIATION', 'IDENTITY_THEFT', 'INSIDER_THREAT', 'COMPETITIVE_INTEL',
      'RE_IDENTIFICATION', 'FINANCIAL_FRAUD', 'CHILD_PRIVACY', 'AML_BSA', 'EMPLOYMENT_LAW',
    ]);

    return parsed.filter(
      (r: any): r is RiskSignal =>
        typeof r === 'object' &&
        typeof r.category === 'string' &&
        validCategories.has(r.category) &&
        typeof r.severity === 'string' &&
        typeof r.signal === 'string' &&
        typeof r.consequence === 'string' &&
        typeof r.confidence === 'number'
    );
  } catch {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shouldRunDeep(
  fastRisks: RiskSignal[],
  fastScore: number,
  input: RiskAssessorInput,
): boolean {
  // Always run deep for the uncertain "medium" zone
  if (fastScore >= 30 && fastScore <= 65) return true;

  // Run deep when we see contextual signals but few entity-based risks
  if ((input.contextualMarkers?.length ?? 0) > 0 && fastRisks.length <= 1) return true;

  // Run deep for high-value document types
  const highValueDocs = new Set(['litigation_doc', 'government_doc', 'medical_record', 'financial_data']);
  if (input.documentType && highValueDocs.has(input.documentType) && fastRisks.length <= 2) return true;

  // Run deep for long documents with few detected risks (might be missing context)
  if (input.text.length > 1000 && fastRisks.length === 0 && input.entities.length > 3) return true;

  return false;
}

function mergeRisks(fast: RiskSignal[], deep: RiskSignal[]): RiskSignal[] {
  const merged = [...fast];

  for (const deepRisk of deep) {
    // Skip if fast already covers this category with equal or higher severity
    const existing = merged.find(r => r.category === deepRisk.category);
    if (existing) {
      const severityRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      if ((severityRank[deepRisk.severity] || 0) > (severityRank[existing.severity] || 0)) {
        // Deep analysis found higher severity — replace
        merged[merged.indexOf(existing)] = deepRisk;
      }
    } else {
      merged.push(deepRisk);
    }
  }

  return merged;
}

function computeRiskScore(risks: RiskSignal[]): number {
  if (risks.length === 0) return 0;

  const severityScores: Record<RiskSeverity, number> = {
    low: 10,
    medium: 35,
    high: 70,
    critical: 95,
  };

  // Highest severity risk is the baseline
  const maxSeverity = Math.max(...risks.map(r => severityScores[r.severity]));

  // Each additional risk adds to the score (diminishing returns)
  let additional = 0;
  for (const risk of risks.slice(1)) {
    additional += severityScores[risk.severity] * 0.1 * risk.confidence;
  }

  return Math.min(100, Math.round(maxSeverity + additional));
}

function scoreToSeverity(score: number): RiskSeverity {
  if (score <= 15) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 80) return 'high';
  return 'critical';
}

function levelToAction(level: RiskSeverity): RecommendedAction {
  switch (level) {
    case 'low': return 'ALLOW';
    case 'medium': return 'WARN';
    case 'high': return 'REDACT';
    case 'critical': return 'BLOCK';
  }
}

function generateHeadline(risks: RiskSignal[], level: RiskSeverity): string {
  if (risks.length === 0) return 'No significant risks detected.';

  const topRisk = risks.reduce((a, b) => {
    const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    return (rank[b.severity] || 0) > (rank[a.severity] || 0) ? b : a;
  });

  const actionMap: Record<RecommendedAction, string> = {
    ALLOW: 'Low risk',
    WARN: 'Review recommended',
    REDACT: 'Sensitive content must be redacted',
    BLOCK: 'Content should not be sent to AI',
  };

  return `${actionMap[levelToAction(level)]}: ${topRisk.signal}. ${risks.length > 1 ? `(${risks.length} risk signals total)` : ''}`;
}

function generateExplanation(risks: RiskSignal[]): string {
  if (risks.length === 0) return 'Content appears safe for AI processing.';

  const byOwner: Record<string, RiskSignal[]> = {};
  for (const risk of risks) {
    if (!byOwner[risk.owner]) byOwner[risk.owner] = [];
    byOwner[risk.owner].push(risk);
  }

  const parts: string[] = [];
  const ownerLabels: Record<string, string> = {
    CEO: 'Business Risk',
    CTO: 'Technical Risk',
    CIO: 'Compliance Risk',
    CISO: 'Security Risk',
  };

  for (const [owner, ownerRisks] of Object.entries(byOwner)) {
    parts.push(`${ownerLabels[owner] || owner}: ${ownerRisks.map(r => r.signal).join('; ')}`);
  }

  return parts.join('. ') + '.';
}

function extractRegulations(risks: RiskSignal[]): string[] {
  const regs = new Set<string>();
  for (const risk of risks) {
    if (risk.regulation) {
      regs.add(risk.regulation);
    }
  }
  return Array.from(regs);
}
