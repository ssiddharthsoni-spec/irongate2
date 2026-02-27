/**
 * Iron Gate — Managed Configuration Resolver
 *
 * Single source of truth for extension configuration.
 * Priority: chrome.storage.managed (enterprise policy) > chrome.storage.local (user).
 *
 * When chrome.storage.managed contains values (deployed via Chrome Enterprise policy),
 * those values take precedence and the UI is locked to prevent user modification.
 */

export interface ResolvedConfig {
  apiKey: string;
  apiUrl: string;
  firmMode: 'audit' | 'proxy';
  firmId: string | null;
  firmName: string | null;
  /** True when enterprise managed storage has values — UI should be locked */
  isManaged: boolean;
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
    ]);
    if (!managed || Object.keys(managed).length === 0) return null;
    return managed;
  } catch {
    // chrome.storage.managed throws if no policy is installed or schema missing
    return null;
  }
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
      apiUrl: managed.apiUrl || local.apiBaseUrl || DEFAULT_API_URL,
      firmMode: (managed.firmMode === 'audit' ? 'audit' : 'proxy'),
      firmId: managed.firmId || local.connectionState?.firmId || null,
      firmName: managed.firmName || local.connectionState?.firmName || null,
      isManaged: true,
    };
  }

  return {
    apiKey: local._decryptedApiKey || '',
    apiUrl: local.apiBaseUrl || DEFAULT_API_URL,
    firmMode: local.firmMode === 'audit' ? 'audit' : 'proxy',
    firmId: local.connectionState?.firmId || null,
    firmName: local.connectionState?.firmName || null,
    isManaged: false,
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
