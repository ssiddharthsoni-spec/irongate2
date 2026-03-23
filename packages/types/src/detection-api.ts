/**
 * Iron Gate — Detection API Contract
 *
 * THE authoritative API type definitions between extension and backend.
 * Extension team and API team build against this contract simultaneously.
 * Changes require both teams' sign-off.
 *
 * NOTE: The entity type here is named ApiDetectedEntity to avoid conflict
 * with the existing DetectedEntity in index.ts (which is the extension-side
 * detection type). Once the migration to server-side detection is complete,
 * this becomes the canonical entity type.
 */

// --- Entity Detection --------------------------------------------------------

/** Detected entity from any detection source (API contract) */
export interface ApiDetectedEntity {
  /** Entity type (PERSON, ORGANIZATION, LOCATION, etc.) */
  type: string;
  /** The matched text */
  text: string;
  /** Start position in source text */
  start: number;
  /** End position in source text */
  end: number;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Which detection system found it */
  source: 'dictionary' | 'presidio' | 'gliner' | 'regex' | 'secret_scanner' | 'custom';
}

// --- POST /v1/detect ---------------------------------------------------------

export interface DetectRequest {
  /** The text to analyze for entities */
  text: string;
  /** Organization ID for dictionary lookup and policy evaluation */
  org_id?: string;
  /** Which AI tool the text is being sent to */
  ai_tool?: string;
}

export interface DetectResponse {
  /** All detected entities */
  entities: ApiDetectedEntity[];
  /** Sensitivity score (0-100) */
  score: number;
  /** Sensitivity level */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Context classification */
  context_category: string;
  /** Processing time in milliseconds */
  processing_time_ms: number;
}

// --- POST /v1/pseudonymize ---------------------------------------------------

export interface PseudonymizeRequest {
  /** The text to detect and pseudonymize */
  text: string;
  /** Organization ID */
  org_id?: string;
  /** Session ID for consistent pseudonyms across messages */
  session_id?: string;
  /** Which AI tool */
  ai_tool?: string;
  /** User ID for policy evaluation */
  user_id?: string;
}

export interface PseudonymizeResponse {
  /** Text with entities replaced by pseudonyms */
  masked_text: string;
  /** All detected entities */
  entities: ApiDetectedEntity[];
  /** Forward map: original -> pseudonym */
  pseudonym_map: Record<string, string>;
  /** Reverse map: pseudonym -> original (for de-pseudonymization) */
  reverse_map: Record<string, string>;
  /** Sensitivity score (0-100) */
  score: number;
  /** Sensitivity level */
  level: string;
  /** Context classification */
  context_category: string;
  /** Policy engine decision */
  policy_decision: 'allow' | 'pseudonymize' | 'warn' | 'block';
  /** Human-readable policy explanation */
  policy_explanation: string;
  /** Server processing time */
  processing_time_ms: number;
  /** Server-assigned session ID */
  session_id: string;
}

// --- POST /v1/depseudonymize ------------------------------------------------

export interface DepseudonymizeRequest {
  /** Text containing pseudonyms to reverse */
  text: string;
  /** Session ID from the original pseudonymize call */
  session_id: string;
}

export interface DepseudonymizeResponse {
  /** Text with pseudonyms replaced by originals */
  text: string;
}

// --- POST /v1/policy/evaluate ------------------------------------------------

export interface PolicyEvaluateRequest {
  /** Entities detected in the text */
  entities: ApiDetectedEntity[];
  /** Context category of the prompt */
  context_category: string;
  /** Sensitivity score */
  score: number;
  /** Which AI tool */
  ai_tool?: string;
  /** User role for role-based policy */
  user_role?: string;
  /** User team for team-based policy */
  user_team?: string;
  /** Organization ID */
  org_id: string;
}

export interface PolicyEvaluateResponse {
  /** Policy decision */
  action: 'allow' | 'pseudonymize' | 'warn' | 'block';
  /** Human-readable explanation for the employee */
  explanation: string;
  /** Rule ID that triggered this decision */
  matched_rule_id?: string;
  /** Whether to notify (security team, manager, etc.) */
  notify?: string[];
  /** Compliance frameworks that apply */
  compliance_frameworks?: string[];
  /** Whether this was a dry-run evaluation */
  dry_run?: boolean;
}

// --- GET /v1/org/:id/config --------------------------------------------------

export interface OrgConfigResponse {
  /** Organization ID */
  org_id: string;
  /** Whether kill switch is active */
  kill_switch_enabled: boolean;
  /** Kill switch failure behavior */
  kill_switch_fail_mode: 'open' | 'closed';
  /** Active policy rules */
  policy_rules: PolicyRule[];
  /** Active compliance templates */
  compliance_templates: string[];
  /** Entity dictionary version hash (for change detection) */
  dictionary_version: string;
  /** Processing mode */
  processing_mode: 'local' | 'server' | 'shadow';
}

/** Single policy rule (stored as JSONB in database) */
export interface PolicyRule {
  id: string;
  /** Rule name for admin UI */
  name: string;
  /** Evaluation order (lower = higher priority) */
  priority: number;
  /** Conditions that must ALL match */
  conditions: {
    entity_type?: string;
    entity_type_in?: string[];
    context?: string;
    ai_tool?: string;
    user_role?: string;
    user_team?: string;
    entity_count_gte?: number;
    score_gte?: number;
    level?: string;
  };
  /** Action to take when conditions match */
  action: 'allow' | 'pseudonymize' | 'warn' | 'block';
  /** Who to notify */
  notify?: string[];
  /** Explanation shown to the employee */
  explanation: string;
  /** Log everything or only violations */
  audit_level: 'all' | 'violations_only';
  /** Whether rule is in dry-run (simulation) mode */
  dry_run: boolean;
  /** Whether rule is active */
  enabled: boolean;
}

// --- Audit Log Schema (Zero-Persistence) ------------------------------------

/** Audit log entry -- NO prompt_text column, NO raw_entities column */
export interface AuditLogEntry {
  id: string;
  org_id: string;
  /** SHA-256 hash of user ID -- never the actual email */
  user_id_hash: string;
  ai_tool: string;
  /** Entity types detected (e.g., ['PERSON', 'ORGANIZATION']) */
  entity_types: string[];
  entity_count: number;
  context_category: string;
  policy_decision: string;
  /** Rule that triggered the decision */
  matched_rule_id?: string;
  /** Whether this was from a dry-run rule */
  dry_run: boolean;
  created_at: string;
}

// --- Circuit Breaker States --------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerStatus {
  /** Extension -> API */
  extensionToApi: CircuitState;
  /** API -> Redis (entity dictionary, config cache) */
  apiToRedis: CircuitState;
  /** API -> PostgreSQL (audit log writes) */
  apiToPostgres: CircuitState;
}
