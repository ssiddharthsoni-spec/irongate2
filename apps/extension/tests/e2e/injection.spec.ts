/**
 * IronGate E2E — Extension Injection Tests
 *
 * Verifies that IronGate's MAIN world script loads correctly on each AI platform.
 * This is the most fundamental test: if injection fails, nothing else works.
 */

import { test, expect, waitForInjection, collectIronGateLogs, PLATFORMS } from './fixtures';

test.describe('Extension Injection', () => {
  for (const [platformId, platform] of Object.entries(PLATFORMS)) {
    test(`should inject on ${platform.name} (${platform.url})`, async ({ context }) => {
      const page = await context.newPage();
      const logs = collectIronGateLogs(page);

      // Navigate to the platform
      await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for IronGate MAIN world injection
      const injected = await waitForInjection(page, 15_000);
      expect(injected, `IronGate did not inject on ${platform.name}`).toBe(true);

      // Verify the injection marker
      const status = await page.evaluate(() => (window as any).__IRON_GATE_MAIN_WORLD);
      expect(status).toBe('active');

      // Check console logs for the expected adapter loading message
      const hasAdapterLog = logs.some(log =>
        log.includes('[Iron Gate MAIN]') && log.includes('adapter')
      );
      // Note: console log capture depends on timing, so we don't hard-fail on this
      if (hasAdapterLog) {
        console.log(`  ✓ ${platform.name}: adapter loaded (confirmed via console)`);
      }

      // Take a screenshot for the QA report
      await page.screenshot({
        path: `tests/e2e/screenshots/${platformId}-injection.png`,
        fullPage: false,
      });

      await page.close();
    });
  }
});
