/**
 * Architecture Invariant Tests
 *
 * These tests enforce structural rules in main-world.ts that prevent entire
 * classes of bugs from re-emerging. Every fix that ships should be enforced
 * here so future code can't reintroduce the same defect.
 *
 * Pattern: read source files as text, assert structural properties.
 *
 * If a test fails, DO NOT just update the count — investigate WHY a new
 * occurrence appeared. The whole point is to catch architectural regressions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');
const MAIN_WORLD_PATH = join(REPO_ROOT, 'apps/extension/src/content/main-world.ts');
const ADAPTERS_DIR = join(REPO_ROOT, 'apps/extension/src/content/adapters');

function readMainWorld(): string {
  return readFileSync(MAIN_WORLD_PATH, 'utf8');
}

describe('Architecture Invariants — Pseudonymization Centralization', () => {
  it('addReverseMapping(currentReverseMap, ...) must only be called from registerPseudonymization', () => {
    const src = readMainWorld();
    const matches = src.match(/addReverseMapping\(currentReverseMap/g) ?? [];
    // Exactly 1 match: the call inside registerPseudonymization itself.
    // If this exceeds 1, a new call site has bypassed the centralized hook —
    // which means session entity registration AND DOM rescans will be missed.
    expect(matches.length).toBe(1);
  });

  it('every code path that pseudonymizes must call registerPseudonymization', () => {
    const src = readMainWorld();
    // Sanity check: registerPseudonymization should be defined and called multiple times.
    expect(src).toMatch(/function registerPseudonymization/);
    const callMatches = src.match(/registerPseudonymization\(/g) ?? [];
    // 1 definition + at least 5 call sites (fetch local, fetch DEF-016, XHR, WS, DOM-presubmit)
    expect(callMatches.length).toBeGreaterThanOrEqual(6);
  });

  it('_sessionEntities.add() should only appear inside registerPseudonymization', () => {
    const src = readMainWorld();
    const matches = src.match(/_sessionEntities\.add\(/g) ?? [];
    // Exactly 1: inside registerPseudonymization. Direct calls indicate a bypass.
    expect(matches.length).toBe(1);
  });
});

describe('Architecture Invariants — Response Wrapping Centralization', () => {
  it('bare return originalFetch.call should be minimal (≤2 occurrences)', () => {
    const src = readMainWorld();
    const matches = src.match(/return originalFetch\.call/g) ?? [];
    // Acceptable: non-LLM passthrough cases. Anything more = response wrap bypass.
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('wrapResponse() must be defined and used for fetch returns', () => {
    const src = readMainWorld();
    expect(src).toMatch(/function wrapResponse/);
    const callMatches = src.match(/wrapResponse\(/g) ?? [];
    // 1 definition + at least 5 call sites at fetch exit points
    expect(callMatches.length).toBeGreaterThanOrEqual(6);
  });

  it('depseudonymizeResponse should not be called directly from patchedFetch — go through wrapResponse', () => {
    const src = readMainWorld();
    // Direct calls outside the centralized helpers and the depseudonymizeResponse definition itself
    const matches = src.match(/return depseudonymizeResponse\(/g) ?? [];
    // Allowed: 1 inside wrapResponse, plus a few in cases where requestReverseMap snapshot matters
    // (server mode, local mode pseudonymize result — these pass an explicit snapshot, not currentReverseMap).
    // Cap at 5 — anything more indicates wrapResponse should have been used.
    expect(matches.length).toBeLessThanOrEqual(5);
  });
});

describe('Architecture Invariants — Adapter Contract', () => {
  it('every adapter must export a SiteAdapter with required methods', async () => {
    const adapterFiles = await glob('*.ts', { cwd: ADAPTERS_DIR });
    const platformAdapters = adapterFiles.filter(
      f => f !== 'base.ts' && f !== 'index.ts' && f !== 'registry.ts' && !f.endsWith('.test.ts'),
    );

    expect(platformAdapters.length).toBeGreaterThanOrEqual(10);

    for (const file of platformAdapters) {
      const src = readFileSync(join(ADAPTERS_DIR, file), 'utf8');
      // Required methods on every adapter
      expect(src, `${file}: missing extractPrompt`).toMatch(/extractPrompt/);
      expect(src, `${file}: missing replacePrompt`).toMatch(/replacePrompt/);
      expect(src, `${file}: missing hostPatterns`).toMatch(/hostPatterns/);
      expect(src, `${file}: missing interception`).toMatch(/interception/);
    }
  });

  it('adapters using sse-content strategy must implement extractResponseContent', async () => {
    const adapterFiles = await glob('*.ts', { cwd: ADAPTERS_DIR });
    const platformAdapters = adapterFiles.filter(
      f => f !== 'base.ts' && f !== 'index.ts' && f !== 'registry.ts' && !f.endsWith('.test.ts'),
    );

    for (const file of platformAdapters) {
      const src = readFileSync(join(ADAPTERS_DIR, file), 'utf8');
      const usesSseContent = /responseStreamStrategy:\s*['"]sse-content['"]/.test(src);
      if (usesSseContent) {
        expect(src, `${file}: sse-content strategy requires extractResponseContent`).toMatch(/extractResponseContent/);
        expect(src, `${file}: sse-content strategy requires injectResponseContent`).toMatch(/injectResponseContent/);
      }
    }
  });

  it('every wire-interception adapter must declare responseStreamStrategy explicitly', async () => {
    const adapterFiles = await glob('*.ts', { cwd: ADAPTERS_DIR });
    const platformAdapters = adapterFiles.filter(
      f => f !== 'base.ts' && f !== 'index.ts' && f !== 'registry.ts' && !f.endsWith('.test.ts'),
    );

    for (const file of platformAdapters) {
      const src = readFileSync(join(ADAPTERS_DIR, file), 'utf8');
      const isWire = /interception:\s*['"]wire['"]/.test(src);
      if (isWire) {
        // Wire adapters intercept fetch — they must explicitly declare how
        // their response stream is parsed (sse-content / raw-chunk / none).
        // Implicit defaults are a footgun.
        expect(src, `${file}: wire adapter must declare responseStreamStrategy`).toMatch(
          /responseStreamStrategy:\s*['"](sse-content|raw-chunk|none)['"]/,
        );
      }
    }
  });
});

describe('Architecture Invariants — De-pseudonymization Engine', () => {
  it('naive split/join replacement must not be used for de-pseudonymization', () => {
    const src = readMainWorld();
    // Catch the old anti-pattern: result.split(pseudonym).join(original)
    // Use replacePseudonyms() or replacePseudonymsCore() instead.
    const naivePatterns = [
      /\.split\(pseudonym\)\.join\(original\)/g,
      /\.split\(fake\)\.join\(orig\)/g,
    ];
    for (const pattern of naivePatterns) {
      const matches = src.match(pattern) ?? [];
      expect(matches.length, `Naive de-pseudo pattern found: ${pattern}`).toBe(0);
    }
  });

  it('depseudo-engine.ts must include hyphen and dot in word-boundary check', () => {
    const enginePath = join(REPO_ROOT, 'apps/extension/src/content/main-world/depseudo-engine.ts');
    const src = readFileSync(enginePath, 'utf8');
    // The leak scanner's isWordConnected must include 45 (hyphen) and 46 (dot)
    // to prevent matching inside domains like meridian-legal.com
    expect(src).toMatch(/c === 45/); // hyphen
    expect(src).toMatch(/c === 46/); // dot
  });
});

describe('Architecture Invariants — Console Output Hygiene', () => {
  it('main-world.ts must gate console output behind ironGateDebug flag', () => {
    const src = readMainWorld();
    // The production console gate must exist
    expect(src).toMatch(/Production Console Gate/);
    expect(src).toMatch(/ironGateDebug/);
    expect(src).toMatch(/console\.log = \(/);
  });
});

describe('Architecture Invariants — Session State', () => {
  it('_countSessionEntityReferences must support both full-entity and word-level matching', () => {
    const src = readMainWorld();
    expect(src).toMatch(/function _countSessionEntityReferences/);
    // The function should check both full-text inclusion AND word-level matching
    // (catches "Sarah Chen" when registry has "Dr. Sarah Chen")
    const fnSrc = src.match(/function _countSessionEntityReferences[\s\S]+?^}/m)?.[0] ?? '';
    expect(fnSrc, 'word-level matching missing').toMatch(/words\.every/);
  });

  it('session entities must be cleared on conversation boundary', () => {
    const src = readMainWorld();
    expect(src).toMatch(/_sessionEntities\.clear/);
  });
});

describe('Architecture Invariants — Security', () => {
  it('Symbol.for() must not be used for the duplicate execution guard', () => {
    const src = readMainWorld();
    // H-15: Symbol.for is globally discoverable. Use data-attribute instead.
    const symbolForMatches = src.match(/Symbol\.for\(['"]__ig/g) ?? [];
    expect(symbolForMatches.length).toBe(0);
  });

  it('originalPrompt must not be sent via postMessage', () => {
    const src = readMainWorld();
    // M-7: originalPrompt sent via postMessage is interceptable by page scripts
    const matches = src.match(/originalPrompt:\s*promptText/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it('encryptedGet must not fall back to raw stored values on decryption failure', () => {
    const authPath = join(REPO_ROOT, 'apps/extension/src/worker/auth.ts');
    const src = readFileSync(authPath, 'utf8');
    // CRIT-4: Decryption fallback to plaintext is a security hole
    // The catch block must NOT do `result[k] = stored[k]`
    const fnMatch = src.match(/async function encryptedGet[\s\S]+?^}/m)?.[0] ?? '';
    expect(fnMatch).not.toMatch(/result\[k\]\s*=\s*stored\[k\]/);
    expect(fnMatch).toMatch(/result\[k\]\s*=\s*null/);
  });
});
