/**
 * verify-wire.ts — a wire-level verification harness.
 *
 * This runs alongside a live mitmproxy capture (see
 * docs/verification/WIRE_VERIFICATION.md). It:
 *
 *   1. Prints each test prompt along with the ORIGINAL PII values the
 *      tester should confirm DO NOT appear in the mitmproxy capture.
 *   2. Provides a grep-based validator — point it at a mitmproxy dump
 *      file and it asserts none of the original values leaked.
 *
 * Intentionally language-minimal: doesn't drive Chrome directly (Puppeteer
 * against a logged-in ChatGPT account is brittle and account-risky).
 * A human tester pastes each prompt; the harness validates the resulting
 * capture file.
 *
 * Usage:
 *   # 1. Print the test plan
 *   pnpm tsx scripts/verify-wire.ts plan
 *
 *   # 2. After running the prompts, validate the capture file
 *   pnpm tsx scripts/verify-wire.ts verify ./wire-capture.mitm
 */

import { readFileSync, existsSync } from 'node:fs';

interface WireScenario {
  id: string;
  category: 'legal' | 'healthcare' | 'ma' | 'credentials' | 'personal';
  prompt: string;
  /** Exact PII strings that MUST NOT appear in the outbound capture. */
  forbiddenOnWire: string[];
  /** Human-readable note about what to watch for on the wire. */
  note: string;
}

const SCENARIOS: WireScenario[] = [
  {
    id: 'WIRE-L1',
    category: 'legal',
    prompt:
      'Draft a settlement letter for my client Robert Johnson, SSN 423-55-8901, ' +
      'addressing the Meridian Health lawsuit.',
    forbiddenOnWire: ['Robert Johnson', '423-55-8901', 'Meridian Health'],
    note:
      'Client name, SSN, and opposing counsel name should all be ' +
      'pseudonymized or redacted. SSN must NEVER appear on the wire.',
  },
  {
    id: 'WIRE-H1',
    category: 'healthcare',
    prompt:
      'Patient MRN 2024-88341, Patricia Chen, diagnosed with type 2 diabetes, ' +
      'prescribed metformin 500mg BID.',
    forbiddenOnWire: ['2024-88341', 'Patricia Chen'],
    note:
      'MRN and patient name must be redacted; diagnosis + medication may ' +
      'pass through (non-PII clinical content).',
  },
  {
    id: 'WIRE-M1',
    category: 'ma',
    prompt:
      'Confidential: we are acquiring Meridian Health for $2.8B. ' +
      'Goldman is advising. Draft board talking points.',
    forbiddenOnWire: ['Meridian Health', 'Goldman'],
    note: 'Target + banker names should be pseudonymized.',
  },
  {
    id: 'WIRE-K1',
    category: 'credentials',
    prompt:
      'Debug this request: curl -H "Authorization: Bearer ' +
      'sk-proj-RealLookingKeyAbc123Xyz789De45" https://api.example.com',
    forbiddenOnWire: ['sk-proj-RealLookingKeyAbc123Xyz789De45'],
    note: 'Production-looking API key must be fully redacted on the wire.',
  },
  {
    id: 'WIRE-P1',
    category: 'personal',
    prompt:
      'Improve my resume: managed $2M portfolio at Blackstone 2019-2022, ' +
      'led team of 8 analysts.',
    forbiddenOnWire: ['Blackstone'],
    note:
      'Employer name is PII even in self-referential prompts; ' +
      'pseudonymization expected by default firm policy.',
  },
];

function printPlan(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IronGate Wire-Verification Test Plan');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Follow docs/verification/WIRE_VERIFICATION.md to set up mitmproxy,');
  console.log('then paste each prompt below into the indicated platform.');
  console.log('');
  SCENARIOS.forEach((s, i) => {
    console.log(`── ${s.id} [${s.category}] ${'─'.repeat(45)}`);
    console.log(`Prompt:\n  ${s.prompt}`);
    console.log('');
    console.log(`MUST NOT appear in outbound request body:`);
    for (const forbidden of s.forbiddenOnWire) {
      console.log(`  ✗ "${forbidden}"`);
    }
    console.log(`Note: ${s.note}`);
    console.log('');
    if (i < SCENARIOS.length - 1) console.log('');
  });
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('After paste, validate with: pnpm tsx scripts/verify-wire.ts verify <mitm-file>');
  console.log('═══════════════════════════════════════════════════════════════');
}

function verify(capturePath: string): void {
  if (!existsSync(capturePath)) {
    console.error(`Capture file not found: ${capturePath}`);
    process.exit(1);
  }

  console.log(`Reading capture: ${capturePath}\n`);
  // mitmproxy .mitm files are binary; we read as utf8 with replacement.
  // This is a best-effort string scan — not a full mitmproxy parser.
  // For pilot-grade verification, the tester should also review the
  // mitmweb UI visually. This script is the coarse automated gate.
  const raw = readFileSync(capturePath, 'utf8');

  let failed = 0;
  let passed = 0;

  for (const s of SCENARIOS) {
    const leaks: string[] = [];
    for (const forbidden of s.forbiddenOnWire) {
      if (raw.includes(forbidden)) {
        leaks.push(forbidden);
      }
    }

    if (leaks.length === 0) {
      console.log(`✓  ${s.id} [${s.category}]  — no PII on wire`);
      passed++;
    } else {
      console.log(`✗  ${s.id} [${s.category}]  — LEAKED: ${leaks.map((s) => `"${s}"`).join(', ')}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Passed: ${passed}/${SCENARIOS.length}`);
  console.log(`Failed: ${failed}/${SCENARIOS.length}`);

  if (failed > 0) {
    console.log('');
    console.log('One or more original PII values appeared in the outbound capture.');
    console.log('Open the capture in mitmweb and trace the offending flow to the');
    console.log('adapter + platform that let it through.');
    process.exit(1);
  }
}

function main(): void {
  const cmd = process.argv[2];
  if (cmd === 'plan' || !cmd) {
    printPlan();
    return;
  }
  if (cmd === 'verify') {
    const path = process.argv[3];
    if (!path) {
      console.error('Usage: verify-wire.ts verify <capture-file>');
      process.exit(1);
    }
    verify(path);
    return;
  }
  console.error(`Unknown command: ${cmd}. Use 'plan' or 'verify <file>'.`);
  process.exit(1);
}

main();
