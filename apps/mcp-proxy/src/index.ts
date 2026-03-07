/**
 * Iron Gate MCP Proxy Server
 *
 * An HTTP proxy that intercepts MCP (Model Context Protocol) JSON-RPC requests,
 * scans tool call arguments for PII, and either passes, pseudonymizes, or blocks
 * them before forwarding to the upstream MCP server.
 *
 * Usage:
 *   MCP_UPSTREAM_URL=http://localhost:3000 npx tsx src/index.ts
 *
 * The proxy speaks the same JSON-RPC protocol as MCP, so it can be inserted
 * transparently between an MCP client and server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, type MCPProxyConfig } from './config';
import {
  interceptToolCall,
  interceptToolResult,
  createPseudonymMap,
  type PseudonymMap,
  type InterceptedCall,
} from './interceptor';

// ── JSON-RPC Types ────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

// ── Active pseudonym maps keyed by request ID ─────────────────────────────────

const activePseudonymMaps = new Map<string | number, PseudonymMap>();

// ── Logging to Iron Gate API ──────────────────────────────────────────────────

async function logToIronGate(
  config: MCPProxyConfig,
  intercepted: InterceptedCall,
): Promise<void> {
  if (!config.apiUrl || !config.apiKey) return;

  // Don't log 'pass' actions unless logAllCalls is enabled
  if (intercepted.action === 'pass' && !config.logAllCalls) return;

  try {
    const payload = {
      type: 'mcp_tool_call',
      firmId: config.firmId,
      toolName: intercepted.toolName,
      action: intercepted.action,
      sensitivityScore: intercepted.scanResult.score,
      sensitivityLevel: intercepted.scanResult.level,
      entityCount: intercepted.scanResult.entities.length,
      entityTypes: [...new Set(intercepted.scanResult.entities.map(e => e.type))],
      timestamp: intercepted.timestamp,
    };

    await fetch(`${config.apiUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Non-blocking: log failure should not break the proxy
    console.error('[mcp-proxy] Failed to log to Iron Gate API:', (err as Error).message);
  }
}

// ── Request Body Reader ───────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── Upstream Forwarding ───────────────────────────────────────────────────────

async function forwardToUpstream(
  config: MCPProxyConfig,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const upstreamUrl = config.upstreamUrl;

  const response = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

  const responseBody = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    body: responseBody,
    headers: responseHeaders,
  };
}

// ── JSON-RPC Helpers ──────────────────────────────────────────────────────────

function makeErrorResponse(id: string | number | null, code: number, message: string): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ── MCP Request Handler ──────────────────────────────────────────────────────

async function handleMCPRequest(
  config: MCPProxyConfig,
  rpcRequest: JsonRpcRequest,
): Promise<{ response: JsonRpcResponse | null; forwardBody: string | null }> {
  const { method, params, id } = rpcRequest;

  // Only intercept tools/call requests
  if (method !== 'tools/call') {
    // Pass through non-tool-call methods unmodified
    return { response: null, forwardBody: JSON.stringify(rpcRequest) };
  }

  const toolName = (params?.name as string) || 'unknown';
  const toolArgs = (params?.arguments as Record<string, unknown>) || {};

  // Create a pseudonym map for this request's lifecycle
  const pmap = createPseudonymMap();

  // Intercept the tool call arguments
  const { modifiedArgs, intercepted } = interceptToolCall(toolName, toolArgs, config, pmap);

  // Log the interception
  logToIronGate(config, intercepted).catch(() => {});

  console.log(
    `[mcp-proxy] ${intercepted.action.toUpperCase()} | tool=${toolName} ` +
    `score=${intercepted.scanResult.score} level=${intercepted.scanResult.level} ` +
    `entities=${intercepted.scanResult.entities.length}`,
  );

  // If blocked, return an error response without forwarding
  if (intercepted.action === 'block') {
    console.log(`[mcp-proxy] BLOCKED tool call: ${toolName} (score: ${intercepted.scanResult.score})`);
    return {
      response: makeErrorResponse(
        id ?? null,
        -32001,
        `Tool call blocked by Iron Gate: sensitivity score ${intercepted.scanResult.score} ` +
        `(${intercepted.scanResult.level}) exceeds threshold ${config.blockThreshold}. ` +
        `Detected: ${intercepted.scanResult.entities.map(e => e.type).join(', ')}`,
      ),
      forwardBody: null,
    };
  }

  // Store the pseudonym map if we pseudonymized (for de-pseudonymizing the response)
  if (intercepted.action === 'pseudonymize' && id !== undefined && id !== null) {
    activePseudonymMaps.set(id, pmap);

    // Clean up after 5 minutes to prevent memory leaks
    setTimeout(() => activePseudonymMaps.delete(id), 5 * 60 * 1000);
  }

  // Build modified request to forward
  const modifiedRequest: JsonRpcRequest = {
    ...rpcRequest,
    params: {
      ...params,
      arguments: modifiedArgs,
    },
  };

  return { response: null, forwardBody: JSON.stringify(modifiedRequest) };
}

// ── Response Handler ──────────────────────────────────────────────────────────

async function handleUpstreamResponse(
  config: MCPProxyConfig,
  rpcRequest: JsonRpcRequest,
  responseBody: string,
): Promise<string> {
  // Only process responses to tools/call requests
  if (rpcRequest.method !== 'tools/call') {
    return responseBody;
  }

  let rpcResponse: JsonRpcResponse;
  try {
    rpcResponse = JSON.parse(responseBody) as JsonRpcResponse;
  } catch {
    return responseBody; // Can't parse, pass through
  }

  // If there was an error from upstream, pass through
  if (rpcResponse.error) {
    return responseBody;
  }

  const toolName = (rpcRequest.params?.name as string) || 'unknown';
  const requestId = rpcRequest.id;

  // Retrieve pseudonym map if we pseudonymized the outgoing call
  let pmap: PseudonymMap | undefined;
  if (requestId !== undefined && requestId !== null) {
    pmap = activePseudonymMaps.get(requestId);
    activePseudonymMaps.delete(requestId);
  }

  // Intercept the result
  const { modifiedResult, intercepted } = interceptToolResult(
    toolName,
    rpcResponse.result,
    config,
    pmap,
  );

  // Log the response interception
  logToIronGate(config, intercepted).catch(() => {});

  if (intercepted.scanResult.hasSensitiveData) {
    console.log(
      `[mcp-proxy] RESULT ${intercepted.action.toUpperCase()} | tool=${toolName} ` +
      `score=${intercepted.scanResult.score} level=${intercepted.scanResult.level} ` +
      `entities=${intercepted.scanResult.entities.length}`,
    );
  }

  // Return modified response
  const modifiedResponse: JsonRpcResponse = {
    ...rpcResponse,
    result: modifiedResult,
  };

  return JSON.stringify(modifiedResponse);
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

function createProxyServer(config: MCPProxyConfig) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'iron-gate-mcp-proxy',
        upstreamUrl: config.upstreamUrl,
        pseudonymization: config.enablePseudonymization,
        blockThreshold: config.blockThreshold,
      });
      return;
    }

    // Stats endpoint
    if (req.method === 'GET' && req.url === '/stats') {
      sendJson(res, 200, {
        activePseudonymMaps: activePseudonymMaps.size,
        uptime: process.uptime(),
      });
      return;
    }

    // Only accept POST for MCP JSON-RPC
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed. Use POST for MCP JSON-RPC requests.' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 400, { error: 'Failed to read request body' });
      return;
    }

    let rpcRequest: JsonRpcRequest;
    try {
      rpcRequest = JSON.parse(body) as JsonRpcRequest;
    } catch {
      sendJson(res, 400, makeErrorResponse(null, -32700, 'Parse error: invalid JSON'));
      return;
    }

    if (!rpcRequest.jsonrpc || rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
      sendJson(res, 400, makeErrorResponse(
        rpcRequest.id ?? null,
        -32600,
        'Invalid JSON-RPC request: missing jsonrpc or method',
      ));
      return;
    }

    // Intercept the request
    const { response: earlyResponse, forwardBody } = await handleMCPRequest(config, rpcRequest);

    // If we got an early response (e.g., blocked), return it now
    if (earlyResponse) {
      sendJson(res, 200, earlyResponse);
      return;
    }

    // Forward to upstream
    if (!forwardBody) {
      sendJson(res, 500, makeErrorResponse(rpcRequest.id ?? null, -32603, 'Internal error'));
      return;
    }

    try {
      // Extract relevant headers to forward (skip host, content-length)
      const forwardHeaders: Record<string, string> = {};
      const skipHeaders = new Set(['host', 'content-length', 'connection']);
      for (const [key, value] of Object.entries(req.headers)) {
        if (!skipHeaders.has(key.toLowerCase()) && typeof value === 'string') {
          forwardHeaders[key] = value;
        }
      }

      const upstream = await forwardToUpstream(config, forwardBody, forwardHeaders);

      // Process the upstream response (de-pseudonymize, scan result)
      const processedBody = await handleUpstreamResponse(config, rpcRequest, upstream.body);

      // Forward upstream response headers (except content-length, we recalculate)
      const responseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(processedBody)),
        'X-Iron-Gate-Proxy': 'true',
      };

      res.writeHead(upstream.status, responseHeaders);
      res.end(processedBody);
    } catch (err) {
      console.error('[mcp-proxy] Upstream request failed:', (err as Error).message);
      sendJson(res, 502, makeErrorResponse(
        rpcRequest.id ?? null,
        -32603,
        `Failed to reach upstream MCP server: ${(err as Error).message}`,
      ));
    }
  });

  return server;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const config = loadConfig();

  console.log('[mcp-proxy] Iron Gate MCP Proxy starting...');
  console.log(`[mcp-proxy] Upstream:            ${config.upstreamUrl}`);
  console.log(`[mcp-proxy] Listen port:         ${config.listenPort}`);
  console.log(`[mcp-proxy] Pseudonymization:    ${config.enablePseudonymization ? 'enabled' : 'disabled'}`);
  console.log(`[mcp-proxy] Block threshold:     ${config.blockThreshold}`);
  console.log(`[mcp-proxy] Pseudonymize at:     ${config.pseudonymizeThreshold}`);
  console.log(`[mcp-proxy] Log all calls:       ${config.logAllCalls}`);
  console.log(`[mcp-proxy] Firm ID:             ${config.firmId || '(not set)'}`);
  console.log(`[mcp-proxy] Iron Gate API:       ${config.apiUrl || '(not set)'}`);

  const server = createProxyServer(config);

  server.listen(config.listenPort, () => {
    console.log(`[mcp-proxy] Listening on http://localhost:${config.listenPort}`);
    console.log(`[mcp-proxy] Health check: http://localhost:${config.listenPort}/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[mcp-proxy] Shutting down...');
    server.close(() => {
      console.log('[mcp-proxy] Server closed.');
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
