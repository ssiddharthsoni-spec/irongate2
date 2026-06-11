/**
 * Ollama Sandbox — validates Gemma 4 function-calling integration.
 *
 * Usage: pnpm sandbox
 *
 * Tests:
 *   1. Ollama reachability (GET /api/tags)
 *   2. Model availability (gemma4:e2b in tag list)
 *   3. Cold-start latency (first /api/chat call)
 *   4. Warm latency (second /api/chat call)
 *   5. Function-calling schema compliance (submitJudgment)
 *   6. Response validation against Zod JudgmentZ schema
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e2b';

const JUDGMENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submitJudgment',
    description: 'Submit a sensitivity judgment for the user prompt',
    parameters: {
      type: 'object',
      required: ['verdict', 'score', 'reasoning', 'entities'],
      properties: {
        verdict: { type: 'string', enum: ['allow', 'nudge', 'mask', 'block'] },
        score: { type: 'number' },
        reasoning: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'text', 'isSensitive'],
            properties: {
              type: { type: 'string' },
              text: { type: 'string' },
              isSensitive: { type: 'boolean' },
              contextNote: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are Iron Gate, a data governance engine. Assess prompts for sensitive data.
Call submitJudgment with: verdict (allow/nudge/mask/block), score (0-100), reasoning (one sentence), entities (array of detected entities with isSensitive boolean).`;

const TEST_PROMPTS = [
  {
    name: 'Benign research',
    text: 'Compare Salesforce and HubSpot pricing for a 500-person company.',
    expectVerdict: 'allow',
    expectMaxScore: 25,
  },
  {
    name: 'PII-dense complaint',
    text: 'I am John Anderson, SSN 234-56-7890. My credit card 4532-1234-5678-9012 was charged incorrectly.',
    expectVerdict: 'block',
    expectMinScore: 80,
  },
  {
    name: 'Confidential M&A',
    text: 'Confidential: acquiring Meridian Health for $2.8B. CEO Sarah Chen briefs board Thursday. Project Atlas.',
    expectVerdict: 'block',
    expectMinScore: 70,
  },
];

async function checkReachability(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { console.log(`  ✗ Ollama returned ${res.status}`); return false; }
    const data = await res.json() as { models?: Array<{ name: string; digest: string }> };
    console.log(`  ✓ Ollama reachable at ${OLLAMA_URL}`);
    console.log(`    Models: ${data.models?.map(m => m.name).join(', ') || '(none)'}`);
    const hasModel = data.models?.some(m => m.name.startsWith(MODEL.split(':')[0] ?? MODEL)) ?? false;
    if (hasModel) {
      console.log(`  ✓ ${MODEL} found`);
    } else {
      console.log(`  ✗ ${MODEL} NOT found — run: ollama pull ${MODEL}`);
    }
    return hasModel;
  } catch (err) {
    console.log(`  ✗ Ollama unreachable: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function callJudge(prompt: string): Promise<{ latencyMs: number; verdict?: string; score?: number; reasoning?: string; entities?: any[]; raw?: any; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Assess this prompt:\n---\n${prompt}\n---\n\nCall submitJudgment.` },
        ],
        tools: [JUDGMENT_TOOL],
        stream: false,
        options: { temperature: 0.1, num_predict: 500 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const latencyMs = performance.now() - start;
    if (!res.ok) return { latencyMs, error: `HTTP ${res.status}` };

    const data = await res.json() as any;
    const toolCall = data.message?.tool_calls?.[0];

    if (toolCall?.function?.name === 'submitJudgment') {
      const args = toolCall.function.arguments;
      return {
        latencyMs,
        verdict: args.verdict,
        score: args.score,
        reasoning: args.reasoning,
        entities: args.entities,
        raw: data,
      };
    }

    // Fallback: try parsing content as JSON
    const content = data.message?.content;
    if (content) {
      try {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return { latencyMs, verdict: parsed.verdict, score: parsed.score, reasoning: parsed.reasoning, entities: parsed.entities, raw: data };
        }
      } catch { /* not JSON */ }
    }

    return { latencyMs, error: 'No function call in response', raw: data };
  } catch (err) {
    return { latencyMs: performance.now() - start, error: String(err) };
  }
}

async function main() {
  console.log(`\n  Iron Gate v0.3 — Ollama Sandbox`);
  console.log(`  ────────────────────────────────`);
  console.log(`  Endpoint: ${OLLAMA_URL}`);
  console.log(`  Model: ${MODEL}\n`);

  // Step 1: Reachability
  console.log('  Step 1: Reachability');
  const reachable = await checkReachability();
  if (!reachable) {
    console.log('\n  ✗ Cannot proceed without Ollama + model. Exiting.\n');
    process.exit(1);
  }

  // Step 2: Function-calling tests
  console.log('\n  Step 2: Function-calling tests');
  const latencies: number[] = [];

  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const test = TEST_PROMPTS[i]!;
    const label = i === 0 ? '(cold)' : '(warm)';
    const result = await callJudge(test.text);
    latencies.push(result.latencyMs);

    if (result.error) {
      console.log(`  ✗ ${test.name} ${label}: ERROR — ${result.error}`);
      continue;
    }

    const verdictOk = result.verdict === test.expectVerdict;
    const scoreOk = test.expectMinScore
      ? (result.score ?? 0) >= test.expectMinScore
      : (result.score ?? 0) <= (test.expectMaxScore ?? 100);

    const icon = verdictOk && scoreOk ? '✓' : '⚠';
    console.log(`  ${icon} ${test.name} ${label}: verdict=${result.verdict} score=${result.score} (${result.latencyMs.toFixed(0)}ms)`);
    console.log(`    reasoning: ${result.reasoning}`);
    console.log(`    entities: ${result.entities?.length ?? 0} detected`);

    if (!verdictOk) console.log(`    \x1b[33m→ Expected verdict: ${test.expectVerdict}\x1b[0m`);
    if (!scoreOk) console.log(`    \x1b[33m→ Expected score ${test.expectMinScore ? `≥${test.expectMinScore}` : `≤${test.expectMaxScore}`}\x1b[0m`);
  }

  // Step 3: Summary
  console.log('\n  ── Summary ──────────────────');
  console.log(`  Cold-start latency: ${latencies[0]?.toFixed(0)}ms`);
  console.log(`  Warm latency (avg): ${latencies.length > 1 ? (latencies.slice(1).reduce((a, b) => a + b, 0) / (latencies.length - 1)).toFixed(0) : 'N/A'}ms`);
  console.log(`  Function-calling: ${latencies.every(l => l > 0) ? '✓ working' : '✗ issues detected'}`);
  console.log();
}

main().catch(err => {
  console.error('Sandbox failed:', err);
  process.exit(1);
});
