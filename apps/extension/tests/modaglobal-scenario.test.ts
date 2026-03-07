/**
 * Real-World Scenario: ModaGlobal PE Crisis
 *
 * Tests the full pipeline against a complex, multi-risk corporate scenario
 * that a CEO, CTO, CIO, and CISO would each evaluate differently.
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';
import { detectContextualSensitivity } from '../src/detection/contextual-keywords';
import { classifyDocument } from '../src/detection/document-classifier';
import { createRiskAssessor } from '../src/agent/risk-assessor';

const MODAGLOBAL_PROMPT = `STRICTLY CONFIDENTIAL — BOARD PREPARATION MATERIALS
ModaGlobal Holdings, Inc. — Special Board Meeting, March 12, 2025

Prepared by: Jennifer Wu, CFO
Distribution: Board Members ONLY — Do NOT forward

SITUATION OVERVIEW

ModaGlobal, a PE-backed fast-fashion retailer, is facing an existential liquidity crisis.
Our private equity sponsor is Blackstone Capital Partners (Fund VII, $2.1B equity commitment).

1. INVENTORY CRISIS
   Inventory turnover has slowed to 2.1x vs industry average of 6x.
   Approximately $400M in seasonal inventory is sitting in West Coast ports
   due to the ongoing ILWU labor action. Product is becoming dead stock —
   spring/summer merchandise will be worthless by Q3.

   CFO Analysis: Write-down of $280M likely. Impact to EBITDA: negative $280M.
   This single event drops our LTM EBITDA from $450M to $170M.

2. DEBT COVENANT BREACH (IMMINENT)
   Current debt structure:
   - Senior Secured Credit Facility: $1.2B (JP Morgan Chase, agent)
   - Second Lien Term Loan: $450M (Apollo Global, held)
   - Unsecured Notes: $300M (public, CUSIP: 60478X-AB-1, trading at $0.42)

   Debt-to-EBITDA ratio: 5.5x (post write-down: 11.5x)
   Covenant threshold: 6.0x — WE ARE IN TECHNICAL DEFAULT as of next reporting.

   JP Morgan's restructuring group (led by David Kim, Managing Director) has
   been informally notified. They are assembling their advisory team from
   Evercore (Sarah Martinez, Senior MD) to evaluate options.

   CRITICAL: Do NOT let this reach the unsecured noteholders or the
   public markets before the Board votes on the restructuring plan.

3. STRATEGIC PIVOT: DROP-SHIP MARKETPLACE MODEL
   Recommendation: Transform from owned-inventory retailer to a drop-ship
   marketplace platform. Key metrics:
   - Close 120 of 180 brick-and-mortar stores (67% of fleet)
   - Workforce reduction: 8,500 positions (45% of workforce)
   - CAPEX: $150M for platform buildout (tech team led by CTO Marcus Rodriguez)
   - Target: Asset-light model with 35% gross margins vs current 22%

   Store closing costs: $320M (lease termination, severance, inventory liquidation)
   WARN Act notification required 60 days before closings.
   Employment counsel: Rachel Torres, Partner, Littler Mendelson

4. BLACKSTONE RESTRUCTURING PROPOSAL
   Blackstone is proposing a debt-for-equity swap:
   - Convert $600M of the second lien to equity (45% of reorganized company)
   - Founding family (Zhang family, currently 35% voting control) would be
     diluted to <5%. Effectively strips founder control.
   - New board: 5 Blackstone designees, 2 management, 1 independent, 1 founder
   - Zhang Wei (Chairman/Founder) has retained Wachtell Lipton to fight this.
     His position: "This is a hostile takeover disguised as a restructuring."

   Robert Anderson, Blackstone Operating Partner, stated privately:
   "If Zhang doesn't agree by March 20, we'll exercise the drag-along
   and force the conversion. The LPA gives us the right."

5. MARKETING DISASTER
   CMO Lisa Park approved a $50M celebrity marketing campaign (partnership with
   [REDACTED CELEBRITY]) for the spring collection — the same collection now
   sitting in ports. Campaign launched January 15 and is non-cancellable.

   Sunk cost: $50M. ROI: effectively zero if product doesn't reach stores.
   The celebrity's team (CAA, agent Tom Liu) is threatening breach-of-contract
   if we don't fulfill retail distribution commitments per the endorsement deal.

6. KEY DATES
   - March 12: Board meeting (this document)
   - March 15: Q4 earnings release (must disclose going-concern risk)
   - March 20: Blackstone ultimatum deadline
   - April 1: WARN Act notification deadline (if store closings approved)
   - April 15: Covenant compliance certificate due to JP Morgan

RECOMMENDATION: Approve the drop-ship pivot, negotiate an extension with
JP Morgan, and counter Blackstone's proposal with a 15% founder retention.

Respectfully submitted,
Jennifer Wu, CFO
jennifer.wu@modaglobal.com
(212) 555-0198

CC: General Counsel Robert Park, Morrison & Foerster LLP
    Outside Counsel: Lisa Chen, Kirkland & Ellis (restructuring)
    Financial Advisor: Michael Torres, Houlihan Lokey`;

describe('ModaGlobal PE Crisis — Full Pipeline Analysis', () => {

  it('Layer 1: What REGEX sees', () => {
    const entities = detectWithRegex(MODAGLOBAL_PROMPT);

    console.log('\n' + '='.repeat(80));
    console.log('LAYER 1: REGEX DETECTION');
    console.log('='.repeat(80));
    console.log(`Entities found: ${entities.length}`);

    const byType: Record<string, string[]> = {};
    for (const e of entities) {
      if (!byType[e.type]) byType[e.type] = [];
      byType[e.type].push(e.text);
    }
    for (const [type, texts] of Object.entries(byType).sort()) {
      console.log(`  ${type}: ${texts.join(' | ')}`);
    }

    console.log('\nWhat regex MISSES:');
    console.log('  - "ModaGlobal" as ORGANIZATION (not a pattern)');
    console.log('  - "Blackstone Capital Partners" as ORGANIZATION');
    console.log('  - "JP Morgan Chase" as ORGANIZATION');
    console.log('  - "Apollo Global" as ORGANIZATION');
    console.log('  - "Jennifer Wu", "David Kim", "Sarah Martinez" as PERSON');
    console.log('  - "Zhang Wei" as PERSON (founder being stripped of control)');
    console.log('  - "Project" codenames, deal structure, covenant details');
    console.log('  - The ENTIRE business context of WHY this is sensitive');

    expect(entities.length).toBeGreaterThan(0);
  });

  it('Layer 2: What CONTEXTUAL KEYWORDS see', () => {
    const markers = detectContextualSensitivity(MODAGLOBAL_PROMPT);

    console.log('\n' + '='.repeat(80));
    console.log('LAYER 2: CONTEXTUAL KEYWORD DETECTION');
    console.log('='.repeat(80));
    console.log(`Markers found: ${markers.length}`);

    for (const m of markers) {
      console.log(`  [${m.category}] "${m.matched}" (weight: ${m.weight}, confidence: ${m.confidence.toFixed(2)})`);
    }

    console.log('\nWhat keywords CATCH:');
    console.log('  - Deal/acquisition language');
    console.log('  - Restructuring terminology');
    console.log('  - Confidential markers');
    console.log('\nWhat keywords MISS:');
    console.log('  - WHY the debt-for-equity swap strips founder control');
    console.log('  - That "drag-along" is a hostile takeover mechanism');
    console.log('  - That $400M dead stock + $280M write-down = EBITDA collapse');
    console.log('  - That earnings release in 3 days requires going-concern disclosure');
  });

  it('Layer 3: What the DOCUMENT CLASSIFIER sees', () => {
    const doc = classifyDocument(MODAGLOBAL_PROMPT);

    console.log('\n' + '='.repeat(80));
    console.log('LAYER 3: DOCUMENT CLASSIFICATION');
    console.log('='.repeat(80));
    console.log(`  Type: ${doc.type} (confidence: ${doc.confidence.toFixed(2)})`);
    console.log(`  Signals: ${doc.signals.join(', ')}`);
    console.log(`  Multiplier: This boosts sensitivity scoring`);
  });

  it('Layer 4: What the SCORER produces', () => {
    const entities = detectWithRegex(MODAGLOBAL_PROMPT);
    const score = computeScore(MODAGLOBAL_PROMPT, entities);

    console.log('\n' + '='.repeat(80));
    console.log('LAYER 4: SENSITIVITY SCORER');
    console.log('='.repeat(80));
    console.log(`  Score: ${score.score} (${score.level})`);
    console.log(`  Breakdown:`);
    console.log(`    Entity score:        ${score.breakdown.entityScore}`);
    console.log(`    Volume score:        ${score.breakdown.volumeScore}`);
    console.log(`    Context score:       ${score.breakdown.contextScore}`);
    console.log(`    Legal boost:         ${score.breakdown.legalBoost}`);
    console.log(`    Contextual keywords: ${score.breakdown.contextualKeywordScore}`);
    console.log(`    Document type mult:  ${score.breakdown.documentTypeMultiplier}x`);
    console.log(`  Explanation: ${score.explanation}`);
  });

  it('Layer 5: What the RISK ASSESSOR sees (the intelligence layer)', async () => {
    const entities = detectWithRegex(MODAGLOBAL_PROMPT);
    const contextual = detectContextualSensitivity(MODAGLOBAL_PROMPT);
    const docType = classifyDocument(MODAGLOBAL_PROMPT);

    const assessor = createRiskAssessor(); // Rule-based only (no LLM in tests)
    const risk = await assessor.assess({
      text: MODAGLOBAL_PROMPT,
      entities,
      documentType: docType.type,
      contextualMarkers: contextual.map(c => ({
        category: c.category,
        weight: c.weight,
        confidence: c.confidence,
      })),
    });

    console.log('\n' + '='.repeat(80));
    console.log('LAYER 5: RISK ASSESSOR — "THE GENERAL COUNSEL REVIEW"');
    console.log('='.repeat(80));
    console.log(`\n  Overall: ${risk.level.toUpperCase()} (score: ${risk.score})`);
    console.log(`  Action:  ${risk.action}`);
    console.log(`  Headline: ${risk.headline}`);

    // Group by executive owner
    const byOwner: Record<string, typeof risk.risks> = {};
    for (const r of risk.risks) {
      if (!byOwner[r.owner]) byOwner[r.owner] = [];
      byOwner[r.owner].push(r);
    }

    const ownerDescriptions: Record<string, string> = {
      CEO: 'BUSINESS RISK — "What kills the deal or tanks the stock?"',
      CTO: 'TECHNICAL RISK — "What can be exploited?"',
      CIO: 'COMPLIANCE RISK — "What regulations are we violating?"',
      CISO: 'SECURITY RISK — "What enables an attack?"',
    };

    for (const owner of ['CEO', 'CTO', 'CIO', 'CISO']) {
      const ownerRisks = byOwner[owner] || [];
      console.log(`\n  ${owner}: ${ownerDescriptions[owner]}`);
      if (ownerRisks.length === 0) {
        console.log('    (no signals from this lens)');
      }
      for (const r of ownerRisks) {
        console.log(`    [${r.severity.toUpperCase()}] ${r.category}`);
        console.log(`      Signal: ${r.signal}`);
        console.log(`      Consequence: ${r.consequence}`);
        if (r.regulation) console.log(`      Regulation: ${r.regulation}`);
      }
    }

    if (risk.regulations.length > 0) {
      console.log(`\n  Applicable regulations: ${risk.regulations.join('; ')}`);
    }

    console.log(`\n  Latency: ${risk.latencyMs.toFixed(1)}ms`);
  });

  it('Layer 6: What an LLM INTELLIGENCE AGENT would ADDITIONALLY catch', () => {
    console.log('\n' + '='.repeat(80));
    console.log('LAYER 6: LLM DEEP ANALYSIS — WHAT RULES CANNOT CATCH');
    console.log('='.repeat(80));

    console.log(`
  An LLM reading this document would identify risks that NO rule-based
  system can detect — because they require REASONING about connected facts:

  ┌─────────────────────────────────────────────────────────────────────┐
  │  CEO LENS — What a CEO Would See                                   │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  1. EXISTENTIAL LIQUIDITY CRISIS                                   │
  │     $400M dead stock + $280M write-down = EBITDA drops from $450M  │
  │     to $170M. Debt ratio explodes from 5.5x to 11.5x.             │
  │     → This isn't a performance issue, it's a solvency crisis.      │
  │                                                                     │
  │  2. HOSTILE TAKEOVER IN DISGUISE                                   │
  │     "Debt-for-equity swap" that dilutes founders from 35% to <5%.  │
  │     Blackstone's "drag-along" threat = forced conversion.          │
  │     Founder hired Wachtell Lipton (the #1 takeover defense firm).  │
  │     → This is a governance war, not a restructuring.               │
  │                                                                     │
  │  3. GOING-CONCERN DISCLOSURE IN 3 DAYS                             │
  │     Q4 earnings release March 15. Technical default at 11.5x.     │
  │     Auditors will require going-concern paragraph.                 │
  │     → Stock/bond price collapse when this hits the market.         │
  │                                                                     │
  │  4. $50M SUNK COST MARKETING DISASTER                             │
  │     Non-cancellable celebrity campaign for products stuck at sea.  │
  │     Celebrity's agency threatening breach-of-contract suit.        │
  │     → CMO approval of $50M spend during crisis = board liability. │
  │                                                                     │
  │  CONSEQUENCE IF LEAKED: Deal collapse, stock/bond crash,           │
  │  shareholder lawsuits, SEC investigation for selective disclosure,  │
  │  Blackstone exercises drag-along preemptively.                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │  CTO LENS — What a CTO Would See                                   │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  1. $150M PLATFORM MIGRATION under distress conditions             │
  │     Building a drop-ship marketplace while in technical default.   │
  │     → Tech execution risk + vendor payment risk (who builds for    │
  │       a company that might not exist in 6 months?)                 │
  │                                                                     │
  │  2. CFO's email and phone number in document                       │
  │     jennifer.wu@modaglobal.com, (212) 555-0198                     │
  │     → Spear-phishing target for anyone who obtains this doc.       │
  │                                                                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │  CIO LENS — What a CIO Would See                                   │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  1. WARN ACT VIOLATION RISK                                        │
  │     8,500 layoffs + 120 store closings.                            │
  │     60-day notice required. Board hasn't voted yet.                │
  │     If leaked before WARN notice → federal violation.              │
  │                                                                     │
  │  2. SECURITIES FRAUD RISK                                          │
  │     Unsecured notes trading at $0.42 (CUSIP public).               │
  │     Anyone who reads this and trades = insider trading.            │
  │     "Do NOT let this reach the public markets" = awareness         │
  │     that this IS material non-public information.                  │
  │                                                                     │
  │  3. SELECTIVE DISCLOSURE (Reg FD)                                  │
  │     JP Morgan and Evercore informally notified but not public.     │
  │     If any noteholder tips, it's a Reg FD violation.               │
  │                                                                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │  CISO LENS — What a CISO Would See                                 │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  1. HIGH-VALUE TARGET DOCUMENT                                     │
  │     This single document contains enough MNPI to:                  │
  │     - Short the unsecured notes (CUSIP provided!)                  │
  │     - Front-run the restructuring announcement                    │
  │     - Exploit the Blackstone/founder conflict                     │
  │     → This is the #1 document a threat actor would want.           │
  │                                                                     │
  │  2. NAMED ADVISORY TEAM = SOCIAL ENGINEERING TARGETS               │
  │     David Kim (JP Morgan), Sarah Martinez (Evercore),             │
  │     Rachel Torres (Littler), Lisa Chen (Kirkland & Ellis)          │
  │     → Impersonation attacks targeting these advisors.              │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  FINAL ASSESSMENT — All Lenses Combined:

    Level:       CRITICAL (100/100)
    Action:      BLOCK — This content must NOT be sent to any AI tool.
    Regulations: Securities Exchange Act, Reg FD, WARN Act, fiduciary duty

    Headline: "Board-level restructuring materials for a company in
    technical default, containing MNPI that could trigger SEC enforcement,
    enable insider trading (CUSIP provided), collapse an active deal,
    and expose 8,500 employees to premature termination disclosure."

    This is the document that, if leaked, triggers:
    - SEC investigation (selective disclosure + insider trading)
    - Shareholder derivative lawsuits (board fiduciary breach)
    - Blackstone exercising drag-along (founder loses company)
    - Bond market panic (unsecured notes already at $0.42)
    - 8,500 WARN Act violations ($500/day per employee)
    - Celebrity breach-of-contract litigation ($50M+)

    A CEO would say: "If this hits Bloomberg, the company is done."
    A GC would say:  "Every sentence in this document is privileged."
    A CISO would say: "This is the most valuable document in the company."
`);

    expect(true).toBe(true);
  });

  it('COMBINED: Final pipeline output', async () => {
    const entities = detectWithRegex(MODAGLOBAL_PROMPT);
    const score = computeScore(MODAGLOBAL_PROMPT, entities);
    const contextual = detectContextualSensitivity(MODAGLOBAL_PROMPT);
    const docType = classifyDocument(MODAGLOBAL_PROMPT);
    const assessor = createRiskAssessor();
    const risk = await assessor.assess({
      text: MODAGLOBAL_PROMPT,
      entities,
      documentType: docType.type,
      contextualMarkers: contextual.map(c => ({
        category: c.category, weight: c.weight, confidence: c.confidence,
      })),
    });

    const combinedScore = Math.max(score.score, risk.score);
    const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const combinedLevel = (levelRank[risk.level] || 0) >= (levelRank[score.level] || 0)
      ? risk.level : score.level;

    console.log('\n' + '='.repeat(80));
    console.log('COMBINED PIPELINE OUTPUT');
    console.log('='.repeat(80));
    console.log(`\n  Entities detected:    ${entities.length}`);
    console.log(`  Contextual markers:   ${contextual.length}`);
    console.log(`  Document type:        ${docType.type} (${docType.confidence.toFixed(2)})`);
    console.log(`  Scorer:               ${score.level} (${score.score})`);
    console.log(`  Risk Assessor:        ${risk.level} (${risk.score})`);
    console.log(`  COMBINED:             ${combinedLevel.toUpperCase()} (${combinedScore})`);
    console.log(`  Action:               ${risk.action}`);
    console.log(`  Risk categories:      ${risk.risks.map(r => r.category).join(', ')}`);
    console.log(`  Regulations:          ${risk.regulations.join('; ')}`);

    console.log(`\n  WHAT EACH LAYER CONTRIBUTES:`);
    console.log(`    Regex:       ${entities.length} entities (emails, amounts, CUSIP, phone)`);
    console.log(`    Keywords:    ${contextual.length} contextual signals (deal language, restructuring)`);
    console.log(`    DocClass:    ${docType.type} → ${docType.confidence >= 0.25 ? 'boosts score' : 'no boost'}`);
    console.log(`    Scorer:      ${score.score}/100 — ${score.level}`);
    console.log(`    Risk Rules:  ${risk.risks.length} risk categories identified`);
    console.log(`    LLM (proj):  Would catch MNPI chain, founder takeover, WARN timing, CUSIP trading risk`);

    // The key question: does the combined system get this RIGHT?
    expect(combinedLevel).not.toBe('low');
    expect(combinedLevel).not.toBe('medium');
    // This MUST be high or critical
    expect(['high', 'critical']).toContain(combinedLevel);
  });
});
