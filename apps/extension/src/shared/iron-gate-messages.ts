/**
 * Iron Gate Message Type Definitions
 *
 * Typed interfaces for ALL cross-context messages in the extension.
 * Replaces `as any` casts with discriminated unions.
 *
 * Three communication channels:
 * 1. window.postMessage (main-world ↔ content script): IRON_GATE_* types
 * 2. chrome.runtime.sendMessage (content script ↔ worker ↔ sidepanel): SENSITIVITY_SCORE, PROMPT_*, etc.
 * 3. BroadcastChannel (main-world → content script, private): PERSIST_REVERSE_MAP, FILE_UPLOAD, SERVER_PROCESS
 */

// ─── Detection Result (shared between all contexts) ─────────────────────────

export interface DetectionEntity {
  type: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex' | 'llm' | 'dictionary' | 'secret';
  isSensitive?: boolean;
  contextNote?: string;
}

export interface PseudonymMapping {
  pseudonym: string;
  type: string;
  length: number;
}

// ─── Worker → Sidepanel Messages ────────────────────────────────────────────

export interface SensitivityScorePayload {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  entities: DetectionEntity[];
  aiToolId: string;
  promptHash?: string;
  promptLength?: number;
  originalPrompt?: string;
  maskedPrompt?: string;
  pseudonymMappings?: PseudonymMapping[];
  isProxy?: boolean;
  wireIntercept?: boolean;
  tabId?: number | null;
  realtime?: boolean;
  judgmentSource?: string;
  judgmentVerdict?: string;
  judgmentLatencyMs?: number;
}

export interface SensitivityScoreMessage {
  type: 'SENSITIVITY_SCORE';
  payload: SensitivityScorePayload;
}

export interface PromptClearedMessage {
  type: 'PROMPT_CLEARED';
  payload: { tabId?: number; aiToolId?: string };
}

export interface PromptCleanSubmitMessage {
  type: 'PROMPT_CLEAN_SUBMIT';
  payload: { tabId?: number; score?: number; level?: string };
}

export interface GhostDetectionMessage {
  type: 'GHOST_DETECTION';
  payload: { label: string; confidence: number };
}

export interface AnomalyMessage {
  type: 'IRON_GATE_ANOMALY';
  payload: { type: string; message: string; ratio?: number; dominantVerdict?: string };
}

// ─── Content Script → Worker Messages ───────────────────────────────────────

export interface PromptDetectedPayload {
  text: string;
  aiToolId: string;
  captureMethod: 'dom' | 'fetch' | 'submit' | 'clipboard' | 'pasted';
}

export interface PromptDetectedMessage {
  type: 'PROMPT_DETECTED';
  payload: PromptDetectedPayload;
}

// ─── BroadcastChannel Messages (private, nonce-keyed) ───────────────────────

export interface PersistReverseMapMessage {
  type: 'IRON_GATE_PERSIST_REVERSE_MAP';
  map: Record<string, string>;
  _seq: number;
}

export interface FileUploadMessage {
  type: 'IRON_GATE_FILE_UPLOAD';
  fileName: string;
  fileSize: number;
  fileType: string;
  fileBase64: string;
  url: string;
  timestamp: number;
}

export interface ServerProcessRequestMessage {
  type: 'IRON_GATE_SERVER_PROCESS_REQUEST';
  requestId: string;
  text: string;
  aiToolId: string;
}

// ─── Main-World → Content Script (via postMessage) ──────────────────────────

export interface GemmaVerdictMessage {
  type: 'IRON_GATE_GEMMA_VERDICT';
  intent: string;
  sensitivity: string;
  score: number;
  verdict: string;
  source: string;
}

// ─── Discriminated Union ────────────────────────────────────────────────────

export type IronGateWorkerMessage =
  | SensitivityScoreMessage
  | PromptClearedMessage
  | PromptCleanSubmitMessage
  | GhostDetectionMessage
  | AnomalyMessage;

export type IronGateSecureChannelMessage =
  | PersistReverseMapMessage
  | FileUploadMessage
  | ServerProcessRequestMessage;
