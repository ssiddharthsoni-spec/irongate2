/**
 * Iron Gate v0.3 — Eval Harness
 *
 * Runs fixture prompts through the detection pipeline and reports:
 *   - Verdict agreement (expected vs actual)
 *   - Score range compliance
 *   - Entity detection precision/recall per type
 *   - Latency p50/p95
 *
 * Usage: pnpm eval
 *
 * This is the regression gate for every change. Any proposed modification
 * must beat baseline on the tracked metrics.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import from the existing extension detection pipeline
const EXTENSION_SRC = resolve(__dirname, '../../apps/extension/src');

interface Fixture {
  id: string;
  prompt: string;
  expectedVerdict: string;
  expectedEntities: Array<{ type: string; text: string; isSensitive: boolean }>;
  expectedScore: { min: number; max: number };
  tags: string[];
  notes?: string;
}

interface Result {
  id: string;
  pass: boolean;
  verdictMatch: boolean;
  scoreInRange: boolean;
  entityPrecision: number;
  entityRecall: number;
  actualScore: number;
  actualLevel: string;
  actualEntities: Array<{ type: string; text: string }>;
  latencyMs: number;
  errors: string[];
}

function scoreToVerdict(score: number): string {
  if (score <= 25) return 'allow';
  if (score <= 60) return 'nudge';
  if (score <= 85) return 'mask';
  return 'block';
}

async function runFixture(fixture: Fixture): Promise<Result> {
  const errors: string[] = [];
  const start = performance.now();

  try {
    // Dynamic import from the extension source
    const { detectWithRegex } = await import(
      resolve(EXTENSION_SRC, 'detection/fallback-regex.ts')
    );
    const { computeScore } = await import(
      resolve(EXTENSION_SRC, 'detection/scorer.ts')
    );

    const entities = detectWithRegex(fixture.prompt);
    const scoreResult = computeScore(fixture.prompt, entities);
    const latencyMs = performance.now() - start;

    const actualVerdict = scoreToVerdict(scoreResult.score);
    const verdictMatch = actualVerdict === fixture.expectedVerdict;
    const scoreInRange = scoreResult.score >= fixture.expectedScore.min
      && scoreResult.score <= fixture.expectedScore.max;

    // Entity precision: of detected entities, how many are in expected?
    const detectedTypes = new Set(entities.map((e: any) => `${e.type}:${e.text}`));
    const expectedTypes = new Set(fixture.expectedEntities.map(e => `${e.type}:${e.text}`));

    let truePositives = 0;
    for (const dt of detectedTypes) {
      if (expectedTypes.has(dt)) truePositives++;
    }

    const precision = detectedTypes.size > 0 ? truePositives / detectedTypes.size : 1;
    const recall = expectedTypes.size > 0 ? truePositives / expectedTypes.size : 1;

    if (!verdictMatch) {
      errors.push(`Verdict: expected ${fixture.expectedVerdict}, got ${actualVerdict} (score ${scoreResult.score})`);
    }
    if (!scoreInRange) {
      errors.push(`Score: expected ${fixture.expectedScore.min}-${fixture.expectedScore.max}, got ${scoreResult.score}`);
    }

    return {
      id: fixture.id,
      pass: verdictMatch && scoreInRange,
      verdictMatch,
      scoreInRange,
      entityPrecision: precision,
      entityRecall: recall,
      actualScore: scoreResult.score,
      actualLevel: scoreResult.level,
      actualEntities: entities.map((e: any) => ({ type: e.type, text: e.text })),
      latencyMs,
      errors,
    };
  } catch (err) {
    return {
      id: fixture.id,
      pass: false,
      verdictMatch: false,
      scoreInRange: false,
      entityPrecision: 0,
      entityRecall: 0,
      actualScore: -1,
      actualLevel: 'error',
      actualEntities: [],
      latencyMs: performance.now() - start,
      errors: [`Pipeline error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

async function main() {
  const fixturesPath = resolve(__dirname, 'fixtures/seed.json');
  const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, 'utf-8'));

  console.log(`\n  Iron Gate v0.3 — Eval Harness`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Fixtures: ${fixtures.length}`);
  console.log(`  Pipeline: regex + scorer (Stage 1 only)\n`);

  const results: Result[] = [];
  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);

    const icon = result.pass ? '✓' : '✗';
    const color = result.pass ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}${icon}\x1b[0m ${result.id.padEnd(12)} verdict=${(result.verdictMatch ? 'ok' : 'FAIL').padEnd(5)} score=${String(result.actualScore).padEnd(4)} [${fixture.expectedScore.min}-${fixture.expectedScore.max}] ${result.latencyMs.toFixed(1)}ms`);
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`    \x1b[33m→ ${err}\x1b[0m`);
      }
    }
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const verdictMatches = results.filter(r => r.verdictMatch).length;
  const scoreInRange = results.filter(r => r.scoreInRange).length;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const avgPrecision = results.reduce((s, r) => s + r.entityPrecision, 0) / results.length;
  const avgRecall = results.reduce((s, r) => s + r.entityRecall, 0) / results.length;

  console.log(`\n  ── Summary ──────────────────`);
  console.log(`  Pass rate:       ${passed}/${results.length} (${(passed / results.length * 100).toFixed(1)}%)`);
  console.log(`  Verdict match:   ${verdictMatches}/${results.length} (${(verdictMatches / results.length * 100).toFixed(1)}%)`);
  console.log(`  Score in range:  ${scoreInRange}/${results.length} (${(scoreInRange / results.length * 100).toFixed(1)}%)`);
  console.log(`  Entity precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`  Entity recall:    ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`  Latency p50:     ${p50.toFixed(1)}ms`);
  console.log(`  Latency p95:     ${p95.toFixed(1)}ms`);

  // By tag
  const tagResults = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const fixture = fixtures.find(f => f.id === r.id)!;
    for (const tag of fixture.tags) {
      const entry = tagResults.get(tag) ?? { pass: 0, total: 0 };
      entry.total++;
      if (r.pass) entry.pass++;
      tagResults.set(tag, entry);
    }
  }

  console.log(`\n  ── By Tag ───────────────────`);
  for (const [tag, { pass, total }] of [...tagResults.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pct = (pass / total * 100).toFixed(0);
    console.log(`  ${tag.padEnd(30)} ${pass}/${total} (${pct}%)`);
  }

  console.log();

  // Exit with failure if pass rate < 80%
  if (passed / results.length < 0.8) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Eval harness failed:', err);
  process.exit(1);
});
