/**
 * Real-platform canary tests against a high-fidelity ChatGPT mock.
 *
 * Why the mock (and not chatgpt.com)?
 *   Anonymous chatgpt.com refuses automated Chromium with bot detection —
 *   blank pages, no input rendered. Authenticated runs need stored creds +
 *   anti-bot evasion that's out of scope for this harness. The mock at
 *   `tests/mocked-platforms/chatgpt.html` mirrors ChatGPT's DOM exactly
 *   (`#prompt-textarea`, `[data-message-author-role]`, send button) AND
 *   accepts pseudonymized requests on `/api/chatgpt`, logging the actual
 *   wire payload. Same selectors Iron Gate uses in production, same wire
 *   format, no anti-bot interference.
 *
 * What gets tested:
 *   1. **Wire-leak proof**: the actual fetch body POSTed to /api/chatgpt
 *      contains NONE of the canary's sensitive strings. Iron Gate
 *      pseudonymized them before they left the browser.
 *   2. **Bubble integrity**: the user-bubble element rendered in the mock
 *      DOM (which mirrors ChatGPT's `[data-message-author-role="user"]`)
 *      contains the ORIGINAL text back, restored by Iron Gate's DOM-level
 *      de-pseudonymization.
 *   3. **Response cleanliness**: the mock's assistant response (which
 *      echoes the pseudonyms it received, simulating ChatGPT's behavior)
 *      gets de-pseudonymized cleanly — no `entity["..."]` markers, no
 *      `cite_turnXsearchY` tokens, no byte-shift artifacts.
 *
 * How to run:
 *   pnpm build                # build extension (once)
 *   pnpm mock-server &        # start mock platform on :9000 (background)
 *   pnpm test:canary          # run the harness
 *   kill %1                   # stop mock server
 *
 * Or use the existing run-pipeline script which does all of the above:
 *   pnpm pipeline:wire
 */

import { test, expect, waitForInjection, typeIntoInput } from './fixtures';
import {
  CANARIES,
  ENTITY_MARKER_RE,
  CITE_TOKEN_RE,
} from './canary-prompts';

const MOCK_BASE = 'http://localhost:9000';

// How long to wait for the mock to render the user bubble after submit.
const BUBBLE_RENDER_TIMEOUT_MS = 10_000;
// Iron Gate's last user-bubble retry scan fires at 12s — give a margin.
const BUBBLE_DEPSEUDO_TIMEOUT_MS = 18_000;
// Mock response render is synchronous after the fetch resolves.
const RESPONSE_RENDER_TIMEOUT_MS = 15_000;

async function clearInterceptLog(): Promise<void> {
  await fetch(`${MOCK_BASE}/api/intercepted/clear`);
}

interface InterceptedRecord {
  platform: string;
  payload: { body?: string; query?: string; submittedText?: string };
}

async function getLastInterceptedForChatGPT(): Promise<InterceptedRecord | null> {
  const res = await fetch(`${MOCK_BASE}/api/intercepted`);
  const all = (await res.json()) as InterceptedRecord[];
  const filtered = all.filter((r) => r.platform === 'chatgpt');
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

async function enableProxyMode(extensionId: string, context: any): Promise<void> {
  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await sidepanel.waitForTimeout(800);
  await sidepanel.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(
        {
          firmMode: 'proxy',
          connectionState: { connected: true, firmId: 'canary', firmName: 'Canary Suite' },
        },
        () => resolve(),
      );
    });
  });
  await sidepanel.close();
}

test.describe.configure({ mode: 'serial' });

test.describe('ChatGPT (mock) — canary regression suite', () => {
  test.beforeAll(async () => {
    // Defensive: ensure the mock server is reachable before any test runs.
    // If `pnpm mock-server` wasn't started, fail loudly with a clear hint.
    try {
      const r = await fetch(`${MOCK_BASE}/api/intercepted`, { method: 'GET' });
      if (!r.ok) throw new Error(`mock server returned ${r.status}`);
    } catch (err) {
      throw new Error(
        `Mock server at ${MOCK_BASE} not reachable. Start it with:\n` +
        `    pnpm mock-server\n` +
        `(or use \`pnpm pipeline:wire\` which starts it for you)\n` +
        `Original error: ${(err as Error).message}`,
      );
    }
  });

  for (const canary of CANARIES) {
    test(`${canary.id}: wire-leak proof`, async ({ context, extensionId }) => {
      await enableProxyMode(extensionId, context);
      await clearInterceptLog();

      const page = await context.newPage();
      await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);
      await page.waitForTimeout(1500);

      const typed = await typeIntoInput(page, ['#prompt-textarea'], canary.prompt);
      expect(typed, 'failed to type canary prompt').toBe(true);
      await page.waitForTimeout(400);

      // The mock UI submits via Enter — matches ChatGPT's keyboard handler
      await page.click('#prompt-textarea');
      await page.keyboard.press('Enter');

      // Mock receives the fetch within ~1s of submit.
      const intercepted = await expect
        .poll(getLastInterceptedForChatGPT, { timeout: 10_000, intervals: [200, 500, 1000] })
        .toBeTruthy();

      // pnpm exec playwright's poll returns the resolved value via the
      // assertion chain — we re-fetch for the actual data here. (Playwright
      // API limitation: poll's value isn't accessible after the assertion.)
      const record = await getLastInterceptedForChatGPT();
      expect(record).not.toBeNull();
      const wireText =
        record!.payload.body || record!.payload.query || record!.payload.submittedText || '';

      const leaked = canary.sensitiveStrings.filter((s) => wireText.includes(s));
      expect(
        leaked,
        `Wire leak: ${leaked.join(', ')} reached the platform. Full wire body (first 400ch):\n${wireText.substring(0, 400)}`,
      ).toEqual([]);
    });

    test(`${canary.id}: bubble shows originals after de-pseudo`, async ({ context, extensionId }) => {
      await enableProxyMode(extensionId, context);
      await clearInterceptLog();

      const page = await context.newPage();
      await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);
      await page.waitForTimeout(1500);

      await typeIntoInput(page, ['#prompt-textarea'], canary.prompt);
      await page.waitForTimeout(400);
      await page.click('#prompt-textarea');
      await page.keyboard.press('Enter');

      // Wait for the user bubble to render with substantive content.
      await page.waitForFunction(
        () => {
          const bubbles = document.querySelectorAll('[data-message-author-role="user"]');
          const last = bubbles[bubbles.length - 1];
          return last && (last.textContent || '').length > 20;
        },
        { timeout: BUBBLE_RENDER_TIMEOUT_MS },
      );

      // Iron Gate's DOM-level de-pseudo runs at delayed intervals up to 12s.
      // Poll for each expected original — fails fast on the FIRST missing one
      // with a clear message naming which string Iron Gate didn't restore.
      for (const expected of canary.expectedInBubble) {
        await expect
          .poll(
            async (): Promise<boolean> => {
              const text = await page.evaluate(() => {
                const bubbles = document.querySelectorAll('[data-message-author-role="user"]');
                const last = bubbles[bubbles.length - 1];
                return last ? last.textContent || '' : '';
              });
              return text.includes(expected);
            },
            {
              message: `User bubble missing original "${expected}" after de-pseudo`,
              timeout: BUBBLE_DEPSEUDO_TIMEOUT_MS,
              intervals: [500, 1000, 2000, 4000],
            },
          )
          .toBe(true);
      }
    });

    test(`${canary.id}: response has no marker/cite-token corruption`, async ({ context, extensionId }) => {
      await enableProxyMode(extensionId, context);
      await clearInterceptLog();

      const page = await context.newPage();
      await page.goto(`${MOCK_BASE}/chatgpt`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => waitForInjection(page), { timeout: 15_000 }).toBe(true);
      await page.waitForTimeout(1500);

      await typeIntoInput(page, ['#prompt-textarea'], canary.prompt);
      await page.waitForTimeout(400);
      await page.click('#prompt-textarea');
      await page.keyboard.press('Enter');

      // Wait for the mock's assistant response (it echoes the pseudonymized
      // text back, which is what a real LLM does — but Iron Gate is
      // supposed to clean any markers + restore pseudonyms before render).
      await page.waitForFunction(
        () => {
          const responses = document.querySelectorAll(
            '[data-message-author-role="assistant"]',
          );
          return Array.from(responses).some(
            (r) => (r.textContent || '').length > 50 && !(r.textContent || '').startsWith('Hello!'),
          );
        },
        { timeout: RESPONSE_RENDER_TIMEOUT_MS },
      );

      // Give post-render de-pseudo a moment to settle.
      await page.waitForTimeout(2000);

      const responseText = await page.evaluate(() => {
        const responses = document.querySelectorAll(
          '[data-message-author-role="assistant"]',
        );
        const last = responses[responses.length - 1];
        return last ? last.textContent || '' : '';
      });

      expect(
        responseText.match(ENTITY_MARKER_RE),
        `Response contains raw entity[..] marker (first 200ch): "${responseText.substring(0, 200)}"`,
      ).toBeNull();
      expect(
        responseText.match(CITE_TOKEN_RE),
        `Response contains raw citation token (first 200ch): "${responseText.substring(0, 200)}"`,
      ).toBeNull();
    });
  }
});

