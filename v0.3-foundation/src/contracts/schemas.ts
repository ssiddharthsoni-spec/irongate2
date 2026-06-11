// ============================================================================
// @contracts/schemas — Zod validation for every boundary crossing.
//
// Every message into the service worker, every storage write, every LLM
// response is validated against these schemas. Malformed data is logged
// and rejected, never silently swallowed.
// ============================================================================

import { z } from 'zod';
import { ENTITY_TYPES, VERDICTS, LEVELS, DETECTOR_SOURCES, JUDGMENT_SOURCES, AI_TOOLS } from './entities';

// ── Primitives ──────────────────────────────────────────────────────────────

export const EntityTypeZ = z.enum(ENTITY_TYPES);
export const VerdictZ = z.enum(VERDICTS);
export const LevelZ = z.enum(LEVELS);
export const DetectorSourceZ = z.enum(DETECTOR_SOURCES);
export const JudgmentSourceZ = z.enum(JUDGMENT_SOURCES);
export const AIToolIdZ = z.enum(AI_TOOLS);

// ── Detection (single entity) ───────────────────────────────────────────────

export const DetectionZ = z.object({
  type: z.string(), // Relaxed to string so unknown types don't crash
  text: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
});

export type Detection = z.infer<typeof DetectionZ>;

// ── Evidence (Stage 1 output) ───────────────────────────────────────────────

export const BrightLineFlagZ = z.object({
  type: z.string(),
  entityIndex: z.number().int().nonnegative(),
  reason: z.string(),
});

export const ContextualSignalZ = z.object({
  category: z.string(),
  weight: z.number(),
  confidence: z.number().min(0).max(1),
  matchedText: z.string().optional(),
});

export const EvidenceZ = z.object({
  entities: z.array(DetectionZ),
  brightLineFlags: z.array(BrightLineFlagZ),
  contextualSignals: z.array(ContextualSignalZ),
  patternScore: z.number().min(0).max(100),
  patternLevel: LevelZ,
  stage1LatencyMs: z.number().nonnegative(),
});

export type Evidence = z.infer<typeof EvidenceZ>;

// ── Judgment Entity (LLM-assessed) ──────────────────────────────────────────

export const JudgmentEntityZ = z.object({
  type: z.string(),
  text: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  confidence: z.number().min(0).max(1),
  isSensitive: z.boolean(),
  contextNote: z.string().optional(),
});

export type JudgmentEntity = z.infer<typeof JudgmentEntityZ>;

// ── Pseudonym Entry ─────────────────────────────────────────────────────────

export const PseudonymEntryZ = z.object({
  span: z.tuple([z.number().int(), z.number().int()]),
  original: z.string(),
  pseudonym: z.string(),
  type: z.string(),
});

export type PseudonymEntry = z.infer<typeof PseudonymEntryZ>;

// ── Judgment (Stage 2 output — the SSOT) ────────────────────────────────────

export const JudgmentLatencyZ = z.object({
  stage1Ms: z.number().nonnegative(),
  stage2Ms: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
});

export const ModelIdentityZ = z.object({
  tag: z.string(),
  digest: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
});

export const JudgmentZ = z.object({
  verdict: VerdictZ,
  score: z.number().int().min(0).max(100),
  level: LevelZ,
  reasoning: z.string(),
  entities: z.array(JudgmentEntityZ),
  pseudonymMap: z.array(PseudonymEntryZ),
  source: JudgmentSourceZ,
  latency: JudgmentLatencyZ,
  model: ModelIdentityZ,
  brightLineOverride: z.boolean(),
  complianceFrameworks: z.array(z.string()),
  aiToolId: z.string(),
  timestamp: z.string().datetime(),
});

export type Judgment = z.infer<typeof JudgmentZ>;

// ── DetectionResult (the single SSOT envelope) ─────────────────────────────
// This is what crosses every boundary: SW → sidepanel, SW → storage,
// SW → audit trail. One shape, one writer, one subscriber.

export const DetectionResultZ = z.object({
  /** Unique ID for this detection pass */
  id: z.string().uuid(),
  /** The judgment that drives all downstream behavior */
  judgment: JudgmentZ,
  /** Raw evidence from Stage 1 (for debugging / eval) */
  evidence: EvidenceZ,
  /** Tab that produced this result */
  tabId: z.number().int().nullable(),
  /** Whether the prompt was actually pseudonymized (vs. audit-only) */
  wasIntercepted: z.boolean(),
  /** Monotonic counter for ordering */
  seq: z.number().int().nonnegative(),
});

export type DetectionResult = z.infer<typeof DetectionResultZ>;

// ── Message Envelope (discriminated union, ~12 types) ───────────────────────

export const MessageZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PROMPT_ANALYZE'), payload: z.object({ text: z.string().min(1), aiToolId: z.string(), tabId: z.number().int() }) }),
  z.object({ type: z.literal('PROMPT_VERDICT'), payload: DetectionResultZ }),
  z.object({ type: z.literal('FILE_ANALYZE'), payload: z.object({ fileName: z.string(), fileSize: z.number(), fileType: z.string(), fileBase64: z.string(), aiToolId: z.string() }) }),
  z.object({ type: z.literal('FILE_VERDICT'), payload: DetectionResultZ }),
  z.object({ type: z.literal('CONFIG_READ'), payload: z.object({ keys: z.array(z.string()) }) }),
  z.object({ type: z.literal('CONFIG_WRITE'), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('ACTIVITY_APPEND'), payload: z.object({ result: DetectionResultZ }) }),
  z.object({ type: z.literal('STATE_SUBSCRIBE'), payload: z.object({ keys: z.array(z.string()) }) }),
  z.object({ type: z.literal('STATE_SNAPSHOT'), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('HEALTH_PING'), payload: z.object({}) }),
  z.object({ type: z.literal('TELEMETRY_EMIT'), payload: z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }) }),
  z.object({ type: z.literal('WARMUP_TICK'), payload: z.object({ ollamaReachable: z.boolean(), modelLoaded: z.boolean(), latencyMs: z.number() }) }),
]);

export type Message = z.infer<typeof MessageZ>;
export type MessageType = Message['type'];

// ── Eval Fixture ────────────────────────────────────────────────────────────

export const EvalFixtureZ = z.object({
  id: z.string(),
  prompt: z.string(),
  expectedVerdict: VerdictZ,
  expectedEntities: z.array(z.object({
    type: z.string(),
    text: z.string(),
    isSensitive: z.boolean(),
  })),
  expectedScore: z.object({
    min: z.number().int().min(0).max(100),
    max: z.number().int().min(0).max(100),
  }),
  tags: z.array(z.string()),
  notes: z.string().optional(),
});

export type EvalFixture = z.infer<typeof EvalFixtureZ>;

export const EvalResultZ = z.object({
  fixtureId: z.string(),
  pass: z.boolean(),
  actualVerdict: VerdictZ.nullable(),
  actualScore: z.number().int().nullable(),
  actualEntities: z.array(DetectionZ),
  latencyMs: z.number(),
  errors: z.array(z.string()),
});

export type EvalResult = z.infer<typeof EvalResultZ>;
