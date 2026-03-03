/**
 * Optional host permissions management.
 *
 * Hosts in `optional_host_permissions` require explicit user consent.
 * Chrome will automatically inject manifest-declared content scripts
 * once permission is granted — no dynamic registration needed.
 */

export interface OptionalPlatform {
  id: string;
  name: string;
  origins: string[];
  icon: string; // emoji fallback
}

/**
 * All optional AI platforms (not included by default in the extension).
 * These map to `optional_host_permissions` in manifest.json.
 */
export const OPTIONAL_PLATFORMS: OptionalPlatform[] = [
  {
    id: 'copilot',
    name: 'Microsoft Copilot',
    origins: ['https://copilot.microsoft.com/*'],
    icon: '🤖',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    origins: ['https://chat.deepseek.com/*'],
    icon: '🔍',
  },
  {
    id: 'poe',
    name: 'Poe',
    origins: ['https://poe.com/*'],
    icon: '💬',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    origins: ['https://perplexity.ai/*', 'https://www.perplexity.ai/*', 'https://*.perplexity.ai/*'],
    icon: '🧭',
  },
  {
    id: 'you',
    name: 'You.com',
    origins: ['https://you.com/*'],
    icon: '👤',
  },
  {
    id: 'huggingface',
    name: 'HuggingChat',
    origins: ['https://huggingface.co/chat/*'],
    icon: '🤗',
  },
  {
    id: 'groq',
    name: 'Groq',
    origins: ['https://groq.com/*'],
    icon: '⚡',
  },
];

/**
 * Default platforms that are always available (required host_permissions).
 */
export const DEFAULT_PLATFORMS = [
  { id: 'chatgpt', name: 'ChatGPT', icon: '💚' },
  { id: 'claude', name: 'Claude', icon: '🟠' },
  { id: 'gemini', name: 'Gemini', icon: '💙' },
];

/**
 * Check which optional platforms have been granted permission.
 * Returns a map of platform id → granted boolean.
 */
export async function checkGrantedPlatforms(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};

  for (const platform of OPTIONAL_PLATFORMS) {
    try {
      const granted = await chrome.permissions.contains({
        origins: platform.origins,
      });
      result[platform.id] = granted;
    } catch {
      result[platform.id] = false;
    }
  }

  return result;
}

/**
 * Request permission for an optional platform.
 * Must be called from a user gesture context (e.g., button click in side panel).
 * Returns true if permission was granted.
 */
export async function requestPlatformPermission(platformId: string): Promise<boolean> {
  const platform = OPTIONAL_PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return false;

  try {
    const granted = await chrome.permissions.request({
      origins: platform.origins,
    });
    return granted;
  } catch {
    return false;
  }
}

/**
 * Revoke permission for an optional platform.
 * Returns true if permission was successfully removed.
 */
export async function revokePlatformPermission(platformId: string): Promise<boolean> {
  const platform = OPTIONAL_PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return false;

  try {
    const removed = await chrome.permissions.remove({
      origins: platform.origins,
    });
    return removed;
  } catch {
    return false;
  }
}
