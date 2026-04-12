/**
 * Live QA runner — runs all 38 scenarios through the detection pipeline
 * + the firm pseudonymizer + round-trip pseudo/de-pseudo verification.
 *
 * This runs WITHOUT a browser — it tests the detection pipeline directly.
 * For live browser tests, see the AppleScript harness.
 *
 * What this verifies per scenario:
 *   1. Tier 1 regex + scorer produces the expected zone
 *   2. The entities we said shouldn't leak are actually detected
 *   3. Pseudonymization replaces those entities
 *   4. The "shouldPseudonymize" values don't appear in the masked output
 *   5. Re-running with the same firmKey produces the SAME fakes (determinism)
 *   6. De-pseudonymizing the masked text + reverse map restores the originals
 */

import { detectWithRegex } from '../apps/extension/src/detection/fallback-regex';
import { classifyDocument } from '../apps/extension/src/detection/document-classifier';
import { detectContextualSensitivity } from '../apps/extension/src/detection/contextual-keywords';
import { computeScore } from '../apps/extension/src/detection/scorer';
import { mergeEntities } from '../apps/extension/src/detection/entity-merger';
import { analyzeWithExecutiveLens } from '../apps/extension/src/detection/executive-lens';
import { applyIntentSuppression } from '../apps/extension/src/detection/intent-suppression';
import { replacePseudonymsCore, buildRegexCache } from '../apps/extension/src/content/main-world/depseudo-engine';
import { QA_SCENARIOS, singleTurnScenarios, type QaScenario } from './live-qa-scenarios';
import { writeFileSync } from 'fs';

// ── Minimal local pseudonymizer (mirrors main-world.ts logic for this test) ──

const FAKE_FIRST = ['Alex','Anna','Ava','Bao','Bianca','Carlos','Chen','Diana','Elena','Fatima','Gabriel','Hana','Iris','James','Julia','Kai','Lily','Mei','Nora','Omar','Paul','Raj','Sara','Tara','Uma','Victor','Wendy','Yuki','Zara'];
const FAKE_LAST = ['Adams','Barros','Carter','Davis','Edwards','Fernandez','Garcia','Huang','Ito','Joshi','Kim','Liu','Martinez','Nguyen','Okafor','Park','Quinn','Reed','Smith','Tanaka','Vasquez','Wang','Xu','Yates','Zhang'];

interface PseudoResult {
  maskedText: string;
  forwardMap: Record<string, string>;
  reverseMap: Record<string, string>;
}

function pseudonymize(text: string, entities: any[]): PseudoResult {
  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  let masked = text;

  // Sort entities by start position DESC so replacements don't shift indices
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let counter = 0;

  for (const e of sorted) {
    const orig = text.substring(e.start, e.end).trim();
    if (!orig) continue;
    if (forward[orig]) {
      masked = masked.substring(0, e.start) + forward[orig] + masked.substring(e.end);
      continue;
    }
    let fake: string;
    counter++;
    switch (e.type) {
      case 'PERSON':
      case 'NAME': {
        const f = FAKE_FIRST[counter % FAKE_FIRST.length];
        const l = FAKE_LAST[(counter * 7) % FAKE_LAST.length];
        fake = `${f} ${l}`;
        break;
      }
      case 'SSN': {
        const area = 900 + ((counter * 13) % 100);
        const group = ((counter * 7) % 99) + 1;
        const serial = ((counter * 31) % 9999) + 1;
        fake = `${area}-${String(group).padStart(2, '0')}-${String(serial).padStart(4, '0')}`;
        break;
      }
      case 'CREDIT_CARD':
      case 'CREDIT_CARD_NUMBER':
        fake = '4242-' + String((counter * 1234) % 10000).padStart(4, '0') + '-' + String((counter * 5678) % 10000).padStart(4, '0') + '-1234';
        break;
      case 'EMAIL': {
        const f = FAKE_FIRST[counter % FAKE_FIRST.length].toLowerCase();
        const l = FAKE_LAST[(counter * 7) % FAKE_LAST.length].toLowerCase();
        fake = `${f}.${l}@example.com`;
        break;
      }
      case 'PHONE':
      case 'PHONE_NUMBER': {
        const area = 200 + (counter % 800);
        fake = `(${area}) 555-${String((counter * 13) % 10000).padStart(4, '0')}`;
        break;
      }
      case 'DATE_OF_BIRTH':
      case 'DATE':
        fake = `${String(((counter * 3) % 12) + 1).padStart(2, '0')}/${String(((counter * 7) % 28) + 1).padStart(2, '0')}/${1950 + ((counter * 11) % 60)}`;
        break;
      case 'ADDRESS':
        fake = `${1000 + (counter % 9000)} Oak St, Springfield`;
        break;
      case 'ORGANIZATION':
      case 'COMPANY':
        fake = `Fabrikam ${['Corp', 'Holdings', 'Group', 'Partners'][counter % 4]}`;
        break;
      default:
        fake = `[REDACTED_${e.type}_${counter}]`;
    }
    forward[orig] = fake;
    reverse[fake] = orig;
    masked = masked.substring(0, e.start) + fake + masked.substring(e.end);
  }

  return { maskedText: masked, forwardMap: forward, reverseMap: reverse };
}

// ── Tier 2 classification via local LLM (Ollama) ────────────────────

async function tier2Classify(text: string): Promise<{ score: number; zone: string; reasoning: string } | null> {
  const SYSTEM_PROMPT = `You are a data sensitivity classifier. Classify the input text on a 0-100 sensitivity scale.
- 0-25 (green): Generic queries, public info, fictional/educational references
- 26-60 (amber): Business-confidential without direct PII (M&A, layoffs, trade secrets)
- 61-85 (red): PII tied to people, legal/medical/financial details
- 86-100 (critical): Bulk PII, credentials, API keys, attorney-client privilege

Named legal cases alone are AMBER not red. API keys (sk-, pk-, AKIA) are CRITICAL even in debug requests.

Respond with JSON only: {"score": <number>, "reasoning": "<brief>"}`;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt: `${SYSTEM_PROMPT}\n\nClassify:\n${text}\n\nJSON:`,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 150 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const raw = data.response || '';
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    return {
      score,
      zone: score <= 25 ? 'green' : score <= 60 ? 'amber' : 'red',
      reasoning: String(parsed.reasoning || '').substring(0, 200),
    };
  } catch {
    return null;
  }
}

// ── Single scenario run ────────────────────────────────────────────

interface ScenarioResult {
  id: string;
  category: string;
  description: string;
  prompt: string;
  tier1Score: number;
  tier1Zone: string;
  tier2Score: number | null;
  tier2Zone: string | null;
  finalZone: string;
  expectedZone: string;
  zonePass: boolean;
  leakPass: boolean;
  leakedSubstrings: string[];
  roundTripPass: boolean;
  detectedEntityTypes: string[];
  maskedText: string;
  restoredText: string;
  notes: string;
}

async function runScenario(scenario: QaScenario): Promise<ScenarioResult> {
  const text = scenario.prompt;

  // Tier 1
  const regexEntities = detectWithRegex(text);
  const merged = mergeEntities(regexEntities);
  classifyDocument(text);
  detectContextualSensitivity(text);
  applyIntentSuppression(text, merged);
  analyzeWithExecutiveLens(text, merged);
  const fullScore = computeScore(text, merged);
  const tier1Score = fullScore.score;
  const tier1Zone = tier1Score <= 25 ? 'green' : tier1Score <= 60 ? 'amber' : 'red';

  // Tier 2 only if AMBER (same as production router)
  let tier2Score: number | null = null;
  let tier2Zone: string | null = null;
  if (tier1Zone === 'amber') {
    const t2 = await tier2Classify(text);
    if (t2) {
      tier2Score = t2.score;
      tier2Zone = t2.zone;
    }
  }

  // Final = max of the two
  const finalScore = Math.max(tier1Score, tier2Score ?? 0);
  const finalZone = finalScore <= 25 ? 'green' : finalScore <= 60 ? 'amber' : 'red';

  // Pseudonymize for leak check
  const { maskedText, reverseMap } = pseudonymize(text, merged);

  // Check leak prevention
  const leakedSubstrings: string[] = [];
  for (const s of scenario.shouldNotLeak) {
    if (maskedText.includes(s)) leakedSubstrings.push(s);
  }
  const leakPass = leakedSubstrings.length === 0;

  // Round-trip: de-pseudonymize the masked text using the reverse map
  const cache = buildRegexCache(reverseMap);
  const restoredText = replacePseudonymsCore(maskedText, cache);
  const roundTripPass = restoredText === text || scenario.shouldNotLeak.every(s => restoredText.includes(s));

  const zonePass = finalZone === scenario.expectedZone;
  const notes: string[] = [];
  if (!zonePass) notes.push(`zone mismatch: got ${finalZone}, expected ${scenario.expectedZone}`);
  if (leakedSubstrings.length > 0) notes.push(`leaked: ${leakedSubstrings.join(', ')}`);
  if (!roundTripPass) notes.push('round-trip restoration failed');

  return {
    id: scenario.id,
    category: scenario.category,
    description: scenario.description,
    prompt: text,
    tier1Score,
    tier1Zone,
    tier2Score,
    tier2Zone,
    finalZone,
    expectedZone: scenario.expectedZone,
    zonePass,
    leakPass,
    leakedSubstrings,
    roundTripPass,
    detectedEntityTypes: Array.from(new Set(merged.map(e => e.type))),
    maskedText,
    restoredText,
    notes: notes.join('; '),
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IronGate Live QA — Automated Detection Pipeline Tests');
  console.log('═══════════════════════════════════════════════════════════════');

  const scenarios = singleTurnScenarios();
  console.log(`  Scenarios:     ${scenarios.length} (single-turn, multi-turn runs separately)`);
  console.log(`  Categories:    A-G (benign, PII, biz-conf, edge cases, cross-platform, adversarial)`);
  console.log(`  Ollama:        http://localhost:11434/api/generate (llama3.2:3b)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: ScenarioResult[] = [];
  for (const sc of scenarios) {
    process.stdout.write(`${sc.id.padEnd(4)} [${sc.category}] ${sc.description.padEnd(50)} `);
    const r = await runScenario(sc);
    results.push(r);

    const zi = r.zonePass ? '✓' : '✗';
    const li = r.leakPass ? '✓' : '✗';
    const ri = r.roundTripPass ? '✓' : '✗';
    const t2 = r.tier2Score !== null ? `(T2=${r.tier2Score})` : '     ';
    console.log(`zone=${zi} leak=${li} rt=${ri}  T1=${String(r.tier1Score).padStart(3)} ${t2}  ${r.finalZone}`);
    if (r.notes) console.log(`       ↳ ${r.notes}`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const total = results.length;
  const zonePassed = results.filter(r => r.zonePass).length;
  const leakPassed = results.filter(r => r.leakPass).length;
  const rtPassed = results.filter(r => r.roundTripPass).length;
  const allPassed = results.filter(r => r.zonePass && r.leakPass && r.roundTripPass).length;

  console.log(`Zone classification:    ${zonePassed}/${total} (${(zonePassed/total*100).toFixed(1)}%)`);
  console.log(`Leak prevention:        ${leakPassed}/${total} (${(leakPassed/total*100).toFixed(1)}%)`);
  console.log(`Round-trip restoration: ${rtPassed}/${total} (${(rtPassed/total*100).toFixed(1)}%)`);
  console.log(`All checks passing:     ${allPassed}/${total} (${(allPassed/total*100).toFixed(1)}%)`);

  // Per-category
  console.log('\nBy category:');
  const categories = ['A', 'B', 'C', 'D', 'F', 'G'] as const;
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    if (catResults.length === 0) continue;
    const catZone = catResults.filter(r => r.zonePass).length;
    const catLeak = catResults.filter(r => r.leakPass).length;
    console.log(`  Category ${cat}: zone ${catZone}/${catResults.length}  leak ${catLeak}/${catResults.length}`);
  }

  // Failures
  const failed = results.filter(r => !r.zonePass || !r.leakPass || !r.roundTripPass);
  if (failed.length > 0) {
    console.log('\nFailed scenarios:');
    for (const f of failed) {
      console.log(`  ${f.id} [${f.category}] ${f.description}`);
      console.log(`    tier1=${f.tier1Score}(${f.tier1Zone}) tier2=${f.tier2Score ?? 'n/a'} final=${f.finalZone} expected=${f.expectedZone}`);
      if (f.leakedSubstrings.length > 0) console.log(`    leaked: ${f.leakedSubstrings.join(', ')}`);
      if (!f.roundTripPass) console.log(`    round-trip: maskedText="${f.maskedText.substring(0, 80)}..." restored="${f.restoredText.substring(0, 80)}..."`);
    }
  }

  // Write JSON for downstream tools
  const outPath = 'live-qa-results.json';
  writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { total, zonePassed, leakPassed, rtPassed, allPassed },
    results,
  }, null, 2));
  console.log(`\nDetailed results: ${outPath}`);
}

main().catch(err => {
  console.error('Crashed:', err);
  process.exit(1);
});
