CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."event_action" AS ENUM('pass', 'warn', 'block', 'proxy', 'override');--> statement-breakpoint
CREATE TYPE "public"."firm_mode" AS ENUM('audit', 'proxy');--> statement-breakpoint
CREATE TYPE "public"."kill_switch_scope" AS ENUM('global', 'firm');--> statement-breakpoint
CREATE TYPE "public"."sensitivity_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'trialing');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free', 'pro', 'business', 'enterprise');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"alert_type" varchar(100) NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"acknowledged_at" timestamp,
	"acknowledged_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"scope" varchar(20) DEFAULT 'read' NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breach_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"trigger_type" varchar(50) NOT NULL,
	"severity" varchar(20) DEFAULT 'high' NOT NULL,
	"description" text NOT NULL,
	"affected_records" integer,
	"notified_at" timestamp,
	"notified_emails" jsonb DEFAULT '[]'::jsonb,
	"resolved_at" timestamp,
	"resolved_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_matters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"matter_number" varchar(100),
	"matter_description" text,
	"parties" jsonb DEFAULT '[]'::jsonb,
	"sensitivity_level" "sensitivity_level" DEFAULT 'medium',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"firm_id" uuid NOT NULL,
	"user_id" uuid,
	"entity_types_seen" jsonb DEFAULT '[]'::jsonb,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"cumulative_score" real DEFAULT 0 NOT NULL,
	"peak_score" real DEFAULT 0 NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"last_intent" text,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conv_state_session_firm" UNIQUE("session_id","firm_id")
);
--> statement-breakpoint
CREATE TABLE "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reason" text,
	"scheduled_at" timestamp NOT NULL,
	"executed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"policy_type" varchar(50) NOT NULL,
	"policy_value" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dept_policies_dept_type_uniq" UNIQUE("department_id","policy_type")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_firm_name_uniq" UNIQUE("firm_id","name")
);
--> statement-breakpoint
CREATE TABLE "dpa_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"accepted_by" uuid NOT NULL,
	"signer_name" varchar(255) NOT NULL,
	"signer_title" varchar(255),
	"signer_email" varchar(255) NOT NULL,
	"dpa_version" varchar(20) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"label" varchar(100),
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "entity_co_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"entity_a_hash" varchar(64) NOT NULL,
	"entity_a_type" varchar(50) NOT NULL,
	"entity_b_hash" varchar(64) NOT NULL,
	"entity_b_type" varchar(50) NOT NULL,
	"co_occurrence_count" integer DEFAULT 1 NOT NULL,
	"avg_context_score" real DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_co_occ_firm_pair" UNIQUE("firm_id","entity_a_hash","entity_b_hash")
);
--> statement-breakpoint
CREATE TABLE "entity_dictionaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"category" varchar(50) NOT NULL,
	"name" varchar(500) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_dict_firm_cat_name_uniq" UNIQUE("firm_id","category","name")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_tool_id" varchar(50) NOT NULL,
	"ai_tool_url" text,
	"prompt_hash" varchar(64) NOT NULL,
	"prompt_length" integer NOT NULL,
	"sensitivity_score" real NOT NULL,
	"sensitivity_level" "sensitivity_level" NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb,
	"action" "event_action" NOT NULL,
	"override_reason" text,
	"capture_method" varchar(20) NOT NULL,
	"session_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"event_hash" varchar(64),
	"previous_hash" varchar(64),
	"chain_position" bigint,
	"server_signature" varchar(64),
	"signed_at" timestamp,
	"signature_version" integer DEFAULT 1,
	"encryption_key_version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "events_firm_chain_position_uniq" UNIQUE("firm_id","chain_position")
);
--> statement-breakpoint
CREATE TABLE "extension_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"extension_version" varchar(20) NOT NULL,
	"active_platform" varchar(100),
	"mode" varchar(20),
	"queue_depth" integer,
	"main_world_loaded" boolean,
	"api_reachable" boolean,
	"queue_draining" boolean,
	"errors_last_5_min" integer,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "extension_heartbeats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_firm_key_uniq" UNIQUE("firm_id","key")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_hash" varchar(64) NOT NULL,
	"is_correct" boolean NOT NULL,
	"corrected_type" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"code" text NOT NULL,
	"entity_types" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"false_positive_rate" real DEFAULT 0,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(255),
	"mode" "firm_mode" DEFAULT 'proxy' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"encryption_salt" varchar(64),
	"enrollment_code" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firms_enrollment_code_unique" UNIQUE("enrollment_code")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"reported_by" uuid,
	"assigned_to" uuid,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"root_cause" text,
	"remediation" text,
	"affected_users" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inferred_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"text_hash" varchar(64) NOT NULL,
	"inferred_type" varchar(50) NOT NULL,
	"confidence" real NOT NULL,
	"evidence_count" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"confirmed_by" uuid,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"promoted_at" timestamp,
	CONSTRAINT "inferred_firm_text" UNIQUE("firm_id","text_hash")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"token" varchar(255) NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"stripe_invoice_id" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"status" varchar(50) NOT NULL,
	"paid_at" timestamp,
	"invoice_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "kill_switch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"scope" "kill_switch_scope" NOT NULL,
	"firm_id" uuid,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp,
	"reason" text,
	"activated_by" varchar(255),
	CONSTRAINT "kill_switch_scope_firm_uniq" UNIQUE("scope","firm_id")
);
--> statement-breakpoint
CREATE TABLE "pseudonym_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"original_hash" varchar(64),
	"pseudonym" varchar(255),
	"entity_type" varchar(50),
	"encrypted_data" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensitivity_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"pattern_hash" varchar(64) NOT NULL,
	"entity_types" jsonb NOT NULL,
	"trigger_count" integer DEFAULT 1 NOT NULL,
	"avg_score" real NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sensitivity_firm_pattern" UNIQUE("firm_id","pattern_hash")
);
--> statement-breakpoint
CREATE TABLE "siem_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"event_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"format" varchar(20) NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" integer,
	"success" boolean DEFAULT false NOT NULL,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"payload_size" integer,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"stripe_customer_id" varchar(255) NOT NULL,
	"stripe_subscription_id" varchar(255),
	"stripe_price_id" varchar(255),
	"tier" "subscription_tier" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tos_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"accepted_by" uuid NOT NULL,
	"tos_version" varchar(20) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" varchar(255),
	"firm_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"email_verified" boolean DEFAULT false,
	"department_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status_code" integer,
	"response_body" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"error" text,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb NOT NULL,
	"secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"weight_multiplier" real DEFAULT 1 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"false_positive_rate" real,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weight_overrides_firm_entity_uniq" UNIQUE("firm_id","entity_type")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_log" ADD CONSTRAINT "breach_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_log" ADD CONSTRAINT "breach_log_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_matters" ADD CONSTRAINT "client_matters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_policies" ADD CONSTRAINT "department_policies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_policies" ADD CONSTRAINT "department_policies_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_policies" ADD CONSTRAINT "department_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpa_acceptance" ADD CONSTRAINT "dpa_acceptance_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpa_acceptance" ADD CONSTRAINT "dpa_acceptance_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_co_occurrences" ADD CONSTRAINT "entity_co_occurrences_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_dictionaries" ADD CONSTRAINT "entity_dictionaries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_dictionaries" ADD CONSTRAINT "entity_dictionaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_heartbeats" ADD CONSTRAINT "extension_heartbeats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_heartbeats" ADD CONSTRAINT "extension_heartbeats_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_plugins" ADD CONSTRAINT "firm_plugins_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inferred_entities" ADD CONSTRAINT "inferred_entities_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_switch" ADD CONSTRAINT "kill_switch_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pseudonym_maps" ADD CONSTRAINT "pseudonym_maps_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitivity_patterns" ADD CONSTRAINT "sensitivity_patterns_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_delivery_log" ADD CONSTRAINT "siem_delivery_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_acceptance" ADD CONSTRAINT "tos_acceptance_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_acceptance" ADD CONSTRAINT "tos_acceptance_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_log" ADD CONSTRAINT "webhook_delivery_log_webhook_id_webhook_subscriptions_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_log" ADD CONSTRAINT "webhook_delivery_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_overrides" ADD CONSTRAINT "weight_overrides_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_firm_id_idx" ON "alerts" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "alerts_firm_created_idx" ON "alerts" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "api_keys_firm_idx" ON "api_keys" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "audit_log_firm_idx" ON "audit_log" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "audit_log_firm_created_idx" ON "audit_log" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "breach_log_firm_idx" ON "breach_log" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "breach_log_firm_created_idx" ON "breach_log" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "client_matters_firm_id_idx" ON "client_matters" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "client_matters_client_name_idx" ON "client_matters" USING btree ("client_name");--> statement-breakpoint
CREATE INDEX "conv_state_session_idx" ON "conversation_state" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "conv_state_firm_idx" ON "conversation_state" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "data_deletion_firm_idx" ON "data_deletion_requests" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "dept_policies_dept_id_idx" ON "department_policies" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "dept_policies_firm_id_idx" ON "department_policies" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "departments_firm_id_idx" ON "departments" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "dpa_acceptance_firm_idx" ON "dpa_acceptance" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "email_verify_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verify_token_idx" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "enrollment_codes_firm_idx" ON "enrollment_codes" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "enrollment_codes_code_idx" ON "enrollment_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "entity_co_occ_firm_a_idx" ON "entity_co_occurrences" USING btree ("firm_id","entity_a_hash");--> statement-breakpoint
CREATE INDEX "entity_co_occ_firm_count_idx" ON "entity_co_occurrences" USING btree ("firm_id","co_occurrence_count");--> statement-breakpoint
CREATE INDEX "entity_dict_firm_idx" ON "entity_dictionaries" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "entity_dict_category_idx" ON "entity_dictionaries" USING btree ("firm_id","category");--> statement-breakpoint
CREATE INDEX "events_firm_id_idx" ON "events" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "events_user_id_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_sensitivity_level_idx" ON "events" USING btree ("sensitivity_level");--> statement-breakpoint
CREATE INDEX "events_ai_tool_id_idx" ON "events" USING btree ("ai_tool_id");--> statement-breakpoint
CREATE INDEX "events_firm_created_idx" ON "events" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "events_firm_chain_idx" ON "events" USING btree ("firm_id","chain_position");--> statement-breakpoint
CREATE INDEX "events_action_idx" ON "events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "events_firm_action_idx" ON "events" USING btree ("firm_id","action");--> statement-breakpoint
CREATE INDEX "events_prompt_hash_idx" ON "events" USING btree ("prompt_hash");--> statement-breakpoint
CREATE INDEX "heartbeats_firm_idx" ON "extension_heartbeats" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "heartbeats_received_idx" ON "extension_heartbeats" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "feature_flags_firm_idx" ON "feature_flags" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "feedback_firm_id_idx" ON "feedback" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "feedback_event_id_idx" ON "feedback" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "firm_plugins_firm_idx" ON "firm_plugins" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "incidents_firm_id_idx" ON "incidents" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "incidents_firm_created_idx" ON "incidents" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "inferred_firm_status_idx" ON "inferred_entities" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "invites_firm_idx" ON "invites" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invoices_firm_id_idx" ON "invoices" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "invoices_stripe_invoice_idx" ON "invoices" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "kill_switch_firm_idx" ON "kill_switch" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "pseudonym_maps_session_idx" ON "pseudonym_maps" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "pseudonym_maps_expires_idx" ON "pseudonym_maps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sensitivity_firm_idx" ON "sensitivity_patterns" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "siem_delivery_firm_idx" ON "siem_delivery_log" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "siem_delivery_time_idx" ON "siem_delivery_log" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "subscriptions_firm_id_idx" ON "subscriptions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_sub_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "tos_acceptance_firm_idx" ON "tos_acceptance" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "users_firm_id_idx" ON "users" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "users_clerk_id_idx" ON "users" USING btree ("clerk_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_idx" ON "webhook_delivery_log" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_firm_idx" ON "webhook_delivery_log" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_time_idx" ON "webhook_delivery_log" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "webhook_subs_firm_idx" ON "webhook_subscriptions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "weight_overrides_firm_id_idx" ON "weight_overrides" USING btree ("firm_id");