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
  mode: firmModeEnum('mode').notNull().default('audit'),
  config: jsonb('config').default({}),
  /** Hex-encoded PBKDF2 salt for per-firm AES-256-GCM key derivation */
  encryptionSalt: varchar('encryption_salt', { length: 64 }),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('users_firm_id_idx').on(table.firmId),
  index('users_clerk_id_idx').on(table.clerkId),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('events_firm_id_idx').on(table.firmId),
  index('events_user_id_idx').on(table.userId),
  index('events_created_at_idx').on(table.createdAt),
  index('events_sensitivity_level_idx').on(table.sensitivityLevel),
  index('events_ai_tool_id_idx').on(table.aiToolId),
  index('events_firm_created_idx').on(table.firmId, table.createdAt),
  index('events_firm_chain_idx').on(table.firmId, table.chainPosition),
]);

// --- Feedback ---
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id),
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
