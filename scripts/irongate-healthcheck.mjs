#!/usr/bin/env node
/**
 * IronGate Enterprise Health Check
 *
 * Standalone diagnostic tool for IT engineers deploying IronGate Enterprise.
 * Run this after deploying the extension and the local LLM service to verify
 * the deployment is healthy. Outputs human-readable text or JSON for monitoring.
 *
 * Usage:
 *   node irongate-healthcheck.mjs                  # human output
 *   node irongate-healthcheck.mjs --json           # JSON for SIEM ingestion
 *   node irongate-healthcheck.mjs --endpoint URL   # override Ollama endpoint
 *   node irongate-healthcheck.mjs --model NAME     # override expected model
 *
 * Exit codes:
 *   0 = healthy
 *   1 = degraded (some checks failed)
 *   2 = unhealthy (critical checks failed)
 *
 * What it checks:
 *   1. Ollama service is reachable on the expected port
 *   2. Expected model is loaded into Ollama
 *   3. Cold inference roundtrip works
 *   4. Inference roundtrip latency is within tolerance
 *   5. Classification JSON is well-formed
 *   6. Classification accuracy on a 6-scenario sanity test
 *
 * IT engineers can wire this into their fleet monitoring (Datadog, Splunk, etc.)
 * by running it on a cron and ingesting the JSON output.
 */

import { argv, exit } from 'node:process';

// ── Args ────────────────────────────────────────────────────────────────
const args = parseArgs(argv.slice(2));
const ENDPOINT = args.endpoint || process.env.IRONGATE_ENDPOINT || 'http://localhost:11434/api/generate';
const MODEL = args.model || process.env.IRONGATE_MODEL || 'gemma4:e2b';
const JSON_OUTPUT = args.json || false;
const TIMEOUT_MS = Number(args.timeout || process.env.IRONGATE_TIMEOUT || 30000);

// ── Sanity test scenarios (6 cases, ~30 seconds total) ────────────────
// These are deliberately distinct categories so a model that passes all 6
// is plausibly working correctly. Failures indicate model misconfiguration.

const SANITY_TESTS = [
  { name: 'green/coding',      prompt: 'How do I reverse a string in Python?',                                                              expected: 'green' },
  { name: 'green/recipe',      prompt: 'What is a good chocolate chip cookie recipe?',                                                       expected: 'green' },
  { name: 'red/ssn',           prompt: 'My SSN is 123-45-6789 and my name is Sarah Johnson. Help me file for disability benefits.',          expected: 'red'   },
  { name: 'red/api-key',       prompt: 'Debug this: sk-proj-abc123XYZ789def456GHI012jkl345MNO678pqr901STU234',                               expected: 'red'   },
  { name: 'amber/m&a',         prompt: 'Confidential: We are evaluating an acquisition of a competitor for roughly $2B. Draft talking points.', expected: 'amber' },
  { name: 'amber/layoffs',     prompt: 'Draft RIF communication for 340 employees, 12% of workforce, Q3 severance plan.',                    expected: 'amber' },
];

const SYSTEM_PROMPT = `You are a data sensitivity classifier. Classify the input on a 0-100 scale.
- 0-25 (green): Generic, no PII
- 26-60 (amber): Business-confidential without direct PII (M&A, layoffs, trade secrets)
- 61-100 (red): Multiple sensitive entities, PII tied to people, credentials, API keys
Respond ONLY with JSON: {"score": <0-100>, "level": "<low|medium|high|critical>", "reasoning": "<brief>"}`;

// ── Checks ─────────────────────────────────────────────────────────────

const results = {
  timestamp: new Date().toISOString(),
  endpoint: ENDPOINT,
  model: MODEL,
  checks: [],
  overall: 'unknown',
};

function record(name, status, detail = '', latencyMs = null) {
  results.checks.push({ name, status, detail, latencyMs });
  if (!JSON_OUTPUT) {
    const icon = status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
    const color = status === 'pass' ? '\x1b[32m' : status === 'warn' ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    const lat = latencyMs !== null ? ` [${Math.round(latencyMs)}ms]` : '';
    console.log(`  ${color}${icon}${reset} ${name.padEnd(40)} ${detail}${lat}`);
  }
}

async function check1_endpointReachable() {
  const probeUrl = ENDPOINT.replace('/api/generate', '/api/tags');
  const start = Date.now();
  try {
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      record('Ollama endpoint reachable', 'fail', `HTTP ${res.status} from ${probeUrl}`, Date.now() - start);
      return null;
    }
    const data = await res.json();
    record('Ollama endpoint reachable', 'pass', probeUrl, Date.now() - start);
    return data;
  } catch (err) {
    record('Ollama endpoint reachable', 'fail', `Cannot connect to ${probeUrl}: ${err.message}`, Date.now() - start);
    return null;
  }
}

function check2_modelLoaded(tagsData) {
  if (!tagsData) {
    record('Expected model loaded', 'fail', 'Skipped — endpoint not reachable');
    return false;
  }
  const installed = (tagsData.models || []).map((m) => m.name);
  const found = installed.some((n) => n === MODEL || n.startsWith(MODEL + ':'));
  if (found) {
    record('Expected model loaded', 'pass', `${MODEL} (${installed.length} models total)`);
    return true;
  }
  record('Expected model loaded', 'fail', `${MODEL} not in installed list. Run: ollama pull ${MODEL}`);
  return false;
}

async function check3_coldInferenceRoundtrip() {
  const start = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: 'Reply only with the word "ok"',
        stream: false,
        options: { temperature: 0, num_predict: 5 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      record('Cold inference roundtrip', 'fail', `HTTP ${res.status}`, Date.now() - start);
      return false;
    }
    const data = await res.json();
    const lat = Date.now() - start;
    if (typeof data.response !== 'string') {
      record('Cold inference roundtrip', 'fail', 'Response missing "response" field', lat);
      return false;
    }
    if (lat > 30000) {
      record('Cold inference roundtrip', 'warn', `Slow cold start (${(lat/1000).toFixed(1)}s)`, lat);
      return true;
    }
    record('Cold inference roundtrip', 'pass', `Response: "${data.response.trim().substring(0, 30)}"`, lat);
    return true;
  } catch (err) {
    record('Cold inference roundtrip', 'fail', err.message, Date.now() - start);
    return false;
  }
}

async function classifyOnce(text) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nText to classify:\n${text}\n\nJSON:`,
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 200 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.response || '';
  const start = raw.indexOf('{');
  if (start === -1) throw new Error(`No JSON in response: ${raw.substring(0, 100)}`);
  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Unclosed JSON object');
  const parsed = JSON.parse(raw.substring(start, end + 1));
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const zone = score <= 25 ? 'green' : score <= 60 ? 'amber' : 'red';
  return { score, zone };
}

async function check4_classificationAccuracy() {
  const passes = [];
  const failures = [];
  const latencies = [];
  for (const test of SANITY_TESTS) {
    try {
      const start = Date.now();
      const r = await classifyOnce(test.prompt);
      latencies.push(Date.now() - start);
      if (r.zone === test.expected) {
        passes.push(test.name);
      } else {
        failures.push(`${test.name} (got ${r.zone}=${r.score}, expected ${test.expected})`);
      }
    } catch (err) {
      failures.push(`${test.name} (error: ${err.message})`);
    }
  }
  const accuracy = passes.length / SANITY_TESTS.length;
  const p50 = percentile(latencies, 50);
  if (accuracy >= 5/6) {
    record('Classification accuracy', 'pass', `${passes.length}/${SANITY_TESTS.length} sanity tests passed`, p50);
  } else if (accuracy >= 4/6) {
    record('Classification accuracy', 'warn', `${passes.length}/${SANITY_TESTS.length} passed. Failures: ${failures.join(', ')}`, p50);
  } else {
    record('Classification accuracy', 'fail', `${passes.length}/${SANITY_TESTS.length} passed. Failures: ${failures.join(', ')}`, p50);
  }
  return accuracy;
}

async function check5_latencyTolerance() {
  // Run a small classification and verify P50 is under tolerance
  const start = Date.now();
  try {
    await classifyOnce('Generic test prompt with no PII.');
    const lat = Date.now() - start;
    if (lat < 3000) record('Inference latency under 3s', 'pass', `${lat}ms`, lat);
    else if (lat < 8000) record('Inference latency under 3s', 'warn', `${lat}ms (slow but functional)`, lat);
    else record('Inference latency under 3s', 'fail', `${lat}ms (unacceptably slow)`, lat);
  } catch (err) {
    record('Inference latency under 3s', 'fail', err.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUTPUT) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  IronGate Enterprise Health Check');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Endpoint: ${ENDPOINT}`);
    console.log(`  Model:    ${MODEL}`);
    console.log(`  Timeout:  ${TIMEOUT_MS}ms`);
    console.log('───────────────────────────────────────────────────────────────');
  }

  const tagsData = await check1_endpointReachable();
  const modelOk = check2_modelLoaded(tagsData);
  if (!tagsData || !modelOk) {
    results.overall = 'unhealthy';
    finishAndExit(2);
    return;
  }

  const inferOk = await check3_coldInferenceRoundtrip();
  if (!inferOk) {
    results.overall = 'unhealthy';
    finishAndExit(2);
    return;
  }

  await check5_latencyTolerance();
  const accuracy = await check4_classificationAccuracy();

  const failed = results.checks.filter((c) => c.status === 'fail').length;
  const warned = results.checks.filter((c) => c.status === 'warn').length;

  if (failed > 0) results.overall = 'unhealthy';
  else if (warned > 0 || accuracy < 1) results.overall = 'degraded';
  else results.overall = 'healthy';

  finishAndExit(failed > 0 ? 2 : warned > 0 ? 1 : 0);
}

function finishAndExit(code) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('───────────────────────────────────────────────────────────────');
    const emoji = results.overall === 'healthy' ? '✅' : results.overall === 'degraded' ? '⚠️ ' : '❌';
    console.log(`  ${emoji} Overall: ${results.overall.toUpperCase()}`);
    console.log('═══════════════════════════════════════════════════════════════');
  }
  exit(code);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((p / 100) * (s.length - 1))];
}

main().catch((err) => {
  console.error('Health check crashed:', err);
  exit(2);
});
