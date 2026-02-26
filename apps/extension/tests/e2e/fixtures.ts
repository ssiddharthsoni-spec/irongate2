/**
 * Shared Playwright fixtures for IronGate Chrome extension E2E tests.
 *
 * Provides:
 * - Persistent browser context with extension loaded
 * - Extension ID discovery
 * - Side panel page access
 * - Injection verification helpers
 * - Console log collection
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

// ── Test Scenarios (mirror qa-scenarios.test.ts) ─────────────────────────

export const SCENARIOS = {
  scenario1_basic_pii: {
    name: 'Scenario 1: Basic PII (Names + Email)',
    prompt: 'Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?',
    minEntities: 3,
    minScore: 20,
    expectedLevel: ['medium', 'high'],
  },
  scenario2_financial: {
    name: 'Scenario 2: Financial Data (Credit Card + SSN)',
    prompt: 'I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.',
    minEntities: 3,
    minScore: 40,
    expectedLevel: ['high', 'critical'],
  },
  scenario3_api_keys: {
    name: 'Scenario 3: API Keys & Credentials',
    prompt: 'My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?',
    minEntities: 1,
    minScore: 15,
    expectedLevel: ['medium', 'high', 'critical'],
  },
  scenario6_false_positive: {
    name: 'Scenario 6: Minimal Content (False Positive Check)',
    prompt: 'Can you explain how photosynthesis works in simple terms?',
    minEntities: 0,
    maxEntities: 1,
    minScore: 0,
    maxScore: 10,
    expectedLevel: ['low'],
  },
  scenario7_brand_names: {
    name: 'Scenario 7: Edge Case — Common Names in Context',
    prompt: "I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?",
    minEntities: 0,
    maxEntities: 2,
    minScore: 0,
    maxScore: 25,
    expectedLevel: ['low', 'medium'],
  },
} as const;

// ── Platform selectors ───────────────────────────────────────────────────

export const PLATFORMS = {
  chatgpt: {
    url: 'https://chatgpt.com',
    name: 'ChatGPT',
    inputSelectors: ['#prompt-textarea', 'div[contenteditable="true"][id*="prompt"]', 'div[contenteditable="true"].ProseMirror'],
    submitSelectors: ['button[data-testid="send-button"]', 'button[data-testid="composer-send-button"]'],
  },
  claude: {
    url: 'https://claude.ai',
    name: 'Claude',
    inputSelectors: ['[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label="Send Message"]', 'button[aria-label="Send message"]'],
  },
  gemini: {
    url: 'https://gemini.google.com',
    name: 'Gemini',
    inputSelectors: ['.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
    submitSelectors: ['button[aria-label="Send message"]', 'button[aria-label*="send" i]'],
  },
  copilot: {
    url: 'https://copilot.microsoft.com',
    name: 'Copilot',
    inputSelectors: ['#userInput', 'textarea[placeholder]'],
    submitSelectors: ['button[aria-label="Submit"]', 'button[aria-label="Send"]'],
  },
  perplexity: {
    url: 'https://perplexity.ai',
    name: 'Perplexity',
    inputSelectors: ['textarea[placeholder*="Ask"]', 'textarea'],
    submitSelectors: ['button[aria-label="Submit"]', 'button[type="submit"]'],
  },
} as const;

// ── Custom test fixture ──────────────────────────────────────────────────

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
  // Launch persistent context with extension loaded
  context: async ({}, use) => {
    const userDataDir = path.join(__dirname, '../../.playwright-user-data');

    // Clean up stale profile
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    await use(context);
    await context.close();

    // Clean up profile after tests
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  // Discover extension ID from the service worker
  extensionId: async ({ context }, use) => {
    let extensionId = '';

    // Wait for the service worker to register
    let retries = 10;
    while (retries > 0) {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        const swUrl = workers[0].url();
        // chrome-extension://<id>/service-worker-loader.js
        const match = swUrl.match(/chrome-extension:\/\/([a-z]+)\//);
        if (match) {
          extensionId = match[1];
          break;
        }
      }
      await new Promise(r => setTimeout(r, 500));
      retries--;
    }

    if (!extensionId) {
      throw new Error('Could not discover extension ID — is the extension built?');
    }

    await use(extensionId);
  },
});

export { expect } from '@playwright/test';

// ── Helper functions ─────────────────────────────────────────────────────

/**
 * Wait for IronGate MAIN world injection on the current page.
 * Polls `window.__IRON_GATE_MAIN_WORLD` until it returns 'active'.
 */
export async function waitForInjection(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await page.evaluate(() => (window as any).__IRON_GATE_MAIN_WORLD);
    if (status === 'active') return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Collect console messages matching the Iron Gate prefix.
 * Call this BEFORE navigating to the page, then read the array after.
 */
export function collectIronGateLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Iron Gate')) {
      logs.push(text);
    }
  });
  return logs;
}

/**
 * Find and return the first matching element from a list of selectors.
 */
export async function findElement(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const el = await page.$(selector);
    if (el) return selector;
  }
  return null;
}

/**
 * Type text into a contenteditable or textarea element.
 * Handles ProseMirror/Quill editors that need special input handling.
 */
export async function typeIntoInput(page: Page, selectors: readonly string[], text: string): Promise<boolean> {
  const selector = await findElement(page, selectors);
  if (!selector) return false;

  const el = await page.$(selector);
  if (!el) return false;

  // Check if it's a contenteditable (ProseMirror/Quill)
  const isContentEditable = await el.evaluate(e => e.getAttribute('contenteditable') === 'true');

  if (isContentEditable) {
    await el.click();
    await page.waitForTimeout(200);
    // Use keyboard.type for contenteditable to trigger proper input events
    await page.keyboard.type(text, { delay: 10 });
  } else {
    // Standard textarea/input
    await el.fill(text);
  }

  return true;
}

/**
 * Click the submit/send button.
 */
export async function clickSubmit(page: Page, selectors: readonly string[]): Promise<boolean> {
  const selector = await findElement(page, selectors);
  if (!selector) return false;

  await page.click(selector);
  return true;
}
