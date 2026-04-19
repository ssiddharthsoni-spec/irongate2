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
    // Delegate function exists in main-world.ts
    expect(src).toMatch(/_countSessionEntityReferences/);
    // Word-level matching is in the extracted session-entities.ts module
    const fs = require('fs');
    const sessionSrc = fs.readFileSync(
      require('path').join(__dirname, '../src/content/main-world/session-entities.ts'), 'utf-8'
    );
    expect(sessionSrc, 'word-level matching missing in session-entities.ts').toMatch(/words\.every/);
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

describe('Architecture Invariants — Sovereign AI / Local-Only Mode Contract', () => {
  // These invariants enforce the v1.0 product contract: when a customer is
  // configured for local-only mode, NO code path may make a server-side
  // classification call. This is the pillar of the "your prompts never leave
  // your device" pitch and any regression here is a P0 incident.

  const tier2Path = join(REPO_ROOT, 'apps/extension/src/detection/tier2-adapter.ts');
  const workerPath = join(REPO_ROOT, 'apps/extension/src/worker/index.ts');
  const manifestPath = join(REPO_ROOT, 'apps/extension/manifest.json');
  const managedSchemaPath = join(REPO_ROOT, 'apps/extension/managed_schema.json');

  it('tier2-adapter must export the locked-config primitives', () => {
    const src = readFileSync(tier2Path, 'utf8');
    expect(src).toMatch(/export\s+(async\s+)?function\s+initLocalLlmDeployment/);
    expect(src).toMatch(/export\s+function\s+getLockedDeploymentConfig/);
    expect(src).toMatch(/export\s+function\s+assertCloudCallsPermitted/);
    expect(src).toMatch(/export\s+(async\s+)?function\s+probeTier2Health/);
    expect(src).toMatch(/export\s+(async\s+)?function\s+warmupLocalLlm/);
  });

  it('local-only mode must reject non-localhost endpoints', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // The validator must check for localhost / 127.0.0.1 when mode is local-only
    expect(src).toMatch(/NON_LOCAL_ENDPOINT_IN_LOCAL_MODE/);
    expect(src).toMatch(/isLocalhostUrl/);
  });

  it('local-only mode must enforce no cloud fallback via assertCloudCallsPermitted', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // The privacy contract is enforced at the Tier 3 call site via
    // assertCloudCallsPermitted(), which throws with CLOUD_CALL_IN_LOCAL_MODE.
    // Tier 2 failures fall through to Tier 1 verdict — never to cloud.
    expect(src).toMatch(/assertCloudCallsPermitted/);
    expect(src).toMatch(/CLOUD_CALL_IN_LOCAL_MODE/);
    expect(src).toMatch(/local-only mode must never make outbound network calls during detection/);
  });

  it('default deployment mode must be local-only (no cloud escalation without explicit opt-in)', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // When no managed policy is present, default to local-only.
    // This prevents accidental cloud leakage for users who install the
    // extension without an MDM-pushed policy.
    expect(src).toMatch(/deploymentMode:\s*'local-only'/);
    expect(src).toMatch(/LOCAL-FIRST DEFAULT|local-first default/i);
  });

  it('Tier 3 (server-side classification) must be disabled by default', () => {
    const managedConfigPath = join(REPO_ROOT, 'apps/extension/src/managed-config.ts');
    const src = readFileSync(managedConfigPath, 'utf8');
    // DEFAULT_TIER_CONFIG must have tier3Enabled: false so cloud classification
    // requires explicit opt-in via managed policy (hybrid mode).
    expect(src).toMatch(/tier3Enabled:\s*false/);
  });

  it('locked deployment config must be frozen via Object.freeze', () => {
    const src = readFileSync(tier2Path, 'utf8');
    expect(src).toMatch(/Object\.freeze\(/);
  });

  it('manifest.json must reference managed_schema.json for IT-deployable policy', () => {
    const src = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(src);
    expect(manifest.storage?.managed_schema).toBe('managed_schema.json');
  });

  it('managed_schema.json must define the deploymentMode enum with all three values', () => {
    const src = readFileSync(managedSchemaPath, 'utf8');
    const schema = JSON.parse(src);
    const modeProperty = schema.properties?.deploymentMode;
    expect(modeProperty).toBeDefined();
    expect(modeProperty.enum).toEqual(['local-only', 'hybrid', 'server-only']);
    // Default must be local-only for privacy-first out-of-the-box behavior.
    // deploymentMode is no longer strictly required — the extension applies
    // local-only as the default when the managed policy omits it.
    expect(modeProperty.default).toBe('local-only');
  });

  it('managed_schema.json must define the audit log destination including "none"', () => {
    const src = readFileSync(managedSchemaPath, 'utf8');
    const schema = JSON.parse(src);
    const dest = schema.properties?.auditLogDestination;
    expect(dest).toBeDefined();
    expect(dest.enum).toContain('none');
    expect(dest.default).toBe('none'); // privacy-first default
  });

  it('worker must call initLocalLlmDeployment() at startup before any classification', () => {
    const src = readFileSync(workerPath, 'utf8');
    expect(src).toMatch(/initLocalLlmDeployment\(\)/);
    // Must register a desktop notification on init failure so users see it
    expect(src).toMatch(/iron-gate-deployment-error/);
  });

  it('worker must expose deployment status to the sidepanel via IRON_GATE_GET_DEPLOYMENT_STATUS', () => {
    const src = readFileSync(workerPath, 'utf8');
    expect(src).toMatch(/IRON_GATE_GET_DEPLOYMENT_STATUS/);
    expect(src).toMatch(/probeTier2Health/);
  });

  it('Tier 2 system prompt must include the Patterson-case clarification (benchmark fix)', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // From the benchmark, every model failed scenario #25 (litigation strategy) by
    // over-flagging "Patterson case" as red. The system prompt must explicitly
    // clarify that named legal cases alone are AMBER, not red.
    expect(src).toMatch(/NAMED LEGAL CASE.*AMBER/i);
  });

  it('Tier 2 system prompt must include API-key-in-prose clarification (benchmark fix)', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // From the benchmark, both top models missed scenario #14 (API key in debug
    // request). The system prompt must explicitly call out that strings starting
    // with sk-, pk-, ghp_, AKIA are CRITICAL even in technical prose.
    expect(src).toMatch(/sk-|API key/);
    expect(src).toMatch(/CRITICAL/);
  });

  it('the legacy regex JSON extractor must not be used (use brace-counting instead)', () => {
    const src = readFileSync(tier2Path, 'utf8');
    // The old regex /\{[^}]+\}/ failed on nested JSON. The new extractor counts braces.
    expect(src).toMatch(/extractFirstJsonObject/);
    expect(src).toMatch(/depth\+\+|depth--/);
  });

  it('deployment templates must exist for Intune, Jamf, and Workspace', () => {
    const enterpriseDir = join(REPO_ROOT, 'enterprise/deployment-templates');
    expect(() => readFileSync(join(enterpriseDir, 'intune-policy.xml'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(enterpriseDir, 'jamf-policy.plist'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(enterpriseDir, 'workspace-policy.json'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(enterpriseDir, 'README.md'), 'utf8')).not.toThrow();
  });

  it('deployment templates must default to local-only mode', () => {
    const enterpriseDir = join(REPO_ROOT, 'enterprise/deployment-templates');
    const intune = readFileSync(join(enterpriseDir, 'intune-policy.xml'), 'utf8');
    const jamf = readFileSync(join(enterpriseDir, 'jamf-policy.plist'), 'utf8');
    const workspace = readFileSync(join(enterpriseDir, 'workspace-policy.json'), 'utf8');
    expect(intune).toMatch(/"deploymentMode":\s*"local-only"/);
    expect(jamf).toMatch(/<string>local-only<\/string>/);
    expect(workspace).toMatch(/"deploymentMode".*?"local-only"/s);
  });

  it('deployment templates must use the recommended model (gemma4:e2b)', () => {
    const enterpriseDir = join(REPO_ROOT, 'enterprise/deployment-templates');
    const intune = readFileSync(join(enterpriseDir, 'intune-policy.xml'), 'utf8');
    const jamf = readFileSync(join(enterpriseDir, 'jamf-policy.plist'), 'utf8');
    const workspace = readFileSync(join(enterpriseDir, 'workspace-policy.json'), 'utf8');
    expect(intune).toContain('gemma4:e2b');
    expect(jamf).toContain('gemma4:e2b');
    expect(workspace).toContain('gemma4:e2b');
    // And the deprecated default MUST NOT reappear in templates — this is the
    // bright-line gate that keeps the product on one brain.
    expect(intune).not.toContain('llama3.2:3b');
    expect(jamf).not.toContain('llama3.2:3b');
    expect(workspace).not.toContain('llama3.2:3b');
  });

  // ── v1.0 Final: audit sink, signed bundle, firm pseudonymizer ──────────

  it('audit sink must implement all 5 destinations', () => {
    const sinkPath = join(REPO_ROOT, 'apps/extension/src/audit/audit-sink.ts');
    const src = readFileSync(sinkPath, 'utf8');
    expect(src).toMatch(/class NullSink/);
    expect(src).toMatch(/class WebhookSink/);
    expect(src).toMatch(/class SyslogSink/);
    expect(src).toMatch(/class S3PresignedSink/);
    expect(src).toMatch(/class IronGateDashboardSink/);
  });

  it('audit sinks must validate HTTPS for external destinations', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/audit/audit-sink.ts'), 'utf8');
    // Webhook sink rejects non-HTTPS URLs
    expect(src).toMatch(/webhook url must be HTTPS/);
    // Syslog sink rejects non-HTTPS URLs
    expect(src).toMatch(/syslog url must be HTTPS/);
    // S3 sink rejects non-HTTPS presigner URLs
    expect(src).toMatch(/presignerUrl must be HTTPS/);
  });

  it('audit buffer must persist to IndexedDB and survive restarts', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/audit/audit-buffer.ts'), 'utf8');
    expect(src).toMatch(/indexedDB\.open/);
    expect(src).toMatch(/restorePersisted/);
    // Must have retry queue with max age cap
    expect(src).toMatch(/MAX_RETRY_AGE_MS/);
  });

  it('signed policy bundle loader must use Ed25519 + canonical JSON', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/policy/signed-bundle.ts'), 'utf8');
    expect(src).toMatch(/Ed25519/);
    expect(src).toMatch(/canonicalJsonStringify/);
    // Public key is write-once
    expect(src).toMatch(/A different public key is already bound/);
    // Bundle expiry is checked
    expect(src).toMatch(/Bundle expired/);
  });

  it('firm pseudonymizer must use HKDF with the firm key as the secret', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/policy/firm-pseudonymizer.ts'), 'utf8');
    expect(src).toMatch(/HKDF/);
    expect(src).toMatch(/firmKey must be 32 bytes/);
    // Must derive bytes via SubtleCrypto, not Math.random
    expect(src).toMatch(/crypto\.subtle\.deriveBits/);
    // Must derive different bytes for different entity types (salt) and texts (info)
    expect(src).toMatch(/salt:\s*toBufferSource\(salt\)|salt:\s*salt|encode\(entityType\)/);
  });

  it('firm pseudonymizer must produce SSNs in the 900-999 area code (no real-SSN collision)', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/policy/firm-pseudonymizer.ts'), 'utf8');
    expect(src).toMatch(/900\s*\+\s*\(bytesToInt/);
  });

  it('firm pseudonymizer credit card output must use Luhn-valid digits', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/policy/firm-pseudonymizer.ts'), 'utf8');
    expect(src).toMatch(/luhnCheckDigit/);
  });

  it('Mac and Windows installer build scripts must exist', () => {
    expect(() => readFileSync(join(REPO_ROOT, 'enterprise/installer/build-mac-pkg.sh'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(REPO_ROOT, 'enterprise/installer/build-windows-msi.ps1'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(REPO_ROOT, 'enterprise/installer/MANIFEST.txt'), 'utf8')).not.toThrow();
  });

  it('Mac installer must register Ollama as a launchd service bound to localhost', () => {
    const src = readFileSync(join(REPO_ROOT, 'enterprise/installer/build-mac-pkg.sh'), 'utf8');
    expect(src).toMatch(/launchctl load/);
    expect(src).toMatch(/127\.0\.0\.1:11434/);
  });

  it('Windows installer must register Ollama as a Windows service', () => {
    const src = readFileSync(join(REPO_ROOT, 'enterprise/installer/build-windows-msi.ps1'), 'utf8');
    expect(src).toMatch(/sc\.exe create/);
  });

  it('marketing landing page must declare zero-egress positioning prominently', () => {
    const src = readFileSync(join(REPO_ROOT, 'marketing/index.html'), 'utf8');
    expect(src).toMatch(/never leave/i);
    expect(src).toMatch(/Sovereign/i);
  });

  it('security whitepaper must document the egress contract', () => {
    const src = readFileSync(join(REPO_ROOT, 'enterprise/runbook/security-whitepaper.md'), 'utf8');
    expect(src).toMatch(/egress/i);
    expect(src).toMatch(/127\.0\.0\.1/);
    expect(src).toMatch(/architecture invariant tests/i);
  });

  it('deployment runbook must include the fail-closed verification test', () => {
    const src = readFileSync(join(REPO_ROOT, 'enterprise/runbook/deployment-runbook.md'), 'utf8');
    expect(src).toMatch(/fail.closed/i);
    expect(src).toMatch(/launchctl unload|stop the Ollama/i);
  });

  // ── v1.0 Enterprise Hardening — the gap-audit fixes ──────────────

  it('Tier 3 server adapter must call assertCloudCallsPermitted before any network call', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/detection/tier3-server-adapter.ts'), 'utf8');
    // Must import the enforcement function
    expect(src).toMatch(/import\s*\{[^}]*assertCloudCallsPermitted[^}]*\}\s*from\s*['"]\.\/tier2-adapter['"]/);
    // Must call it inside classify() — we grep for the function call inside the file
    expect(src).toMatch(/assertCloudCallsPermitted\(['"]tier3-server-adapter\.classify['"]\)/);
    // Must NOT catch-and-swallow LocalDeploymentError (the throw must propagate)
    const classifyBlock = src.match(/async classify[\s\S]+?^    }/m)?.[0] ?? '';
    expect(classifyBlock).toMatch(/assertCloudCallsPermitted/);
  });

  it('Tier 3 isAvailable() must return false in local-only mode', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/detection/tier3-server-adapter.ts'), 'utf8');
    expect(src).toMatch(/deploymentMode === 'local-only'[\s\S]*?return false/);
  });

  it('Windows installer must set OLLAMA_HOST to 127.0.0.1 explicitly', () => {
    const src = readFileSync(join(REPO_ROOT, 'enterprise/installer/build-windows-msi.ps1'), 'utf8');
    // Windows Ollama default is 0.0.0.0:11434 which exposes the LLM to the LAN.
    // The installer MUST explicitly set OLLAMA_HOST=127.0.0.1 via a wrapper .cmd.
    expect(src).toMatch(/OLLAMA_HOST=127\.0\.0\.1/);
    expect(src).toMatch(/ollama-serve-localhost\.cmd|wrapper/i);
  });

  it('manifest CSP must include localhost:11434 in connect-src', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/extension/manifest.json'), 'utf8'));
    const csp = manifest.content_security_policy?.extension_pages || '';
    expect(csp).toMatch(/connect-src[^;]*localhost:11434|connect-src[^;]*127\.0\.0\.1:11434/);
  });

  it('main-world must check enterprise killSwitch before intercepting LLM requests', () => {
    const src = readMainWorld();
    expect(src).toMatch(/_isKillSwitchActive|enterprisePolicy\.killSwitch/);
    expect(src).toMatch(/_buildKillSwitchResponse|killSwitch.*blocked.*policy/i);
  });

  it('main-world must enforce allowedAITools in fetch proxy', () => {
    const src = readMainWorld();
    expect(src).toMatch(/_isAiToolAllowed|allowedAITools/);
    // The enforcement must happen at the top of patchedFetch before body extraction
    const fetchBlock = src.match(/patchedFetch[\s\S]+?_isAiToolAllowed/)?.[0] ?? '';
    expect(fetchBlock.length).toBeGreaterThan(0);
  });

  it('content script must push managed policy to main-world at startup', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/content/index.ts'), 'utf8');
    expect(src).toMatch(/pushManagedPolicyToMainWorld|syncEnterprisePolicyToMainWorld/);
    expect(src).toMatch(/IRON_GATE_SET_ENTERPRISE_POLICY/);
    // Must re-push on managed storage change
    expect(src).toMatch(/storage\.onChanged[\s\S]*?managed[\s\S]*?pushManagedPolicyToMainWorld/);
  });

  it('turnCoordinator.submit must emit IRON_GATE_RECORD_AUDIT for every detection', () => {
    const src = readMainWorld();
    // The audit recording must be inside _emit (the choke point for all detection emissions)
    const emitFn = src.match(/function _emit[\s\S]+?^  \}/m)?.[0] ?? '';
    expect(emitFn).toMatch(/IRON_GATE_RECORD_AUDIT/);
    // Must only include counts and types — never promptText or entityText
    expect(emitFn).not.toMatch(/payload:[\s\S]*?promptText/);
    expect(emitFn).not.toMatch(/payload:[\s\S]*?entityText/);
    expect(emitFn).toMatch(/entityTypes/);
  });

  it('content script must reject audit messages containing raw PII fields', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/content/index.ts'), 'utf8');
    expect(src).toMatch(/IRON_GATE_RECORD_AUDIT/);
    expect(src).toMatch(/forbiddenFields/);
    expect(src).toMatch(/promptText.*originalText.*maskedText|REJECTED audit/);
  });

  it('audit buffer must run runtime PII check before buffering', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/audit/audit-buffer.ts'), 'utf8');
    expect(src).toMatch(/isAuditEntrySafe/);
    // Must throw, not log-and-continue
    expect(src).toMatch(/Audit entry rejected/);
    // The allow-list must be closed (known keys only)
    expect(src).toMatch(/ALLOWED_KEYS/);
  });

  it('audit buffer must cap retry queue size', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/audit/audit-buffer.ts'), 'utf8');
    expect(src).toMatch(/MAX_RETRY_ENTRIES/);
    // Must evict oldest when the cap is exceeded
    expect(src).toMatch(/firstAttemptAt.*-.*firstAttemptAt|slice.*MAX_RETRY_ENTRIES/);
  });

  it('main-world must prefetch firm pseudonyms before local pseudonymization', () => {
    const src = readMainWorld();
    expect(src).toMatch(/_prefetchFirmPseudonyms/);
    // HKDF derivation must mix in firmId (C4) so different firms get different output
    expect(src).toMatch(/firmId.*normalized|irongate\/pseudonym\/v1/);
    // Primary fetch-proxy path MUST await the prefetch (first-turn determinism)
    expect(src).toMatch(/await _prefetchFirmPseudonyms\(entitiesToPseudonymize\)/);
  });

  it('worker must apply signed policy bundle rules to live detection via tabs.sendMessage', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/worker/index.ts'), 'utf8');
    // The onUpdate callback must forward to content scripts, not just log
    expect(src).toMatch(/IRON_GATE_APPLY_POLICY_BUNDLE/);
    // Must include all 4 rule types the schema declares
    const bundleBlock = src.match(/Apply the signed bundle rules[\s\S]+?contextualKeywords[\s\S]+?scoringWeights[\s\S]+?allowedAITools/)?.[0] ?? '';
    expect(bundleBlock.length).toBeGreaterThan(0);
  });

  it('main-world must accept and apply signed bundle rules', () => {
    const src = readMainWorld();
    expect(src).toMatch(/IRON_GATE_APPLY_POLICY_BUNDLE/);
    expect(src).toMatch(/_bundleCustomEntityRegexes/);
    expect(src).toMatch(/_bundleContextualKeywords/);
    expect(src).toMatch(/_bundleScoringWeights/);
  });

  it('worker must run proactive Tier 2 health polling with degradation notification', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/extension/src/worker/index.ts'), 'utf8');
    // Must have a periodic health check
    expect(src).toMatch(/setInterval[\s\S]+?probeTier2Health/);
    // Must rate-limit notifications
    expect(src).toMatch(/NOTIFY_COOLDOWN_MS|_lastNotifyAt/);
    // Must fire a chrome notification on OK → degraded transition
    expect(src).toMatch(/iron-gate-degraded/);
  });

  it('IT health-check tool must exist and be standalone (no node_modules deps)', () => {
    const healthCheckPath = join(REPO_ROOT, 'scripts/irongate-healthcheck.mjs');
    const src = readFileSync(healthCheckPath, 'utf8');
    // Must use only Node built-ins (node:* prefix or relative paths)
    // Forbidden: bare-package imports like `import x from 'foo'`
    const importLines = src.match(/^import\s+.*from\s+['"][^'"]+['"]/gm) ?? [];
    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const spec = match[1];
      const isBuiltin = spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/');
      expect(isBuiltin, `health-check imports non-builtin module: ${spec}`).toBe(true);
    }
    // Must support --json mode for SIEM ingestion
    expect(src).toMatch(/--json/);
    // Must exit with non-zero codes for degraded/unhealthy (the script uses
    // a ternary to choose between 0/1/2 — verify both non-zero codes appear)
    expect(src).toMatch(/exit\(2\)/);
    expect(src).toMatch(/\?\s*2\s*:.*\?\s*1\s*:\s*0|exit\(1\)/);
  });
});
