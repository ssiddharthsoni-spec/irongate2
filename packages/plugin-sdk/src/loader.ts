import type { PluginManifest, PluginResult, PluginContext } from './types';
import { executeSandboxed } from './sandbox';

/**
 * A compiled plugin ready for execution.
 */
export interface CompiledPlugin {
  manifest: PluginManifest;
  code: string;
}

/**
 * Validate a plugin manifest.
 */
export function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  return (
    typeof m.name === 'string' &&
    typeof m.version === 'string' &&
    typeof m.description === 'string' &&
    Array.isArray(m.entityTypes) &&
    m.entityTypes.every((t: unknown) => typeof t === 'string')
  );
}

/**
 * Compile a plugin from its source code and manifest.
 * Validates the manifest and tests basic execution.
 */
export function compilePlugin(code: string, manifest: PluginManifest): CompiledPlugin {
  if (!validateManifest(manifest)) {
    throw new Error('Invalid plugin manifest');
  }

  // Test execution with empty text to catch syntax errors early
  try {
    executeSandboxed(code, '', { firmId: 'test' });
  } catch (error) {
    throw new Error(`Plugin compilation failed: ${error}`);
  }

  return { manifest, code };
}

/**
 * Run a compiled plugin against text input.
 */
export function runPlugin(
  plugin: CompiledPlugin,
  text: string,
  context: PluginContext,
): PluginResult[] {
  return executeSandboxed(plugin.code, text, context);
}
