/**
 * WP5: Option C core — length-preserving tokenization. The invariant that
 * makes wire de-pseudo safe on offset-annotated platforms: every fake has
 * the SAME byte length as its original, per name part.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  lengthPreservingFake,
  isLengthSafe,
  _resetLengthPreservingSession,
} from '../src/detection/length-preserving';

const byteLen = (s: string) => new TextEncoder().encode(s).length;

beforeEach(() => _resetLengthPreservingSession());

describe('length-preserving tokenization (Option C core)', () => {
  it('INVARIANT: byte length is preserved for every supported type', () => {
    const cases: Array<[string, string]> = [
      ['PERSON', 'Robert Chen'],
      ['PERSON', 'Mary-Anne O\'Brien'],
      ['ORGANIZATION', 'Acme Holdings LLC'],
      ['SSN', '123-45-6789'],
      ['CREDIT_CARD', '4111 1111 1111 1111'],
      ['PHONE_NUMBER', '+1 (415) 555-0142'],
      ['EMAIL', 'robert.chen@acmecorp.com'],
      ['API_KEY', 'sk-ant-api03-Zx9KpL2mQw8vNr4T'],
      ['AWS_CREDENTIAL', 'AKIAIOSFODNN7EXAMPLE'],
      ['DATABASE_URI', 'postgres://admin:hunter2@db.internal:5432/prod'],
      ['MONETARY_AMOUNT', '$450M'],
      ['IP_ADDRESS', '192.168.1.100'],
      ['DATE', '03/15/1990'],
    ];
    for (const [type, original] of cases) {
      const fake = lengthPreservingFake(type, original);
      expect(fake, `${type}: ${original}`).not.toBeNull();
      expect(byteLen(fake!), `${type}: "${original}" → "${fake}"`).toBe(byteLen(original));
      expect(fake).not.toBe(original);
    }
  });

  it('INVARIANT: per-PART length matching for names (fragment safety)', () => {
    const fake = lengthPreservingFake('PERSON', 'Robert Chen')!;
    const [origFirst, origLast] = 'Robert Chen'.split(' ');
    const [fakeFirst, fakeLast] = fake.split(' ');
    expect(fakeFirst.length).toBe(origFirst.length); // "Robert" fragment safe
    expect(fakeLast.length).toBe(origLast.length);   // "Chen" fragment safe
  });

  it('separators and punctuation survive substitution', () => {
    const ssn = lengthPreservingFake('SSN', '123-45-6789')!;
    expect(ssn).toMatch(/^\d{3}-\d{2}-\d{4}$/);
    const phone = lengthPreservingFake('PHONE_NUMBER', '+1 (415) 555-0142')!;
    expect(phone).toMatch(/^\+\d \(\d{3}\) \d{3}-\d{4}$/);
  });

  it('credential prefixes are preserved so the fake reads as the same kind of secret', () => {
    const key = lengthPreservingFake('API_KEY', 'sk-ant-api03-Zx9KpL2mQw8vNr4T')!;
    expect(key.startsWith('sk-ant-')).toBe(true);
    expect(key).not.toBe('sk-ant-api03-Zx9KpL2mQw8vNr4T');
    const aws = lengthPreservingFake('AWS_CREDENTIAL', 'AKIAIOSFODNN7EXAMPLE')!;
    expect(aws.startsWith('AKIA')).toBe(true);
  });

  it('emails keep @, dot structure, and TLD', () => {
    const email = lengthPreservingFake('EMAIL', 'robert.chen@acmecorp.com')!;
    expect(email).toMatch(/^[a-z0-9.]+@[a-z0-9]+\.com$/i);
    expect(email.indexOf('@')).toBe('robert.chen@acmecorp.com'.indexOf('@'));
  });

  it('session-deterministic: same original → same fake; different originals never collide', () => {
    const a1 = lengthPreservingFake('PERSON', 'Robert Chen');
    const a2 = lengthPreservingFake('PERSON', 'Robert Chen');
    expect(a1).toBe(a2);
    const names = ['Amy Lee', 'Ben Fox', 'Dan Ray', 'Eva Kim', 'Ian Cox', 'Jay Day', 'Kim Roy', 'Leo Liu'];
    const fakes = names.map(n => lengthPreservingFake('PERSON', n));
    expect(new Set(fakes).size).toBe(names.length);
  });

  it('multi-byte originals return null (gated on the offset-encoding spike)', () => {
    expect(isLengthSafe('José García')).toBe(false);
    expect(lengthPreservingFake('PERSON', 'José García')).toBeNull();
    expect(isLengthSafe('Robert Chen')).toBe(true);
  });

  it('ALL-CAPS shape is preserved', () => {
    const fake = lengthPreservingFake('PERSON', 'ROBERT CHEN')!;
    expect(fake).toBe(fake.toUpperCase());
    expect(byteLen(fake)).toBe(byteLen('ROBERT CHEN'));
  });

  it('stress: 500 random-ish values all preserve byte length', () => {
    for (let i = 0; i < 500; i++) {
      const original = `user${i}.test${i % 7}@corp${i % 13}.io`;
      const fake = lengthPreservingFake('EMAIL', original);
      expect(fake).not.toBeNull();
      expect(byteLen(fake!)).toBe(byteLen(original));
    }
  });
});
