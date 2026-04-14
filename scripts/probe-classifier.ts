/**
 * Direct probe of the classifier against a specific model.
 * Runs a handful of representative prompts and prints raw latency + output,
 * so we can diagnose whether the 153-scenario test fallback was a timeout
 * or a parse issue.
 */

import {
  classifyIntentAndContext,
  type ClassifierConfig,
} from '../apps/extension/src/detection/intent-context-classifier';

const model = process.argv[2] ?? 'gemma4:e2b';
const timeoutMs = Number(process.argv[3] ?? '30000');

const config: ClassifierConfig = {
  endpoint: 'http://localhost:11434/api/generate',
  model,
  format: 'ollama',
  timeoutMs,
};

const prompts: Array<{ label: string; prompt: string }> = [
  { label: 'research', prompt: "What were Steve Jobs' leadership principles at Apple?" },
  { label: 'research-legal', prompt: 'Summarize the reasoning in Brown v. Board of Education' },
  { label: 'creative', prompt: 'Write a short novel scene where detective Sarah reads SSN 123-45-6789' },
  { label: 'meta', prompt: "What's our firm's policy on handling client SSNs?" },
  { label: 'code-placeholder', prompt: "Debug: const testUser = { ssn: '000-00-0000', name: 'John Doe' }" },
  { label: 'personal-resume', prompt: 'Improve my resume: managed $2M portfolio at Blackstone 2019-2022' },
  { label: 'worksharing-legal', prompt: 'Draft a settlement for my client Robert Johnson SSN 423-55-8901' },
  { label: 'worksharing-phi', prompt: 'Patient MRN 2024-88341 diagnosed with hypertension, prescribe treatment' },
  { label: 'worksharing-key', prompt: "Debug: Authorization: Bearer sk-proj-RealLookingKeyAbc123Xyz789De45" },
];

async function main() {
  console.log(`Probing ${model} (timeout=${timeoutMs}ms)\n`);
  let passCount = 0;
  let fallbackCount = 0;
  const latencies: number[] = [];

  for (const p of prompts) {
    const result = await classifyIntentAndContext(p.prompt, config);
    latencies.push(result.latencyMs);
    if (result.fellBack) fallbackCount++;
    const tag = result.fellBack ? 'FALLBACK' : `${result.intent}/${result.sensitivity}`;
    console.log(`[${String(result.latencyMs).padStart(5)}ms] ${p.label.padEnd(22)} → ${tag.padEnd(30)} zone=${result.zone}`);
    if (!result.fellBack) {
      console.log(`         reasoning: ${result.reasoning}`);
      passCount++;
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const max = latencies[latencies.length - 1];
  console.log(`\nSummary: ${passCount}/${prompts.length} returned (fallback: ${fallbackCount})`);
  console.log(`Latency: p50 ${p50}ms, max ${max}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
