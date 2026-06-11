#!/usr/bin/env node
/**
 * Iron Gate Full Drive — proper onboarding + 31 scenario test suite
 *
 * Unlike the Playwright spec tests, this script:
 *   1. Boots Chrome with the extension loaded
 *   2. Completes real onboarding (industry → demo → proxy mode → register)
 *   3. Waits for the service worker to fully initialize
 *   4. Runs each scenario on the mock ChatGPT with proper wire verification
 *   5. Prints a full pass/fail report with PII leak details
 *
 * Prerequisites:
 *   - Extension built (pnpm build)
 *   - Mock server running on port 9000 (node tests/mocked-platforms/server.mjs)
 *
 * Usage:
 *   node scripts/full-drive.mjs              # run all scenarios
 *   node scripts/full-drive.mjs --quick      # run 8 key scenarios only
 *   node scripts/full-drive.mjs --category FIN  # run only financial tests
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../dist');
const PROFILE_DIR = path.resolve(__dirname, '../.drive-profile');
const MOCK_BASE = 'http://localhost:9000';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../test-results/screenshots');
const RESULTS_DIR = path.resolve(__dirname, '../test-results');

const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const CATEGORY_FLAG = args.indexOf('--category');
const CATEGORY_FILTER = CATEGORY_FLAG >= 0 ? args[CATEGORY_FLAG + 1] : null;

// ── Scenario Definitions ────────────────────────────────────────────────────

const ALL_SCENARIOS = [
  // Personal Identifiers
  { id: 'PII-01', cat: 'PII', prompt: 'Write an email from John Smith (john.smith@acme.com) to Sarah Johnson about Q4 budget.', expect: 'pseudonymize', forbidden: ['John Smith', 'john.smith@acme.com', 'Sarah Johnson'], key: true },
  { id: 'PII-02', cat: 'PII', prompt: 'Customer record: James Wilson, SSN 423-86-1957, needs account update.', expect: 'pseudonymize', forbidden: ['James Wilson', '423-86-1957'], key: true },
  { id: 'PII-03', cat: 'PII', prompt: 'Ship to: Maria Garcia, 742 Evergreen Terrace, Springfield IL 62704, phone (312) 555-0198.', expect: 'pseudonymize', forbidden: ['Maria Garcia', '(312) 555-0198'] },
  { id: 'PII-04', cat: 'PII', prompt: 'Patient intake: Robert Chen, DOB 03/15/1985, allergic to penicillin.', expect: 'pseudonymize', forbidden: ['Robert Chen', '03/15/1985'] },

  // Financial
  { id: 'FIN-01', cat: 'FIN', prompt: 'Process payment for order #9921: Visa 4532-8921-0076-3344, exp 12/26, CVV 891.', expect: 'pseudonymize', forbidden: ['4532-8921-0076-3344'], key: true },
  { id: 'FIN-02', cat: 'FIN', prompt: 'Wire transfer: routing 021000021, account 1234567890, beneficiary Lisa Park.', expect: 'pseudonymize', forbidden: ['021000021', '1234567890', 'Lisa Park'], key: true },
  { id: 'FIN-03', cat: 'FIN', prompt: 'Send payment to IBAN GB29 NWBK 6016 1331 9268 19, holder name Andrea Müller.', expect: 'pseudonymize', forbidden: ['GB29 NWBK 6016 1331 9268 19'] },

  // Medical / HIPAA
  { id: 'MED-01', cat: 'MED', prompt: 'Patient MRN 2024-88341, Patricia Chen, diagnosed with type 2 diabetes, prescribed metformin 500mg.', expect: 'pseudonymize', forbidden: ['2024-88341', 'Patricia Chen'] },
  { id: 'MED-02', cat: 'MED', prompt: 'Insurance: BlueCross policy HIC-9988-2244, member David Park, group #GRP-551, copay $30.', expect: 'pseudonymize', forbidden: ['HIC-9988-2244', 'David Park'] },
  { id: 'MED-03', cat: 'MED', prompt: 'Lab results for Emma Watson (DOB: 11/22/1990): A1C 7.2%, fasting glucose 142 mg/dL.', expect: 'pseudonymize', forbidden: ['11/22/1990'] },

  // Credentials
  { id: 'CRED-01', cat: 'CRED', prompt: 'Debug S3 upload: AWS key AKIAIOSFODNN7EXAMPLE, secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.', expect: 'pseudonymize', forbidden: ['AKIAIOSFODNN7EXAMPLE'], key: true },
  { id: 'CRED-02', cat: 'CRED', prompt: 'Why is this failing? API key: sk-proj-RealLookingKeyAbc123Xyz789De45.', expect: 'pseudonymize', forbidden: ['sk-proj-RealLookingKeyAbc123Xyz789De45'] },
  { id: 'CRED-03', cat: 'CRED', prompt: 'Connect to: postgresql://admin:SuperSecret123!@db.example.com:5432/production.', expect: 'pseudonymize', forbidden: ['SuperSecret123!'] },
  { id: 'CRED-04', cat: 'CRED', prompt: 'Decode this JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U.', expect: 'pseudonymize', forbidden: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'] },
  { id: 'CRED-05', cat: 'CRED', prompt: 'My SSH key: -----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA1234... -----END RSA PRIVATE KEY-----.', expect: 'pseudonymize', forbidden: ['BEGIN RSA PRIVATE KEY'] },

  // International IDs
  { id: 'INTL-01', cat: 'INTL', prompt: 'Employee: James Mitchell, NI number AB 12 34 56 C, start date 2024-01-15.', expect: 'pseudonymize', forbidden: ['James Mitchell', 'AB 12 34 56 C'] },
  { id: 'INTL-02', cat: 'INTL', prompt: 'Applicant: Marie Dubois, SIN 046-454-286, requesting mortgage pre-approval.', expect: 'pseudonymize', forbidden: ['Marie Dubois', '046-454-286'] },
  { id: 'INTL-03', cat: 'INTL', prompt: 'Traveler: Yuki Tanaka, passport JP-TK8823991, visa expires 2025-03-15.', expect: 'pseudonymize', forbidden: ['Yuki Tanaka'] },

  // Organization
  { id: 'ORG-01', cat: 'ORG', prompt: 'Confidential: Acme Corp acquiring Meridian Health for $2.8B. Goldman advising. Draft board points.', expect: 'pseudonymize', forbidden: ['Meridian Health'] },
  { id: 'ORG-02', cat: 'ORG', prompt: 'Case #2024-CV-3391: Plaintiff Jennifer Adams vs. MegaCorp LLC, damages sought $5.2M.', expect: 'pseudonymize', forbidden: ['Jennifer Adams'] },

  // Complex Multi-PII
  { id: 'MULTI-01', cat: 'MULTI', prompt: 'New hire: Sarah Lee, SSN 287-65-4321, DOB 06/15/1992, email sarah.lee@company.com, salary $125,000.', expect: 'pseudonymize', forbidden: ['Sarah Lee', '287-65-4321', 'sarah.lee@company.com'], key: true },
  { id: 'MULTI-02', cat: 'MULTI', prompt: 'Bill patient Michael Brown (MRN: 44521), insurance Aetna #AET-778812, Visa 4111-1111-1111-1111 for copay.', expect: 'pseudonymize', forbidden: ['Michael Brown', '4111-1111-1111-1111'] },
  { id: 'MULTI-03', cat: 'MULTI', prompt: 'Client: David Kim, SSN 512-33-7788, email david@firm.com, phone 555-123-4567, Amex 3782 822463 10005.', expect: 'pseudonymize', forbidden: ['David Kim', '512-33-7788', 'david@firm.com'] },

  // False Positives — these should pass through UNCHANGED
  { id: 'FP-01', cat: 'FP', prompt: 'Explain how photosynthesis works in simple terms.', expect: 'pass-through', forbidden: [], mustContain: ['photosynthesis'], key: true },
  { id: 'FP-02', cat: 'FP', prompt: 'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }', expect: 'pass-through', forbidden: [], mustContain: ['calculateTotal'] },
  { id: 'FP-03', cat: 'FP', prompt: 'Compare the leadership styles of Abraham Lincoln and Winston Churchill during wartime.', expect: 'pass-through', forbidden: [], mustContain: ['Lincoln'] },
  { id: 'FP-04', cat: 'FP', prompt: "Compare John Deere tractors with Caterpillar heavy equipment for farm use.", expect: 'pass-through', forbidden: [], mustContain: ['Deere'] },

  // Edge Cases
  { id: 'EDGE-01', cat: 'EDGE', prompt: 'Send invoice to François Müller-Schmidt at francois@münchen-gmbh.de for 50,000 EUR.', expect: 'pseudonymize', forbidden: ['francois@münchen-gmbh.de'] },
  { id: 'EDGE-02', cat: 'EDGE', prompt: '{"name": "Alice Wong", "ssn": "321-54-9876", "email": "alice@secret.org"}', expect: 'pseudonymize', forbidden: ['Alice Wong', '321-54-9876', 'alice@secret.org'], key: true },
];

// ── Filter scenarios ────────────────────────────────────────────────────────

let scenarios = ALL_SCENARIOS;
if (QUICK_MODE) scenarios = scenarios.filter(s => s.key);
if (CATEGORY_FILTER) scenarios = scenarios.filter(s => s.cat === CATEGORY_FILTER.toUpperCase());

// ── Boot Extension ──────────────────────────────────────────────────────────

async function bootExtension() {
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

  // Find extension ID
  let extensionId = '';
  for (let i = 0; i < 30; i++) {
    const workers = ctx.serviceWorkers();
    if (workers.length > 0) {
      const match = workers[0].url().match(/chrome-extension:\/\/([a-z]+)\//);
      if (match) { extensionId = match[1]; break; }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!extensionId) throw new Error('Extension failed to load — no service worker found');

  // Collect worker logs
  const workerLogs = [];
  const workerErrors = [];
  for (const sw of ctx.serviceWorkers()) {
    sw.on('console', m => {
      const t = m.text();
      workerLogs.push(`[${m.type()}] ${t}`);
    });
    sw.on('pageerror', err => workerErrors.push(err.message));
  }

  return { ctx, extensionId, workerLogs, workerErrors };
}

// ── Onboarding ──────────────────────────────────────────────────────────────

async function completeOnboarding(ctx, extensionId) {
  const page = await ctx.newPage();
  const pageLogs = [];
  page.on('console', m => pageLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => pageLogs.push(`[PAGEERROR] ${e.message}`));

  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2000);

  // Step 1: Select industry
  console.log('  Step 1: Selecting Legal industry...');
  await page.getByRole('button', { name: /Legal/i }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.waitForTimeout(800);

  // Step 2: Skip demo
  console.log('  Step 2: Skipping demo...');
  const c1 = await page.getByRole('button', { name: /^Continue$/i }).all();
  if (c1.length > 0) await c1[c1.length - 1].click();
  await page.waitForTimeout(800);

  // Step 3: Select Proxy Mode
  console.log('  Step 3: Selecting Proxy Mode...');
  await page.getByRole('button', { name: /Proxy Mode/i }).click();
  await page.waitForTimeout(300);
  const c2 = await page.getByRole('button', { name: /^Continue$/i }).all();
  if (c2.length > 0) await c2[c2.length - 1].click();
  await page.waitForTimeout(800);

  // Step 4: Register
  const email = `drive+${Date.now()}@example.com`;
  console.log(`  Step 4: Registering with ${email}...`);
  await page.fill('input[type="email"]', email);
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /Start.*Trial|Create Account|Register/i }).first().click();
  await page.waitForTimeout(8000); // Wait for API (cold start tolerant)

  // Check result
  const storage = await page.evaluate(() => new Promise(resolve => {
    chrome.storage.local.get(['firm_id', 'firmMode', 'subscription_tier'], resolve);
  }));

  const bodyText = await page.evaluate(() => document.body.innerText);
  const errorBanner = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el?.textContent?.trim() || null;
  });

  await page.close();

  if (errorBanner) {
    console.log(`  ⚠ Onboarding error: "${errorBanner}"`);
    console.log('  Falling back to direct storage setup...');
    return fallbackOnboarding(ctx, extensionId);
  }

  if (!storage.firm_id) {
    console.log('  ⚠ No firm_id after onboarding — falling back to direct storage setup...');
    return fallbackOnboarding(ctx, extensionId);
  }

  console.log(`  ✓ Registered: firm_id=${storage.firm_id}, mode=${storage.firmMode}`);
  return { email, firmId: storage.firm_id, method: 'ui' };
}

async function fallbackOnboarding(ctx, extensionId) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        firmMode: 'proxy',
        onboarding_completed: true,
        user_email: 'drive-test@irongate.dev',
        firm_id: 'drive-test-firm',
        firm_name: 'Drive Test Firm',
        firm_code: 'DRIVETEST',
        selected_industries: ['legal', 'healthcare', 'finance'],
        subscription_tier: 'enterprise',
        connectionState: { connected: true, firmId: 'drive-test-firm', firmName: 'Drive Test Firm' },
      }, () => resolve());
    });
  });
  await page.close();
  console.log('  ✓ Fallback onboarding complete (storage set directly)');
  return { email: 'drive-test@irongate.dev', firmId: 'drive-test-firm', method: 'fallback' };
}

// ── Run Scenario ────────────────────────────────────────────────────────────

async function runScenario(ctx, scenario) {
  await fetch(`${MOCK_BASE}/api/intercepted/clear`);

  const page = await ctx.newPage();
  const pageErrors = [];
  const pageLogs = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    const t = m.text();
    if (/iron|pseudo|classif|error|PROMPT_/i.test(t)) pageLogs.push(`[${m.type()}] ${t}`);
  });

  await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000); // Wait for Iron Gate injection + adapter init

  // Verify injection
  const injected = await page.evaluate(() => window.__IRON_GATE_MAIN_WORLD);
  if (!injected) {
    await page.close();
    return { ...scenario, status: 'error', error: 'IronGate not injected', leaked: [], wire: '' };
  }

  // Type and submit
  await page.waitForSelector('#prompt-textarea', { timeout: 5000 });
  await page.click('#prompt-textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(scenario.prompt, { delay: 5 });
  await page.waitForTimeout(500);
  await page.click('button[data-testid="send-button"]');
  await page.waitForTimeout(5000); // Wait for interception + processing

  // Screenshot
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${scenario.id}.png`), fullPage: false });

  // Check wire
  const intercepted = await fetch(`${MOCK_BASE}/api/intercepted`).then(r => r.json());
  const chatgpt = intercepted.filter(r => r.platform === 'chatgpt');
  const wire = chatgpt.map(r => r.payload?.body || '').join('\n');

  // Check for leaks
  const leaked = scenario.forbidden.filter(pii => wire.includes(pii));

  // Check false positive (must-contain)
  const wronglyStripped = (scenario.mustContain || []).filter(s => !wire.includes(s));

  // Check for b.match crash
  const matchErrors = pageErrors.filter(e => e.includes('match is not a function'));

  let status = 'passed';
  let error = '';

  if (leaked.length > 0) {
    status = 'failed';
    error = `PII LEAK: ${leaked.join(', ')}`;
  } else if (wronglyStripped.length > 0) {
    status = 'failed';
    error = `FALSE POSITIVE: stripped "${wronglyStripped.join(', ')}"`;
  } else if (matchErrors.length > 0) {
    status = 'failed';
    error = `CRASH: TypeError b.match is not a function`;
  } else if (wire.length === 0 && scenario.expect === 'pseudonymize') {
    status = 'warning';
    error = 'No data reached wire (extension may have blocked entirely)';
  }

  await page.close();

  return {
    ...scenario,
    status,
    error,
    leaked,
    wronglyStripped,
    wire: wire.slice(0, 200),
    wireLength: wire.length,
    interceptedCount: chatgpt.length,
    matchErrors: matchErrors.length,
    keyLogs: pageLogs.filter(l => /pseudonymized|classif|PROMPT_DETECTED|transform/i.test(l)).slice(0, 3),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  🛡️  Iron Gate Full Drive — Proper E2E Testing');
  console.log('══════════════════════════════════════════════════════\n');
  console.log(`  Scenarios: ${scenarios.length}${QUICK_MODE ? ' (quick mode)' : ''}${CATEGORY_FILTER ? ` (${CATEGORY_FILTER} only)` : ''}`);
  console.log(`  Mock server: ${MOCK_BASE}`);
  console.log(`  Extension: ${EXTENSION_PATH}\n`);

  // Verify mock server
  try {
    const res = await fetch(`${MOCK_BASE}/api/intercepted`);
    if (!res.ok) throw new Error('not ok');
  } catch {
    console.error('❌ Mock server not running! Start it first:\n   node tests/mocked-platforms/server.mjs\n');
    process.exit(3);
  }

  // Boot extension
  console.log('── Booting extension ────────────────────────────────');
  const { ctx, extensionId, workerLogs, workerErrors } = await bootExtension();
  console.log(`  ✓ Extension loaded: ${extensionId}`);

  // Wait for service worker to initialize
  await new Promise(r => setTimeout(r, 3000));
  const startupErrors = workerLogs.filter(l => /error|exception|unhandled|reject|typeerror/i.test(l));
  if (startupErrors.length > 0) {
    console.log(`  ⚠ Worker startup errors (${startupErrors.length}):`);
    for (const e of startupErrors.slice(0, 3)) console.log(`    ${e.slice(0, 200)}`);
  } else {
    console.log('  ✓ Worker startup clean');
  }

  // Onboarding
  console.log('\n── Onboarding ──────────────────────────────────────');
  const onboarding = await completeOnboarding(ctx, extensionId);

  // Wait for post-onboarding initialization
  console.log('  Waiting for extension to fully initialize...');
  await new Promise(r => setTimeout(r, 3000));

  // ── Sidepanel Verification (Before Scenarios) ──────────────────────────
  console.log('\n── Sidepanel Verification ───────────────────────────');
  {
    const sp = await ctx.newPage();
    const spErrors = [];
    sp.on('pageerror', e => spErrors.push(e.message));
    await sp.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await sp.waitForTimeout(3000);

    const bodyText = await sp.evaluate(() => document.body.innerText);
    await sp.screenshot({ path: path.join(SCREENSHOTS_DIR, 'sidepanel-initial.png'), fullPage: true });

    // Check UI elements
    const checks = {
      'Renders content': bodyText.length > 50,
      'No "Trial ended" on fresh install': !bodyText.includes('Trial ended'),
      'Shows deployment badge': bodyText.includes('Sovereign') || bodyText.includes('Cloud') || bodyText.includes('Local LLM') || bodyText.includes('Hybrid') || bodyText.includes('Initializing'),
      'Has Recent Activity section': bodyText.includes('Recent Activity') || bodyText.includes('Activity'),
      'No page errors': spErrors.length === 0,
    };

    for (const [check, ok] of Object.entries(checks)) {
      console.log(`  ${ok ? '✓' : '✗'} ${check}`);
    }

    if (spErrors.length > 0) {
      console.log(`  Page errors:`);
      for (const e of spErrors.slice(0, 3)) console.log(`    ${e.slice(0, 200)}`);
    }

    // Check formatting / layout
    const layout = await sp.evaluate(() => {
      const body = document.body;
      const styles = window.getComputedStyle(body);
      const buttons = document.querySelectorAll('button');
      const headings = document.querySelectorAll('h1, h2, h3');
      const badges = document.querySelectorAll('[class*="badge"], [class*="chip"], [class*="tag"]');
      return {
        bodyWidth: body.clientWidth,
        bodyHeight: body.clientHeight,
        fontFamily: styles.fontFamily,
        backgroundColor: styles.backgroundColor,
        buttonCount: buttons.length,
        headingCount: headings.length,
        badgeCount: badges.length,
        hasScrollbar: body.scrollHeight > body.clientHeight,
        allButtonTexts: Array.from(buttons).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 10),
        allHeadingTexts: Array.from(headings).map(h => h.textContent?.trim()).filter(Boolean),
      };
    });

    console.log(`  Layout: ${layout.bodyWidth}x${layout.bodyHeight}px`);
    console.log(`  Font: ${layout.fontFamily.slice(0, 50)}`);
    console.log(`  Buttons: ${layout.buttonCount} (${layout.allButtonTexts.join(', ')})`);
    console.log(`  Headings: ${layout.headingCount} (${layout.allHeadingTexts.join(', ')})`);
    console.log(`  Badges: ${layout.badgeCount}`);

    await sp.close();
  }

  // Run scenarios
  console.log(`\n── Running ${scenarios.length} scenarios ─────────────────────────────\n`);

  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`  [${scenario.id}] ${scenario.prompt.slice(0, 60)}... `);
    const result = await runScenario(ctx, scenario);
    results.push(result);

    if (result.status === 'passed') {
      console.log('✓ PASS');
    } else if (result.status === 'warning') {
      console.log(`⚠ ${result.error}`);
    } else if (result.status === 'error') {
      console.log(`⊘ ${result.error}`);
    } else {
      console.log(`✗ FAIL — ${result.error}`);
    }

    // Brief pause between scenarios
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Sidepanel After Scenarios ───────────────────────────────────────
  console.log('\n── Sidepanel After Scenarios ────────────────────────');
  {
    const sp = await ctx.newPage();
    await sp.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await sp.waitForTimeout(3000);

    const bodyText = await sp.evaluate(() => document.body.innerText);
    await sp.screenshot({ path: path.join(SCREENSHOTS_DIR, 'sidepanel-after.png'), fullPage: true });

    const showsActivity = !bodyText.includes('No activity yet');
    const activityCount = await sp.evaluate(() => {
      const items = document.querySelectorAll('[class*="activity"] li, [class*="activity-item"], [class*="log-entry"]');
      return items.length;
    });

    console.log(`  ${showsActivity ? '✓' : '✗'} Recent Activity populated: ${showsActivity}`);
    console.log(`  Activity items found: ${activityCount}`);
    console.log(`  Still shows "No activity yet": ${bodyText.includes('No activity yet')}`);

    await sp.close();
  }

  // Close browser
  await ctx.close();

  // ── Report ────────────────────────────────────────────────────────────

  const passed = results.filter(r => r.status === 'passed');
  const failed = results.filter(r => r.status === 'failed');
  const warnings = results.filter(r => r.status === 'warning');
  const errors = results.filter(r => r.status === 'error');

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('══════════════════════════════════════════════════════\n');

  console.log(`  Total:    ${results.length}`);
  console.log(`  Passed:   ${passed.length}`);
  console.log(`  Failed:   ${failed.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Errors:   ${errors.length}`);
  console.log(`  Pass Rate: ${((passed.length / results.length) * 100).toFixed(1)}%\n`);

  if (failed.length > 0) {
    console.log('  ── FAILURES ──────────────────────────────────────\n');
    for (const f of failed) {
      console.log(`  [${f.id}] ${f.error}`);
      if (f.leaked.length > 0) {
        console.log(`    Leaked PII: ${f.leaked.join(', ')}`);
      }
      if (f.wronglyStripped?.length > 0) {
        console.log(`    Wrongly stripped: ${f.wronglyStripped.join(', ')}`);
      }
      console.log(`    Wire snippet: "${f.wire}"`);
      console.log('');
    }
  }

  if (warnings.length > 0) {
    console.log('  ── WARNINGS ──────────────────────────────────────\n');
    for (const w of warnings) {
      console.log(`  [${w.id}] ${w.error}`);
    }
    console.log('');
  }

  // Group leaks by PII type
  const allLeaks = failed.filter(f => f.leaked.length > 0);
  if (allLeaks.length > 0) {
    console.log('  ── LEAK ANALYSIS ─────────────────────────────────\n');
    const leakTypes = {};
    for (const f of allLeaks) {
      for (const pii of f.leaked) {
        // Classify the leak
        let type = 'unknown';
        if (/\d{3}-\d{2}-\d{4}/.test(pii)) type = 'SSN';
        else if (/\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}/.test(pii)) type = 'Credit Card';
        else if (/@/.test(pii)) type = 'Email';
        else if (/\(\d{3}\)/.test(pii) || /\d{3}-\d{3}-\d{4}/.test(pii)) type = 'Phone';
        else if (/\d{9,}/.test(pii)) type = 'Account Number';
        else if (/^[A-Z]{2}\d{2}/.test(pii)) type = 'IBAN';
        else if (/sk-|AKIA|BEGIN.*KEY/i.test(pii)) type = 'Credential';
        else type = 'Name/Other';
        if (!leakTypes[type]) leakTypes[type] = [];
        leakTypes[type].push({ scenario: f.id, value: pii });
      }
    }
    for (const [type, leaks] of Object.entries(leakTypes)) {
      console.log(`  ${type}: ${leaks.length} leak(s)`);
      for (const l of leaks) console.log(`    [${l.scenario}] "${l.value}"`);
    }
    console.log('');
  }

  // Save JSON report
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    onboarding,
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      warnings: warnings.length,
      errors: errors.length,
      passRate: `${((passed.length / results.length) * 100).toFixed(1)}%`,
    },
    results: results.map(r => ({
      id: r.id,
      cat: r.cat,
      status: r.status,
      error: r.error,
      leaked: r.leaked,
      wireLength: r.wireLength,
      interceptedCount: r.interceptedCount,
    })),
  };
  writeFileSync(path.join(RESULTS_DIR, 'drive-report.json'), JSON.stringify(report, null, 2));
  console.log(`  Report saved: test-results/drive-report.json`);
  console.log(`  Screenshots: test-results/screenshots/\n`);

  console.log('══════════════════════════════════════════════════════\n');

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n❌ Drive failed:', err.message);
  process.exit(3);
});
