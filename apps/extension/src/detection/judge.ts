// ============================================================================
// Iron Gate — Stage 2: Gemma 4 Judgment Engine
// ============================================================================
//
// Takes Stage 1 Evidence + raw prompt text and calls Gemma 4 via Ollama
// function-calling to produce a typed Judgment.
//
// Design decisions:
//   - Bright-line flags bypass the LLM entirely (SSN, CC, credentials)
//   - The LLM is asked to ASSESS entities, not DETECT them (regex already did that)
//   - Function-calling schema enforces structured JSON output
//   - Timeout + fallback: if Ollama is unreachable, Stage 1 Evidence becomes the verdict
//   - All errors are logged, never swallowed
//
// This module has NO side effects. It is a pure async function.
// ============================================================================

// Types are defined inline to avoid cross-package import issues.
// The canonical definitions live in packages/types/src/judgment.ts.
// When @irongate/contracts is published as a proper workspace dep,
// switch to: import { Evidence, Judgment, ... } from '@iron-gate/types';

type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';
type AIToolId = string;
type JudgmentVerdict = 'allow' | 'nudge' | 'mask' | 'block';
type JudgmentSource = 'gemma4' | 'bright-line' | 'pattern-only' | 'merged';

interface BrightLineFlag {
  type: string;
  entityIndex: number;
  reason: string;
}

interface ContextualSignal {
  category: string;
  weight: number;
  confidence: number;
}

export interface Evidence {
  entities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>;
  brightLineFlags: BrightLineFlag[];
  contextualSignals: ContextualSignal[];
  patternScore: number;
  patternLevel: SensitivityLevel;
  stage1LatencyMs: number;
}

export interface JudgmentEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  isSensitive: boolean;
  contextNote?: string;
}

export interface Judgment {
  verdict: JudgmentVerdict;
  score: number;
  level: SensitivityLevel;
  reasoning: string;
  entities: JudgmentEntity[];
  pseudonymMap: Array<{ span: [number, number]; original: string; pseudonym: string; type: string }>;
  source: JudgmentSource;
  latency: { stage1Ms: number; stage2Ms: number; totalMs: number };
  model: { tag: string; digest?: string };
  brightLineOverride: boolean;
  complianceFrameworks: string[];
  aiToolId: string;
  timestamp: string;
}

// ── Configuration ───────────────────────────────────────────────────────────

export interface JudgeConfig {
  endpoint: string;         // e.g., "http://localhost:11434"
  model: string;            // e.g., "gemma3:4b"
  timeoutMs: number;        // max wait for Ollama response
  firmContext?: string;     // firm-specific context injected into system prompt
  apiKey?: string;          // optional Bearer token for reverse proxy
}

const DEFAULT_CONFIG: JudgeConfig = {
  endpoint: 'http://localhost:11434',
  model: 'gemma3:4b',
  timeoutMs: 8000,
};

// ── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(firmContext?: string): string {
  const base = `You are a data governance judge. Output ONLY a JSON object with these fields:
- verdict: MUST be one of: allow, nudge, mask, block
- score: integer 0-100
- reasoning: one short sentence

RULES:
1. Real names + identifiers (SSN, employee ID, MRN, DOB) = mask or block, score 61-100
2. Credit cards, CVVs, API keys, credentials = block, score 86-100
3. Public figures being discussed = allow, score 0-25
4. Code with placeholders = allow, score 0-25
5. User's own data (resume, bio) = nudge, score 26-60
6. Fiction/creative writing = allow, score 0-25`;

  if (firmContext) {
    return base + `\n\nFIRM CONTEXT:\n${firmContext}`;
  }
  return base;
}

// ── Function-calling schema for Ollama ──────────────────────────────────────

const JUDGMENT_FUNCTION_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'submitJudgment',
    description: 'Submit a sensitivity judgment for the user prompt',
    parameters: {
      type: 'object',
      required: ['verdict', 'score', 'reasoning', 'entities'],
      properties: {
        verdict: { type: 'string', enum: ['allow', 'nudge', 'mask', 'block'] },
        score: { type: 'number', description: 'Sensitivity score 0-100' },
        reasoning: { type: 'string', description: 'One-sentence explanation' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'text', 'isSensitive'],
            properties: {
              type: { type: 'string' },
              text: { type: 'string' },
              isSensitive: { type: 'boolean' },
              contextNote: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

// ── Core Judge Function ─────────────────────────────────────────────────────

/**
 * Stage 2: Call Gemma 4 to produce a Judgment from Evidence.
 *
 * If Ollama is unreachable or returns invalid data, falls back to
 * a pattern-only Judgment derived from the Evidence (fail-closed).
 */
export async function judge(
  promptText: string,
  evidence: Evidence,
  aiToolId: AIToolId,
  config: Partial<JudgeConfig> = {},
): Promise<Judgment> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const start = Date.now();

  // ── Bright-line check: bypass LLM entirely ────────────────────────────
  if (evidence.brightLineFlags.length > 0) {
    return buildBrightLineJudgment(promptText, evidence, aiToolId, cfg);
  }

  // ── Trigger gate: skip LLM for trivial prompts ────────────────────────
  // If Stage 1 found nothing material, don't waste Ollama cycles.
  const hasMaterialSignal = evidence.entities.length > 0
    || evidence.contextualSignals.some(s => s.weight > 10)
    || evidence.patternScore > 15;

  if (!hasMaterialSignal) {
    return buildPatternOnlyJudgment(evidence, aiToolId, cfg, Date.now() - start);
  }

  // ── Call Gemma 4 via Ollama ───────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const entitySummary = evidence.entities
      .map(e => `- ${e.type}: "${e.text}" (confidence: ${e.confidence.toFixed(2)})`)
      .join('\n');

    const userMessage = `Classify:\n"${promptText.substring(0, 2000)}"\n\nEntities found: ${entitySummary || 'none'}`;

    // Use /api/generate with format=json — gemma3:4b doesn't support
    // function-calling (/api/chat with tools returns 400).
    const response = await fetch(`${cfg.endpoint}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        system: buildSystemPrompt(cfg.firmContext),
        prompt: userMessage,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 300 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[Iron Gate Judge] Ollama returned ${response.status} — falling back to pattern-only`);
      return buildPatternOnlyJudgment(evidence, aiToolId, cfg, Date.now() - start);
    }

    const rawData = await response.json() as any;
    const stage2Ms = Date.now() - start;

    // Parse the JSON response from /api/generate
    const responseText = rawData?.response || '';
    let data: OllamaResponse;
    try {
      const parsed = JSON.parse(responseText);
      // Wrap in OllamaResponse shape for downstream compatibility
      data = {
        message: {
          tool_calls: [{
            function: {
              name: 'submitJudgment',
              arguments: parsed,
            },
          }],
        },
      } as any;
    } catch {
      // Try parsing as direct content
      data = { message: { content: responseText } } as any;
    }

    // Extract function call from response
    const toolCall = data.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== 'submitJudgment') {
      // Model didn't use function calling — try to parse from content
      const fallbackParsed = tryParseContentAsJudgment(data.message?.content);
      if (fallbackParsed) {
        return buildJudgmentFromLLM(fallbackParsed, evidence, aiToolId, cfg, stage2Ms);
      }
      console.warn('[Iron Gate Judge] Model did not call submitJudgment — falling back');
      return buildPatternOnlyJudgment(evidence, aiToolId, cfg, stage2Ms);
    }

    let args = toolCall.function.arguments;
    console.log('[Iron Gate Judge] Raw args:', JSON.stringify(args)?.substring(0, 300));

    // Coerce types — models sometimes return score as string or use different casing
    if (args && typeof args === 'object') {
      if (typeof args.score === 'string') args.score = parseInt(args.score, 10) || 50;
      if (typeof args.verdict === 'undefined' && typeof args.action === 'string') args.verdict = args.action;
      if (typeof args.verdict === 'string') args.verdict = args.verdict.toLowerCase();
    }

    if (!args || typeof args.verdict !== 'string' || typeof args.score !== 'number' || isNaN(args.score)) {
      console.warn('[Iron Gate Judge] Cannot parse args — falling back. Got:', typeof args?.verdict, typeof args?.score);
      return buildPatternOnlyJudgment(evidence, aiToolId, cfg, stage2Ms);
    }

    console.log(`[Iron Gate Judge] Gemma verdict: ${args.verdict} score=${args.score}`);
    return buildJudgmentFromLLM(args, evidence, aiToolId, cfg, stage2Ms);

  } catch (err) {
    const stage2Ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      console.warn(`[Iron Gate Judge] Ollama timeout after ${cfg.timeoutMs}ms — falling back`);
    } else {
      console.warn(`[Iron Gate Judge] Ollama error: ${msg} — falling back`);
    }
    return buildPatternOnlyJudgment(evidence, aiToolId, cfg, stage2Ms);
  }
}

// ── Judgment Builders ───────────────────────────────────────────────────────

function buildBrightLineJudgment(
  promptText: string,
  evidence: Evidence,
  aiToolId: AIToolId,
  cfg: JudgeConfig,
): Judgment {
  const flagTypes = evidence.brightLineFlags.map(f => f.type).join(', ');
  return {
    verdict: 'block',
    score: 100,
    level: 'critical',
    reasoning: `Bright-line rule: ${flagTypes} detected. These entity types are always blocked regardless of context.`,
    entities: evidence.entities.map((e: any) => ({
      type: e.type,
      text: e.text,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      isSensitive: true,
    })),
    pseudonymMap: [],
    source: 'bright-line',
    latency: { stage1Ms: evidence.stage1LatencyMs, stage2Ms: 0, totalMs: evidence.stage1LatencyMs },
    model: { tag: cfg.model },
    brightLineOverride: true,
    complianceFrameworks: [],
    aiToolId,
    timestamp: new Date().toISOString(),
  };
}

function buildPatternOnlyJudgment(
  evidence: Evidence,
  aiToolId: AIToolId,
  cfg: JudgeConfig,
  stage2Ms: number,
): Judgment {
  const verdict: JudgmentVerdict =
    evidence.patternScore >= 86 ? 'block'
    : evidence.patternScore >= 61 ? 'mask'
    : evidence.patternScore >= 26 ? 'nudge'
    : 'allow';

  return {
    verdict,
    score: evidence.patternScore,
    level: evidence.patternLevel,
    reasoning: `Pattern-based assessment (Gemma 4 unavailable). ${evidence.entities.length} entities detected.`,
    entities: evidence.entities.map((e: any) => ({
      type: e.type,
      text: e.text,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      isSensitive: e.confidence >= 0.5,
    })),
    pseudonymMap: [],
    source: 'pattern-only',
    latency: { stage1Ms: evidence.stage1LatencyMs, stage2Ms, totalMs: evidence.stage1LatencyMs + stage2Ms },
    model: { tag: cfg.model },
    brightLineOverride: false,
    complianceFrameworks: [],
    aiToolId,
    timestamp: new Date().toISOString(),
  };
}

function buildJudgmentFromLLM(
  args: LLMJudgmentArgs,
  evidence: Evidence,
  aiToolId: AIToolId,
  cfg: JudgeConfig,
  stage2Ms: number,
): Judgment {
  const verdict = validateVerdict(args.verdict);
  const score = Math.max(0, Math.min(100, Math.round(args.score)));
  const level = scoreToLevel(score);

  // Merge LLM entities with regex entities — LLM wins on sensitivity assessment
  const llmEntities: JudgmentEntity[] = (args.entities || []).map((e: any) => ({
    type: String(e.type || 'UNKNOWN'),
    text: String(e.text || ''),
    start: 0, // LLM doesn't know exact spans — will be matched by text
    end: 0,
    confidence: 0.85,
    isSensitive: Boolean(e.isSensitive),
    contextNote: e.contextNote,
  }));

  // Match LLM entities to regex spans (regex has exact positions)
  const mergedEntities = mergeEntityAssessments(evidence.entities, llmEntities);

  return {
    verdict,
    score,
    level,
    reasoning: String(args.reasoning || ''),
    entities: mergedEntities,
    pseudonymMap: [],
    source: 'gemma4',
    latency: { stage1Ms: evidence.stage1LatencyMs, stage2Ms, totalMs: evidence.stage1LatencyMs + stage2Ms },
    model: { tag: cfg.model },
    brightLineOverride: false,
    complianceFrameworks: [],
    aiToolId,
    timestamp: new Date().toISOString(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function validateVerdict(v: string): JudgmentVerdict {
  if (v === 'allow' || v === 'nudge' || v === 'mask' || v === 'block') return v;
  return 'nudge'; // Conservative default
}

// scoreToLevel — imported from ./types (WP3 single source).

/**
 * Merge LLM sensitivity assessments with regex-detected spans.
 * Regex has exact positions; LLM has contextual understanding.
 */
function mergeEntityAssessments(
  regexEntities: Evidence['entities'],
  llmEntities: JudgmentEntity[],
): JudgmentEntity[] {
  const merged: JudgmentEntity[] = [];

  for (const re of regexEntities) {
    // Find matching LLM assessment by text (case-insensitive substring)
    const llmMatch = llmEntities.find(le =>
      le.text.toLowerCase() === re.text.toLowerCase()
      || re.text.toLowerCase().includes(le.text.toLowerCase())
      || le.text.toLowerCase().includes(re.text.toLowerCase())
    );

    merged.push({
      type: re.type,
      text: re.text,
      start: re.start,
      end: re.end,
      confidence: re.confidence,
      isSensitive: llmMatch ? llmMatch.isSensitive : re.confidence >= 0.5,
      contextNote: llmMatch?.contextNote,
    });
  }

  // Add any LLM-only entities (ones regex missed)
  for (const le of llmEntities) {
    const alreadyMerged = merged.some(m =>
      m.text.toLowerCase() === le.text.toLowerCase()
    );
    if (!alreadyMerged && le.isSensitive) {
      merged.push(le);
    }
  }

  return merged;
}

function tryParseContentAsJudgment(content: string | undefined): LLMJudgmentArgs | null {
  if (!content) return null;
  try {
    // Try to extract JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.verdict && typeof parsed.score === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

// ── Ollama Response Types ───────────────────────────────────────────────────

interface OllamaResponse {
  model: string;
  message?: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: any;
      };
    }>;
  };
  done: boolean;
}

interface LLMJudgmentArgs {
  verdict: string;
  score: number;
  reasoning: string;
  entities?: Array<{
    type: string;
    text: string;
    isSensitive: boolean;
    contextNote?: string;
  }>;
}

// ── Evidence Builder ────────────────────────────────────────────────────────
// Converts the existing detection pipeline output into Evidence.

import type { DetectedEntity as LocalDetectedEntity } from './types';
import { HIGH_PII_TYPES, scoreToLevel } from './types';

/**
 * Build Evidence from existing detection pipeline output.
 * This is the bridge between the current regex system and the new contract.
 */
export function buildEvidence(
  entities: LocalDetectedEntity[],
  score: number,
  level: SensitivityLevel,
  contextualSignals: Array<{ category: string; weight: number; confidence: number }>,
  stage1LatencyMs: number,
): Evidence {
  const brightLineFlags: BrightLineFlag[] = [];
  const BRIGHT_LINE_TYPES = new Set([
    'SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'DATABASE_URI',
    'PRIVATE_KEY', 'CLASSIFICATION_MARKING', 'EXPORT_CONTROL',
  ]);

  for (let i = 0; i < entities.length; i++) {
    if (BRIGHT_LINE_TYPES.has(entities[i].type)) {
      brightLineFlags.push({
        type: entities[i].type as BrightLineFlag['type'],
        entityIndex: i,
        reason: `${entities[i].type} is a non-negotiable compliance trigger`,
      });
    }
  }

  return {
    entities: entities.map(e => ({
      type: e.type as any,
      text: e.text,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      source: e.source as any,
    })),
    brightLineFlags,
    contextualSignals,
    patternScore: score,
    patternLevel: level,
    stage1LatencyMs,
  };
}
