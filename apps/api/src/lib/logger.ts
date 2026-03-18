/**
 * Structured JSON logger for the Iron Gate API.
 *
 * Outputs single-line JSON to stdout/stderr, consistent with the format used
 * by the request-logger middleware. Designed for ingestion by SIEM systems,
 * log aggregators, and the Iron Gate audit pipeline.
 *
 * Configuration:
 *   LOG_LEVEL env var controls the minimum severity (default: 'info').
 *   Levels in ascending severity: debug, info, warn, error.
 *
 * Usage:
 *   import { logger } from '../lib/logger';
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Database connection failed', { error: err.message });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CONSOLE_FN: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (env in LEVEL_ORDER) {
    return env as LogLevel;
  }
  return 'info';
}

// ── PII Sanitization ──────────────────────────────────────────────────────────
// Prevents accidental PII leakage in log output.

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { pattern: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b/g, replacement: '[CARD_REDACTED]' },
  { pattern: /(?:sk|pk|ig)_[a-zA-Z0-9]{16,}/g, replacement: '[API_KEY_REDACTED]' },
  { pattern: /postgres(?:ql)?:\/\/[^\s"'}\]]+/gi, replacement: '[DB_URI_REDACTED]' },
  { pattern: /rediss?:\/\/[^\s"'}\]]+/gi, replacement: '[REDIS_URI_REDACTED]' },
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[JWT_REDACTED]' },
];

/** Sanitize a string by replacing known PII patterns with redaction markers. */
export function sanitizeForLogging(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Deep-sanitize a metadata object — sanitizes all string values recursively. */
function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeForLogging(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeMeta(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Core Emitter ──────────────────────────────────────────────────────────────

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const minLevel = getConfiguredLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitizeForLogging(message),
    ...(meta ? sanitizeMeta(meta) : {}),
  };

  CONSOLE_FN[level](JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),

  /** Create a child logger that attaches a requestId to every log line. */
  withRequestId(requestId: string) {
    return {
      debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, { requestId, ...meta }),
      info: (message: string, meta?: Record<string, unknown>) => emit('info', message, { requestId, ...meta }),
      warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, { requestId, ...meta }),
      error: (message: string, meta?: Record<string, unknown>) => emit('error', message, { requestId, ...meta }),
    };
  },
};
