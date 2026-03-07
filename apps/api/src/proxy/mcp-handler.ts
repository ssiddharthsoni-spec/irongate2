/**
 * MCP (Model Context Protocol) Proxy Handler — IG-019
 *
 * Intercepts MCP tool_call and tool_result messages flowing through the
 * Iron Gate proxy, scans them for sensitive data, and applies blocking
 * or pseudonymization.
 */

import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// MCP message types
// ---------------------------------------------------------------------------

interface MCPToolCall {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface MCPToolResult {
  result?: {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
}

export interface MCPScanResult {
  direction: 'outbound' | 'inbound';
  hasSensitiveData: boolean;
  entities: Array<{ type: string; match: string; redacted: string }>;
  sensitivityScore: number;
  shouldBlock: boolean;
  mcpMethod?: string;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Sensitive data patterns (self-contained — no extension imports)
// ---------------------------------------------------------------------------

const PATTERNS: Array<{ type: string; regex: RegExp; weight: number }> = [
  { type: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g, weight: 30 },
  { type: 'CREDIT_CARD', regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, weight: 30 },
  { type: 'EMAIL', regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, weight: 10 },
  { type: 'PHONE', regex: /\b(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g, weight: 8 },
  { type: 'API_KEY', regex: /\b(?:sk|pk|api|token|key|secret)[_-][a-zA-Z0-9]{16,}\b/gi, weight: 25 },
  { type: 'AWS_KEY', regex: /\bAKIA[0-9A-Z]{16}\b/g, weight: 30 },
  { type: 'JWT', regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, weight: 20 },
  { type: 'IP_ADDRESS', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, weight: 5 },
  { type: 'PASSWORD', regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/gi, weight: 25 },
  { type: 'CONNECTION_STRING', regex: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']{10,}/gi, weight: 30 },
];

const BLOCK_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function extractText(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (obj === null || obj === undefined) return '';
  if (Array.isArray(obj)) return obj.map(extractText).join(' ');
  if (typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).map(extractText).join(' ');
  }
  return String(obj);
}

export async function scanMCPMessage(
  message: unknown,
  direction: 'outbound' | 'inbound',
): Promise<MCPScanResult> {
  const result: MCPScanResult = {
    direction,
    hasSensitiveData: false,
    entities: [],
    sensitivityScore: 0,
    shouldBlock: false,
  };

  if (!message || typeof message !== 'object') return result;

  const msg = message as Record<string, unknown>;

  // Determine MCP message type
  if (msg.method === 'tools/call' && msg.params) {
    const toolCall = message as MCPToolCall;
    result.mcpMethod = 'tools/call';
    result.toolName = toolCall.params.name;
    const text = extractText(toolCall.params.arguments);
    scanText(text, result);
  } else if (msg.result && typeof msg.result === 'object') {
    const toolResult = message as MCPToolResult;
    result.mcpMethod = 'tools/result';
    if (toolResult.result?.content) {
      for (const item of toolResult.result.content) {
        if (item.text) {
          scanText(item.text, result);
        }
      }
    }
  } else {
    // Generic message — scan all text content
    const text = extractText(message);
    if (text.length > 0) {
      scanText(text, result);
    }
  }

  result.shouldBlock = result.sensitivityScore >= BLOCK_THRESHOLD;
  return result;
}

function scanText(text: string, result: MCPScanResult): void {
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      result.hasSensitiveData = true;
      result.sensitivityScore = Math.min(100, result.sensitivityScore + pattern.weight);
      result.entities.push({
        type: pattern.type,
        match: match[0],
        redacted: `[${pattern.type}_REDACTED]`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function createMCPProxy() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('application/json')) {
      await next();
      return;
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      await next();
      return;
    }

    if (!body || typeof body !== 'object') {
      await next();
      return;
    }

    const msg = body as Record<string, unknown>;

    // Check if this is an MCP-style message
    const isMCPToolCall = msg.method === 'tools/call';
    const isMCPResult = 'result' in msg && typeof msg.result === 'object';

    if (!isMCPToolCall && !isMCPResult) {
      await next();
      return;
    }

    const direction = isMCPToolCall ? 'outbound' : 'inbound';
    const scanResult = await scanMCPMessage(body, direction);

    if (scanResult.hasSensitiveData) {
      logger.warn('MCP interception: sensitive data detected', {
        direction,
        toolName: scanResult.toolName,
        mcpMethod: scanResult.mcpMethod,
        entityCount: scanResult.entities.length,
        sensitivityScore: scanResult.sensitivityScore,
        shouldBlock: scanResult.shouldBlock,
        entityTypes: [...new Set(scanResult.entities.map(e => e.type))],
      });

      if (scanResult.shouldBlock) {
        return c.json(
          {
            error: 'MCP request blocked',
            message: 'Sensitive data detected in MCP tool call. This request has been blocked by Iron Gate.',
            sensitivityScore: scanResult.sensitivityScore,
            detectedEntityTypes: [...new Set(scanResult.entities.map(e => e.type))],
          },
          403,
        );
      }
    }

    await next();
  });
}
