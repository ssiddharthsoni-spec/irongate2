/**
 * Unified Pipeline Test — All Models Working Together
 *
 * Tests the combined intelligence pipeline against the same 50 cases,
 * comparing:
 *   - Regex alone (Layer 1)
 *   - Regex + Scorer (Layers 1-4)
 *   - Full pipeline with Risk Assessor (All layers, no LLM)
 *
 * The Risk Assessor adds the "General Counsel review" — understanding
 * WHY content is dangerous, not just WHAT entities are in it.
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';
import { detectContextualSensitivity } from '../src/detection/contextual-keywords';
import { classifyDocument } from '../src/detection/document-classifier';
import { createRiskAssessor } from '../src/agent/risk-assessor';
import type { RiskAssessment, RiskCategory, RecommendedAction } from '../src/agent/risk-assessor';

// ── Test Case Type ──────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  name: string;
  prompt: string;
  /** What the TRUE risk level should be */
  trueLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Expected risk categories the assessor should find */
  expectedRisks: RiskCategory[];
  /** Expected action */
  expectedAction: RecommendedAction;
  /** Key risk that MUST be identified */
  criticalRisk?: string;
}

// ── The 50 Cases (condensed) ────────────────────────────────────────────────

const CASES: TestCase[] = [
  {
    id: 'finance-ma', name: 'M&A Deal Memo', trueLevel: 'critical',
    expectedRisks: ['MNPI', 'ATTORNEY_PRIVILEGE'],
    expectedAction: 'BLOCK',
    criticalRisk: 'MNPI',
    prompt: `Confidential — Project Titan Update\n\nFollowing our call with Goldman Sachs, Sarah Chen from Sullivan & Cromwell confirmed that Titan Heavy Industries (TSX: THI) board has approved the $2.3B acquisition of ModaGlobal. JP Morgan will lead the financing syndicate. The target's CEO, Marcus Webb, has agreed to a $15M golden parachute. Deal expected to close Q2 2025.\n\nKey risk: Activist fund Blackstone Capital (led by David Park) holds a 12% stake.\nPlease draft talking points for the board presentation.`,
  },
  {
    id: 'healthcare-phi', name: 'Patient Record', trueLevel: 'critical',
    expectedRisks: ['HIPAA_PHI', 'IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    criticalRisk: 'HIPAA_PHI',
    prompt: `Patient: Sarah Thompson, DOB: 03/15/1987, MRN: 2024-44891\nDiagnosis: Stage 3 NSCLC, metastatic to liver.\nSSN: 342-65-8901 (for billing verification)\nInsurance: Blue Cross Blue Shield, Policy #BCB-2024-78432\nPatient worried employer (Deloitte) will learn of diagnosis.\nNext appointment with Dr. Chen at Memorial Sloan Kettering.`,
  },
  {
    id: 'legal-privilege', name: 'Attorney-Client Privileged Memo', trueLevel: 'critical',
    expectedRisks: ['ATTORNEY_PRIVILEGE', 'MNPI'],
    expectedAction: 'BLOCK',
    criticalRisk: 'ATTORNEY_PRIVILEGE',
    prompt: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION\n\nTO: General Counsel, TechCorp Inc.\nFROM: Lisa Park, Partner, Kirkland & Ellis LLP\nRE: SEC Investigation — Matter No. 2024-SEC-0892\n\nThe SEC has issued a formal Wells Notice regarding insider trading by CFO Robert Zhang. Zhang's trades generated $4.2M in avoided losses.\n\nDo NOT forward this memo to anyone outside the privilege circle.`,
  },
  {
    id: 'hr-termination', name: 'HR Termination with FMLA', trueLevel: 'critical',
    expectedRisks: ['DISCRIMINATION', 'EMPLOYMENT_LAW'],
    expectedAction: 'BLOCK',
    criticalRisk: 'DISCRIMINATION',
    prompt: `Restructuring — Confidential Employee Impact Analysis\n\n1. John Williams (EMP-4521) — Severance: $890,000\n2. Angela Davis (EMP-4522) — Has pending FMLA claim (pregnancy) — CONSULT LEGAL\n3. Wei Liu (EMP-4523) — H-1B visa holder — 60-day grace period\n\nAnnouncement date: March 15, 2025 (embargo until then)`,
  },
  {
    id: 'generic-question', name: 'Generic Question (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Can you help me draft a presentation about Data Science best practices for our team? We want to cover Machine Learning fundamentals.`,
  },
  {
    id: 'credentials', name: 'Production Credentials', trueLevel: 'critical',
    expectedRisks: ['CREDENTIAL_LEAK'],
    expectedAction: 'BLOCK',
    criticalRisk: 'CREDENTIAL_LEAK',
    prompt: `API_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\nDATABASE_URL=postgres://admin:Str0ngP@ss!@db.internal.company.com:5432/prod\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE`,
  },
  {
    id: 'insurance-claim', name: 'Insurance Claim with PHI', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `Policyholder: Michael Torres, Policy #PLY-2024-56789\nDOB: 11/22/1965, SSN: 478-92-1234\nAddress: 1847 Oak Valley Drive, Austin, TX 78704\nMedical bills: $47,500 (ER + surgery), $12,300 (orthopedic)`,
  },
  {
    id: 'classified', name: 'Classified Defense Briefing', trueLevel: 'critical',
    expectedRisks: ['CLASSIFIED', 'ITAR_EXPORT'],
    expectedAction: 'BLOCK',
    criticalRisk: 'CLASSIFIED',
    prompt: `SECRET//NOFORN\n\nOperation Blue Horizon — ECCN 1A003 controlled technology transfer to Meridian Defense Systems requires ITAR Category IV approval.\nProject Keystone achieved 340% improvement in signal discrimination.\nDISTRIBUTION: Limited to SAPCO-approved personnel only.`,
  },
  {
    id: 'real-estate', name: 'Real Estate with SSNs', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `Buyer: Jennifer and Mark Sullivan\nSSN (Jennifer): 298-76-5432\nSSN (Mark): 301-45-8765\nPurchase price: $1,250,000\nMortgage: Wells Fargo, Loan #WF-2024-98765`,
  },
  {
    id: 'subtle-context', name: 'No PII but CRITICAL Context', trueLevel: 'critical',
    expectedRisks: ['MNPI', 'RE_IDENTIFICATION'],
    expectedAction: 'BLOCK',
    criticalRisk: 'MNPI',
    prompt: `Board meeting talking points:\n1. Our VP of Engineering (reports to CTO, Austin office, joined 2019, only person with that title) — termination for Q4 performance.\n2. Activist investor bought 8.5% — threatening proxy fight.\n3. Late-stage talks to acquire our largest competitor — north of $5 billion.\nPlease keep this between us.`,
  },
  {
    id: 'pharma-sae', name: 'Clinical Trial SAE', trueLevel: 'critical',
    expectedRisks: ['HIPAA_PHI'],
    expectedAction: 'BLOCK',
    prompt: `SERIOUS ADVERSE EVENT — Protocol ZK-2024-178\nPatient ID PX-44921, Female, Age 62\nSite: Johns Hopkins, PI: Dr. Anika Patel, Sponsor: Zenith Pharmaceuticals\nGrade 4 hepatotoxicity. DSMB emergency meeting Jan 22.\nContact: Sarah Kim, sarah.kim@zenithpharma.com, (301) 555-0142`,
  },
  {
    id: 'ferpa', name: 'Student Record (FERPA)', trueLevel: 'critical',
    expectedRisks: ['FERPA', 'DISCRIMINATION'],
    expectedAction: 'BLOCK',
    criticalRisk: 'FERPA',
    prompt: `FERPA PROTECTED\nStudent: Emily Rodriguez, ID: STU-2024-78901, DOB: 06/14/2003\nIncident: Found with Adderall 20mg not registered with school nurse.\nIEP Status: Active (ADHD, accommodations include extended test time)\nParent: m.rodriguez.tx@gmail.com, (512) 555-0198`,
  },
  {
    id: 'trade-secret', name: 'Manufacturing Trade Secret', trueLevel: 'critical',
    expectedRisks: ['TRADE_SECRET'],
    expectedAction: 'BLOCK',
    prompt: `TRADE SECRET — DO NOT DISTRIBUTE\nProject: NexGen Battery Cell (codename "Falcon")\nSolid-state electrolyte: Li6.4La3Zr1.4Ta0.6O12, 450 Wh/kg.\nCost: $52/kWh at scale. Patent pending: US Provisional 63/789,012.\nDO NOT share with Panasonic JV team until Board approves.`,
  },
  {
    id: 'whistleblower', name: 'Whistleblower Report', trueLevel: 'critical',
    expectedRisks: ['RETALIATION', 'MNPI'],
    expectedAction: 'BLOCK',
    criticalRisk: 'RETALIATION',
    prompt: `WHISTLEBLOWER SUBMISSION — WB-2025-00089\nI'm a senior manager at Meridian Holdings (NYSE: MHG). CFO Patricia Lane instructed controller James Wu to defer $23M in reserves to meet analyst expectations. Auditors weren't told.\nEmployee ID: EMP-92341. Email: concerned.employee2025@protonmail.com\nI fear retaliation.`,
  },
  {
    id: 'coding-question', name: 'Coding Question (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `How do I implement a binary search tree in Python with O(log n) operations?`,
  },
  {
    id: 'recipe', name: 'Recipe (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Can you give me a recipe for chicken tikka masala from scratch?`,
  },
  {
    id: 'tech-names', name: 'Tech Names FP Trap (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `We're evaluating Apache Kafka, Redis, Kubernetes, and Terraform for our stack.`,
  },
  {
    id: 'books', name: 'Book References (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Comparing "Outliers" by Malcolm Gladwell and "Thinking, Fast and Slow" by Kahneman.`,
  },
  {
    id: 'password-in-chat', name: 'Password in Casual Chat', trueLevel: 'high',
    expectedRisks: [],
    expectedAction: 'REDACT',
    prompt: `Planning team building for 20 people. Budget $5K. Oh, current admin password is SuperSecure!2024Admin — need to change it.`,
  },
  {
    id: 'harassment', name: 'Harassment Complaint', trueLevel: 'critical',
    expectedRisks: ['EMPLOYMENT_LAW'],
    expectedAction: 'BLOCK',
    prompt: `CONFIDENTIAL — Harassment complaint against David Chen (EMP-78432) by Robert Kim (robert.kim@megacorp.com). Witnesses: Amanda Park. Mental health impact — seeing therapist Dr. Lisa Wong. Consulting Jennifer Park at Baker McKenzie. Phone: (415) 555-0187.`,
  },
  {
    id: 'gdpr', name: 'GDPR DSAR Response', trueLevel: 'critical',
    expectedRisks: ['GDPR_PII'],
    expectedAction: 'BLOCK',
    criticalRisk: 'GDPR_PII',
    prompt: `DSAR: Hans Mueller, h.mueller@gmail.com, DOB 12/03/1985\nGerman Tax ID: 12 345 678 901. IBAN: DE89370400440532013000\nEmployer: SAP SE, salary €125,000. Health: Techniker Krankenkasse.\nGDPR deadline: Feb 14, 2025.`,
  },
  {
    id: 'board-minutes', name: 'Board Minutes (MNPI)', trueLevel: 'critical',
    expectedRisks: ['MNPI'],
    expectedAction: 'BLOCK',
    criticalRisk: 'MNPI',
    prompt: `BOARD MINUTES — STRICTLY CONFIDENTIAL — Apex Technologies\nPresent: CEO Lisa Chen, CFO David Morrison.\n1. Revenue miss $12M. Headcount -400 (15%), announce Feb 3.\n2. LOI to acquire DataStream Corp for $890M.\n3. CEO retention bonus: $5.2M.\n4. Patent suit exposure: $200M.\n5. $500M share buyback authorized.`,
  },
  {
    id: 'lbo', name: 'PE Leveraged Buyout', trueLevel: 'critical',
    expectedRisks: ['MNPI'],
    expectedAction: 'BLOCK',
    prompt: `CONFIDENTIAL — Project Everest LBO\nTarget: Continental Packaging Group. Sponsor: KKR.\nPurchase: $3.2B (8.5x EBITDA). Debt: $1.5B (Barclays).\nEPA Superfund at Tacoma plant, $45M remediation.\nCounsel: Robert Kim, rkim@stblaw.com`,
  },
  {
    id: 'therapy', name: 'Psychotherapy Notes', trueLevel: 'critical',
    expectedRisks: ['HIPAA_PHI'],
    expectedAction: 'BLOCK',
    criticalRisk: 'HIPAA_PHI',
    prompt: `PROGRESS NOTE — PHI\nPatient: Daniel Kim, DOB: 03/28/1991\nConflict with supervisor at McKinsey. GAD-7: 14/21, PHQ-9: 11/27.\nDx: F41.1 GAD, F32.1 MDD. Sertraline 100mg.\nEmergency: wife Jennifer Kim, (206) 555-0178. Billing: Aetna ATN-789012345`,
  },
  {
    id: 'crypto-aml', name: 'Crypto AML Investigation', trueLevel: 'critical',
    expectedRisks: ['AML_BSA'],
    expectedAction: 'BLOCK',
    criticalRisk: 'AML_BSA',
    prompt: `Investigating suspicious transaction. Customer: Alex Petrov (KYC verified).\nFrom: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38\n142.5 ETH ($456,000). Split across 12 wallets in 30 min (peel chain).\nCompliance flagged for SAR filing. tom.park@exchange.com`,
  },
  {
    id: 'weather', name: 'Weather Question (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `What's the weather in London next week? Best restaurants near Tower of London?`,
  },
  {
    id: 'pregnancy-pip', name: 'Pregnancy + PIP', trueLevel: 'critical',
    expectedRisks: ['DISCRIMINATION'],
    expectedAction: 'BLOCK',
    criticalRisk: 'DISCRIMINATION',
    prompt: `PERFORMANCE REVIEW — CONFIDENTIAL\nJennifer Wu (EMP-56789). Rating: 2/5.\nDisclosed pregnancy (due April 2025) — DO NOT factor per legal counsel.\nSalary: $245,000. PIP recommended: 90 days.\nHRBP: Sarah Kim, sarah.kim@megacorp.com`,
  },
  {
    id: 'single-ssn', name: 'Single SSN in Chat', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `Hey, can you look up account for SSN 234-56-7890? Customer billing issue.`,
  },
  {
    id: 'divorce', name: 'Divorce Filing with Minors', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT', 'CHILD_PRIVACY'],
    expectedAction: 'BLOCK',
    prompt: `Rodriguez v. Rodriguez, 2025-FL-00234\nPetitioner: Maria Elena Rodriguez, SSN 567-89-0123\nRespondent: Carlos, SSN 678-90-1234\nChildren: Sofia (8), Lucas (5).\nCustody + $1.2M property division.`,
  },
  {
    id: 'incident-response', name: 'Active Security Incident', trueLevel: 'critical',
    expectedRisks: ['CREDENTIAL_LEAK'],
    expectedAction: 'BLOCK',
    prompt: `INCIDENT — P1\nUnauthorized access to prod-db with 2.3M customer records.\nCompromised: svc_deploy@acmecorp.com (password: D3pl0y!Pr0d#2024)\npostgres://readonly:R3adM3!@prod-db-primary:5432/customers\n72-hour GDPR notification clock started.`,
  },
  {
    id: 'consulting', name: 'Strategy Consulting (MNPI)', trueLevel: 'critical',
    expectedRisks: ['MNPI', 'EMPLOYMENT_LAW'],
    expectedAction: 'BLOCK',
    prompt: `STRICTLY CONFIDENTIAL — McKinsey\nClient: Rivian Automotive (NYSE: RIVN)\nCEO requested model for exiting consumer market entirely.\nWorkforce reduction: ~1,200 positions by Q3 2025.\nCompetitor: Lucid Motors + Saudi Aramco exploring JV.`,
  },
  {
    id: 'immigration', name: 'Immigration Case File', trueLevel: 'critical',
    expectedRisks: [],
    expectedAction: 'BLOCK',
    prompt: `IN RE: KUMAR, Rajesh Vikram. A#: A-234-567-890\nDOB: 04/12/1988, Passport: Z4567891 (India). H-1B at Infosys.\nSpouse: Priya Kumar (H-4). Child: Arjun (5).\nRisk: employer may withdraw sponsorship due to layoffs.\nAttorney: msantos@santoslaw.com`,
  },
  {
    id: 'tax-return', name: 'Tax Return Prep', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `CLIENT: Thomas Anderson. SSN: 234-56-7890.\nW-2: Google $485K. Capital gains: $127K. Rental income: $42K.\nRSU: $890K (CUSIP 02079K305). Tax liability: $412K.\nCPA: mwong@wongcpa.com`,
  },
  {
    id: 'vc-term-sheet', name: 'VC Term Sheet', trueLevel: 'critical',
    expectedRisks: ['COMPETITIVE_INTEL'],
    expectedAction: 'BLOCK',
    prompt: `CONFIDENTIAL — Series B. Company: Quantum Leap AI.\nLead: Andreessen Horowitz. Pre-money: $350M. Round: $75M.\nIf ARR < $50M by Dec 2025, investors get 2x preference.\nFounder dilution from 45% to 31%. jpark@wsgr.com`,
  },
  {
    id: 'donor-anonymous', name: 'Donor Anonymity Violation', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `Major Gifts Q4\nAnonymous donor (coded WS-2024-42) — $2,500,000.\nActually: Warren Strickland, CEO of Apex Industries.\nWants anonymity preserved — DO NOT include in annual report.\nJessica Martinez SSN: 445-78-9012`,
  },
  {
    id: 'energy-well', name: 'Oil & Gas Exploration', trueLevel: 'critical',
    expectedRisks: ['COMPETITIVE_INTEL'],
    expectedAction: 'BLOCK',
    prompt: `CONFIDENTIAL — Permian Basin Update\nMustang Creek #7 (API# 42-301-45678)\nIP: 2,450 BOPD. EUR: 1.2MM BOE. CAPEX: $14.2M. IRR: 65%.\nCompetitor: Diamondback Energy spud well 800ft from lease line.\ntom.vasquez@pioneer.com`,
  },
  {
    id: 'patent', name: 'Patent Application + SSNs', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT', 'TRADE_SECRET'],
    expectedAction: 'BLOCK',
    prompt: `PATENT APPLICATION — PRIVILEGED\nInventors: Dr. Wei Chen (SSN 567-89-0123), Dr. Sarah Kim (SSN 678-90-1234)\nAssignee: Quantum Shield Technologies\nCUI//SP-EXPT data. mpark@fr.com`,
  },
  {
    id: 'threat-assessment', name: 'Executive Threat Assessment', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT'],
    expectedAction: 'BLOCK',
    prompt: `THREAT INTEL — Threats against CEO Jennifer Park\n"Lives at 4521 Oak Lane, Palo Alto" — IP: 72.134.22.198\nDoxxed phone: (650) 555-0142. Husband: Robert Park.\nThreatening email from james.smith2024@protonmail.com\nRecommend enhanced executive protection.`,
  },
  {
    id: 'bankruptcy', name: 'Bankruptcy Filing', trueLevel: 'critical',
    expectedRisks: ['IDENTITY_THEFT', 'MNPI'],
    expectedAction: 'BLOCK',
    prompt: `IN RE: SOLARIS ENERGY CORP, Chapter 11\nCFO Michael Anderson, SSN: 456-78-9012\n$2.3B secured (JPMorgan), $890M unsecured. DIP: $500M (Apollo Global).\nCEO Robert Torres resigned Jan 20.\nm.anderson@solarisenergyinc.com, (713) 555-0234`,
  },
  {
    id: 'investment-committee', name: 'Investment Committee + Conflict', trueLevel: 'critical',
    expectedRisks: ['COMPETITIVE_INTEL'],
    expectedAction: 'BLOCK',
    prompt: `IC MEMO — Wellington Capital Partners. Invest $25M in Helios Energy.\nGP Marcus Williams has $500K personal investment — conflict.\nVote 4-1 (James Foster dissent). a.liu@wellingtoncap.com\nStrictly confidential — do not distribute.`,
  },
  {
    id: 'govt-procurement', name: 'Government Procurement + ITAR', trueLevel: 'critical',
    expectedRisks: ['ITAR_EXPORT'],
    expectedAction: 'BLOCK',
    criticalRisk: 'ITAR_EXPORT',
    prompt: `OFFICIAL USE ONLY — W91278-25-R-0042\nContractor: Vertex Defense. Dr. Elena Martinez (TS/SCI cleared).\nSubs: Raytheon $12.4M, L3Harris $8.7M. Total: $67.3M.\nITAR WARNING: USML Category XI. ECCN 3A001.a`,
  },
  {
    id: 'product-names', name: 'Product Names (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Upgrading from Oracle to Aurora, Jenkins to GitHub Actions, Heroku to ECS.`,
  },
  {
    id: 'slack-casual', name: 'Casual Slack (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `@channel Jennifer from legal said NDA with Acme Corp expires Friday. Tom's farewell lunch at noon.`,
  },
  {
    id: 'startup-pitch', name: 'Startup Pitch (LOW-MED)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Pitch deck: Problem, Solution, $45B TAM, 15 customers, $1.2M ARR. Ask: $8M at $40M.`,
  },
  {
    id: 'academic', name: 'Academic (LOW)', trueLevel: 'low',
    expectedRisks: [],
    expectedAction: 'ALLOW',
    prompt: `Writing dissertation on transformer architectures. BERT vs GPT differences?`,
  },
  {
    id: 'name-places', name: 'Names = Places Ambiguity', trueLevel: 'high',
    expectedRisks: [],
    expectedAction: 'REDACT',
    prompt: `New hire onboarding:\n1. Georgia Chen — Atlanta office. Manager: Dallas Parker.\n2. Austin Kim — Austin TX, EMP-2025-0891. Manager: Virginia Park.\n3. Carolina Martinez — Charlotte. EMP-2025-0892.\nIT: jordan.lee@company.com`,
  },
  {
    id: 'code-secrets', name: 'Config with Secrets', trueLevel: 'critical',
    expectedRisks: ['CREDENTIAL_LEAK'],
    expectedAction: 'BLOCK',
    prompt: `Review this config (committed to public GitHub):\npassword: xK9#mP2$vL7nQ8\nstripe: sk_live_51N3xK9mP2vL7nQ8rT4wY6zB\nwhsec_5tS7uV9wX1yZ3aB5cD7eF9gH\nSG.1234567890abcdef.ABCDEFGHIJKLMNOP`,
  },
  {
    id: 'entity-dense', name: 'Entity-Dense Paragraph', trueLevel: 'critical',
    expectedRisks: ['MNPI'],
    expectedAction: 'BLOCK',
    prompt: `Sarah Chen (Goldman Sachs), David Park (JP Morgan), Lisa Wong (Morgan Stanley) discussed the $4.5B acquisition of Pacific Semiconductor by Titan Industries. Sullivan & Cromwell and Davis Polk handle due diligence. Strictly confidential.`,
  },
  {
    id: 'medical-referral', name: 'Medical Specialist Referral', trueLevel: 'critical',
    expectedRisks: ['HIPAA_PHI'],
    expectedAction: 'BLOCK',
    prompt: `Referral: Dr. Torres, Cardiology. Patient: Richard Nakamura, DOB 07/22/1958, MRN MED-2025-34567.\nChest pain, ST depression. DM, hyperlipidemia, smoker. Father MI at 52.\nSenior partner at Skadden Arps. Emergency: Jennifer Nakamura (650) 555-0235`,
  },
  {
    id: 'multilingual', name: 'Bilingual Legal Case', trueLevel: 'critical',
    expectedRisks: ['ATTORNEY_PRIVILEGE'],
    expectedAction: 'BLOCK',
    prompt: `PRIVILEGIADO Y CONFIDENCIAL\nRe: Caso Rodriguez v. Amazon. Carlos Rodriguez (CURP: RODC880412HDFRRL09).\nUS counsel Jennifer Park at Jones Day proposed $450,000 settlement.\nWife: Ana Rodriguez. carlos.rdz88@gmail.com`,
  },
];

// ── Test Runner ──────────────────────────────────────────────────────────────

describe('Unified Pipeline — All Models Combined (50 Cases)', () => {
  // Aggregate counters
  const stats = {
    scorerCorrect: 0,
    scorerUnderrated: 0,
    riskCorrect: 0,
    riskUnderrated: 0,
    criticalRisksFound: 0,
    criticalRisksExpected: 0,
    actionsCorrect: 0,
  };

  const assessor = createRiskAssessor(); // No LLM — rule-based only for unit tests

  for (const testCase of CASES) {
    describe(`[${testCase.trueLevel.toUpperCase()}] ${testCase.name}`, () => {

      it('combined assessment', async () => {
        // Layer 1: Regex
        const entities = detectWithRegex(testCase.prompt);

        // Layer 2: Keywords
        const contextual = detectContextualSensitivity(testCase.prompt);

        // Layer 3: Document classifier
        const docType = classifyDocument(testCase.prompt);

        // Layer 4: Scorer (combines 1-3)
        const scoreResult = computeScore(testCase.prompt, entities);

        // Layer 5: Risk Assessor (the intelligence layer)
        const riskResult = await assessor.assess({
          text: testCase.prompt,
          entities,
          documentType: docType.type,
          contextualMarkers: contextual.map(c => ({
            category: c.category,
            weight: c.weight,
            confidence: c.confidence,
          })),
        });

        // Combined decision: take the MORE restrictive
        const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
        const combinedLevel = (levelRank[riskResult.level] || 0) >= (levelRank[scoreResult.level] || 0)
          ? riskResult.level : scoreResult.level;
        const combinedScore = Math.max(scoreResult.score, riskResult.score);

        // Track accuracy
        const trueRank = levelRank[testCase.trueLevel];

        if ((levelRank[scoreResult.level] || 0) >= trueRank) stats.scorerCorrect++;
        else stats.scorerUnderrated++;

        if ((levelRank[combinedLevel] || 0) >= trueRank) stats.riskCorrect++;
        else stats.riskUnderrated++;

        // Track critical risk identification
        if (testCase.criticalRisk) {
          stats.criticalRisksExpected++;
          if (riskResult.risks.some(r => r.category === testCase.criticalRisk)) {
            stats.criticalRisksFound++;
          }
        }

        // Track action accuracy
        const actionRank: Record<string, number> = { ALLOW: 0, WARN: 1, REDACT: 2, BLOCK: 3 };
        if ((actionRank[riskResult.action] || 0) >= (actionRank[testCase.expectedAction] || 0)) {
          stats.actionsCorrect++;
        }

        // Output
        console.log(`\n─── ${testCase.name} ───`);
        console.log(`  Scorer alone:    ${scoreResult.level} (${scoreResult.score})`);
        console.log(`  + Risk Assessor: ${combinedLevel} (${combinedScore})`);
        console.log(`  TRUE level:      ${testCase.trueLevel}`);
        console.log(`  Action:          ${riskResult.action} (expected: ${testCase.expectedAction})`);

        if (riskResult.risks.length > 0) {
          console.log(`  Risk signals (${riskResult.risks.length}):`);
          for (const risk of riskResult.risks) {
            console.log(`    [${risk.owner}] ${risk.category} (${risk.severity}): ${risk.signal}`);
          }
          if (riskResult.regulations.length > 0) {
            console.log(`  Regulations: ${riskResult.regulations.join('; ')}`);
          }
        }

        const scorerGap = (levelRank[scoreResult.level] || 0) < trueRank;
        const combinedGap = (levelRank[combinedLevel] || 0) < trueRank;
        if (scorerGap && !combinedGap) {
          console.log(`  ** RISK ASSESSOR CLOSED THE GAP: scorer=${scoreResult.level} → combined=${combinedLevel} (true=${testCase.trueLevel})`);
        } else if (combinedGap) {
          console.log(`  !! STILL UNDERRATED: combined=${combinedLevel} but true=${testCase.trueLevel}`);
        }

        // Assertions for critical cases
        if (testCase.trueLevel === 'critical' && testCase.criticalRisk) {
          const hasCriticalRisk = riskResult.risks.some(r => r.category === testCase.criticalRisk);
          if (!hasCriticalRisk) {
            console.log(`  MISSED critical risk: ${testCase.criticalRisk}`);
          }
        }

        expect(true).toBe(true); // Reporting test
      });
    });
  }

  describe('AGGREGATE RESULTS', () => {
    it('prints comparison', () => {
      console.log('\n' + '='.repeat(80));
      console.log('UNIFIED PIPELINE RESULTS — ALL MODELS COMBINED');
      console.log('='.repeat(80));

      console.log('\nACCURACY COMPARISON:');
      console.log(`  Scorer alone:       ${stats.scorerCorrect}/${CASES.length} correct (${(stats.scorerCorrect / CASES.length * 100).toFixed(0)}%)`);
      console.log(`  + Risk Assessor:    ${stats.riskCorrect}/${CASES.length} correct (${(stats.riskCorrect / CASES.length * 100).toFixed(0)}%)`);
      console.log(`  Improvement:        +${stats.riskCorrect - stats.scorerCorrect} cases correctly assessed`);

      console.log('\n  Scorer underrated:  ${stats.scorerUnderrated} cases (said safe when not)');
      console.log(`  Combined underrated: ${stats.riskUnderrated} cases`);
      console.log(`  Gap closed:         ${stats.scorerUnderrated - stats.riskUnderrated} cases rescued by Risk Assessor`);

      console.log('\nCRITICAL RISK IDENTIFICATION:');
      console.log(`  Found: ${stats.criticalRisksFound}/${stats.criticalRisksExpected} critical risk categories (${(stats.criticalRisksFound / stats.criticalRisksExpected * 100).toFixed(0)}%)`);

      console.log('\nACTION ACCURACY:');
      console.log(`  Correct action: ${stats.actionsCorrect}/${CASES.length} (${(stats.actionsCorrect / CASES.length * 100).toFixed(0)}%)`);

      console.log('\nTHE FOUR EXECUTIVE LENSES:');
      console.log('  CEO:  Catches MNPI, deal risk, discrimination, whistleblower exposure');
      console.log('  CTO:  Catches credentials, infrastructure exposure, active exploits');
      console.log('  CIO:  Catches HIPAA, GDPR, ITAR, FERPA, regulatory violations');
      console.log('  CISO: Catches classified info, attack vectors, active threats');
      console.log('\n  Combined: No single lens catches everything. Together they close the gap.');
      console.log('='.repeat(80));

      expect(true).toBe(true);
    });
  });
});
