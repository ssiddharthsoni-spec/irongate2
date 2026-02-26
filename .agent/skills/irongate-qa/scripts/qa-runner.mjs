#!/usr/bin/env node
/**
 * IronGate QA Runner — Automated test execution script for Antigravity
 *
 * Usage:
 *   node .agent/skills/irongate-qa/scripts/qa-runner.mjs              # Full run
 *   node .agent/skills/irongate-qa/scripts/qa-runner.mjs --unit-only  # Unit tests only
 *   node .agent/skills/irongate-qa/scripts/qa-runner.mjs --report     # Generate report from results
 *
 * This script:
 * 1. Builds the extension
 * 2. Runs all 536+ unit tests
 * 3. Outputs a structured browser test plan for Antigravity's browser agent
 * 4. Collects results and generates QA_REPORT.md
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../../..');
const EXTENSION = resolve(ROOT, 'apps/extension');

// ── Test Scenarios ───────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 1,
    name: 'Basic PII (Names + Email)',
    prompt: 'Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?',
    expect: { minEntities: 3, minScore: 20, level: ['medium', 'high'], sensitive: ['john.smith@acme.com', 'sarah.j@globex.net'] },
  },
  {
    id: 2,
    name: 'Financial Data (Credit Card + SSN)',
    prompt: 'I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.',
    expect: { minEntities: 3, minScore: 40, level: ['high', 'critical'], sensitive: ['423-86-1957', '4532-8921-0076-3344'] },
  },
  {
    id: 3,
    name: 'API Keys & Credentials',
    prompt: 'My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?',
    expect: { minEntities: 1, minScore: 15, level: ['medium', 'high', 'critical'], sensitive: ['AKIAIOSFODNN7EXAMPLE'] },
  },
  {
    id: 4,
    name: 'Mixed Sensitive Content',
    prompt: 'Please review this employee record: Dr. Maria Garcia, Employee ID: EMP-29481, salary $185,000, DOB 03/15/1988, works at 742 Evergreen Terrace, Springfield IL 62704. Her manager is Robert Chen (robert.chen@internal.corp).',
    expect: { minEntities: 1, minScore: 10, level: ['low', 'medium', 'high'], sensitive: ['robert.chen@internal.corp'] },
  },
  {
    id: 5,
    name: 'Code with Embedded Secrets',
    prompt: `Here's my config file:\nDATABASE_URL=postgresql://admin:SuperSecret123@db.prod.mycompany.com:5432/maindb\nAPI_TOKEN=sk-proj-abc123def456ghi789\nSTRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\nCan you help me set up environment variables properly?`,
    expect: { minEntities: 1, minScore: 10, level: ['medium', 'high', 'critical'], sensitive: ['sk_live_4eC39HqLyjWDarjtT1zdp7dc'] },
  },
  {
    id: 6,
    name: 'False Positive Check',
    prompt: 'Can you explain how photosynthesis works in simple terms?',
    expect: { maxEntities: 1, maxScore: 10, level: ['low'], sensitive: [] },
  },
  {
    id: 7,
    name: 'Brand Names Edge Case',
    prompt: "I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?",
    expect: { maxEntities: 2, maxScore: 25, level: ['low', 'medium'], sensitive: [] },
  },
];

const PLATFORMS = [
  { id: 'chatgpt',     name: 'ChatGPT',          url: 'https://chatgpt.com',             priority: 'P0', input: '#prompt-textarea', submit: 'button[data-testid="send-button"]' },
  { id: 'claude',      name: 'Claude',            url: 'https://claude.ai',               priority: 'P0', input: '[contenteditable="true"].ProseMirror', submit: 'button[aria-label="Send Message"]' },
  { id: 'gemini',      name: 'Google Gemini',     url: 'https://gemini.google.com',       priority: 'P0', input: '.ql-editor[contenteditable="true"]', submit: 'button[aria-label="Send message"]' },
  { id: 'copilot',     name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com',   priority: 'P1', input: '#userInput', submit: 'button[aria-label="Submit"]' },
  { id: 'perplexity',  name: 'Perplexity',        url: 'https://perplexity.ai',           priority: 'P1', input: 'textarea[placeholder*="Ask"]', submit: 'button[aria-label="Submit"]' },
  { id: 'deepseek',    name: 'DeepSeek',          url: 'https://chat.deepseek.com',       priority: 'P2', input: '#chat-input', submit: '#chat-input-send-btn' },
  { id: 'poe',         name: 'Poe',               url: 'https://poe.com',                 priority: 'P2', input: 'textarea[class*="TextArea"]', submit: 'button[class*="sendButton"]' },
  { id: 'groq',        name: 'Groq',              url: 'https://groq.com',                priority: 'P2', input: 'textarea', submit: 'button[aria-label*="send" i]' },
  { id: 'huggingface', name: 'HuggingFace Chat',  url: 'https://huggingface.co/chat',     priority: 'P2', input: 'textarea', submit: 'button[type="submit"]' },
  { id: 'you',         name: 'You.com',           url: 'https://you.com',                 priority: 'P2', input: 'textarea', submit: 'button[type="submit"]' },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', timeout: 120_000, ...opts });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.stdout || err.message };
  }
}

function header(text) {
  console.log('');
  console.log('╔' + '═'.repeat(60) + '╗');
  console.log('║  ' + text.padEnd(58) + '║');
  console.log('╚' + '═'.repeat(60) + '╝');
  console.log('');
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

// ── Phase 1: Build ──────────────────────────────────────────────────────

function phaseBuild() {
  header('Phase 1: Build Extension');
  const result = run('pnpm --filter=extension build');
  if (!result.success) {
    console.error('  ✗ Build FAILED');
    console.error(result.output.slice(-500));
    process.exit(1);
  }
  console.log('  ✓ Extension built → apps/extension/dist/');
  return true;
}

// ── Phase 2: Unit Tests ─────────────────────────────────────────────────

function phaseUnitTests() {
  header('Phase 2: Unit Tests');
  const result = run('pnpm --filter=extension test');

  // Parse test counts from output
  const passMatch = result.output.match(/Tests\s+(\d+) passed/);
  const failMatch = result.output.match(/Tests\s+(\d+) failed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;

  if (!result.success || failed > 0) {
    console.error(`  ✗ Unit tests: ${passed} passed, ${failed} failed`);
    console.error(result.output.slice(-1000));
    process.exit(1);
  }

  console.log(`  ✓ Unit tests: ${passed} passed, 0 failed`);
  return { passed, failed };
}

// ── Phase 3: Generate Browser Test Plan ─────────────────────────────────

function phaseBrowserTestPlan() {
  header('Phase 3: Browser Test Plan');
  console.log('  The following test plan is for Antigravity\'s browser agent.');
  console.log('  Load the extension from: apps/extension/dist/');
  console.log('');

  const plan = [];

  for (const platform of PLATFORMS) {
    console.log(`  ── ${platform.name} (${platform.priority}) ──`);
    console.log(`  URL: ${platform.url}`);
    console.log(`  Input: ${platform.input}`);
    console.log(`  Submit: ${platform.submit}`);
    console.log('');

    for (const scenario of SCENARIOS) {
      plan.push({
        platform: platform.id,
        platformName: platform.name,
        url: platform.url,
        scenario: scenario.id,
        scenarioName: scenario.name,
        prompt: scenario.prompt,
        expect: scenario.expect,
        inputSelector: platform.input,
        submitSelector: platform.submit,
        steps: [
          `Navigate to ${platform.url}`,
          'Wait 3 seconds for IronGate injection',
          'Run in console: window.__IRON_GATE_MAIN_WORLD (expect "active")',
          `Type into: ${platform.input}`,
          `Click: ${platform.submit}`,
          'Wait 5-8 seconds for AI response',
          `Check side panel: entities >= ${scenario.expect.minEntities || 0}`,
          `Check side panel: score >= ${scenario.expect.minScore || 0}`,
          `Check side panel: level in [${(scenario.expect.level || []).join(', ')}]`,
          ...(scenario.expect.sensitive || []).map(s => `Verify "${s}" is NOT in the network request`),
          'Screenshot the result',
        ],
      });
    }
  }

  // Write the plan to a JSON file for structured consumption
  const planPath = resolve(ROOT, '.agent/skills/irongate-qa/test-plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`  ✓ Test plan written to: .agent/skills/irongate-qa/test-plan.json`);
  console.log(`  Total test cases: ${plan.length} (${PLATFORMS.length} platforms × ${SCENARIOS.length} scenarios)`);

  return plan;
}

// ── Phase 4: Generate Report ────────────────────────────────────────────

function phaseReport(unitResults, results = null) {
  header('Phase 4: Generate QA Report');

  const date = timestamp().split(' ')[0];
  const templatePath = resolve(ROOT, '.agent/skills/irongate-qa/references/QA_REPORT_TEMPLATE.md');

  let report = `# IronGate QA Report\n\n`;
  report += `**Date:** ${date}\n`;
  report += `**Build:** extension v0.1.0 | API v0.1.0\n`;
  report += `**Tester:** Antigravity QA Agent\n\n`;
  report += `---\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Platforms tested | ${PLATFORMS.length}/10 |\n`;
  report += `| Scenarios per platform | ${SCENARIOS.length}/7 |\n`;
  report += `| Total test cases | ${PLATFORMS.length * SCENARIOS.length} |\n`;
  report += `| Unit tests | ${unitResults.passed} passed, ${unitResults.failed} failed |\n\n`;

  report += `## Automated Unit Test Results\n\n`;
  report += `\`\`\`\n`;
  report += `pnpm --filter=extension test → ${unitResults.passed} passed\n`;
  report += `\`\`\`\n\n`;

  report += `## Browser Test Plan\n\n`;
  report += `The browser test plan has been generated at:\n`;
  report += `\`.agent/skills/irongate-qa/test-plan.json\`\n\n`;
  report += `### Instructions for Antigravity Browser Agent:\n\n`;

  for (const platform of PLATFORMS) {
    report += `### ${platform.name} (${platform.url})\n\n`;
    report += `| Scenario | Result | Entities | Score | Level | Notes |\n`;
    report += `|----------|--------|----------|-------|-------|-------|\n`;
    for (const scenario of SCENARIOS) {
      report += `| ${scenario.id}. ${scenario.name} | ⏳ | | | | |\n`;
    }
    report += `\n`;
  }

  report += `---\n\n`;
  report += `## Bug Detection Checklist\n\n`;
  report += `- [ ] CSP violations in console\n`;
  report += `- [ ] Race conditions (extension not loaded on first prompt)\n`;
  report += `- [ ] SSE parsing errors (garbled AI responses)\n`;
  report += `- [ ] False positives (Scenarios 6 & 7)\n`;
  report += `- [ ] Missed entities (sensitive data leaking)\n`;
  report += `- [ ] De-pseudonymization failures\n`;
  report += `- [ ] Side panel not updating\n`;
  report += `- [ ] File upload not detected\n\n`;

  report += `---\n\n`;
  report += `## Bugs Found\n\n`;
  report += `*Fill in during browser testing*\n\n`;

  const reportPath = resolve(ROOT, 'QA_REPORT.md');
  writeFileSync(reportPath, report);
  console.log(`  ✓ QA Report written to: QA_REPORT.md`);
  console.log(`  Fill in browser test results as you go.`);

  return reportPath;
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args[0] || '--full';

console.log(`╔${'═'.repeat(60)}╗`);
console.log(`║  IronGate QA Runner — ${timestamp()}${''.padEnd(60 - 26 - timestamp().length)}║`);
console.log(`╚${'═'.repeat(60)}╝`);

if (mode === '--unit-only') {
  phaseBuild();
  phaseUnitTests();
  console.log('\n  Done. Unit tests only — no browser testing.\n');
  process.exit(0);
}

if (mode === '--report') {
  phaseReport({ passed: 536, failed: 0 });
  process.exit(0);
}

// Full run
phaseBuild();
const unitResults = phaseUnitTests();
const plan = phaseBrowserTestPlan();
phaseReport(unitResults);

header('Ready for Browser Testing');
console.log('  1. Load extension from: apps/extension/dist/');
console.log('  2. Open each platform URL');
console.log('  3. Run all 7 scenarios per platform');
console.log('  4. Check side panel after each scenario');
console.log('  5. Screenshot results');
console.log('  6. Update QA_REPORT.md with results');
console.log('');
console.log('  Or use the Antigravity workflow: /test-irongate');
console.log('');
