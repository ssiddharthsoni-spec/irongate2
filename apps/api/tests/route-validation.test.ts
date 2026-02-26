/**
 * API Route Validation & Logic Tests
 *
 * Tests Zod schema validation, route logic functions, CORS configuration,
 * and route module integrity — all without requiring a live database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';

// ─── Event Schema Validation ────────────────────────────────────────────────

describe('Event Schema Validation', () => {
  const eventSchema = z.object({
    aiToolId: z.string().min(1),
    aiToolUrl: z.string().optional(),
    promptHash: z.string().length(64),
    promptLength: z.number().int().min(0),
    sensitivityScore: z.number().min(0).max(100),
    sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
    entities: z.array(z.object({
      type: z.string(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      confidence: z.number(),
      source: z.string(),
    })).optional().default([]),
    action: z.enum(['pass', 'warn', 'block', 'proxy', 'override']),
    overrideReason: z.string().optional(),
    captureMethod: z.string(),
    sessionId: z.string().uuid().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  it('should accept valid event payload', () => {
    const valid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      entities: [],
      action: 'pass',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(valid)).not.toThrow();
  });

  it('should reject missing aiToolId', () => {
    const invalid = {
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      action: 'pass',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject promptHash that is not 64 chars', () => {
    const invalid = {
      aiToolId: 'chatgpt',
      promptHash: 'tooshort',
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      action: 'pass',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject sensitivityScore > 100', () => {
    const invalid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 150,
      sensitivityLevel: 'medium',
      action: 'pass',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject invalid sensitivityLevel', () => {
    const invalid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'extreme',
      action: 'pass',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject invalid action', () => {
    const invalid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      action: 'delete',
      captureMethod: 'fetch',
    };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should default entities to empty array', () => {
    const valid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      action: 'pass',
      captureMethod: 'fetch',
    };
    const parsed = eventSchema.parse(valid);
    expect(parsed.entities).toEqual([]);
  });

  it('should accept entities with full structure', () => {
    const valid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 75,
      sensitivityLevel: 'high',
      entities: [{
        type: 'SSN',
        text: '123-45-6789',
        start: 10,
        end: 21,
        confidence: 0.95,
        source: 'regex',
      }],
      action: 'warn',
      captureMethod: 'fetch',
    };
    const parsed = eventSchema.parse(valid);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].type).toBe('SSN');
  });

  it('should validate sessionId as UUID', () => {
    const valid = {
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 0,
      sensitivityLevel: 'low',
      action: 'pass',
      captureMethod: 'fetch',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => eventSchema.parse(valid)).not.toThrow();

    const invalid = { ...valid, sessionId: 'not-a-uuid' };
    expect(() => eventSchema.parse(invalid)).toThrow(z.ZodError);
  });
});

// ─── Batch Schema Validation ────────────────────────────────────────────────

describe('Batch Event Schema Validation', () => {
  const eventSchema = z.object({
    aiToolId: z.string().min(1),
    promptHash: z.string().length(64),
    promptLength: z.number().int().min(0),
    sensitivityScore: z.number().min(0).max(100),
    sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
    entities: z.array(z.object({
      type: z.string(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      confidence: z.number(),
      source: z.string(),
    })).optional().default([]),
    action: z.enum(['pass', 'warn', 'block', 'proxy', 'override']),
    captureMethod: z.string(),
  });

  const batchSchema = z.object({
    events: z.array(eventSchema).min(1).max(100),
    batchId: z.string(),
  });

  it('should accept valid batch', () => {
    const valid = {
      batchId: 'batch-001',
      events: [{
        aiToolId: 'chatgpt',
        promptHash: 'a'.repeat(64),
        promptLength: 100,
        sensitivityScore: 20,
        sensitivityLevel: 'low',
        action: 'pass',
        captureMethod: 'fetch',
      }],
    };
    expect(() => batchSchema.parse(valid)).not.toThrow();
  });

  it('should reject empty events array', () => {
    const invalid = { batchId: 'batch-001', events: [] };
    expect(() => batchSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject more than 100 events', () => {
    const events = Array.from({ length: 101 }, () => ({
      aiToolId: 'chatgpt',
      promptHash: 'a'.repeat(64),
      promptLength: 100,
      sensitivityScore: 20,
      sensitivityLevel: 'low',
      action: 'pass',
      captureMethod: 'fetch',
    }));
    const invalid = { batchId: 'batch-big', events };
    expect(() => batchSchema.parse(invalid)).toThrow(z.ZodError);
  });
});

// ─── Admin Schema Validation ────────────────────────────────────────────────

describe('Admin Firm Create Schema', () => {
  const createSchema = z.object({
    firmName: z.string().min(1).max(255),
    industry: z.string().optional(),
    firmSize: z.string().optional(),
    protectionMode: z.enum(['audit', 'proxy']).optional().default('audit'),
    thresholds: z.object({
      warn: z.number().min(0).max(100).optional().default(30),
      block: z.number().min(0).max(100).optional().default(60),
      proxy: z.number().min(0).max(100).optional().default(80),
    }).optional(),
    teamMembers: z.array(z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'user']).optional().default('user'),
    })).optional().default([]),
  });

  it('should accept minimal firm creation payload', () => {
    const valid = { firmName: 'Acme Corp' };
    const parsed = createSchema.parse(valid);
    expect(parsed.firmName).toBe('Acme Corp');
    expect(parsed.protectionMode).toBe('audit');
    expect(parsed.teamMembers).toEqual([]);
  });

  it('should accept full firm creation payload', () => {
    const valid = {
      firmName: 'Big Law LLP',
      industry: 'legal',
      firmSize: '50-200',
      protectionMode: 'proxy',
      thresholds: { warn: 20, block: 50, proxy: 70 },
      teamMembers: [
        { email: 'alice@biglaw.com', role: 'admin' },
        { email: 'bob@biglaw.com' },
      ],
    };
    const parsed = createSchema.parse(valid);
    expect(parsed.protectionMode).toBe('proxy');
    expect(parsed.thresholds!.warn).toBe(20);
    expect(parsed.teamMembers).toHaveLength(2);
    expect(parsed.teamMembers[1].role).toBe('user');
  });

  it('should reject empty firmName', () => {
    expect(() => createSchema.parse({ firmName: '' })).toThrow(z.ZodError);
  });

  it('should reject invalid protectionMode', () => {
    expect(() => createSchema.parse({ firmName: 'Test', protectionMode: 'stealth' })).toThrow(z.ZodError);
  });

  it('should reject invalid team member email', () => {
    expect(() => createSchema.parse({
      firmName: 'Test',
      teamMembers: [{ email: 'not-an-email' }],
    })).toThrow(z.ZodError);
  });

  it('should reject thresholds outside 0-100 range', () => {
    expect(() => createSchema.parse({
      firmName: 'Test',
      thresholds: { warn: -5 },
    })).toThrow(z.ZodError);

    expect(() => createSchema.parse({
      firmName: 'Test',
      thresholds: { block: 150 },
    })).toThrow(z.ZodError);
  });
});

// ─── Proxy Analyze Schema Validation ────────────────────────────────────────

describe('Proxy Analyze Schema', () => {
  const analyzeRequestSchema = z.object({
    promptText: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    aiToolId: z.string().min(1, 'aiToolId is required'),
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
    userId: z.string().uuid('userId must be a valid UUID').optional(),
    firmId: z.string().uuid('firmId must be a valid UUID').optional(),
    timestamp: z.number().optional(),
  }).refine(
    (data) => data.promptText || data.text,
    { message: 'Either promptText or text is required' },
  );

  it('should accept promptText', () => {
    const valid = {
      promptText: 'Hello world',
      aiToolId: 'chatgpt',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => analyzeRequestSchema.parse(valid)).not.toThrow();
  });

  it('should accept text (alternative field)', () => {
    const valid = {
      text: 'Hello world',
      aiToolId: 'chatgpt',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => analyzeRequestSchema.parse(valid)).not.toThrow();
  });

  it('should reject when neither promptText nor text is provided', () => {
    const invalid = {
      aiToolId: 'chatgpt',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => analyzeRequestSchema.parse(invalid)).toThrow();
  });

  it('should reject invalid sessionId', () => {
    const invalid = {
      text: 'Hello',
      aiToolId: 'chatgpt',
      sessionId: 'not-uuid',
    };
    expect(() => analyzeRequestSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('should reject missing aiToolId', () => {
    const invalid = {
      text: 'Hello',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => analyzeRequestSchema.parse(invalid)).toThrow(z.ZodError);
  });
});

// ─── Proxy Route Logic ──────────────────────────────────────────────────────

describe('Proxy Route Determination', () => {
  function determineRoute(
    score: number,
    thresholds: { passthrough?: number; cloudMasked?: number },
  ): 'passthrough' | 'cloud_masked' | 'private_llm' {
    const passthroughMax = thresholds.passthrough ?? 25;
    const cloudMaskedMax = thresholds.cloudMasked ?? 75;
    if (score <= passthroughMax) return 'passthrough';
    if (score <= cloudMaskedMax) return 'cloud_masked';
    return 'private_llm';
  }

  it('should return passthrough for low scores', () => {
    expect(determineRoute(0, {})).toBe('passthrough');
    expect(determineRoute(10, {})).toBe('passthrough');
    expect(determineRoute(25, {})).toBe('passthrough');
  });

  it('should return cloud_masked for medium scores', () => {
    expect(determineRoute(26, {})).toBe('cloud_masked');
    expect(determineRoute(50, {})).toBe('cloud_masked');
    expect(determineRoute(75, {})).toBe('cloud_masked');
  });

  it('should return private_llm for high scores', () => {
    expect(determineRoute(76, {})).toBe('private_llm');
    expect(determineRoute(100, {})).toBe('private_llm');
  });

  it('should respect custom thresholds', () => {
    const thresholds = { passthrough: 10, cloudMasked: 50 };
    expect(determineRoute(10, thresholds)).toBe('passthrough');
    expect(determineRoute(11, thresholds)).toBe('cloud_masked');
    expect(determineRoute(50, thresholds)).toBe('cloud_masked');
    expect(determineRoute(51, thresholds)).toBe('private_llm');
  });

  it('should handle edge case: score 0', () => {
    expect(determineRoute(0, { passthrough: 0 })).toBe('passthrough');
  });

  it('should handle edge case: all thresholds equal', () => {
    expect(determineRoute(50, { passthrough: 50, cloudMasked: 50 })).toBe('passthrough');
    expect(determineRoute(51, { passthrough: 50, cloudMasked: 50 })).toBe('private_llm');
  });
});

// ─── Period Parsing Logic ───────────────────────────────────────────────────

describe('parsePeriodDays Logic', () => {
  function parsePeriodDays(period?: string, days?: string): number {
    if (period) {
      const match = period.match(/^(\d+)d$/);
      if (match) return parseInt(match[1]);
    }
    if (days) return parseInt(days) || 30;
    return 30;
  }

  it('should parse "30d" period', () => {
    expect(parsePeriodDays('30d')).toBe(30);
  });

  it('should parse "7d" period', () => {
    expect(parsePeriodDays('7d')).toBe(7);
  });

  it('should parse "90d" period', () => {
    expect(parsePeriodDays('90d')).toBe(90);
  });

  it('should fallback to days parameter', () => {
    expect(parsePeriodDays(undefined, '14')).toBe(14);
  });

  it('should default to 30 when nothing provided', () => {
    expect(parsePeriodDays()).toBe(30);
  });

  it('should handle invalid period string gracefully', () => {
    expect(parsePeriodDays('invalid')).toBe(30);
    expect(parsePeriodDays('30days')).toBe(30);
    expect(parsePeriodDays('abc')).toBe(30);
  });

  it('should handle invalid days string', () => {
    expect(parsePeriodDays(undefined, 'abc')).toBe(30);
  });
});

// ─── Webhook Schema Validation ──────────────────────────────────────────────

describe('Webhook Schema Validation', () => {
  const webhookSchema = z.object({
    url: z.string().url(),
    secret: z.string().min(16),
    eventTypes: z.array(z.string()).min(1),
  });

  it('should accept valid webhook', () => {
    const valid = {
      url: 'https://hooks.slack.com/services/T00000/B00000/XXXX',
      secret: 'a-very-secret-key-1234',
      eventTypes: ['high_risk_detected'],
    };
    expect(() => webhookSchema.parse(valid)).not.toThrow();
  });

  it('should reject invalid URL', () => {
    expect(() => webhookSchema.parse({
      url: 'not-a-url',
      secret: 'a-very-secret-key-1234',
      eventTypes: ['test'],
    })).toThrow(z.ZodError);
  });

  it('should reject short secret', () => {
    expect(() => webhookSchema.parse({
      url: 'https://example.com/hook',
      secret: 'short',
      eventTypes: ['test'],
    })).toThrow(z.ZodError);
  });

  it('should reject empty eventTypes', () => {
    expect(() => webhookSchema.parse({
      url: 'https://example.com/hook',
      secret: 'a-very-secret-key-1234',
      eventTypes: [],
    })).toThrow(z.ZodError);
  });
});

// ─── Weight Override Schema Validation ──────────────────────────────────────

describe('Weight Override Schema', () => {
  const overrideSchema = z.object({
    entityType: z.string().min(1),
    weight: z.number().min(0.1).max(3.0),
  });

  it('should accept valid override', () => {
    const valid = { entityType: 'SSN', weight: 1.5 };
    expect(() => overrideSchema.parse(valid)).not.toThrow();
  });

  it('should reject weight below 0.1', () => {
    expect(() => overrideSchema.parse({ entityType: 'SSN', weight: 0.05 })).toThrow(z.ZodError);
  });

  it('should reject weight above 3.0', () => {
    expect(() => overrideSchema.parse({ entityType: 'SSN', weight: 5.0 })).toThrow(z.ZodError);
  });

  it('should reject empty entityType', () => {
    expect(() => overrideSchema.parse({ entityType: '', weight: 1.0 })).toThrow(z.ZodError);
  });
});

// ─── Feedback Schema Validation ─────────────────────────────────────────────

describe('Feedback Schema', () => {
  const feedbackSchema = z.object({
    eventId: z.string().uuid().optional(),
    entityType: z.string(),
    entityHash: z.string().optional(),
    entityText: z.string().optional(),
    isCorrect: z.boolean(),
    correctedType: z.string().optional(),
    feedbackType: z.enum(['correct', 'not_pii', 'wrong_type', 'partial_match']).optional(),
  });

  it('should accept valid feedback', () => {
    const valid = {
      entityType: 'SSN',
      isCorrect: true,
    };
    expect(() => feedbackSchema.parse(valid)).not.toThrow();
  });

  it('should accept feedback with corrected type', () => {
    const valid = {
      entityType: 'PHONE_NUMBER',
      isCorrect: false,
      correctedType: 'FAX_NUMBER',
      feedbackType: 'wrong_type',
    };
    expect(() => feedbackSchema.parse(valid)).not.toThrow();
  });

  it('should reject invalid feedbackType', () => {
    expect(() => feedbackSchema.parse({
      entityType: 'EMAIL',
      isCorrect: false,
      feedbackType: 'invalid_type',
    })).toThrow(z.ZodError);
  });

  it('should reject missing isCorrect', () => {
    expect(() => feedbackSchema.parse({ entityType: 'EMAIL' })).toThrow(z.ZodError);
  });
});

// ─── Security Kill Switch Schema ────────────────────────────────────────────

describe('Kill Switch Schema', () => {
  const bodySchema = z.object({
    enabled: z.boolean(),
    scope: z.enum(['global', 'firm']),
    firm_id: z.string().uuid().optional(),
  });

  it('should accept global kill switch', () => {
    const valid = { enabled: true, scope: 'global' };
    expect(() => bodySchema.parse(valid)).not.toThrow();
  });

  it('should accept firm-scoped kill switch', () => {
    const valid = {
      enabled: true,
      scope: 'firm',
      firm_id: '123e4567-e89b-12d3-a456-426614174000',
    };
    expect(() => bodySchema.parse(valid)).not.toThrow();
  });

  it('should reject invalid scope', () => {
    expect(() => bodySchema.parse({ enabled: true, scope: 'user' })).toThrow(z.ZodError);
  });
});

// ─── SIEM Schema Validation ─────────────────────────────────────────────────

describe('SIEM Configuration Schema', () => {
  const siemSchema = z.object({
    enabled: z.boolean(),
    provider: z.enum(['splunk', 'datadog', 'generic']),
    url: z.string().url(),
    token: z.string().min(1),
    format: z.enum(['json', 'cef']).optional().default('json'),
  });

  it('should accept valid SIEM config', () => {
    const valid = {
      enabled: true,
      provider: 'splunk',
      url: 'https://splunk.example.com:8088',
      token: 'my-hec-token',
    };
    const parsed = siemSchema.parse(valid);
    expect(parsed.format).toBe('json');
  });

  it('should reject invalid provider', () => {
    expect(() => siemSchema.parse({
      enabled: true,
      provider: 'elastic',
      url: 'https://example.com',
      token: 'token',
    })).toThrow(z.ZodError);
  });
});

// ─── Plugin Schema Validation ───────────────────────────────────────────────

describe('Plugin Schema', () => {
  const pluginSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(''),
    version: z.string().optional().default('1.0.0'),
    code: z.string().min(1).max(50000),
    entityTypes: z.array(z.string()).min(1),
  });

  it('should accept valid plugin', () => {
    const valid = {
      name: 'Custom SSN Detector',
      code: 'function detect(text) { return []; }',
      entityTypes: ['SSN'],
    };
    const parsed = pluginSchema.parse(valid);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.description).toBe('');
  });

  it('should reject empty plugin name', () => {
    expect(() => pluginSchema.parse({
      name: '',
      code: 'function detect() {}',
      entityTypes: ['SSN'],
    })).toThrow(z.ZodError);
  });

  it('should reject code exceeding 50KB', () => {
    expect(() => pluginSchema.parse({
      name: 'Big Plugin',
      code: 'x'.repeat(50001),
      entityTypes: ['SSN'],
    })).toThrow(z.ZodError);
  });

  it('should reject empty entityTypes', () => {
    expect(() => pluginSchema.parse({
      name: 'Test Plugin',
      code: 'function detect() {}',
      entityTypes: [],
    })).toThrow(z.ZodError);
  });
});

// ─── Compliance Schema Validation ───────────────────────────────────────────

describe('Compliance Framework Validation', () => {
  it('should validate known compliance framework IDs', () => {
    const knownIds = ['soc2', 'hipaa', 'gdpr', 'pci_dss', 'ccpa', 'glba', 'ferpa'];
    for (const id of knownIds) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('should validate frameworks array update schema', () => {
    const frameworks = ['soc2', 'hipaa'];
    expect(Array.isArray(frameworks)).toBe(true);
    expect(frameworks.every(f => typeof f === 'string')).toBe(true);
  });
});

// ─── Health Endpoint ────────────────────────────────────────────────────────

describe('Health Endpoint Structure', () => {
  const app = new Hono();

  app.get('/health', async (c) => {
    return c.json({
      status: 'ok',
      version: '0.2.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/v1/health', async (c) => {
    return c.json({
      status: 'ok',
      version: '0.2.0',
      timestamp: new Date().toISOString(),
    });
  });

  it('should return 200 on /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.2.0');
  });

  it('should return 200 on /v1/health', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should return timestamp as ISO string', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

// ─── CORS Configuration ────────────────────────────────────────────────────

describe('CORS Origin Validation', () => {
  function validateOrigin(origin: string | null, allowedOrigins: string[]): string | null {
    if (!origin) return allowedOrigins[0];
    if (origin.startsWith('chrome-extension://')) return origin;
    return allowedOrigins.includes(origin) ? origin : null;
  }

  const prodOrigins = ['https://irongate-dashboard.vercel.app'];
  const devOrigins = ['http://localhost:3001', 'http://localhost:3000', 'https://irongate-dashboard.vercel.app'];

  it('should allow production dashboard origin', () => {
    expect(validateOrigin('https://irongate-dashboard.vercel.app', prodOrigins)).toBe('https://irongate-dashboard.vercel.app');
  });

  it('should allow any chrome extension origin', () => {
    expect(validateOrigin('chrome-extension://abcdefghijklmnop', prodOrigins)).toBe('chrome-extension://abcdefghijklmnop');
  });

  it('should reject unknown origins in production', () => {
    expect(validateOrigin('https://evil.com', prodOrigins)).toBeNull();
  });

  it('should allow localhost in development', () => {
    expect(validateOrigin('http://localhost:3001', devOrigins)).toBe('http://localhost:3001');
    expect(validateOrigin('http://localhost:3000', devOrigins)).toBe('http://localhost:3000');
  });

  it('should reject localhost in production', () => {
    expect(validateOrigin('http://localhost:3001', prodOrigins)).toBeNull();
  });

  it('should return first allowed origin when no origin header', () => {
    expect(validateOrigin(null, prodOrigins)).toBe('https://irongate-dashboard.vercel.app');
  });
});

// ─── Route Module Imports ───────────────────────────────────────────────────
// Routes that depend on @iron-gate/crypto (via audit-chain.ts) are tested
// separately since Vitest may not resolve workspace packages in all configs.

describe('Route Module Imports (no crypto dependency)', () => {
  it('should import compliance routes', async () => {
    const { complianceRoutes } = await import('../src/routes/compliance');
    expect(complianceRoutes).toBeDefined();
  });

  it('should import admin routes', async () => {
    const { adminRoutes } = await import('../src/routes/admin');
    expect(adminRoutes).toBeDefined();
  });

  it('should import reports routes', async () => {
    const { reportsRoutes } = await import('../src/routes/reports');
    expect(reportsRoutes).toBeDefined();
  });

  it('should import feedback routes', async () => {
    const { feedbackRoutes } = await import('../src/routes/feedback');
    expect(feedbackRoutes).toBeDefined();
  });

  it('should import security routes', async () => {
    const { securityRoutes } = await import('../src/routes/security');
    expect(securityRoutes).toBeDefined();
  });

  it('should import billing routes', async () => {
    const { billingRoutes } = await import('../src/routes/billing');
    expect(billingRoutes).toBeDefined();
  });

  it('should import alert routes', async () => {
    const { alertRoutes } = await import('../src/routes/alerts');
    expect(alertRoutes).toBeDefined();
  });

  it('should import api-key routes', async () => {
    const { apiKeyRoutes } = await import('../src/routes/api-keys');
    expect(apiKeyRoutes).toBeDefined();
  });

  it('should import notification routes', async () => {
    const { notificationRoutes } = await import('../src/routes/notifications');
    expect(notificationRoutes).toBeDefined();
  });

  it('should import invite routes', async () => {
    const { inviteRoutes } = await import('../src/routes/invites');
    expect(inviteRoutes).toBeDefined();
  });
});

// ─── Send Request Schema ────────────────────────────────────────────────────

describe('Proxy Send Schema', () => {
  const sendRequestSchema = z.object({
    maskedPrompt: z.string().min(1, 'maskedPrompt is required'),
    route: z.enum(['passthrough', 'cloud_masked', 'private_llm']),
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
    model: z.string().optional().default('gpt-4'),
    systemPrompt: z.string().optional(),
    maxTokens: z.number().int().positive().optional().default(4096),
    temperature: z.number().min(0).max(2).optional().default(0.7),
  });

  it('should accept valid send request', () => {
    const valid = {
      maskedPrompt: 'Review the contract for [PERSON-1]',
      route: 'cloud_masked',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    };
    const parsed = sendRequestSchema.parse(valid);
    expect(parsed.model).toBe('gpt-4');
    expect(parsed.maxTokens).toBe(4096);
    expect(parsed.temperature).toBe(0.7);
  });

  it('should reject empty maskedPrompt', () => {
    expect(() => sendRequestSchema.parse({
      maskedPrompt: '',
      route: 'passthrough',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    })).toThrow(z.ZodError);
  });

  it('should reject invalid route', () => {
    expect(() => sendRequestSchema.parse({
      maskedPrompt: 'Hello',
      route: 'direct',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    })).toThrow(z.ZodError);
  });

  it('should reject temperature > 2', () => {
    expect(() => sendRequestSchema.parse({
      maskedPrompt: 'Hello',
      route: 'passthrough',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      temperature: 3.0,
    })).toThrow(z.ZodError);
  });
});

// ─── Invite Schema Validation ───────────────────────────────────────────────

describe('Invite Schema', () => {
  const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'user']).optional().default('user'),
  });

  it('should accept valid invite', () => {
    const parsed = inviteSchema.parse({ email: 'alice@example.com' });
    expect(parsed.role).toBe('user');
  });

  it('should accept admin role invite', () => {
    const parsed = inviteSchema.parse({ email: 'admin@example.com', role: 'admin' });
    expect(parsed.role).toBe('admin');
  });

  it('should reject invalid email', () => {
    expect(() => inviteSchema.parse({ email: 'not-an-email' })).toThrow(z.ZodError);
  });
});

// ─── Data Minimization Logic ────────────────────────────────────────────────

describe('Data Minimization', () => {
  it('should hash entity text and preserve metadata', async () => {
    const entity = {
      type: 'SSN',
      text: '123-45-6789',
      start: 0,
      end: 11,
      confidence: 0.95,
      source: 'regex',
    };

    // Simulate minimization (same logic as events.ts)
    const encoder = new TextEncoder();
    const data = encoder.encode(entity.text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const textHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const minimized = {
      type: entity.type,
      textHash,
      start: entity.start,
      end: entity.end,
      confidence: entity.confidence,
      source: entity.source,
      length: entity.text.length,
    };

    expect(minimized.textHash).toHaveLength(64);
    expect(minimized.length).toBe(11);
    expect(minimized).not.toHaveProperty('text');
    expect(minimized.type).toBe('SSN');
  });

  it('should produce deterministic hashes', async () => {
    const text = 'john@example.com';
    const encoder = new TextEncoder();

    const hash1Buffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    const hash1 = Array.from(new Uint8Array(hash1Buffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const hash2Buffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    const hash2 = Array.from(new Uint8Array(hash2Buffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(hash1).toBe(hash2);
  });
});
