import { describe, expect, it } from 'vitest';
import { parseStructured } from '../src/detection/structural-parser';
import { classifyKeyName, isObviousPlaceholder } from '../src/detection/key-name-sensitivity';
import { phaseAllowsReplace, inferPhase } from '../src/shared/event-phase';

// Regression tests for the bug list from the architectural fix session.
// Each `describe` block maps to a specific symptom we observed.

describe('structural-parser: env-var records', () => {
  it('parses well-formed multi-line .env file', () => {
    const text = [
      'DATABASE_URL=postgres://u:p@host/db',
      'API_KEY=sk_live_xyz',
      'PORT=5432',
    ].join('\n');
    const { records, freeText } = parseStructured(text);
    expect(records).toHaveLength(3);
    expect(records[0].key).toBe('DATABASE_URL');
    expect(records[0].value).toBe('postgres://u:p@host/db');
    expect(records[1].key).toBe('API_KEY');
    expect(records[1].value).toBe('sk_live_xyz');
    expect(records[2].key).toBe('PORT');
    expect(records[2].value).toBe('5432');
    // Free-text gaps should be the newlines between records
    expect(freeText.every(ft => /^\s*$/.test(ft.text))).toBe(true);
  });

  it('REGRESSION: parses run-on KEY=VALUE records WITHOUT newlines (the .env paste bug)', () => {
    // The exact shape from the user's bug report — three env vars
    // concatenated with no newlines between the first two.
    const text = 'DATABASE_URL=postgres://testuser:fakepwd@db-7766.example.com:5432/testdbREDIS_URL=redis://testuser:fakepwd@db-1613.example.com:5432/testdbAWS_ACCESS_KEY_ID=key-WT7toZRxgb3FSwez';
    const { records } = parseStructured(text);

    expect(records).toHaveLength(3);

    // Each record's value MUST stop at the next KEY= boundary, not greedy-match
    // through it (the bug that collapsed three values into one DATABASE_URI swap).
    expect(records[0].key).toBe('DATABASE_URL');
    expect(records[0].value).toBe('postgres://testuser:fakepwd@db-7766.example.com:5432/testdb');
    expect(records[1].key).toBe('REDIS_URL');
    expect(records[1].value).toBe('redis://testuser:fakepwd@db-1613.example.com:5432/testdb');
    expect(records[2].key).toBe('AWS_ACCESS_KEY_ID');
    expect(records[2].value).toBe('key-WT7toZRxgb3FSwez');
  });

  it('returns spans that exactly reproduce the original text', () => {
    const text = 'X=alpha\nY=beta';
    const { records } = parseStructured(text);
    for (const r of records) {
      expect(text.substring(r.keySpan[0], r.keySpan[1])).toBe(r.key);
      expect(text.substring(r.valueSpan[0], r.valueSpan[1])).toBe(r.value);
    }
  });

  it('preserves prose preamble as free text', () => {
    const text = 'Help me debug my .env file:\nDATABASE_URL=postgres://x';
    const { records, freeText } = parseStructured(text);
    expect(records).toHaveLength(1);
    expect(records[0].key).toBe('DATABASE_URL');
    expect(freeText.length).toBeGreaterThan(0);
    expect(freeText[0].text).toContain('Help me debug');
  });

  it('returns no records for plain prose (no KEY=)', () => {
    const text = 'Just some normal text. No env vars here.';
    const { records, freeText } = parseStructured(text);
    expect(records).toHaveLength(0);
    expect(freeText).toHaveLength(1);
    expect(freeText[0].text).toBe(text);
  });

  it('handles empty input', () => {
    expect(parseStructured('')).toEqual({ records: [], freeText: [] });
  });

  it('does not match lowercase or short identifiers (avoids false positives)', () => {
    const text = 'a=1 b=2 ab=3 X=4'; // single-letter and lowercase shouldn't match
    const { records } = parseStructured(text);
    // X is uppercase + 1 char total, doesn't satisfy {2,} requirement
    expect(records).toHaveLength(0);
  });
});

describe('classifyKeyName: variable-name-driven sensitivity', () => {
  it('REGRESSION: AWS keys flagged regardless of value format', () => {
    // The AWS test value `key-WT7toZRxgb3FSwez` doesn't match the AKIA
    // value-format regex. Detection has to come from the variable NAME.
    expect(classifyKeyName('AWS_ACCESS_KEY_ID').sensitive).toBe(true);
    expect(classifyKeyName('AWS_SECRET_ACCESS_KEY').sensitive).toBe(true);
    expect(classifyKeyName('AWS_SESSION_TOKEN').sensitive).toBe(true);
    expect(classifyKeyName('AWS_ACCESS_KEY_ID').type).toBe('AWS_CREDENTIAL');
  });

  it('REGRESSION: standalone ACCESS_KEY_ID / SECRET_ACCESS_KEY caught (paste-stripped AWS_ prefix)', () => {
    // Observed in the wild: a paste from the user dropped the leading `AWS_`
    // because the run-on input started a value with `_ACCESS_KEY_ID` and the
    // env-key parser (correctly) starts matching at the first uppercase char.
    // The credential is still identifiable by name — these patterns ensure so.
    expect(classifyKeyName('ACCESS_KEY_ID').sensitive).toBe(true);
    expect(classifyKeyName('SECRET_ACCESS_KEY').sensitive).toBe(true);
    expect(classifyKeyName('ACCESS_KEY_ID').type).toBe('AWS_CREDENTIAL');
  });

  it('flags generic API_KEY, SECRET, TOKEN, PASSWORD patterns', () => {
    expect(classifyKeyName('API_KEY').sensitive).toBe(true);
    expect(classifyKeyName('STRIPE_SECRET').sensitive).toBe(true);
    expect(classifyKeyName('GITHUB_TOKEN').sensitive).toBe(true);
    expect(classifyKeyName('DB_PASSWORD').sensitive).toBe(true);
    expect(classifyKeyName('CLIENT_SECRET').sensitive).toBe(true);
  });

  it('flags database connection-string keys', () => {
    expect(classifyKeyName('DATABASE_URL').sensitive).toBe(true);
    expect(classifyKeyName('REDIS_URL').sensitive).toBe(true);
    expect(classifyKeyName('MONGO_URI').sensitive).toBe(true);
    expect(classifyKeyName('CONNECTION_STRING').sensitive).toBe(true);
    expect(classifyKeyName('DATABASE_URL').type).toBe('DATABASE_URI');
  });

  it('rejects non-credential names', () => {
    expect(classifyKeyName('PORT').sensitive).toBe(false);
    expect(classifyKeyName('NODE_ENV').sensitive).toBe(false);
    expect(classifyKeyName('LOG_LEVEL').sensitive).toBe(false);
    expect(classifyKeyName('').sensitive).toBe(false);
    expect(classifyKeyName(null).sensitive).toBe(false);
  });
});

describe('isObviousPlaceholder: skips non-real values', () => {
  it('catches common placeholder patterns', () => {
    expect(isObviousPlaceholder('<your-key-here>')).toBe(true);
    expect(isObviousPlaceholder('xxxxxxxxx')).toBe(true);
    expect(isObviousPlaceholder('${API_KEY}')).toBe(true);
    expect(isObviousPlaceholder('$SECRET')).toBe(true);
    expect(isObviousPlaceholder('""')).toBe(true);
    expect(isObviousPlaceholder('')).toBe(true);
  });

  it('does NOT flag normal-looking values as placeholders', () => {
    expect(isObviousPlaceholder('sk_live_R8GJyMfVho4bLE4hBi45lx')).toBe(false);
    expect(isObviousPlaceholder('key-WT7toZRxgb3FSwez')).toBe(false);
    expect(isObviousPlaceholder('postgres://u:p@host/db')).toBe(false);
  });
});

describe('phaseAllowsReplace: lifecycle precedence rule', () => {
  it('null current is always replaceable', () => {
    expect(phaseAllowsReplace(null, { phase: 'audit', hasEntities: false })).toBe(true);
    expect(phaseAllowsReplace(null, { phase: 'authoritative', hasEntities: true })).toBe(true);
  });

  it('REGRESSION: audit cannot replace authoritative (the All-Clear-flicker bug)', () => {
    const current = { phase: 'authoritative' as const, hasEntities: true };
    expect(phaseAllowsReplace(current, { phase: 'audit', hasEntities: false })).toBe(false);
    expect(phaseAllowsReplace(current, { phase: 'audit', hasEntities: true })).toBe(false);
  });

  it('REGRESSION: enrichment cannot replace authoritative', () => {
    const current = { phase: 'authoritative' as const, hasEntities: true };
    expect(phaseAllowsReplace(current, { phase: 'enrichment', hasEntities: false })).toBe(false);
    expect(phaseAllowsReplace(current, { phase: 'enrichment', hasEntities: true })).toBe(false);
  });

  it('authoritative replaces preview', () => {
    const current = { phase: 'preview' as const, hasEntities: true };
    expect(phaseAllowsReplace(current, { phase: 'authoritative', hasEntities: true })).toBe(true);
  });

  it('authoritative re-broadcast with more entities replaces same-rank current', () => {
    const current = { phase: 'authoritative' as const, hasEntities: false };
    expect(phaseAllowsReplace(current, { phase: 'authoritative', hasEntities: true })).toBe(true);
  });

  it('lower-rank phase never wins', () => {
    const current = { phase: 'preview' as const, hasEntities: true };
    expect(phaseAllowsReplace(current, { phase: 'audit', hasEntities: true })).toBe(false);
  });

  it('REGRESSION: a NEW authoritative turn replaces the previous authoritative turn (was producing stale Changes panel on second submit)', () => {
    // Setup: turn 1 has landed with 11 swaps for prompt A.
    // Now turn 2 arrives with 5 swaps for prompt B. Without turnKey, my
    // earlier rule kept turn 1 because both had entities and "tie → keep
    // current" applied. With turnKey, prompt B is recognized as a different
    // turn and is allowed to replace.
    const turn1 = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'maskedPromptA' };
    const turn2 = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'maskedPromptB' };
    expect(phaseAllowsReplace(turn1, turn2)).toBe(true);
  });

  it('SAME-turn re-broadcast still does NOT replace (same turnKey, no extra entities)', () => {
    // Within a turn, ChatGPT can fire multiple authoritative re-broadcasts
    // (storage write, runtime re-broadcast, etc.). They share a turnKey,
    // so the same-turn tiebreaker applies: keep current unless incoming
    // has more entities.
    const current = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'maskedPromptA' };
    const sameTurnRebroadcast = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'maskedPromptA' };
    expect(phaseAllowsReplace(current, sameTurnRebroadcast)).toBe(false);
  });

  it('SAME-turn refinement WITH more entities replaces (same turnKey, incoming has entities, current doesn\'t)', () => {
    const current = { phase: 'authoritative' as const, hasEntities: false, turnKey: 'maskedPromptA' };
    const refinement = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'maskedPromptA' };
    expect(phaseAllowsReplace(current, refinement)).toBe(true);
  });

  it('audit STILL cannot replace authoritative even when turnKey differs (audit can never win)', () => {
    // A trailing audit on a fail-closed retry has different content than
    // the original authoritative — but audit is still telemetry, not a new
    // turn boundary, and must not be promoted to displayed state.
    const current = { phase: 'authoritative' as const, hasEntities: true, turnKey: 'A' };
    const audit = { phase: 'audit' as const, hasEntities: false, turnKey: 'B' };
    expect(phaseAllowsReplace(current, audit)).toBe(false);
  });
});

describe('inferPhase: legacy payload back-compat', () => {
  it('reads explicit phase when present', () => {
    expect(inferPhase({ phase: 'authoritative' })).toBe('authoritative');
    expect(inferPhase({ phase: 'audit' })).toBe('audit');
  });

  it('infers authoritative from isProxy/wireIntercept legacy flags', () => {
    expect(inferPhase({ isProxy: true })).toBe('authoritative');
    expect(inferPhase({ wireIntercept: true })).toBe('authoritative');
  });

  it('infers preview from realtime flag', () => {
    expect(inferPhase({ realtime: true })).toBe('preview');
  });

  it('defaults to audit (conservative)', () => {
    expect(inferPhase({})).toBe('audit');
    expect(inferPhase({ score: 100, entities: [] })).toBe('audit');
  });
});
