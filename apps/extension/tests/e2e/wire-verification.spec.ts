/**
 * Wire Verification — automated replacement for the mitmproxy runbook
 *
 * This spec boots the IronGate extension in a real Chromium, navigates to
 * our mocked ChatGPT / Claude / Gemini pages (apps/extension/tests/mocked-platforms),
 * types a prompt containing known PII, submits, and then reads the mock
 * server's `/api/intercepted` log. The assertion is simple and uncompromising:
 *
 *   NONE of the original PII strings may appear in the intercepted request body.
 *
 * This is the same evidence a security team would get from mitmproxy against
 * the real chatgpt.com — except it's fully automated and runs in CI. Proof of
 * the zero-persistence promise on the bytes, not just in architecture.
 *
 * Prerequisites:
 *   1. Mock server running: `node tests/mocked-platforms/server.mjs` (port 9000)
 *   2. Extension built: `pnpm build`
 *   3. Playwright installed: `pnpm playwright install chromium`
 *
 * Or: `pnpm test:wire` (see the test:wire script in package.json) which does both.
 */

import { test, expect, waitForInjection, typeIntoInput, clickSubmit } from './fixtures';

const MOCK_BASE = 'http://localhost:9000';

interface InterceptedRecord {
  platform: string;
  payload: { body?: string; query?: string; submittedText?: string; rawLength: number };
  timestamp: number;
}

async function clearInterceptLog(): Promise<void> {
  await fetch(`${MOCK_BASE}/api/intercepted/clear`);
}

async function getInterceptedForPlatform(platform: string): Promise<InterceptedRecord[]> {
  const res = await fetch(`${MOCK_BASE}/api/intercepted`);
  const all = (await res.json()) as InterceptedRecord[];
  return all.filter((r) => r.platform === platform);
}

function payloadText(r: InterceptedRecord): string {
  return r.payload.body ?? r.payload.query ?? r.payload.submittedText ?? '';
}

// ── The canonical wire-verification scenarios ────────────────────────────────
// Each scenario: the prompt we type, and the original strings that MUST NOT
// appear in the mock server's intercepted body. If any do, the test fails.

const WIRE_SCENARIOS = [
  {
    id: 'WIRE-L1',
    name: 'Legal — client name + SSN + opposing org',
    prompt:
      'Draft a settlement letter for my client Robert Johnson, SSN 423-55-8901, ' +
      'addressing the Meridian Health lawsuit.',
    forbidden: ['Robert Johnson', '423-55-8901', 'Meridian Health'],
  },
  {
    id: 'WIRE-H1',
    name: 'Healthcare — MRN + patient name',
    prompt:
      'Patient MRN 2024-88341, Patricia Chen, diagnosed with type 2 diabetes, ' +
      'prescribed metformin 500mg BID.',
    forbidden: ['2024-88341', 'Patricia Chen'],
  },
  {
    id: 'WIRE-M1',
    name: 'M&A — target + banker names',
    prompt:
      'Confidential: we are acquiring Meridian Health for $2.8B. Goldman is ' +
      'advising. Draft board talking points.',
    forbidden: ['Meridian Health'],
  },
  {
    id: 'WIRE-K1',
    name: 'Credentials — real-looking API key',
    prompt:
      'Debug this request: Authorization: Bearer ' +
      'sk-proj-RealLookingKeyAbc123Xyz789De45',
    forbidden: ['sk-proj-RealLookingKeyAbc123Xyz789De45'],
  },
] as const;

async function enableProxyMode(extensionId: string, context: any): Promise<void> {
  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await sidepanel.waitForTimeout(1000);
  // The extension stores firmMode in chrome.storage.local; forcing proxy mode
  // via the storage API avoids UI-click brittleness across sidepanel redesigns.
  await sidepanel.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(
        { firmMode: 'proxy', connectionState: { connected: true, firmId: 'test', firmName: 'Wire Test' } },
        () => resolve(),
      );
    });
  });
  await sidepanel.close();
}

test.describe('Wire Verification — no raw PII leaves the device', () => {
  test.beforeEach(async () => {
    await clearInterceptLog();
  });

  // ── ChatGPT path ──────────────────────────────────────────────────────────
  test('ChatGPT: pseudonym replaces PII in outbound fetch body', async ({ context, extensionId }) => {
    await enableProxyMode(extensionId, context);

    const page = await context.newPage();
    await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => waitForInjection(page), { timeout: 15_000 })
      .toBe(true);

    await page.waitForTimeout(2000);

    for (const sc of WIRE_SCENARIOS) {
      await clearInterceptLog();

      const typed = await typeIntoInput(
        page,
        ['#prompt-textarea', 'div[contenteditable="true"]'],
        sc.prompt,
      );
      expect(typed, `Could not type scenario ${sc.id}`).toBe(true);
      await page.waitForTimeout(500);

      await clickSubmit(page, ['button[data-testid="send-button"]', 'button[data-testid="composer-send-button"]']);
      // Allow the fetch interceptor + body transformer + mock POST to complete
      await page.waitForTimeout(3000);

      const captured = await getInterceptedForPlatform('chatgpt');
      expect(captured.length, `No intercepted ChatGPT request for ${sc.id}`).toBeGreaterThan(0);

      const combinedBody = captured.map(payloadText).join('\n');
      for (const leaked of sc.forbidden) {
        expect(
          combinedBody,
          `LEAK in ${sc.id}: "${leaked}" appeared on the wire. Intercepted body: ${combinedBody.slice(0, 500)}`,
        ).not.toContain(leaked);
      }

      // Clear the ChatGPT input for the next scenario
      await page.evaluate(() => {
        const el = document.querySelector('#prompt-textarea') as HTMLElement | null;
        if (el) {
          (el as any).innerText = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

    await page.close();
  });

  // ── Claude path ───────────────────────────────────────────────────────────
  test('Claude: pseudonym replaces PII in outbound completion body', async ({ context, extensionId }) => {
    await enableProxyMode(extensionId, context);

    const page = await context.newPage();
    await page.goto(`${MOCK_BASE}/claude`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);

    await page.waitForTimeout(2000);

    for (const sc of WIRE_SCENARIOS) {
      await clearInterceptLog();

      const typed = await typeIntoInput(
        page,
        ['[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
        sc.prompt,
      );
      expect(typed, `Could not type scenario ${sc.id} on Claude`).toBe(true);
      await page.waitForTimeout(500);

      await clickSubmit(page, ['button[aria-label="Send Message"]', 'button[aria-label="Send message"]']);
      await page.waitForTimeout(3000);

      const captured = await getInterceptedForPlatform('claude');
      expect(captured.length, `No intercepted Claude request for ${sc.id}`).toBeGreaterThan(0);

      const combinedBody = captured.map(payloadText).join('\n');
      for (const leaked of sc.forbidden) {
        expect(
          combinedBody,
          `LEAK in ${sc.id} on Claude: "${leaked}" appeared on the wire`,
        ).not.toContain(leaked);
      }
    }

    await page.close();
  });

  // ── Gemini path ───────────────────────────────────────────────────────────
  // Gemini uses DOM pre-submit — the extension writes pseudonymized text into
  // the Quill editor before the form submit fires. Assert on /gemini-submit.
  test('Gemini: pseudonym written into Quill before DOM submit', async ({ context, extensionId }) => {
    await enableProxyMode(extensionId, context);

    const page = await context.newPage();
    await page.goto(`${MOCK_BASE}/gemini`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);

    await page.waitForTimeout(2000);

    for (const sc of WIRE_SCENARIOS) {
      await clearInterceptLog();

      const typed = await typeIntoInput(
        page,
        ['.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
        sc.prompt,
      );
      expect(typed, `Could not type scenario ${sc.id} on Gemini`).toBe(true);
      await page.waitForTimeout(500);

      await clickSubmit(page, ['button[aria-label="Send message"]', 'button[aria-label*="send" i]']);
      await page.waitForTimeout(3000);

      const captured = await getInterceptedForPlatform('gemini');
      expect(captured.length, `No intercepted Gemini request for ${sc.id}`).toBeGreaterThan(0);

      const combinedBody = captured.map(payloadText).join('\n');
      for (const leaked of sc.forbidden) {
        expect(
          combinedBody,
          `LEAK in ${sc.id} on Gemini: "${leaked}" appeared on the wire`,
        ).not.toContain(leaked);
      }
    }

    await page.close();
  });

  // ── Negative control — ensure we're not just asserting on empty data ──────
  test('Negative control: benign prompt passes through unchanged', async ({ context, extensionId }) => {
    await enableProxyMode(extensionId, context);

    const page = await context.newPage();
    await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);

    await clearInterceptLog();
    const benign = 'Explain photosynthesis in simple terms.';
    await typeIntoInput(
      page,
      ['#prompt-textarea', 'div[contenteditable="true"]'],
      benign,
    );
    await clickSubmit(page, ['button[data-testid="send-button"]']);
    await page.waitForTimeout(3000);

    const captured = await getInterceptedForPlatform('chatgpt');
    expect(captured.length).toBeGreaterThan(0);
    // The benign prompt SHOULD appear unchanged — proves we're not blindly
    // stripping everything.
    const combined = captured.map(payloadText).join('\n');
    expect(combined).toContain('photosynthesis');

    await page.close();
  });
});
