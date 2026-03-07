/**
 * Contextual Intelligence Simulation — 50 Cases
 *
 * This test answers a different question than entity detection:
 *   Entity detection: "WHAT is in the text?" (names, SSNs, orgs)
 *   Contextual intelligence: "WHY is this dangerous? What's the full picture?"
 *
 * Three layers of understanding:
 *
 *   Layer 1: ENTITY DETECTION
 *     "Sarah Chen" is a PERSON, "Goldman Sachs" is an ORG
 *     → Regex + LLM can do this
 *
 *   Layer 2: DOCUMENT CLASSIFICATION
 *     "This is an M&A memo" / "This is a medical record"
 *     → Keywords + LLM can do this
 *
 *   Layer 3: CONTEXTUAL INTELLIGENCE (the hard one)
 *     "VP of Engineering, Austin office, joined 2019, only person with that title"
 *     = re-identification risk even without a name
 *     "Our client's competitor is about to be acquired" = MNPI
 *     "Patient worried about employer finding out" = discrimination risk
 *     → Only an LLM with deep reasoning can do this
 *
 * For each of our 50 cases, we evaluate:
 *   - What contextual signals exist beyond entity extraction?
 *   - Does our keyword system catch them?
 *   - What requires true LLM intelligence?
 *   - What is the ACTUAL risk if this leaks (not just "has PII")?
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';
import { detectContextualSensitivity } from '../src/detection/contextual-keywords';
import type { DetectedEntity } from '../src/detection/types';

// ── Intelligence Layer Definitions ──────────────────────────────────────────

type IntelligenceRequirement =
  | 'none'            // No sensitivity — generic content
  | 'entity_only'     // Finding entities is sufficient (SSN in text)
  | 'classification'  // Need to classify document type (this is an NDA)
  | 'relationship'    // Need to understand entity relationships (A reports to B)
  | 'inference'       // Need to infer unstated information (indirect identifiers)
  | 'reasoning'       // Need multi-step reasoning (combining facts = risk)
  | 'domain_knowledge'; // Need domain expertise (MNPI rules, HIPAA, ITAR)

interface ContextualSignal {
  /** What the signal is */
  signal: string;
  /** Why it matters */
  risk: string;
  /** What level of intelligence is needed to catch it */
  requires: IntelligenceRequirement;
  /** Can our current keyword system catch this? */
  keywordCatchable: boolean;
  /** Can regex catch this? */
  regexCatchable: boolean;
}

interface IntelligenceTestCase {
  id: string;
  name: string;
  domain: string;
  prompt: string;
  /** Contextual signals that go beyond entity detection */
  contextualSignals: ContextualSignal[];
  /** The REAL risk if this content leaks — what an intelligent system should output */
  leakRisk: string;
  /** Expected intelligence level needed for full understanding */
  requiredIntelligence: IntelligenceRequirement;
  /** What a fully intelligent system's sensitivity assessment should be */
  trueLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ── 50 Test Cases ───────────────────────────────────────────────────────────

const INTEL_CASES: IntelligenceTestCase[] = [
  {
    id: 'finance-ma',
    name: 'M&A Deal Memo',
    domain: 'finance',
    prompt: `Confidential — Project Titan Update

Following our call with Goldman Sachs, Sarah Chen from Sullivan & Cromwell confirmed that
Titan Heavy Industries (TSX: THI) board has approved the $2.3B acquisition of ModaGlobal.
JP Morgan will lead the financing syndicate. The target's CEO, Marcus Webb, has agreed to
a $15M golden parachute. Deal expected to close Q2 2025.

Key risk: Activist fund Blackstone Capital (led by David Park) holds a 12% stake and may
demand a higher premium. Our client's general counsel, Rachel Torres, is reviewing the
poison pill defense.

Please draft talking points for the board presentation.`,
    contextualSignals: [
      {
        signal: 'Unannounced $2.3B acquisition with named parties',
        risk: 'Material Non-Public Information (MNPI) — trading on this = securities fraud',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Board approval mentioned but deal not closed/announced',
        risk: 'Pre-announcement leak could trigger SEC investigation',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Activist fund strategy discussion (poison pill defense)',
        risk: 'Reveals defensive tactics — gives activist informational advantage',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Golden parachute amount tied to named CEO',
        risk: 'Executive compensation in pending deal = highly material',
        requires: 'relationship',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'SEC enforcement action, insider trading liability, deal collapse, activist exploitation',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'healthcare-phi',
    name: 'Patient Record Summary',
    domain: 'healthcare',
    prompt: `Patient: Sarah Thompson, DOB: 03/15/1987, MRN: 2024-44891
Attending: Dr. James Morrison, Internal Medicine

Diagnosis: Stage 3 non-small cell lung cancer (NSCLC), metastatic to liver.
Treatment plan: Pembrolizumab 200mg IV q3w + carboplatin AUC 5 + pemetrexed 500mg/m2.

Insurance: Blue Cross Blue Shield, Policy #BCB-2024-78432
SSN: 342-65-8901 (for billing verification)

Patient expressed concern about workplace discrimination if employer (Deloitte)
learns of diagnosis. Referred to social worker Maria Garcia for support.

Next appointment: February 12, 2025 with Dr. Chen at Memorial Sloan Kettering.`,
    contextualSignals: [
      {
        signal: 'Cancer diagnosis tied to named individual',
        risk: 'HIPAA violation — protected health information',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Patient fears employer discrimination based on diagnosis',
        risk: 'Employment discrimination risk — employer named (Deloitte)',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'SSN included "for billing verification"',
        risk: 'SSN exposure in clinical context = identity theft + HIPAA',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: true,
      },
      {
        signal: 'Treatment plan reveals experimental immunotherapy',
        risk: 'Could affect patient insurance, employment, or life insurance eligibility',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'HIPAA violation ($50K-$1.5M fine), employment discrimination, identity theft, insurance denial',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'legal-privilege',
    name: 'Attorney-Client Privileged Memo',
    domain: 'legal',
    prompt: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

TO: General Counsel, TechCorp Inc.
FROM: Lisa Park, Partner, Kirkland & Ellis LLP
RE: SEC Investigation — Matter No. 2024-SEC-0892

The SEC has issued a formal Wells Notice regarding potential insider trading
by CFO Robert Zhang ahead of the Q3 earnings miss. Zhang's personal trades
between August 12-15 generated approximately $4.2M in avoided losses.

Recommended strategy:
1. Voluntary cooperation with DOJ (parallel investigation likely)
2. Internal investigation led by outside counsel (us)
3. Board should consider Zhang's suspension pending outcome
4. Preserve all communications with Goldman Sachs advisory team

Opposing counsel (Davis Polk) has been aggressive in discovery. We need to
assert privilege over the board minutes from September 3rd meeting.

Do NOT forward this memo to anyone outside the privilege circle.`,
    contextualSignals: [
      {
        signal: 'Attorney-client privilege marker + legal strategy',
        risk: 'Privilege waiver — leaking this waives privilege over ALL related communications',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'SEC Wells Notice + insider trading allegation against named CFO',
        risk: 'Pre-enforcement leak could constitute obstruction, affect stock price',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Defense strategy outlined (cooperation, investigation plan)',
        risk: 'Gives opposing counsel/SEC advance knowledge of defense strategy',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '"Do NOT forward" instruction',
        risk: 'Explicit distribution restriction — forwarding = intentional privilege breach',
        requires: 'classification',
        keywordCatchable: true,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Privilege waiver, obstruction charges, stock manipulation, SEC enforcement escalation',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'hr-termination',
    name: 'HR Termination Package',
    domain: 'hr',
    prompt: `Subject: Restructuring — Confidential Employee Impact Analysis

The following employees will be affected by the Q1 2025 reduction:

1. John Williams (EMP-4521), VP Engineering — 18 years tenure
   Severance: $890,000 (12 months base + bonus)
   RSU acceleration: 15,000 shares at $142/share = $2.13M
   Non-compete: 12 months, $50K/month garden leave

2. Angela Davis (EMP-4522), Director Product — 8 years
   Severance: $425,000 (9 months base)
   COBRA: 18 months company-paid
   Has pending FMLA claim (pregnancy) — CONSULT LEGAL BEFORE PROCEEDING

3. Wei Liu (EMP-4523), Senior Architect — 5 years
   H-1B visa holder — 60-day grace period applies
   Severance: $280,000 (6 months base)

Total restructuring cost: $4.8M
Announcement date: March 15, 2025 (embargo until then)`,
    contextualSignals: [
      {
        signal: 'FMLA claim (pregnancy) flagged alongside termination',
        risk: 'Pregnancy discrimination lawsuit (FMLA/ADA violation) — massive liability',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'H-1B visa holder being terminated',
        risk: 'Immigration consequences — 60-day grace period means deportation risk',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Embargo date for announcement',
        risk: 'Pre-announcement leak = MNPI if public company, WARN Act violations',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Individual severance amounts for named employees',
        risk: 'Compensation leak creates internal morale crisis + negotiation leverage loss',
        requires: 'relationship',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Discrimination lawsuit, WARN Act violation, MNPI leak, employee morale destruction',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'false-positive-city',
    name: 'Generic Business Question (should be LOW)',
    domain: 'general',
    prompt: `Can you help me draft a presentation about Data Science best practices
for our New York office? We want to cover Machine Learning fundamentals,
including supervised learning, neural networks, and natural language processing.
The target audience is our Product Management team in San Francisco.`,
    contextualSignals: [],
    leakRisk: 'None — generic, publicly available information',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'mixed-pii-code',
    name: 'Developer with Embedded Credentials',
    domain: 'engineering',
    prompt: `Hey, I'm getting a 403 from our production API. Here's my config:

\`\`\`
API_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc
DATABASE_URL=postgres://admin:Str0ngP@ss!@db.internal.company.com:5432/prod
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
\`\`\`

The endpoint is https://api.acme-corp.com/v2/users and I'm authenticating
with Bearer token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U

Can you help me debug this?`,
    contextualSignals: [
      {
        signal: 'Production credentials (not dev/test)',
        risk: 'Full production database + API access — complete system compromise',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: true,
      },
      {
        signal: 'AWS root-level credentials',
        risk: 'AWS account takeover — crypto mining, data exfiltration, resource abuse',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: true,
      },
      {
        signal: 'Database URL contains embedded password',
        risk: 'Direct database access bypassing all application security',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: true,
      },
    ],
    leakRisk: 'Complete infrastructure compromise, data breach, financial loss (AWS billing)',
    requiredIntelligence: 'entity_only',
    trueLevel: 'critical',
  },
  {
    id: 'insurance-claim',
    name: 'Insurance Claim with PHI',
    domain: 'insurance',
    prompt: `CLAIM REVIEW — CLM-2024-89012

Policyholder: Michael Torres, Policy #PLY-2024-56789
DOB: 11/22/1965, SSN: 478-92-1234
Address: 1847 Oak Valley Drive, Austin, TX 78704

Incident: Motor vehicle accident on I-35, January 8, 2025.
Police report #APD-2025-00342.

Medical bills submitted:
- Austin Regional Medical Center: $47,500 (ER + surgery)
- Dr. Priya Patel, Orthopedic: $12,300 (follow-up care)
- Physical therapy (Blue Lake Rehabilitation): $8,200

Total claim: $68,000 against $100,000 bodily injury limit.
Adjuster: Nancy Kim, ext. 4521
NAIC Code: 12345`,
    contextualSignals: [
      {
        signal: 'Full identity (name + DOB + SSN + address) in single document',
        risk: 'Complete identity theft package — all four authenticators present',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Medical bills reveal treatment details (surgery, orthopedic)',
        risk: 'Health information tied to named individual = HIPAA-adjacent',
        requires: 'relationship',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Identity theft, insurance fraud, HIPAA violation, litigation exposure',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'gov-classified',
    name: 'Classified Defense Briefing',
    domain: 'government',
    prompt: `SECRET//NOFORN

Subject: Operation Blue Horizon — Tactical Assessment

ECCN 1A003 controlled technology transfer to Meridian Defense Systems
(CAGE Code: 5X4Y2) requires State Department approval under ITAR Category IV.

Point of contact: Col. James Richardson, USAF, DSN 225-4891
Facility: Blue Lake Research Station, Building 7, Sub-level 3

The prototype SIGINT array (Project Keystone) achieved 340% improvement in
signal discrimination at the Nevada Test Range. General Dynamics is the
prime contractor. Northrop Grumman provides the phased-array subsystem.

DISTRIBUTION: Limited to SAPCO-approved personnel only.
Next review: TS//SCI briefing at the Pentagon, March 20, 2025.`,
    contextualSignals: [
      {
        signal: 'Classification marking: SECRET//NOFORN',
        risk: 'Unauthorized disclosure of classified information — federal crime',
        requires: 'classification',
        keywordCatchable: true,
        regexCatchable: true,
      },
      {
        signal: 'ITAR-controlled technology with export classification',
        risk: 'ITAR violation — criminal penalties, debarment from government contracts',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: true,
      },
      {
        signal: 'SIGINT capability details with performance metrics',
        risk: 'Reveals intelligence collection capabilities to adversaries',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Facility location with sub-level specifics',
        risk: 'Physical security compromise of classified research facility',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Federal prosecution (Espionage Act), national security damage, contractor debarment',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'real-estate',
    name: 'Real Estate Transaction with PII',
    domain: 'real_estate',
    prompt: `Subject: 742 Evergreen Terrace — Closing Documents

Buyer: Jennifer and Mark Sullivan
SSN (Jennifer): 298-76-5432
SSN (Mark): 301-45-8765

Property: APN 234-567-890, MLS# A2024789012
Purchase price: $1,250,000
Mortgage: Wells Fargo Home Lending, Loan #WF-2024-98765
Down payment: $250,000 (20%)

Title company: First American Title, escrow officer Amanda Chen
Closing date: March 28, 2025

Please prepare the HUD-1 settlement statement and forward to
our attorney Kevin Park at Morrison & Foerster.`,
    contextualSignals: [
      {
        signal: 'Two SSNs tied to named individuals in financial transaction',
        risk: 'Identity theft for both parties, mortgage fraud potential',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: true,
      },
      {
        signal: 'Full financial profile (income proxy via purchase price, down payment)',
        risk: 'Reveals net worth / financial capacity of named individuals',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Identity theft, mortgage fraud, financial exposure, wire fraud targeting',
    requiredIntelligence: 'entity_only',
    trueLevel: 'critical',
  },
  {
    id: 'subtle-context',
    name: 'Subtle Contextual Sensitivity (No Obvious PII)',
    domain: 'corporate',
    prompt: `Can you help me draft talking points for tomorrow's board meeting?

The key agenda items are:
1. Our VP of Engineering (reports to the CTO, based in the Austin office,
   joined in 2019, only person with that title) is being considered for
   termination due to the Q4 performance review results.

2. The activist investor who bought 8.5% last quarter is demanding we
   spin off the cloud division. They sent a letter threatening a proxy
   fight if we don't respond by end of month.

3. We're in late-stage talks to acquire our largest competitor. The deal
   would be our biggest ever — north of $5 billion. We can't let this
   leak before the board votes.

Please keep this between us.`,
    contextualSignals: [
      {
        signal: '"VP of Engineering, reports to CTO, Austin office, joined 2019, only person with that title"',
        risk: 'INDIRECT IDENTIFIER — enough data points to uniquely identify the person without naming them',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '"late-stage talks to acquire our largest competitor" + "$5 billion"',
        risk: 'Material Non-Public Information — trading on this is securities fraud',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Activist investor proxy fight threat',
        risk: 'Corporate strategy leak — gives activist additional leverage',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: '"Please keep this between us" + board meeting context',
        risk: 'Explicit confidentiality expectation with fiduciary duty context',
        requires: 'classification',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Termination discussion for uniquely-identifiable executive',
        risk: 'Employment law exposure + reputational damage to identifiable person',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'SEC enforcement (MNPI), wrongful termination suit, proxy fight escalation, fiduciary breach',
    requiredIntelligence: 'inference',
    trueLevel: 'critical', // This is the key case: regex says "low/medium" but true risk is CRITICAL
  },

  // ─── 11-20 ────────────────────────────────────────────────────────────────
  {
    id: 'pharma-trial',
    name: 'Clinical Trial Adverse Event',
    domain: 'pharma',
    prompt: `SERIOUS ADVERSE EVENT REPORT — Protocol ZK-2024-178

Subject: Patient ID PX-44921, Female, Age 62
Site: Johns Hopkins Medical Center, PI: Dr. Anika Patel
Sponsor: Zenith Pharmaceuticals

Event: Grade 4 hepatotoxicity, onset Day 14 of Cycle 3 (ZK-801 compound, 450mg QD).
ALT: 842 U/L (12x ULN), Total bilirubin: 5.8 mg/dL.
Patient hospitalized at University of Maryland Medical Center.

Patient's primary care physician, Dr. Robert Liu, reported concurrent
use of atorvastatin 80mg not disclosed at screening.

Action: Study drug discontinued. Patient recovering. DSMB emergency meeting
scheduled for January 22, 2025. Notifying FDA via MedWatch within 15 days.

Contact: Sarah Kim, VP Clinical Operations, sarah.kim@zenithpharma.com
Phone: (301) 555-0142`,
    contextualSignals: [
      {
        signal: 'Grade 4 SAE in clinical trial with compound name',
        risk: 'If leaked: stock impact on sponsor, trial halt, patient identification',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'DSMB emergency meeting (Data Safety Monitoring Board)',
        risk: 'Signals possible trial shutdown — massive market impact',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Undisclosed concurrent medication during trial',
        risk: 'Protocol deviation — patient safety + data integrity issue',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Stock manipulation (pharma MNPI), FDA enforcement, patient privacy, trial integrity',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'energy-drilling',
    name: 'Oil & Gas Well Report',
    domain: 'energy',
    prompt: `CONFIDENTIAL — Permian Basin Exploration Update

Well: Mustang Creek #7 (API# 42-301-45678)
Operator: Pioneer Natural Resources
Location: Section 12, Block A-21, T&P RR Co Survey, Midland County, TX

Initial production: 2,450 BOPD / 4,800 MCFGPD from Wolfcamp A bench.
Estimated EUR: 1.2 million BOE. Completed January 5, 2025.

Landman contact: Tom Vasquez, tom.vasquez@pioneer.com
Royalty owner: Margaret O'Brien Trust, 25% working interest.

Competitor note: Diamondback Energy spud a horizontal well 800ft from our
lease line. Our geologist James Park believes they are targeting the same
pay zone. Recommend filing with the Texas Railroad Commission immediately.

Total CAPEX to date: $14.2M. IRR projected at 65% at $75/bbl WTI.`,
    contextualSignals: [
      {
        signal: 'Production results before public disclosure',
        risk: 'MNPI for public E&P company — trading advantage',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Competitor intelligence with specific well location',
        risk: 'Competitive intelligence leak — affects lease acquisition strategy',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'EUR estimate + IRR calculation',
        risk: 'Material valuation data for unreported asset',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Securities fraud (MNPI), competitive disadvantage, lease negotiation damage',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'education-ferpa',
    name: 'Student Disciplinary Record (FERPA)',
    domain: 'education',
    prompt: `CONFIDENTIAL — FERPA PROTECTED

Student: Emily Rodriguez, Student ID: STU-2024-78901
DOB: 06/14/2003, Grade: Junior (11th)
School: Westlake High School, Austin ISD

Incident: On 01/15/2025, student was found with prescription medication
(Adderall 20mg) not registered with the school nurse. Parent/Guardian
Maria Rodriguez (mother) contacted.

Previous incidents:
- 09/2024: Cheating on AP Chemistry final (Dr. Thompson's class)
- 11/2024: Unauthorized absence (3 days, parent notified)

IEP Status: Active (ADHD, accommodations include extended test time)
Counselor: Ms. Patricia Walsh, ext. 4892
Parent email: m.rodriguez.tx@gmail.com
Parent phone: (512) 555-0198`,
    contextualSignals: [
      {
        signal: 'FERPA-protected student record with disciplinary history',
        risk: 'FERPA violation — federal funding loss for school district',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'IEP status reveals disability (ADHD)',
        risk: 'Disability disclosure violates IDEA + ADA for minor',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Prescription medication possession by minor',
        risk: 'Potential criminal/disciplinary implication for a minor',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'FERPA violation, disability discrimination, minor privacy, school funding',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'manufacturing-ip',
    name: 'Manufacturing Trade Secret',
    domain: 'manufacturing',
    prompt: `TRADE SECRET — DO NOT DISTRIBUTE

Project: NexGen Battery Cell (internal codename "Falcon")
Division: Advanced Energy Storage, Tesla Gigafactory Nevada

The new solid-state electrolyte formulation (Li6.4La3Zr1.4Ta0.6O12, LLZTO
variant) achieved 450 Wh/kg at the cell level — 2x our current 4680 cells.

Key parameters:
- Cathode: NCM 955 (95% nickel, proprietary coating by Dr. Wei Zhang)
- Anode: Silicon-carbon composite, 3500mAh/g
- Cycle life: 1200 cycles to 80% capacity retention

Cost projection: $52/kWh at scale (Gigafactory 2, target 2027).
Patent application filed: US Provisional 63/789,012

DO NOT share with Panasonic JV team until Board approves on Feb 15.`,
    contextualSignals: [
      {
        signal: 'Proprietary chemical formulation with exact composition',
        risk: 'Trade secret misappropriation — competitor could replicate',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Performance metrics that reveal competitive advantage',
        risk: '2x improvement = stock-moving if public; strategic if private',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '"DO NOT share with Panasonic JV team"',
        risk: 'JV partner exclusion reveals internal politics + competitive positioning',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Trade secret theft (Defend Trade Secrets Act), patent priority loss, stock impact',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'nonprofit-donor',
    name: 'Donor Gift Report',
    domain: 'nonprofit',
    prompt: `CONFIDENTIAL — Major Gifts Report Q4 2024

1. William Chen Foundation — $5,000,000 pledge (3-year, restricted to STEM)
   Contact: Patricia Chen (board chair), patricia@chenfoundation.org
   EIN: 84-2345678

2. Anonymous donor (coded WS-2024-42) — $2,500,000 unrestricted
   Actually: Warren Strickland, CEO of Apex Industries
   Wants anonymity preserved — DO NOT include in annual report

3. Jessica Martinez — $750,000 for scholarship endowment
   Requested naming: "The Martinez Family Scholarship"
   SSN for tax receipt: 445-78-9012
   Address: 2100 Pacific Heights Blvd, San Francisco, CA 94115

Total Q4 major gifts: $8,250,000
Development Officer: Karen Liu, ext. 3456`,
    contextualSignals: [
      {
        signal: '"Anonymous donor" whose real identity is documented',
        risk: 'Breaking donor anonymity — destroys trust, loses future donations',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Explicit instruction to preserve anonymity being violated by this document',
        risk: 'Donor relationship destruction + potential legal liability',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Donor trust violation, lost donations, identity theft (SSN), reputational damage',
    requiredIntelligence: 'inference',
    trueLevel: 'critical',
  },
  {
    id: 'consulting-strategy',
    name: 'Strategy Consulting Engagement',
    domain: 'consulting',
    prompt: `STRICTLY CONFIDENTIAL — McKinsey & Company

Client: Rivian Automotive (NYSE: RIVN)
Engagement: Project Aurora — Manufacturing Optimization
Partner: Jennifer Wu, McKinsey Detroit

Key findings from plant assessment (Normal, IL facility):
1. Assembly line efficiency at 62% vs benchmark 85%
2. Battery module installation bottleneck — recommend $45M investment
3. Workforce reduction: ~1,200 positions (18% of plant) by Q3 2025

CEO RJ Scaringe personally requested we model a scenario where they
exit the consumer market entirely and pivot to fleet/commercial only.

Competitor intelligence: Lucid Motors exploring partnership with
Saudi Aramco for a dedicated EV plant in Jeddah. Source: our contact
at Morgan Stanley, David Kim.

Next steering committee: Feb 10, 2025 with CFO Claire McDonough.`,
    contextualSignals: [
      {
        signal: 'CEO exploring complete market exit (consumer → fleet only)',
        risk: 'Material strategic pivot for public company — stock-moving MNPI',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Competitor intelligence sourced from investment bank contact',
        risk: 'Wall Street info barrier breach — Morgan Stanley contact leaked client info',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '1,200 position reduction at named facility',
        risk: 'Pre-WARN Act notification, community economic impact, union issues',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Securities fraud (MNPI), WARN Act violation, Chinese wall breach, competitor advantage',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'immigration-case',
    name: 'Immigration Case File',
    domain: 'legal',
    prompt: `Case: IN RE: KUMAR, Rajesh Vikram
A#: A-234-567-890
USCIS Receipt: MSC2024567890

Petitioner: Rajesh Vikram Kumar, Indian national
DOB: 04/12/1988, Passport: Z4567891 (India, exp. 2028)
Current status: H-1B (employer: Infosys Ltd, LCA #I-200-24001-234567)
Address: 4521 Maple Drive, Apt 12B, Sunnyvale, CA 94086

Beneficiary's spouse: Priya Kumar (H-4, EAD pending)
Children: Arjun Kumar (age 5, H-4)

Attorney: Maria Santos, Esq., Santos & Associates
Email: msantos@santoslaw.com

I-140 approved, PD: 03/2019, EB-2 India. Current VB: 01/2012.
Risk: Employer may withdraw sponsorship due to layoffs at Infosys.`,
    contextualSignals: [
      {
        signal: 'Immigration status + employer sponsorship at risk',
        risk: 'Deportation risk for entire family if sponsorship withdrawn',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Dependent family members on derivative visas',
        risk: 'Children and spouse also face status loss — family separation',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Deportation, family separation, employment discrimination, identity theft',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'tax-return',
    name: 'Tax Return Preparation',
    domain: 'accounting',
    prompt: `CLIENT: Thomas and Rebecca Anderson
SSN: 234-56-7890 (Thomas), 345-67-8901 (Rebecca)
Filing status: Married Filing Jointly

W-2 Income:
- Thomas: Employer Google LLC, $485,000 (Box 1)
- Rebecca: Employer Pfizer Inc, $312,000 (Box 1)

Additional income:
- Capital gains: $127,000 (Schwab acct ending 4567)
- Rental income: 789 Oak Street, Palo Alto, CA — net $42,000
- RSU vesting: $890,000 (Google, CUSIP 02079K305)

Estimated tax liability: $412,000. Quarterly payments made: $380,000.
Balance due: $32,000.

Preparer: CPA Michael Wong, Wong & Associates
Email: mwong@wongcpa.com`,
    contextualSignals: [
      {
        signal: 'Complete financial profile: income, investments, property, employers',
        risk: 'Full financial identity — enough for targeted fraud, spear-phishing',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'RSU vesting details with CUSIP number',
        risk: 'Reveals insider stock holdings at public company',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Identity theft, tax fraud, IRS disclosure violation, financial profiling',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'venture-capital',
    name: 'VC Term Sheet Discussion',
    domain: 'finance',
    prompt: `CONFIDENTIAL — Series B Term Sheet

Company: Quantum Leap AI, Inc. (Delaware C-Corp)
CEO/Founder: Dr. Aisha Patel
CTO: Marcus Rodriguez

Lead investor: Andreessen Horowitz (a16z), Partner: Lisa Chen
Co-investors: Sequoia Capital ($15M), Tiger Global ($10M)

Terms:
- Pre-money valuation: $350M
- Round size: $75M
- Option pool: 15% post-money
- Board: 2 founders, 2 investors, 1 independent (TBD)
- 1x non-participating liquidation preference
- Pro-rata rights for all investors

Special provision: If ARR doesn't reach $50M by Dec 2025,
investors get 2x liquidation preference.

Cap table impact: Founder dilution from 45% to 31%.
Previous investor Benchmark Capital (Bill Gurley) has ROFR.

Send executed term sheet to our counsel at Wilson Sonsini:
attorney Jennifer Park, jpark@wsgr.com`,
    contextualSignals: [
      {
        signal: 'Full term sheet with valuation, liquidation preferences, anti-dilution',
        risk: 'Competitive intelligence — reveals negotiating position and investor leverage',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Conditional ratchet provision (2x preference if ARR misses)',
        risk: 'Reveals investor confidence concerns and company vulnerability',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Cap table showing founder dilution path',
        risk: 'Gives future investors/employees insight into founder control trajectory',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Competitive disadvantage, negotiation leverage loss, employee retention risk',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'cybersecurity-incident',
    name: 'Security Incident Response',
    domain: 'cybersecurity',
    prompt: `INCIDENT REPORT — INC-2025-00142 — SEVERITY: P1

Date: 01/28/2025 03:42 UTC
Reporter: SOC Analyst James Chen
Affected system: prod-db-primary.internal.acmecorp.com (10.0.45.128)

Summary: Unauthorized access to production database containing 2.3M customer records.
Attacker exploited CVE-2024-23897 (Jenkins CLI vulnerability) on ci.acmecorp.com
to pivot to internal network.

Compromised credentials:
- Service account: svc_deploy@acmecorp.com (password: D3pl0y!Pr0d#2024)
- Database: postgres://readonly:R3adM3!@prod-db-primary:5432/customers

Exfiltrated data includes: names, emails, hashed passwords (bcrypt),
last 4 of credit cards, billing addresses.

CISO Rebecca Torres has been notified. Outside counsel (Covington & Burling)
engaged for breach notification. PR lead Amanda Foster drafting statement.

72-hour notification clock started for GDPR (EU customers: ~340K).
California AG notification required under CCPA.

IR Commander: VP Security, Michael Park, m.park@acmecorp.com`,
    contextualSignals: [
      {
        signal: '2.3M customer records breached — active incident',
        risk: 'Premature disclosure could cause market panic, hamper investigation',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'CVE + attack vector details still unpatched',
        risk: 'Reveals how to exploit — enables copycat attacks before patch',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Breach notification timeline (72-hour GDPR clock running)',
        risk: 'Leaking before official notification = regulatory violation',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Still-valid compromised credentials in report',
        risk: 'Credentials in the report enable further exploitation right now',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: true,
      },
    ],
    leakRisk: 'Active exploitation, regulatory violation (GDPR/CCPA), stock impact, litigation',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },

  // ─── 21-30 ────────────────────────────────────────────────────────────────
  {
    id: 'generic-coding',
    name: 'Generic Coding Question (should be LOW)',
    domain: 'engineering',
    prompt: `How do I implement a binary search tree in Python? I need it to support
insert, delete, and search operations with O(log n) average complexity.`,
    contextualSignals: [],
    leakRisk: 'None',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'recipe-request',
    name: 'Cooking Recipe (should be LOW)',
    domain: 'general',
    prompt: `Can you give me a recipe for chicken tikka masala? I want to make it from
scratch. I have chicken thighs, yogurt, garlic, ginger, tomatoes, cream.`,
    contextualSignals: [],
    leakRisk: 'None',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'fp-tech-names',
    name: 'Tech Names (FP Trap, should be LOW)',
    domain: 'engineering',
    prompt: `We're evaluating Apache Kafka for event streaming, Redis for caching,
Elastic Search with Kibana for observability, and Docker Swarm vs Kubernetes.
Our team in Mountain View will lead the evaluation.`,
    contextualSignals: [],
    leakRisk: 'None — publicly known technologies, generic evaluation',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'fp-book-references',
    name: 'Book References (should be LOW)',
    domain: 'general',
    prompt: `I'm writing a literature review covering "Outliers" by Malcolm Gladwell,
"Thinking, Fast and Slow" by Daniel Kahneman, and Ray Dalio's "Principles."`,
    contextualSignals: [],
    leakRisk: 'None — public authors and published works',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'mixed-sensitive-nonsensitive',
    name: 'Mostly Generic With One Password',
    domain: 'general',
    prompt: `I'm planning a team building event for our engineering department.
Budget is around $5,000 for 20 people in the Chicago office.

Oh, also — can you help me reset the password for our admin account?
The current password is SuperSecure!2024Admin and I need to change it.`,
    contextualSignals: [
      {
        signal: 'Active admin password embedded in casual message',
        risk: 'Admin account compromise — password is still valid',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Password change context implies this is a CURRENT credential',
        risk: 'Not a historical password — actively exploitable right now',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Admin account takeover, system compromise',
    requiredIntelligence: 'inference',
    trueLevel: 'high', // LLM would catch this, regex doesn't
  },
  {
    id: 'email-thread-pii',
    name: 'Forwarded Email Thread with PII',
    domain: 'corporate',
    prompt: `---------- Forwarded message ----------
From: Robert Kim <robert.kim@megacorp.com>
Subject: Harassment complaint — CONFIDENTIAL

I'm formally filing a complaint against my manager, David Chen (EMP-78432),
for repeated hostile behavior.

Witnesses: Amanda Park (ext. 3421), Tom Liu (ext. 3422).
My employee ID is EMP-67891. Personal phone: (415) 555-0187.

This is affecting my mental health — I started seeing a therapist,
Dr. Lisa Wong, last month.

I've already consulted with Jennifer Park at Baker McKenzie.`,
    contextualSignals: [
      {
        signal: 'Harassment complaint with accused and accuser identified',
        risk: 'Retaliation risk, defamation exposure, employment law violation',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Mental health disclosure in employment context',
        risk: 'ADA violation if disclosed to employer; stigma if leaked externally',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Outside counsel engaged — implies potential litigation',
        risk: 'Litigation hold triggered, document preservation required',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Retaliation lawsuit, ADA violation, witness intimidation, attorney-client breach',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'multilingual',
    name: 'Mixed Language Content',
    domain: 'legal',
    prompt: `PRIVILEGIADO Y CONFIDENCIAL
Re: Caso Rodriguez v. Amazon Fulfillment Services

Nuestro cliente, Carlos Rodriguez (CURP: RODC880412HDFRRL09), sufrió una lesión.
Su NSS: 4287-1956-3201.

The employer's US counsel, Jennifer Park at Jones Day, proposed $450,000.
Wife: Ana Rodriguez, +52-33-1234-5678. Email: carlos.rdz88@gmail.com

Lic. Sofia Martinez, martinez.sofia@bufeteegal.mx`,
    contextualSignals: [
      {
        signal: 'Cross-border legal matter with privilege markings in two languages',
        risk: 'Privilege waiver affects both US and Mexican jurisdictions',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Worker injury vs employer litigation with settlement offer',
        risk: 'Settlement amount leak undermines negotiating position',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Privilege waiver (two jurisdictions), settlement negotiation damage, identity theft',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'academic-research',
    name: 'Academic Research Discussion (LOW)',
    domain: 'academic',
    prompt: `I'm writing my dissertation on transformer architectures. Can you explain
the key differences between BERT and GPT? My advisor Dr. Johnson suggested
I also cover the T5 model. The defense is at Stanford in April.`,
    contextualSignals: [],
    leakRisk: 'Minimal — academic context, published knowledge',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'whistleblower',
    name: 'Whistleblower Report',
    domain: 'compliance',
    prompt: `CONFIDENTIAL WHISTLEBLOWER SUBMISSION — WB-2025-00089

I'm a senior manager at Meridian Holdings (NYSE: MHG). Our CFO, Patricia Lane,
instructed controller James Wu to defer $23M in warranty reserves from Q4 to Q1
to meet analyst expectations. CEO Robert Anderson directed this.

Deloitte auditors (Sarah Kim) were not told. I have emails proving it.

Employee ID: EMP-92341. Email: concerned.employee2025@protonmail.com
Attorney: Mark Johnson at Constantine Cannon (SEC whistleblower specialist).`,
    contextualSignals: [
      {
        signal: 'Accounting fraud allegation against named C-suite executives',
        risk: 'SOX violation, SEC enforcement, stock impact, restatement',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Auditors deliberately misled',
        risk: 'Audit failure → investor lawsuits, auditor liability, restatement',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Whistleblower identity partially revealed despite anonymity intent',
        risk: 'Retaliation against whistleblower — Dodd-Frank violation',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '"Senior manager in Finance" + employee ID = identifiable',
        risk: 'Indirect identifier — department + seniority + ID narrow to 1 person',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Whistleblower retaliation (federal crime), stock manipulation, SEC enforcement',
    requiredIntelligence: 'inference',
    trueLevel: 'critical',
  },
  {
    id: 'generic-weather',
    name: 'Weather/Travel (LOW)',
    domain: 'general',
    prompt: `What's the weather in London next week? I'm planning a trip and want
to know if I should pack an umbrella. Best restaurants near Tower of London?`,
    contextualSignals: [],
    leakRisk: 'None',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },

  // ─── 31-40 ────────────────────────────────────────────────────────────────
  {
    id: 'board-minutes',
    name: 'Board Meeting Minutes (MNPI)',
    domain: 'corporate',
    prompt: `BOARD MINUTES — STRICTLY CONFIDENTIAL — Apex Technologies, Inc.

Present: Chairman Robert Park, CEO Lisa Chen, CFO David Morrison,
Directors: Dr. Sarah Kim, James Thompson, Angela Wu

1. Revenue miss of $12M vs guidance. Headcount reduction of 400 (15%) Feb 3.
2. Approved LOI to acquire DataStream Corp for $890M. Morgan Stanley advising.
3. Retention bonuses: CEO $5.2M, CFO $2.8M, VP Eng $1.5M
4. Patent suit by Neuralink — exposure $200M. Latham & Watkins counsel.
5. Authorized $500M share buyback.

Secretary: Amanda Foster. Next meeting: March 15, 2025`,
    contextualSignals: [
      {
        signal: 'Five separate MNPI items in one document',
        risk: 'Trading on ANY of these = securities fraud. Combined = extreme exposure',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Pending acquisition with price, advisor, and timeline',
        risk: 'Front-running, tipping liability under Reg FD',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Layoff announcement date embargoed',
        risk: 'Pre-announcement leak = WARN Act + market manipulation',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Executive compensation during material events',
        risk: 'Proxy advisory firm scrutiny, shareholder lawsuit potential',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'SEC enforcement, insider trading prosecution, shareholder litigation, deal collapse',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'private-equity-lbo',
    name: 'PE Leveraged Buyout Model',
    domain: 'finance',
    prompt: `CONFIDENTIAL — Project Everest LBO Summary

Target: Continental Packaging Group. Sponsor: KKR & Co.
Purchase price: $3.2B (8.5x EBITDA). Senior debt: $1.5B (Barclays). Mezz: $600M (Ares).

Management rollover: CEO William Foster 5%, CFO Jennifer Liu 2%.
Key man provision: Foster departure triggers put option.

Environmental: EPA Superfund at Tacoma plant, $45M remediation, seller indemnity.
Counsel: Simpson Thacher, Robert Kim, rkim@stblaw.com`,
    contextualSignals: [
      {
        signal: 'Unannounced LBO with full capital structure',
        risk: 'Trading on target stock/debt before announcement = securities fraud',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Environmental liability (EPA Superfund) with cost estimate',
        risk: 'Reveals due diligence findings that affect deal pricing',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Key man provision details',
        risk: 'Reveals CEO as single point of failure — vulnerability for activist pressure',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Insider trading, deal collapse, environmental liability disclosure, competitive intelligence',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'medical-referral',
    name: 'Medical Specialist Referral',
    domain: 'healthcare',
    prompt: `Referral to: Dr. Michael Torres, Cardiology. From: Dr. Amanda Chen

Patient: Richard Nakamura, DOB: 07/22/1958, MRN: MED-2025-34567
Insurance: Aetna PPO, Member ID: W234567890

Chest pain, troponin negative, ST depression V4-V6. Hx: DM, hyperlipidemia,
former smoker (30 pack-years). Father MI at 52.

Patient is senior partner at Skadden Arps, works 70+ hours/week.
Emergency contact: Jennifer Nakamura (wife), (650) 555-0235`,
    contextualSignals: [
      {
        signal: 'Cardiac symptoms for named senior law firm partner',
        risk: 'If leaked: client confidence impact, partnership succession questions',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Family cardiac history + smoking history + current symptoms',
        risk: 'Life insurance, disability insurance, and professional risk assessment',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'HIPAA violation, professional reputation damage, insurance implications',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'startup-pitch',
    name: 'Startup Pitch Deck Notes (LOW-MED)',
    domain: 'general',
    prompt: `Help me refine our pitch deck for demo day. Problem: document management.
Solution: AI classification. TAM: $45B. 15 customers, $1.2M ARR.
Ask: $8M Series A at $40M pre-money. Team from Google, Meta, OpenAI.`,
    contextualSignals: [
      {
        signal: 'Valuation + revenue metrics for private company',
        risk: 'Moderate — gives competitors pricing/traction intelligence',
        requires: 'classification',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Low-moderate — competitive intelligence, valuation anchor for future negotiations',
    requiredIntelligence: 'classification',
    trueLevel: 'medium',
  },
  {
    id: 'divorce-filing',
    name: 'Divorce Case Filing',
    domain: 'legal',
    prompt: `CASE: Rodriguez v. Rodriguez, 2025-FL-00234
Petitioner: Maria Elena Rodriguez, SSN: 567-89-0123
Respondent: Carlos Manuel Rodriguez, SSN: 678-90-1234
Children: Sofia (8), Lucas (5)

Community property: Residence $1.2M, Chase acct $89K, 401(k) $340K, IRA $125K.
Attorney: Lisa Park, Park Family Law`,
    contextualSignals: [
      {
        signal: 'Complete family financial profile in divorce context',
        risk: 'Used for asset hiding, financial manipulation, custody leverage',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Minor children named in custody proceeding',
        risk: 'Child privacy, potential safety risk in contested custody',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Identity theft, financial fraud, child safety, emotional harm',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'code-review-pii',
    name: 'Code Review with Hardcoded Secrets',
    domain: 'engineering',
    prompt: `Can you review this config? It was committed to our public GitHub repo:

\`\`\`yaml
database:
  password: xK9#mP2$vL7nQ8
stripe:
  secret_key: sk_live_51N3xK9mP2vL7nQ8rT4wY6zB
  webhook_secret: whsec_5tS7uV9wX1yZ3aB5cD7eF9gH
sendgrid:
  api_key: SG.1234567890abcdef.ABCDEFGHIJKLMNOP
admin_email: admin@acme-internal.com
\`\`\`

How bad is this?`,
    contextualSignals: [
      {
        signal: '"committed to our public GitHub repo" = already exposed',
        risk: 'Credentials already public — asking AI for help = double exposure',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Stripe live key = can process real payments',
        risk: 'Financial fraud using production payment processing credentials',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: true,
      },
    ],
    leakRisk: 'Active exploitation (already public), payment fraud, data breach',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'investment-committee',
    name: 'Investment Committee Memo',
    domain: 'finance',
    prompt: `IC MEMO — Wellington Capital Partners II

Recommendation: $25M in Helios Energy (Series C). CEO: Dr. Raj Patel.
Co-investors: Breakthrough Energy Ventures, Kleiner Perkins. $250M pre.

GP Marcus Williams has $500K personal investment — potential conflict.
Compliance officer Rebecca Chen approved. Vote 4-1 (James Foster dissent).

Amanda Liu, a.liu@wellingtoncap.com`,
    contextualSignals: [
      {
        signal: 'GP personal investment creates conflict of interest',
        risk: 'LP lawsuit for breach of fiduciary duty if not properly disclosed',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Dissenting vote with named partner',
        risk: 'Internal fund governance leak — LPs may question decision-making',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'LP lawsuit, fiduciary breach, fund reputation, deal terms leaked to competitors',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'govt-procurement',
    name: 'Government Procurement RFP',
    domain: 'government',
    prompt: `PROPOSAL — OFFICIAL USE ONLY — W91278-25-R-0042

Contractor: Vertex Defense. Key personnel:
Dr. Elena Martinez (TS/SCI cleared), e.martinez@vertexdef.com, (703) 555-0198
Col. (Ret.) James Park (PM), Dr. Wei Chen (ITAR-restricted)

Subs: Raytheon $12.4M, L3Harris $8.7M, Palantir $4.2M. Total: $67.3M.
ITAR WARNING: USML Category XI. ECCN 3A001.a`,
    contextualSignals: [
      {
        signal: 'Clearance levels of named individuals',
        risk: 'Intelligence targeting — cleared personnel are high-value targets',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Subcontractor pricing in competitive procurement',
        risk: 'Reveals cost structure — competitors can underbid',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'ITAR classification with specific USML category',
        risk: 'Export control violation if disclosed to non-US persons',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: true,
      },
    ],
    leakRisk: 'ITAR violation (criminal), competitive disadvantage, personnel targeting',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'therapy-notes',
    name: 'Psychotherapy Session Notes',
    domain: 'healthcare',
    prompt: `PROGRESS NOTE — PHI

Patient: Daniel Kim, DOB: 03/28/1991
Therapist: Dr. Rachel Morrison, PsyD, #PSY-34567

Conflict with supervisor at McKinsey — "he publicly humiliated me about the Rivian project."
GAD-7: 14/21, PHQ-9: 11/27. Denies SI/HI.

Dx: F41.1 GAD, F32.1 MDD moderate. Rx: Sertraline 100mg (Dr. Lisa Chen, psychiatry).
Emergency contact: wife Jennifer Kim, (206) 555-0178. Billing: Aetna ATN-789012345`,
    contextualSignals: [
      {
        signal: 'Psychotherapy notes (highest level of HIPAA protection)',
        risk: '42 CFR Part 2 level protection — stricter than regular PHI',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Named employer + project in therapy context',
        risk: 'Could identify supervisor and create workplace retaliation',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Psychiatric diagnosis codes + medication',
        risk: 'Mental health stigma, insurance discrimination, employment impact',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'HIPAA violation (psychotherapy notes = max penalty), employment discrimination, stigma',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'crypto-wallet',
    name: 'Crypto Transaction Investigation',
    domain: 'finance',
    prompt: `Investigating suspicious transaction. Customer: Alex Petrov (KYC verified).
Email: alex.petrov@mail.ru. Account: USR-2025-45678.

From: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38
To: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq
Amount: 142.5 ETH ($456,000). Split across 12 wallets in 30 min (peel chain).

Compliance: Sarah Kim flagged for SAR. IR lead: Tom Park, tpark@exchange.com`,
    contextualSignals: [
      {
        signal: 'Peel chain pattern = textbook money laundering technique',
        risk: 'Filing SAR = BSA requirement; leaking investigation = tipping (federal crime)',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Active investigation being documented',
        risk: 'Tipping off the subject of a SAR = criminal offense under BSA',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'BSA/AML tipping violation (criminal), regulatory enforcement, customer flight',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },

  // ─── 41-50 ────────────────────────────────────────────────────────────────
  {
    id: 'dense-entity-packed',
    name: 'Entity-Dense Paragraph',
    domain: 'finance',
    prompt: `Sarah Chen (Goldman Sachs), David Park (JP Morgan), Lisa Wong (Morgan Stanley),
James Kim (Barclays), and Robert Liu (Citigroup) discussed the $4.5B acquisition
of Pacific Semiconductor by Titan Industries. Sullivan & Cromwell and Davis Polk
handle due diligence. Michael Torres from Lazard pushed for $5B floor.`,
    contextualSignals: [
      {
        signal: 'Five major banks + two law firms on single deal',
        risk: 'Deal of massive scale — every person on the call has MNPI',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Bidding negotiation details ($4.5B vs $5B floor)',
        risk: 'Price discovery leak — affects trading in both acquirer and target',
        requires: 'reasoning',
        keywordCatchable: true,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Insider trading (all participants), deal collapse, antitrust tipping',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'name-like-places',
    name: 'Names That Are Also Places',
    domain: 'hr',
    prompt: `New hire onboarding — Feb 3, 2025:
1. Georgia Chen — Atlanta office, Sales. Manager: Dallas Parker.
2. Austin Kim — Austin TX, Engineering. EMP-2025-0891. Manager: Virginia Park.
3. Carolina Martinez — Charlotte office, Marketing. EMP-2025-0892.
IT contact: Jordan Lee, jordan.lee@company.com`,
    contextualSignals: [
      {
        signal: 'New hire list with managers = org chart intelligence',
        risk: 'Competitive hiring intelligence, poaching targets identified',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Competitive intelligence, targeted poaching, org chart exposure',
    requiredIntelligence: 'reasoning',
    trueLevel: 'high',
  },
  {
    id: 'social-media-monitoring',
    name: 'Social Media Threat Assessment',
    domain: 'security',
    prompt: `THREAT INTEL — FOR OFFICIAL USE ONLY

Online threats against CEO Jennifer Park:
- @darkwolf_2024: "Jennifer Park of Meridian Corp lives at 4521 Oak Lane, Palo Alto."
  IP: 72.134.22.198
- Reddit doxx: personal phone (650) 555-0142, husband Robert Park
- Threatening email from james.smith2024@protonmail.com to jennifer.park@meridiancorp.com

Recommend enhanced executive protection, home security audit.
Security lead: Michael Torres, m.torres@meridiancorp.com`,
    contextualSignals: [
      {
        signal: 'Active threat with home address + personal phone already doxxed',
        risk: 'Physical safety of named executive and family',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'IP trace of threat actor included in report',
        risk: 'If leaked, tips off threat actor that investigation is active',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Security response plan details',
        risk: 'Reveals protective measures — attacker can plan around them',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Physical violence, stalking escalation, investigation compromise',
    requiredIntelligence: 'reasoning',
    trueLevel: 'critical',
  },
  {
    id: 'innocuous-names',
    name: 'Product Names (FP Trap, LOW)',
    domain: 'engineering',
    prompt: `We're upgrading: Oracle to Amazon Aurora, Jenkins to GitHub Actions,
Heroku to AWS ECS, implementing New Relic. Also evaluating Vercel for frontend.`,
    contextualSignals: [],
    leakRisk: 'None — all publicly known products and services',
    requiredIntelligence: 'none',
    trueLevel: 'low',
  },
  {
    id: 'bankruptcy-filing',
    name: 'Corporate Bankruptcy Filing',
    domain: 'legal',
    prompt: `IN RE: SOLARIS ENERGY CORP., Chapter 11, Case 25-10234

I, Michael Anderson, CFO, declare: $2.3B secured debt (JPMorgan agent),
$890M unsecured (BNY Mellon trustee). Key creditors: Halliburton $45M,
Baker Hughes $32M. DIP: $500M from Apollo Global.

CEO Robert Torres resigned Jan 20. GC Lisa Park coordinating with Kirkland & Ellis.
My SSN: 456-78-9012. Contact: m.anderson@solarisenergyinc.com, (713) 555-0234`,
    contextualSignals: [
      {
        signal: 'CFO SSN in court filing context',
        risk: 'Court filings can become public — SSN exposure risk',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: true,
      },
      {
        signal: 'DIP financing terms before court approval',
        risk: 'Creditor committee negotiation leverage, trading in distressed debt',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'CEO resignation during bankruptcy',
        risk: 'Leadership vacuum in restructuring = stakeholder panic',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Distressed debt trading, creditor manipulation, identity theft, market manipulation',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'employee-review',
    name: 'Performance Review with Sensitive Details',
    domain: 'hr',
    prompt: `PERFORMANCE REVIEW — CONFIDENTIAL

Jennifer Wu (EMP-56789), Manager: David Chen, VP Product. Rating: 2/5.

Issues: Missed 3/5 OKRs, two formal complaints, 32 days PTO vs 20 policy.
Disclosed pregnancy (due April 2025) — DO NOT factor per legal counsel Robert Park.

Salary: $245,000 + 20% bonus. No merit increase. PIP 90 days.
HRBP: Sarah Kim, sarah.kim@megacorp.com`,
    contextualSignals: [
      {
        signal: 'Pregnancy disclosure + PIP = pregnancy discrimination exposure',
        risk: 'If linked, company faces Title VII / PDA lawsuit',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: '"DO NOT factor into performance decision per legal counsel"',
        risk: 'The instruction itself shows company KNOWS it could be discriminatory',
        requires: 'inference',
        keywordCatchable: false,
        regexCatchable: false,
      },
      {
        signal: 'Specific compensation compared to "peer avg"',
        risk: 'Pay equity exposure — could trigger equal pay complaints',
        requires: 'reasoning',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Pregnancy discrimination lawsuit, pay equity complaint, morale damage',
    requiredIntelligence: 'inference',
    trueLevel: 'critical',
  },
  {
    id: 'single-ssn',
    name: 'Quick Message with Single SSN',
    domain: 'general',
    prompt: `Hey, can you look up the account for SSN 234-56-7890? Customer is
calling about a billing issue.`,
    contextualSignals: [
      {
        signal: 'SSN used as account lookup key',
        risk: 'Identity theft if intercepted; also reveals SSN-as-identifier practice',
        requires: 'entity_only',
        keywordCatchable: false,
        regexCatchable: true,
      },
    ],
    leakRisk: 'Identity theft, reveals insecure business practice',
    requiredIntelligence: 'entity_only',
    trueLevel: 'critical',
  },
  {
    id: 'gdpr-data-request',
    name: 'GDPR Data Subject Access Request',
    domain: 'compliance',
    prompt: `DSAR: Hans Mueller, h.mueller@gmail.com, DOB 12/03/1985
Address: Schillerstraße 42, 10627 Berlin. German Tax ID: 12 345 678 901
IBAN: DE89370400440532013000. Health: Techniker Krankenkasse #TK-456789012
Employer: SAP SE, EMP SAP-2019-45678, salary €125,000. Manager: Dr. Thomas Schmidt.
DPO: Maria Wagner, dpo@sapcloud.com. Deadline: Feb 14, 2025.`,
    contextualSignals: [
      {
        signal: 'GDPR DSAR response with complete personal data profile',
        risk: 'Entire GDPR data set in one document — maximizes breach impact',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: false,
      },
      {
        signal: 'Health insurance + employer + salary + tax ID = complete identity',
        risk: 'German data protection law (BDSG) imposes stricter requirements than base GDPR',
        requires: 'domain_knowledge',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'GDPR violation (up to 4% of global revenue), identity theft, Aufsichtsbehörde enforcement',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
  {
    id: 'internal-chat-casual',
    name: 'Casual Slack Message',
    domain: 'corporate',
    prompt: `@channel — Jennifer from legal said the NDA with Acme Corp expires Friday.
Also Tom's last day is Friday, farewell lunch at noon.
Anyone know a good dentist? My insurance: Delta Dental, group #DD-789012.`,
    contextualSignals: [
      {
        signal: 'NDA expiration date + company name',
        risk: 'Low — expiration is procedural, not the content of the NDA',
        requires: 'classification',
        keywordCatchable: false,
        regexCatchable: false,
      },
    ],
    leakRisk: 'Low — casual workplace communication, mild PII',
    requiredIntelligence: 'classification',
    trueLevel: 'low',
  },
  {
    id: 'patent-application',
    name: 'Patent Application Draft',
    domain: 'legal',
    prompt: `PATENT APPLICATION — PRIVILEGED

"Quantum-Resistant Encryption for IoT" — App 17/567,890
Inventors: Dr. Wei Chen (SSN 567-89-0123), Dr. Sarah Kim (SSN 678-90-1234)
Assignee: Quantum Shield Technologies. Attorney: Michael Park, mpark@fr.com
Fish & Richardson P.C. CUI//SP-EXPT data.`,
    contextualSignals: [
      {
        signal: 'Unpublished patent application with SSNs of inventors',
        risk: 'Patent priority compromise + identity theft of inventors',
        requires: 'domain_knowledge',
        keywordCatchable: true,
        regexCatchable: true,
      },
      {
        signal: 'CUI marking (Controlled Unclassified Information)',
        risk: 'Government data handling requirement — unauthorized disclosure = violation',
        requires: 'classification',
        keywordCatchable: true,
        regexCatchable: true,
      },
    ],
    leakRisk: 'Patent priority loss, identity theft, CUI violation, trade secret exposure',
    requiredIntelligence: 'domain_knowledge',
    trueLevel: 'critical',
  },
];

// ── Analysis Functions ──────────────────────────────────────────────────────

function analyzeIntelligenceGap(testCase: IntelligenceTestCase): {
  regexCatches: number;
  keywordCatches: number;
  llmRequired: number;
  totalSignals: number;
  regexPct: number;
  keywordPct: number;
  llmOnlyPct: number;
} {
  const total = testCase.contextualSignals.length;
  if (total === 0) return { regexCatches: 0, keywordCatches: 0, llmRequired: 0, totalSignals: 0, regexPct: 0, keywordPct: 0, llmOnlyPct: 0 };

  const regexCatches = testCase.contextualSignals.filter(s => s.regexCatchable).length;
  const keywordCatches = testCase.contextualSignals.filter(s => s.keywordCatchable).length;
  const llmRequired = testCase.contextualSignals.filter(s => !s.regexCatchable && !s.keywordCatchable).length;

  return {
    regexCatches,
    keywordCatches,
    llmRequired,
    totalSignals: total,
    regexPct: (regexCatches / total) * 100,
    keywordPct: (keywordCatches / total) * 100,
    llmOnlyPct: (llmRequired / total) * 100,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Contextual Intelligence Simulation (50 Cases)', () => {
  // Aggregate trackers
  const intelligenceLevels: Record<IntelligenceRequirement, number> = {
    none: 0,
    entity_only: 0,
    classification: 0,
    relationship: 0,
    inference: 0,
    reasoning: 0,
    domain_knowledge: 0,
  };

  let totalSignals = 0;
  let regexCatchableSignals = 0;
  let keywordCatchableSignals = 0;
  let llmOnlySignals = 0;

  let scorerCorrect = 0;
  let scorerUnderrated = 0;  // System said LOW but true risk is HIGH/CRITICAL
  let scorerOverrated = 0;

  for (const testCase of INTEL_CASES) {
    describe(`[${testCase.domain}] ${testCase.name}`, () => {

      it('contextual intelligence assessment', () => {
        // Run current pipeline
        const entities = detectWithRegex(testCase.prompt);
        const score = computeScore(testCase.prompt, entities);
        const contextual = detectContextualSensitivity(testCase.prompt);
        const gap = analyzeIntelligenceGap(testCase);

        // Track intelligence level required
        intelligenceLevels[testCase.requiredIntelligence]++;

        // Track signal coverage
        totalSignals += gap.totalSignals;
        regexCatchableSignals += gap.regexCatches;
        keywordCatchableSignals += gap.keywordCatches;
        llmOnlySignals += gap.llmRequired;

        // Compare pipeline output to true risk
        const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
        const pipelineRank = levelRank[score.level] ?? 0;
        const trueRank = levelRank[testCase.trueLevel];

        if (pipelineRank >= trueRank) {
          scorerCorrect++;
        } else if (pipelineRank < trueRank) {
          scorerUnderrated++;
        } else {
          scorerOverrated++;
        }

        // Output
        console.log(`\n─── ${testCase.name} [${testCase.domain}] ───`);
        console.log(`  Pipeline says: ${score.level} (${score.score})`);
        console.log(`  TRUE risk:     ${testCase.trueLevel}`);
        console.log(`  Gap:           ${pipelineRank < trueRank ? 'UNDERRATED' : pipelineRank > trueRank ? 'OVERRATED (safe)' : 'CORRECT'}`);
        console.log(`  Intelligence:  ${testCase.requiredIntelligence}`);
        console.log(`  Contextual signals: ${gap.totalSignals} (regex: ${gap.regexCatches}, keywords: ${gap.keywordCatches}, LLM-only: ${gap.llmRequired})`);

        if (testCase.contextualSignals.length > 0) {
          console.log(`  Signals requiring LLM intelligence:`);
          for (const s of testCase.contextualSignals.filter(s => !s.regexCatchable && !s.keywordCatchable)) {
            console.log(`    * [${s.requires}] ${s.signal}`);
            console.log(`      Risk: ${s.risk}`);
          }
        }

        if (pipelineRank < trueRank) {
          console.log(`  LEAK RISK IF MISSED: ${testCase.leakRisk}`);
        }

        // Contextual keywords found
        if (contextual.length > 0) {
          console.log(`  Keyword markers: ${contextual.map(c => `"${c.matched}" (${c.category})`).join(', ')}`);
        }

        expect(true).toBe(true); // Reporting test
      });
    });
  }

  describe('AGGREGATE INTELLIGENCE ANALYSIS', () => {
    it('prints comprehensive summary', () => {
      const sensitiveCases = INTEL_CASES.filter(c => c.trueLevel !== 'low');
      const lowCases = INTEL_CASES.filter(c => c.trueLevel === 'low');

      console.log('\n' + '='.repeat(80));
      console.log('CONTEXTUAL INTELLIGENCE ANALYSIS — 50 CASES');
      console.log('='.repeat(80));

      console.log('\n1. WHAT LEVEL OF INTELLIGENCE IS NEEDED?');
      console.log('   (Across all 50 cases — what does it take to fully understand the risk?)');
      for (const [level, count] of Object.entries(intelligenceLevels).sort((a, b) => b[1] - a[1])) {
        const bar = '#'.repeat(count * 2);
        console.log(`   ${level.padEnd(18)} ${String(count).padStart(2)} cases  ${bar}`);
      }

      console.log('\n2. CURRENT PIPELINE ACCURACY (vs TRUE risk level)');
      console.log(`   Correct:     ${scorerCorrect}/${INTEL_CASES.length} (${(scorerCorrect / INTEL_CASES.length * 100).toFixed(0)}%)`);
      console.log(`   UNDERRATED:  ${scorerUnderrated}/${INTEL_CASES.length} (${(scorerUnderrated / INTEL_CASES.length * 100).toFixed(0)}%) ← DANGEROUS: system says safe when it's not`);
      console.log(`   Overrated:   ${scorerOverrated}/${INTEL_CASES.length} (conservative — safe direction)`);

      console.log('\n3. CONTEXTUAL SIGNAL COVERAGE');
      console.log(`   Total contextual signals across all cases: ${totalSignals}`);
      console.log(`   Regex can catch:     ${regexCatchableSignals}/${totalSignals} (${(regexCatchableSignals / totalSignals * 100).toFixed(0)}%)`);
      console.log(`   Keywords can catch:  ${keywordCatchableSignals}/${totalSignals} (${(keywordCatchableSignals / totalSignals * 100).toFixed(0)}%)`);
      console.log(`   LLM-ONLY:            ${llmOnlySignals}/${totalSignals} (${(llmOnlySignals / totalSignals * 100).toFixed(0)}%) ← requires reasoning/inference/domain knowledge`);

      // Categorize underrated cases
      const underratedCases = INTEL_CASES.filter(c => {
        const entities = detectWithRegex(c.prompt);
        const score = computeScore(c.prompt, entities);
        const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
        return (levelRank[score.level] ?? 0) < levelRank[c.trueLevel];
      });

      if (underratedCases.length > 0) {
        console.log(`\n4. UNDERRATED CASES (pipeline says LOW/MED, true risk is HIGH/CRITICAL):`);
        for (const c of underratedCases) {
          const entities = detectWithRegex(c.prompt);
          const score = computeScore(c.prompt, entities);
          console.log(`   [${c.id}] "${c.name}"`);
          console.log(`     Pipeline: ${score.level} (${score.score}) → True: ${c.trueLevel}`);
          console.log(`     Why: ${c.leakRisk}`);
          console.log(`     Requires: ${c.requiredIntelligence}`);
        }
      }

      // Intelligence requirement distribution for sensitive cases
      console.log('\n5. INTELLIGENCE REQUIREMENTS (sensitive cases only):');
      const reqCounts: Record<string, number> = {};
      for (const c of sensitiveCases) {
        reqCounts[c.requiredIntelligence] = (reqCounts[c.requiredIntelligence] || 0) + 1;
      }
      for (const [req, count] of Object.entries(reqCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${req.padEnd(18)} ${count}/${sensitiveCases.length} sensitive cases (${(count / sensitiveCases.length * 100).toFixed(0)}%)`);
      }

      // What types of reasoning are needed?
      const reasoningTypes: Record<string, string[]> = {};
      for (const c of INTEL_CASES) {
        for (const s of c.contextualSignals.filter(s => !s.regexCatchable && !s.keywordCatchable)) {
          if (!reasoningTypes[s.requires]) reasoningTypes[s.requires] = [];
          reasoningTypes[s.requires].push(`[${c.id}] ${s.signal}`);
        }
      }

      console.log('\n6. LLM-ONLY SIGNALS BY REASONING TYPE:');
      for (const [type, signals] of Object.entries(reasoningTypes).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n   ${type.toUpperCase()} (${signals.length} signals):`);
        for (const s of signals.slice(0, 5)) {
          console.log(`     - ${s}`);
        }
        if (signals.length > 5) console.log(`     ... and ${signals.length - 5} more`);
      }

      console.log('\n7. FALSE SENSE OF SECURITY (most dangerous gaps):');
      console.log('   Cases where pipeline says LOW but actual risk is CRITICAL:');
      for (const c of underratedCases.filter(u => u.trueLevel === 'critical')) {
        const entities = detectWithRegex(c.prompt);
        const score = computeScore(c.prompt, entities);
        if (score.level === 'low' || score.level === 'medium') {
          console.log(`   *** [${c.id}] ${c.name}`);
          console.log(`       Pipeline: ${score.level} (${score.score})`);
          console.log(`       TRUE: CRITICAL — ${c.leakRisk}`);
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('BOTTOM LINE:');
      console.log('  Entity detection (regex/ML) answers: "What PII is in the text?"');
      console.log('  Contextual keywords answer: "What type of document is this?"');
      console.log(`  But ${(llmOnlySignals / totalSignals * 100).toFixed(0)}% of risk signals require REASONING about:`);
      console.log('    - WHY combinations of facts create danger (indirect identifiers)');
      console.log('    - WHAT regulations apply (MNPI, HIPAA, ITAR, FERPA, GDPR)');
      console.log('    - WHO is really at risk (re-identification, retaliation, discrimination)');
      console.log('    - WHEN timing matters (embargo dates, notification deadlines)');
      console.log('  This is the intelligence layer that only an LLM can provide.');
      console.log('='.repeat(80));

      expect(true).toBe(true);
    });
  });
});
