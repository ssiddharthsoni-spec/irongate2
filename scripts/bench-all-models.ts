/**
 * Multi-Model Local LLM Benchmark
 *
 * Runs the IronGate 30-scenario suite against every model in MODELS[] and
 * produces a comparison report. Each scenario is classified directly by the
 * LLM (NOT gated on Tier 1 AMBER) so we measure pure model quality.
 *
 * Usage:
 *   pnpm tsx scripts/bench-all-models.ts
 *
 * Env:
 *   OLLAMA_ENDPOINT  (default: http://localhost:11434/api/generate)
 *   MODELS           (comma-separated override, e.g. "gemma3:1b,llama3.2:3b")
 *   TIMEOUT_MS       (per-prompt timeout, default 30000)
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30000);

const DEFAULT_MODELS = [
  'gemma3:270m',
  'gemma3:1b',
  'llama3.2:1b',
  'qwen2.5:3b',
  'llama3.2:3b',
  'phi3:mini',
  'gemma3:4b',
];
const MODELS = (process.env.MODELS?.split(',') ?? DEFAULT_MODELS).map(s => s.trim()).filter(Boolean);

// ── Scenarios (same as bench-tier2.ts) ─────────────────────────────────
interface Scenario {
  id: number;
  category: 'TRUE_NEGATIVE' | 'TRUE_POSITIVE' | 'AMBER_ZONE' | 'EDGE_CASE';
  description: string;
  prompt: string;
  expectedZone: 'green' | 'amber' | 'red';
}

const SCENARIOS: Scenario[] = [
  { id: 1,  category: 'TRUE_NEGATIVE', description: 'Coding question', prompt: 'How do I reverse a string in Python?', expectedZone: 'green' },
  { id: 2,  category: 'TRUE_NEGATIVE', description: 'Horoscope with DOB', prompt: 'My birthday is March 15, 1990. What is my horoscope sign?', expectedZone: 'green' },
  { id: 3,  category: 'TRUE_NEGATIVE', description: 'Public company research', prompt: 'Compare Salesforce vs HubSpot market caps and product strategies.', expectedZone: 'green' },
  { id: 4,  category: 'TRUE_NEGATIVE', description: 'Writing help', prompt: 'Help me write a polite email declining a meeting.', expectedZone: 'green' },
  { id: 5,  category: 'TRUE_NEGATIVE', description: 'Recipe', prompt: 'Recipe for chocolate chip cookies in under 30 minutes?', expectedZone: 'green' },
  { id: 6,  category: 'TRUE_NEGATIVE', description: 'Math homework', prompt: 'Solve for x: 3x + 7 = 22', expectedZone: 'green' },
  { id: 7,  category: 'TRUE_NEGATIVE', description: 'Fitness advice', prompt: 'What is a good 5k training plan for beginners?', expectedZone: 'green' },
  { id: 8,  category: 'TRUE_NEGATIVE', description: 'Self-intro resume help', prompt: 'I am John Smith and I want help rewriting my LinkedIn headline. I work in marketing at a startup.', expectedZone: 'green' },
  { id: 9,  category: 'TRUE_NEGATIVE', description: 'Travel planning', prompt: 'What are the best neighborhoods to stay in Tokyo for a first-time visitor?', expectedZone: 'green' },
  { id: 10, category: 'TRUE_NEGATIVE', description: 'Tech explanation', prompt: 'Explain how OAuth 2.0 works in simple terms.', expectedZone: 'green' },
  { id: 11, category: 'TRUE_POSITIVE', description: 'SSN + name', prompt: 'My SSN is 123-45-6789 and my name is Sarah Johnson. Help me file for disability benefits.', expectedZone: 'red' },
  { id: 12, category: 'TRUE_POSITIVE', description: 'Credit card', prompt: 'My Visa is 4532-8891-2244-6677, expires 08/27, CVV 834. Why was my purchase declined?', expectedZone: 'red' },
  { id: 13, category: 'TRUE_POSITIVE', description: 'Medical record', prompt: 'Patient Sarah Chen MRN: 2024-55892, diagnosed with Stage IIB breast cancer. Draft letter to insurance.', expectedZone: 'red' },
  { id: 14, category: 'TRUE_POSITIVE', description: 'API key leak', prompt: 'Debug why this call fails: sk-proj-abc123XYZ789def456GHI012jkl345MNO678pqr901STU234', expectedZone: 'red' },
  { id: 15, category: 'TRUE_POSITIVE', description: 'Multi-entity HR', prompt: 'Terminate Sarah Mitchell, SSN 678-90-1234, salary $185k. Draft separation letter.', expectedZone: 'red' },
  { id: 16, category: 'TRUE_POSITIVE', description: 'Bank account + routing', prompt: 'My Chase routing is 072000326, account 48291057382. Set up autopay to my landlord.', expectedZone: 'red' },
  { id: 17, category: 'TRUE_POSITIVE', description: 'M&A privileged', prompt: 'PRIVILEGED: Acquisition of Meridian Health for $2.8B, CEO James Whitfield (SSN 456-78-9012).', expectedZone: 'red' },
  { id: 18, category: 'TRUE_POSITIVE', description: 'Insurance claim with VIN', prompt: 'My VIN is 1HGBH41JXMN109186, plate ABC-1234, and my license is WA-SMITH-J-9876543.', expectedZone: 'red' },
  { id: 19, category: 'TRUE_POSITIVE', description: 'Email + phone + DOB', prompt: 'Contact john.smith@example.com or (212) 555-8847. DOB 03/15/1978. Legal matter pending.', expectedZone: 'red' },
  { id: 20, category: 'TRUE_POSITIVE', description: 'Passport + address', prompt: 'Passport C04829175, address 3401 Oak Park Blvd Dallas TX 75219. Submit visa application.', expectedZone: 'red' },
  { id: 21, category: 'AMBER_ZONE', description: 'Confidential M&A no PII', prompt: 'Confidential: We are evaluating an acquisition of a competitor for roughly $2B. Draft board talking points.', expectedZone: 'amber' },
  { id: 22, category: 'AMBER_ZONE', description: 'Layoff plan without names', prompt: 'Draft RIF communication for 340 employees, 12% of workforce, Q3 severance plan.', expectedZone: 'amber' },
  { id: 23, category: 'AMBER_ZONE', description: 'Trade secret hint', prompt: 'Our proprietary algorithm achieves 94% accuracy vs competitor 78%. How to explain the gap in our earnings call?', expectedZone: 'amber' },
  { id: 24, category: 'AMBER_ZONE', description: 'Internal financials', prompt: 'Q4 revenue projection is $47M vs street estimate $42M. Draft investor update.', expectedZone: 'amber' },
  { id: 25, category: 'AMBER_ZONE', description: 'Litigation strategy', prompt: 'Draft response to discovery motion in Patterson case. Focus on privilege log defense.', expectedZone: 'amber' },
  { id: 26, category: 'AMBER_ZONE', description: 'Hiring pipeline', prompt: 'We have 3 candidates for CTO role, all former competitors. How to vet without breaching NDAs?', expectedZone: 'amber' },
  { id: 27, category: 'EDGE_CASE', description: 'Fictional character with SSN-like number', prompt: 'Write a novel scene where the detective reads the suspects social security 123-45-6789 aloud.', expectedZone: 'green' },
  { id: 28, category: 'EDGE_CASE', description: 'Learning question about PII format', prompt: 'What format are US social security numbers? Give me a fake example.', expectedZone: 'green' },
  { id: 29, category: 'EDGE_CASE', description: 'Name without context', prompt: 'Who is Sarah Chen?', expectedZone: 'green' },
  { id: 30, category: 'EDGE_CASE', description: 'Public figure + private citizen', prompt: 'Elon Musk and my neighbor Bob Smith both drive Teslas. Which is safer?', expectedZone: 'green' },
];

const SYSTEM_PROMPT = `You are a data sensitivity classifier for a DLP (Data Loss Prevention) product. Classify each input text on a 0-100 sensitivity scale.

SCORING RUBRIC:
- 0-25 (low/green): Generic queries, public information, no identifiable persons, no confidential business context. Examples: coding help, recipes, travel planning, public company research, fictional scenes, educational questions about formats.
- 26-60 (medium/amber): Business-confidential context without direct PII. Examples: unnamed M&A discussions, layoff plans without names, trade secrets, internal financials without specific people, litigation strategy, hiring pipeline discussions.
- 61-85 (high/red): Multiple sensitive entities, legal/medical/financial details tied to real people. Examples: patient records, HR termination with SSNs, multi-entity legal matters.
- 86-100 (critical/red): Highly sensitive — bulk PII, credentials, API keys, attorney-client privilege with named parties, credit cards with CVV.

IMPORTANT:
- Fictional or educational references to PII formats (e.g., "write a scene where X reads SSN aloud") are GREEN, not red. Context matters.
- A name alone without other identifiers is GREEN.
- Public figures discussed in public context are GREEN.
- Unnamed business confidentiality (M&A, layoffs, financials) is AMBER, not red — there's no identity to protect yet.

Respond ONLY with a JSON object: {"score": <number 0-100>, "reasoning": "<brief>"}`;

// ── JSON extractor (brace-counting, handles nested) ────────────────────
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null;
}

// ── Runner ─────────────────────────────────────────────────────────────
interface ModelRunResult {
  scenarioId: number;
  category: string;
  description: string;
  expected: 'green' | 'amber' | 'red';
  score: number;           // -1 on parse failure
  zone: 'green' | 'amber' | 'red' | 'error';
  pass: boolean;
  latencyMs: number;
  parseOk: boolean;
  reasoning: string;
  error?: string;
}

function scoreToZone(s: number): 'green' | 'amber' | 'red' {
  if (s <= 25) return 'green';
  if (s <= 60) return 'amber';
  return 'red';
}

async function classify(model: string, prompt: string): Promise<{ score: number; reasoning: string; latencyMs: number; parseOk: boolean; error?: string; raw: string }> {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${SYSTEM_PROMPT}\n\nText to classify:\n${prompt}\n\nJSON:`,
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
        format: 'json', // Ollama's built-in JSON mode — much more reliable
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { score: -1, reasoning: '', latencyMs: performance.now() - start, parseOk: false, error: `HTTP ${response.status}`, raw: '' };
    }
    const data: any = await response.json();
    const raw: string = data.response ?? '';

    const jsonStr = extractFirstJsonObject(raw);
    if (!jsonStr) {
      return { score: -1, reasoning: '', latencyMs: performance.now() - start, parseOk: false, error: 'No JSON in response', raw };
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonStr); }
    catch (e) { return { score: -1, reasoning: '', latencyMs: performance.now() - start, parseOk: false, error: `JSON.parse: ${String(e)}`, raw }; }

    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) {
      return { score: -1, reasoning: String(parsed.reasoning || ''), latencyMs: performance.now() - start, parseOk: false, error: 'score is not a number', raw };
    }
    return {
      score: Math.max(0, Math.min(100, Math.round(rawScore))),
      reasoning: String(parsed.reasoning || '').substring(0, 200),
      latencyMs: performance.now() - start,
      parseOk: true,
      raw,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return { score: -1, reasoning: '', latencyMs: performance.now() - start, parseOk: false, error: err?.message || String(err), raw: '' };
  }
}

async function warmup(model: string): Promise<number> {
  const start = performance.now();
  await classify(model, 'warmup — respond with score 0');
  return performance.now() - start;
}

async function benchmarkModel(model: string): Promise<{ model: string; results: ModelRunResult[]; coldStartMs: number; warmedUpAtMs: number }> {
  console.log(`\n━━━ ${model} ━━━`);
  const coldStartMs = await warmup(model);
  console.log(`  cold start: ${coldStartMs.toFixed(0)} ms`);

  const results: ModelRunResult[] = [];
  for (const sc of SCENARIOS) {
    const r = await classify(model, sc.prompt);
    const zone = r.parseOk ? scoreToZone(r.score) : 'error';
    const pass = zone === sc.expectedZone;
    results.push({
      scenarioId: sc.id,
      category: sc.category,
      description: sc.description,
      expected: sc.expectedZone,
      score: r.score,
      zone,
      pass,
      latencyMs: r.latencyMs,
      parseOk: r.parseOk,
      reasoning: r.reasoning,
      error: r.error,
    });
    const icon = pass ? '✓' : '✗';
    const scoreStr = r.parseOk ? String(r.score).padStart(3) : 'ERR';
    console.log(`  #${String(sc.id).padStart(2, '0')} ${icon} ${scoreStr} (${zone.padEnd(5)}) [${String(Math.round(r.latencyMs)).padStart(5)} ms] ${sc.description}`);
  }
  return { model, results, coldStartMs, warmedUpAtMs: Date.now() };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IronGate Multi-Model Local LLM Benchmark');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Endpoint:  ${ENDPOINT}`);
  console.log(`  Scenarios: ${SCENARIOS.length}`);
  console.log(`  Models:    ${MODELS.length} (${MODELS.join(', ')})`);
  console.log(`  Timeout:   ${TIMEOUT_MS} ms`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Check Ollama reachable
  try {
    const probe = await fetch(ENDPOINT.replace('/api/generate', '/api/tags'), { signal: AbortSignal.timeout(3000) });
    const data: any = await probe.json();
    const installed = (data?.models || []).map((m: any) => m.name);
    console.log(`  Installed: ${installed.join(', ') || '(none)'}\n`);
    for (const m of MODELS) {
      if (!installed.some((i: string) => i === m || i.startsWith(m + ':') || m === i)) {
        console.log(`  ⚠ Model not installed (will skip): ${m}`);
      }
    }
  } catch (err) {
    console.error('❌ Ollama not reachable:', err);
    process.exit(1);
  }

  const allResults: Array<Awaited<ReturnType<typeof benchmarkModel>>> = [];
  for (const model of MODELS) {
    try {
      const mr = await benchmarkModel(model);
      allResults.push(mr);
      // Save incrementally so we don't lose progress on crash
      writeFileSync(
        join(process.cwd(), `bench-all-results.json`),
        JSON.stringify({ timestamp: new Date().toISOString(), runs: allResults }, null, 2),
      );
    } catch (err) {
      console.error(`  ✗ ${model} failed:`, err);
    }
  }

  // ── Comparison table ───────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const headers = ['Model', 'Total', 'Green', 'Red', 'Amber', 'Edge', 'P50 ms', 'P95 ms', 'JSON OK'];
  console.log(headers.map((h, i) => h.padEnd(i === 0 ? 18 : 8)).join(' '));
  console.log('─'.repeat(95));

  for (const run of allResults) {
    const r = run.results;
    const total = `${r.filter(x => x.pass).length}/${r.length}`;
    const cat = (c: string) => {
      const rs = r.filter(x => x.category === c);
      return rs.length === 0 ? 'n/a' : `${rs.filter(x => x.pass).length}/${rs.length}`;
    };
    const latencies = r.map(x => x.latencyMs);
    const p50 = percentile(latencies, 50).toFixed(0);
    const p95 = percentile(latencies, 95).toFixed(0);
    const jsonOk = `${r.filter(x => x.parseOk).length}/${r.length}`;
    console.log([
      run.model.padEnd(18),
      total.padEnd(8),
      cat('TRUE_NEGATIVE').padEnd(8),
      cat('TRUE_POSITIVE').padEnd(8),
      cat('AMBER_ZONE').padEnd(8),
      cat('EDGE_CASE').padEnd(8),
      p50.padEnd(8),
      p95.padEnd(8),
      jsonOk.padEnd(8),
    ].join(' '));
  }

  console.log('\nTier 1 baseline (for reference): 22/30 (73.3%), P50 0ms P95 3ms');
  console.log(`\nDetailed results: bench-all-results.json`);
}

main().catch(err => {
  console.error('Crashed:', err);
  process.exit(1);
});
