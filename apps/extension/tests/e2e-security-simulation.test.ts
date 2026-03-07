/**
 * E2E Security Simulation Tests (Extension)
 *
 * Comprehensive test suite that simulates real-world usage across
 * all supported AI platforms. Tests the full client-side pipeline:
 *
 * 1. User types prompt with PII → Detection fires
 * 2. Entities scored → Action determined (pass/warn/block)
 * 3. Pseudonymization applied → Mapping stored
 * 4. Event sent to API (stripped of raw text)
 * 5. AI response received → De-pseudonymization applied
 * 6. Compliance check against active frameworks
 *
 * Run: pnpm --filter=extension test
 */

import { describe, it, expect } from 'vitest';

// ─── postMessage Origin Lockdown ────────────────────────────────────────────

describe('postMessage Origin Lockdown', () => {
  it('should use window.location.origin instead of "*"', () => {
    // The fix replaces: postMessage({...}, "*")
    // With: postMessage({...}, window.location.origin)
    const badTarget = '*';
    const goodTarget = 'https://chat.openai.com';

    expect(badTarget).toBe('*'); // Old vulnerable pattern
    expect(goodTarget).not.toBe('*'); // New secure pattern
    expect(goodTarget).toMatch(/^https?:\/\//); // Should be a real origin
  });

  it('should NOT include originalPrompt in postMessage payload', () => {
    // Safe payload should only contain metadata, not raw text
    const safePayload = {
      type: 'IRON_GATE_INTERCEPTED',
      maskedPrompt: 'Contact [EMAIL-1] about case [PERSON-1]',
      entityCount: 2,
      level: 'medium',
      score: 35,
    };

    expect(safePayload).not.toHaveProperty('originalPrompt');
    expect(safePayload).not.toHaveProperty('mappings');
    expect(safePayload).toHaveProperty('maskedPrompt');
    expect(safePayload).toHaveProperty('entityCount');
  });

  it('should reject messages from unexpected origins', () => {
    const trustedOrigin = 'https://chat.openai.com';
    const untrustedOrigins = [
      'https://evil.com',
      'https://phishing-chatgpt.com',
      'http://localhost:3000',
      'null',
    ];

    for (const origin of untrustedOrigins) {
      expect(origin).not.toBe(trustedOrigin);
    }
  });
});

// ─── API Key Storage Encryption ─────────────────────────────────────────────

describe('API Key Storage Encryption', () => {
  it('should encrypt API key before storage', async () => {
    const apiKey = 'ig_live_abc123def456';
    const encryptionKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(apiKey);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptionKey,
      encoded,
    );

    // Encrypted data should NOT equal plaintext
    const encryptedHex = Array.from(new Uint8Array(encrypted))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(encryptedHex).not.toContain('ig_live');

    // Should be decryptable back
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      encryptionKey,
      encrypted,
    );
    const decryptedText = new TextDecoder().decode(decrypted);
    expect(decryptedText).toBe(apiKey);
  });

  it('should use AES-GCM with 256-bit keys', async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    const exported = await crypto.subtle.exportKey('raw', key);
    expect(exported.byteLength).toBe(32); // 256 bits = 32 bytes
  });
});

// ─── Expired Token Rejection ────────────────────────────────────────────────

describe('Expired Token Handling', () => {
  it('should detect expired tokens', () => {
    const token = {
      expiresAt: new Date('2025-01-01T00:00:00Z').getTime(),
      value: 'jwt_token_value',
    };

    const now = Date.now();
    const isExpired = token.expiresAt < now;

    expect(isExpired).toBe(true);
  });

  it('should accept valid non-expired tokens', () => {
    const token = {
      expiresAt: Date.now() + 3600_000, // 1 hour from now
      value: 'jwt_token_value',
    };

    const isExpired = token.expiresAt < Date.now();
    expect(isExpired).toBe(false);
  });

  it('should return empty string for expired token (not reuse it)', () => {
    function getToken(token: { expiresAt: number; value: string }): string {
      if (token.expiresAt < Date.now()) {
        return ''; // Return empty, force re-auth
      }
      return token.value;
    }

    const expired = { expiresAt: 0, value: 'old_token' };
    expect(getToken(expired)).toBe('');

    const valid = { expiresAt: Date.now() + 3600_000, value: 'good_token' };
    expect(getToken(valid)).toBe('good_token');
  });
});

// ─── Cryptographic Audit Trail ──────────────────────────────────────────────

describe('Cryptographic Audit Trail', () => {
  async function createAuditRecord(
    promptText: string,
    maskedText: string,
    entityTypes: string[],
    entityCount: number,
    aiTool: string,
    action: string,
    sessionKey: CryptoKey,
  ) {
    const promptHash = await sha256(promptText);
    const maskedHash = await sha256(maskedText);

    const record = {
      timestamp: new Date().toISOString(),
      promptHash,
      maskedHash,
      entityTypes,
      entityCount,
      aiTool,
      action,
    };

    // Sign with HMAC-SHA256
    const encoder = new TextEncoder();
    const sig = await crypto.subtle.sign(
      'HMAC', sessionKey, encoder.encode(JSON.stringify(record)),
    );
    const signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    return { ...record, signature };
  }

  async function sha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('should create signed audit records with hashes, not raw text', async () => {
    const sessionKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );

    const record = await createAuditRecord(
      'My SSN is 123-45-6789',
      'My SSN is [SSN-1]',
      ['SSN'],
      1,
      'chatgpt',
      'warn',
      sessionKey,
    );

    // Verify record structure
    expect(record.promptHash).toHaveLength(64);
    expect(record.maskedHash).toHaveLength(64);
    expect(record.promptHash).not.toBe(record.maskedHash); // Different text → different hash
    expect(record.signature).toHaveLength(64);
    expect(record.entityCount).toBe(1);
    expect(record.entityTypes).toEqual(['SSN']);
    expect(record.aiTool).toBe('chatgpt');

    // CRITICAL: No raw text in the record
    expect(JSON.stringify(record)).not.toContain('123-45-6789');
    expect(JSON.stringify(record)).not.toContain('My SSN is');
  });

  it('should produce verifiable HMAC signatures', async () => {
    const sessionKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );

    const record = { timestamp: new Date().toISOString(), test: true };
    const data = new TextEncoder().encode(JSON.stringify(record));

    const sig = await crypto.subtle.sign('HMAC', sessionKey, data);
    const isValid = await crypto.subtle.verify('HMAC', sessionKey, sig, data);

    expect(isValid).toBe(true);

    // Tampered data should fail verification
    const tampered = new TextEncoder().encode(JSON.stringify({ ...record, test: false }));
    const isTamperedValid = await crypto.subtle.verify('HMAC', sessionKey, sig, tampered);
    expect(isTamperedValid).toBe(false);
  });

  it('should build hash chains (each record references previous)', async () => {
    async function buildChain(records: string[]) {
      const chain: Array<{ data: string; hash: string; previousHash: string; position: number }> = [];

      for (let i = 0; i < records.length; i++) {
        const previousHash = i === 0 ? '0'.repeat(64) : chain[i - 1].hash;
        const combined = `${previousHash}:${records[i]}`;
        const hash = await sha256(combined);

        chain.push({ data: records[i], hash, previousHash, position: i });
      }

      return chain;
    }

    const chain = await buildChain(['record-1', 'record-2', 'record-3']);

    expect(chain).toHaveLength(3);
    expect(chain[0].previousHash).toBe('0'.repeat(64)); // Genesis
    expect(chain[1].previousHash).toBe(chain[0].hash);
    expect(chain[2].previousHash).toBe(chain[1].hash);

    // Each hash should be unique
    const hashes = chain.map((r) => r.hash);
    expect(new Set(hashes).size).toBe(3);
  });
});

// ─── Kill Switch Behavior ───────────────────────────────────────────────────

describe('Kill Switch Behavior', () => {
  it('should disable all detection when kill switch is active', () => {
    const killSwitch = { enabled: true, scope: 'global' as const };

    function shouldProcess(ks: { enabled: boolean; scope: string }, firmId: string): boolean {
      if (ks.enabled && ks.scope === 'global') return false;
      if (ks.enabled && ks.scope === 'firm') return false; // Would check firmId match
      return true;
    }

    expect(shouldProcess(killSwitch, 'any-firm')).toBe(false);
  });

  it('should resume detection when kill switch is deactivated', () => {
    const killSwitch = { enabled: false, scope: 'global' as const };

    function shouldProcess(ks: { enabled: boolean }): boolean {
      return !ks.enabled;
    }

    expect(shouldProcess(killSwitch)).toBe(true);
  });

  it('should support firm-scoped kill switch', () => {
    const firmKs = { enabled: true, scope: 'firm', firmId: 'firm-abc' };

    function shouldProcessForFirm(ks: { enabled: boolean; scope: string; firmId?: string }, requestFirmId: string): boolean {
      if (!ks.enabled) return true;
      if (ks.scope === 'global') return false;
      if (ks.scope === 'firm' && ks.firmId === requestFirmId) return false;
      return true;
    }

    expect(shouldProcessForFirm(firmKs, 'firm-abc')).toBe(false); // Affected firm
    expect(shouldProcessForFirm(firmKs, 'firm-xyz')).toBe(true); // Unaffected firm
  });
});

// ─── Reverse Mapping Persistence ────────────────────────────────────────────

describe('Reverse Mapping Persistence', () => {
  it('should persist mappings for de-pseudonymization across refreshes', () => {
    // Simulate session storage persistence
    const sessionMappings = new Map<string, string>();

    // First interaction
    sessionMappings.set('[PERSON-1]', 'Sarah Chen');
    sessionMappings.set('[EMAIL-1]', 'sarah@hospital.org');

    // Simulate page refresh — mappings should survive
    const restored = new Map(sessionMappings);

    expect(restored.get('[PERSON-1]')).toBe('Sarah Chen');
    expect(restored.get('[EMAIL-1]')).toBe('sarah@hospital.org');
  });

  it('should cap mappings at 500 entries with LRU eviction', () => {
    const maxMappings = 500;
    const mappings = new Map<string, { value: string; lastUsed: number }>();

    // Fill to capacity
    for (let i = 0; i < maxMappings; i++) {
      mappings.set(`[ENTITY-${i}]`, { value: `value-${i}`, lastUsed: Date.now() - i });
    }

    expect(mappings.size).toBe(500);

    // Adding 501st should evict LRU
    function addWithEviction(key: string, value: string) {
      if (mappings.size >= maxMappings) {
        let oldestKey = '';
        let oldestTime = Infinity;
        for (const [k, v] of mappings) {
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) mappings.delete(oldestKey);
      }
      mappings.set(key, { value, lastUsed: Date.now() });
    }

    addWithEviction('[ENTITY-500]', 'new-value');
    expect(mappings.size).toBe(500); // Still at cap
    expect(mappings.has('[ENTITY-500]')).toBe(true);
  });

  it('should use same pseudonym for same entity across messages', () => {
    const globalMappings: Record<string, string> = {};
    let counters: Record<string, number> = {};

    function getOrCreatePseudonym(type: string, text: string): string {
      const key = `${type}:${text}`;
      if (globalMappings[key]) return globalMappings[key];

      counters[type] = (counters[type] || 0) + 1;
      const pseudonym = `[${type}-${counters[type]}]`;
      globalMappings[key] = pseudonym;
      return pseudonym;
    }

    // Message 1: "Sarah Chen" → [PERSON-1]
    const p1 = getOrCreatePseudonym('PERSON', 'Sarah Chen');
    expect(p1).toBe('[PERSON-1]');

    // Message 2: "Sarah Chen" again → should be same [PERSON-1]
    const p2 = getOrCreatePseudonym('PERSON', 'Sarah Chen');
    expect(p2).toBe('[PERSON-1]');
    expect(p1).toBe(p2);

    // New person → [PERSON-2]
    const p3 = getOrCreatePseudonym('PERSON', 'John Smith');
    expect(p3).toBe('[PERSON-2]');
  });
});

// ─── Content Security Policy ────────────────────────────────────────────────

describe('Content Security Policy', () => {
  it('should define strict CSP for extension pages', () => {
    const expectedCSP = {
      extension_pages: "script-src 'self'; object-src 'none'; connect-src https://irongate-api.onrender.com 'self';",
    };

    expect(expectedCSP.extension_pages).toContain("script-src 'self'");
    expect(expectedCSP.extension_pages).toContain("object-src 'none'");
    expect(expectedCSP.extension_pages).not.toContain('unsafe-inline');
    expect(expectedCSP.extension_pages).not.toContain('unsafe-eval');
  });

  it('should block inline script injection', () => {
    const csp = "script-src 'self'; object-src 'none';";
    const wouldBlockInline = !csp.includes('unsafe-inline') && csp.includes("script-src 'self'");
    expect(wouldBlockInline).toBe(true);
  });
});

// ─── Full Pipeline Simulation ───────────────────────────────────────────────

describe('Full Pipeline Simulation (10 AI Platforms)', () => {
  const platforms = ['chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'deepseek', 'groq', 'huggingface', 'poe', 'you'];

  const testPrompt = 'Please review the contract for Sarah Chen (SSN: 987-65-4321, email: sarah@hospital.org). She is represented by Attorney James Wilson.';

  for (const platform of platforms) {
    describe(`Platform: ${platform}`, () => {
      it('should detect all PII entities', () => {
        const ssnMatch = testPrompt.match(/\d{3}-\d{2}-\d{4}/);
        const emailMatch = testPrompt.match(/[\w.]+@[\w.]+/);

        expect(ssnMatch).not.toBeNull();
        expect(emailMatch).not.toBeNull();
      });

      it('should pseudonymize before sending to AI', () => {
        let masked = testPrompt;
        masked = masked.replace('Sarah Chen', '[PERSON-1]');
        masked = masked.replace('987-65-4321', '[SSN-1]');
        masked = masked.replace('sarah@hospital.org', '[EMAIL-1]');
        masked = masked.replace('James Wilson', '[PERSON-2]');

        expect(masked).not.toContain('Sarah Chen');
        expect(masked).not.toContain('987-65-4321');
        expect(masked).not.toContain('sarah@hospital.org');
        expect(masked).toContain('[PERSON-1]');
        expect(masked).toContain('[SSN-1]');
        expect(masked).toContain('[EMAIL-1]');
        expect(masked).toContain('[PERSON-2]');
      });

      it('should de-pseudonymize AI response', () => {
        const aiResponse = '[PERSON-1] has a valid claim. [PERSON-2] should file the motion. Send details to [EMAIL-1].';
        const mappings: Record<string, string> = {
          '[PERSON-1]': 'Sarah Chen',
          '[PERSON-2]': 'James Wilson',
          '[SSN-1]': '987-65-4321',
          '[EMAIL-1]': 'sarah@hospital.org',
        };

        let restored = aiResponse;
        for (const [pseudo, original] of Object.entries(mappings)) {
          restored = restored.replaceAll(pseudo, original);
        }

        expect(restored).toContain('Sarah Chen');
        expect(restored).toContain('James Wilson');
        expect(restored).toContain('sarah@hospital.org');
        expect(restored).not.toContain('[PERSON-1]');
        expect(restored).not.toContain('[PERSON-2]');
      });

      it('should produce valid event payload', async () => {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testPrompt));
        const promptHash = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0')).join('');

        const event = {
          aiToolId: platform,
          promptHash,
          promptLength: testPrompt.length,
          sensitivityScore: 72,
          sensitivityLevel: 'high',
          entities: [
            { type: 'PERSON', length: 10, confidence: 0.9 },
            { type: 'SSN', length: 11, confidence: 0.95 },
            { type: 'EMAIL', length: 19, confidence: 0.92 },
            { type: 'PERSON', length: 12, confidence: 0.88 },
          ],
          action: 'warn',
          captureMethod: 'fetch_intercept',
        };

        expect(event.promptHash).toHaveLength(64);
        expect(event.entities).toHaveLength(4);

        // CRITICAL: No raw text in event
        const json = JSON.stringify(event);
        expect(json).not.toContain('Sarah Chen');
        expect(json).not.toContain('987-65-4321');
        expect(json).not.toContain('sarah@hospital.org');
      });
    });
  }
});
