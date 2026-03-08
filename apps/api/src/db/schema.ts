import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  timestamp,
  jsonb,
  real,
  boolean,
  index,
  unique,
  pgEnum,
} from 'drizzle-orm/pg-core';

// Enums
export const sensitivityLevelEnum = pgEnum('sensitivity_level', ['low', 'medium', 'high', 'critical']);
export const eventActionEnum = pgEnum('event_action', ['pass', 'warn', 'block', 'proxy', 'override']);
export const firmModeEnum = pgEnum('firm_mode', ['audit', 'proxy']);

// --- Firms ---
export const firms = pgTable('firms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }),
  mode: firmModeEnum('mode').notNull().default('proxy'),
  config: jsonb('config').default({}),
  /** Hex-encoded PBKDF2 salt for per-firm AES-256-GCM key derivation */
  encryptionSalt: varchar('encryption_salt', { length: 64 }),
  /** Shareable code for employees to join this firm from the extension */
  enrollmentCode: varchar('enrollment_code', { length: 50 }).unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Users ---
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: varchar('clerk_id', { length: 255 }).unique(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  email: varchar('email', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('user'),
  emailVerified: boolean('email_verified').default(false),
  departmentId: uuid('department_id'), // nullable FK enforced via auto-migration SQL
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('users_firm_id_idx').on(table.firmId),
  index('users_clerk_id_idx').on(table.clerkId),
  index('users_email_idx').on(table.email),
]);

// --- Departments ---
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  parentId: uuid('parent_id'), // self-referential for nested departments
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('departments_firm_id_idx').on(table.firmId),
  unique('departments_firm_name_uniq').on(table.firmId, table.name),
]);

// --- Department Policies ---
export const departmentPolicies = pgTable('department_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  policyType: varchar('policy_type', { length: 50 }).notNull(),
  policyValue: jsonb('policy_value').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('dept_policies_dept_id_idx').on(table.departmentId),
  index('dept_policies_firm_id_idx').on(table.firmId),
  unique('dept_policies_dept_type_uniq').on(table.departmentId, table.policyType),
]);

// --- Events (Core audit log — append-only) ---
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  aiToolId: varchar('ai_tool_id', { length: 50 }).notNull(),
  aiToolUrl: text('ai_tool_url'),
  promptHash: varchar('prompt_hash', { length: 64 }).notNull(), // SHA-256
  promptLength: integer('prompt_length').notNull(),
  sensitivityScore: real('sensitivity_score').notNull(),
  sensitivityLevel: sensitivityLevelEnum('sensitivity_level').notNull(),
  entities: jsonb('entities').default([]),
  action: eventActionEnum('action').notNull(),
  overrideReason: text('override_reason'),
  captureMethod: varchar('capture_method', { length: 20 }).notNull(),
  sessionId: uuid('session_id'),
  metadata: jsonb('metadata').default({}),
  // ★ MOAT: Cryptographic Audit Trail
  eventHash: varchar('event_hash', { length: 64 }),
  previousHash: varchar('previous_hash', { length: 64 }),
  chainPosition: bigint('chain_position', { mode: 'number' }),
  // ★ MOAT: Server-Side HMAC Signature (tamper-proof, compliance-ready)
  serverSignature: varchar('server_signature', { length: 64 }),
  signedAt: timestamp('signed_at'),
  signatureVersion: integer('signature_version').default(1),
  /** Tracks which encryption key version was used; enables async re-encryption on key rotation */
  encryptionKeyVersion: integer('encryption_key_version').default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('events_firm_id_idx').on(table.firmId),
  index('events_user_id_idx').on(table.userId),
  index('events_created_at_idx').on(table.createdAt),
  index('events_sensitivity_level_idx').on(table.sensitivityLevel),
  index('events_ai_tool_id_idx').on(table.aiToolId),
  index('events_firm_created_idx').on(table.firmId, table.createdAt),
  index('events_firm_chain_idx').on(table.firmId, table.chainPosition),
  index('events_action_idx').on(table.action),
  index('events_firm_action_idx').on(table.firmId, table.action),
  index('events_prompt_hash_idx').on(table.promptHash),
  unique('events_firm_chain_position_uniq').on(table.firmId, table.chainPosition),
]);

// --- Feedback ---
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').references(() => events.id),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityHash: varchar('entity_hash', { length: 64 }).notNull(),
  isCorrect: boolean('is_correct').notNull(),
  correctedType: varchar('corrected_type', { length: 50 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('feedback_firm_id_idx').on(table.firmId),
  index('feedback_event_id_idx').on(table.eventId),
]);

// --- Pseudonym Maps (Phase 2) ---
// Data in originalHash, pseudonym, entityType is now AES-256-GCM encrypted
// at the application layer via @iron-gate/crypto. The encryptedData column
// stores the encrypted JSON bundle. Legacy plaintext columns kept nullable
// for migration compatibility.
export const pseudonymMaps = pgTable('pseudonym_maps', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  sessionId: uuid('session_id').notNull(),
  originalHash: varchar('original_hash', { length: 64 }),
  pseudonym: varchar('pseudonym', { length: 255 }),
  entityType: varchar('entity_type', { length: 50 }),
  /** AES-256-GCM encrypted JSON of {originalHash, pseudonym, entityType} */
  encryptedData: text('encrypted_data'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('pseudonym_maps_session_idx').on(table.sessionId),
  index('pseudonym_maps_expires_idx').on(table.expiresAt),
]);

// --- Firm Knowledge Graph ---
export const clientMatters = pgTable('client_matters', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  aliases: jsonb('aliases').default([]),
  matterNumber: varchar('matter_number', { length: 100 }),
  matterDescription: text('matter_description'),
  parties: jsonb('parties').default([]),
  sensitivityLevel: sensitivityLevelEnum('sensitivity_level').default('medium'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('client_matters_firm_id_idx').on(table.firmId),
  index('client_matters_client_name_idx').on(table.clientName),
]);

// --- Weight Overrides (Data Flywheel) ---
export const weightOverrides = pgTable('weight_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  weightMultiplier: real('weight_multiplier').notNull().default(1.0),
  sampleCount: integer('sample_count').notNull().default(0),
  falsePositiveRate: real('false_positive_rate'),
  lastUpdated: timestamp('last_updated').notNull().defaultNow(),
}, (table) => [
  index('weight_overrides_firm_id_idx').on(table.firmId),
  unique('weight_overrides_firm_entity_uniq').on(table.firmId, table.entityType),
]);

// ============================================================================
// ★ MOAT Tables — Sensitivity Graph, Inference Engine, Plugins, Webhooks
// ============================================================================

// --- Entity Co-occurrences (Sensitivity Graph) ---
export const entityCoOccurrences = pgTable('entity_co_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  entityAHash: varchar('entity_a_hash', { length: 64 }).notNull(),
  entityAType: varchar('entity_a_type', { length: 50 }).notNull(),
  entityBHash: varchar('entity_b_hash', { length: 64 }).notNull(),
  entityBType: varchar('entity_b_type', { length: 50 }).notNull(),
  coOccurrenceCount: integer('co_occurrence_count').notNull().default(1),
  avgContextScore: real('avg_context_score').notNull().default(0),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
}, (table) => [
  unique('entity_co_occ_firm_pair').on(table.firmId, table.entityAHash, table.entityBHash),
  index('entity_co_occ_firm_a_idx').on(table.firmId, table.entityAHash),
  index('entity_co_occ_firm_count_idx').on(table.firmId, table.coOccurrenceCount),
]);

// --- Inferred Entities (Inference Engine) ---
export const inferredEntities = pgTable('inferred_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  textHash: varchar('text_hash', { length: 64 }).notNull(),
  inferredType: varchar('inferred_type', { length: 50 }).notNull(),
  confidence: real('confidence').notNull(),
  evidenceCount: integer('evidence_count').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  confirmedBy: uuid('confirmed_by'),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  promotedAt: timestamp('promoted_at'),
}, (table) => [
  unique('inferred_firm_text').on(table.firmId, table.textHash),
  index('inferred_firm_status_idx').on(table.firmId, table.status),
]);

// --- Sensitivity Patterns ---
export const sensitivityPatterns = pgTable('sensitivity_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  patternHash: varchar('pattern_hash', { length: 64 }).notNull(),
  entityTypes: jsonb('entity_types').notNull(),
  triggerCount: integer('trigger_count').notNull().default(1),
  avgScore: real('avg_score').notNull(),
  isGlobal: boolean('is_global').notNull().default(false),
  discoveredAt: timestamp('discovered_at').notNull().defaultNow(),
}, (table) => [
  unique('sensitivity_firm_pattern').on(table.firmId, table.patternHash),
  index('sensitivity_firm_idx').on(table.firmId),
]);

// --- Firm Plugins (Plugin SDK) ---
export const firmPlugins = pgTable('firm_plugins', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  version: varchar('version', { length: 50 }).notNull().default('1.0.0'),
  code: text('code').notNull(),
  entityTypes: jsonb('entity_types').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  hitCount: integer('hit_count').notNull().default(0),
  falsePositiveRate: real('false_positive_rate').default(0),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('firm_plugins_firm_idx').on(table.firmId),
]);

// --- Webhook Subscriptions ---
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  url: text('url').notNull(),
  eventTypes: jsonb('event_types').notNull(),
  secret: text('secret').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('webhook_subs_firm_idx').on(table.firmId),
]);

// --- Invites ---
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('user'),
  token: varchar('token', { length: 255 }).unique().notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  acceptedAt: timestamp('accepted_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('invites_firm_idx').on(table.firmId),
  index('invites_token_idx').on(table.token),
]);

// ============================================================================
// Kill Switch
// ============================================================================

export const killSwitchScopeEnum = pgEnum('kill_switch_scope', ['global', 'firm']);

export const killSwitch = pgTable('kill_switch', {
  id: uuid('id').primaryKey().defaultRandom(),
  enabled: boolean('enabled').notNull().default(false),
  scope: killSwitchScopeEnum('scope').notNull(),
  firmId: uuid('firm_id').references(() => firms.id),
  activatedAt: timestamp('activated_at').notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at'),
  reason: text('reason'),
  activatedBy: varchar('activated_by', { length: 255 }),
}, (table) => [
  unique('kill_switch_scope_firm_uniq').on(table.scope, table.firmId),
  index('kill_switch_firm_idx').on(table.firmId),
]);

// ============================================================================
// Extension Heartbeats
// ============================================================================

export const extensionHeartbeats = pgTable('extension_heartbeats', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id).unique(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  extensionVersion: varchar('extension_version', { length: 20 }).notNull(),
  activePlatform: varchar('active_platform', { length: 100 }),
  mode: varchar('mode', { length: 20 }),
  queueDepth: integer('queue_depth'),
  mainWorldLoaded: boolean('main_world_loaded'),
  apiReachable: boolean('api_reachable'),
  queueDraining: boolean('queue_draining'),
  errorsLast5Min: integer('errors_last_5_min'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
}, (table) => [
  index('heartbeats_firm_idx').on(table.firmId),
  index('heartbeats_received_idx').on(table.receivedAt),
]);

// ============================================================================
// Stripe Billing Tables
// ============================================================================

export const subscriptionTierEnum = pgEnum('subscription_tier', ['free', 'pro', 'business', 'enterprise']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'past_due', 'canceled', 'trialing']);

// --- Subscriptions ---
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),
  tier: subscriptionTierEnum('tier').notNull().default('free'),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('subscriptions_firm_id_idx').on(table.firmId),
  index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
  index('subscriptions_stripe_sub_idx').on(table.stripeSubscriptionId),
]);

// --- Invoices ---
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  stripeInvoiceId: varchar('stripe_invoice_id', { length: 255 }).notNull().unique(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('usd'),
  status: varchar('status', { length: 50 }).notNull(),
  paidAt: timestamp('paid_at'),
  invoiceUrl: text('invoice_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('invoices_firm_id_idx').on(table.firmId),
  index('invoices_stripe_invoice_idx').on(table.stripeInvoiceId),
]);

// ============================================================================
// Alert System Tables
// ============================================================================

export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'critical']);

// --- Alerts ---
export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  alertType: varchar('alert_type', { length: 100 }).notNull(),
  severity: alertSeverityEnum('severity').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  metadata: jsonb('metadata').default({}),
  acknowledgedAt: timestamp('acknowledged_at'),
  acknowledgedBy: uuid('acknowledged_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('alerts_firm_id_idx').on(table.firmId),
  index('alerts_firm_created_idx').on(table.firmId, table.createdAt),
  index('alerts_severity_idx').on(table.severity),
]);

// --- Audit Log (admin actions) ---
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  actorId: uuid('actor_id').references(() => users.id),
  actorEmail: varchar('actor_email', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('audit_log_firm_idx').on(table.firmId),
  index('audit_log_firm_created_idx').on(table.firmId, table.createdAt),
  index('audit_log_action_idx').on(table.action),
]);

// --- Security Incidents ---
export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  title: text('title').notNull(),
  description: text('description'),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  reportedBy: uuid('reported_by').references(() => users.id),
  assignedTo: uuid('assigned_to').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  rootCause: text('root_cause'),
  remediation: text('remediation'),
  affectedUsers: integer('affected_users'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('incidents_firm_id_idx').on(table.firmId),
  index('incidents_firm_created_idx').on(table.firmId, table.createdAt),
]);

// --- Feature Flags ---
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  key: varchar('key', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('feature_flags_firm_key_uniq').on(table.firmId, table.key),
  index('feature_flags_firm_idx').on(table.firmId),
]);

// --- Email Verification Tokens ---
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  email: varchar('email', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('email_verify_user_idx').on(table.userId),
  index('email_verify_token_idx').on(table.tokenHash),
]);

// --- Data Deletion Requests (GDPR Article 17) ---
export const dataDeletionRequests = pgTable('data_deletion_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  reason: text('reason'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  executedAt: timestamp('executed_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('data_deletion_firm_idx').on(table.firmId),
]);

// --- ToS Acceptance Tracking ---
export const tosAcceptance = pgTable('tos_acceptance', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  acceptedBy: uuid('accepted_by').notNull().references(() => users.id),
  tosVersion: varchar('tos_version', { length: 20 }).notNull(),
  acceptedAt: timestamp('accepted_at').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
}, (table) => [
  index('tos_acceptance_firm_idx').on(table.firmId),
]);

// --- DPA Acceptance Tracking ---
export const dpaAcceptance = pgTable('dpa_acceptance', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  acceptedBy: uuid('accepted_by').notNull().references(() => users.id),
  signerName: varchar('signer_name', { length: 255 }).notNull(),
  signerTitle: varchar('signer_title', { length: 255 }),
  signerEmail: varchar('signer_email', { length: 255 }).notNull(),
  dpaVersion: varchar('dpa_version', { length: 20 }).notNull(),
  acceptedAt: timestamp('accepted_at').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
}, (table) => [
  index('dpa_acceptance_firm_idx').on(table.firmId),
]);

// --- Webhook Delivery Log ---
export const webhookDeliveryLog = pgTable('webhook_delivery_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => webhookSubscriptions.id),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').default({}),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  attempt: integer('attempt').notNull().default(1),
  success: boolean('success').notNull().default(false),
  error: text('error'),
  deliveredAt: timestamp('delivered_at').notNull().defaultNow(),
}, (table) => [
  index('webhook_delivery_webhook_idx').on(table.webhookId),
  index('webhook_delivery_firm_idx').on(table.firmId),
  index('webhook_delivery_time_idx').on(table.deliveredAt),
]);

// --- API Keys ---
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).unique().notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull().default('read'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('api_keys_firm_idx').on(table.firmId),
  index('api_keys_hash_idx').on(table.keyHash),
]);

// --- Entity Dictionaries (admin-configured per-firm entity lists for Tier 3 detection) ---
export const entityDictionaries = pgTable('entity_dictionaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  category: varchar('category', { length: 50 }).notNull(), // 'person' | 'organization' | 'project' | 'client' | 'location' | 'custom'
  name: varchar('name', { length: 500 }).notNull(),
  aliases: jsonb('aliases').default([]),
  metadata: jsonb('metadata').default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('entity_dict_firm_idx').on(table.firmId),
  index('entity_dict_category_idx').on(table.firmId, table.category),
  unique('entity_dict_firm_cat_name_uniq').on(table.firmId, table.category, table.name),
]);

// --- Breach Log (SOC 2 / HIPAA breach notification tracking) ---
export const breachLog = pgTable('breach_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id),
  triggerType: varchar('trigger_type', { length: 50 }).notNull(), // 'kill_switch' | 'auto_threshold' | 'manual'
  severity: varchar('severity', { length: 20 }).notNull().default('high'),
  description: text('description').notNull(),
  affectedRecords: integer('affected_records'),
  notifiedAt: timestamp('notified_at'),
  notifiedEmails: jsonb('notified_emails').default([]),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('breach_log_firm_idx').on(table.firmId),
  index('breach_log_firm_created_idx').on(table.firmId, table.createdAt),
]);
