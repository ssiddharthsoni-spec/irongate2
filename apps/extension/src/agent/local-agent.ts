/**
 * Local Agent Core
 *
 * Instead of regex find-and-replace, a small language model running
 * entirely in the browser reads the prompt with entity annotations
 * and produces a coherent rewrite where all sensitive values are
 * replaced with consistent fakes.
 *
 * The agent receives:
 *   - Original text
 *   - Detected entities with types and positions
 *   - Current forward map (reuses existing pseudonyms)
 *   - System prompt for rewriting rules
 *
 * Output:
 *   - Rewritten text with coherent pseudonymization
 *   - Updated mappings (forward + reverse)
 *
 * SECURITY: The agent runs LOCALLY. No PII leaves the device unless
 * all backends fail and the API tier is used — in which case, only
 * sanitized text (entities replaced with type tokens) is sent.
 */

import type { DetectedEntity } from '../detection/types';
import type { PseudonymMapping } from '../detection/pseudonymizer';
import type { ModelRuntime, CompletionResponse } from './model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentRewriteRequest {
  /** Original text with PII */
  text: string;
  /** Detected entities from the detection pipeline */
  entities: DetectedEntity[];
  /** Existing forward map (original → pseudonym) for consistency */
  forwardMap: ReadonlyMap<string, string>;
  /** Pre-assigned pseudonyms for entities (from the pseudonymizer) */
  preMappings?: PseudonymMapping[];
}

export interface AgentRewriteResult {
  /** Rewritten text with coherent pseudonyms */
  rewrittenText: string;
  /** All mappings used in the rewrite */
  mappings: PseudonymMapping[];
  /** Which model backend was used */
  backend: string;
  /** Total latency in ms */
  latencyMs: number;
  /** Whether the agent fell back to simple find-replace */
  usedFallback: boolean;
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data protection agent. Your job is to rewrite text by replacing sensitive entities with provided pseudonyms while keeping the text coherent and natural.

RULES:
1. Replace EVERY annotated entity with its assigned pseudonym. Do not skip any.
2. Maintain grammatical correctness. Adjust articles, pronouns, and verb forms if needed.
3. Preserve the original meaning, tone, and structure of the text.
4. Do NOT add, remove, or summarize content. Only replace sensitive values.
5. If an entity appears multiple times, use the SAME pseudonym each time.
6. For partial mentions (e.g., just "Sarah" when full name is "Sarah Chen"), use the same pseudonym.
7. Output ONLY the rewritten text. No explanations, no annotations.`;

// ── Agent Core ───────────────────────────────────────────────────────────────

export function createLocalAgent(runtime: ModelRuntime) {
  /**
   * Rewrite text by replacing entities with pseudonyms using the LLM.
   * Falls back to simple find-replace if the LLM is unavailable or fails.
   */
  async function rewrite(request: AgentRewriteRequest): Promise<AgentRewriteResult> {
    const start = performance.now();
    const { text, entities, forwardMap, preMappings } = request;

    if (entities.length === 0) {
      return {
        rewrittenText: text,
        mappings: [],
        backend: 'none',
        latencyMs: 0,
        usedFallback: false,
      };
    }

    // Build the entity → pseudonym assignment table
    const mappings = buildMappings(entities, forwardMap, preMappings);

    // Build the user prompt with entity annotations
    const userPrompt = buildUserPrompt(text, entities, mappings);

    try {
      const response = await runtime.complete({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.1,
        maxTokens: Math.max(2048, text.length * 2),
      });

      // Validate the rewrite: ensure all pseudonyms appear in the output
      const validated = validateRewrite(response.text, mappings, text);

      return {
        rewrittenText: validated,
        mappings,
        backend: response.backend,
        latencyMs: performance.now() - start,
        usedFallback: false,
      };
    } catch {
      // Fallback: simple find-replace (same as current pseudonymizer)
      const fallbackResult = simpleReplace(text, entities, mappings);

      return {
        rewrittenText: fallbackResult,
        mappings,
        backend: 'fallback-replace',
        latencyMs: performance.now() - start,
        usedFallback: true,
      };
    }
  }

  return { rewrite };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMappings(
  entities: DetectedEntity[],
  forwardMap: ReadonlyMap<string, string>,
  preMappings?: PseudonymMapping[],
): PseudonymMapping[] {
  const mappings: PseudonymMapping[] = [];
  const seen = new Set<string>();

  // Use pre-assigned mappings if available
  if (preMappings) {
    for (const m of preMappings) {
      if (!seen.has(m.original)) {
        mappings.push(m);
        seen.add(m.original);
      }
    }
  }

  // Fill in from forward map for any entities not yet mapped
  for (const entity of entities) {
    const normalized = entity.text.trim();
    if (seen.has(normalized)) continue;

    const pseudonym = forwardMap.get(normalized);
    if (pseudonym) {
      mappings.push({ original: normalized, pseudonym, type: entity.type });
      seen.add(normalized);
    }
  }

  return mappings;
}

function buildUserPrompt(
  text: string,
  entities: DetectedEntity[],
  mappings: PseudonymMapping[],
): string {
  const mappingTable = mappings
    .map(m => `- "${m.original}" (${m.type}) → "${m.pseudonym}"`)
    .join('\n');

  return `ENTITY REPLACEMENT TABLE:
${mappingTable}

ORIGINAL TEXT:
${text}

Rewrite the text above, replacing every entity listed in the table with its assigned pseudonym. Output ONLY the rewritten text.`;
}

/**
 * Validate that the LLM's rewrite contains all expected pseudonyms.
 * If any are missing, patch them in via simple replacement.
 */
function validateRewrite(
  rewritten: string,
  mappings: PseudonymMapping[],
  original: string,
): string {
  let result = rewritten;

  for (const { original: orig, pseudonym } of mappings) {
    // If the pseudonym is already in the text, the LLM got it right
    if (result.includes(pseudonym)) continue;

    // If the original text is still in the rewrite, the LLM missed it — patch
    if (result.includes(orig)) {
      result = result.replaceAll(orig, pseudonym);
    }
  }

  // Safety check: if the rewrite is suspiciously short (LLM truncated), use fallback
  if (result.length < original.length * 0.5) {
    return simpleReplace(original, [], mappings.map(m => m));
  }

  return result;
}

/**
 * Simple find-replace fallback — replaces originals with pseudonyms
 * in reverse order of length (longest first to avoid partial matches).
 */
function simpleReplace(
  text: string,
  _entities: DetectedEntity[],
  mappings: PseudonymMapping[],
): string {
  let result = text;

  // Sort by original length descending to prevent partial replacements
  const sorted = [...mappings].sort((a, b) => b.original.length - a.original.length);

  for (const { original, pseudonym } of sorted) {
    result = result.replaceAll(original, pseudonym);
  }

  return result;
}
