/**
 * Plugin manifest describing the plugin's capabilities.
 */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entityTypes: string[];
}

/**
 * Context provided to plugins during recognition.
 */
export interface PluginContext {
  firmId: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A single result from plugin recognition.
 */
export interface PluginResult {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

/**
 * Interface that all recognizer plugins must implement.
 */
export interface RecognizerPlugin {
  name: string;
  version: string;
  entityTypes: string[];
  recognize(text: string, context: PluginContext): PluginResult[];
}
