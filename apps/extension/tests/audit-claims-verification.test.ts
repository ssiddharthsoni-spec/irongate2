// ============================================================================
// Audit-claims verification
// ============================================================================
// An enterprise shippability audit flagged three pattern-path gaps. Before
// changing code based on an audit claim, prove it with a test. This file
// locks in the behavior so regressions surface in CI, not in the pilot.
//
// Each test here represents a specific audit allegation:
//   1. Bank routing `072000326` — alleged to be missed due to strict ABA validation
//   2. ORG entity "Meridian Health" — alleged to be missed in the extractor
//   3. Narrative-framed fictional SSN — alleged to bypass STRONG_FICTION
//
// If a test fails, we have a real bug to fix. If it passes, the audit was
// wrong and this test prevents future regressions.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { applyIntentSuppression } from '../src/detection/intent-suppression';

describe('Audit Claim 1: Bank routing number 072000326 must be detected', () => {
  // Audit said the ABA validator was "too strict" and would filter this out.
  // 072000326 is a real JPMorgan Chase routing number. Checksum:
  // 3*0 + 7*7 + 2 + 3*0 + 7*0 + 0 + 3*3 + 7*2 + 6 = 0+49+2+0+0+0+9+14+6 = 80 → mod 10 = 0 ✓
  // Prefix 07 → within 00-12 range ✓
  // So the validator should PASS and the detector should emit a ROUTING_NUMBER.

  it('standalone 072000326 detected as ROUTING_NUMBER', () => {
    const entities = detectWithRegex('Wire to routing 072000326 for the deposit.');
    const routing = entities.filter((e) => e.type === 'ROUTING_NUMBER');
    expect(routing.length).toBeGreaterThan(0);
    expect(routing.some((e) => e.text.includes('072000326'))).toBe(true);
  });

  it('bare 072000326 without keyword still detected via ABA checksum', () => {
    const entities = detectWithRegex('Account transfer: 072000326');
    const routing = entities.filter((e) => e.type === 'ROUTING_NUMBER');
    expect(routing.length).toBeGreaterThan(0);
  });

  it('021000021 (Chase NY) detected', () => {
    // Another real ABA: 3*0+7*2+1+3*0+7*0+0+3*0+7*2+1 = 0+14+1+0+0+0+0+14+1 = 30 → 0 ✓; prefix 02 ✓
    const entities = detectWithRegex('Routing number 021000021');
    expect(entities.some((e) => e.type === 'ROUTING_NUMBER')).toBe(true);
  });

  it('invalid ABA (bad checksum) rejected', () => {
    // 123456789: 3*1+7*2+3+3*4+7*5+6+3*7+7*8+9 = 3+14+3+12+35+6+21+56+9 = 159 → mod 10 = 9 ✗
    const entities = detectWithRegex('Some number: 123456789');
    const routing = entities.filter((e) => e.type === 'ROUTING_NUMBER');
    expect(routing.length).toBe(0);
  });
});

describe('Audit Claim 2: ORG entity "Meridian Health" must be extracted', () => {
  it('"Meridian Health" detected as ORGANIZATION', () => {
    const entities = detectWithRegex(
      'Confidential: acquiring Meridian Health for $2.8B',
    );
    const orgs = entities.filter((e) => e.type === 'ORGANIZATION');
    expect(orgs.some((e) => e.text.includes('Meridian Health'))).toBe(true);
  });

  it('"Memorial Sloan Kettering" (3-word hospital) detected', () => {
    const entities = detectWithRegex(
      'Patient was referred to Memorial Sloan Kettering for treatment.',
    );
    const orgs = entities.filter((e) => e.type === 'ORGANIZATION');
    expect(orgs.length).toBeGreaterThan(0);
  });

  it('"BlackRock" single-word financial org detected via CamelCase pattern', () => {
    // BlackRock has two capital letters in one word → CamelCase ORG regex
    const entities = detectWithRegex('Meeting with BlackRock tomorrow');
    const orgs = entities.filter((e) => e.type === 'ORGANIZATION');
    expect(orgs.some((e) => e.text === 'BlackRock')).toBe(true);
  });

  it('"Acme Corp" detected via suffix match', () => {
    const entities = detectWithRegex('Acquiring Acme Corp next quarter');
    const orgs = entities.filter((e) => e.type === 'ORGANIZATION');
    expect(orgs.some((e) => e.text.includes('Acme Corp'))).toBe(true);
  });
});

describe('Audit Claim 3: Narrative-framed fictional SSN must be suppressed', () => {
  it('"detective Sarah reads SSN 123-45-6789" suppressed as strong fiction', () => {
    const entities = detectWithRegex(
      'detective Sarah reads SSN 123-45-6789 in the evidence file',
    );
    const ssnEntities = entities.filter((e) => e.type === 'SSN');
    expect(ssnEntities.length).toBeGreaterThan(0); // SSN still detected

    const result = applyIntentSuppression(
      'detective Sarah reads SSN 123-45-6789 in the evidence file',
      entities,
      false,
    );
    // Under strong fiction, score multiplier should be heavily reduced
    // and the result should flag isStrongFiction
    expect(result.isStrongFiction).toBe(true);
  });

  it('"Write a novel scene where..." suppressed', () => {
    const entities = detectWithRegex(
      'Write a novel scene where the detective reads SSN 555-12-3456',
    );
    const result = applyIntentSuppression(
      'Write a novel scene where the detective reads SSN 555-12-3456',
      entities,
      false,
    );
    expect(result.isStrongFiction).toBe(true);
  });

  it('"npc shopkeeper says" suppressed (RPG framing)', () => {
    const entities = detectWithRegex(
      'npc shopkeeper says: welcome to Westbrook, my card number is 4111-1111-1111-1111',
    );
    const result = applyIntentSuppression(
      'npc shopkeeper says: welcome to Westbrook, my card number is 4111-1111-1111-1111',
      entities,
      false,
    );
    expect(result.isStrongFiction).toBe(true);
  });

  it('A REAL SSN in a non-fiction prompt is NOT suppressed', () => {
    // Negative control: make sure we didn't over-expand the fiction detector
    const text = 'Please file a tax return for client SSN 123-45-6789';
    const entities = detectWithRegex(text);
    const result = applyIntentSuppression(text, entities, false);
    expect(result.isStrongFiction).toBe(false);
  });
});
