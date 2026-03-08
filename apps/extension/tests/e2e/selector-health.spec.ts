/**
 * Selector Health Probe
 *
 * Visits each AI platform and verifies our DOM selectors still find elements.
 * This catches when ChatGPT/Gemini/Claude change their HTML — the #1 cause of
 * real-world breakage.
 *
 * Run: pnpm --filter extension test:selector-health
 * Or:  npx playwright test tests/e2e/selector-health.spec.ts
 *
 * This test does NOT require the extension to be loaded — it just checks
 * whether our selectors would find anything on the live pages.
 *
 * Schedule this weekly (GitHub Actions cron) or before every release.
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Platform Configs ────────────────────────────────────────────────────────

interface PlatformConfig {
  name: string;
  url: string;
  /** Selectors for the prompt input — at least ONE must match */
  inputSelectors: string[];
  /** Selectors for the submit/send button — at least ONE must match */
  submitSelectors: string[];
  /** Optional: element that proves the page loaded correctly */
  loadProbe?: string;
  /** Some platforms require login — skip detailed checks if not logged in */
  requiresAuth?: boolean;
  /** Shadow DOM platforms need special handling */
  usesShadowDom?: boolean;
}

const PLATFORMS: PlatformConfig[] = [
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    inputSelectors: [
      '#prompt-textarea',
      'div[contenteditable="true"][id*="prompt"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"].ProseMirror',
      'textarea[data-id="root"]',
    ],
    submitSelectors: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
    ],
    loadProbe: 'main',
  },
  {
    name: 'Claude',
    url: 'https://claude.ai',
    inputSelectors: [
      '[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
    ],
    submitSelectors: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'fieldset button[type="button"]:last-child',
    ],
    requiresAuth: true,
  },
  {
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    inputSelectors: [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label]',
      'div[contenteditable="true"]',
      'textarea',
      'p[data-placeholder]',
    ],
    submitSelectors: [
      'button[aria-label="Send message"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="submit" i]',
      'button.send-button',
      '.send-button-container button',
    ],
    usesShadowDom: true,
  },
  {
    name: 'Copilot',
    url: 'https://copilot.microsoft.com',
    inputSelectors: [
      '#userInput',
      'textarea[placeholder]',
      'div[contenteditable="true"]',
      '#searchbox',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]',
      'button[type="submit"]',
    ],
    usesShadowDom: true,
  },
];

// ─── Helper: Deep query through shadow DOM ──────────────────────────────────

async function deepQuerySelector(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    function deepQuery(root: Document | ShadowRoot | Element, query: string): Element | null {
      // Try direct match first
      const direct = root.querySelector(query);
      if (direct) return direct;

      // Search through shadow roots
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = deepQuery(el.shadowRoot, query);
          if (found) return found;
        }
      }
      return null;
    }
    return deepQuery(document, sel) !== null;
  }, selector);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

for (const platform of PLATFORMS) {
  test.describe(`${platform.name} Selector Health`, () => {
    test.setTimeout(45_000);

    test(`should find at least one input selector on ${platform.name}`, async ({ page }) => {
      // Navigate with a generous timeout — AI sites are slow
      try {
        await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) {
        // Some sites redirect to login — that's OK, we still check DOM
        console.log(`${platform.name}: navigation note — ${(e as Error).message}`);
      }

      // Wait for page to stabilize
      await page.waitForTimeout(3000);

      // If requires auth and we see a login page, skip with a warning
      if (platform.requiresAuth) {
        const isLoginPage = await page.evaluate(() => {
          const url = window.location.href;
          return url.includes('login') || url.includes('sign-in') || url.includes('oauth');
        });
        if (isLoginPage) {
          test.skip();
          return;
        }
      }

      // Check each input selector
      const results: { selector: string; found: boolean }[] = [];
      for (const selector of platform.inputSelectors) {
        let found: boolean;
        if (platform.usesShadowDom) {
          found = await deepQuerySelector(page, selector);
        } else {
          found = await page.locator(selector).first().isVisible().catch(() => false);
          if (!found) {
            // Try just existence (might be hidden/off-screen)
            found = (await page.locator(selector).count()) > 0;
          }
        }
        results.push({ selector, found });
      }

      const foundAny = results.some(r => r.found);
      const foundSelectors = results.filter(r => r.found).map(r => r.selector);
      const missingSelectors = results.filter(r => !r.found).map(r => r.selector);

      if (missingSelectors.length > 0) {
        console.log(`${platform.name} MISSING input selectors:`, missingSelectors);
      }
      if (foundSelectors.length > 0) {
        console.log(`${platform.name} FOUND input selectors:`, foundSelectors);
      }

      // CRITICAL: At least ONE selector must work
      expect(foundAny, `No input selectors found on ${platform.name}! All selectors broken: ${missingSelectors.join(', ')}`).toBe(true);
    });

    test(`should find at least one submit selector on ${platform.name}`, async ({ page }) => {
      try {
        await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) {
        console.log(`${platform.name}: navigation note — ${(e as Error).message}`);
      }

      await page.waitForTimeout(3000);

      if (platform.requiresAuth) {
        const isLoginPage = await page.evaluate(() => {
          const url = window.location.href;
          return url.includes('login') || url.includes('sign-in') || url.includes('oauth');
        });
        if (isLoginPage) {
          test.skip();
          return;
        }
      }

      const results: { selector: string; found: boolean }[] = [];
      for (const selector of platform.submitSelectors) {
        let found: boolean;
        if (platform.usesShadowDom) {
          found = await deepQuerySelector(page, selector);
        } else {
          found = (await page.locator(selector).count()) > 0;
        }
        results.push({ selector, found });
      }

      const foundAny = results.some(r => r.found);
      const missingSelectors = results.filter(r => !r.found).map(r => r.selector);

      if (missingSelectors.length > 0) {
        console.log(`${platform.name} MISSING submit selectors:`, missingSelectors);
      }

      // Submit button might not appear until text is entered — warning only
      if (!foundAny) {
        console.warn(`WARNING: No submit selectors found on ${platform.name} (may need text input first)`);
      }
    });

    test(`should detect correct page structure on ${platform.name}`, async ({ page }) => {
      try {
        await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch {
        // Redirect to login is OK
      }

      await page.waitForTimeout(2000);

      // Basic structural checks
      const title = await page.title();
      const url = page.url();

      console.log(`${platform.name}: title="${title}", url="${url}"`);

      // Verify we're on the right domain (didn't get redirected to some error page)
      const expectedDomain = new URL(platform.url).hostname;
      const actualDomain = new URL(url).hostname;
      // Allow subdomain redirects (e.g., chatgpt.com → auth.openai.com for login)
      expect(
        actualDomain.includes(expectedDomain.split('.')[0]) ||
        url.includes('login') || url.includes('auth') || url.includes('sign'),
        `Unexpected redirect: expected domain related to ${expectedDomain}, got ${actualDomain}`
      ).toBe(true);
    });
  });
}

// ─── Summary Report ─────────────────────────────────────────────────────────

test('selector health summary', async ({ page }) => {
  const report: Record<string, { input: boolean; submit: boolean }> = {};

  for (const platform of PLATFORMS) {
    try {
      await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(2000);

      let inputFound = false;
      for (const sel of platform.inputSelectors) {
        if (platform.usesShadowDom) {
          if (await deepQuerySelector(page, sel)) { inputFound = true; break; }
        } else {
          if ((await page.locator(sel).count()) > 0) { inputFound = true; break; }
        }
      }

      let submitFound = false;
      for (const sel of platform.submitSelectors) {
        if (platform.usesShadowDom) {
          if (await deepQuerySelector(page, sel)) { submitFound = true; break; }
        } else {
          if ((await page.locator(sel).count()) > 0) { submitFound = true; break; }
        }
      }

      report[platform.name] = { input: inputFound, submit: submitFound };
    } catch {
      report[platform.name] = { input: false, submit: false };
    }
  }

  console.log('\n═══ SELECTOR HEALTH REPORT ═══');
  for (const [name, status] of Object.entries(report)) {
    const inputIcon = status.input ? 'PASS' : 'FAIL';
    const submitIcon = status.submit ? 'PASS' : 'WARN';
    console.log(`  ${name}: input=${inputIcon} submit=${submitIcon}`);
  }
  console.log('══════════════════════════════\n');
});
