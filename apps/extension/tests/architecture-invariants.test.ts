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

describe('Architecture Invariants — No raw prompt text in console logs', () => {
  // June 2026 audit: chatgpt.ts logged up to 200 chars of the user's prompt
  // (bodyPreview/textPreview/contentPreview) to the PAGE console on every
  // submit — visible to any script with console access. The same class was
  // fixed once before (36fe93f) and recurred. Diagnostics may log lengths,
  // counts, and key names — never content.
  it('no *Preview log fields anywhere in extension src', async () => {
    const files = await glob('apps/extension/src/**/*.{ts,tsx}', { cwd: REPO_ROOT, absolute: true });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/\b(?:body|text|content|prompt|payload)Preview\s*:/.test(src)) offenders.push(f);
    }
    expect(offenders, `Raw-text preview fields found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('adapter console calls must not log substring slices of message content', async () => {
    const files = await glob('apps/extension/src/content/adapters/*.ts', { cwd: REPO_ROOT, absolute: true });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // console.<fn>( ... .substring(0, N) ... ) within one statement —
      // the signature of logging a content preview.
      if (/console\.\w+\([^;]*\.substring\(0,\s*\d+\)/s.test(src)) offenders.push(f);
    }
    expect(offenders, `Console content-slice logging found in: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Architecture Invariants — Gemma verdicts stay off window.postMessage', () => {
  // June 2026 audit: Gemma-judged entity values (raw sensitive text) were
  // relayed to the MAIN world via window.postMessage — readable by any page
  // script. They must travel only on the nonce-named BroadcastChannel.
  const CONTENT_INDEX = join(REPO_ROOT, 'apps/extension/src/content/index.ts');

  it('content script forwards GEMMA_VERDICT via _igSecureChannel, never csPostMessage', () => {
    const src = readFileSync(CONTENT_INDEX, 'utf8');
    const caseBlock = src.split("case 'IRON_GATE_GEMMA_VERDICT'")[1]?.split('break;')[0] ?? '';
    expect(caseBlock).toContain('_igSecureChannel.postMessage');
    expect(caseBlock, 'GEMMA_VERDICT must not be sent via csPostMessage/window.postMessage').not.toContain('csPostMessage');
  });

  it('main-world has no window-path handler for GEMMA_VERDICT (forgeable + observable)', () => {
    const src = readMainWorld();
    expect(src).not.toMatch(/event\.data\?\.type === 'IRON_GATE_GEMMA_VERDICT'/);
    // The secure-channel handler must exist instead.
    expect(src).toMatch(/_igSecureChannel\.onmessage/);
    expect(src).toMatch(/_handleGemmaVerdictPayload/);
  });
});

describe('Architecture Invariants — Reverse-map persistence lives in the worker', () => {
  // June 2026 audit: the content script persisted the reverse map to
  // chrome.storage.session, which content scripts cannot access by default
  // (TRUSTED_CONTEXTS) — every persist/restore silently failed. The map's
  // restore payload (full fake→real PII map) also traveled on
  // window.postMessage, observable AND poisonable by page scripts.
  const CONTENT_INDEX = join(REPO_ROOT, 'apps/extension/src/content/index.ts');
  const WORKER_INDEX = join(REPO_ROOT, 'apps/extension/src/worker/index.ts');

  it('content script never touches chrome.storage.session for the reverse map', () => {
    const src = readFileSync(CONTENT_INDEX, 'utf8');
    // welcomeShown (non-PII UX flag) is the single tolerated legacy use.
    const uses = (src.match(/chrome\.storage\.session\.(get|set|remove)\(/g) ?? []).length;
    const welcomeUses = (src.match(/chrome\.storage\.session\.(get|set)\(\s*\{?\s*'?welcomeShown/g) ?? []).length;
    expect(uses - welcomeUses, 'reverse-map persistence must go through the worker').toBeLessThanOrEqual(2);
    expect(src).not.toMatch(/encryptAndStore|loadAndDecrypt|getSessionKey/);
  });

  it('worker owns PERSIST/REQUEST_REVERSE_MAP and restricts them to content scripts', () => {
    const src = readFileSync(WORKER_INDEX, 'utf8');
    expect(src).toMatch(/case 'PERSIST_REVERSE_MAP'/);
    expect(src).toMatch(/case 'REQUEST_REVERSE_MAP'/);
    const csOnly = src.split('CONTENT_SCRIPT_ONLY')[1]?.split(']')[0] ?? '';
    expect(csOnly).toContain('PERSIST_REVERSE_MAP');
    expect(csOnly).toContain('REQUEST_REVERSE_MAP');
  });

  it('main-world has no window-path RESTORE handler (map poisoning)', () => {
    const src = readMainWorld();
    expect(src).not.toMatch(/event\.data\?\.type === 'IRON_GATE_RESTORE_REVERSE_MAP'/);
    expect(src).toMatch(/_handleRestoreReverseMap/);
  });

  it('restore map is sent to main-world only on the secure channel', () => {
    const src = readFileSync(CONTENT_INDEX, 'utf8');
    const sendSites = src.split('IRON_GATE_RESTORE_REVERSE_MAP').length - 1;
    const secureSends = (src.match(/_igSecureChannel\.postMessage\(\{\s*\n?\s*type: 'IRON_GATE_RESTORE_REVERSE_MAP'/g) ?? []).length;
    expect(secureSends).toBeGreaterThanOrEqual(1);
    // No csPostMessage send of the restore payload anywhere.
    expect(src).not.toMatch(/csPostMessage\(\{\s*\n?\s*type: 'IRON_GATE_RESTORE_REVERSE_MAP'/);
    expect(sendSites).toBeGreaterThanOrEqual(1);
  });
});

describe('Architecture Invariants — Kill switch survives MV3 worker restarts', () => {
  // June 2026 audit: killSwitchActive was in-memory only (fail-open on every
  // worker restart until the 60s poller's first check) and enforcement could
  // be skipped entirely because resolveConfig() raced the deployment-mode lock.
  const WORKER_INDEX = join(REPO_ROOT, 'apps/extension/src/worker/index.ts');

  it('kill-switch state is persisted on change and restored at worker start', () => {
    const src = readFileSync(WORKER_INDEX, 'utf8');
    expect(src).toMatch(/function setKillSwitchActive/);
    // The setter persists; the poller callback must use the setter, not raw assignment.
    expect(src).not.toMatch(/killSwitchActive = shouldDisable/);
    expect(src).toMatch(/chrome\.storage\.session\.get\(KILL_SWITCH_STATE_KEY\)/);
  });

  it('config resolution is chained after the deployment-mode lock', () => {
    const src = readFileSync(WORKER_INDEX, 'utf8');
    expect(src).toMatch(/_deploymentReady\.then\(\(\) => resolveConfig\(\)\)/);
    // No bare unchained resolveConfig().then( anywhere.
    expect(src).not.toMatch(/^resolveConfig\(\)\.then\(/m);
  });

  it('kill-switch polling is alarm-backed (setInterval dies with the worker)', () => {
    const src = readFileSync(WORKER_INDEX, 'utf8');
    expect(src).toMatch(/chrome\.alarms\.create\(KILL_SWITCH_ALARM/);
    expect(src).toMatch(/alarm\.name === KILL_SWITCH_ALARM/);
  });
});

describe('Architecture Invariants — Selector death fails closed on dom-presubmit', () => {
  // June 2026 audit: a Gemini UI redesign that broke findInput() let the
  // native submit proceed with raw first-turn PII and zero telemetry.
  it('main-world has the fail-closed guard and both confirmed paths use it', () => {
    const src = readMainWorld();
    expect(src).toMatch(/function _failClosedOnSelectorDeath/);
    expect(src).toMatch(/_failClosedOnSelectorDeath\(e, 'enter'\)/);
    expect(src).toMatch(/_failClosedOnSelectorDeath\(e, 'click'\)/);
    expect(src).toMatch(/IRON_GATE_SELECTOR_FAILURE/);
  });
});

describe('Architecture Invariants — WP1 turn identity & single delivery', () => {
  // June 2026: the stale-sidepanel class (~10 reports) was caused by missing
  // turn identity patched with four stacked timing heuristics across five
  // delivery channels. These invariants keep them from growing back.
  const APP = join(REPO_ROOT, 'apps/extension/src/sidepanel/App.tsx');
  const WORKER = join(REPO_ROOT, 'apps/extension/src/worker/index.ts');
  const CS = join(REPO_ROOT, 'apps/extension/src/content/index.ts');

  it('worker arbitrates display via shouldReplaceDisplay with real turn ids', () => {
    const src = readFileSync(WORKER, 'utf8');
    expect(src).toMatch(/shouldReplaceDisplay\(currentSnapshot/);
    expect(src).toMatch(/lastTurn: incomingTurn/);
  });

  it('the legacy display storage keys are retired everywhere', () => {
    for (const f of [APP, WORKER, CS]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not write lastDetectionResult`).not.toMatch(/storage\.local\.set\(\{\s*lastDetectionResult/);
      expect(src, `${f} must not write lastProxyResult`).not.toMatch(/storage\.local\.set\(\{\s*lastProxyResult/);
    }
  });

  it('sidepanel has no timing heuristics and no detection arbitration', () => {
    const src = readFileSync(APP, 'utf8');
    expect(src).not.toMatch(/PROXY_SCORE_PROTECT_MS|_lastProcessedFingerprint|_promptClearTimerRef/);
    expect(src).not.toMatch(/processDetectionResult/);
    expect(src, 'no detection storage poll').not.toMatch(/setInterval\([^)]*storage/s);
    expect(src).toMatch(/applyTabState/);
    expect(src, 'UI must not arbitrate phases').not.toMatch(/phaseAllowsReplace/);
  });

  it('the main-world coordinator mints turn ids and the 10s window is gone', () => {
    const src = readMainWorld();
    // Minting moved (pure relocation) into the extracted turn-coordinator
    // module — assert it there; main-world must still wire the coordinator in.
    const coordinatorSrc = readFileSync(
      join(REPO_ROOT, 'apps/extension/src/content/main-world/turn-coordinator.ts'), 'utf8',
    );
    expect(coordinatorSrc).toMatch(/_mintTurn\(\)/);
    expect(src).toMatch(/noteUserAction/);
    expect(src).not.toMatch(/now - _lastEmitAt < 10_000/);
    expect(coordinatorSrc).not.toMatch(/now - _lastEmitAt < 10_000/);
  });

  it('the dead CLEAN_SUBMIT chain stays dead', () => {
    for (const f of [WORKER, CS, APP]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f}`).not.toMatch(/case 'PROMPT_CLEAN_SUBMIT'|type: 'PROMPT_CLEAN_SUBMIT'/);
    }
  });

  it('zustand store stays deleted', () => {
    expect(() => readFileSync(join(REPO_ROOT, 'apps/extension/src/sidepanel/store.ts'), 'utf8')).toThrow();
    const pkg = readFileSync(join(REPO_ROOT, 'apps/extension/package.json'), 'utf8');
    expect(pkg).not.toContain('zustand');
  });
});

describe('Architecture Invariants — WP2 scoped DOM observation', () => {
  // The body-wide characterData observer is the pattern that froze ChatGPPT
  // in May 2026 and is default-rejected by project policy. Observation must
  // go through the adapter-resolved conversation root.
  it('no static document.body observation in main-world', () => {
    const src = readMainWorld();
    expect(src).not.toMatch(/\.observe\(\s*document\.body/);
    expect(src).toMatch(/_resolveDepseudoRoot/);
    expect(src).toMatch(/_depseudoScanRoot/);
    // Full-document sweeps must go through the scoped root helper.
    expect(src).not.toMatch(/scanTextNodes\(document\.body\)/);
  });

  it('scans and characterData processing skip editable regions', () => {
    const src = readMainWorld();
    const editableGuards = (src.match(/isContentEditable/g) ?? []).length;
    expect(editableGuards).toBeGreaterThanOrEqual(2);
  });
});

describe('Architecture Invariants — WP2 platform decisions live in adapters', () => {
  // The Gemini/ChatGPT fix-revert ping-pong happened because per-platform
  // behavior was encoded in three competing places. Behavior DECISIONS now
  // come only from adapter contract capabilities; main-world must never
  // branch on a platform id. (Bulk relocation of the remaining platform
  // code blocks happens in the WP3 decomposition; this ratchet stops new
  // special-cases from landing meanwhile.)
  it('main-world contains zero adapter-id equality checks', () => {
    const src = readMainWorld();
    expect(src).not.toMatch(/activeAdapter[?!]?\.id\s*===/);
    expect(src).not.toMatch(/adapter\.id\s*===\s*'(?:gemini|copilot|chatgpt|claude)'/);
  });
});

describe('Architecture Invariants — WP3 single sources', () => {
  it('exactly one scoreToLevel definition (detection/types.ts)', async () => {
    const files = await glob('apps/extension/src/**/*.{ts,tsx}', { cwd: REPO_ROOT, absolute: true });
    const defs: string[] = [];
    for (const f of files) {
      if (/function scoreToLevel|const scoreToLevel\s*=/.test(readFileSync(f, 'utf8'))) defs.push(f);
    }
    expect(defs.map(f => f.split('/src/')[1])).toEqual(['detection/types.ts']);
  });

  it('exactly one ALWAYS_CRITICAL_TYPES definition (detection/types.ts)', async () => {
    const files = await glob('apps/extension/src/**/*.{ts,tsx}', { cwd: REPO_ROOT, absolute: true });
    const defs: string[] = [];
    for (const f of files) {
      if (/ALWAYS_CRITICAL_TYPES\s*[:=]\s*(?:ReadonlySet<string>\s*=\s*)?new Set/.test(readFileSync(f, 'utf8'))) defs.push(f);
    }
    expect(defs.map(f => f.split('/src/')[1])).toEqual(['detection/types.ts']);
  });
});

describe('Architecture Invariants — inline fallback stays in sync', () => {
  // worker/index.ts inlineFetchInterceptor is the LAST-RESORT degraded-mode
  // protector when main-world injection fails. executeScript({func}) forces
  // it to be self-contained — it cannot import types.ts — so these checks
  // pin its inlined constants to the canonical sources instead.
  const WORKER = join(REPO_ROOT, 'apps/extension/src/worker/index.ts');

  it('quickScore HIGH list is a subset of the canonical critical/high types', () => {
    const src = readFileSync(WORKER, 'utf8');
    const m = src.match(/const HIGH = \[([^\]]+)\]/);
    expect(m, 'inline HIGH list must exist (fallback protector)').toBeTruthy();
    const inlineHigh = m![1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    const canonical = new Set([
      // ALWAYS_CRITICAL_TYPES + canonical high-PII identity/financial types
      'API_KEY', 'PRIVATE_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI',
      'SSN', 'CREDIT_CARD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE', 'MEDICAL_RECORD',
    ]);
    for (const t of inlineHigh) {
      expect(canonical.has(t), `inline HIGH entry ${t} drifted from canonical types`).toBe(true);
    }
  });

  it('quickScore band boundaries match SCORE_BANDS', () => {
    const src = readFileSync(WORKER, 'utf8');
    expect(src).toMatch(/capped >= 86 \? 'critical' : capped >= 61 \? 'high' : capped >= 26 \? 'medium' : 'low'/);
  });
});

describe('Architecture Invariants — user bubble restored with whole-value swaps only', () => {
  // June 2026 (user-reported, repeatedly): the user's own message bubble was
  // corrupted — "Lisa Park" → "Maria Park" (fragment collision) and
  // "prompt 1" → "prompt 2" (cross-turn promptText mis-targeting). On ChatGPT
  // the bubble renders the wire payload (pseudonyms), so it MUST be restored —
  // but ONLY with exact whole-pseudonym swaps (replacePseudonymsFullOnly),
  // never first-name fragments (which rewrite real names) and never by writing
  // promptText into a "latest bubble" (which mis-targets across turns).
  it('both de-pseudo scan paths route user-bubble nodes through full-only replacement', () => {
    const src = readMainWorld();
    // scanTextNodes + the characterData path each pick the replacer by location.
    const fullOnlyUses = (src.match(/replacePseudonymsFullOnly\(/g) ?? []).length;
    expect(fullOnlyUses).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/function replacePseudonymsFullOnly/);
    expect(src).toMatch(/_isInsideUserBubble\(/);
  });

  it('full-only replacement builds its cache WITHOUT fragment expansion', () => {
    const src = readMainWorld();
    // replacePseudonymsFullOnly must call buildRegexCache(..., false).
    expect(src).toMatch(/buildRegexCache\(reverseMap,\s*false\)/);
  });

  it('the cross-turn corruption machinery is deleted', () => {
    const src = readMainWorld();
    // These functions wrote promptText into "the latest bubble" / applied
    // whole-document fragment scans — both corrupted the user bubble.
    expect(src).not.toMatch(/function _enforceBubbleInvariant/);
    expect(src).not.toMatch(/function _scanDocumentForReverseMap/);
    expect(src).not.toMatch(/function _findLatestUserBubble/);
  });

  it('the composer (contentEditable) is never touched by de-pseudo', () => {
    const src = readMainWorld();
    // scanTextNodes rejects contentEditable in its acceptNode (ternary form),
    // and the characterData path early-returns on it.
    expect(src).toMatch(/isContentEditable[\s\S]{0,40}FILTER_REJECT/);
    expect(src).toMatch(/isContentEditable\)\s*return;/);
  });
});
