#!/usr/bin/env node
/**
 * Iron Gate CI Pipeline — build → mock server → test → report
 *
 * Single-command pipeline for local CI or Claude Code integration.
 * Runs everything sequentially, captures all output, and generates
 * a structured report that can be consumed by automated fixing tools.
 *
 * Usage:
 *   node scripts/run-pipeline.mjs                    # full pipeline
 *   node scripts/run-pipeline.mjs --spec wire        # only wire-verification tests
 *   node scripts/run-pipeline.mjs --spec comprehensive  # only comprehensive tests
 *   node scripts/run-pipeline.mjs --skip-build       # skip build step
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — test failures
 *   2 — build failure
 *   3 — infrastructure failure (mock server, playwright, etc.)
 */

import { spawn, execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MOCK_PORT = 9000;

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes('--skip-build');
const SPEC_FLAG = args.indexOf('--spec');
const SPEC_NAME = SPEC_FLAG >= 0 ? args[SPEC_FLAG + 1] : null;

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(emoji, msg) {
  console.log(`${emoji} \x1b[1m[${timestamp()}]\x1b[0m ${msg}`);
}

function runCommand(cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, {
      cwd: ROOT,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: true,
      ...options,
    });

    let stdout = '';
    let stderr = '';
    if (!options.inherit) {
      proc.stdout?.on('data', d => stdout += d.toString());
      proc.stderr?.on('data', d => stderr += d.toString());
    }

    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

async function isMockRunning() {
  try {
    const res = await fetch(`http://localhost:${MOCK_PORT}/api/intercepted`);
    return res.ok;
  } catch { return false; }
}

// ── Pipeline Steps ──────────────────────────────────────────────────────────

async function stepBuild() {
  if (SKIP_BUILD) {
    log('⏭️', 'Skipping build (--skip-build)');
    return true;
  }

  log('🔨', 'Step 1/4: Building extension...');
  const start = Date.now();
  const { code, stderr } = await runCommand('npx', ['vite', 'build']);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (code !== 0) {
    log('❌', `Build FAILED in ${elapsed}s`);
    console.error(stderr.slice(-2000));
    return false;
  }

  log('✅', `Build succeeded in ${elapsed}s`);
  return true;
}

async function stepMockServer() {
  log('🌐', 'Step 2/4: Starting mock server...');

  if (await isMockRunning()) {
    log('✅', 'Mock server already running');
    return { proc: null, started: true };
  }

  const proc = spawn('node', [resolve(ROOT, 'tests/mocked-platforms/server.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) console.error(`  [mock] ${line}`);
  });
  proc.unref();

  // Wait for readiness
  for (let i = 0; i < 30; i++) {
    if (await isMockRunning()) {
      log('✅', 'Mock server started');
      return { proc, started: true };
    }
    await new Promise(r => setTimeout(r, 500));
  }

  log('❌', 'Mock server failed to start');
  proc.kill();
  return { proc: null, started: false };
}

async function stepTests() {
  log('🧪', 'Step 3/4: Running e2e tests...');
  const start = Date.now();

  // Determine which spec file to run
  let specFile;
  if (SPEC_NAME === 'wire') {
    specFile = 'tests/e2e/wire-verification.spec.ts';
  } else if (SPEC_NAME === 'comprehensive') {
    specFile = 'tests/e2e/comprehensive-detection.spec.ts';
  } else if (SPEC_NAME === 'injection') {
    specFile = 'tests/e2e/injection.spec.ts';
  } else if (SPEC_NAME === 'sidepanel') {
    specFile = 'tests/e2e/sidepanel.spec.ts';
  } else if (SPEC_NAME) {
    specFile = SPEC_NAME;
  }

  mkdirSync(resolve(ROOT, 'tests/e2e/screenshots'), { recursive: true });

  const testArgs = ['playwright', 'test', '--reporter=list'];
  if (specFile) testArgs.push(specFile);

  const { code } = await runCommand('npx', testArgs, { inherit: true });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (code === 0) {
    log('✅', `All tests passed in ${elapsed}s`);
  } else {
    log('❌', `Tests FAILED (exit ${code}) in ${elapsed}s`);
  }

  return code;
}

async function stepReport() {
  log('📊', 'Step 4/4: Generating report...');

  const specArg = SPEC_NAME ? `tests/e2e/${SPEC_NAME === 'wire' ? 'wire-verification' : SPEC_NAME === 'comprehensive' ? 'comprehensive-detection' : SPEC_NAME}.spec.ts` : undefined;
  const { code } = await runCommand('node', [
    resolve(ROOT, 'scripts/test-report.mjs'),
    ...(specArg ? [specArg] : []),
  ], { inherit: true });

  return code;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m═══════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  🛡️  Iron Gate Automated Pipeline\x1b[0m');
  console.log('\x1b[1m═══════════════════════════════════════════════\x1b[0m\n');

  const pipelineStart = Date.now();

  // Step 1: Build
  const buildOk = await stepBuild();
  if (!buildOk) process.exit(2);

  // Step 2: Mock server
  const { proc: mockProc, started } = await stepMockServer();
  if (!started) process.exit(3);

  // Step 3: Run tests
  const testCode = await stepTests();

  // Step 4: Generate report
  // await stepReport();

  // Cleanup
  if (mockProc) {
    try { mockProc.kill(); } catch {}
  }

  const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log(`\n\x1b[1m═══════════════════════════════════════════════\x1b[0m`);
  console.log(`  Pipeline completed in ${totalElapsed}s — ${testCode === 0 ? '✅ ALL PASSED' : '❌ FAILURES'}`);
  console.log(`\x1b[1m═══════════════════════════════════════════════\x1b[0m\n`);

  process.exit(testCode === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Pipeline error:', err);
  process.exit(3);
});
