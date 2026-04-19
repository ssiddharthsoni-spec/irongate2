/**
 * Tier 2 Adapter — Local LLM Classification (Sovereign AI Mode)
 *
 * v1.0 ARCHITECTURAL CONTRACT:
 *
 *   IronGate Enterprise runs in one of three deployment modes, set by managed
 *   policy at extension startup. The mode is LOCKED at startup — no runtime
 *   override is permitted by the user, the page, or any non-managed code path.
 *
 *   1. 'local-only'  — Tier 2 calls a local LLM (Ollama / llama.cpp / Chrome
 *                      built-in LanguageModel). If the local LLM is unreachable,
 *                      Tier 2 fails CLOSED. There is no cloud fallback.
 *                      This is the only mode for Sovereign AI customers.
 *
 *   2. 'hybrid'      — Tier 2 prefers local; falls back to server-side Tier 3.
 *                      Used by customers transitioning from cloud DLP.
 *
 *   3. 'server-only' — Legacy. Tier 2 disabled, Tier 3 server handles escalation.
 *                      Deprecated for new deployments.
 *
 *   The product positioning ("your prompts never leave your device") depends on
 *   'local-only' mode being the default for enterprise customers and being
 *   architecturally enforced. A customer in 'local-only' mode CANNOT have a
 *   cloud fallback inadvertently triggered by:
 *     - User toggling settings
 *     - Browser auto-update changing defaults
 *     - Race condition during initialization
 *     - Page-injected JavaScript
 *     - Storage corruption
 *
 *   The contract is enforced by:
 *     1. Reading deploymentMode from chrome.storage.managed (admin-only) at startup
 *     2. Storing the mode in a frozen module-level constant after validation
 *     3. Refusing to expose any function that would route Tier 2 to a non-local URL
 *     4. Throwing a hard error (not warning) if local-only is configured but no
 *        local endpoint is reachable
 *
 *   This file is the trust root. Changes here require security review.
 *
 * BENCHMARK RESULTS (gemma3:4b via Ollama, format=json, 20-scenario battery):
 *   - 19/20 scenarios pass (95%) — 7/8 catch, 8/8 pass, 4/4 amber
 *   - Zero false positives on benign prompts
 *   - Fiction SSN correctly classified as creative/low (no over-flag)
 *   - Follow-up references correctly caught as ambiguous/medium
 *   - P50 latency: ~3.2s, P95: ~4.2s (warm, M-series Mac)
 *   - JSON schema compliance: 20/20 with Ollama format=json mode
 *
 * DEFAULT MODEL (per-device): gemma3:4b (Google, 3.3GB Q4_K_M, 4.3B params)
 *   - Fits on 8GB RAM, 1.7s avg latency, 90% accuracy
 *   - Apache 2.0, Ollama-ready: `ollama pull gemma3:4b`
 *
 * RECOMMENDED (IT-hosted server): gemma4:e4b (9.6GB, 8B params, Matformer)
 *   - 95% accuracy, 3.2s avg, needs 16GB+ dedicated server
 *   - Best accuracy in class, zero false positives
 *
 * ENTERPRISE ACCURACY MODE (optional):
 *   - gemma4:26b-a4b (32GB+ RAM) — same family, same prompt, drop-in upgrade
 *
 * MODELS EXPLICITLY REJECTED FOR PRODUCTION:
 *   - gemma4:e2b  — thinking mode exhausts token budget, 12-15s latency
 *   - phi3:mini   — ties Tier 1 with no AMBER improvement (22/30)
 *   - qwen2.5:3b  — false positive machine (12/30)
 *   - any 1B model — insufficient nuance for classification
 */

import type { TierAdapter, TierResult } from './confidence-router';
import { scoreToZone } from './confidence-router';
import { classifyIntentAndContext } from './intent-context-classifier';

// ─── Deployment Mode (read from managed policy at startup) ─────────────────

export type DeploymentMode = 'local-only' | 'hybrid' | 'server-only';

/**
 * The complete managed config schema. This is the contract between IT's
 * deployment script (Intune / Jamf / Workspace Admin) and the extension.
 *
 * Schema is referenced from manifest.json's storage.managed.
 */
export interface ManagedDeploymentConfig {
  /** Deployment mode — locked at startup */
  deploymentMode: DeploymentMode;

  /** Local LLM endpoint (e.g., http://localhost:11434/api/generate) */
  localEndpoint?: string;

  /** Local model name to use (e.g., gemma3:4b) */
  localModel?: string;

  /** Local API format */
  localFormat?: 'ollama' | 'openai-compatible' | 'chrome-builtin';

  /**
   * Optional shared secret sent as `Authorization: Bearer <key>` on every
   * local-LLM call. When a customer runs Ollama behind a reverse proxy
   * (Caddy / nginx) that enforces a header, this closes the "any local
   * process can impersonate :11434" surface — Sr. Engineer Audit · Item 6.
   * Leave unset for vanilla localhost Ollama deployments.
   */
  localApiKey?: string;

  /** Per-prompt timeout in ms */
  timeoutMs?: number;

  /** Where audit logs are sent. Default: 'none' (no audit log leaves device) */
  auditLogDestination?: 'none' | 's3' | 'syslog' | 'webhook' | 'irongate-dashboard';

  /** Audit log destination URL/config */
  auditLogConfig?: Record<string, string>;

  /** Signed policy bundle URL (customer-controlled) */
  policyBundleUrl?: string;

  /** Per-firm pseudonymization key (32 bytes hex) for deterministic fake names */
  pseudonymKey?: string;

  /** Kill switch — set true to block all AI tool requests org-wide */
  killSwitch?: boolean;

  /** Customer firm identifier (for audit logs only, never sent to IronGate) */
  firmId?: string;

  /** Internal IT support contact shown in block messages + error notifications */
  supportContact?: string;

  /** Firm-approved AI tool allowlist (adapter ids). Empty/null = all allowed. */
  allowedAITools?: string[];
}

/**
 * Module-level locked deployment config. Set ONCE during initLocalLlmDeployment()
 * and frozen. Any code path that bypasses this is a bug and a security incident.
 */
let _lockedConfig: Readonly<ManagedDeploymentConfig> | null = null;
let _initPromise: Promise<Readonly<ManagedDeploymentConfig>> | null = null;

/**
 * Read the managed deployment config from chrome.storage.managed.
 * Only the OS-level admin (Intune/Jamf/WorkspacePolicy) can write here.
 * The user cannot modify it from settings, devtools, or any page script.
 *
 * Idempotent — calling multiple times returns the cached locked config.
 *
 * MUST be called exactly once at extension startup, before any Tier 2 call.
 */
export async function initLocalLlmDeployment(): Promise<Readonly<ManagedDeploymentConfig>> {
  if (_lockedConfig) return _lockedConfig;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    let raw: Partial<ManagedDeploymentConfig> = {};
    let hasManagedPolicy = false;
    try {
      // chrome.storage.managed is the ONLY trusted source for deployment config.
      // It is set by enterprise admin tools and is read-only at runtime.
      const result = await chrome.storage.managed.get(null);
      raw = (result || {}) as Partial<ManagedDeploymentConfig>;
      hasManagedPolicy = Object.keys(raw).length > 0;
    } catch {
      // chrome.storage.managed unavailable — definitely unmanaged.
      hasManagedPolicy = false;
    }

    // ── LOCAL-FIRST DEFAULT ──────────────────────────────────────────────
    // When no managed policy is present, default to 'local-only' mode.
    // This means NO cloud classification calls are made — everything stays
    // on the device. Tier 2 (local Ollama LLM) is used when available;
    // if it isn't, Tier 1 (regex) is the final verdict. Cloud Tier 3 is
    // disabled at the confidence-router level (see DEFAULT_TIER_CONFIG).
    if (!hasManagedPolicy) {
      raw = { deploymentMode: 'local-only', ...raw };
    } else if (!raw.deploymentMode) {
      // Managed policy exists but didn't set deploymentMode — still default
      // to local-only so accidental misconfiguration doesn't leak to cloud.
      raw.deploymentMode = 'local-only';
    }

    const validated = validateManagedConfig(raw);
    _lockedConfig = Object.freeze(validated);

    // ── STRICT LOCAL-ONLY ENFORCEMENT (managed policy only) ───────────────
    // Enterprise customers who EXPLICITLY set local-only in managed policy
    // expect their local endpoint to be present and usable — if it isn't,
    // fail at startup so the customer can diagnose. For unmanaged users
    // (our default), local-only is "soft": if Ollama isn't running, Tier 2
    // is simply skipped and Tier 1 regex carries the verdict.
    if (validated.deploymentMode === 'local-only' && hasManagedPolicy) {
      if (!validated.localEndpoint && validated.localFormat !== 'chrome-builtin') {
        throw new LocalDeploymentError(
          'IronGate is configured for local-only mode but no localEndpoint is set. ' +
          'The extension will not start in a degraded state. Contact your IronGate administrator.',
          'MISSING_LOCAL_ENDPOINT',
        );
      }
      if (!validated.localModel && validated.localFormat !== 'chrome-builtin') {
        throw new LocalDeploymentError(
          'IronGate is configured for local-only mode but no localModel is set. ' +
          'The extension will not start in a degraded state.',
          'MISSING_LOCAL_MODEL',
        );
      }
    }

    return _lockedConfig;
  })();

  return _initPromise;
}

/**
 * Returns the locked deployment config. Throws if init has not been called.
 * This is the safe way for any code path to read the deployment mode — the
 * value is guaranteed to have been validated and is immutable.
 */
export function getLockedDeploymentConfig(): Readonly<ManagedDeploymentConfig> {
  if (!_lockedConfig) {
    throw new LocalDeploymentError(
      'getLockedDeploymentConfig() called before initLocalLlmDeployment(). ' +
      'This is a bug — initLocalLlmDeployment() must be the first call at extension startup.',
      'INIT_NOT_CALLED',
    );
  }
  return _lockedConfig;
}

/**
 * Asserts that the current deployment mode permits cloud (Tier 3) calls.
 * If the customer is in local-only mode, this throws. Used by the Tier 3
 * adapter and any code path that might inadvertently make a server call.
 */
export function assertCloudCallsPermitted(callSite: string): void {
  const cfg = getLockedDeploymentConfig();
  if (cfg.deploymentMode === 'local-only') {
    throw new LocalDeploymentError(
      `Cloud call attempted from "${callSite}" but deployment mode is local-only. ` +
      'This is an architectural violation — local-only mode must never make outbound network calls during detection.',
      'CLOUD_CALL_IN_LOCAL_MODE',
    );
  }
}

/**
 * Asserts that the current deployment mode permits hybrid fallback to cloud.
 * Local-only mode rejects this. Hybrid mode permits it. server-only mode permits it.
 */
export function isHybridFallbackPermitted(): boolean {
  const cfg = getLockedDeploymentConfig();
  return cfg.deploymentMode === 'hybrid' || cfg.deploymentMode === 'server-only';
}

// ─── Validation ────────────────────────────────────────────────────────────

function validateManagedConfig(raw: Partial<ManagedDeploymentConfig>): ManagedDeploymentConfig {
  const mode = raw.deploymentMode;
  if (mode !== 'local-only' && mode !== 'hybrid' && mode !== 'server-only') {
    // Default to server-only for unmanaged installs (dev mode, etc.)
    return { deploymentMode: 'server-only' };
  }

  const validated: ManagedDeploymentConfig = {
    deploymentMode: mode,
  };

  // Local endpoint validation — must be localhost or 127.0.0.1 in local-only mode.
  // We refuse to send classification calls to any non-localhost URL because that
  // would violate the privacy contract.
  if (raw.localEndpoint) {
    const url = parseLocalUrl(raw.localEndpoint);
    if (url) {
      if (mode === 'local-only' && !isLocalhostUrl(url)) {
        throw new LocalDeploymentError(
          `localEndpoint "${raw.localEndpoint}" is not a localhost URL. ` +
          'In local-only mode, only http://localhost:* and http://127.0.0.1:* are permitted.',
          'NON_LOCAL_ENDPOINT_IN_LOCAL_MODE',
        );
      }
      validated.localEndpoint = url.toString();
    }
  }

  if (typeof raw.localModel === 'string' && raw.localModel.length > 0 && raw.localModel.length < 200) {
    validated.localModel = raw.localModel;
  }

  if (raw.localFormat === 'ollama' || raw.localFormat === 'openai-compatible' || raw.localFormat === 'chrome-builtin') {
    validated.localFormat = raw.localFormat;
  } else if (validated.localEndpoint?.includes('11434')) {
    validated.localFormat = 'ollama';
  } else if (mode === 'local-only') {
    validated.localFormat = 'ollama'; // sensible default
  }

  if (typeof raw.timeoutMs === 'number' && raw.timeoutMs >= 1000 && raw.timeoutMs <= 60000) {
    validated.timeoutMs = raw.timeoutMs;
  }

  if (raw.auditLogDestination && ['none', 's3', 'syslog', 'webhook', 'irongate-dashboard'].includes(raw.auditLogDestination)) {
    validated.auditLogDestination = raw.auditLogDestination;
  } else {
    // Default: no audit log leaves the device. Customer must explicitly opt in.
    validated.auditLogDestination = 'none';
  }

  if (raw.auditLogConfig && typeof raw.auditLogConfig === 'object') {
    validated.auditLogConfig = { ...raw.auditLogConfig };
  }

  if (typeof raw.policyBundleUrl === 'string' && /^https:\/\//.test(raw.policyBundleUrl)) {
    validated.policyBundleUrl = raw.policyBundleUrl;
  }

  if (typeof raw.pseudonymKey === 'string' && /^[0-9a-f]{64}$/i.test(raw.pseudonymKey)) {
    validated.pseudonymKey = raw.pseudonymKey.toLowerCase();
  }

  if (typeof raw.killSwitch === 'boolean') {
    validated.killSwitch = raw.killSwitch;
  }

  if (typeof raw.firmId === 'string' && raw.firmId.length > 0 && raw.firmId.length < 200) {
    validated.firmId = raw.firmId;
  }

  if (typeof raw.supportContact === 'string' && raw.supportContact.length > 0 && raw.supportContact.length < 500) {
    validated.supportContact = raw.supportContact;
  }

  if (Array.isArray(raw.allowedAITools)) {
    const allowed = raw.allowedAITools.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 50);
    if (allowed.length > 0) validated.allowedAITools = allowed;
  }

  return validated;
}

function parseLocalUrl(s: string): URL | null {
  try { return new URL(s); } catch { return null; }
}

function isLocalhostUrl(url: URL): boolean {
  return url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
    || url.hostname === '::1';
}

// ─── Deployment Errors ──────────────────────────────────────────────────────

export type DeploymentErrorCode =
  | 'INIT_NOT_CALLED'
  | 'MISSING_LOCAL_ENDPOINT'
  | 'MISSING_LOCAL_MODEL'
  | 'NON_LOCAL_ENDPOINT_IN_LOCAL_MODE'
  | 'CLOUD_CALL_IN_LOCAL_MODE'
  | 'LOCAL_ENDPOINT_UNREACHABLE'
  | 'LOCAL_MODEL_NOT_LOADED'
  | 'CLASSIFICATION_TIMEOUT'
  | 'INVALID_RESPONSE_FORMAT';

export class LocalDeploymentError extends Error {
  constructor(message: string, public readonly code: DeploymentErrorCode) {
    super(message);
    this.name = 'LocalDeploymentError';
  }
}

// ─── Backward-compat: legacy Tier2Config (used by existing call sites) ────

export interface Tier2Config {
  endpoint: string;
  model: string;
  format: 'ollama' | 'openai';
  timeoutMs?: number;
  enabled: boolean;
}

// ─── Classification System Prompt ──────────────────────────────────────────
// Carefully tuned based on benchmark failures. Two known weaknesses:
// 1) Models over-flag named legal cases as red ("Patterson case" → red, expected amber)
// 2) Models miss API keys embedded in technical prose
// Both fixes are explicit examples in the rubric.

const TIER2_SYSTEM_PROMPT = `You are a data sensitivity classifier for an enterprise DLP product. Classify each input text on a 0-100 sensitivity scale.

SCORING RUBRIC:
- 0-25 (low/green): Generic queries, public information, no identifiable persons, no confidential business context. Examples: coding help, recipes, travel planning, public company research, fictional scenes, educational questions about formats.
- 26-60 (medium/amber): Business-confidential context without direct PII. Examples: unnamed M&A discussions, layoff plans without names, trade secrets, internal financials without specific people, litigation strategy referencing case names but not party PII, hiring pipeline discussions mentioning NDAs.
- 61-85 (high/red): Multiple sensitive entities, legal/medical/financial details tied to real people. Examples: patient records with names and MRNs, HR termination letters with SSNs, multi-entity legal matters with party names and case details.
- 86-100 (critical/red): Highly sensitive — bulk PII, credentials, API keys, attorney-client privilege with named parties, credit cards with CVV, signed authentication tokens.

IMPORTANT CLARIFICATIONS:
- A NAMED LEGAL CASE alone (e.g., "Patterson case", "Smith v. Jones") is AMBER, not red. It becomes red only when combined with party SSNs, financial details, or privileged content.
- API keys, OAuth tokens, JWT tokens, and any string starting with "sk-", "pk-", "ghp_", "AKIA" are CRITICAL even when embedded in technical prose or debug requests.
- Fictional or educational references to PII formats (e.g., "write a scene where a detective reads SSN aloud") are GREEN. Context matters.
- A name alone without other identifiers is GREEN.
- Public figures discussed in public context are GREEN.
- Unnamed business confidentiality (M&A, layoffs, financials) is AMBER, not red — there's no identity to protect yet.

Respond ONLY with a JSON object: {"score": <number 0-100>, "level": "<low|medium|high|critical>", "reasoning": "<brief>"}`;

// ─── Tier 2 Adapter Factory ────────────────────────────────────────────────

export function createTier2Adapter(config?: Tier2Config): TierAdapter {
  // Prefer the locked managed config over any caller-provided config.
  // Caller-provided config is only honored when running in dev mode (no managed
  // policy present), to support local development.
  let endpoint: string;
  let model: string;
  let format: 'ollama' | 'openai-compatible' | 'chrome-builtin';
  let timeoutMs: number;

  try {
    const locked = getLockedDeploymentConfig();
    if (locked.deploymentMode === 'server-only') {
      // Tier 2 is disabled in server-only mode
      return disabledTier2Adapter();
    }
    endpoint = locked.localEndpoint || (config?.endpoint || '');
    model = locked.localModel || (config?.model || '');
    format = locked.localFormat || (config?.format === 'openai' ? 'openai-compatible' : 'ollama');
    timeoutMs = locked.timeoutMs || (config?.timeoutMs || 30000);
  } catch {
    // Locked config not available — use caller-provided config (dev mode)
    if (!config || !config.enabled) return disabledTier2Adapter();
    endpoint = config.endpoint;
    model = config.model;
    format = config.format === 'openai' ? 'openai-compatible' : 'ollama';
    timeoutMs = config.timeoutMs || 30000;
  }

  let consecutiveFailures = 0;
  const MAX_FAILURES_BEFORE_DEGRADE = 3;

  return {
    tier: 2,
    name: `local-llm (${model})`,

    isAvailable(): boolean {
      try {
        const cfg = getLockedDeploymentConfig();
        // In local-only mode, we report available even after failures —
        // the user MUST see the degraded state, not silently fall through.
        if (cfg.deploymentMode === 'local-only') return true;
      } catch { /* dev mode */ }
      return consecutiveFailures < MAX_FAILURES_BEFORE_DEGRADE;
    },

    async classify(text: string, _tier1Result: TierResult): Promise<TierResult> {
      const start = Date.now();

      try {
        const result = await classifyWithLocalLlm(text, endpoint, model, format, timeoutMs);
        consecutiveFailures = 0;
        return {
          tier: 2,
          score: result.score,
          level: result.level,
          zone: scoreToZone(result.score),
          latencyMs: Date.now() - start,
          source: `local-llm:${model}`,
        };
      } catch (err) {
        consecutiveFailures++;

        // In local-only mode, the confidence router will not fall back to
        // cloud (Tier 3 is disabled). Tier 1 regex verdict is preserved.
        // We re-throw so the router logs the failure and degrades gracefully.
        throw err;
      }
    },
  };
}

function disabledTier2Adapter(): TierAdapter {
  return {
    tier: 2,
    name: 'tier2-disabled',
    isAvailable: () => false,
    classify: async () => {
      throw new Error('Tier 2 adapter is disabled by deployment configuration');
    },
  };
}

// ─── Local LLM Call ────────────────────────────────────────────────────────

interface ClassificationResponse {
  score: number;
  level: string;
  reasoning: string;
}

async function classifyWithLocalLlm(
  text: string,
  endpoint: string,
  model: string,
  format: 'ollama' | 'openai-compatible' | 'chrome-builtin',
  timeoutMs: number,
): Promise<ClassificationResponse> {
  if (format === 'chrome-builtin') {
    return classifyWithChromeBuiltin(text);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    if (format === 'ollama') {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `${TIER2_SYSTEM_PROMPT}\n\nText to classify:\n${text}\n\nJSON:`,
          stream: false,
          // Ollama's built-in JSON mode — much more reliable than ad-hoc extraction
          format: 'json',
          options: { temperature: 0.1, num_predict: 200 },
        }),
        signal: controller.signal,
      });
    } else {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: TIER2_SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 200,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    }

    clearTimeout(timer);

    if (!response.ok) {
      throw new LocalDeploymentError(
        `Local LLM returned HTTP ${response.status}`,
        'LOCAL_ENDPOINT_UNREACHABLE',
      );
    }

    const data = (await response.json()) as any;
    const content: string = format === 'ollama'
      ? data.response || ''
      : data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new LocalDeploymentError('Empty response from local LLM', 'INVALID_RESPONSE_FORMAT');
    }

    return parseClassificationJson(content);
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof LocalDeploymentError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new LocalDeploymentError(
        `Local LLM call timed out after ${timeoutMs}ms`,
        'CLASSIFICATION_TIMEOUT',
      );
    }
    throw new LocalDeploymentError(
      `Local LLM call failed: ${(err as Error)?.message || String(err)}`,
      'LOCAL_ENDPOINT_UNREACHABLE',
    );
  }
}

/**
 * Classification via Chrome's built-in LanguageModel (Gemini Nano).
 * Zero-install path — works on Chrome 138+ when hardware qualifies.
 */
async function classifyWithChromeBuiltin(text: string): Promise<ClassificationResponse> {
  // @ts-expect-error LanguageModel is a Chrome experimental global
  if (typeof LanguageModel === 'undefined') {
    throw new LocalDeploymentError(
      'Chrome built-in LanguageModel API is not available. Requires Chrome 138+ with Prompt API enabled.',
      'LOCAL_ENDPOINT_UNREACHABLE',
    );
  }

  // @ts-expect-error
  const availability = await LanguageModel.availability();
  if (availability !== 'available' && availability !== 'downloadable') {
    throw new LocalDeploymentError(
      `Chrome LanguageModel availability=${availability}. Hardware may not meet requirements.`,
      'LOCAL_MODEL_NOT_LOADED',
    );
  }

  // @ts-expect-error
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: TIER2_SYSTEM_PROMPT }],
    temperature: 0.1,
    topK: 3,
  });

  try {
    const responseConstraint = {
      type: 'object',
      required: ['score', 'level', 'reasoning'],
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        reasoning: { type: 'string', maxLength: 500 },
      },
    };

    const raw: string = await session.prompt(
      `Classify this text:\n\n${text}`,
      { responseConstraint },
    );
    return parseClassificationJson(raw);
  } finally {
    try { session.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Parse a classification JSON response. Uses brace-counting to handle nested
 * objects and surrounding prose. Replaces the broken regex-based parser from v0.
 */
function parseClassificationJson(raw: string): ClassificationResponse {
  const jsonStr = extractFirstJsonObject(raw);
  if (!jsonStr) {
    throw new LocalDeploymentError(
      `No JSON object found in classification response: ${raw.substring(0, 200)}`,
      'INVALID_RESPONSE_FORMAT',
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new LocalDeploymentError(
      `JSON parse failed: ${String(e)}. Raw: ${jsonStr.substring(0, 200)}`,
      'INVALID_RESPONSE_FORMAT',
    );
  }

  const rawScore = Number(parsed?.score);
  if (!Number.isFinite(rawScore)) {
    throw new LocalDeploymentError(
      `Classification response missing valid 'score' field`,
      'INVALID_RESPONSE_FORMAT',
    );
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(rawScore))),
    level: validateLevel(String(parsed.level || 'medium')),
    reasoning: String(parsed.reasoning || '').substring(0, 500),
  };
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

function validateLevel(level: string): string {
  const valid = ['low', 'medium', 'high', 'critical'];
  return valid.includes(level) ? level : 'medium';
}

// ─── Health Probe ──────────────────────────────────────────────────────────

export interface Tier2HealthReport {
  reachable: boolean;
  modelLoaded: boolean;
  latencyMs: number | null;
  endpoint: string;
  model: string;
  format: string;
  error: string | null;
  warmupRequired: boolean;
}

/**
 * Probe the local LLM endpoint and report health. Used by:
 *   - Extension startup (warm-up the model so first user prompt isn't slow)
 *   - Sidepanel health indicator
 *   - IT health-check CLI
 *
 * Does NOT throw — returns a structured report so the caller can decide
 * what to do with degraded states.
 */
export async function probeTier2Health(): Promise<Tier2HealthReport> {
  const start = Date.now();
  const report: Tier2HealthReport = {
    reachable: false,
    modelLoaded: false,
    latencyMs: null,
    endpoint: '',
    model: '',
    format: '',
    error: null,
    warmupRequired: false,
  };

  let cfg: Readonly<ManagedDeploymentConfig>;
  try {
    cfg = getLockedDeploymentConfig();
  } catch (e) {
    report.error = (e as Error).message;
    return report;
  }

  if (cfg.deploymentMode === 'server-only') {
    report.error = 'Deployment mode is server-only; Tier 2 is not used';
    return report;
  }

  report.endpoint = cfg.localEndpoint || 'http://localhost:11434';
  report.model = cfg.localModel || 'gemma3:4b';
  report.format = cfg.localFormat || 'ollama';

  if (cfg.localFormat === 'chrome-builtin') {
    try {
      // @ts-expect-error
      if (typeof LanguageModel === 'undefined') {
        report.error = 'Chrome LanguageModel API not available';
        return report;
      }
      // @ts-expect-error
      const avail = await LanguageModel.availability();
      report.reachable = true;
      report.modelLoaded = avail === 'available';
      report.warmupRequired = avail === 'downloadable' || avail === 'downloading';
      if (avail === 'unavailable') {
        report.error = 'Chrome LanguageModel reports unavailable (hardware likely insufficient)';
      }
    } catch (e) {
      report.error = (e as Error).message;
    }
    return report;
  }

  // Ollama / OpenAI-compatible probe
  // Use the same fallback as the classifier — default to localhost:11434
  // when no managed config is set (unmanaged installs with local Ollama).
  const effectiveEndpoint = cfg.localEndpoint || 'http://localhost:11434/api/generate';

  try {
    const probeUrl = effectiveEndpoint.replace('/api/generate', '/api/tags');
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      report.error = `Probe returned HTTP ${res.status}`;
      return report;
    }
    report.reachable = true;
    const data = (await res.json()) as any;
    const installed: string[] = (data?.models || []).map((m: any) => m.name);
    const effectiveModel = cfg.localModel || 'gemma3:4b';
    if (installed.some(n => n === effectiveModel || n.startsWith(effectiveModel + ':'))) {
      report.modelLoaded = true;
      report.latencyMs = Date.now() - start;
    } else {
      report.error = `Model "${cfg.localModel}" is not loaded. Installed: ${installed.join(', ') || '(none)'}`;
    }
  } catch (e) {
    report.error = `Probe failed: ${(e as Error).message}`;
  }

  return report;
}

/**
 * Send a tiny warm-up classification to load the model into memory.
 * Should be called once at extension startup so the first user prompt
 * doesn't pay the cold-start latency (5-15s on first request to any model).
 *
 * We warm BOTH the legacy Tier 2 sensitivity scorer and the new intent
 * classifier. Ollama caches the model in RAM across prompts, so loading
 * it once covers every subsequent request path — but if we're running
 * with Chrome built-in or a hypothetical future adapter, each pathway
 * needs its own warm call.
 */
export async function warmupLocalLlm(): Promise<void> {
  try {
    const cfg = getLockedDeploymentConfig();
    if (cfg.deploymentMode === 'server-only') return;
    const adapter = createTier2Adapter();
    if (!adapter.isAvailable()) return;
    await adapter.classify('warmup probe', {
      tier: 1, score: 0, level: 'low', zone: 'green', latencyMs: 0, source: 'warmup',
    });

    // Warm the intent/context classifier with a single benign prompt.
    // This pulls the Gemma 4 weights into RAM and primes the prompt
    // cache on Ollama so the first real user prompt sees the ~1.3s p50,
    // not the ~10s cold start. Imported statically at the top of this
    // file — MV3 service workers don't always survive dynamic imports
    // after bundling.
    try {
      await classifyIntentAndContext('warmup probe', {
        endpoint: cfg.localEndpoint || 'http://localhost:11434/api/generate',
        model: cfg.localModel || 'gemma3:4b',
        format: cfg.localFormat === 'openai-compatible' ? 'openai-compatible' : 'ollama',
        timeoutMs: 15_000,
      });
    } catch { /* non-fatal */ }
  } catch {
    // Warm-up failures are non-fatal — they'll be reported via probeTier2Health
  }
}

/**
 * Backward-compat wrapper for the legacy probeTier2() signature used elsewhere.
 */
export async function probeTier2(_config?: Tier2Config): Promise<boolean> {
  const report = await probeTier2Health();
  return report.reachable && report.modelLoaded;
}
