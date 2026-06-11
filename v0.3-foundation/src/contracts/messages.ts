// ============================================================================
// @contracts/messages — Discriminated union for the message bus.
//
// Replaces 112 ad-hoc string types with ~12 typed messages. The router
// validates every inbound message against this union. Unknown types are
// dropped with a structured log. You cannot send a message the union
// doesn't know about — the compiler rejects it.
// ============================================================================

import type { EvidenceBundle } from './evidence';
import type { Judgment } from './judgment';
import type { DetectionResult } from './detection-result';

// ── Message definitions ─────────────────────────────────────────────────────

export interface PromptAnalyzeMessage {
  type: 'PROMPT_ANALYZE';
  payload: {
    text: string;
    aiToolId: string;
    tabId: number;
    captureMethod: 'dom' | 'fetch' | 'submit';
  };
}

export interface PromptVerdictMessage {
  type: 'PROMPT_VERDICT';
  payload: DetectionResult;
}

export interface FileAnalyzeMessage {
  type: 'FILE_ANALYZE';
  payload: {
    fileName: string;
    fileSize: number;
    fileType: string;
    fileBase64: string;
    aiToolId: string;
    tabId: number;
  };
}

export interface FileVerdictMessage {
  type: 'FILE_VERDICT';
  payload: DetectionResult;
}

export interface ConfigReadMessage {
  type: 'CONFIG_READ';
  payload: {
    keys: string[];
  };
}

export interface ConfigWriteMessage {
  type: 'CONFIG_WRITE';
  payload: Record<string, unknown>;
}

export interface ActivityAppendMessage {
  type: 'ACTIVITY_APPEND';
  payload: {
    result: DetectionResult;
  };
}

export interface StateSubscribeMessage {
  type: 'STATE_SUBSCRIBE';
  payload: {
    keys: string[];
  };
}

export interface StateSnapshotMessage {
  type: 'STATE_SNAPSHOT';
  payload: Record<string, unknown>;
}

export interface HealthPingMessage {
  type: 'HEALTH_PING';
  payload: Record<string, never>;
}

export interface TelemetryEmitMessage {
  type: 'TELEMETRY_EMIT';
  payload: {
    event: string;
    data: Record<string, unknown>;
  };
}

export interface WarmupTickMessage {
  type: 'WARMUP_TICK';
  payload: {
    ollamaReachable: boolean;
    modelLoaded: boolean;
    latencyMs: number;
    modelTag: string;
  };
}

// ── The union ───────────────────────────────────────────────────────────────

export type Message =
  | PromptAnalyzeMessage
  | PromptVerdictMessage
  | FileAnalyzeMessage
  | FileVerdictMessage
  | ConfigReadMessage
  | ConfigWriteMessage
  | ActivityAppendMessage
  | StateSubscribeMessage
  | StateSnapshotMessage
  | HealthPingMessage
  | TelemetryEmitMessage
  | WarmupTickMessage;

export type MessageType = Message['type'];

/** All valid message types as a set for runtime validation. */
export const MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  'PROMPT_ANALYZE',
  'PROMPT_VERDICT',
  'FILE_ANALYZE',
  'FILE_VERDICT',
  'CONFIG_READ',
  'CONFIG_WRITE',
  'ACTIVITY_APPEND',
  'STATE_SUBSCRIBE',
  'STATE_SNAPSHOT',
  'HEALTH_PING',
  'TELEMETRY_EMIT',
  'WARMUP_TICK',
]);

/** Type guard for the message union. */
export function isValidMessage(msg: unknown): msg is Message {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m['type'] === 'string' && MESSAGE_TYPES.has(m['type'] as MessageType);
}

/** Exhaustiveness check — use in switch default to get a compile error on unhandled types. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(x)}`);
}
