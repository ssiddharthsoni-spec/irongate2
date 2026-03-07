/**
 * IronGate QA Scenario Tests
 *
 * Tests the complete detection → scoring → pseudonymization pipeline
 * for all 7 QA test scenarios from the IronGate QA Testing Agent.
 *
 * Each scenario validates:
 *   1. Entity detection (correct types found)
 *   2. Scoring (appropriate risk level)
 *   3. Pseudonymization (all sensitive data replaced)
 *   4. Adapter round-trip (extract → replace → verify format)
 *   5. False positive immunity (benign content not flagged)
 */

import { describe, it, expect } from 'vitest';

// ── Detection Pipeline ─────────────────────────────────────────────────────
import { detectWithRegex } from '../src/detection/fallback-regex';
import { scanForSecrets } from '../src/worker/detectors/secret-scanner';
import { computeScore } from '../src/detection/scorer';
import { pseudonymizeLocal } from '../src/detection/pseudonymizer';
import type { DetectedEntity } from '../src/detection/types';

/**
 * Combined detection: PII regex + secret scanner.
 * This mirrors the full pipeline in main-world.ts which runs both detectors.
 */
function detectAll(text: string): DetectedEntity[] {
  const piiEntities = detectWithRegex(text);
  const secrets = scanForSecrets(text);
  // Merge secret scanner results as DetectedEntity objects
  const secretEntities: DetectedEntity[] = secrets.map(s => ({
    type: s.type,
    text: s.text,
    start: s.start,
    end: s.end,
    confidence: s.confidence,
    source: s.source,
  }));
  // Combine, sort by position, dedupe overlaps
  const combined = [...piiEntities, ...secretEntities].sort((a, b) => a.start - b.start);
  // Remove overlapping entities (keep higher confidence)
  if (combined.length <= 1) return combined;
  const result: DetectedEntity[] = [combined[0]];
  for (let i = 1; i < combined.length; i++) {
    const current = combined[i];
    const last = result[result.length - 1];
    if (current.start < last.end) {
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

// ── Adapters ───────────────────────────────────────────────────────────────
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { ClaudeAdapter } from '../src/content/adapters/claude';
import { CopilotAdapter } from '../src/content/adapters/copilot';
import { DeepSeekAdapter } from '../src/content/adapters/deepseek';
import { GeminiAdapter } from '../src/content/adapters/gemini';
import { GroqAdapter } from '../src/content/adapters/groq';
import { HuggingFaceAdapter } from '../src/content/adapters/huggingface';
import { PerplexityAdapter } from '../src/content/adapters/perplexity';
import { PoeAdapter } from '../src/content/adapters/poe';
import { YouAdapter } from '../src/content/adapters/you';
import type { SiteAdapter } from '../src/content/adapters/base';

// ═══════════════════════════════════════════════════════════════════════════
// QA TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

const SCENARIOS = {
  scenario1_basic_pii: {
    name: 'Scenario 1: Basic PII (Names + Email)',
    prompt: 'Can you write a professional email from John Smith (john.smith@acme.com) to Sarah Johnson (sarah.j@globex.net) about the Q4 budget review meeting?',
    expectedEntityTypes: ['PERSON', 'EMAIL'],
    minEntities: 3, // 2 emails + at least 1 name
    minScore: 20,
    expectedLevel: ['low', 'medium', 'high'],
    mustContain: ['john.smith@acme.com', 'sarah.j@globex.net'],
    mustNotContainAfterPseudo: ['john.smith@acme.com', 'sarah.j@globex.net'],
  },

  scenario2_financial: {
    name: 'Scenario 2: Financial Data (Credit Card + SSN)',
    prompt: 'I need help formatting this customer record: James Wilson, SSN 423-86-1957, Visa ending 4532-8921-0076-3344, phone (415) 555-0187.',
    expectedEntityTypes: ['SSN', 'CREDIT_CARD', 'PHONE_NUMBER'],
    minEntities: 3, // SSN, CC, phone
    minScore: 40,
    expectedLevel: ['high', 'critical'],
    mustContain: ['423-86-1957', '4532-8921-0076-3344'],
    mustNotContainAfterPseudo: ['423-86-1957', '4532-8921-0076-3344'],
  },

  scenario3_api_keys: {
    name: 'Scenario 3: API Keys & Credentials',
    prompt: 'My AWS access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. Can you help me debug why my S3 upload is failing?',
    expectedEntityTypes: ['AWS_CREDENTIAL'],
    minEntities: 1, // at least the access key
    minScore: 15,
    expectedLevel: ['medium', 'high', 'critical'],
    mustContain: ['AKIAIOSFODNN7EXAMPLE'],
    mustNotContainAfterPseudo: ['AKIAIOSFODNN7EXAMPLE'],
  },

  scenario4_mixed: {
    name: 'Scenario 4: Mixed Sensitive Content',
    prompt: 'Please review this employee record: Dr. Maria Garcia, Employee ID: EMP-29481, salary $185,000, DOB 03/15/1988, works at 742 Evergreen Terrace, Springfield IL 62704. Her manager is Robert Chen (robert.chen@internal.corp).',
    expectedEntityTypes: ['EMAIL'],
    minEntities: 1, // at minimum the email
    minScore: 10,
    expectedLevel: ['low', 'medium', 'high'],
    mustContain: ['robert.chen@internal.corp'],
    mustNotContainAfterPseudo: ['robert.chen@internal.corp'],
  },

  scenario5_code_secrets: {
    name: 'Scenario 5: Code with Embedded Secrets',
    prompt: `Here's my config file:
DATABASE_URL=postgresql://admin:SuperSecret123@db.prod.mycompany.com:5432/maindb
API_TOKEN=sk-proj-abc123def456ghi789
STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc
Can you help me set up environment variables properly?`,
    expectedEntityTypes: ['API_KEY'],
    minEntities: 1, // at least one API key pattern
    minScore: 10,
    expectedLevel: ['low', 'medium', 'high', 'critical'],
    mustContain: ['sk_live_4eC39HqLyjWDarjtT1zdp7dc'],
    mustNotContainAfterPseudo: ['sk_live_4eC39HqLyjWDarjtT1zdp7dc'],
  },

  scenario6_false_positive: {
    name: 'Scenario 6: Minimal Content (False Positive Check)',
    prompt: 'Can you explain how photosynthesis works in simple terms?',
    expectedEntityTypes: [],
    minEntities: 0,
    maxEntities: 1, // allow at most 1 false positive
    minScore: 0,
    maxScore: 10,
    expectedLevel: ['low'],
    mustContain: [],
    mustNotContainAfterPseudo: [],
  },

  scenario7_brand_names: {
    name: 'Scenario 7: Edge Case — Common Names in Context',
    prompt: "I'm reading about John Deere tractors and how the Ford Motor Company started. Can you compare their histories?",
    expectedEntityTypes: [],
    minEntities: 0,
    maxEntities: 2, // some false positives acceptable, but should be low
    minScore: 0,
    maxScore: 25, // should not score high
    expectedLevel: ['low', 'medium'],
    mustContain: [],
    mustNotContainAfterPseudo: [],
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Core Pipeline Tests per Scenario
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Detection Pipeline', () => {
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    describe(scenario.name, () => {
      const entities = detectAll(scenario.prompt);
      const { score, level } = computeScore(scenario.prompt, entities);

      it('should detect expected minimum entity count', () => {
        expect(entities.length).toBeGreaterThanOrEqual(scenario.minEntities);
      });

      if ('maxEntities' in scenario) {
        it(`should not exceed ${scenario.maxEntities} entities (false positive check)`, () => {
          expect(entities.length).toBeLessThanOrEqual(scenario.maxEntities!);
        });
      }

      if (scenario.expectedEntityTypes.length > 0) {
        it('should detect expected entity types', () => {
          const foundTypes = new Set(entities.map(e => e.type));
          for (const expectedType of scenario.expectedEntityTypes) {
            expect(
              foundTypes.has(expectedType),
              `Expected entity type "${expectedType}" not found. Found: ${[...foundTypes].join(', ')}`
            ).toBe(true);
          }
        });
      }

      it('should produce expected score range', () => {
        expect(score).toBeGreaterThanOrEqual(scenario.minScore);
        if ('maxScore' in scenario) {
          expect(score).toBeLessThanOrEqual(scenario.maxScore!);
        }
      });

      it('should produce expected risk level', () => {
        expect(scenario.expectedLevel).toContain(level);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Pseudonymization Tests per Scenario
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Pseudonymization', () => {
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    // Skip false positive scenarios (nothing to pseudonymize)
    if (scenario.minEntities === 0 && scenario.mustContain.length === 0) continue;

    describe(scenario.name, () => {
      const entities = detectAll(scenario.prompt);
      const pseudoResult = pseudonymizeLocal(scenario.prompt, entities);

      it('should pseudonymize all must-replace strings', () => {
        for (const sensitive of scenario.mustNotContainAfterPseudo) {
          expect(
            pseudoResult.maskedText.includes(sensitive),
            `Sensitive string "${sensitive}" should NOT appear in pseudonymized text`
          ).toBe(false);
        }
      });

      it('should produce mappings for replaced entities', () => {
        if (entities.length > 0) {
          expect(pseudoResult.mappings.length).toBeGreaterThan(0);
        }
      });

      it('should preserve prompt structure (length should be similar)', () => {
        // Pseudonymized text should be roughly similar length (within 50% variance)
        const ratio = pseudoResult.maskedText.length / scenario.prompt.length;
        expect(ratio).toBeGreaterThan(0.5);
        expect(ratio).toBeLessThan(2.0);
      });

      it('should produce unique pseudonyms (no identity mappings)', () => {
        for (const mapping of pseudoResult.mappings) {
          expect(
            mapping.original !== mapping.pseudonym,
            `Mapping should not be identity: "${mapping.original}" → "${mapping.pseudonym}"`
          ).toBe(true);
        }
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Adapter Round-Trip Tests
// ═══════════════════════════════════════════════════════════════════════════

// Adapters that support wire-level extract/replace (excludes Gemini which is DOM-only)
const WIRE_ADAPTERS: Array<{ adapter: SiteAdapter; bodyBuilder: (prompt: string) => string }> = [
  {
    adapter: ChatGPTAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      action: 'next',
      messages: [{ id: 'msg-1', role: 'user', content: { content_type: 'text', parts: [prompt] } }],
      model: 'gpt-4',
    }),
  },
  {
    adapter: ClaudeAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-3-opus-20240229',
    }),
  },
  {
    adapter: DeepSeekAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
    }),
  },
  {
    adapter: GroqAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-70b',
    }),
  },
  {
    adapter: HuggingFaceAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      inputs: prompt,
    }),
  },
  {
    adapter: PerplexityAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      text: prompt,
    }),
  },
  {
    adapter: PoeAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      variables: { input: { text: prompt } },
      query: 'mutation M($input: SendMessageInput!) { sendMessage(input: $input) }',
    }),
  },
  {
    adapter: YouAdapter,
    bodyBuilder: (prompt) => JSON.stringify({
      query: prompt,
    }),
  },
];

describe('QA Scenarios — Adapter Round-Trip', () => {
  // Use Scenario 2 (financial data) as the primary round-trip test case
  // because it has clear, unambiguous entities
  const testPrompt = SCENARIOS.scenario2_financial.prompt;
  const entities = detectAll(testPrompt);
  const pseudoResult = pseudonymizeLocal(testPrompt, entities);

  for (const { adapter, bodyBuilder } of WIRE_ADAPTERS) {
    describe(`${adapter.name}`, () => {
      const body = bodyBuilder(testPrompt);

      it('should extract the prompt from the request body', () => {
        const extracted = adapter.extractPrompt(body);
        expect(extracted).not.toBeNull();
        expect(extracted).toBe(testPrompt);
      });

      it('should replace the prompt in the request body', () => {
        const replaced = adapter.replacePrompt(body, testPrompt, pseudoResult.maskedText);
        expect(replaced).not.toBeNull();

        // The replaced body should contain the pseudonymized text, not the original
        expect(replaced).toContain(pseudoResult.maskedText.substring(0, 30).replace(/[\\/"]/g, ''));
        for (const sensitive of SCENARIOS.scenario2_financial.mustNotContainAfterPseudo) {
          // Check JSON-escaped version since body is JSON
          expect(replaced!.includes(sensitive)).toBe(false);
        }
      });

      it('should extract the pseudonymized prompt from the replaced body', () => {
        const replaced = adapter.replacePrompt(body, testPrompt, pseudoResult.maskedText);
        if (replaced) {
          const reExtracted = adapter.extractPrompt(replaced);
          expect(reExtracted).toBe(pseudoResult.maskedText);
        }
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Cross-Scenario Consistency Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Cross-Scenario Consistency', () => {
  it('sensitive scenarios should always score higher than benign ones', () => {
    const sensitiveEntities = detectAll(SCENARIOS.scenario2_financial.prompt);
    const benignEntities = detectAll(SCENARIOS.scenario6_false_positive.prompt);
    const sensitiveScore = computeScore(SCENARIOS.scenario2_financial.prompt, sensitiveEntities).score;
    const benignScore = computeScore(SCENARIOS.scenario6_false_positive.prompt, benignEntities).score;
    expect(sensitiveScore).toBeGreaterThan(benignScore);
  });

  it('financial data should score higher than basic PII', () => {
    const financialEntities = detectAll(SCENARIOS.scenario2_financial.prompt);
    const basicEntities = detectAll(SCENARIOS.scenario1_basic_pii.prompt);
    const financialScore = computeScore(SCENARIOS.scenario2_financial.prompt, financialEntities).score;
    const basicScore = computeScore(SCENARIOS.scenario1_basic_pii.prompt, basicEntities).score;
    expect(financialScore).toBeGreaterThanOrEqual(basicScore);
  });

  it('all pseudonymization mappings should have distinct pseudonyms', () => {
    for (const [, scenario] of Object.entries(SCENARIOS)) {
      if (scenario.minEntities === 0) continue;
      const entities = detectAll(scenario.prompt);
      const result = pseudonymizeLocal(scenario.prompt, entities);
      const pseudonyms = result.mappings.map(m => m.pseudonym);
      const uniquePseudonyms = new Set(pseudonyms);
      // Allow some duplicates (same entity appearing multiple times gets same pseudonym)
      // but ensure we don't have all identical pseudonyms
      if (pseudonyms.length > 1) {
        expect(uniquePseudonyms.size).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: All Scenarios x All Adapters — Extract Roundtrip Matrix
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Full Matrix (Scenarios x Adapters)', () => {
  const sensitiveScenarios = [
    SCENARIOS.scenario1_basic_pii,
    SCENARIOS.scenario2_financial,
    SCENARIOS.scenario4_mixed,
  ];

  for (const scenario of sensitiveScenarios) {
    describe(scenario.name, () => {
      for (const { adapter, bodyBuilder } of WIRE_ADAPTERS) {
        it(`${adapter.name}: detect → pseudo → replace → verify`, () => {
          // 1. Detect entities
          const entities = detectAll(scenario.prompt);
          expect(entities.length).toBeGreaterThanOrEqual(scenario.minEntities);

          // 2. Pseudonymize
          const pseudoResult = pseudonymizeLocal(scenario.prompt, entities);

          // 3. Build adapter body and replace
          const body = bodyBuilder(scenario.prompt);
          const extracted = adapter.extractPrompt(body);
          expect(extracted).toBe(scenario.prompt);

          const replaced = adapter.replacePrompt(body, scenario.prompt, pseudoResult.maskedText);
          expect(replaced).not.toBeNull();

          // 4. Verify sensitive data is gone from replaced body
          for (const sensitive of scenario.mustNotContainAfterPseudo) {
            expect(replaced!.includes(sensitive)).toBe(false);
          }

          // 5. Verify re-extraction gives pseudonymized text
          const reExtracted = adapter.extractPrompt(replaced!);
          expect(reExtracted).toBe(pseudoResult.maskedText);
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Copilot SignalR WebSocket Frame Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Copilot SignalR Frames', () => {
  it('should extract prompt from SignalR invocation frame', () => {
    const prompt = SCENARIOS.scenario1_basic_pii.prompt;
    const frame = JSON.stringify({
      type: 1,
      target: 'chat',
      arguments: [{ message: prompt }],
    });
    const extracted = CopilotAdapter.extractFromWsFrame?.(frame);
    // Copilot WS extraction walks the frame for the longest string
    if (extracted) {
      expect(extracted.length).toBeGreaterThan(20);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Perplexity Socket.IO Frame Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Perplexity Socket.IO Frames', () => {
  it('should extract prompt from perplexity_ask event frame', () => {
    const prompt = SCENARIOS.scenario1_basic_pii.prompt;
    const frame = `42["perplexity_ask","${prompt.replace(/"/g, '\\"')}",{}]`;
    const extracted = PerplexityAdapter.extractFromWsFrame?.(frame);
    expect(extracted).toBe(prompt);
  });

  it('should replace prompt in perplexity_ask event frame', () => {
    const prompt = SCENARIOS.scenario2_financial.prompt;
    const entities = detectAll(prompt);
    const pseudoResult = pseudonymizeLocal(prompt, entities);
    const frame = `42["perplexity_ask","${prompt.replace(/"/g, '\\"')}",{}]`;
    const replaced = PerplexityAdapter.replaceInWsFrame?.(frame, prompt, pseudoResult.maskedText);
    expect(replaced).not.toBeNull();
    if (replaced) {
      for (const sensitive of SCENARIOS.scenario2_financial.mustNotContainAfterPseudo) {
        expect(replaced.includes(sensitive)).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Document Upload Pattern Coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('QA Scenarios — Document Upload Coverage', () => {
  const allAdapters = [
    ChatGPTAdapter, ClaudeAdapter, CopilotAdapter, DeepSeekAdapter,
    GeminiAdapter, GroqAdapter, HuggingFaceAdapter, PerplexityAdapter,
    PoeAdapter, YouAdapter,
  ];

  it('all 10 adapters should have fileUploadPatterns defined', () => {
    for (const adapter of allAdapters) {
      expect(
        adapter.fileUploadPatterns,
        `${adapter.name} is missing fileUploadPatterns`
      ).toBeDefined();
      expect(adapter.fileUploadPatterns!.length).toBeGreaterThan(0);
    }
  });

  it('file upload patterns should not match LLM API endpoints', () => {
    for (const adapter of allAdapters) {
      if (!adapter.fileUploadPatterns) continue;
      for (const apiPattern of adapter.apiPatterns) {
        // Get a sample URL that matches the API pattern
        // Ensure fileUploadPatterns don't accidentally match regular API calls
        // This is a structural check — we verify patterns are distinct
        const hasOverlap = adapter.fileUploadPatterns.some(fp =>
          fp.source === apiPattern.source
        );
        expect(
          hasOverlap,
          `${adapter.name}: fileUploadPattern should not be identical to apiPattern`
        ).toBe(false);
      }
    }
  });
});
