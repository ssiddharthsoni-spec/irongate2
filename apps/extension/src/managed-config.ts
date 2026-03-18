/**
 * Iron Gate — Managed Configuration Resolver
 *
 * Single source of truth for extension configuration.
 * Priority: chrome.storage.managed (enterprise policy) > chrome.storage.local (user).
 *
 * When chrome.storage.managed contains values (deployed via Chrome Enterprise policy),
 * those values take precedence and the UI is locked to prevent user modification.
 */

export interface LocalLLMConfig {
  /** URL of the local LLM endpoint (e.g., http://localhost:11434/api) */
  endpoint: string;
  /** Model name to use (e.g., "llama3.2:3b", "mistral:7b") */
  model: string;
  /** Whether to use local LLM for enhanced PII detection */
  enableDetection: boolean;
  /** Timeout in ms for local LLM requests (default: 5000) */
  timeoutMs: number;
}

export interface TierConfig {
  /** Tier 2: Client-side LLM classification */
  tier2Enabled: boolean;
  tier2Endpoint: string;
  tier2Model: string;
  tier2Protocol: 'ollama' | 'openai';
  tier2TimeoutMs: number;
  /** Tier 2 (GLiNER): On-device NER model */
  glinerEnabled: boolean;
  /** Tier 2.5: Metadata-only classifier */
  tier25Enabled: boolean;
  /** Tier 3: Server-side classification */
  tier3Enabled: boolean;
  tier3Endpoint: string;
  tier3TimeoutMs: number;
  /** Semantic embedding classifier */
  semanticEnabled: boolean;
  semanticCentroidsUrl: string;
  /** Zone boundaries */
  amberMinScore: number;
  redMinScore: number;
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  tier2Enabled: false,
  tier2Endpoint: '',
  tier2Model: '',
  tier2Protocol: 'ollama',
  tier2TimeoutMs: 5000,
  glinerEnabled: false,
  tier25Enabled: true,
  tier3Enabled: true,
  tier3Endpoint: '',
  tier3TimeoutMs: 5000,
  semanticEnabled: true,
  semanticCentroidsUrl: '',
  amberMinScore: 26,
  redMinScore: 61,
};

export interface ResolvedConfig {
  apiKey: string;
  apiUrl: string;
  firmMode: 'audit' | 'proxy';
  firmId: string | null;
  firmName: string | null;
  /** True when enterprise managed storage has values — UI should be locked */
  isManaged: boolean;
  /** Local LLM configuration for enterprise on-premise detection */
  localLLM: LocalLLMConfig | null;
  /** Tier configuration for confidence-gated routing */
  tiers: TierConfig;
  /**
   * Processing mode: 'local' = all detection in extension (current default),
   * 'server' = send raw text to API /v1/proxy/process for server-side detection.
   * 'shadow' = run both modes, compare results, log disagreements (for validation).
   * Admin-configurable via managed storage or API config.
   */
  processingMode: 'local' | 'server' | 'shadow';
  /**
   * Server mode rollout percentage (0-100). Only applies when processingMode = 'server'.
   * Used for gradual rollout: each tab gets randomly assigned based on this percentage.
   * Default: 100 (all tabs use server mode).
   */
  serverModePercent?: number;
}

import { loadApiKey } from './api-key-store';

const DEFAULT_API_URL = 'https://irongate-api.onrender.com/v1';

/**
 * Read managed storage values. Returns null if no managed policies exist.
 */
async function getManagedValues(): Promise<Record<string, any> | null> {
  try {
    const managed = await chrome.storage.managed.get([
      'apiKey', 'apiUrl', 'firmMode', 'firmId', 'firmName', 'processingMode',
      'localLLMEndpoint', 'localLLMModel', 'localLLMEnabled', 'localLLMTimeout',
      'tier2Enabled', 'tier2Endpoint', 'tier2Model', 'tier2Protocol', 'tier2TimeoutMs',
      'tier25Enabled', 'tier3Enabled', 'tier3Endpoint', 'tier3TimeoutMs',
      'semanticEnabled', 'semanticCentroidsUrl', 'amberMinScore', 'redMinScore',
    ]);
    if (!managed || Object.keys(managed).length === 0) return null;
    return managed;
  } catch {
    // chrome.storage.managed throws if no policy is installed or schema missing
    return null;
  }
}

function safeBool(val: any, fallback: boolean): boolean {
  return typeof val === 'boolean' ? val : fallback;
}
function safeNum(val: any, fallback: number, min: number, max: number): number {
  const n = typeof val === 'number' ? val : fallback;
  return Math.max(min, Math.min(max, n));
}
function safeStr(val: any, fallback: string): string {
  return typeof val === 'string' ? val : fallback;
}

function resolveTierConfig(source: Record<string, any>): TierConfig {
  return {
    tier2Enabled: safeBool(source.tier2Enabled, DEFAULT_TIER_CONFIG.tier2Enabled),
    tier2Endpoint: safeStr(source.tier2Endpoint, DEFAULT_TIER_CONFIG.tier2Endpoint),
    tier2Model: safeStr(source.tier2Model, DEFAULT_TIER_CONFIG.tier2Model),
    tier2Protocol: source.tier2Protocol === 'openai' ? 'openai' : DEFAULT_TIER_CONFIG.tier2Protocol,
    tier2TimeoutMs: safeNum(source.tier2TimeoutMs, DEFAULT_TIER_CONFIG.tier2TimeoutMs, 1000, 30000),
    glinerEnabled: safeBool(source.glinerEnabled, DEFAULT_TIER_CONFIG.glinerEnabled),
    tier25Enabled: safeBool(source.tier25Enabled, DEFAULT_TIER_CONFIG.tier25Enabled),
    tier3Enabled: safeBool(source.tier3Enabled, DEFAULT_TIER_CONFIG.tier3Enabled),
    tier3Endpoint: safeStr(source.tier3Endpoint, DEFAULT_TIER_CONFIG.tier3Endpoint),
    tier3TimeoutMs: safeNum(source.tier3TimeoutMs, DEFAULT_TIER_CONFIG.tier3TimeoutMs, 1000, 30000),
    semanticEnabled: safeBool(source.semanticEnabled, DEFAULT_TIER_CONFIG.semanticEnabled),
    semanticCentroidsUrl: safeStr(source.semanticCentroidsUrl, DEFAULT_TIER_CONFIG.semanticCentroidsUrl),
    amberMinScore: safeNum(source.amberMinScore, DEFAULT_TIER_CONFIG.amberMinScore, 0, 100),
    redMinScore: safeNum(source.redMinScore, DEFAULT_TIER_CONFIG.redMinScore, 0, 100),
  };
}

function resolveLocalLLMConfig(source: Record<string, any>): LocalLLMConfig | null {
  const endpoint = source.localLLMEndpoint || source.localLLM_endpoint;
  if (!endpoint) return null;
  return {
    endpoint,
    model: source.localLLMModel || source.localLLM_model || 'llama3.2:3b',
    enableDetection: source.localLLMEnabled !== false,
    timeoutMs: source.localLLMTimeout || source.localLLM_timeout || 5000,
  };
}

/**
 * Read local storage values (API key is decrypted from encrypted storage).
 */
async function getLocalValues(): Promise<Record<string, any>> {
  const apiKey = await loadApiKey();
  const result = await new Promise<Record<string, any>>((resolve) => {
    chrome.storage.local.get(
      ['apiBaseUrl', 'firmMode', 'connectionState', 'processingMode'],
      (r) => resolve(r),
    );
  });
  return { ...result, _decryptedApiKey: apiKey };
}

/**
 * Resolve the effective configuration. Managed values override local values.
 */
export async function resolveConfig(): Promise<ResolvedConfig> {
  const managed = await getManagedValues();
  const local = await getLocalValues();

  if (managed?.apiKey) {
    return {
      apiKey: managed.apiKey,
      apiUrl: managed.apiUrl || DEFAULT_API_URL,
      firmMode: (managed.firmMode === 'audit' ? 'audit' : 'proxy'),
      firmId: managed.firmId || local.connectionState?.firmId || null,
      firmName: managed.firmName || local.connectionState?.firmName || null,
      isManaged: true,
      localLLM: resolveLocalLLMConfig(managed) || resolveLocalLLMConfig(local),
      tiers: resolveTierConfig(managed),
      processingMode: managed.processingMode === 'server' ? 'server'
        : managed.processingMode === 'shadow' ? 'shadow' : 'local',
      serverModePercent: typeof managed.serverModePercent === 'number'
        ? Math.max(0, Math.min(100, managed.serverModePercent)) : 100,
    };
  }

  return {
    apiKey: local._decryptedApiKey || '',
    apiUrl: DEFAULT_API_URL,
    firmMode: local.firmMode === 'audit' ? 'audit' : 'proxy',
    firmId: local.connectionState?.firmId || null,
    firmName: local.connectionState?.firmName || null,
    isManaged: false,
    localLLM: resolveLocalLLMConfig(local),
    tiers: resolveTierConfig(local),
    processingMode: local.processingMode === 'server' ? 'server'
      : local.processingMode === 'shadow' ? 'shadow' : 'local',
    serverModePercent: typeof local.serverModePercent === 'number'
      ? Math.max(0, Math.min(100, local.serverModePercent)) : 100,
  };
}

/**
 * Lightweight check: is enterprise managed mode active?
 */
export async function isManagedMode(): Promise<boolean> {
  const managed = await getManagedValues();
  return !!(managed?.apiKey);
}

/**
 * Resolve just the firm mode from the correct source (for content scripts).
 */
export async function resolveMode(): Promise<'audit' | 'proxy'> {
  const managed = await getManagedValues();
  if (managed?.firmMode === 'audit' || managed?.firmMode === 'proxy') {
    return managed.firmMode;
  }
  return new Promise((resolve) => {
    chrome.storage.local.get('firmMode', (result) => {
      resolve(result.firmMode === 'audit' ? 'audit' : 'proxy');
    });
  });
}

/**
 * Listen for managed storage changes and invoke callback with new config.
 */
export function onManagedConfigChanged(
  callback: (config: ResolvedConfig) => void,
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed') {
      resolveConfig().then(callback).catch(() => {});
    }
  });
}
