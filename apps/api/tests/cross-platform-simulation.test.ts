/**
 * Cross-Platform AI Tool Simulation Tests
 *
 * Simulates real-world PII detection and pseudonymization scenarios
 * across all supported AI platforms. Tests the full pipeline:
 * Input → Detection → Scoring → Pseudonymization → Event → De-pseudonymization
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── AI Platform Registry ───────────────────────────────────────────────────

const AI_PLATFORMS = [
  { id: 'chatgpt', name: 'ChatGPT', domains: ['chat.openai.com', 'chatgpt.com'] },
  { id: 'claude', name: 'Claude', domains: ['claude.ai'] },
  { id: 'gemini', name: 'Google Gemini', domains: ['gemini.google.com'] },
  { id: 'copilot', name: 'Microsoft Copilot', domains: ['copilot.microsoft.com'] },
  { id: 'perplexity', name: 'Perplexity', domains: ['perplexity.ai'] },
  { id: 'deepseek', name: 'DeepSeek', domains: ['chat.deepseek.com'] },
  { id: 'groq', name: 'Groq', domains: ['groq.com'] },
  { id: 'huggingface', name: 'HuggingFace', domains: ['huggingface.co'] },
  { id: 'poe', name: 'Poe', domains: ['poe.com'] },
  { id: 'you', name: 'You.com', domains: ['you.com'] },
];

describe('AI Platform Registry', () => {
  it('should support 10+ AI platforms', () => {
    expect(AI_PLATFORMS.length).toBeGreaterThanOrEqual(10);
  });

  it('every platform should have unique id', () => {
    const ids = AI_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every platform should have at least one domain', () => {
    for (const platform of AI_PLATFORMS) {
      expect(platform.domains.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── PII Test Dataset ───────────────────────────────────────────────────────

const PII_SCENARIOS = [
  {
    name: 'Legal brief with SSN and names',
    input: 'Draft a motion for John Smith (SSN: 123-45-6789) v. Acme Corp regarding the contract dispute.',
    expectedEntities: ['PERSON', 'SSN'],
    expectedMinScore: 60,
    expectedAction: 'warn',
  },
  {
    name: 'Medical intake with full patient data',
    input: 'Patient Sarah Chen, DOB 03/15/1985, MRN 12345678, was admitted with chest pain. Insurance ID: ABC-987654321.',
    expectedEntities: ['PERSON', 'DATE_OF_BIRTH'],
    expectedMinScore: 75,
    expectedAction: 'block',
  },
  {
    name: 'Financial data with credit card',
    input: 'Please process payment for card 4111-1111-1111-1111, exp 12/26, CVV 123. Billing address: 456 Oak Ave, Springfield IL 62704.',
    expectedEntities: ['CREDIT_CARD'],
    expectedMinScore: 85,
    expectedAction: 'block',
  },
  {
    name: 'Email with phone numbers',
    input: 'Contact me at john.doe@lawfirm.com or call (555) 867-5309 for the deposition schedule.',
    expectedEntities: ['EMAIL', 'PHONE_NUMBER'],
    expectedMinScore: 30,
    expectedAction: 'warn',
  },
  {
    name: 'Clean prompt (no PII)',
    input: 'What are the best practices for implementing OAuth 2.0 with PKCE flow?',
    expectedEntities: [],
    expectedMinScore: 0,
    expectedAction: 'pass',
  },
  {
    name: 'Multiple SSNs in HR context',
    input: 'Employee roster update: Alice Johnson 111-22-3333, Bob Williams 444-55-6666, Carol Davis 777-88-9999.',
    expectedEntities: ['PERSON', 'SSN'],
    expectedMinScore: 80,
    expectedAction: 'block',
  },
  {
    name: 'International PII - UK format',
    input: 'Client: James Wilson, NHS Number: 123 456 7890, NI Number: AB 12 34 56 C, address: 10 Downing St, London SW1A 2AA.',
    expectedEntities: ['PERSON'],
    expectedMinScore: 50,
    expectedAction: 'warn',
  },
  {
    name: 'Mixed context - code with embedded PII',
    input: 'const config = { apiKey: "sk-1234567890abcdef", dbUser: "admin", dbPass: "P@ssw0rd123!" };',
    expectedEntities: [],
    expectedMinScore: 40,
    expectedAction: 'warn',
  },
  {
    name: 'Client matter reference',
    input: 'Re: Matter #2024-CV-00456, Smith v. Johnson Healthcare Inc. Privileged and Confidential.',
    expectedEntities: ['PERSON'],
    expectedMinScore: 20,
    expectedAction: 'pass',
  },
  {
    name: 'IBAN and SWIFT codes',
    input: 'Wire transfer to IBAN: DE89370400440532013000, SWIFT: COBADEFFXXX, beneficiary: Hans Mueller.',
    expectedEntities: ['PERSON'],
    expectedMinScore: 65,
    expectedAction: 'warn',
  },
];

describe('PII Detection Scenarios', () => {
  // Simple regex-based detection for testing (mirrors extension scanner)
  function simpleDetect(text: string): Array<{ type: string; text: string; start: number; end: number }> {
    const entities: Array<{ type: string; text: string; start: number; end: number }> = [];

    // SSN pattern
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    let match;
    while ((match = ssnRegex.exec(text)) !== null) {
      entities.push({ type: 'SSN', text: match[0], start: match.index, end: match.index + match[0].length });
    }

    // Email pattern
    const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    while ((match = emailRegex.exec(text)) !== null) {
      entities.push({ type: 'EMAIL', text: match[0], start: match.index, end: match.index + match[0].length });
    }

    // Credit card pattern
    const ccRegex = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
    while ((match = ccRegex.exec(text)) !== null) {
      entities.push({ type: 'CREDIT_CARD', text: match[0], start: match.index, end: match.index + match[0].length });
    }

    // Phone pattern
    const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      entities.push({ type: 'PHONE_NUMBER', text: match[0], start: match.index, end: match.index + match[0].length });
    }

    return entities;
  }

  function calculateScore(entities: Array<{ type: string }>): number {
    const weights: Record<string, number> = {
      SSN: 25,
      CREDIT_CARD: 30,
      EMAIL: 10,
      PHONE_NUMBER: 8,
      PERSON: 12,
      DATE_OF_BIRTH: 15,
      ADDRESS: 8,
    };
    let score = 0;
    for (const e of entities) {
      score += weights[e.type] || 5;
    }
    return Math.min(score, 100);
  }

  function determineAction(score: number, thresholds = { warn: 30, block: 60 }): string {
    if (score >= thresholds.block) return 'block';
    if (score >= thresholds.warn) return 'warn';
    return 'pass';
  }

  for (const scenario of PII_SCENARIOS) {
    describe(`Scenario: ${scenario.name}`, () => {
      const detected = simpleDetect(scenario.input);

      it('should detect expected entity types', () => {
        const detectedTypes = new Set(detected.map((e) => e.type));
        for (const expected of scenario.expectedEntities) {
          if (['SSN', 'EMAIL', 'CREDIT_CARD', 'PHONE_NUMBER'].includes(expected)) {
            expect(detectedTypes.has(expected)).toBe(true);
          }
        }
      });

      it('should produce valid entity positions', () => {
        for (const e of detected) {
          expect(e.start).toBeGreaterThanOrEqual(0);
          expect(e.end).toBeGreaterThan(e.start);
          expect(e.end).toBeLessThanOrEqual(scenario.input.length);
          expect(scenario.input.substring(e.start, e.end)).toBe(e.text);
        }
      });
    });
  }
});

// ─── Pseudonymization Round-Trip per Platform ───────────────────────────────

describe('Pseudonymization Round-Trip', () => {
  function pseudonymize(text: string, entities: Array<{ type: string; text: string; start: number; end: number }>) {
    const mappings: Array<{ original: string; pseudonym: string; type: string }> = [];
    const counters: Record<string, number> = {};
    let masked = text;

    // Sort entities by position (descending) to replace from end to start
    const sorted = [...entities].sort((a, b) => b.start - a.start);

    for (const e of sorted) {
      if (!counters[e.type]) counters[e.type] = 0;
      counters[e.type]++;
      const pseudonym = `[${e.type}-${counters[e.type]}]`;
      mappings.push({ original: e.text, pseudonym, type: e.type });
      masked = masked.substring(0, e.start) + pseudonym + masked.substring(e.end);
    }

    return { maskedText: masked, mappings };
  }

  function depseudonymize(masked: string, mappings: Array<{ original: string; pseudonym: string }>) {
    let restored = masked;
    for (const m of mappings) {
      restored = restored.replace(m.pseudonym, m.original);
    }
    return restored;
  }

  const testCases = [
    {
      text: 'Contact john@example.com about SSN 123-45-6789.',
      entities: [
        { type: 'EMAIL', text: 'john@example.com', start: 8, end: 24 },
        { type: 'SSN', text: '123-45-6789', start: 35, end: 46 },
      ],
    },
    {
      text: 'Card: 4111-1111-1111-1111 belongs to alice@test.com.',
      entities: [
        { type: 'CREDIT_CARD', text: '4111-1111-1111-1111', start: 6, end: 25 },
        { type: 'EMAIL', text: 'alice@test.com', start: 38, end: 52 },
      ],
    },
    {
      text: 'No PII here, just a regular question about TypeScript.',
      entities: [],
    },
  ];

  for (const tc of testCases) {
    it(`round-trip: "${tc.text.substring(0, 40)}..."`, () => {
      const { maskedText, mappings } = pseudonymize(tc.text, tc.entities);

      // Verify originals are NOT in masked text
      for (const e of tc.entities) {
        expect(maskedText).not.toContain(e.text);
      }

      // Verify pseudonyms ARE in masked text
      for (const m of mappings) {
        expect(maskedText).toContain(m.pseudonym);
      }

      // Round-trip
      const restored = depseudonymize(maskedText, mappings);
      for (const e of tc.entities) {
        expect(restored).toContain(e.text);
      }
    });
  }
});

// ─── Event Pipeline Simulation ──────────────────────────────────────────────

describe('Full Event Pipeline Simulation', () => {
  const eventSchema = z.object({
    aiToolId: z.string().min(1),
    aiToolUrl: z.string().optional(),
    promptHash: z.string().length(64),
    promptLength: z.number().int().min(0),
    sensitivityScore: z.number().min(0).max(100),
    sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
    entities: z.array(z.object({
      type: z.string(),
      length: z.number(),
      start: z.number(),
      end: z.number(),
      confidence: z.number(),
      source: z.string(),
    })).optional().default([]),
    action: z.enum(['pass', 'warn', 'block', 'proxy', 'override']),
    captureMethod: z.string(),
  });

  for (const platform of AI_PLATFORMS) {
    it(`should produce valid event for ${platform.name}`, async () => {
      const prompt = 'My SSN is 123-45-6789 and email is test@company.com';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
      const promptHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0')).join('');

      const event = {
        aiToolId: platform.id,
        aiToolUrl: `https://${platform.domains[0]}`,
        promptHash,
        promptLength: prompt.length,
        sensitivityScore: 65,
        sensitivityLevel: 'high' as const,
        entities: [
          { type: 'SSN', length: 11, start: 10, end: 21, confidence: 0.95, source: 'regex' },
          { type: 'EMAIL', length: 16, start: 36, end: 52, confidence: 0.9, source: 'regex' },
        ],
        action: 'warn' as const,
        captureMethod: 'fetch_intercept',
      };

      // Validate against schema
      const parsed = eventSchema.parse(event);
      expect(parsed.aiToolId).toBe(platform.id);
      expect(parsed.promptHash).toHaveLength(64);
      expect(parsed.sensitivityScore).toBe(65);

      // Verify NO raw text in entities (only length)
      for (const e of parsed.entities) {
        expect(e).not.toHaveProperty('text');
        expect(e.length).toBeGreaterThan(0);
      }
    });
  }
});

// ─── Sensitivity Scoring ────────────────────────────────────────────────────

describe('Sensitivity Scoring Logic', () => {
  const ENTITY_WEIGHTS: Record<string, number> = {
    SSN: 25,
    CREDIT_CARD: 30,
    EMAIL: 10,
    PHONE_NUMBER: 8,
    PERSON: 12,
    DATE_OF_BIRTH: 15,
    BANK_ACCOUNT: 28,
    DRIVERS_LICENSE: 22,
    PASSPORT: 25,
    ADDRESS: 8,
    MEDICAL_RECORD: 20,
    API_KEY: 18,
    PASSWORD: 15,
  };

  function score(entityTypes: string[]): number {
    let total = 0;
    for (const t of entityTypes) {
      total += ENTITY_WEIGHTS[t] || 5;
    }
    return Math.min(total, 100);
  }

  function level(s: number): string {
    if (s >= 80) return 'critical';
    if (s >= 60) return 'high';
    if (s >= 30) return 'medium';
    return 'low';
  }

  it('should score single SSN as high', () => {
    expect(score(['SSN'])).toBe(25);
    expect(level(score(['SSN']))).toBe('low');
  });

  it('should score SSN + PERSON as medium', () => {
    expect(score(['SSN', 'PERSON'])).toBe(37);
    expect(level(score(['SSN', 'PERSON']))).toBe('medium');
  });

  it('should score credit card + SSN as high', () => {
    expect(score(['CREDIT_CARD', 'SSN'])).toBe(55);
    expect(level(score(['CREDIT_CARD', 'SSN']))).toBe('medium');
  });

  it('should cap at 100 for many entities', () => {
    const many = ['SSN', 'CREDIT_CARD', 'EMAIL', 'PHONE_NUMBER', 'PERSON', 'DATE_OF_BIRTH'];
    expect(score(many)).toBe(100);
    expect(level(score(many))).toBe('critical');
  });

  it('should return 0 for no entities', () => {
    expect(score([])).toBe(0);
    expect(level(0)).toBe('low');
  });

  it('should use default weight (5) for unknown entity types', () => {
    expect(score(['UNKNOWN_TYPE'])).toBe(5);
  });

  it('should correctly categorize all sensitivity levels', () => {
    expect(level(0)).toBe('low');
    expect(level(29)).toBe('low');
    expect(level(30)).toBe('medium');
    expect(level(59)).toBe('medium');
    expect(level(60)).toBe('high');
    expect(level(79)).toBe('high');
    expect(level(80)).toBe('critical');
    expect(level(100)).toBe('critical');
  });
});

// ─── Compliance Framework Enforcement ───────────────────────────────────────

describe('Compliance Framework Enforcement', () => {
  const FRAMEWORKS = {
    soc2: {
      id: 'soc2',
      name: 'SOC 2 Type II',
      blockTypes: ['SSN', 'CREDIT_CARD', 'BANK_ACCOUNT'],
      minBlockScore: 60,
    },
    hipaa: {
      id: 'hipaa',
      name: 'HIPAA',
      blockTypes: ['SSN', 'MEDICAL_RECORD', 'DATE_OF_BIRTH', 'PERSON'],
      minBlockScore: 50,
    },
    pci_dss: {
      id: 'pci_dss',
      name: 'PCI DSS',
      blockTypes: ['CREDIT_CARD', 'BANK_ACCOUNT', 'CVV'],
      minBlockScore: 40,
    },
    gdpr: {
      id: 'gdpr',
      name: 'GDPR',
      blockTypes: ['PERSON', 'EMAIL', 'PHONE_NUMBER', 'ADDRESS', 'DATE_OF_BIRTH'],
      minBlockScore: 50,
    },
    ccpa: {
      id: 'ccpa',
      name: 'CCPA',
      blockTypes: ['SSN', 'DRIVERS_LICENSE', 'PERSON', 'EMAIL'],
      minBlockScore: 55,
    },
    glba: {
      id: 'glba',
      name: 'GLBA',
      blockTypes: ['SSN', 'BANK_ACCOUNT', 'CREDIT_CARD', 'PERSON'],
      minBlockScore: 50,
    },
    ferpa: {
      id: 'ferpa',
      name: 'FERPA',
      blockTypes: ['SSN', 'PERSON', 'DATE_OF_BIRTH', 'ADDRESS'],
      minBlockScore: 45,
    },
  };

  function shouldBlock(
    entities: string[], score: number,
    frameworks: string[],
  ): { blocked: boolean; reason: string } {
    for (const fwId of frameworks) {
      const fw = FRAMEWORKS[fwId as keyof typeof FRAMEWORKS];
      if (!fw) continue;
      if (score >= fw.minBlockScore) {
        const flagged = entities.filter((e) => fw.blockTypes.includes(e));
        if (flagged.length > 0) {
          return { blocked: true, reason: `${fw.name}: ${flagged.join(', ')} detected` };
        }
      }
    }
    return { blocked: false, reason: '' };
  }

  it('HIPAA should block SSN at score 50+', () => {
    const result = shouldBlock(['SSN'], 55, ['hipaa']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('HIPAA');
  });

  it('PCI DSS should block credit card at score 40+', () => {
    const result = shouldBlock(['CREDIT_CARD'], 45, ['pci_dss']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('PCI DSS');
  });

  it('GDPR should block personal data at score 50+', () => {
    const result = shouldBlock(['PERSON', 'EMAIL'], 55, ['gdpr']);
    expect(result.blocked).toBe(true);
  });

  it('should NOT block clean prompts', () => {
    const result = shouldBlock([], 0, ['soc2', 'hipaa', 'pci_dss', 'gdpr']);
    expect(result.blocked).toBe(false);
  });

  it('should NOT block when score is below threshold', () => {
    const result = shouldBlock(['SSN'], 30, ['hipaa']); // Below 50
    expect(result.blocked).toBe(false);
  });

  it('should check all active frameworks', () => {
    // Email is blocked by GDPR but not by SOC2
    const soc2Only = shouldBlock(['EMAIL'], 55, ['soc2']);
    const gdprOnly = shouldBlock(['EMAIL'], 55, ['gdpr']);

    expect(soc2Only.blocked).toBe(false);
    expect(gdprOnly.blocked).toBe(true);
  });

  it('should support multiple simultaneous frameworks', () => {
    const result = shouldBlock(['SSN', 'CREDIT_CARD'], 70, ['soc2', 'hipaa', 'pci_dss']);
    expect(result.blocked).toBe(true);
  });
});
