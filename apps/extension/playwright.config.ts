import { defineConfig } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, 'dist');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // Extensions share browser context — run sequentially
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    screenshot: 'on',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        // Chrome args to load the unpacked extension
        launchOptions: {
          headless: false, // Extensions require headed Chrome
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
