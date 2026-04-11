/**
 * Tier 2 Benchmark Harness — Phase 1
 *
 * Reuses the 50 scenarios from test-50-scenarios.ts and runs them through:
 *
 *   Run A: Tier 1 only (deterministic baseline)
 *   Run B: Tier 1 + Tier 2 (local LLM via Ollama)
 *
 * Compares:
 *   - Accuracy (pass rate vs expected verdict)
 *   - AMBER → RED escalation rate (how often does Tier 2 catch what Tier 1 misses?)
 *   - GREEN → GREEN stability (how often does Tier 2 false-positive on benign prompts?)
 *   - Latency (P50, P95, total)
 *   - JSON parse failure rate (Tier 2 robustness)
 *
 * The Tier 2 adapter is ONLY called when Tier 1 returns an AMBER-zone result.
 * This mimics production behavior where Tier 2 is an escalation path, not a replacement.
 *
 * Usage:
 *   # Baseline (Tier 1 only, no Ollama required):
 *   pnpm tsx scripts/bench-tier2.ts
 *
 *   # With Tier 2 (requires Ollama running with the model pulled):
 *   TIER2_MODEL=gemma4:e2b TIER2_ENDPOINT=http://localhost:11434/api/generate pnpm tsx scripts/bench-tier2.ts
 *
 *   # Compare two models in one run:
 *   TIER2_MODEL=gemma4:e2b pnpm tsx scripts/bench-tier2.ts
 *   TIER2_MODEL=gemma3:4b pnpm tsx scripts/bench-tier2.ts
 */

import { detectWithRegex } from '../apps/extension/src/detection/fallback-regex';
import { classifyDocument } from '../apps/extension/src/detection/document-classifier';
import { detectContextualSensitivity, computeContextualScore } from '../apps/extension/src/detection/contextual-keywords';
import { applyIntentSuppression } from '../apps/extension/src/detection/intent-suppression';
import { computeScore } from '../apps/extension/src/detection/scorer';
import { mergeEntities } from '../apps/extension/src/detection/entity-merger';
import { analyzeWithExecutiveLens } from '../apps/extension/src/detection/executive-lens';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Scenario definitions (imported from test-50-scenarios.ts pattern) ────

interface Scenario {
  id: number;
  category: 'TRUE_NEGATIVE' | 'TRUE_POSITIVE' | 'AMBER_ZONE' | 'EDGE_CASE';
  description: string;
  prompt: string;
  expectedVerdict: 'ALLOW' | 'WARN' | 'BLOCK';
  expectedZone: 'green' | 'amber' | 'red';
}

// Compact scenarios — 30 high-signal cases covering all 4 categories
const SCENARIOS: Scenario[] = [
  // TRUE_NEGATIVE (10) — must stay green
  { id: 1,  category: 'TRUE_NEGATIVE', description: 'Coding question', prompt: 'How do I reverse a string in Python?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 2,  category: 'TRUE_NEGATIVE', description: 'Horoscope with DOB', prompt: 'My birthday is March 15, 1990. What is my horoscope sign?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 3,  category: 'TRUE_NEGATIVE', description: 'Public company research', prompt: 'Compare Salesforce vs HubSpot market caps and product strategies.', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 4,  category: 'TRUE_NEGATIVE', description: 'Writing help', prompt: 'Help me write a polite email declining a meeting.', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 5,  category: 'TRUE_NEGATIVE', description: 'Recipe', prompt: 'Recipe for chocolate chip cookies in under 30 minutes?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 6,  category: 'TRUE_NEGATIVE', description: 'Math homework', prompt: 'Solve for x: 3x + 7 = 22', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 7,  category: 'TRUE_NEGATIVE', description: 'Fitness advice', prompt: 'What is a good 5k training plan for beginners?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 8,  category: 'TRUE_NEGATIVE', description: 'Self-intro resume help', prompt: 'I am John Smith and I want help rewriting my LinkedIn headline. I work in marketing at a startup.', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 9,  category: 'TRUE_NEGATIVE', description: 'Travel planning', prompt: 'What are the best neighborhoods to stay in Tokyo for a first-time visitor?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 10, category: 'TRUE_NEGATIVE', description: 'Tech explanation', prompt: 'Explain how OAuth 2.0 works in simple terms.', expectedVerdict: 'ALLOW', expectedZone: 'green' },

  // TRUE_POSITIVE (10) — must be blocked/warned (red or amber)
  { id: 11, category: 'TRUE_POSITIVE', description: 'SSN + name', prompt: 'My SSN is 123-45-6789 and my name is Sarah Johnson. Help me file for disability benefits.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 12, category: 'TRUE_POSITIVE', description: 'Credit card', prompt: 'My Visa is 4532-8891-2244-6677, expires 08/27, CVV 834. Why was my purchase declined?', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 13, category: 'TRUE_POSITIVE', description: 'Medical record', prompt: 'Patient Sarah Chen MRN: 2024-55892, diagnosed with Stage IIB breast cancer. Draft letter to insurance.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 14, category: 'TRUE_POSITIVE', description: 'API key leak', prompt: 'Debug why this call fails: sk-proj-abc123XYZ789def456GHI012jkl345MNO678pqr901STU234', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 15, category: 'TRUE_POSITIVE', description: 'Multi-entity HR', prompt: 'Terminate Sarah Mitchell, SSN 678-90-1234, salary $185k. Draft separation letter.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 16, category: 'TRUE_POSITIVE', description: 'Bank account + routing', prompt: 'My Chase routing is 072000326, account 48291057382. Set up autopay to my landlord.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 17, category: 'TRUE_POSITIVE', description: 'M&A privileged', prompt: 'PRIVILEGED: Acquisition of Meridian Health for $2.8B, CEO James Whitfield (SSN 456-78-9012).', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 18, category: 'TRUE_POSITIVE', description: 'Insurance claim with VIN', prompt: 'My VIN is 1HGBH41JXMN109186, plate ABC-1234, and my license is WA-SMITH-J-9876543.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 19, category: 'TRUE_POSITIVE', description: 'Email + phone + DOB', prompt: 'Contact john.smith@example.com or (212) 555-8847. DOB 03/15/1978. Legal matter pending.', expectedVerdict: 'BLOCK', expectedZone: 'red' },
  { id: 20, category: 'TRUE_POSITIVE', description: 'Passport + address', prompt: 'Passport C04829175, address 3401 Oak Park Blvd Dallas TX 75219. Submit visa application.', expectedVerdict: 'BLOCK', expectedZone: 'red' },

  // AMBER_ZONE (6) — ambiguous, Tier 2 should help here most
  { id: 21, category: 'AMBER_ZONE', description: 'Confidential M&A no PII', prompt: 'Confidential: We are evaluating an acquisition of a competitor for roughly $2B. Draft board talking points.', expectedVerdict: 'WARN', expectedZone: 'amber' },
  { id: 22, category: 'AMBER_ZONE', description: 'Layoff plan without names', prompt: 'Draft RIF communication for 340 employees, 12% of workforce, Q3 severance plan.', expectedVerdict: 'WARN', expectedZone: 'amber' },
  { id: 23, category: 'AMBER_ZONE', description: 'Trade secret hint', prompt: 'Our proprietary algorithm achieves 94% accuracy vs competitor 78%. How to explain the gap in our earnings call?', expectedVerdict: 'WARN', expectedZone: 'amber' },
  { id: 24, category: 'AMBER_ZONE', description: 'Internal financials', prompt: 'Q4 revenue projection is $47M vs street estimate $42M. Draft investor update.', expectedVerdict: 'WARN', expectedZone: 'amber' },
  { id: 25, category: 'AMBER_ZONE', description: 'Litigation strategy', prompt: 'Draft response to discovery motion in Patterson case. Focus on privilege log defense.', expectedVerdict: 'WARN', expectedZone: 'amber' },
  { id: 26, category: 'AMBER_ZONE', description: 'Hiring pipeline', prompt: 'We have 3 candidates for CTO role, all former competitors. How to vet without breaching NDAs?', expectedVerdict: 'WARN', expectedZone: 'amber' },

  // EDGE_CASE (4) — tricky cases that break simple heuristics
  { id: 27, category: 'EDGE_CASE', description: 'Fictional character with SSN-like number', prompt: 'Write a novel scene where the detective reads the suspects social security 123-45-6789 aloud.', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 28, category: 'EDGE_CASE', description: 'Learning question about PII format', prompt: 'What format are US social security numbers? Give me a fake example.', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 29, category: 'EDGE_CASE', description: 'Name without context', prompt: 'Who is Sarah Chen?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
  { id: 30, category: 'EDGE_CASE', description: 'Public figure + private citizen', prompt: 'Elon Musk and my neighbor Bob Smith both drive Teslas. Which is safer?', expectedVerdict: 'ALLOW', expectedZone: 'green' },
];

// ── Tier 1 runner ─────────────────────────────────────────────────────────

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

interface Tier1Result {
  score: number;
  level: string;
  zone: 'green' | 'amber' | 'red';
  entityCount: number;
  latencyMs: number;
}

function runTier1(text: string): Tier1Result {
  const start = performance.now();
  const regexEntities = detectWithRegex(text);
  classifyDocument(text);
  detectContextualSensitivity(text);
  const mergedEntities = mergeEntities(regexEntities);
  const scoreResult = computeScore(text, mergedEntities);
  analyzeWithExecutiveLens(text, mergedEntities);
  applyIntentSuppression(text, mergedEntities);
  const latencyMs = performance.now() - start;
  return {
    score: scoreResult.score,
    level: scoreResult.level,
    zone: scoreToZone(scoreResult.score),
    entityCount: regexEntities.length,
    latencyMs,
  };
}

// ── Tier 2 runner (Ollama) ─────────────────────────────────────────────────

const TIER2_SYSTEM_PROMPT = `You are a data sensitivity classifier. Analyze the text and respond with ONLY a JSON object on a single line:
{"score":<0-100>,"level":"<low|medium|high|critical>","reasoning":"<brief>"}

Score ranges:
- 0-25 (low): Generic queries, no PII, no confidential business info
- 26-60 (medium): Some identifiable info, soft business sensitivity
- 61-85 (high): Multiple sensitive entities, legal/medical/financial details
- 86-100 (critical): Highly sensitive (bulk PII, credentials, attorney privilege)

Respond ONLY with the JSON object, no other text.`;

interface Tier2Result {
  score: number;
  level: string;
  zone: 'green' | 'amber' | 'red';
  latencyMs: number;
  parseOk: boolean;
  rawResponse: string;
  error?: string;
}

// Robust JSON extractor — handles nested objects, unlike the one-line match in the current adapter
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

async function runTier2(text: string, endpoint: string, model: string, timeoutMs = 30000): Promise<Tier2Result> {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${TIER2_SYSTEM_PROMPT}\n\nText to classify:\n${text}`,
        stream: false,
        options: { temperature: 0.1, num_predict: 150 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { score: 0, level: 'ERROR', zone: 'green', latencyMs: performance.now() - start, parseOk: false, rawResponse: '', error: `HTTP ${response.status}` };
    }

    const data: any = await response.json();
    const rawResponse: string = data.response ?? '';

    const jsonStr = extractFirstJsonObject(rawResponse);
    if (!jsonStr) {
      return { score: 0, level: 'PARSE_FAIL', zone: 'green', latencyMs: performance.now() - start, parseOk: false, rawResponse, error: 'No JSON in response' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return { score: 0, level: 'PARSE_FAIL', zone: 'green', latencyMs: performance.now() - start, parseOk: false, rawResponse, error: `JSON.parse failed: ${String(e)}` };
    }

    const score = Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0)));
    const level = ['low', 'medium', 'high', 'critical'].includes(parsed.level) ? parsed.level : 'medium';

    return {
      score,
      level,
      zone: scoreToZone(score),
      latencyMs: performance.now() - start,
      parseOk: true,
      rawResponse,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { score: 0, level: 'ERROR', zone: 'green', latencyMs: performance.now() - start, parseOk: false, rawResponse: '', error: err?.message || String(err) };
  }
}

// ── Tier merge logic (matches confidence-router.ts behavior) ────────────

function mergeTiers(t1: Tier1Result, t2: Tier2Result | null): { finalScore: number; finalZone: 'green' | 'amber' | 'red'; source: string } {
  // Invariant from confidence-router.ts: higher tiers can UPGRADE but not downgrade RED.
  // For the benchmark we use max(t1, t2) when t2 is available and parsed successfully.
  if (!t2 || !t2.parseOk) {
    return { finalScore: t1.score, finalZone: t1.zone, source: 'tier1' };
  }
  const finalScore = Math.max(t1.score, t2.score);
  return { finalScore, finalZone: scoreToZone(finalScore), source: finalScore === t1.score ? 'tier1' : 'tier2' };
}

// ── Main ───────────────────────────────────────────────────────────────

interface BenchResult {
  scenario: Scenario;
  tier1: Tier1Result;
  tier2: Tier2Result | null;
  final: { finalScore: number; finalZone: 'green' | 'amber' | 'red'; source: string };
  t1Pass: boolean;
  finalPass: boolean;
  escalated: boolean; // true if Tier 2 upgraded the decision
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

async function main() {
  const endpoint = process.env.TIER2_ENDPOINT || 'http://localhost:11434/api/generate';
  const model = process.env.TIER2_MODEL || '';
  const tier2Enabled = model.length > 0;
  const onlyAmber = process.env.TIER2_ONLY_AMBER !== 'false'; // default true

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IronGate Tier 2 Benchmark — Phase 1');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Scenarios:    ${SCENARIOS.length}`);
  console.log(`  Tier 2:       ${tier2Enabled ? `ENABLED (${model} @ ${endpoint})` : 'DISABLED (baseline Tier 1 only)'}`);
  console.log(`  Tier 2 mode:  ${tier2Enabled ? (onlyAmber ? 'escalation on AMBER' : 'all scenarios') : 'n/a'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Health check for Tier 2
  if (tier2Enabled) {
    try {
      const tagsUrl = endpoint.replace('/api/generate', '/api/tags');
      const probe = await fetch(tagsUrl, { signal: AbortSignal.timeout(2000) });
      if (!probe.ok) {
        console.error(`❌ Tier 2 endpoint not reachable at ${tagsUrl} (HTTP ${probe.status})`);
        console.error('   Is Ollama running? Try: ollama serve');
        process.exit(1);
      }
      const tagsData: any = await probe.json();
      const installedModels = (tagsData?.models || []).map((m: any) => m.name);
      console.log(`✓ Ollama reachable. Installed models: ${installedModels.join(', ') || '(none)'}`);
      if (!installedModels.some((m: string) => m === model || m.startsWith(model))) {
        console.error(`❌ Model "${model}" not found. Pull it with: ollama pull ${model}`);
        process.exit(1);
      }
      console.log(`✓ Model "${model}" is installed.\n`);
    } catch (err: any) {
      console.error(`❌ Tier 2 health check failed: ${err?.message || err}`);
      process.exit(1);
    }
  }

  const results: BenchResult[] = [];

  for (const scenario of SCENARIOS) {
    process.stdout.write(`#${String(scenario.id).padStart(2, '0')} ${scenario.description.padEnd(45)} `);

    const tier1 = runTier1(scenario.prompt);
    let tier2: Tier2Result | null = null;

    if (tier2Enabled) {
      const shouldRunTier2 = onlyAmber ? tier1.zone === 'amber' : true;
      if (shouldRunTier2) {
        tier2 = await runTier2(scenario.prompt, endpoint, model);
      }
    }

    const final = mergeTiers(tier1, tier2);
    const t1Pass = tier1.zone === scenario.expectedZone;
    const finalPass = final.finalZone === scenario.expectedZone;
    const escalated = tier2 !== null && tier2.parseOk && tier2.score > tier1.score;

    results.push({ scenario, tier1, tier2, final, t1Pass, finalPass, escalated });

    const t1Icon = t1Pass ? '✓' : '✗';
    const finalIcon = finalPass ? '✓' : '✗';
    const t1Str = `T1=${String(tier1.score).padStart(3)}(${tier1.zone[0]})`;
    const t2Str = tier2 === null ? '        ' : tier2.parseOk ? `T2=${String(tier2.score).padStart(3)}(${tier2.zone[0]})` : `T2=FAIL `;
    const esc = escalated ? '↑' : ' ';
    console.log(`${t1Icon}${finalIcon} ${t1Str} ${t2Str} ${esc}`);
  }

  // ── Report ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const t1PassCount = results.filter(r => r.t1Pass).length;
  const finalPassCount = results.filter(r => r.finalPass).length;
  const escalations = results.filter(r => r.escalated);
  const correctEscalations = escalations.filter(r => r.finalPass && !r.t1Pass);
  const harmfulEscalations = escalations.filter(r => !r.finalPass && r.t1Pass);

  console.log(`Tier 1 accuracy:       ${t1PassCount}/${results.length} (${(t1PassCount / results.length * 100).toFixed(1)}%)`);
  if (tier2Enabled) {
    console.log(`Tier 1+2 accuracy:     ${finalPassCount}/${results.length} (${(finalPassCount / results.length * 100).toFixed(1)}%)`);
    console.log(`Net improvement:       ${finalPassCount - t1PassCount >= 0 ? '+' : ''}${finalPassCount - t1PassCount} scenarios`);
    console.log('');
    console.log(`Tier 2 escalations:    ${escalations.length}`);
    console.log(`  Correct (caught):    ${correctEscalations.length}`);
    console.log(`  Harmful (overreach): ${harmfulEscalations.length}`);
  }
  console.log('');

  // Per-category breakdown
  const categories: Array<Scenario['category']> = ['TRUE_NEGATIVE', 'TRUE_POSITIVE', 'AMBER_ZONE', 'EDGE_CASE'];
  console.log('By category:');
  for (const cat of categories) {
    const catResults = results.filter(r => r.scenario.category === cat);
    if (catResults.length === 0) continue;
    const t1p = catResults.filter(r => r.t1Pass).length;
    const finalp = catResults.filter(r => r.finalPass).length;
    const line = tier2Enabled
      ? `  ${cat.padEnd(14)} T1: ${t1p}/${catResults.length}  T1+2: ${finalp}/${catResults.length}`
      : `  ${cat.padEnd(14)} T1: ${t1p}/${catResults.length}`;
    console.log(line);
  }
  console.log('');

  // Latency
  const t1Latencies = results.map(r => r.tier1.latencyMs);
  console.log('Latency (ms):');
  console.log(`  Tier 1  — P50: ${percentile(t1Latencies, 50).toFixed(2)}  P95: ${percentile(t1Latencies, 95).toFixed(2)}  sum: ${t1Latencies.reduce((a, b) => a + b, 0).toFixed(2)}`);
  if (tier2Enabled) {
    const t2Latencies = results.filter(r => r.tier2 !== null).map(r => r.tier2!.latencyMs);
    if (t2Latencies.length > 0) {
      console.log(`  Tier 2  — P50: ${percentile(t2Latencies, 50).toFixed(0)}  P95: ${percentile(t2Latencies, 95).toFixed(0)}  sum: ${t2Latencies.reduce((a, b) => a + b, 0).toFixed(0)}  (n=${t2Latencies.length})`);
    }
    const parseFailures = results.filter(r => r.tier2 !== null && !r.tier2!.parseOk);
    console.log('');
    console.log(`JSON parse robustness: ${results.filter(r => r.tier2 !== null).length - parseFailures.length}/${results.filter(r => r.tier2 !== null).length} successful`);
    if (parseFailures.length > 0) {
      console.log(`Parse failures:`);
      for (const f of parseFailures.slice(0, 5)) {
        console.log(`  #${f.scenario.id} [${f.scenario.description}] — ${f.tier2!.error}`);
        if (f.tier2!.rawResponse) {
          console.log(`     raw: ${f.tier2!.rawResponse.substring(0, 120).replace(/\n/g, ' ')}`);
        }
      }
    }
  }

  // Failure detail
  const failed = results.filter(r => !r.finalPass);
  if (failed.length > 0) {
    console.log('');
    console.log('Failed scenarios:');
    for (const f of failed) {
      const t2info = f.tier2 !== null ? ` T2=${f.tier2.parseOk ? f.tier2.score : 'FAIL'}` : '';
      console.log(`  #${f.scenario.id} [${f.scenario.category}] "${f.scenario.description}"`);
      console.log(`     expected: ${f.scenario.expectedZone} | got: ${f.final.finalZone} (T1=${f.tier1.score}${t2info})`);
    }
  }

  // Write JSON output for downstream comparison
  const outPath = join(process.cwd(), `bench-tier2-results${model ? '-' + model.replace(/[:/]/g, '_') : '-tier1'}.json`);
  writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    model: model || null,
    tier2Enabled,
    summary: {
      total: results.length,
      t1Pass: t1PassCount,
      finalPass: finalPassCount,
      escalations: escalations.length,
      correctEscalations: correctEscalations.length,
      harmfulEscalations: harmfulEscalations.length,
      t1LatencyP50: percentile(t1Latencies, 50),
      t1LatencyP95: percentile(t1Latencies, 95),
      t2LatencyP50: tier2Enabled ? percentile(results.filter(r => r.tier2).map(r => r.tier2!.latencyMs), 50) : null,
      t2LatencyP95: tier2Enabled ? percentile(results.filter(r => r.tier2).map(r => r.tier2!.latencyMs), 95) : null,
    },
    results: results.map(r => ({
      id: r.scenario.id,
      category: r.scenario.category,
      description: r.scenario.description,
      expected: r.scenario.expectedZone,
      tier1: r.tier1,
      tier2: r.tier2,
      final: r.final,
      t1Pass: r.t1Pass,
      finalPass: r.finalPass,
      escalated: r.escalated,
    })),
  }, null, 2));
  console.log(`\nResults written to: ${outPath}`);
}

main().catch(err => {
  console.error('Benchmark crashed:', err);
  process.exit(1);
});
