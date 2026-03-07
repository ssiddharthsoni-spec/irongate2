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
}

import { loadApiKey } from './api-key-store';

const DEFAULT_API_URL = 'https://irongate-api.onrender.com/v1';

/**
 * Read managed storage values. Returns null if no managed policies exist.
 */
async function getManagedValues(): Promise<Record<string, any> | null> {
  try {
    const managed = await chrome.storage.managed.get([
      'apiKey', 'apiUrl', 'firmMode', 'firmId', 'firmName',
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

function resolveTierConfig(source: Record<string, any>): TierConfig {
  return {
    tier2Enabled: source.tier2Enabled ?? DEFAULT_TIER_CONFIG.tier2Enabled,
    tier2Endpoint: source.tier2Endpoint ?? DEFAULT_TIER_CONFIG.tier2Endpoint,
    tier2Model: source.tier2Model ?? DEFAULT_TIER_CONFIG.tier2Model,
    tier2Protocol: source.tier2Protocol ?? DEFAULT_TIER_CONFIG.tier2Protocol,
    tier2TimeoutMs: source.tier2TimeoutMs ?? DEFAULT_TIER_CONFIG.tier2TimeoutMs,
    tier25Enabled: source.tier25Enabled ?? DEFAULT_TIER_CONFIG.tier25Enabled,
    tier3Enabled: source.tier3Enabled ?? DEFAULT_TIER_CONFIG.tier3Enabled,
    tier3Endpoint: source.tier3Endpoint ?? DEFAULT_TIER_CONFIG.tier3Endpoint,
    tier3TimeoutMs: source.tier3TimeoutMs ?? DEFAULT_TIER_CONFIG.tier3TimeoutMs,
    semanticEnabled: source.semanticEnabled ?? DEFAULT_TIER_CONFIG.semanticEnabled,
    semanticCentroidsUrl: source.semanticCentroidsUrl ?? DEFAULT_TIER_CONFIG.semanticCentroidsUrl,
    amberMinScore: source.amberMinScore ?? DEFAULT_TIER_CONFIG.amberMinScore,
    redMinScore: source.redMinScore ?? DEFAULT_TIER_CONFIG.redMinScore,
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
      ['apiBaseUrl', 'firmMode', 'connectionState'],
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
