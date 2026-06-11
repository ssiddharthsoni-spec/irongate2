export interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex' | 'presidio' | 'keyword' | 'dictionary' | 'agent' | 'semantic' | 'metadata-classifier';
}

export interface DetectionResult {
  entities: DetectedEntity[];
  processingTimeMs: number;
  modelUsed: 'regex' | 'hybrid';
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
  'SSN', 'CREDIT_CARD', 'CVV', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'ROUTING_NUMBER', 'BANK_ACCOUNT', 'ACCOUNT_NUMBER', 'EMPLOYEE_ID',
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI', 'PRIVATE_KEY', 'AUTH_TOKEN',
  'CLASSIFICATION_MARKING', 'EXPORT_CONTROL',
  'ENCODED_PII', // Base64-encoded PII — deliberately obfuscated, always high-risk
  // International national-ID numbers — same risk class as US SSN.
  // Names match the canonical types used across scorer.ts, intent-suppression.ts,
  // entity-contextualizer.ts, and agent-detector.ts. Per Sr. Engineer Audit · Item 10,
  // these were already defined in regex but not surfaced in HIGH_PII_TYPES,
  // so they weren't benefiting from the "always critical floor" treatment.
  'UK_NINO', 'CANADIAN_SIN', 'INDIAN_AADHAAR', 'AUSTRALIAN_TFN',
  'GERMAN_TAX_ID', 'FRENCH_INSEE', 'EU_IBAN',
]);

/**
 * Entity types that should NEVER have their confidence reduced.
 * Subset of HIGH_PII_TYPES — secrets and credentials.
 */
// ── Score bands — THE single source (WP3) ───────────────────────────────────
// low 0-25 · medium 26-60 · high 61-85 · critical 86-100. Every consumer
// imports scoreToLevel from here; private copies are banned by an
// architecture invariant (three identical copies existed and only luck
// kept them from diverging).
export const SCORE_BANDS = {
  lowMax: 25,
  mediumMax: 60,
  highMax: 85,
} as const;

export function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= SCORE_BANDS.lowMax) return 'low';
  if (score <= SCORE_BANDS.mediumMax) return 'medium';
  if (score <= SCORE_BANDS.highMax) return 'high';
  return 'critical';
}

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
