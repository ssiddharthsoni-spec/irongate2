/**
 * Agent Pseudonymizer
 *
 * Wraps the local agent core for the pseudonymization use case.
 * Takes entities from the detection pipeline (regex/ML/dictionary),
 * builds the agent prompt, calls the model runtime, parses the response,
 * updates forward/reverse maps, and returns a PseudonymResult.
 *
 * This is the bridge between the existing detection pipeline and the
 * agent-based rewriting system.
 */

import type { DetectedEntity } from '../detection/types';
import type { PseudonymMapping, PseudonymResult } from '../detection/pseudonymizer';
import {
  getForwardMap, getReverseMap,
  pseudonymizeLocal,
} from '../detection/pseudonymizer';
import { createLocalAgent, type AgentRewriteResult } from './local-agent';
import type { ModelRuntime } from './model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentPseudonymizeOptions {
  /** Force simple find-replace instead of agent rewrite */
  forceSimple?: boolean;
  /** Timeout for agent rewrite in ms (default: 10000) */
  timeoutMs?: number;
}

export interface AgentPseudonymResult extends PseudonymResult {
  /** Which model backend was used */
  backend: string;
  /** Whether the agent fell back to simple find-replace */
  usedFallback: boolean;
  /** Agent processing latency */
  agentLatencyMs: number;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAgentPseudonymizer(runtime: ModelRuntime) {
  const agent = createLocalAgent(runtime);

  /**
   * Pseudonymize text using the local agent.
   *
   * Flow:
   *   1. Run the existing pseudonymizer to generate mappings
   *   2. Pass those mappings + original text to the agent
   *   3. Agent produces a coherent rewrite
   *   4. If agent fails, fall back to existing pseudonymizer output
   */
  async function pseudonymize(
    text: string,
    entities: DetectedEntity[],
    options?: AgentPseudonymizeOptions,
  ): Promise<AgentPseudonymResult> {
    // Step 1: Generate mappings using existing pseudonymizer
    // This populates the forward/reverse maps and gives us the replacement table
    const simpleResult = pseudonymizeLocal(text, entities);

    if (entities.length === 0 || options?.forceSimple) {
      return {
        ...simpleResult,
        backend: 'simple-replace',
        usedFallback: true,
        agentLatencyMs: 0,
      };
    }

    // Step 2: Ask the agent to rewrite coherently using the same mappings
    const timeoutMs = options?.timeoutMs ?? 10000;
    let agentResult: AgentRewriteResult;

    try {
      agentResult = await Promise.race([
        agent.rewrite({
          text,
          entities,
          forwardMap: getForwardMap(),
          preMappings: simpleResult.mappings,
        }),
        timeoutPromise(timeoutMs),
      ]);
    } catch {
      // Agent failed or timed out — return the simple result
      return {
        ...simpleResult,
        backend: 'simple-replace',
        usedFallback: true,
        agentLatencyMs: 0,
      };
    }

    return {
      maskedText: agentResult.rewrittenText,
      mappings: agentResult.mappings.length > 0 ? agentResult.mappings : simpleResult.mappings,
      skippedInCode: simpleResult.skippedInCode,
      backend: agentResult.backend,
      usedFallback: agentResult.usedFallback,
      agentLatencyMs: agentResult.latencyMs,
    };
  }

  return { pseudonymize };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms)
  );
}
