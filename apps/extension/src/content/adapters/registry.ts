import type { SiteAdapter } from './base';
import { ChatGPTAdapter } from './chatgpt';
import { ClaudeAdapter } from './claude';
import { GeminiAdapter } from './gemini';
import { CopilotAdapter } from './copilot';
import { PerplexityAdapter } from './perplexity';
import { DeepSeekAdapter } from './deepseek';
import { PoeAdapter } from './poe';
import { GroqAdapter } from './groq';
import { HuggingFaceAdapter } from './huggingface';
import { YouAdapter } from './you';
import { GrokAdapter } from './grok';
import { MistralAdapter } from './mistral';

/**
 * All registered site adapters, in priority order.
 * Most specific patterns first to avoid false matches.
 */
const ALL_ADAPTERS: SiteAdapter[] = [
  ChatGPTAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  CopilotAdapter,
  PerplexityAdapter,
  DeepSeekAdapter,
  PoeAdapter,
  GroqAdapter,
  HuggingFaceAdapter,
  YouAdapter,
  GrokAdapter,
  MistralAdapter,
];

/**
 * Detect which AI platform is active based on the current page hostname.
 * Returns the matching adapter or null if no AI tool is detected.
 */
export function getAdapter(hostname?: string): SiteAdapter | null {
  const host = hostname || window.location.hostname;
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.hostPatterns.some(pattern => pattern.test(host))) {
      return adapter;
    }
  }
  return null;
}

/**
 * Get all supported hostnames (for manifest host_permissions).
 */
export function getSupportedHosts(): string[] {
  return ALL_ADAPTERS.map(a => a.name);
}

/**
 * Check if a URL matches any adapter's API patterns.
 * Used by transport proxies to determine if a request should be intercepted.
 */
export function isLLMEndpoint(url: string, activeAdapter: SiteAdapter | null): boolean {
  // Check active adapter's patterns first (most likely match)
  if (activeAdapter?.apiPatterns.some(p => p.test(url))) return true;

  // Check all adapters' patterns (cross-domain API calls)
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.apiPatterns.some(p => p.test(url))) return true;
  }

  // Same-host fallback: match common API paths
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.hostname === window.location.hostname) {
      return /\/api|backend-api\/|\/conversation|\/batchexecute|StreamGenerate/i.test(parsed.pathname);
    }
    // Known cross-domain API hosts
    const CROSS_DOMAIN = [
      'api.openai.com', 'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'sydney.bing.com', 'substrate.office.com',
      'api.perplexity.ai', 'api.groq.com',
    ];
    if (CROSS_DOMAIN.includes(parsed.hostname)) return true;
  } catch { /* invalid URL */ }

  return false;
}

/**
 * Check if the fetch proxy should be skipped for this URL.
 * Returns true for platforms where DOM pre-submit or WS handles everything.
 * Handles three cases:
 *   1. Active adapter skips fetch + URL is relative (belongs to current host)
 *   2. Active adapter skips fetch + URL matches its patterns
 *   3. URL matches any adapter that skips fetch (cross-domain safety)
 */
export function shouldSkipFetchProxy(url: string, activeAdapter: SiteAdapter | null): boolean {
  // Active adapter wants to skip fetch proxy
  if (activeAdapter?.skipFetchProxy) {
    // Relative URL belongs to current host = active adapter's domain
    if (url.startsWith('/')) return true;
    if (activeAdapter.apiPatterns.some(p => p.test(url)) ||
        activeAdapter.hostPatterns.some(p => p.test(url))) return true;
  }
  // Cross-adapter: URL matches another adapter that skips fetch
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.skipFetchProxy && adapter.apiPatterns.some(p => p.test(url))) return true;
  }
  return false;
}

/**
 * Check if the XHR proxy should be skipped for this URL.
 * Same logic as shouldSkipFetchProxy but for XHR.
 */
export function shouldSkipXhrProxy(url: string, activeAdapter: SiteAdapter | null): boolean {
  if (activeAdapter?.skipXhrProxy) {
    if (url.startsWith('/')) return true;
    if (activeAdapter.apiPatterns.some(p => p.test(url)) ||
        activeAdapter.hostPatterns.some(p => p.test(url))) return true;
  }
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.skipXhrProxy && adapter.apiPatterns.some(p => p.test(url))) return true;
  }
  return false;
}

/**
 * Get all adapters (for testing/admin purposes).
 */
export function getAllAdapters(): SiteAdapter[] {
  return [...ALL_ADAPTERS];
}

export type { SiteAdapter };
