// ============================================================================
// @contracts/entities — The single source of truth for all detection types.
//
// Every detector, the judgment layer, the sidepanel, and the audit trail
// import from here. Drift is a compile error, not a runtime surprise.
// ============================================================================

/** All entity types the system can detect. Exhaustive. */
export const ENTITY_TYPES = [
  // Identity
  'PERSON', 'ORGANIZATION', 'LOCATION',
  // Contact
  'EMAIL', 'PHONE_NUMBER', 'ADDRESS',
  // Government IDs
  'SSN', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'UK_NINO', 'CANADIAN_SIN', 'INDIAN_AADHAAR',
  'AUSTRALIAN_TFN', 'GERMAN_TAX_ID', 'FRENCH_INSEE',
  // Financial
  'CREDIT_CARD', 'BANK_ACCOUNT', 'ACCOUNT_NUMBER', 'ROUTING_NUMBER',
  'EIN', 'EU_IBAN', 'MONETARY_AMOUNT',
  // Temporal
  'DATE', 'DATE_OF_BIRTH',
  // Secrets / Credentials
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'AZURE_CREDENTIAL',
  'DATABASE_URI', 'AUTH_TOKEN', 'PRIVATE_KEY',
  // Legal
  'MATTER_NUMBER', 'PRIVILEGE_MARKER',
  // Business
  'DEAL_CODENAME', 'PROJECT_NAME', 'EMPLOYEE_ID', 'TICKER',
  'PERCENTAGE', 'HEADCOUNT',
  // Medical
  'MEDICAL_RECORD',
  // Education
  'STUDENT_ID', 'EDUCATION_RECORD',
  // Government / Defense
  'CLASSIFICATION_MARKING', 'CUI_MARKING', 'EXPORT_CONTROL',
  // Insurance
  'POLICY_NUMBER', 'NAIC_CODE',
  // Energy
  'WELL_IDENTIFIER', 'REGULATORY_DOCKET',
  // Real Estate
  'PARCEL_NUMBER', 'MLS_NUMBER',
  // Network
  'IP_ADDRESS',
  // Anti-evasion
  'ENCODED_PII',
  // Security codes
  'CVV',
  // Vehicle
  'VIN',
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

/** Entity types where regex is always right — LLM cannot override. */
export const BRIGHT_LINE_TYPES: ReadonlySet<EntityType> = new Set([
  'SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL',
  'DATABASE_URI', 'PRIVATE_KEY', 'CLASSIFICATION_MARKING', 'EXPORT_CONTROL',
  'CVV', 'AUTH_TOKEN',
]);

/** Entity types that are values, not identifiers — detected but not pseudonymized. */
export const VALUE_TYPES: ReadonlySet<EntityType> = new Set([
  'MONETARY_AMOUNT', 'DATE', 'PERCENTAGE', 'EMPLOYEE_ID',
]);

/** Verdicts the judgment layer can produce. */
export const VERDICTS = ['allow', 'nudge', 'mask', 'block'] as const;
export type Verdict = typeof VERDICTS[number];

/** Sensitivity levels. */
export const LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type Level = typeof LEVELS[number];

/** Sources that can produce a detection. */
export const DETECTOR_SOURCES = [
  'regex', 'dictionary', 'heuristic', 'llm', 'firm-lexicon',
] as const;
export type DetectorSource = typeof DETECTOR_SOURCES[number];

/** Judgment provenance. */
export const JUDGMENT_SOURCES = [
  'gemma4', 'bright-line', 'pattern-only', 'merged',
] as const;
export type JudgmentSource = typeof JUDGMENT_SOURCES[number];

/** AI tools we support. */
export const AI_TOOLS = [
  'chatgpt', 'claude', 'gemini', 'copilot', 'deepseek',
  'poe', 'perplexity', 'you', 'huggingface', 'groq',
  'grok', 'mistral', 'generic',
] as const;
export type AIToolId = typeof AI_TOOLS[number];
