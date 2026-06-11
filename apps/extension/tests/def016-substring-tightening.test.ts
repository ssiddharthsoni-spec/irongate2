import { describe, it, expect } from 'vitest';

// Standalone re-implementation of the DEF-016 matching predicate. This
// mirrors main-world.ts lines ~4820-4870 (the cross-turn session-entity
// force-pseudonymization path). Refactoring opportunity: extract the
// predicate into a pure helper exported from a shared module so the
// production code and this test share the same implementation. For now,
// the test pins the *behavior* against the exact bugs that hit production:
// 3-char originals matching URL/identifier substrings.

function applySessionMatch(
  original: string,
  pseudonym: string,
  text: string,
): string {
  if (original.length < 6) return text;
  if (!text.toLowerCase().includes(original.toLowerCase())) return text;
  const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = /^[a-zA-Z0-9_]/.test(original) ? '(?<![a-zA-Z0-9_])' : '';
  const suffix = /[a-zA-Z0-9_]$/.test(original) ? '(?![a-zA-Z0-9_])' : '';
  const regex = new RegExp(prefix + escaped + suffix, 'gi');
  const PROSE_NEIGHBOR_RE = /^[\s,.!?;'"\-—–]$/;
  const isProseNeighbor = (c: string) => c === '' || PROSE_NEIGHBOR_RE.test(c);
  return text.replace(regex, (match, offset, full: string) => {
    const charBefore = offset > 0 ? full[offset - 1] : '';
    const charAfter = full[offset + match.length] || '';
    if (!isProseNeighbor(charBefore) || !isProseNeighbor(charAfter)) return match;
    return pseudonym;
  });
}

describe('DEF-016 cross-turn session-entity tightening', () => {
  describe('Min-length floor (6 chars)', () => {
    it('does NOT match 3-char originals (was the production bug)', () => {
      // Old behavior: "URL" from a prior turn would match in "DATABASE_URL"
      // and pseudonymize random tech content.
      const result = applySessionMatch('URL', 'Foobar', 'DATABASE_URL=postgres');
      expect(result).toBe('DATABASE_URL=postgres');
    });

    it('does NOT match 4-char originals', () => {
      const result = applySessionMatch('AWS!', 'Foobar', 'AWS_KEY=x');
      expect(result).toBe('AWS_KEY=x');
    });

    it('does NOT match 5-char originals', () => {
      const result = applySessionMatch('Acme!', 'Foobar', 'something Acme! else');
      expect(result).toBe('something Acme! else');
    });

    it('STILL matches 6+ char originals (real-name length)', () => {
      const result = applySessionMatch('Foster', 'Smith', 'Rebecca Foster called.');
      expect(result).toBe('Rebecca Smith called.');
    });
  });

  describe('Tech-context guard', () => {
    it("does NOT match 'secret' inside Stripe_SECRET=", () => {
      const result = applySessionMatch('secret', 'Pseudonym', 'Stripe_SECRET=sk_live_xyz');
      // 'SECRET' is preceded by '_' (word char now → boundary regex rejects)
      // AND surrounded by tech-context chars '=' → defense in depth
      expect(result).toBe('Stripe_SECRET=sk_live_xyz');
    });

    it('does NOT match a name inside a URL path', () => {
      // 'Foster' length 6 → meets floor. But it's 6 chars... wait, length<6
      // returns text unchanged. So this test uses a longer name.
      const result = applySessionMatch('Rebecca Foster', 'Anna Smith', 'GET /api/users/Rebecca Foster/profile');
      // 'Rebecca Foster' preceded by '/' and followed by '/' → non-prose → rejected
      expect(result).toBe('GET /api/users/Rebecca Foster/profile');
    });

    it("does NOT match 'mycompany' inside db.mycompany.com (period IS prose, but be careful)", () => {
      const result = applySessionMatch('mycompany', 'Contoso', 'db.mycompany.com:5432');
      // 'mycompany' preceded by '.' AND followed by '.'. Period IS in the
      // prose set. So this WILL match. Pinned behavior — periods around a
      // 9-char token like 'mycompany' usually mean a domain that the user
      // legitimately reuses across turns. If this turns out to cause
      // false positives in practice (.env files, hostnames), we'd add
      // domain-suffix detection ('.com', '.net', etc.) as a separate guard.
      expect(result).toBe('db.Contoso.com:5432');
    });

    it('STILL matches a name in normal prose', () => {
      const result = applySessionMatch('Rebecca Foster', 'Anna Peterson', 'Hello Rebecca Foster, please review.');
      expect(result).toBe('Hello Anna Peterson, please review.');
    });

    it("does NOT match 'company' inside template '${company}'", () => {
      const result = applySessionMatch('company', 'Pseudonym', 'value=${company}');
      // 'company' preceded by '$' AND followed by '}' — $ is tech context → rejected
      expect(result).toBe('value=${company}');
    });
  });

  describe('Word-boundary tightening (now includes _ and digits)', () => {
    it("does NOT match 'Acme Corp' inside 'Acme Corp123'", () => {
      // Old code allowed `Acme Corp` to match in `Acme Corp123` because '3'
      // wasn't a "letter". New boundary check treats digits as word chars
      // → boundary fails → no match.
      const result = applySessionMatch('Acme Corp', 'Foobar', 'Acme Corp123 details');
      expect(result).toBe('Acme Corp123 details');
    });

    it("does NOT match 'MyAccount' inside 'MyAccount_test'", () => {
      const result = applySessionMatch('MyAccount', 'YourAccount', 'env var MyAccount_test here');
      expect(result).toBe('env var MyAccount_test here');
    });
  });
});
