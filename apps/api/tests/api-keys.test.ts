import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('API Key Generation', () => {
  function generateApiKey() {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const key = `ig_${randomBytes}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const prefix = key.substring(0, 12);
    return { key, hash, prefix };
  }

  it('should generate keys with ig_ prefix', () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^ig_[a-f0-9]{64}$/);
  });

  it('should generate unique keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.key).not.toBe(key2.key);
    expect(key1.hash).not.toBe(key2.hash);
  });

  it('should generate 12-char prefix', () => {
    const { prefix } = generateApiKey();
    expect(prefix).toHaveLength(12);
    expect(prefix).toMatch(/^ig_[a-f0-9]{9}$/);
  });

  it('should generate deterministic hash from key', () => {
    const { key, hash } = generateApiKey();
    const recomputed = crypto.createHash('sha256').update(key).digest('hex');
    expect(hash).toBe(recomputed);
  });

  it('should generate 64-char hex hash', () => {
    const { hash } = generateApiKey();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
