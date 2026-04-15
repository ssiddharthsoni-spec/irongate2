/**
 * drive.ts — interactive drive loop.
 *
 * Not a Playwright test: a standalone Node script I run in a loop while
 * finding and fixing bugs. Each invocation boots the extension, opens
 * the sidepanel, snapshots what's actually rendered, and prints what
 * console logs fired.
 *
 * Usage:
 *   node --import tsx tests/e2e/drive.ts [stage]
 *
 * Stages:
 *   stage1  — boot + sidepanel renders at all
 *   stage2  — stage1 + deployment badge reflects real state
 *   stage3  — stage2 + open mocked ChatGPT, send benign prompt, see activity
 *   stage4  — stage3 + send PII prompt, verify pseudonymization on wire
 *   stage5  — full flow: all 5 canonical scenarios
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const PROFILE_DIR = path.resolve(__dirname, '../../.drive-profile');
const MOCK_BASE = 'http://localhost:9000';

async function bootExtension(): Promise<{ ctx: BrowserContext; extensionId: string; workerLogs: string[] }> {
  if (existsSync(PROFILE_DIR)) rmSync(PROFILE_DIR, { recursive: true, force: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  // Find service worker + extension id (retry loop — MV3 workers register async)
  let extensionId = '';
  for (let i = 0; i < 20; i++) {
    const workers = ctx.serviceWorkers();
    if (workers.length > 0) {
      const match = workers[0].url().match(/chrome-extension:\/\/([a-z]+)\//);
      if (match) { extensionId = match[1]; break; }
    }
    await ctx.pages()[0].waitForTimeout(500);
  }
  if (!extensionId) throw new Error('No service worker — extension failed to load');

  // Collect worker console
  const workerLogs: string[] = [];
  for (const sw of ctx.serviceWorkers()) {
    sw.on('console', (msg) => {
      const t = msg.text();
      workerLogs.push(`[${msg.type()}] ${t}`);
    });
    sw.on('pageerror', (err) => workerLogs.push(`[ERROR] ${err.message}\n${err.stack ?? ''}`));
  }

  return { ctx, extensionId, workerLogs };
}

async function snapshotSidepanel(ctx: BrowserContext, extensionId: string): Promise<{
  page: Page;
  pageLogs: string[];
  bodyText: string;
  deploymentBadge: string;
  upgradeButtonText: string;
}> {
  const page = await ctx.newPage();
  const pageLogs: string[] = [];
  page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => pageLogs.push(`[PAGEERROR] ${e.message}\n${e.stack ?? ''}`));

  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3000); // let React mount + badge poll

  const bodyText = await page.evaluate(() => document.body.innerText);
  // Deployment badge: find the first element whose text matches known states
  const deploymentBadge = await page.evaluate(() => {
    const states = [
      'Sovereign mode active',
      'Local LLM unreachable',
      'Hybrid mode',
      'Cloud classification',
      'Deployment error',
      'Initializing',
    ];
    for (const s of states) {
      if (document.body.innerText.includes(s)) return s;
    }
    return '(no badge found)';
  });
  const upgradeButtonText = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const m = buttons.find((b) => (b.textContent || '').includes('Upgrade'));
    return m ? (m.textContent || '').trim() : '(no upgrade button)';
  });

  return { page, pageLogs, bodyText, deploymentBadge, upgradeButtonText };
}

async function stage1(): Promise<void> {
  console.log('\n════ STAGE 1: extension boots + sidepanel renders ════');
  const { ctx, extensionId, workerLogs } = await bootExtension();
  console.log(`✓ Extension loaded: ${extensionId}`);

  try {
    const snap = await snapshotSidepanel(ctx, extensionId);
    const header = snap.bodyText.slice(0, 200).replace(/\s+/g, ' ');
    console.log(`✓ Sidepanel rendered. First 200 chars: "${header}"`);
    console.log(`  Deployment badge state: ${snap.deploymentBadge}`);
    console.log(`  Upgrade button: ${snap.upgradeButtonText}`);

    const pageErrors = snap.pageLogs.filter((l) => l.startsWith('[PAGEERROR]') || l.startsWith('[error]'));
    if (pageErrors.length > 0) {
      console.log(`✗ Sidepanel page errors (${pageErrors.length}):`);
      for (const e of pageErrors.slice(0, 5)) console.log(`    ${e.slice(0, 300)}`);
    } else {
      console.log('✓ No sidepanel console errors');
    }

    const workerErrors = workerLogs.filter((l) => l.startsWith('[ERROR]') || l.startsWith('[error]'));
    if (workerErrors.length > 0) {
      console.log(`✗ Worker errors (${workerErrors.length}):`);
      for (const e of workerErrors.slice(0, 5)) console.log(`    ${e.slice(0, 300)}`);
    } else {
      console.log('✓ No worker errors');
    }

    const relevantWorker = workerLogs
      .filter((l) => /iron gate|classif|pseudo|deployment|warm/i.test(l))
      .slice(0, 20);
    if (relevantWorker.length > 0) {
      console.log('  Notable worker logs:');
      for (const l of relevantWorker) console.log(`    ${l.slice(0, 200)}`);
    }
  } finally {
    await ctx.close();
  }
}

async function bypassOnboarding(ctx: BrowserContext, extensionId: string): Promise<void> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(
        {
          firmMode: 'proxy',
          onboarding_completed: true,
          user_email: 'self-test@example.com',
          firm_id: 'self-test-firm',
          firm_name: 'Self Test Firm',
          firm_code: 'SELFTEST',
          selected_industries: ['legal'],
          apiBaseUrl: 'https://irongate-api.onrender.com/v1',
          subscription_tier: 'basic',
          connectionState: { connected: true, firmId: 'self-test-firm', firmName: 'Self Test Firm' },
        },
        () => resolve(),
      );
    });
  });
  await page.close();
}

async function stage2(): Promise<void> {
  console.log('\n════ STAGE 2: post-onboarding state — deployment badge + trial banner ════');
  const { ctx, extensionId, workerLogs } = await bootExtension();
  console.log(`✓ Extension loaded: ${extensionId}`);
  await bypassOnboarding(ctx, extensionId);
  console.log('✓ Onboarding bypassed (storage set directly)');

  try {
    const snap = await snapshotSidepanel(ctx, extensionId);
    console.log(`  Deployment badge: ${snap.deploymentBadge}`);
    console.log(`  Upgrade button  : ${snap.upgradeButtonText}`);

    // The three things the user reported as broken:
    const showsCloud = snap.bodyText.includes('Cloud classification');
    const showsSovereign = snap.bodyText.includes('Sovereign mode active') || snap.bodyText.includes('Local LLM unreachable');
    const showsTrialEnded = snap.bodyText.includes('Trial ended');

    console.log('\n  Checks:');
    console.log(`    Shows "Cloud classification" (BAD on first paint): ${showsCloud ? '✗' : '✓'}`);
    console.log(`    Shows Sovereign/Local-LLM badge (GOOD)           : ${showsSovereign ? '✓' : '✗'}`);
    console.log(`    Shows "Trial ended" on fresh install (BAD)       : ${showsTrialEnded ? '✗' : '✓'}`);

    const errors = [...snap.pageLogs, ...workerLogs].filter((l) => l.toLowerCase().includes('error'));
    if (errors.length > 0) {
      console.log(`\n  Errors (${errors.length}):`);
      for (const e of errors.slice(0, 5)) console.log(`    ${e.slice(0, 250)}`);
    }

    const allPassed = !showsCloud && !showsTrialEnded;
    console.log(allPassed ? '\n✓ STAGE 2 PASSED' : '\n✗ STAGE 2 FAILED');
    if (!allPassed) process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

import { spawn, type ChildProcess } from 'node:child_process';

function bootMockServer(): ChildProcess {
  const proc = spawn('node', [path.resolve(__dirname, '../mocked-platforms/server.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Swallow stdout so it doesn't pollute test output
  proc.stdout?.on('data', () => {});
  proc.stderr?.on('data', (d) => console.error('[mock-server stderr]', d.toString().trim()));
  return proc;
}

async function waitForMock(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${MOCK_BASE}/api/intercepted`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Mock server failed to start in 15s');
}

async function typeAndSubmitOnChatGPT(page: Page, text: string): Promise<void> {
  // Wait for the input to be present
  await page.waitForSelector('#prompt-textarea', { timeout: 10_000 });
  await page.click('#prompt-textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForTimeout(500);
  await page.click('button[data-testid="send-button"]');
}

async function stage3(): Promise<void> {
  console.log('\n════ STAGE 3: send a benign prompt on mocked ChatGPT ════');
  const mockProc = bootMockServer();
  await waitForMock();
  console.log('✓ Mock server running');

  const { ctx, extensionId, workerLogs } = await bootExtension();
  console.log(`✓ Extension loaded: ${extensionId}`);
  await bypassOnboarding(ctx, extensionId);
  console.log('✓ Onboarding bypassed');

  try {
    // Clear intercept log
    await fetch(`${MOCK_BASE}/api/intercepted/clear`);

    const page = await ctx.newPage();
    const pageLogs: string[] = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[PAGEERROR] ${e.message}`));

    await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(3000);

    const injected = await page.evaluate(() => (window as any).__IRON_GATE_MAIN_WORLD);
    console.log(`  IronGate injection status: ${injected || '(no injection)'}`);

    const benign = 'Explain how photosynthesis works in simple terms.';
    console.log(`  Typing: "${benign}"`);
    await typeAndSubmitOnChatGPT(page, benign);
    await page.waitForTimeout(4000);

    const intercepted = await fetch(`${MOCK_BASE}/api/intercepted`).then((r) => r.json());
    console.log(`  Intercepted requests: ${intercepted.length}`);
    for (const r of intercepted.slice(0, 3)) {
      const body = r.payload?.body ?? r.payload?.query ?? JSON.stringify(r.payload).slice(0, 150);
      console.log(`    [${r.platform}] ${String(body).slice(0, 150)}`);
    }

    const relevantWorker = workerLogs.filter((l) => /iron|pseudo|classif|PROMPT|SENSITIVITY/i.test(l)).slice(0, 15);
    if (relevantWorker.length > 0) {
      console.log('  Worker logs:');
      for (const l of relevantWorker) console.log(`    ${l.slice(0, 200)}`);
    }

    const benignReachedWire = intercepted.some((r: any) =>
      (r.payload?.body || '').includes('photosynthesis'),
    );
    console.log(benignReachedWire ? '\n✓ Benign prompt reached mock (expected)' : '\n✗ Benign prompt did NOT reach mock');
    if (!benignReachedWire) process.exitCode = 1;

    await page.close();
  } finally {
    await ctx.close();
    mockProc.kill();
  }
}

async function stageSignIn(): Promise<void> {
  console.log('\n════ STAGE SIGN-IN: walk through the real onboarding flow ════');
  const { ctx, extensionId, workerLogs } = await bootExtension();
  console.log(`✓ Extension loaded: ${extensionId}`);

  // Give the worker a moment to run full startup + warmup. If anything blows
  // up during init, the error should appear here, before we touch any UI.
  await new Promise((r) => setTimeout(r, 5000));
  const startupErrors = workerLogs.filter((l) => /error|exception|unhandled|reject|typeerror|referenceerror/i.test(l));
  if (startupErrors.length > 0) {
    console.log('\n✗ WORKER STARTUP ERRORS:');
    for (const e of startupErrors.slice(0, 10)) console.log(`    ${e.slice(0, 400)}`);
  } else {
    console.log('✓ Worker startup clean (no errors in first 5 s)');
  }
  const startupNotable = workerLogs.filter((l) => /\[Iron Gate\]|warmup|classif|deployment|pseudonymizer/i.test(l));
  if (startupNotable.length > 0) {
    console.log('  Worker startup logs:');
    for (const l of startupNotable.slice(0, 10)) console.log(`    ${l.slice(0, 250)}`);
  }

  try {
    const page = await ctx.newPage();
    const pageLogs: string[] = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[PAGEERROR] ${e.message}`));

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);

    // ── Step 1: industries ───────────────────────────────────────────────
    console.log('  Step 1: select Legal industry');
    const legalBtn = page.getByRole('button', { name: /Legal/i }).first();
    await legalBtn.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page.waitForTimeout(800);

    // ── Step 2: demo animation → Continue ────────────────────────────────
    console.log('  Step 2: skip demo animation');
    const continueBtns1 = await page.getByRole('button', { name: /^Continue$/i }).all();
    if (continueBtns1.length > 0) await continueBtns1[continueBtns1.length - 1].click();
    await page.waitForTimeout(800);

    // ── Step 3: select Proxy mode → Continue ─────────────────────────────
    // Proxy mode is the one that actually pseudonymizes. Audit only logs.
    // We're testing the real protection path.
    console.log('  Step 3: select Proxy Mode');
    await page.getByRole('button', { name: /Proxy Mode/i }).click();
    await page.waitForTimeout(300);
    const continueBtns2 = await page.getByRole('button', { name: /^Continue$/i }).all();
    if (continueBtns2.length > 0) await continueBtns2[continueBtns2.length - 1].click();
    await page.waitForTimeout(800);

    // ── Step 4: enter email, click register ──────────────────────────────
    console.log('  Step 4: enter email, click Start Trial');
    const email = `selftest+${Date.now()}@example.com`;
    await page.fill('input[type="email"]', email);
    await page.waitForTimeout(500);

    // Button text varies — "Start Free Trial", "Start Trial", "Create Account"
    const registerBtn = page.locator('button').filter({ hasText: /Start.*Trial|Create Account|Sign.*up|Register/i }).first();
    const hasRegister = await registerBtn.count() > 0;
    if (!hasRegister) {
      console.log('  ✗ Register button not found. Available buttons:');
      const allButtons = await page.locator('button').allTextContents();
      for (const b of allButtons) console.log(`    "${b.trim()}"`);
      process.exitCode = 1;
      await page.close();
      return;
    }

    console.log(`  Clicking register with email: ${email}`);
    await registerBtn.click();
    await page.waitForTimeout(8000); // API call to Render (cold-start tolerant)

    // ── Check state after register ───────────────────────────────────────
    const bodyText = await page.evaluate(() => document.body.innerText);
    const stillOnStep4 = bodyText.includes('Work email');
    const errorBanner = await page.evaluate(() => {
      const el = document.querySelector('[role="alert"]');
      return el?.textContent?.trim() || null;
    });
    const onSuccessStep = bodyText.includes("You're all set") ||
      bodyText.includes('Get Started') ||
      bodyText.includes('Welcome') ||
      bodyText.includes('Complete');

    console.log('');
    if (errorBanner) {
      console.log(`  ✗ Onboarding error: "${errorBanner}"`);
    }
    if (stillOnStep4 && !errorBanner) {
      console.log('  ✗ Still on Step 4 (email form) after 8s — API call may have silently hung or not fired');
    }
    if (onSuccessStep) {
      console.log('  ✓ Onboarding advanced past registration');
    }

    const storage = await page.evaluate(() => {
      return new Promise<any>((resolve) => {
        chrome.storage.local.get(null, (items) => resolve(items));
      });
    });
    const keys = Object.keys(storage);
    console.log(`  chrome.storage.local keys: ${keys.join(', ')}`);
    if (storage.firm_id) console.log(`    firm_id = ${storage.firm_id}`);
    if (storage.firm_name) console.log(`    firm_name = ${storage.firm_name}`);
    if (storage.subscription_tier) console.log(`    subscription_tier = ${storage.subscription_tier}`);
    if (storage.trial_ends_at) console.log(`    trial_ends_at = ${storage.trial_ends_at}`);
    if (storage.firmMode) console.log(`    firmMode = ${storage.firmMode}`);

    const fetchErrors = pageLogs.filter((l) => /fetch|network|Failed to fetch|cors/i.test(l));
    if (fetchErrors.length > 0) {
      console.log('\n  Network-related logs:');
      for (const l of fetchErrors.slice(0, 6)) console.log(`    ${l.slice(0, 250)}`);
    }

    const errors = pageLogs.filter((l) => l.startsWith('[PAGEERROR]') || l.startsWith('[error]'));
    if (errors.length > 0) {
      console.log('\n  Page errors:');
      for (const e of errors.slice(0, 5)) console.log(`    ${e.slice(0, 300)}`);
    }

    const ok = !errorBanner && (onSuccessStep || !!storage.firm_id);
    console.log(ok ? '\n✓ SIGN-IN FLOW PASSED' : '\n✗ SIGN-IN FLOW FAILED');
    if (!ok) process.exitCode = 1;

    await page.close();
  } finally {
    await ctx.close();
  }
}

// ── Full end-to-end drive ────────────────────────────────────────────────────
// Signs in → opens mocked ChatGPT → types each canonical scenario → verifies
// pseudonymization on the wire + sidepanel activity reflects it. Iterates
// through every scenario and reports per-row pass/fail.

interface DriveScenario {
  id: string;
  prompt: string;
  expect: 'pass-through' | 'pseudonymize';
  forbiddenOnWire: string[]; // if pseudonymize, these strings must NOT appear
}

const FULL_SCENARIOS: DriveScenario[] = [
  {
    id: 'RESEARCH',
    prompt: "What were Steve Jobs' leadership principles at Apple?",
    expect: 'pass-through',
    forbiddenOnWire: [],
  },
  {
    id: 'BENIGN',
    prompt: 'Explain how photosynthesis works in simple terms.',
    expect: 'pass-through',
    forbiddenOnWire: [],
  },
  {
    id: 'LEGAL-PII',
    prompt: 'Draft a settlement letter for my client Robert Johnson, SSN 423-55-8901.',
    expect: 'pseudonymize',
    forbiddenOnWire: ['Robert Johnson', '423-55-8901'],
  },
  {
    id: 'CREDENTIAL',
    prompt: 'Debug: Authorization: Bearer sk-proj-RealLookingKeyAbc123Xyz789De45',
    expect: 'pseudonymize',
    forbiddenOnWire: ['sk-proj-RealLookingKeyAbc123Xyz789De45'],
  },
];

async function signInViaUI(ctx: BrowserContext, extensionId: string): Promise<{
  email: string;
  firmId: string;
}> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: /Legal/i }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.waitForTimeout(800);
  const c1 = await page.getByRole('button', { name: /^Continue$/i }).all();
  if (c1.length > 0) await c1[c1.length - 1].click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Proxy Mode/i }).click();
  await page.waitForTimeout(300);
  const c2 = await page.getByRole('button', { name: /^Continue$/i }).all();
  if (c2.length > 0) await c2[c2.length - 1].click();
  await page.waitForTimeout(800);
  const email = `driver+${Date.now()}@example.com`;
  await page.fill('input[type="email"]', email);
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /Start.*Trial|Create Account|Register/i }).first().click();
  await page.waitForTimeout(8000);

  const storage = await page.evaluate(() => new Promise<any>((resolve) => {
    chrome.storage.local.get(['firm_id', 'firmMode'], resolve);
  }));
  await page.close();
  return { email, firmId: storage.firm_id };
}

async function stageFull(): Promise<void> {
  console.log('\n═══════════ FULL END-TO-END DRIVE ═══════════');

  const mockProc = bootMockServer();
  await waitForMock();
  console.log('✓ mock server up');

  const { ctx, extensionId, workerLogs } = await bootExtension();
  console.log(`✓ extension loaded (${extensionId})`);

  await new Promise((r) => setTimeout(r, 3000));
  const startupErrors = workerLogs.filter((l) => /error|exception|unhandled|reject|typeerror/i.test(l));
  if (startupErrors.length > 0) {
    console.log('\n✗ WORKER STARTUP ERRORS:');
    for (const e of startupErrors.slice(0, 5)) console.log(`    ${e.slice(0, 400)}`);
  } else {
    console.log('✓ worker startup clean');
  }

  try {
    console.log('\n── sign in ──────────────────────────────────');
    const { email, firmId } = await signInViaUI(ctx, extensionId);
    if (!firmId) {
      console.log(`✗ sign-in failed — no firm_id persisted. Email tried: ${email}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ signed in (${email}) → firm_id=${firmId}`);

    // Some worker handshakes take a beat after registration
    await new Promise((r) => setTimeout(r, 2000));

    const results: Array<{
      id: string;
      expected: string;
      intercepted: number;
      leaked: string[];
      passThrough: boolean;
      passed: boolean;
      notes: string;
    }> = [];

    for (const sc of FULL_SCENARIOS) {
      console.log(`\n── scenario ${sc.id} ──────────────────────────────`);
      await fetch(`${MOCK_BASE}/api/intercepted/clear`);

      const page = await ctx.newPage();
      const pageLogs: string[] = [];
      page.on('console', (m) => {
        const t = m.text();
        if (/iron|pseudo|classif|error|PROMPT_/i.test(t)) pageLogs.push(`[${m.type()}] ${t}`);
      });
      page.on('pageerror', (e) => pageLogs.push(`[PAGEERROR] ${e.message}`));

      try {
        await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(2500);

        const injected = await page.evaluate(() => (window as any).__IRON_GATE_MAIN_WORLD);
        console.log(`  injection: ${injected || '(none)'}`);

        await typeAndSubmitOnChatGPT(page, sc.prompt);
        await page.waitForTimeout(5000);

        const intercepted = await fetch(`${MOCK_BASE}/api/intercepted`).then((r) => r.json());
        const chatgpt = intercepted.filter((r: any) => r.platform === 'chatgpt');
        const combined = chatgpt.map((r: any) => r.payload?.body || '').join('\n');

        const leaked = sc.forbiddenOnWire.filter((f) => combined.includes(f));
        const passThrough = combined.includes(sc.prompt.slice(0, 40));

        let passed = false;
        let notes = '';
        if (sc.expect === 'pass-through') {
          passed = passThrough;
          notes = passed ? 'benign prompt reached wire unchanged (correct)' : 'benign prompt did NOT reach wire';
        } else {
          passed = leaked.length === 0 && combined.length > 0;
          notes = passed
            ? `all ${sc.forbiddenOnWire.length} PII strings pseudonymized`
            : `LEAK: ${leaked.join(', ')}`;
        }

        console.log(`  intercepted: ${chatgpt.length} request(s), ${combined.length} bytes`);
        console.log(`  wire snippet: "${combined.slice(0, 120)}${combined.length > 120 ? '…' : ''}"`);
        console.log(`  ${passed ? '✓' : '✗'} ${notes}`);

        const keyLogs = pageLogs.filter((l) => /pseudonymized|classif|PROMPT_DETECTED|transform/i.test(l)).slice(0, 4);
        if (keyLogs.length > 0) {
          for (const l of keyLogs) console.log(`    ${l.slice(0, 200)}`);
        }

        results.push({ id: sc.id, expected: sc.expect, intercepted: chatgpt.length, leaked, passThrough, passed, notes });
      } catch (err) {
        console.log(`  ✗ scenario error: ${err instanceof Error ? err.message : String(err)}`);
        results.push({ id: sc.id, expected: sc.expect, intercepted: 0, leaked: [], passThrough: false, passed: false, notes: String(err) });
      }
      await page.close();
    }

    console.log('\n══════════ RESULTS ══════════');
    const passed = results.filter((r) => r.passed).length;
    for (const r of results) console.log(`  ${r.passed ? '✓' : '✗'} ${r.id.padEnd(12)} ${r.notes}`);
    console.log(`\n  ${passed}/${results.length} scenarios passed`);

    if (passed < results.length) process.exitCode = 1;
  } finally {
    await ctx.close();
    mockProc.kill();
  }
}

const stage = process.argv[2] || 'stage1';
(async () => {
  if (stage === 'stage1') await stage1();
  else if (stage === 'stage2') await stage2();
  else if (stage === 'stage3') await stage3();
  else if (stage === 'signin') await stageSignIn();
  else if (stage === 'full') await stageFull();
  else {
    console.error(`Unknown stage: ${stage}`);
    process.exit(2);
  }
})().catch((e) => {
  console.error('\n═══ DRIVE FAILED ═══');
  console.error(e);
  process.exit(1);
});
