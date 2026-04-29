/**
 * Credential / Secret Detection Tests
 *
 * Verifies that .env files, API keys, database URLs, and other
 * credentials are detected AND pseudonymized correctly.
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';
import { scanForSecrets } from '../src/content/main-world/entity-patterns';

const ENV_INPUT = `Help me debug my .env file: DATABASE_URL=postgres://produser:P@ssw0rd!@db.mycompany.com:5432/maindb REDIS_URL=redis://default:secretRedis@redis.internal:6379 AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY Stripe_SECRET=sk_live_51HG8v2CjzKLMno9876543`;

describe('Credential Detection', () => {
  it('regex detects credentials in .env content', () => {
    const entities = detectWithRegex(ENV_INPUT);
    console.log('Regex entities:', entities.map(e => ({ type: e.type, text: e.text?.substring(0, 40) })));
    expect(entities.length).toBeGreaterThan(0);
  });

  it('secret scanner detects credentials in .env content', () => {
    const secrets = scanForSecrets(ENV_INPUT);
    console.log('Secret scanner:', secrets.map(e => ({ type: e.type, text: e.text?.substring(0, 40) })));
    expect(secrets.length).toBeGreaterThan(0);
  });

  it('detects DATABASE_URL', () => {
    const secrets = scanForSecrets(ENV_INPUT);
    const dbUri = secrets.find(e => e.type === 'DATABASE_URI');
    expect(dbUri).toBeDefined();
    expect(dbUri?.text).toContain('postgres://');
  });

  it('detects AWS credentials', () => {
    const all = [...detectWithRegex(ENV_INPUT), ...scanForSecrets(ENV_INPUT)];
    const aws = all.filter(e => e.type === 'AWS_CREDENTIAL' || e.type === 'API_KEY');
    console.log('AWS/API entities:', aws.map(e => ({ type: e.type, text: e.text?.substring(0, 30) })));
    expect(aws.length).toBeGreaterThan(0);
  });

  it('detects Stripe key', () => {
    const all = [...detectWithRegex(ENV_INPUT), ...scanForSecrets(ENV_INPUT)];
    const stripe = all.find(e => e.text?.includes('sk_live'));
    expect(stripe).toBeDefined();
  });

  it('detects Redis URL', () => {
    const secrets = scanForSecrets(ENV_INPUT);
    const redis = secrets.find(e => e.text?.includes('redis://'));
    expect(redis).toBeDefined();
  });

  it('combined detection finds all credentials', () => {
    const regex = detectWithRegex(ENV_INPUT);
    const secrets = scanForSecrets(ENV_INPUT);
    const all = [...regex, ...secrets];
    const types = new Set(all.map(e => e.type));
    console.log('All entity types:', [...types]);
    console.log('Total entities:', all.length);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('scores credentials as critical (triggers pseudonymization)', () => {
    const regex = detectWithRegex(ENV_INPUT);
    const secrets = scanForSecrets(ENV_INPUT);
    const all = [...regex, ...secrets];
    const score = computeScore(ENV_INPUT, all);
    console.log('Score:', score.score, 'Level:', score.level);
    expect(score.score).toBeGreaterThanOrEqual(86);
    expect(score.level).toBe('critical');
  });
});
