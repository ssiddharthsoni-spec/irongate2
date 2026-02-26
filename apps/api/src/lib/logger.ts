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

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const minLevel = getConfiguredLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  CONSOLE_FN[level](JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),
};
