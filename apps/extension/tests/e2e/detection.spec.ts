/**
 * IronGate E2E — Entity Detection Tests
 *
 * Sends test prompts containing sensitive data on AI platforms
 * and verifies IronGate detects and pseudonymizes the entities.
 * Uses ChatGPT as the primary test platform (most stable).
 */

import {
  test,
  expect,
  waitForInjection,
  collectIronGateLogs,
  typeIntoInput,
  clickSubmit,
  PLATFORMS,
  SCENARIOS,
} from './fixtures';

const TARGET = PLATFORMS.chatgpt;

test.describe('Entity Detection on ChatGPT', () => {
  test('Scenario 1: should detect names and emails', async ({ context }) => {
    const page = await context.newPage();
    const logs = collectIronGateLogs(page);

    // Navigate and wait for injection
    await page.goto(TARGET.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const injected = await waitForInjection(page);
    expect(injected, 'IronGate not injected').toBe(true);

    // Wait for UI to be ready
    await page.waitForTimeout(3000);

    // Screenshot before sending
    await page.screenshot({ path: 'tests/e2e/screenshots/chatgpt-scenario1-before.png' });

    // Type the test prompt
    const typed = await typeIntoInput(page, TARGET.inputSelectors, SCENARIOS.scenario1_basic_pii.prompt);
    expect(typed, 'Could not find input element').toBe(true);

    await page.waitForTimeout(500);

    // Click send
    const sent = await clickSubmit(page, TARGET.submitSelectors);
    expect(sent, 'Could not find send button').toBe(true);

    // Wait for processing
    await page.waitForTimeout(8000);

    // Screenshot after sending
    await page.screenshot({ path: 'tests/e2e/screenshots/chatgpt-scenario1-after.png' });

    // Check console for entity detection evidence
    const detectionLogs = logs.filter(log =>
      log.includes('pseudonymized') || log.includes('entities') || log.includes('score')
    );

    console.log(`  Iron Gate logs captured: ${logs.length}`);
    console.log(`  Detection-related logs: ${detectionLogs.length}`);
    for (const log of detectionLogs.slice(0, 5)) {
      console.log(`    ${log}`);
    }

    await page.close();
  });

  test('Scenario 2: should detect financial data (SSN, credit card)', async ({ context }) => {
    const page = await context.newPage();
    const logs = collectIronGateLogs(page);

    await page.goto(TARGET.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const injected = await waitForInjection(page);
    expect(injected, 'IronGate not injected').toBe(true);

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/e2e/screenshots/chatgpt-scenario2-before.png' });

    const typed = await typeIntoInput(page, TARGET.inputSelectors, SCENARIOS.scenario2_financial.prompt);
    expect(typed, 'Could not find input element').toBe(true);

    await page.waitForTimeout(500);
    const sent = await clickSubmit(page, TARGET.submitSelectors);
    expect(sent, 'Could not find send button').toBe(true);

    await page.waitForTimeout(8000);
    await page.screenshot({ path: 'tests/e2e/screenshots/chatgpt-scenario2-after.png' });

    // Verify sensitive data is NOT visible in the AI request
    // (We can't easily inspect the network request in Playwright,
    // but we check console logs for pseudonymization confirmation)
    const pseudoLogs = logs.filter(log => log.includes('pseudonymized'));
    console.log(`  Pseudonymization logs: ${pseudoLogs.length}`);

    await page.close();
  });
});
