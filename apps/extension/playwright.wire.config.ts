/**
 * Playwright config dedicated to wire-verification tests.
 *
 * Why a separate config from playwright.config.ts:
 *   - The main e2e suite hits real chatgpt.com / claude.ai / gemini.google.com
 *     and is inherently account-gated + brittle.
 *   - Wire-verification tests use ONLY our mocked platforms at localhost:9000
 *     so they are deterministic, fully automated, and safe to run in CI.
 *   - This config boots the mock server automatically via `webServer`.
 */

import { defineConfig } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, 'dist');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /wire-verification\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list']],

  // Boot the mock platform server before any test runs.
  // The tests use http://localhost:9000/{chatgpt,claude,gemini}. Playwright
  // waits until the server answers before starting the suite, and tears it
  // down when the suite ends.
  webServer: {
    command: 'node tests/mocked-platforms/server.mjs',
    url: 'http://localhost:9000/api/intercepted',
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'wire-chromium',
      use: {
        launchOptions: {
          headless: false, // Chrome extensions require headed mode
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--no-first-run',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },
  ],
});
