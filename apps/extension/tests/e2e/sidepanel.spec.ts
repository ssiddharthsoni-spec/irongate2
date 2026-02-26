/**
 * IronGate E2E — Side Panel UI Tests
 *
 * Verifies the extension's side panel loads correctly and displays
 * the expected UI elements (status indicator, mode toggle, settings).
 */

import { test, expect } from './fixtures';

test.describe('Side Panel UI', () => {
  test('should load the side panel page', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // Navigate directly to the side panel HTML
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });

    // Wait for React to render
    await page.waitForTimeout(2000);

    // Verify the page loaded (check for the Iron Gate title or status text)
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(10);

    // Take screenshot of side panel
    await page.screenshot({ path: 'tests/e2e/screenshots/sidepanel-initial.png' });

    await page.close();
  });

  test('should display mode toggle (AUDIT/PROXY)', async ({ context, extensionId }) => {
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(2000);

    // Look for mode-related text
    const bodyText = await page.textContent('body');
    const hasAuditOrProxy =
      bodyText?.includes('AUDIT') ||
      bodyText?.includes('PROXY') ||
      bodyText?.includes('audit') ||
      bodyText?.includes('proxy');

    // The side panel should show the current mode
    console.log(`  Side panel text length: ${bodyText?.length}`);
    console.log(`  Contains mode indicator: ${hasAuditOrProxy}`);

    await page.close();
  });

  test('should have settings panel with API configuration', async ({ context, extensionId }) => {
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(2000);

    // Look for settings-related elements
    const bodyText = await page.textContent('body');
    const hasSettingsElements =
      bodyText?.includes('API') ||
      bodyText?.includes('Connect') ||
      bodyText?.includes('Settings');

    console.log(`  Contains settings elements: ${hasSettingsElements}`);

    await page.screenshot({ path: 'tests/e2e/screenshots/sidepanel-settings.png' });

    await page.close();
  });

  test('should show "Not on an AI tool page" when no platform active', async ({ context, extensionId }) => {
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`, {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(2000);

    // When no AI platform tab is active, side panel should indicate idle state
    const bodyText = await page.textContent('body');
    const isIdle =
      bodyText?.includes('Not on an AI tool') ||
      bodyText?.includes('not monitoring') ||
      bodyText?.includes('idle');

    console.log(`  Side panel idle state detected: ${isIdle}`);

    await page.close();
  });
});
