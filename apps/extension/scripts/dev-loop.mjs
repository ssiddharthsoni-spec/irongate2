#!/usr/bin/env node
/**
 * Iron Gate Dev Loop — auto-build + Chrome extension reload + test runner
 *
 * Watches for source file changes, rebuilds the extension via Vite,
 * reloads the Chrome extension via the Chrome DevTools Protocol (CDP),
 * then optionally runs the e2e test suite.
 *
 * Usage:
 *   node scripts/dev-loop.mjs              # watch + rebuild + reload
 *   node scripts/dev-loop.mjs --test       # watch + rebuild + reload + run tests
 *   node scripts/dev-loop.mjs --test-only  # just run tests once (no watch)
 *   node scripts/dev-loop.mjs --build-only # just build once (no watch)
 *
 * Requirements:
 *   - Chrome running with --remote-debugging-port=9222
 *   - Extension loaded from ./dist
 *   - Mock server running on port 9000 (for tests)
 */

import { spawn, execSync } from 'child_process';
import { watch } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const SRC = resolve(ROOT, 'src');

const CDP_PORT = 9222;
const MOCK_PORT = 9000;

const args = process.argv.slice(2);
const TEST_AFTER_BUILD = args.includes('--test');
const TEST_ONLY = args.includes('--test-only');
const BUILD_ONLY = args.includes('--build-only');

// ── Helpers ─────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(msg) {
  console.log(`\x1b[36m[${timestamp()}]\x1b[0m ${msg}`);
}

function logError(msg) {
  console.error(`\x1b[31m[${timestamp()}] ERROR:\x1b[0m ${msg}`);
}

function logSuccess(msg) {
  console.log(`\x1b[32m[${timestamp()}] ✓\x1b[0m ${msg}`);
}

// ── Chrome DevTools Protocol: reload extension ──────────────────────────────

async function cdpRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function reloadExtension() {
  try {
    const targets = await cdpRequest('/json');
    // Find the extension service worker or background page
    const extTarget = targets.find(t =>
      t.url?.includes('chrome-extension://') &&
      (t.type === 'service_worker' || t.type === 'background_page')
    );

    if (extTarget) {
      // Reload via navigating to chrome://extensions and triggering reload
      // This is the most reliable approach for MV3 extensions
      const pages = targets.filter(t => t.type === 'page');
      for (const page of pages) {
        if (page.url?.includes('chrome-extension://')) {
          // Send reload command to extension pages
          const wsUrl = page.webSocketDebuggerUrl;
          if (wsUrl) {
            const ws = await import('ws');
            const socket = new ws.default(wsUrl);
            await new Promise((resolve, reject) => {
              socket.on('open', () => {
                socket.send(JSON.stringify({
                  id: 1,
                  method: 'Runtime.evaluate',
                  params: { expression: 'chrome.runtime.reload()' },
                }));
                setTimeout(() => { socket.close(); resolve(); }, 1000);
              });
              socket.on('error', reject);
            });
          }
        }
      }
      logSuccess('Extension reload triggered via CDP');
      return true;
    }

    // Fallback: find any extension page and call chrome.runtime.reload()
    const extPage = targets.find(t => t.url?.includes('chrome-extension://'));
    if (extPage?.webSocketDebuggerUrl) {
      const ws = await import('ws');
      const socket = new ws.default(extPage.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.on('open', () => {
          socket.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: 'chrome.runtime.reload()' },
          }));
          setTimeout(() => { socket.close(); resolve(); }, 1000);
        });
        socket.on('error', reject);
      });
      logSuccess('Extension reload triggered (fallback)');
      return true;
    }

    log('No extension target found via CDP — reload Chrome manually');
    return false;
  } catch (err) {
    log(`CDP not available (${err.message}) — reload Chrome manually or start with --remote-debugging-port=${CDP_PORT}`);
    return false;
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

function build() {
  return new Promise((resolve, reject) => {
    log('Building extension...');
    const start = Date.now();

    const proc = spawn('npx', ['vite', 'build'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        logSuccess(`Build completed in ${elapsed}s`);
        resolve(true);
      } else {
        logError(`Build failed (${elapsed}s):\n${stderr || stdout}`);
        reject(new Error('Build failed'));
      }
    });
  });
}

// ── Test Runner ─────────────────────────────────────────────────────────────

function runTests(specFile) {
  return new Promise((resolve) => {
    log(`Running tests: ${specFile || 'all e2e'}...`);
    const start = Date.now();

    const testArgs = ['playwright', 'test'];
    if (specFile) testArgs.push(specFile);
    testArgs.push('--reporter=list');

    const proc = spawn('npx', testArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', code => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        logSuccess(`Tests passed in ${elapsed}s`);
      } else {
        logError(`Tests failed (exit ${code}) in ${elapsed}s`);
      }
      resolve(code);
    });
  });
}

// ── Mock Server Management ──────────────────────────────────────────────────

async function isMockServerRunning() {
  try {
    const res = await fetch(`http://localhost:${MOCK_PORT}/api/intercepted`);
    return res.ok;
  } catch { return false; }
}

function startMockServer() {
  log('Starting mock platform server...');
  const proc = spawn('node', [resolve(ROOT, 'tests/mocked-platforms/server.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line) log(`[mock] ${line}`);
  });
  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) logError(`[mock] ${line}`);
  });
  proc.unref();
  return proc;
}

// ── File Watcher ────────────────────────────────────────────────────────────

function watchSource(onChange) {
  let debounce = null;
  const DEBOUNCE_MS = 500;

  const dirs = [SRC, resolve(ROOT, 'manifest.json')];

  log(`Watching ${SRC} for changes...`);

  // Use recursive watch on the src directory
  const watcher = watch(SRC, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (filename.includes('node_modules') || filename.includes('.git')) return;
    if (filename.endsWith('.map')) return;

    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      log(`Changed: ${filename}`);
      onChange();
    }, DEBOUNCE_MS);
  });

  return watcher;
}

// ── Main Loop ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m🛡️  Iron Gate Dev Loop\x1b[0m\n');

  // ── Test-only mode ────────────────────────────────────────────────────
  if (TEST_ONLY) {
    const mockRunning = await isMockServerRunning();
    if (!mockRunning) {
      startMockServer();
      // Wait for mock server to start
      for (let i = 0; i < 20; i++) {
        if (await isMockServerRunning()) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    const code = await runTests(args.find(a => a.endsWith('.spec.ts')));
    process.exit(code);
  }

  // ── Build-only mode ───────────────────────────────────────────────────
  if (BUILD_ONLY) {
    try {
      await build();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }

  // ── Watch mode ────────────────────────────────────────────────────────
  let building = false;
  let mockProc = null;

  // Start mock server if tests are enabled
  if (TEST_AFTER_BUILD) {
    const mockRunning = await isMockServerRunning();
    if (!mockRunning) {
      mockProc = startMockServer();
      for (let i = 0; i < 20; i++) {
        if (await isMockServerRunning()) break;
        await new Promise(r => setTimeout(r, 500));
      }
      logSuccess('Mock server ready');
    } else {
      logSuccess('Mock server already running');
    }
  }

  // Initial build
  try {
    await build();
    await reloadExtension();
    if (TEST_AFTER_BUILD) {
      await runTests('tests/e2e/comprehensive-detection.spec.ts');
    }
  } catch (err) {
    logError(err.message);
  }

  // Watch for changes
  watchSource(async () => {
    if (building) return;
    building = true;

    try {
      await build();
      await reloadExtension();
      if (TEST_AFTER_BUILD) {
        await runTests('tests/e2e/comprehensive-detection.spec.ts');
      }
    } catch (err) {
      logError(err.message);
    } finally {
      building = false;
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down...');
    if (mockProc) mockProc.kill();
    process.exit(0);
  });

  log('Watching for changes... (Ctrl+C to stop)');
  if (TEST_AFTER_BUILD) {
    log('Tests will run after each successful build');
  }
}

main().catch(err => {
  logError(err.message);
  process.exit(1);
});
