// ==========================================
// Iron Gate — Shared Types
// ==========================================

// --- AI Tool Detection ---

export type AIToolId =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'copilot'
  | 'deepseek'
  | 'poe'
  | 'perplexity'
  | 'you'
  | 'huggingface'
  | 'groq'
  | 'generic';

export interface AIToolInfo {
  id: AIToolId;
  name: string;
  url: string;
}

// --- Entity Detection ---

export type EntityType =
  | 'PERSON'
  | 'ORGANIZATION'
  | 'LOCATION'
  | 'DATE'
  | 'PHONE_NUMBER'
  | 'EMAIL'
  | 'CREDIT_CARD'
  | 'SSN'
  | 'MONETARY_AMOUNT'
  | 'ACCOUNT_NUMBER'
  | 'IP_ADDRESS'
  | 'MEDICAL_RECORD'
  | 'PASSPORT_NUMBER'
  | 'DRIVERS_LICENSE'
  | 'MATTER_NUMBER'
  | 'CLIENT_MATTER_PAIR'
  | 'PRIVILEGE_MARKER'
  | 'DEAL_CODENAME'
  | 'OPPOSING_COUNSEL'
  // Secret/credential types
  | 'API_KEY'
  | 'DATABASE_URI'
  | 'AUTH_TOKEN'
  | 'PRIVATE_KEY'
  | 'AWS_CREDENTIAL'
  | 'GCP_CREDENTIAL'
  | 'AZURE_CREDENTIAL';

export interface DetectedEntity {
  type: EntityType;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'gliner' | 'regex' | 'presidio' | 'keyword' | 'plugin' | 'client_matter';
}

export interface DetectionResult {
  entities: DetectedEntity[];
  processingTimeMs: number;
  modelUsed: 'gliner' | 'regex' | 'presidio';
}

// --- Sensitivity Scoring ---

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SensitivityScore {
  score: number; // 0-100
  level: SensitivityLevel;
  explanation: string;
  breakdown: ScoreBreakdown;
  entities: DetectedEntity[];
}

export interface ScoreBreakdown {
  entityScore: number;
  volumeScore: number;
  contextScore: number;
  legalBoost: number;
  documentTypeMultiplier: number;
  conversationEscalation: number;
  firmKnowledgeBoost: number;
}

// --- Events ---

export type EventAction = 'pass' | 'warn' | 'block' | 'proxy' | 'override';

export interface PromptEvent {
  id: string;
  firmId: string;
  userId: string;
  aiToolId: AIToolId;
  aiToolUrl: string;
  promptHash: string; // SHA-256, never raw text
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: SensitivityLevel;
  entities: DetectedEntity[];
  action: EventAction;
  overrideReason?: string;
  captureMethod: 'dom' | 'fetch' | 'submit';
  sessionId: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface EventBatch {
  events: PromptEvent[];
  batchId: string;
  timestamp: string;
}

export interface EventResponse {
  eventId: string;
  actionRequired: EventAction;
  message?: string;
}

// --- Dashboard ---

export interface FirmOverview {
  totalInteractions: number;
  totalProtected: number;
  totalBlocked: number;
  avgSensitivityScore: number;
  scoreDistribution: ScoreDistribution;
  toolBreakdown: ToolBreakdown[];
  dailyTrend: DailyTrend[];
  topUsers: TopUser[];
  recentHighRisk: PromptEvent[];
}

export interface ScoreDistribution {
  low: number;     // 0-25
  medium: number;  // 26-60
  high: number;    // 61-85
  critical: number; // 86-100
}

export interface ToolBreakdown {
  toolId: AIToolId;
  toolName: string;
  count: number;
  percentage: number;
}

export interface DailyTrend {
  date: string;
  count: number;
  avgScore: number;
}

export interface TopUser {
  userId: string;
  displayName: string;
  promptCount: number;
  avgScore: number;
  highRiskCount: number;
}

// --- Feedback ---

export interface EntityFeedback {
  id: string;
  eventId: string;
  entityType: EntityType;
  entityHash: string; // Never raw text
  isCorrect: boolean;
  correctedType?: EntityType;
  userId: string;
  firmId: string;
  timestamp: string;
}

export interface MissedEntityReport {
  id: string;
  eventId: string;
  suggestedType: EntityType;
  textHash: string;
  startOffset: number;
  endOffset: number;
  userId: string;
  firmId: string;
  timestamp: string;
}

// --- Document Classification ---

export type DocumentType =
  | 'casual_question'
  | 'email_draft'
  | 'contract_clause'
  | 'meeting_notes'
  | 'code_snippet'
  | 'financial_data'
  | 'litigation_doc'
  | 'client_memo'
  | 'personal';

// --- Proxy (Phase 2) ---

export interface ProxyRequest {
  promptText: string;
  aiToolId: AIToolId;
  sessionId: string;
  userId: string;
  firmId: string;
}

export interface ProxyAnalysis {
  originalScore: SensitivityScore;
  maskedPrompt: string;
  pseudonymMap: Record<string, string>; // original -> pseudonym
  recommendedRoute: LLMRoute;
}

export type LLMRoute = 'passthrough' | 'cloud_masked' | 'private_llm';

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'azure';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

// --- Proxy (Phase 2) — Extended ---

export interface ProxyAnalyzeRequest {
  promptText: string;
  aiToolId: AIToolId;
  sessionId: string;
  userId: string;
  firmId: string;
}

export interface ProxyAnalyzeResponse {
  originalScore: SensitivityScore;
  maskedPrompt: string;
  pseudonymMap: Record<string, string>;
  recommendedRoute: LLMRoute;
  entitiesFound: number;
}

export interface ProxySendRequest {
  maskedPrompt: string;
  route: LLMRoute;
  sessionId: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProxySendResponse {
  response: string;
  model: string;
  provider: string;
  tokensUsed: { prompt: number; completion: number };
  latencyMs: number;
}

// --- Firm Configuration ---

export interface FirmConfig {
  id: string;
  name: string;
  mode: 'audit' | 'proxy';
  sensitivityThresholds: {
    warn: number;  // default 40
    block: number; // default 70
    proxy: number; // default 50
  };
  allowedTools: AIToolId[];
  blockedTools: AIToolId[];
  customEntityWeights: Partial<Record<EntityType, number>>;
  llmProviders: LLMProviderConfig[];
}

// --- Messages (Extension <-> Service Worker) ---

export type ExtensionMessage =
  | { type: 'PROMPT_DETECTED'; payload: { text: string; aiToolId: AIToolId; captureMethod: string } }
  | { type: 'DETECTION_RESULT'; payload: DetectionResult }
  | { type: 'SENSITIVITY_SCORE'; payload: SensitivityScore }
  | { type: 'EVENT_SUBMITTED'; payload: EventResponse }
  | { type: 'CONFIG_UPDATE'; payload: Partial<FirmConfig> }
  | { type: 'MODEL_STATUS'; payload: { loaded: boolean; size: number } }
  | { type: 'PROXY_ANALYZE'; payload: { text: string; aiToolId: AIToolId; sessionId: string } }
  | { type: 'PROXY_RESULT'; payload: ProxyAnalyzeResponse }
  | { type: 'PROXY_RESPONSE'; payload: ProxySendResponse }
  | { type: 'BLOCK_OVERRIDE'; payload: { eventId: string; reason: string } }
  | { type: 'MODE_CHANGED'; payload: { mode: 'audit' | 'proxy' } }
  | { type: 'ENTITY_FEEDBACK'; payload: EntityFeedback }
  | { type: 'PROMPT_SUBMITTED'; payload: { text: string; aiToolId: AIToolId; captureMethod: string } };

// ==========================================
// ★ MOAT Feature Types
// ==========================================

// --- Cryptographic Audit Trail ---

export interface AuditChainEntry {
  eventId: string;
  eventHash: string;
  previousHash: string | null;
  chainPosition: number;
  firmId: string;
  timestamp: string;
}

export interface ChainVerification {
  valid: boolean;
  brokenAt?: number;
  totalEvents: number;
  lastHash?: string;
  verifiedAt: string;
}

// --- Entity Co-occurrence (Sensitivity Graph) ---

export interface CoOccurrence {
  id: string;
  firmId: string;
  entityAHash: string;
  entityAType: EntityType;
  entityBHash: string;
  entityBType: EntityType;
  coOccurrenceCount: number;
  avgContextScore: number;
  lastSeenAt: string;
  firstSeenAt: string;
}

// --- Inferred Entities (Inference Engine) ---

export type InferredEntityStatus = 'pending' | 'confirmed' | 'rejected';

export interface InferredEntity {
  id: string;
  firmId: string;
  textHash: string;
  inferredType: string;
  confidence: number;
  evidenceCount: number;
  status: InferredEntityStatus;
  confirmedBy?: string;
  firstSeenAt: string;
  promotedAt?: string;
}

// --- Sensitivity Patterns ---

export interface SensitivityPattern {
  id: string;
  firmId: string;
  patternHash: string;
  entityTypes: EntityType[];
  triggerCount: number;
  avgScore: number;
  isGlobal: boolean;
  discoveredAt: string;
}

// --- Trust Score ---

export interface TrustDimension {
  name: string;
  score: number;        // 0-100
  weight: number;       // 0-1
  description: string;
}

export interface TrustScore {
  overall: number;      // 0-100
  dimensions: TrustDimension[];
  firmId: string;
  computedAt: string;
}

// --- Firm Plugins ---

export interface FirmPlugin {
  id: string;
  firmId: string;
  name: string;
  description?: string;
  version: string;
  code: string;
  entityTypes: string[];
  isActive: boolean;
  hitCount: number;
  falsePositiveRate: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- Webhook Subscriptions ---

export type WebhookEventType =
  | 'high_risk_detected'
  | 'executive_lens_triggered'
  | 'new_ai_tool_detected'
  | 'anomaly_detected'
  | 'chain_verification_failed'
  | 'inference_entity_discovered';

export interface WebhookSubscription {
  id: string;
  firmId: string;
  url: string;
  eventTypes: WebhookEventType[];
  secret: string;
  isActive: boolean;
  createdAt: string;
}
