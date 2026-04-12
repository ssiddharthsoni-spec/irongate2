/**
 * IronGate Detection Pipeline — 50-Scenario Stress Test
 *
 * Tests the DETERMINISTIC stack only (no AI layers):
 *   - Regex entity detection
 *   - Document classification
 *   - Contextual keywords
 *   - Intent suppression
 *   - Scorer (entity weights + multipliers + co-occurrence)
 *   - Executive lens
 *   - Entity merger
 *
 * Each scenario has an expected verdict: ALLOW, WARN, or BLOCK.
 * We compare the actual score/zone against expectations.
 */

import { detectWithRegex } from './apps/extension/src/detection/fallback-regex.ts';
import { classifyDocument, DOCUMENT_TYPE_MULTIPLIERS } from './apps/extension/src/detection/document-classifier.ts';
import { detectContextualSensitivity, computeContextualScore } from './apps/extension/src/detection/contextual-keywords.ts';
import { applyIntentSuppression } from './apps/extension/src/detection/intent-suppression.ts';
import { computeScore } from './apps/extension/src/detection/scorer.ts';
import { mergeEntities } from './apps/extension/src/detection/entity-merger.ts';
import { analyzeWithExecutiveLens } from './apps/extension/src/detection/executive-lens.ts';

// ── Scenario Definition ────────────────────────────────────────────────────

interface Scenario {
  id: number;
  category: string;
  description: string;
  prompt: string;
  expectedVerdict: 'ALLOW' | 'WARN' | 'BLOCK';
  expectedZone: 'green' | 'amber' | 'red';
  industry?: string;
}

// ── 50 Test Scenarios ──────────────────────────────────────────────────────

const scenarios: Scenario[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY A: TRUE NEGATIVES — Should be GREEN / ALLOW (16 scenarios)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 1,
    category: 'TRUE_NEGATIVE',
    description: 'Simple coding question',
    prompt: 'How do I reverse a string in Python?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 2,
    category: 'TRUE_NEGATIVE',
    description: 'Horoscope with DOB',
    prompt: 'My birthday is March 15, 1990. What is my horoscope sign and what does this week look like for me?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 3,
    category: 'TRUE_NEGATIVE',
    description: 'Public company research',
    prompt: 'Give me competitors for Salesforce in the CRM space. What are their market caps?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 4,
    category: 'TRUE_NEGATIVE',
    description: 'Generic writing help',
    prompt: 'Help me write a professional email declining a meeting invitation politely.',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 5,
    category: 'TRUE_NEGATIVE',
    description: 'Recipe question',
    prompt: 'What is a good recipe for chocolate chip cookies that takes less than 30 minutes?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 6,
    category: 'TRUE_NEGATIVE',
    description: 'Travel planning',
    prompt: 'I am planning a trip to Tokyo in April. What are the best neighborhoods to stay in and what should I see?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 7,
    category: 'TRUE_NEGATIVE',
    description: 'Generic code review',
    prompt: 'Review this React component for performance issues:\n\nfunction UserList({ users }) {\n  return users.map(u => <div key={u.id}>{u.name}</div>);\n}',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 8,
    category: 'TRUE_NEGATIVE',
    description: 'Public figure question',
    prompt: 'Who is the CEO of Apple and what is their background?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 9,
    category: 'TRUE_NEGATIVE',
    description: 'Self-introduction draft',
    prompt: 'Help me write a short bio for myself. I am a software engineer with 5 years of experience in React and Node.js.',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 10,
    category: 'TRUE_NEGATIVE',
    description: 'Generic summarization',
    prompt: 'Summarize the key differences between REST APIs and GraphQL. When should I use each?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 11,
    category: 'TRUE_NEGATIVE',
    description: 'Weather question',
    prompt: 'What is the weather forecast for New York City this weekend?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 12,
    category: 'TRUE_NEGATIVE',
    description: 'Definition query',
    prompt: 'What is the difference between machine learning and deep learning?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 13,
    category: 'TRUE_NEGATIVE',
    description: 'Creative writing',
    prompt: 'Write me a haiku about a sunset over the ocean.',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 14,
    category: 'TRUE_NEGATIVE',
    description: 'How-to question',
    prompt: 'How do I set up a CI/CD pipeline with GitHub Actions for a Node.js project?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 15,
    category: 'TRUE_NEGATIVE',
    description: 'Public financial data',
    prompt: 'What was Apple\'s revenue last quarter? How does it compare to Microsoft?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 16,
    category: 'TRUE_NEGATIVE',
    description: 'Job posting / public content',
    prompt: 'Help me write a job posting for a Senior Software Engineer position. Requirements: 5+ years experience, React, TypeScript, AWS.',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY B: TRUE POSITIVES — Should be RED / BLOCK (18 scenarios)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 17,
    category: 'TRUE_POSITIVE',
    description: 'SSN in text',
    prompt: 'Can you verify this SSN for me: 123-45-6789? I need to check if it is valid.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 18,
    category: 'TRUE_POSITIVE',
    description: 'Credit card number',
    prompt: 'My credit card number is 4532-1234-5678-9012 and it expires 12/25. Can you help me format this for a form?',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 19,
    category: 'TRUE_POSITIVE',
    description: 'AWS credentials',
    prompt: 'I am getting an error with my AWS config. Here are my credentials:\nAKIAIOSFODNN7EXAMPLE\nwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nCan you help debug?',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 20,
    category: 'TRUE_POSITIVE',
    description: 'M&A deal with financials',
    prompt: 'STRICTLY CONFIDENTIAL: Sullivan & Cromwell is advising on Project Evergreen. Apex Capital is acquiring Meridian Technologies at $47/share, representing a 30% premium to Friday\'s close. Expected close Q3. Total deal value $2.8B. Do not share externally.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 21,
    category: 'TRUE_POSITIVE',
    description: 'Patient medical record (HIPAA)',
    prompt: 'Patient: John Smith, DOB 03/15/1985, MRN: 4827391. Diagnosis: Type 2 Diabetes with complications. Current medications: Metformin 1000mg, Lisinopril 20mg. A1C level 8.2%. Please summarize this for the care team.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 22,
    category: 'TRUE_POSITIVE',
    description: 'Private key',
    prompt: 'Can you check if this RSA key format is correct?\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/yGEuMEmS1Hzz\nQgy5xGEuNmXQJCAr7XMW\n-----END RSA PRIVATE KEY-----',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 23,
    category: 'TRUE_POSITIVE',
    description: 'Attorney-client privileged communication',
    prompt: 'ATTORNEY-CLIENT PRIVILEGED AND CONFIDENTIAL\n\nFrom: Sarah Chen, General Counsel\nTo: Board of Directors\n\nRe: Potential SEC Investigation\n\nThe SEC has issued a subpoena regarding our Q2 revenue recognition practices. Our outside counsel at Davis Polk recommends we preserve all documents related to the Meridian contract. James Rodriguez in sales may have made representations that conflict with our filed disclosures.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 24,
    category: 'TRUE_POSITIVE',
    description: 'Database connection string',
    prompt: 'Our production database is down. Here is the connection string: postgresql://admin:S3cretP@ss!@prod-db.us-east-1.rds.amazonaws.com:5432/irongate_prod. Can you help me write a query to check the health?',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 25,
    category: 'TRUE_POSITIVE',
    description: 'Multiple SSNs (bulk PII)',
    prompt: 'I need to format these employee records:\nJohn Smith - SSN: 123-45-6789\nJane Doe - SSN: 987-65-4321\nBob Wilson - SSN: 456-78-9012\nAlice Johnson - SSN: 321-54-9876',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 26,
    category: 'TRUE_POSITIVE',
    description: 'IPO pricing (MNPI)',
    prompt: 'NovaTech Inc IPO: Books are 8.2x oversubscribed at the midpoint of $28-$32. Fidelity wants 15% of the deal, BlackRock is in for 12%. We are recommending pricing at $34, above range. Greenshoe is 4.5M shares. Morgan Stanley and Goldman Sachs co-leading. Not yet public.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 27,
    category: 'TRUE_POSITIVE',
    description: 'Employee termination plan',
    prompt: 'CONFIDENTIAL - DO NOT DISTRIBUTE: We are planning to lay off 2,200 employees (30% of workforce) across all divisions of Consolidated Pacific Industries. The restructuring charge will be approximately $180M. Announcement date is set for March 15. CEO Robert Chen and CFO Maria Santos have approved. Severance packages: VP+ gets 12 months, Director 9 months, Manager 6 months.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 28,
    category: 'TRUE_POSITIVE',
    description: 'Insurance claims with reserves (IBNR)',
    prompt: 'Q4 Claims Reserve Summary for the board: IBNR stands at $340M, up 15% from Q3. Hurricane exposure: gross $890M, net of reinsurance $210M. The catastrophe model shows a probable maximum loss of $1.2B for a 1-in-100 year event. Recommend increasing reserves by $45M before the rating agency meeting with AM Best next week.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 29,
    category: 'TRUE_POSITIVE',
    description: 'Government classified marking',
    prompt: 'TOP SECRET//SCI//NOFORN\n\nIntelligence Assessment: Region 7 Operations\n\nAsset CARDINAL reports increased activity at the northern facility. Satellite imagery from NRO confirms construction of new infrastructure consistent with previous assessments.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 30,
    category: 'TRUE_POSITIVE',
    description: 'Passport number',
    prompt: 'I need to fill out a visa application for our employee. Name: Michael Torres, Passport: US E12345678, DOB: 07/22/1988, Nationality: American. Can you format this for the embassy form?',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 31,
    category: 'TRUE_POSITIVE',
    description: 'Board minutes with exec comp',
    prompt: 'BOARD OF DIRECTORS MEETING MINUTES - CONFIDENTIAL\n\nAttendees: Robert Chen (CEO), Maria Santos (CFO), James Wilson (COO), Lisa Park (GC)\n\nResolution 2024-03: Approved CEO compensation package: Base $1.2M, bonus target 150%, equity grant 500,000 RSUs vesting over 4 years. CFO compensation: Base $850K, bonus target 125%.\n\nResolution 2024-04: Authorized share repurchase of up to $500M over 12 months. Not yet disclosed to market.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 32,
    category: 'TRUE_POSITIVE',
    description: 'LBO model details',
    prompt: 'Project Atlas LBO: Pinnacle Software, entry at 12.5x LTM EBITDA ($180M). Debt package: 5.5x first lien at S+450, 1.5x second lien at S+800. Sponsor equity check $950M. Management rollover: CEO 5%, CTO 3%. Base case returns: 2.8x MOIC, 24% IRR over 5 years. Key risk: customer concentration (top 3 = 40% revenue). KKR competing bid expected at 13x.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 33,
    category: 'TRUE_POSITIVE',
    description: 'API key in code',
    prompt: 'My Stripe integration is failing. Here is my config:\n\nconst stripe = require("stripe")("sk_live_4eC39HqLyjWDarjtT1zdp7dc");\n\nconst paymentIntent = await stripe.paymentIntents.create({\n  amount: 2000,\n  currency: "usd",\n});\n\nWhat am I doing wrong?',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 34,
    category: 'TRUE_POSITIVE',
    description: 'Student records (FERPA)',
    prompt: 'Student: Emily Rodriguez, Student ID: 2024-78432. GPA: 3.85. Disciplinary record: Academic integrity violation in CHEM 201, Spring 2024. Placed on probation. Faculty advisor: Dr. James Patterson. Please draft a letter to the academic review board.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY C: AMBER ZONE — The Hard Cases (10 scenarios)
  // These test the nuance: should score 26-60 (AMBER/WARN)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 35,
    category: 'AMBER_ZONE',
    description: 'Email with one name, business context',
    prompt: 'Draft an email to Sarah Chen thanking her for the meeting yesterday. Mention that we will follow up on the proposal by end of week.',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 36,
    category: 'AMBER_ZONE',
    description: 'Meeting notes with names but no sensitive data',
    prompt: 'Meeting notes from today\'s standup:\n- John presented the Q3 roadmap\n- Lisa flagged the delayed timeline on the mobile app\n- Budget discussion postponed to Friday\n- Action item: Mike to send updated timeline by EOD',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 37,
    category: 'AMBER_ZONE',
    description: 'Vague M&A language without specifics',
    prompt: 'We are thinking about acquiring a smaller company in the AI space. What are the typical steps in an M&A process? What should we look out for in due diligence?',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 38,
    category: 'AMBER_ZONE',
    description: 'Internal email with client name',
    prompt: 'Can you help me write a follow-up email to our client Accenture about the consulting engagement? We discussed their digital transformation strategy and need to propose next steps for the cloud migration project.',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 39,
    category: 'AMBER_ZONE',
    description: 'Financial analysis without confidential markers',
    prompt: 'Here is our Q3 revenue breakdown:\n- Product A: $12M (up 15% YoY)\n- Product B: $8M (flat)\n- Product C: $3M (new, launched Q2)\n\nTotal: $23M. Can you help me create a chart-ready summary?',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 40,
    category: 'AMBER_ZONE',
    description: 'HR question with general context',
    prompt: 'We need to restructure the engineering team. Currently 45 people across 3 pods. Thinking about moving to 5 smaller squads of 8-9 each. What are the best practices for communicating a reorg to the team?',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 41,
    category: 'AMBER_ZONE',
    description: 'IP address in debugging context',
    prompt: 'Our server at 10.0.1.45 is returning 503 errors. The load balancer at 10.0.1.10 shows healthy. Can you help me write a troubleshooting script?',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 42,
    category: 'AMBER_ZONE',
    description: 'Client memo without high PII',
    prompt: 'Memo to the client engagement team:\n\nRe: Accenture Digital Transformation\n\nWe\'ve completed Phase 1 assessment. Key findings:\n1. Legacy systems account for 60% of IT spend\n2. Cloud readiness score: 4/10\n3. Estimated migration cost: $2.5M over 18 months\n\nRecommend proceeding to Phase 2 detailed design.',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 43,
    category: 'AMBER_ZONE',
    description: 'Competitive intelligence gathering',
    prompt: 'I heard that our competitor DataShield just raised a Series B. Can you help me analyze their product positioning versus ours? Their CEO mentioned on LinkedIn that they are focusing on healthcare and financial services.',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 44,
    category: 'AMBER_ZONE',
    description: 'Contract review request (no privileged content)',
    prompt: 'Review this clause from our standard vendor agreement:\n\n"Vendor shall indemnify and hold harmless Client from any claims arising from Vendor\'s breach of this Agreement, including reasonable attorney\'s fees."\n\nIs this standard or should we negotiate changes?',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY D: EDGE CASES — Tricky Scenarios (6 scenarios)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 45,
    category: 'EDGE_CASE',
    description: 'Fake SSN in educational context',
    prompt: 'For the training exercise, use this example SSN: 000-00-0000. Show me how to validate SSN format in JavaScript.',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 46,
    category: 'EDGE_CASE',
    description: 'Real company name in benign context',
    prompt: 'What is Goldman Sachs\' investment banking division known for? How do they compare to Morgan Stanley in terms of M&A advisory?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 47,
    category: 'EDGE_CASE',
    description: 'Medical terms without patient data',
    prompt: 'What are the common side effects of Metformin for Type 2 Diabetes treatment? What is the typical dosing schedule?',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
  {
    id: 48,
    category: 'EDGE_CASE',
    description: 'Subtle sensitive context — no PII but implies confidentiality',
    prompt: 'Tell the team we are going with the higher number. John approved it yesterday but don\'t share until the call with the board on Thursday.',
    expectedVerdict: 'WARN',
    expectedZone: 'amber',
  },
  {
    id: 49,
    category: 'EDGE_CASE',
    description: 'Long benign text with an SSN buried inside',
    prompt: 'I am writing a blog post about data privacy. Here is my draft:\n\nData breaches are on the rise. In 2023, over 3,000 incidents exposed billions of records. Companies must invest in better security practices. For example, never store sensitive data like social security numbers (e.g., 234-56-7890) in plain text. Always encrypt at rest and in transit. Use tokenization where possible.',
    expectedVerdict: 'BLOCK',
    expectedZone: 'red',
  },
  {
    id: 50,
    category: 'EDGE_CASE',
    description: 'Resume / CV with personal details',
    prompt: 'Help me update my resume. Here is my current version:\n\nJohn Smith\nemail: john.smith@gmail.com\nPhone: (555) 123-4567\n\nExperience:\n- Senior Engineer at Acme Corp (2020-present)\n- Engineer at StartupXYZ (2018-2020)\n\nSkills: Python, React, AWS',
    expectedVerdict: 'ALLOW',
    expectedZone: 'green',
  },
];

// ── Test Runner ────────────────────────────────────────────────────────────

function scoreToZone(score: number): 'green' | 'amber' | 'red' {
  if (score <= 25) return 'green';
  if (score <= 60) return 'amber';
  return 'red';
}

function zoneToVerdict(zone: 'green' | 'amber' | 'red'): 'ALLOW' | 'WARN' | 'BLOCK' {
  if (zone === 'green') return 'ALLOW';
  if (zone === 'amber') return 'WARN';
  return 'BLOCK';
}

interface TestResult {
  scenario: Scenario;
  score: number;
  level: string;
  zone: 'green' | 'amber' | 'red';
  actualVerdict: 'ALLOW' | 'WARN' | 'BLOCK';
  entities: Array<{ type: string; text: string; confidence: number }>;
  documentType: string;
  documentMultiplier: number;
  contextualKeywords: Array<{ category: string; weight: number }>;
  intentSuppressed: boolean;
  executiveLens: string;
  pass: boolean;
  explanation: string;
  latencyMs: number;
}

async function runScenario(scenario: Scenario): Promise<TestResult> {
  const start = performance.now();
  const text = scenario.prompt;

  // Step 1: Regex detection
  const regexEntities = detectWithRegex(text);

  // Step 2: Document classification
  const docClass = classifyDocument(text);

  // Step 3: Contextual keywords
  const contextualMarkers = detectContextualSensitivity(text);
  const contextualScore = computeContextualScore(contextualMarkers);

  // Step 4: Entity merge (just regex for deterministic test)
  const mergedEntities = mergeEntities(regexEntities);

  // Step 5: Scoring (no NLI — deterministic only)
  const scoreResult = computeScore(text, mergedEntities);

  // Step 6: Executive lens
  const lensResult = analyzeWithExecutiveLens(text, mergedEntities);

  // Step 7: Intent suppression check (for reporting)
  const suppressionResult = applyIntentSuppression(text, mergedEntities);

  const zone = scoreToZone(scoreResult.score);
  const actualVerdict = zoneToVerdict(zone);
  const latencyMs = performance.now() - start;

  const pass = zone === scenario.expectedZone;

  return {
    scenario,
    score: scoreResult.score,
    level: scoreResult.level,
    zone,
    actualVerdict,
    entities: mergedEntities.map(e => ({ type: e.type, text: e.text.substring(0, 40), confidence: e.confidence })),
    documentType: docClass.type,
    documentMultiplier: DOCUMENT_TYPE_MULTIPLIERS[docClass.type as keyof typeof DOCUMENT_TYPE_MULTIPLIERS] || 1.0,
    contextualKeywords: contextualMarkers.map(m => ({ category: m.category, weight: m.weight })),
    intentSuppressed: suppressionResult.scoreMultiplier < 1.0,
    executiveLens: lensResult.route,
    pass,
    explanation: scoreResult.explanation,
    latencyMs,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IRONGATE DETECTION PIPELINE — 50-SCENARIO STRESS TEST');
  console.log('  Testing: Deterministic Stack Only (No AI Layers)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: TestResult[] = [];

  for (const scenario of scenarios) {
    try {
      const result = await runScenario(scenario);
      results.push(result);
    } catch (err) {
      console.error(`CRASH on scenario ${scenario.id}: ${err}`);
      results.push({
        scenario,
        score: -1,
        level: 'ERROR',
        zone: 'green',
        actualVerdict: 'ALLOW',
        entities: [],
        documentType: 'ERROR',
        documentMultiplier: 0,
        contextualKeywords: [],
        intentSuppressed: false,
        executiveLens: 'ERROR',
        pass: false,
        explanation: `CRASH: ${err}`,
        latencyMs: 0,
      });
    }
  }

  // ── Print Results ──────────────────────────────────────────────────────

  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);

  // Detailed results
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    const scoreBar = '█'.repeat(Math.round(r.score / 5)) + '░'.repeat(20 - Math.round(r.score / 5));
    console.log(`${icon} #${String(r.scenario.id).padStart(2, '0')} [${r.zone.toUpperCase().padEnd(5)}] Score: ${String(r.score).padStart(3)} ${scoreBar} | ${r.scenario.description}`);

    if (!r.pass) {
      console.log(`   ⚠ Expected: ${r.scenario.expectedZone.toUpperCase()} (${r.scenario.expectedVerdict}) | Got: ${r.zone.toUpperCase()} (${r.actualVerdict})`);
      console.log(`   📊 Entities: ${r.entities.map(e => `${e.type}("${e.text}")`).join(', ') || 'none'}`);
      console.log(`   📄 Doc Type: ${r.documentType} (${r.documentMultiplier}x)`);
      if (r.contextualKeywords.length > 0) {
        console.log(`   🔑 Keywords: ${r.contextualKeywords.map(k => `${k.category}(${k.weight})`).join(', ')}`);
      }
      if (r.intentSuppressed) console.log(`   🔇 Intent suppression ACTIVE`);
      console.log(`   📝 ${r.explanation}`);
    }

    if (r.score === -1) {
      console.log(`   💥 ${r.explanation}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
  const avgLatency = totalLatency / results.length;

  console.log(`Total:    ${results.length} scenarios`);
  console.log(`Passed:   ${passed.length} (${(passed.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Failed:   ${failed.length} (${(failed.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Avg Time: ${avgLatency.toFixed(2)}ms per scenario`);
  console.log(`Total:    ${totalLatency.toFixed(2)}ms\n`);

  // By category
  const categories = ['TRUE_NEGATIVE', 'TRUE_POSITIVE', 'AMBER_ZONE', 'EDGE_CASE'];
  for (const cat of categories) {
    const catResults = results.filter(r => r.scenario.category === cat);
    const catPassed = catResults.filter(r => r.pass);
    console.log(`  ${cat.padEnd(15)} ${catPassed.length}/${catResults.length} (${(catPassed.length / catResults.length * 100).toFixed(0)}%)`);
  }

  // ── Failure Analysis ─────────────────────────────────────────────────

  if (failed.length > 0) {
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('  FAILURE ANALYSIS');
    console.log('───────────────────────────────────────────────────────────────\n');

    const falsePositives = failed.filter(r =>
      r.scenario.expectedZone === 'green' && r.zone !== 'green'
    );
    const falseNegatives = failed.filter(r =>
      r.scenario.expectedZone === 'red' && r.zone !== 'red'
    );
    const amberMisses = failed.filter(r =>
      r.scenario.expectedZone === 'amber'
    );

    if (falsePositives.length > 0) {
      console.log(`  FALSE POSITIVES (flagged benign content): ${falsePositives.length}`);
      for (const r of falsePositives) {
        console.log(`    #${r.scenario.id}: "${r.scenario.description}" → Score ${r.score} (${r.zone})`);
        console.log(`      Entities: ${r.entities.map(e => e.type).join(', ') || 'none'}`);
      }
    }

    if (falseNegatives.length > 0) {
      console.log(`\n  FALSE NEGATIVES (missed sensitive content): ${falseNegatives.length}`);
      for (const r of falseNegatives) {
        console.log(`    #${r.scenario.id}: "${r.scenario.description}" → Score ${r.score} (${r.zone})`);
        console.log(`      Entities: ${r.entities.map(e => e.type).join(', ') || 'none'}`);
      }
    }

    if (amberMisses.length > 0) {
      console.log(`\n  AMBER ZONE MISSES (wrong zone for nuanced content): ${amberMisses.length}`);
      for (const r of amberMisses) {
        const direction = r.zone === 'green' ? 'under-scored' : 'over-scored';
        console.log(`    #${r.scenario.id}: "${r.scenario.description}" → Score ${r.score} (${r.zone}, ${direction})`);
        console.log(`      Entities: ${r.entities.map(e => e.type).join(', ') || 'none'}`);
      }
    }
  }

  // ── Score Distribution ───────────────────────────────────────────────

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('  SCORE DISTRIBUTION');
  console.log('───────────────────────────────────────────────────────────────\n');

  const greenResults = results.filter(r => r.zone === 'green');
  const amberResults = results.filter(r => r.zone === 'amber');
  const redResults = results.filter(r => r.zone === 'red');

  console.log(`  GREEN  (0-25):   ${greenResults.length} scenarios → ${greenResults.map(r => r.score).join(', ')}`);
  console.log(`  AMBER  (26-60):  ${amberResults.length} scenarios → ${amberResults.map(r => r.score).join(', ')}`);
  console.log(`  RED    (61-100): ${redResults.length} scenarios → ${redResults.map(r => r.score).join(', ')}`);

  // Write JSON for further analysis
  const outputPath = './test-results-50.json';
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results written to: ${outputPath}`);
}

main().catch(console.error);
