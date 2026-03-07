/**
 * Typed message definitions for Chrome extension messaging.
 *
 * Single source of truth — content scripts, worker, and sidepanel
 * all import from here. Renaming a field causes a compile error
 * everywhere it's used, preventing "fix A, break B" bugs.
 */

import type { SensitivityLevel } from '../detection/scorer';
import type { AccountType, SSODetectionResult } from '../content/sso-detector';
import type { ShadowAIEvent } from '../worker/shadow-ai-tracker';

// ── Content Script → Worker Messages ─────────────────────────────────────────

export interface PromptDetectedMessage {
  type: 'PROMPT_DETECTED';
  payload: {
    text: string;
    aiToolId: string;
    captureMethod: string;
  };
}

export interface PromptClearedMessage {
  type: 'PROMPT_CLEARED';
  payload: {
    aiToolId?: string;
  };
}

export interface PromptSubmittedMessage {
  type: 'PROMPT_SUBMITTED';
  payload: {
    text: string;
    aiToolId: string;
    sensitivityScore?: number;
    sessionId?: string;
  };
}

export interface SensitivityScoreMessage {
  type: 'SENSITIVITY_SCORE';
  payload: {
    score: number;
    level: SensitivityLevel;
    explanation?: string;
    entities: Array<{
      type: string;
      start: number;
      end: number;
      confidence: number;
      source: string;
      textHash?: string;
      length?: number;
    }>;
    aiToolId: string;
    tabId?: number;
    promptHash?: string;
    promptLength?: number;
    maskedPrompt?: string;
    pseudonymMappings?: Array<{ pseudonym: string; type: string; length: number }>;
    realtime?: boolean;
  };
}

export interface FileUploadDetectedMessage {
  type: 'FILE_UPLOAD_DETECTED';
  payload: {
    fileName: string;
    fileSize: number;
    fileType: string;
    fileBase64: string;
    aiToolId: string;
    timestamp: number;
    metadataOnly?: boolean;
  };
}

// ── Sidepanel → Worker Messages ──────────────────────────────────────────────

export interface ModeChangedMessage {
  type: 'MODE_CHANGED';
  payload: {
    mode: 'audit' | 'proxy';
  };
}

export interface SetApiKeyMessage {
  type: 'SET_API_KEY';
  payload: {
    apiKey: string;
  };
}

export interface BlockOverrideMessage {
  type: 'BLOCK_OVERRIDE';
  payload: {
    eventId: string;
    reason: string;
  };
}

export interface EntityFeedbackMessage {
  type: 'ENTITY_FEEDBACK';
  payload: {
    entityType: string;
    entityText: string;
    isCorrect: boolean;
    feedbackType: string;
    correctedType?: string;
  };
}

// ── Worker → Content Script Messages ─────────────────────────────────────────

export interface ProtectionStatusMessage {
  type: 'PROTECTION_STATUS';
  payload: {
    healthy: boolean;
    patchStatus: string;
    adapter: string;
  };
}

export interface FileScanResultMessage {
  type: 'FILE_SCAN_RESULT';
  payload: {
    fileName: string;
    fileType: string;
    fileSize: number;
    textLength: number;
    score: number;
    level: string;
    entitiesFound: number;
    explanation: string;
    entities: any[];
    breakdown: Record<string, number>;
    redactedText: string;
    entitiesRedacted: number;
    eventId: string;
    aiToolId: string;
    error?: string;
  };
}

// ── SSO / Shadow AI Messages ─────────────────────────────────────────────────

export interface SSODetectionResultMessage {
  type: 'SSO_DETECTION_RESULT';
  payload: SSODetectionResult & {
    aiToolId: string;
  };
}

export interface GetShadowAIStatsMessage {
  type: 'GET_SHADOW_AI_STATS';
}

// ── Simple query messages ────────────────────────────────────────────────────

export interface GetStatusMessage { type: 'GET_STATUS' }
export interface GetManagedStatusMessage { type: 'GET_MANAGED_STATUS' }
export interface GetAuditLogMessage { type: 'GET_AUDIT_LOG' }
export interface ClearAuditLogMessage { type: 'CLEAR_AUDIT_LOG' }
export interface OpenSidePanelMessage { type: 'OPEN_SIDE_PANEL' }

// ── Union type for all messages ──────────────────────────────────────────────

export type WorkerMessage =
  | PromptDetectedMessage
  | PromptClearedMessage
  | PromptSubmittedMessage
  | SensitivityScoreMessage
  | FileUploadDetectedMessage
  | ModeChangedMessage
  | SetApiKeyMessage
  | BlockOverrideMessage
  | EntityFeedbackMessage
  | SSODetectionResultMessage
  | GetShadowAIStatsMessage
  | GetStatusMessage
  | GetManagedStatusMessage
  | GetAuditLogMessage
  | ClearAuditLogMessage
  | OpenSidePanelMessage;
