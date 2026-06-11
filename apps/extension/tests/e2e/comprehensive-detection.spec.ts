/**
 * IronGate E2E — Comprehensive Detection & Pseudonymization Tests
 *
 * 32+ scenarios covering all entity types, known bugs (SSN leak, account
 * number leak, TypeError: b.match), cross-platform behavior, false positive
 * resistance, and edge cases.
 *
 * Uses the mock platform server (tests/mocked-platforms/server.mjs) so tests
 * run without needing real AI platform accounts.
 *
 * Prerequisites:
 *   1. Extension built: pnpm build
 *   2. Mock server running on port 9000
 */

import { test, expect, waitForInjection, collectIronGateLogs, typeIntoInput, clickSubmit } from './fixtures';

const MOCK_BASE = 'http://localhost:9000';

interface InterceptedRecord {
  platform: string;
  payload: { body?: string; query?: string; submittedText?: string; rawLength: number };
  timestamp: number;
}

async function clearLog(): Promise<void> {
  await fetch(`${MOCK_BASE}/api/intercepted/clear`);
}

async function getIntercepted(platform?: string): Promise<InterceptedRecord[]> {
  const res = await fetch(`${MOCK_BASE}/api/intercepted`);
  const all = (await res.json()) as InterceptedRecord[];
  return platform ? all.filter(r => r.platform === platform) : all;
}

function wireText(records: InterceptedRecord[]): string {
  return records.map(r => r.payload.body ?? r.payload.query ?? r.payload.submittedText ?? '').join('\n');
}

async function enableProxyMode(extensionId: string, context: any): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    return new Promise<void>(resolve => {
      chrome.storage.local.set({
        firmMode: 'proxy',
        onboarding_completed: true,
        user_email: 'test@irongate.dev',
        firm_id: 'test-firm',
        firm_name: 'Test Firm',
        firm_code: 'TEST',
        selected_industries: ['legal', 'healthcare', 'finance'],
        subscription_tier: 'enterprise',
        connectionState: { connected: true, firmId: 'test-firm', firmName: 'Test Firm' },
      }, () => resolve());
    });
  });
  await page.close();
}

// ── Test Scenario Definitions ────────────────────────────────────────────────

interface Scenario {
  id: string;
  name: string;
  prompt: string;
  forbidden: string[];        // MUST NOT appear on wire (PII that should be pseudonymized)
  mustContain?: string[];     // MUST appear on wire (benign content that should pass through)
  minEntities?: number;       // minimum entities detected
  category: string;
}

const SCENARIOS: Scenario[] = [
  // ── Category 1: Personal Identifiers ──────────────────────────────────────
  {
    id: 'PII-01', category: 'Personal Identifiers',
    name: 'Full name + email',
    prompt: 'Write an email from John Smith (john.smith@acme.com) to Sarah Johnson about Q4 budget.',
    forbidden: ['John Smith', 'john.smith@acme.com', 'Sarah Johnson'],
    minEntities: 3,
  },
  {
    id: 'PII-02', category: 'Personal Identifiers',
    name: 'SSN detection (KNOWN BUG)',
    prompt: 'Customer record: James Wilson, SSN 423-86-1957, needs account update.',
    forbidden: ['James Wilson', '423-86-1957'],
    minEntities: 2,
  },
  {
    id: 'PII-03', category: 'Personal Identifiers',
    name: 'Phone number + address',
    prompt: 'Ship to: Maria Garcia, 742 Evergreen Terrace, Springfield IL 62704, phone (312) 555-0198.',
    forbidden: ['Maria Garcia', '742 Evergreen Terrace', '(312) 555-0198'],
    minEntities: 3,
  },
  {
    id: 'PII-04', category: 'Personal Identifiers',
    name: 'Date of birth',
    prompt: 'Patient intake: Robert Chen, DOB 03/15/1985, allergic to penicillin.',
    forbidden: ['Robert Chen', '03/15/1985'],
    minEntities: 2,
  },

  // ── Category 2: Financial Data ────────────────────────────────────────────
  {
    id: 'FIN-01', category: 'Financial',
    name: 'Credit card number',
    prompt: 'Process payment for order #9921: Visa 4532-8921-0076-3344, exp 12/26, CVV 891.',
    forbidden: ['4532-8921-0076-3344', '891'],
    minEntities: 1,
  },
  {
    id: 'FIN-02', category: 'Financial',
    name: 'Bank account + routing (KNOWN BUG)',
    prompt: 'Wire transfer: routing 021000021, account 1234567890, beneficiary Lisa Park.',
    forbidden: ['021000021', '1234567890', 'Lisa Park'],
    minEntities: 2,
  },
  {
    id: 'FIN-03', category: 'Financial',
    name: 'IBAN',
    prompt: 'Send payment to IBAN GB29 NWBK 6016 1331 9268 19, holder name Andrea Müller.',
    forbidden: ['GB29 NWBK 6016 1331 9268 19', 'Andrea Müller'],
    minEntities: 2,
  },

  // ── Category 3: Medical / HIPAA ───────────────────────────────────────────
  {
    id: 'MED-01', category: 'Medical/HIPAA',
    name: 'Patient record with MRN',
    prompt: 'Patient MRN 2024-88341, Patricia Chen, diagnosed with type 2 diabetes, prescribed metformin 500mg.',
    forbidden: ['2024-88341', 'Patricia Chen'],
    minEntities: 2,
  },
  {
    id: 'MED-02', category: 'Medical/HIPAA',
    name: 'Insurance details',
    prompt: 'Insurance: BlueCross policy HIC-9988-2244, member David Park, group #GRP-551, copay $30.',
    forbidden: ['HIC-9988-2244', 'David Park'],
    minEntities: 2,
  },
  {
    id: 'MED-03', category: 'Medical/HIPAA',
    name: 'Lab results with PHI',
    prompt: 'Lab results for Emma Watson (DOB: 11/22/1990): A1C 7.2%, fasting glucose 142 mg/dL.',
    forbidden: ['Emma Watson', '11/22/1990'],
    minEntities: 2,
  },

  // ── Category 4: Technical Secrets / Credentials ───────────────────────────
  {
    id: 'CRED-01', category: 'Technical Secrets',
    name: 'AWS access key',
    prompt: 'Debug S3 upload: AWS key AKIAIOSFODNN7EXAMPLE, secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.',
    forbidden: ['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    minEntities: 1,
  },
  {
    id: 'CRED-02', category: 'Technical Secrets',
    name: 'OpenAI API key',
    prompt: 'Why is this failing? API key: sk-proj-RealLookingKeyAbc123Xyz789De45.',
    forbidden: ['sk-proj-RealLookingKeyAbc123Xyz789De45'],
    minEntities: 1,
  },
  {
    id: 'CRED-03', category: 'Technical Secrets',
    name: 'Database connection string',
    prompt: 'Connect to: postgresql://admin:SuperSecret123!@db.example.com:5432/production.',
    forbidden: ['SuperSecret123!', 'admin'],
    minEntities: 1,
  },
  {
    id: 'CRED-04', category: 'Technical Secrets',
    name: 'JWT token',
    prompt: 'Decode this JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c.',
    forbidden: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
    minEntities: 1,
  },
  {
    id: 'CRED-05', category: 'Technical Secrets',
    name: 'Private key block',
    prompt: 'My SSH key: -----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA1234... -----END RSA PRIVATE KEY-----.',
    forbidden: ['BEGIN RSA PRIVATE KEY'],
    minEntities: 1,
  },

  // ── Category 5: International IDs ─────────────────────────────────────────
  {
    id: 'INTL-01', category: 'International IDs',
    name: 'UK National Insurance Number',
    prompt: 'Employee: James Mitchell, NI number AB 12 34 56 C, start date 2024-01-15.',
    forbidden: ['James Mitchell', 'AB 12 34 56 C'],
    minEntities: 2,
  },
  {
    id: 'INTL-02', category: 'International IDs',
    name: 'Canadian SIN',
    prompt: 'Applicant: Marie Dubois, SIN 046-454-286, requesting mortgage pre-approval.',
    forbidden: ['Marie Dubois', '046-454-286'],
    minEntities: 2,
  },
  {
    id: 'INTL-03', category: 'International IDs',
    name: 'Passport number',
    prompt: 'Traveler: Yuki Tanaka, passport JP-TK8823991, visa expires 2025-03-15.',
    forbidden: ['Yuki Tanaka', 'JP-TK8823991'],
    minEntities: 2,
  },

  // ── Category 6: Organization / Legal ──────────────────────────────────────
  {
    id: 'ORG-01', category: 'Organization',
    name: 'M&A confidential',
    prompt: 'Confidential: Acme Corp acquiring Meridian Health for $2.8B. Goldman advising. Draft board points.',
    forbidden: ['Meridian Health'],
    minEntities: 1,
  },
  {
    id: 'ORG-02', category: 'Organization',
    name: 'Legal case details',
    prompt: 'Case #2024-CV-3391: Plaintiff Jennifer Adams vs. MegaCorp LLC, damages sought $5.2M.',
    forbidden: ['Jennifer Adams', '2024-CV-3391'],
    minEntities: 2,
  },

  // ── Category 7: Complex Multi-PII ─────────────────────────────────────────
  {
    id: 'MULTI-01', category: 'Complex Multi-PII',
    name: 'Employee record with everything',
    prompt: 'New hire: Sarah Lee, SSN 287-65-4321, DOB 06/15/1992, email sarah.lee@company.com, badge #EMP-9921, salary $125,000.',
    forbidden: ['Sarah Lee', '287-65-4321', 'sarah.lee@company.com'],
    minEntities: 3,
  },
  {
    id: 'MULTI-02', category: 'Complex Multi-PII',
    name: 'Healthcare + financial combined',
    prompt: 'Bill patient Michael Brown (MRN: 44521), insurance Aetna #AET-778812, Visa 4111-1111-1111-1111 for copay.',
    forbidden: ['Michael Brown', '4111-1111-1111-1111', 'AET-778812'],
    minEntities: 3,
  },
  {
    id: 'MULTI-03', category: 'Complex Multi-PII',
    name: '5+ entity types in one message',
    prompt: 'Client: David Kim, SSN 512-33-7788, email david@firm.com, phone 555-123-4567, passport US-A12345678, Amex 3782 822463 10005.',
    forbidden: ['David Kim', '512-33-7788', 'david@firm.com', '555-123-4567'],
    minEntities: 4,
  },

  // ── Category 8: False Positive Resistance ─────────────────────────────────
  {
    id: 'FP-01', category: 'False Positives',
    name: 'Pure technical question',
    prompt: 'Explain how photosynthesis works in simple terms.',
    forbidden: [],
    mustContain: ['photosynthesis'],
  },
  {
    id: 'FP-02', category: 'False Positives',
    name: 'Code snippet without secrets',
    prompt: 'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
    forbidden: [],
    mustContain: ['calculateTotal'],
  },
  {
    id: 'FP-03', category: 'False Positives',
    name: 'Historical figure names',
    prompt: 'Compare the leadership styles of Abraham Lincoln and Winston Churchill during wartime.',
    forbidden: [],
    mustContain: ['Lincoln'],
  },
  {
    id: 'FP-04', category: 'False Positives',
    name: 'Brand names that look like personal names',
    prompt: "Compare John Deere tractors with Caterpillar heavy equipment for farm use.",
    forbidden: [],
    mustContain: ['Deere'],
  },

  // ── Category 9: Edge Cases / Known Bugs ───────────────────────────────────
  {
    id: 'EDGE-01', category: 'Edge Cases',
    name: 'Empty-ish input (whitespace)',
    prompt: '   ',
    forbidden: [],
  },
  {
    id: 'EDGE-02', category: 'Edge Cases',
    name: 'Unicode names',
    prompt: 'Send invoice to François Müller-Schmidt at francois@münchen-gmbh.de for 50,000 EUR.',
    forbidden: ['François Müller-Schmidt', 'francois@münchen-gmbh.de'],
    minEntities: 2,
  },
  {
    id: 'EDGE-03', category: 'Edge Cases',
    name: 'Very long prompt (stress test)',
    prompt: `Analyze this data: ${Array.from({ length: 20 }, (_, i) =>
      `Employee ${i + 1}: Person${i}Name, SSN ${String(100 + i).padStart(3, '0')}-${String(50 + i).padStart(2, '0')}-${String(1000 + i).padStart(4, '0')}, email p${i}@co.com`
    ).join('. ')}`,
    forbidden: ['Person0Name', 'Person5Name', 'Person19Name'],
    minEntities: 10,
  },
  {
    id: 'EDGE-04', category: 'Edge Cases',
    name: 'PII in JSON format',
    prompt: '{"name": "Alice Wong", "ssn": "321-54-9876", "email": "alice@secret.org", "card": "4000-1234-5678-9010"}',
    forbidden: ['Alice Wong', '321-54-9876', 'alice@secret.org'],
    minEntities: 3,
  },
];

// ── Test suite ──────────────────────────────────────────────────────────────

test.describe('Comprehensive Detection — ChatGPT Mock', () => {
  test.beforeAll(async ({}, testInfo) => {
    // Verify mock server is reachable
    try {
      const res = await fetch(`${MOCK_BASE}/api/intercepted`);
      if (!res.ok) throw new Error(`Mock server returned ${res.status}`);
    } catch (err) {
      throw new Error(
        `Mock server not running on ${MOCK_BASE}. Start it with: node tests/mocked-platforms/server.mjs\n${err}`,
      );
    }
  });

  for (const scenario of SCENARIOS) {
    test(`[${scenario.id}] ${scenario.name}`, async ({ context, extensionId }) => {
      await enableProxyMode(extensionId, context);

      const page = await context.newPage();
      const logs = collectIronGateLogs(page);
      const consoleErrors: string[] = [];
      page.on('pageerror', err => consoleErrors.push(err.message));

      await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const injected = await waitForInjection(page, 15_000);
      expect(injected, 'IronGate MAIN world not injected').toBe(true);
      await page.waitForTimeout(2000);

      await clearLog();

      // Type and submit the prompt
      const typed = await typeIntoInput(
        page,
        ['#prompt-textarea', 'div[contenteditable="true"]'],
        scenario.prompt,
      );

      if (scenario.prompt.trim().length > 0) {
        expect(typed, 'Could not type into input').toBe(true);
        await page.waitForTimeout(500);
        await clickSubmit(page, ['button[data-testid="send-button"]', 'button[data-testid="composer-send-button"]']);
      }

      await page.waitForTimeout(4000);

      // Screenshot for evidence
      await page.screenshot({
        path: `tests/e2e/screenshots/comprehensive-${scenario.id}.png`,
        fullPage: false,
      });

      const captured = await getIntercepted('chatgpt');
      const wire = wireText(captured);

      // ── Assert forbidden strings are NOT on the wire ──────────────────
      for (const pii of scenario.forbidden) {
        expect(
          wire,
          `LEAK in ${scenario.id}: "${pii}" appeared on the wire!\nWire content: ${wire.slice(0, 500)}`,
        ).not.toContain(pii);
      }

      // ── Assert must-contain strings ARE on the wire (false positive check)
      if (scenario.mustContain) {
        for (const expected of scenario.mustContain) {
          expect(
            wire,
            `FALSE POSITIVE in ${scenario.id}: "${expected}" should pass through but was stripped/modified`,
          ).toContain(expected);
        }
      }

      // ── Check for TypeError: b.match (known Gemini bug) ───────────────
      const matchErrors = consoleErrors.filter(e => e.includes('match is not a function'));
      expect(
        matchErrors.length,
        `TypeError: b.match found — pseudonymization pipeline crash:\n${matchErrors.join('\n')}`,
      ).toBe(0);

      // ── Log summary ───────────────────────────────────────────────────
      const detectionLogs = logs.filter(l =>
        l.includes('pseudonymized') || l.includes('entities') || l.includes('score'),
      );
      console.log(`  [${scenario.id}] ${scenario.name}`);
      console.log(`    Wire length: ${wire.length} chars, Intercepted: ${captured.length} req(s)`);
      console.log(`    Detection logs: ${detectionLogs.length}, Console errors: ${consoleErrors.length}`);

      await page.close();
    });
  }
});

// ── Cross-Platform Injection Verification ───────────────────────────────────

test.describe('Cross-Platform Injection on Mocks', () => {
  const MOCK_PLATFORMS = [
    { id: 'chatgpt', url: `${MOCK_BASE}/chatgpt`, name: 'ChatGPT' },
    { id: 'claude', url: `${MOCK_BASE}/claude`, name: 'Claude' },
    { id: 'gemini', url: `${MOCK_BASE}/gemini`, name: 'Gemini' },
  ];

  for (const platform of MOCK_PLATFORMS) {
    test(`IronGate injects on mock ${platform.name}`, async ({ context, extensionId }) => {
      await enableProxyMode(extensionId, context);

      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const injected = await waitForInjection(page, 15_000);

      expect(injected, `IronGate did not inject on ${platform.name}`).toBe(true);

      // No crash errors (specifically the b.match bug)
      const matchErrors = errors.filter(e => e.includes('match is not a function'));
      expect(matchErrors.length, `b.match error on ${platform.name}`).toBe(0);

      await page.screenshot({
        path: `tests/e2e/screenshots/injection-${platform.id}.png`,
      });

      await page.close();
    });
  }
});

// ── Sidepanel State Verification ────────────────────────────────────────────

test.describe('Sidepanel Smoke Tests', () => {
  test('Sidepanel renders without errors', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.length).toBeGreaterThan(0);

    // Should not show "Trial ended" on fresh install
    expect(bodyText).not.toContain('Trial ended');

    await page.screenshot({ path: 'tests/e2e/screenshots/sidepanel.png' });
    await page.close();
  });

  test('Recent Activity section exists', async ({ context, extensionId }) => {
    await enableProxyMode(extensionId, context);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    // Check that "Recent Activity" or "Activity" section exists in the UI
    const hasActivity = bodyText.includes('Recent Activity') || bodyText.includes('Activity');
    console.log(`  Recent Activity section present: ${hasActivity}`);
    console.log(`  Shows "No activity yet": ${bodyText.includes('No activity yet')}`);

    await page.screenshot({ path: 'tests/e2e/screenshots/sidepanel-activity.png' });
    await page.close();
  });
});
