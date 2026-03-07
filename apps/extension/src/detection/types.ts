export interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'gliner' | 'regex' | 'presidio' | 'keyword' | 'dictionary';
}

export interface DetectionResult {
  entities: DetectedEntity[];
  processingTimeMs: number;
  modelUsed: 'gliner' | 'regex' | 'hybrid';
}

export interface ModelStatus {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  modelSize: number;
  backend: 'webgpu' | 'wasm' | 'none';
}

/**
 * Entity types that are ALWAYS high-risk regardless of context.
 * Single source of truth — used by scorer.ts, context-analyzer.ts, etc.
 */
export const HIGH_PII_TYPES: ReadonlySet<string> = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI', 'PRIVATE_KEY', 'AUTH_TOKEN',
  'CLASSIFICATION_MARKING', 'EXPORT_CONTROL',
]);

/**
 * Entity types that should NEVER have their confidence reduced.
 * Subset of HIGH_PII_TYPES — secrets and credentials.
 */
export const ALWAYS_CRITICAL_TYPES: ReadonlySet<string> = new Set([
  'API_KEY', 'PRIVATE_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI',
]);

export const DEFAULT_ENTITY_TYPES = [
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'DATE',
  'PHONE_NUMBER',
  'EMAIL',
  'CREDIT_CARD',
  'SSN',
  'MONETARY_AMOUNT',
  'ACCOUNT_NUMBER',
  'IP_ADDRESS',
  'MEDICAL_RECORD',
  'PASSPORT_NUMBER',
  'DRIVERS_LICENSE',
] as const;
