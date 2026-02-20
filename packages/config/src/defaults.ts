import type { FirmConfig, DocumentType } from '@iron-gate/types';

export const SENSITIVITY_THRESHOLDS = {
  LOW_MAX: 25,
  MEDIUM_MAX: 60,
  HIGH_MAX: 85,
  CRITICAL_MIN: 86,
} as const;

export const DEFAULT_FIRM_CONFIG: Omit<FirmConfig, 'id' | 'name'> = {
  mode: 'audit',
  sensitivityThresholds: {
    warn: 40,
    block: 70,
    proxy: 50,
  },
  allowedTools: [],
  blockedTools: [],
  customEntityWeights: {},
  llmProviders: [],
};

export const DOCUMENT_TYPE_MULTIPLIERS: Record<DocumentType, number> = {
  casual_question: 0.5,
  email_draft: 1.2,
  contract_clause: 2.0,
  meeting_notes: 1.3,
  code_snippet: 0.8,
  financial_data: 1.8,
  litigation_doc: 2.0,
  client_memo: 1.5,
  personal: 0.3,
};

export const VOLUME_THRESHOLDS = {
  SHORT: 100,    // < 100 chars = no volume penalty
  MEDIUM: 500,   // 100-500 chars = small boost
  LONG: 2000,    // 500-2000 chars = moderate boost
  VERY_LONG: 5000, // > 5000 chars = large boost (likely pasted document)
} as const;

export const VOLUME_SCORES = {
  SHORT: 0,
  MEDIUM: 5,
  LONG: 10,
  VERY_LONG: 20,
} as const;
