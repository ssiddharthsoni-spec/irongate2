// ============================================================================
// Iron Gate — Plugin Loader Service
// ============================================================================
// Loads and caches firm plugins from the DB, executes them in a sandbox.
// ============================================================================

import { db } from '../db/client';
import { firmPlugins } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';

interface PluginResult {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'plugin';
}

// In-memory cache of compiled plugins per firm
const pluginCache = new Map<string, { plugins: CachedPlugin[]; loadedAt: number }>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

interface CachedPlugin {
  id: string;
  name: string;
  code: string;
  entityTypes: string[];
}

/**
 * Load active plugins for a firm (with caching).
 */
async function loadPlugins(firmId: string): Promise<CachedPlugin[]> {
  const cached = pluginCache.get(firmId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return cached.plugins;
  }

  const rows = await db
    .select({
      id: firmPlugins.id,
      name: firmPlugins.name,
      code: firmPlugins.code,
      entityTypes: firmPlugins.entityTypes,
    })
    .from(firmPlugins)
    .where(and(eq(firmPlugins.firmId, firmId), eq(firmPlugins.isActive, true)));

  const plugins: CachedPlugin[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    entityTypes: (r.entityTypes as string[]) || [],
  }));

  pluginCache.set(firmId, { plugins, loadedAt: Date.now() });
  return plugins;
}

/**
 * Run all active plugins for a firm against the given text.
 * Returns merged entity results from all plugins.
 */
export async function runPlugins(firmId: string, text: string): Promise<PluginResult[]> {
  const plugins = await loadPlugins(firmId);
  if (plugins.length === 0) return [];

  const results: PluginResult[] = [];

  for (const plugin of plugins) {
    try {
      const pluginResults = executeSandboxed(plugin.code, text, firmId);
      for (const r of pluginResults) {
        results.push({
          type: r.type,
          text: r.text,
          start: r.start,
          end: r.end,
          confidence: r.confidence,
          source: 'plugin',
        });
      }

      // Update hit count (fire-and-forget)
      db.update(firmPlugins)
        .set({ hitCount: sql`${firmPlugins.hitCount} + 1` })
        .where(eq(firmPlugins.id, plugin.id))
        .catch((err) => logger.warn('Plugin hitCount update failed', { pluginId: plugin.id, error: String(err) }));
    } catch (error) {
      logger.warn('Plugin execution failed', { pluginName: plugin.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

/**
 * Invalidate the plugin cache for a firm (call on plugin add/update/delete).
 */
export function invalidateCache(firmId: string): void {
  pluginCache.delete(firmId);
}

// ---------------------------------------------------------------------------
// Sandboxed execution
// ---------------------------------------------------------------------------

interface SandboxResult {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

/**
 * Plugins are now restricted to declarative regex-based rules only.
 * Arbitrary code execution (new Function / eval) is NOT supported due to
 * the inherent sandbox-escape risk in the Node.js main thread.
 *
 * Plugin `code` must be a JSON string containing an array of rules:
 * [
 *   { "type": "CLIENT_ID", "pattern": "CLI-\\d{6}", "flags": "gi", "confidence": 0.9 },
 *   ...
 * ]
 *
 * Each rule produces entity matches where the regex matches the input text.
 */
interface PluginRule {
  type: string;
  pattern: string;
  flags?: string;
  confidence?: number;
}

const DANGEROUS_REGEX_PATTERNS = /(\{[0-9]{4,\}|[\+\*]\{[0-9]{3,\}|(\.\*){5,})/;
const MAX_RULES_PER_PLUGIN = 50;
const MAX_PATTERN_LENGTH = 500;
const REGEX_EXEC_TIMEOUT_MS = 50;

function executeSandboxed(code: string, text: string, _firmId: string): SandboxResult[] {
  let rules: PluginRule[];
  try {
    const parsed = JSON.parse(code);
    if (!Array.isArray(parsed)) return [];
    rules = parsed.slice(0, MAX_RULES_PER_PLUGIN);
  } catch {
    logger.warn('Plugin code is not valid JSON — skipping (arbitrary code execution is disabled)');
    return [];
  }

  const results: SandboxResult[] = [];
  const startTime = Date.now();

  for (const rule of rules) {
    // Validate rule structure
    if (typeof rule.type !== 'string' || typeof rule.pattern !== 'string') continue;
    if (rule.pattern.length > MAX_PATTERN_LENGTH) continue;

    // Block potentially catastrophic regex patterns (ReDoS protection)
    if (DANGEROUS_REGEX_PATTERNS.test(rule.pattern)) {
      logger.warn('Plugin rule has potentially dangerous regex pattern — skipping', { type: rule.type });
      continue;
    }

    try {
      const flags = typeof rule.flags === 'string' ? rule.flags.replace(/[^gimsuy]/g, '') : 'gi';
      const regex = new RegExp(rule.pattern, flags);
      const confidence = typeof rule.confidence === 'number' ? Math.min(1, Math.max(0, rule.confidence)) : 0.8;

      let match: RegExpExecArray | null;
      let matchCount = 0;
      while ((match = regex.exec(text)) !== null && matchCount < 100) {
        // Timeout check
        if (Date.now() - startTime > REGEX_EXEC_TIMEOUT_MS) break;

        results.push({
          type: rule.type,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence,
        });
        matchCount++;

        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    } catch {
      // Invalid regex — skip this rule silently
    }

    // Overall timeout
    if (Date.now() - startTime > REGEX_EXEC_TIMEOUT_MS) break;
  }

  return results;
}

