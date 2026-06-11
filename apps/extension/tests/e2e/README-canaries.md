# Canary harness

End-to-end regression tests that run Iron Gate against a high-fidelity
**mock** of chatgpt.com in a headed Chromium. Why mock: anonymous
chatgpt.com blocks automated Chromium (bot detection serves blank pages),
and a logged-in flow requires stored creds + anti-bot evasion that's out
of scope for the daily harness. The mock at `tests/mocked-platforms/`
mirrors ChatGPT's DOM exactly — same selectors, same wire format, no
anti-bot interference. It catches every bug class we hit during the May
2026 sessions:

- Wire-level PII leak (the security-critical assertion)
- User bubble showing pseudonyms instead of originals
- Response text corruption (`entity["..."]` markers, `cite_turnXsearchY`
  citation tokens, byte-shift artifacts)

The whole point: I can run this myself locally on every fix, so you no
longer have to be the QA loop.

## What gets tested

For each canary in [canary-prompts.ts](./canary-prompts.ts), three tests run:

| Test | What it asserts |
|---|---|
| `wire-leak proof` | The actual `/backend-(api\|anon)/conversation` request body does **not** contain any of the canary's sensitive strings. |
| `bubble shows originals` | After ChatGPT renders the user bubble, every original PII string is restored to the bubble by Iron Gate's DOM-level de-pseudonymization. |
| `response renders without entity/cite-token corruption` | The assistant response text contains no `entity[` markers or `cite_turn0searchN`-style citation tokens. |

## How to run

```bash
# 1. Build the extension once
pnpm build

# 2. Start the mock platform server (port 9000) — runs in background
pnpm mock-server &

# 3. Run the canaries (opens a headed Chromium window)
pnpm test:canary

# 4. Stop the mock server when done
kill %1
```

The first run downloads Chromium if Playwright hasn't yet —
`pnpm exec playwright install chromium`.

If the mock server isn't reachable, the test suite fails fast with a clear
message instead of timing out on every assertion.

## What success looks like

```
Running 12 tests using 1 worker
  ✓ ChatGPT — real-platform canaries › healthcare-discharge: wire-leak proof
  ✓ ChatGPT — real-platform canaries › healthcare-discharge: bubble shows originals after de-pseudo
  ✓ ChatGPT — real-platform canaries › healthcare-discharge: response renders without entity/cite-token corruption
  ✓ legal-litigation-hold: ...
  ...
12 passed (3.4m)
```

Run takes ~3–5 minutes for all four canaries × three test phases. Real
ChatGPT streaming responses are the bottleneck.

## When a test fails

Playwright preserves these artifacts in `test-results/`:

- **Trace** (`trace.zip`): full DOM + network history. `npx playwright show-trace test-results/.../trace.zip`
- **Screenshot**: page state at failure
- **Video**: replay of the whole test

For a wire-leak failure, the assertion message tells you exactly which
strings leaked. For a bubble failure, the message tells you which original
never appeared in the bubble within 18 s. For a response-corruption failure,
the first 200 chars of the offending response are dumped into the assertion
message.

## Adding a new canary

Edit [canary-prompts.ts](./canary-prompts.ts). Add an entry to `CANARIES`:

```ts
{
  id: 'short-kebab-id',                       // shows up in test names
  name: 'Human description',
  prompt: 'The literal text typed into ChatGPT...',
  sensitiveStrings: [                          // must NEVER reach the wire
    'PII string 1',
    'PII string 2',
  ],
  expectedInBubble: [                          // must appear in user bubble after de-pseudo
    'PII string 1',
    'PII string 2',
  ],
}
```

The three tests for the new canary are generated automatically — no other
file changes needed.

## Known limitations

- **Mock-based, not real chatgpt.com.** Mock catches: wire-level PII leak,
  DOM-selector compatibility, de-pseudonymization correctness, response
  marker corruption. Does NOT catch: ChatGPT-specific SSE format changes
  (only real chatgpt.com produces new `entity["..."]` variants), real
  network edge cases, or anti-bot interference. Real-platform spot-checks
  remain a manual exercise when a specific bug is reported.
- **No Claude / Gemini specs yet.** Planned next. Mock pages already exist
  at `tests/mocked-platforms/{claude,gemini}.html` — only the spec file
  needs to be written.
- **Mocks evolve with ChatGPT's real DOM.** If ChatGPT changes
  `#prompt-textarea` or `[data-message-author-role]`, update both
  `PLATFORMS.chatgpt` in `fixtures.ts` AND the mock HTML to match.

## Why this exists

Across many sessions of manual testing, the same bug classes kept
recurring: wire leaks, bubble showing pseudonyms, entity-marker
corruption. Unit tests passed (2,178 of them) but never caught the
user-visible behavior. This harness is the missing test layer — it
exercises the full pipeline against the real platform and asserts on
what the user actually sees.
