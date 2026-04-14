/**
 * Context-Awareness QA Runner
 *
 * Runs the 153-scenario ground-truth battery (context-qa-scenarios.ts)
 * against the new LLM-based intent classifier. Measures:
 *
 *   - Overall accuracy (zone matches expected)
 *   - False positive rate (flagged as sensitive when benign)
 *   - False negative rate (not flagged when actually sensitive)
 *   - Per-category breakdown
 *   - Per-scenario latency
 *
 * Requires Ollama running at localhost:11434 with llama3.2:3b pulled.
 * If Ollama is not available, the runner exits with a clear error.
 *
 * Usage:
 *   npx tsx scripts/run-context-qa.ts
 *   npx tsx scripts/run-context-qa.ts --category=R    # run one category
 *   npx tsx scripts/run-context-qa.ts --model=llama3.2:3b --endpoint=http://localhost:11434/api/generate
 *   npx tsx scripts/run-context-qa.ts --verbose       # print every reasoning
 */

import { CONTEXT_QA_SCENARIOS, type ContextScenario } from './context-qa-scenarios';
import {
  classifyIntentAndContext,
  type IntentContextResult,
  type ClassifierConfig,
} from '../apps/extension/src/detection/intent-context-classifier';

// ─── Config ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const config: ClassifierConfig = {
  endpoint: flag('endpoint') ?? 'http://localhost:11434/api/generate',
  model: flag('model') ?? 'llama3.2:3b',
  format: (flag('format') as 'ollama' | 'openai-compatible') ?? 'ollama',
  timeoutMs: Number(flag('timeout') ?? '8000'),
};
const categoryFilter = flag('category');
const verbose = hasFlag('verbose');

// ─── Ollama availability check ──────────────────────────────────────────────

async function checkOllamaAvailable(endpoint: string): Promise<boolean> {
  try {
    const base = endpoint.replace(/\/api\/.*$/, '');
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Per-scenario evaluation ────────────────────────────────────────────────

interface ScenarioResult {
  scenario: ContextScenario;
  classified: IntentContextResult;
  zoneCorrect: boolean;
  actionCorrect: boolean;
  passedAll: boolean;
  errors: string[];
}

async function runScenario(scenario: ContextScenario): Promise<ScenarioResult> {
  const classified = await classifyIntentAndContext(scenario.prompt, config);

  const zoneCorrect = classified.zone === scenario.expectedZone;
  const actionCorrect = classified.action === scenario.expectedAction;

  const errors: string[] = [];
  if (!zoneCorrect) {
    errors.push(`zone: expected ${scenario.expectedZone}, got ${classified.zone}`);
  }
  if (!actionCorrect) {
    errors.push(`action: expected ${scenario.expectedAction}, got ${classified.action}`);
  }
  if (classified.fellBack) {
    errors.push('fell back to conservative default (LLM unavailable or failed)');
  }

  return {
    scenario,
    classified,
    zoneCorrect,
    actionCorrect,
    passedAll: zoneCorrect && actionCorrect && !classified.fellBack,
    errors,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IronGate Context-Awareness QA');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Endpoint: ${config.endpoint}`);
  console.log(`  Model:    ${config.model}`);
  console.log(`  Format:   ${config.format}`);
  console.log(`  Timeout:  ${config.timeoutMs}ms`);
  if (categoryFilter) console.log(`  Filter:   category = ${categoryFilter}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Preflight: Ollama reachable? ─────────────────────────────────────────
  console.log('Checking Ollama availability...');
  const available = await checkOllamaAvailable(config.endpoint);
  if (!available) {
    console.error('\n❌ Ollama is not reachable at', config.endpoint);
    console.error('   Start Ollama and pull the model:');
    console.error(`   $ ollama serve`);
    console.error(`   $ ollama pull ${config.model}\n`);
    process.exit(1);
  }
  console.log('✓ Ollama is reachable\n');

  const scenarios = categoryFilter
    ? CONTEXT_QA_SCENARIOS.filter((s) => s.category === categoryFilter)
    : CONTEXT_QA_SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`No scenarios match filter: category=${categoryFilter}`);
    process.exit(1);
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  const results: ScenarioResult[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    process.stdout.write(
      `[${String(i + 1).padStart(3)}/${scenarios.length}] ${sc.id} [${sc.category}] ${sc.description.slice(0, 50).padEnd(50)} `,
    );
    try {
      const result = await runScenario(sc);
      results.push(result);
      const ok = result.passedAll ? '✓' : '✗';
      const latencyPad = String(result.classified.latencyMs).padStart(5);
      console.log(
        `${ok}  ${result.classified.intent.padEnd(16)} ${result.classified.zone.padEnd(6)} ${latencyPad}ms`,
      );
      if (!result.passedAll && verbose) {
        console.log(`      expected: ${sc.expectedZone}/${sc.expectedAction}`);
        console.log(`      got:      ${result.classified.zone}/${result.classified.action}`);
        console.log(`      reasoning: ${result.classified.reasoning}`);
      }
    } catch (err) {
      console.log(`✗  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const total = results.length;
  const passed = results.filter((r) => r.passedAll).length;
  const failed = total - passed;
  const fellBack = results.filter((r) => r.classified.fellBack).length;

  console.log(`Total: ${total}`);
  console.log(`Passed: ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed} (${((failed / total) * 100).toFixed(1)}%)`);
  if (fellBack > 0) console.log(`Fell back to default: ${fellBack}`);

  // Per-category accuracy
  console.log('\nBy category:');
  const categories = Array.from(new Set(results.map((r) => r.scenario.category))).sort();
  for (const cat of categories) {
    const catResults = results.filter((r) => r.scenario.category === cat);
    const catPassed = catResults.filter((r) => r.passedAll).length;
    const catLabel = {
      R: 'Research',
      M: 'Meta-discussion',
      E: 'Educational',
      F: 'Fictional/creative',
      C: 'Code/technical',
      W: 'Everyday productivity',
      L: 'Legal research',
      S: 'Self-referential',
      P: 'Classic PII',
      K: 'Credentials',
      B: 'Business confidential',
      A: 'Privileged (A-C/PHI)',
      D: 'Document paste',
      X: 'Ambiguous',
    }[cat] ?? cat;
    const pct = ((catPassed / catResults.length) * 100).toFixed(0);
    console.log(`  ${cat} (${catLabel.padEnd(22)}): ${catPassed}/${catResults.length} (${pct}%)`);
  }

  // False positive / false negative analysis
  console.log('\nError analysis:');
  const falsePositives = results.filter(
    (r) => r.scenario.expectedZone === 'green' && r.classified.zone !== 'green',
  );
  const falseNegatives = results.filter(
    (r) => r.scenario.expectedZone === 'red' && r.classified.zone !== 'red',
  );
  console.log(`  False positives (benign flagged):  ${falsePositives.length}`);
  console.log(`  False negatives (sensitive missed): ${falseNegatives.length}`);

  // Latency stats
  const latencies = results.filter((r) => !r.classified.fellBack).map((r) => r.classified.latencyMs);
  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    console.log(`\nLatency: p50 ${p50}ms, p95 ${p95}ms`);
  }

  // Top failures for iteration
  if (failed > 0) {
    console.log('\nFailed scenarios (fix these in the prompt):');
    const shown = results.filter((r) => !r.passedAll).slice(0, 20);
    for (const r of shown) {
      console.log(`\n  ${r.scenario.id} [${r.scenario.category}] ${r.scenario.description}`);
      console.log(`    prompt: ${r.scenario.prompt.slice(0, 100)}${r.scenario.prompt.length > 100 ? '...' : ''}`);
      console.log(`    expected: ${r.scenario.expectedZone}/${r.scenario.expectedAction}`);
      console.log(`    got:      ${r.classified.zone}/${r.classified.action} (intent=${r.classified.intent}, sensitivity=${r.classified.sensitivity})`);
      console.log(`    reasoning: ${r.classified.reasoning}`);
    }
    if (results.filter((r) => !r.passedAll).length > 20) {
      console.log(`\n  ... and ${results.filter((r) => !r.passedAll).length - 20} more`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  // Exit code: 0 if ≥90% pass, 1 otherwise
  const passRate = passed / total;
  process.exit(passRate >= 0.9 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(2);
});
