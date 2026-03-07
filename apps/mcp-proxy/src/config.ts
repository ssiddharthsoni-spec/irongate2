/**
 * MCP Proxy Configuration
 *
 * Loaded from environment variables with sensible defaults.
 */

export interface MCPProxyConfig {
  /** Port the proxy listens on */
  listenPort: number;
  /** Target MCP server URL to forward requests to */
  upstreamUrl: string;
  /** Firm identifier for audit trail */
  firmId: string;
  /** Iron Gate API URL for logging events */
  apiUrl: string;
  /** Iron Gate API key for authentication */
  apiKey: string;
  /** Whether to pseudonymize PII before forwarding */
  enablePseudonymization: boolean;
  /** Whether to log all tool calls (not just those with PII) */
  logAllCalls: boolean;
  /** Sensitivity score threshold to block a call (0 = never block, 86 = block critical only) */
  blockThreshold: number;
  /** Sensitivity score threshold to pseudonymize (0 = always pseudonymize when PII found) */
  pseudonymizeThreshold: number;
}

export function loadConfig(): MCPProxyConfig {
  return {
    listenPort: parseInt(process.env.MCP_PROXY_PORT || '3100', 10),
    upstreamUrl: process.env.MCP_UPSTREAM_URL || 'http://localhost:3000',
    firmId: process.env.IRON_GATE_FIRM_ID || '',
    apiUrl: process.env.IRON_GATE_API_URL || 'http://localhost:4000',
    apiKey: process.env.IRON_GATE_API_KEY || '',
    enablePseudonymization: process.env.MCP_ENABLE_PSEUDONYMIZATION !== 'false',
    logAllCalls: process.env.MCP_LOG_ALL_CALLS === 'true',
    blockThreshold: parseInt(process.env.MCP_BLOCK_THRESHOLD || '86', 10),
    pseudonymizeThreshold: parseInt(process.env.MCP_PSEUDONYMIZE_THRESHOLD || '26', 10),
  };
}
