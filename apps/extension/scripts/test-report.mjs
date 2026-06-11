#!/usr/bin/env node
/**
 * Iron Gate Test Report Generator
 *
 * Runs the e2e test suite via Playwright and generates a structured JSON
 * report that can be fed to Claude Code for automated bug fixing.
 *
 * Output:
 *   - test-results/report.json    — structured failures + context
 *   - test-results/summary.txt    — human-readable summary
 *   - test-results/screenshots/   — per-scenario screenshots
 *
 * Usage:
 *   node scripts/test-report.mjs [spec-file]
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RESULTS_DIR = resolve(ROOT, 'test-results');
const SCREENSHOTS_DIR = resolve(ROOT, 'tests/e2e/screenshots');

function timestamp() {
  return new Date().toISOString();
}

// ── Run Playwright ──────────────────────────────────────────────────────────

function runPlaywright(specFile) {
  return new Promise((resolve) => {
    const args = [
      'playwright', 'test',
      '--reporter=json',
      '--output', RESULTS_DIR,
    ];
    if (specFile) args.push(specFile);

    const proc = spawn('npx', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: 'pw-results.json' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

// ── Parse Results ───────────────────────────────────────────────────────────

function parseResults(jsonPath) {
  if (!existsSync(jsonPath)) return null;

  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const suites = raw.suites || [];
  const results = [];

  function walkSpecs(suite, parentTitle = '') {
    const prefix = parentTitle ? `${parentTitle} > ` : '';
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          results.push({
            title: `${prefix}${spec.title}`,
            status: result.status,
            duration: result.duration,
            error: result.error ? {
              message: result.error.message?.slice(0, 1000),
              snippet: result.error.snippet?.slice(0, 500),
            } : null,
            retry: result.retry,
            stdout: result.stdout?.map(s => s.text).join('\n').slice(0, 500),
          });
        }
      }
    }
    for (const child of suite.suites || []) {
      walkSpecs(child, `${prefix}${suite.title}`);
    }
  }

  for (const suite of suites) {
    walkSpecs(suite);
  }

  return results;
}

// ── Generate Report ─────────────────────────────────────────────────────────

function generateReport(results, exitCode) {
  const passed = results.filter(r => r.status === 'passed');
  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');

  // Group failures by category (extract from test title)
  const failuresByCategory = {};
  for (const f of failed) {
    const match = f.title.match(/\[([A-Z]+-\d+)\]/);
    const id = match ? match[1] : 'UNKNOWN';
    const category = id.split('-')[0];
    if (!failuresByCategory[category]) failuresByCategory[category] = [];
    failuresByCategory[category].push({
      id,
      title: f.title,
      error: f.error?.message || 'Unknown error',
      errorSnippet: f.error?.snippet,
    });
  }

  // Identify known bug patterns
  const knownBugs = {
    ssnLeak: failed.some(f => f.title.includes('SSN') && f.error?.message?.includes('LEAK')),
    accountLeak: failed.some(f => f.title.includes('account') && f.error?.message?.includes('LEAK')),
    matchError: failed.some(f => f.error?.message?.includes('match is not a function')),
    injectionFailure: failed.some(f => f.title.includes('inject') && f.error?.message?.includes('not injected')),
    indexedDbFailure: failed.some(f => f.title.includes('Activity') || f.title.includes('IndexedDB')),
  };

  const report = {
    timestamp: timestamp(),
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      passRate: results.length > 0 ? ((passed.length / results.length) * 100).toFixed(1) + '%' : 'N/A',
      exitCode,
    },
    knownBugs,
    failuresByCategory,
    failures: failed.map(f => ({
      title: f.title,
      error: f.error?.message,
      errorSnippet: f.error?.snippet,
      duration: f.duration,
    })),
    allResults: results.map(r => ({
      title: r.title,
      status: r.status,
      duration: r.duration,
    })),
  };

  return report;
}

function generateSummary(report) {
  const lines = [
    `Iron Gate Test Report — ${report.timestamp}`,
    '='.repeat(60),
    '',
    `Total: ${report.summary.total} | Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Skipped: ${report.summary.skipped}`,
    `Pass Rate: ${report.summary.passRate}`,
    '',
  ];

  // Known bugs
  const bugs = report.knownBugs;
  if (Object.values(bugs).some(Boolean)) {
    lines.push('KNOWN BUGS DETECTED:');
    if (bugs.ssnLeak) lines.push('  [P0] SSN leak — SSN numbers not pseudonymized on wire');
    if (bugs.accountLeak) lines.push('  [P0] Account number leak — bank account numbers pass through');
    if (bugs.matchError) lines.push('  [P0] TypeError: b.match — pseudonymization pipeline crash');
    if (bugs.injectionFailure) lines.push('  [P1] Injection failure — MAIN world script not loading');
    if (bugs.indexedDbFailure) lines.push('  [P2] IndexedDB failure — Recent Activity always empty');
    lines.push('');
  }

  // Failures by category
  if (Object.keys(report.failuresByCategory).length > 0) {
    lines.push('FAILURES BY CATEGORY:');
    for (const [cat, failures] of Object.entries(report.failuresByCategory)) {
      lines.push(`  ${cat} (${failures.length} failures):`);
      for (const f of failures) {
        lines.push(`    [${f.id}] ${f.title.split(']').pop().trim()}`);
        lines.push(`      Error: ${f.error.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  // Action items for Claude Code
  lines.push('ACTION ITEMS FOR AUTOMATED FIXING:');
  lines.push('  To fix these issues, examine:');
  if (bugs.ssnLeak || bugs.accountLeak) {
    lines.push('  1. src/detection/ — SSN and account number regex patterns');
    lines.push('     Files: src/detection/detectors/*.ts, src/detection/unified-pipeline.ts');
  }
  if (bugs.matchError) {
    lines.push('  2. src/content/main-world.ts — null check before .match() calls');
    lines.push('     Files: src/content/adapters/*.ts');
  }
  if (bugs.injectionFailure) {
    lines.push('  3. vite.config.ts inlineMainWorldPlugin — IIFE bundling');
    lines.push('     Files: vite.config.ts, src/content/index.ts');
  }
  if (bugs.indexedDbFailure) {
    lines.push('  4. IndexedDB access from MAIN world — use chrome.storage.local instead');
    lines.push('     Files: src/content/capture/activity-store.ts');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🛡️  Iron Gate Test Report Generator\n');

  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const specFile = process.argv[2];
  console.log(`Running: ${specFile || 'all e2e tests'}...`);

  const { code, stdout, stderr } = await runPlaywright(specFile);

  // Try to parse the JSON results
  const jsonPath = resolve(RESULTS_DIR, 'pw-results.json');
  let results = parseResults(jsonPath);

  if (!results || results.length === 0) {
    // Fallback: parse from stdout
    console.log('No JSON results found, generating from exit code');
    results = [{
      title: 'Full Suite',
      status: code === 0 ? 'passed' : 'failed',
      duration: 0,
      error: code !== 0 ? { message: stderr.slice(-1000) } : null,
    }];
  }

  const report = generateReport(results, code);
  const summary = generateSummary(report);

  // Write outputs
  writeFileSync(resolve(RESULTS_DIR, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(RESULTS_DIR, 'summary.txt'), summary);

  console.log('\n' + summary);
  console.log(`\nReport saved to: test-results/report.json`);
  console.log(`Summary saved to: test-results/summary.txt`);

  // List screenshots
  if (existsSync(SCREENSHOTS_DIR)) {
    const screenshots = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));
    if (screenshots.length > 0) {
      console.log(`Screenshots: ${screenshots.length} files in tests/e2e/screenshots/`);
    }
  }

  process.exit(code);
}

main().catch(err => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
