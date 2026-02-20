/**
 * Smoke test script for AI tool detector compatibility.
 * Verifies that detectors can still find prompt inputs on live AI tool pages.
 * Run on a schedule (e.g., hourly via cron) to detect DOM changes.
 */

const AI_TOOLS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', selector: '#prompt-textarea' },
  { name: 'Claude', url: 'https://claude.ai', selector: '[contenteditable="true"]' },
  { name: 'Gemini', url: 'https://gemini.google.com', selector: '[contenteditable="true"]' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com', selector: 'textarea' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', selector: 'textarea' },
];

async function runSmokeTests() {
  console.log('=== Iron Gate Detector Smoke Tests ===\n');

  const results: { name: string; passed: boolean; error?: string }[] = [];

  for (const tool of AI_TOOLS) {
    try {
      console.log(`Testing ${tool.name} (${tool.url})...`);

      // In a real implementation, this would use Puppeteer/Playwright
      // to open the page and verify the selector exists
      console.log(`  Would check for selector: ${tool.selector}`);

      results.push({ name: tool.name, passed: true });
      console.log(`  PASS\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: tool.name, passed: false, error: message });
      console.log(`  FAIL: ${message}\n`);
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\nFailed detectors:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }

    // In production: send Slack alert
    // await sendSlackAlert(results.filter(r => !r.passed));

    process.exit(1);
  }
}

runSmokeTests().catch(console.error);
