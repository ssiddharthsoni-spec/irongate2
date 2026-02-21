// ============================================================================
// Iron Gate — Plugin Loader Service
// ============================================================================
// Loads and caches firm plugins from the DB, executes them in a sandbox.
// ============================================================================

import { db } from '../db/client';
import { firmPlugins } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

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
        .catch(() => {});
    } catch (error) {
      console.warn(`[Plugin Loader] Plugin "${plugin.name}" failed:`, error);
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

function executeSandboxed(code: string, text: string, firmId: string): SandboxResult[] {
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Date,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  };

  const wrappedCode = `
    "use strict";
    const module = { exports: {} };
    const exports = module.exports;
    ${code}
    return module.exports;
  `;

  try {
    const argNames = Object.keys(sandbox);
    const argValues = Object.values(sandbox);
    const factory = new Function(...argNames, wrappedCode);

    const start = Date.now();
    const pluginModule = factory(...argValues) as any;

    const plugin = pluginModule.default || pluginModule.plugin || pluginModule;
    if (typeof plugin.recognize !== 'function') return [];

    const results = plugin.recognize(text, { firmId });

    // Enforce 100ms timeout
    if (Date.now() - start > 100) return [];

    if (!Array.isArray(results)) return [];
    return results.filter(
      (r: any) =>
        typeof r.type === 'string' &&
        typeof r.text === 'string' &&
        typeof r.start === 'number' &&
        typeof r.end === 'number' &&
        typeof r.confidence === 'number',
    );
  } catch {
    return [];
  }
}

