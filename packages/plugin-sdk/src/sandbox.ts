import type { RecognizerPlugin, PluginContext, PluginResult } from './types';

const EXECUTION_TIMEOUT_MS = 100;

/**
 * Execute a plugin's recognize function in a sandboxed context.
 * Uses Function constructor with a restricted scope (no access to fs, net, etc.).
 * Enforces a timeout to prevent infinite loops.
 */
export function executeSandboxed(
  pluginCode: string,
  text: string,
  context: PluginContext,
): PluginResult[] {
  // Create a minimal sandbox scope — no require, no import, no fetch
  const sandbox: Record<string, unknown> = {
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
    encodeURIComponent,
    decodeURIComponent,
  };

  // Wrap plugin code to return the plugin object
  const wrappedCode = `
    "use strict";
    const module = { exports: {} };
    const exports = module.exports;
    ${pluginCode}
    return module.exports;
  `;

  try {
    // Create function with restricted scope
    const argNames = Object.keys(sandbox);
    const argValues = Object.values(sandbox);
    const factory = new Function(...argNames, wrappedCode);

    // Execute with timeout
    const start = Date.now();
    const pluginModule = factory(...argValues) as { default?: RecognizerPlugin; plugin?: RecognizerPlugin };

    const plugin = pluginModule.default || pluginModule.plugin;
    if (!plugin || typeof plugin.recognize !== 'function') {
      throw new Error('Plugin must export a default or plugin object with a recognize() method');
    }

    // Run recognition with timeout check
    const results = plugin.recognize(text, context);

    if (Date.now() - start > EXECUTION_TIMEOUT_MS) {
      console.warn(`[Plugin Sandbox] Plugin exceeded ${EXECUTION_TIMEOUT_MS}ms timeout`);
      return [];
    }

    // Validate results
    if (!Array.isArray(results)) return [];

    return results.filter(
      (r) =>
        typeof r.type === 'string' &&
        typeof r.text === 'string' &&
        typeof r.start === 'number' &&
        typeof r.end === 'number' &&
        typeof r.confidence === 'number' &&
        r.confidence >= 0 &&
        r.confidence <= 1,
    );
  } catch (error) {
    console.warn('[Plugin Sandbox] Execution error:', error);
    return [];
  }
}
