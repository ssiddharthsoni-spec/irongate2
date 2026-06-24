/**
 * Label-driven detection of structured identifiers (June 2026).
 *
 * Root-cause fix for the MRN/Insurance/Account/Routing wire leak: the LABEL
 * ("MRN:", "Insurance ID:", "Account:") is the sensitivity signal, so the
 * value is protected regardless of its format — no per-format regex.
 *
 * Tests the SHIPPED functions directly (parseStructured + classifyKeyName +
 * looksLikeIdentifierValue), composed exactly as buildSubmitEntities composes
 * them. No mocks.
 */
import { describe, it, expect } from 'vitest';
import { parseStructured } from '../src/detection/structural-parser';
import {
  classifyKeyName,
  isObviousPlaceholder,
  looksLikeIdentifierValue,
} from '../src/detection/key-name-sensitivity';

// Mirror of buildSubmitEntities' L1+L2 label path (the protection decision).
function protectedByLabel(text: string): Array<{ type: string; value: string; key: string }> {
  const out: Array<{ type: string; value: string; key: string }> = [];
  for (const rec of parseStructured(text).records) {
    const kc = classifyKeyName(rec.key);
    const proseOk = rec.kind !== 'prose_kv' || looksLikeIdentifierValue(rec.value);
    if (kc.sensitive && !isObviousPlaceholder(rec.value) && proseOk) {
      out.push({ type: kc.type, value: rec.value, key: rec.key });
    }
  }
  return out;
}
const protectedValues = (t: string) => protectedByLabel(t).map((e) => e.value);

describe('labeled identifier detection — the leak that the canary caught', () => {
  const discharge =
    'Patient Jane Miller, MRN: MED-789012, DOB: 08/14/1965. Insurance ID: BCBS-2024-456789. ' +
    'Member ID: 55512345, Group #GRP-9012. Policy #INS-2024-55678. Routing: 021000021 Account: 483726159 NPI: 1234567890';

  it('protects the format-less identifiers that regex could never catch', () => {
    const vals = protectedValues(discharge);
    expect(vals).toContain('MED-789012');       // MRN
    expect(vals).toContain('BCBS-2024-456789');  // Insurance ID
    expect(vals).toContain('55512345');          // Member ID
    expect(vals).toContain('GRP-9012');          // Group #
    expect(vals).toContain('INS-2024-55678');    // Policy #
    expect(vals).toContain('021000021');         // Routing
    expect(vals).toContain('483726159');         // Account
    expect(vals).toContain('1234567890');        // NPI
  });

  it('maps each label to a HIGH-PII type (pseudonymized + critical floor)', () => {
    const byVal = new Map(protectedByLabel(discharge).map((e) => [e.value, e.type]));
    expect(byVal.get('MED-789012')).toBe('MEDICAL_RECORD');
    expect(byVal.get('BCBS-2024-456789')).toBe('ACCOUNT_NUMBER');
    expect(byVal.get('483726159')).toBe('ACCOUNT_NUMBER');
  });

  it('wire instructions (no delimiters) segment correctly — each field bounded', () => {
    const wire =
      'Send wire per these instructions: Beneficiary: Global Trading LLC Bank: JPMorgan Chase ' +
      'Account: 483726159 Routing: 021000021 SWIFT: CHASUS33 Reference: INV-2024-0891';
    const recs = new Map(parseStructured(wire).records.map((r) => [r.key, r.value]));
    expect(recs.get('Beneficiary')).toBe('Global Trading LLC'); // not "Global Trading LLC Bank"
    expect(recs.get('Bank')).toBe('JPMorgan Chase');
    expect(recs.get('Account')).toBe('483726159');
    expect(recs.get('Routing')).toBe('021000021');
    const vals = protectedValues(wire);
    expect(vals).toContain('483726159');
    expect(vals).toContain('021000021');
    expect(vals).toContain('CHASUS33'); // SWIFT
  });

  it('multi-word labels stay whole ("Insurance ID") but value+label split ("...LLC Bank")', () => {
    expect(classifyKeyName('Insurance ID').sensitive).toBe(true);
    expect(classifyKeyName('MRN').type).toBe('MEDICAL_RECORD');
    expect(classifyKeyName('Account Number').type).toBe('ACCOUNT_NUMBER');
    expect(classifyKeyName('SSN').type).toBe('SSN');
  });

  it('PRECISION: name/prose values after a label are NOT protected as IDs', () => {
    // "Member: Lisa Park" — value is a name (no digit) → falls through to
    // PERSON detection, not masked as a numeric account.
    expect(protectedValues('Member: Lisa Park')).not.toContain('Lisa Park');
    // A benign sentence after a generic label must not be mangled.
    expect(protectedValues('Member: John is on the engineering team')).toEqual([]);
    expect(looksLikeIdentifierValue('Lisa Park')).toBe(false);
    expect(looksLikeIdentifierValue('483726159')).toBe(true);
    expect(looksLikeIdentifierValue('BCBS-2024-456789')).toBe(true);
  });

  it('FALSE POSITIVES: times, URLs, ratios, notes are not treated as labeled IDs', () => {
    expect(protectedValues('What time is the meeting: 3:30pm tomorrow?')).toEqual([]);
    expect(protectedValues('Note: please review the document.')).toEqual([]);
    expect(protectedValues('See https://example.com/path for details')).toEqual([]);
    expect(protectedValues('The aspect ratio is 16:9 widescreen')).toEqual([]);
  });

  it('env-var credentials still detected (no regression to existing behavior)', () => {
    const vals = protectedValues('AWS_SECRET_ACCESS_KEY=key-WT7toZRxgb3FSwez\nDATABASE_URL=postgres://u:p@h:5432/db');
    expect(vals).toContain('key-WT7toZRxgb3FSwez');
    expect(vals.some((v) => v.startsWith('postgres://'))).toBe(true);
  });
});
