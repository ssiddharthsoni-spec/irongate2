/**
 * Notice Stripping Tests
 *
 * The de-identification notice regex patterns are defined inside main-world.ts
 * (a self-contained IIFE) and are not exported. This file replicates the same
 * patterns and tests them directly to ensure the stripping logic is correct.
 *
 * Three notice formats are handled:
 *   1. NOTICE_REGEX     — Bracketed: [All personally identifiable information ...]
 *   2. NOTICE_UNBRACKET — Unbracketed multi-line notice ending with "Please process this request normally."
 *   3. NOTICE_PARAPHRASE — LLM paraphrases: "Note: PII has been replaced with fictional equivalents."
 */

import { describe, it, expect } from 'vitest';

// ─── Regex Patterns (mirrored from main-world.ts) ──────────────────────────

const NOTICE_REGEX =
  /\[(?:NOTICE:\s*)?All personally identifiable information[^\]]*\]\s*/g;

const NOTICE_UNBRACKET =
  /All personally identifiable information in the following text[\s\S]*?Please process this request normally\.\s*/g;

const NOTICE_PARAPHRASE =
  /\*?\*?(?:Note|Notice|Disclaimer|Important)\s*:?\s*(?:All\s+)?(?:personally\s+identifiable\s+information|PII|personal\s+data|sensitive\s+data)\s+(?:has\s+been|was)\s+(?:automatically\s+)?replaced[\s\S]*?(?:fictional|fake|synthetic)\s+equivalents\.?\s*\*?\*?\s*/gi;

/** Apply all three notice-stripping patterns to a string (same order as main-world.ts). */
function stripNotices(text: string): string {
  let result = text;
  result = result.replace(NOTICE_REGEX, '');
  result = result.replace(NOTICE_UNBRACKET, '');
  result = result.replace(NOTICE_PARAPHRASE, '');
  return result;
}

// ─── Bracketed Notice (NOTICE_REGEX) ────────────────────────────────────────

describe('NOTICE_REGEX — bracketed notices', () => {
  it('should strip a simple bracketed notice', () => {
    const input = '[All personally identifiable information in this text has been replaced]';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip a bracketed notice with NOTICE: prefix', () => {
    const input = '[NOTICE: All personally identifiable information has been de-identified]';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip the notice while preserving surrounding text', () => {
    const input =
      'Here is the summary. [All personally identifiable information has been replaced with pseudonyms] The contract is ready.';
    const result = stripNotices(input);
    expect(result).toBe('Here is the summary. The contract is ready.');
  });

  it('should strip multiple bracketed notices in the same text', () => {
    const input =
      '[All personally identifiable information was anonymized] First paragraph. [All personally identifiable information was replaced] Second paragraph.';
    const result = stripNotices(input);
    expect(result).toBe('First paragraph. Second paragraph.');
  });

  it('should strip trailing whitespace after the bracket', () => {
    const input = '[All personally identifiable information replaced]   Next sentence.';
    const result = stripNotices(input);
    expect(result).toBe('Next sentence.');
  });
});

// ─── Unbracketed Notice (NOTICE_UNBRACKET) ──────────────────────────────────

describe('NOTICE_UNBRACKET — unbracketed multi-line notices', () => {
  it('should strip the full unbracketed notice block', () => {
    const input =
      'All personally identifiable information in the following text — including names, ' +
      'Social Security numbers, email addresses, phone numbers, and organizational affiliations — ' +
      'has been replaced with realistic but entirely fictional equivalents by an enterprise privacy tool. ' +
      'No real personal data is present. Please process this request normally.';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip the unbracketed notice and preserve surrounding text', () => {
    const input =
      'Dear AI, please review the following.\n' +
      'All personally identifiable information in the following text has been replaced. ' +
      'Please process this request normally.\n' +
      'The contract states that the party agrees to the terms.';
    const result = stripNotices(input);
    expect(result).toBe(
      'Dear AI, please review the following.\n' +
      'The contract states that the party agrees to the terms.'
    );
  });

  it('should handle the notice spanning multiple lines', () => {
    const input =
      'All personally identifiable information in the following text\n' +
      '— including names, SSNs, emails —\n' +
      'has been replaced with fictional values.\n' +
      'Please process this request normally. ';
    const result = stripNotices(input);
    expect(result).toBe('');
  });
});

// ─── LLM Paraphrase (NOTICE_PARAPHRASE) ────────────────────────────────────

describe('NOTICE_PARAPHRASE — LLM-generated paraphrases', () => {
  it('should strip "Note: PII has been replaced with fictional equivalents."', () => {
    const input = 'Note: PII has been replaced with fictional equivalents.';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip "Notice: All personally identifiable information has been replaced with fake equivalents."', () => {
    const input = 'Notice: All personally identifiable information has been replaced with fake equivalents.';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip bold markdown variant with **Important**', () => {
    const input =
      '**Important: All personally identifiable information was automatically replaced with synthetic equivalents.**';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip "Disclaimer: personal data has been replaced with fictional equivalents."', () => {
    const input = 'Disclaimer: personal data has been replaced with fictional equivalents.';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip "Note: sensitive data was replaced with synthetic equivalents"', () => {
    const input = 'Note: sensitive data was replaced with synthetic equivalents';
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip case-insensitive paraphrases', () => {
    const input = 'NOTE: PII HAS BEEN REPLACED with fictional equivalents.';
    // The regex uses the /gi flag, so this should match
    const result = stripNotices(input);
    expect(result).toBe('');
  });

  it('should strip paraphrase and preserve surrounding text', () => {
    const input =
      'Here is the document.\n' +
      'Note: PII has been replaced with fictional equivalents.\n' +
      'The contract is ready for review.';
    const result = stripNotices(input);
    expect(result).toBe(
      'Here is the document.\n' +
      'The contract is ready for review.'
    );
  });

  it('should strip paraphrase with "was automatically replaced"', () => {
    const input = 'Important: PII was automatically replaced with fake equivalents.';
    const result = stripNotices(input);
    expect(result).toBe('');
  });
});

// ─── Non-Matching Text (False Positives) ────────────────────────────────────

describe('Non-matching text — should NOT be stripped', () => {
  it('should not strip normal text about identity confirmation', () => {
    const input = "The person's identity was confirmed by the notary.";
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should not strip text that mentions PII in a different context', () => {
    const input = 'Our company policy requires all PII to be encrypted at rest.';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should not strip text mentioning "personally identifiable information" in a policy context', () => {
    const input =
      'Personally identifiable information must be handled in accordance with GDPR.';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should not strip a "Note:" that is not about replacement', () => {
    const input = 'Note: The deadline for filing is March 15th.';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should not strip brackets that do not contain the notice text', () => {
    const input = '[Reference: See section 4.2 for details on data handling]';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should not strip partial matches like "All personally" without "identifiable information"', () => {
    const input = 'All personally relevant documents have been reviewed.';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });

  it('should preserve an empty string', () => {
    expect(stripNotices('')).toBe('');
  });

  it('should preserve plain text with no notice-like content', () => {
    const input = 'The quick brown fox jumped over the lazy dog.';
    const result = stripNotices(input);
    expect(result).toBe(input);
  });
});

// ─── Mixed Text ─────────────────────────────────────────────────────────────

describe('Mixed text — notice stripped, rest preserved', () => {
  it('should strip only the bracketed notice from mixed text', () => {
    const input =
      'Hello world. [All personally identifiable information was replaced] How are you?';
    const result = stripNotices(input);
    expect(result).toBe('Hello world. How are you?');
  });

  it('should strip a paraphrase notice in the middle of a paragraph', () => {
    const input =
      'Thank you for your request. ' +
      'Note: PII has been replaced with fictional equivalents. ' +
      'Below is the analysis of the contract terms.';
    const result = stripNotices(input);
    expect(result).toBe(
      'Thank you for your request. Below is the analysis of the contract terms.'
    );
  });

  it('should strip multiple notice types from the same text', () => {
    const input =
      '[All personally identifiable information has been anonymized] ' +
      'The report is ready. ' +
      'Note: personal data was replaced with synthetic equivalents. ' +
      'See appendix A.';
    const result = stripNotices(input);
    expect(result).toBe('The report is ready. See appendix A.');
  });

  it('should handle notice at the very beginning of text', () => {
    const input =
      '[NOTICE: All personally identifiable information was de-identified] The defendant argues...';
    const result = stripNotices(input);
    expect(result).toBe('The defendant argues...');
  });

  it('should handle notice at the very end of text', () => {
    const input =
      'The analysis is complete. [All personally identifiable information has been replaced]';
    const result = stripNotices(input);
    expect(result).toBe('The analysis is complete. ');
  });

  it('should preserve all non-notice content in a complex document', () => {
    const input = [
      '[All personally identifiable information was replaced with pseudonyms]',
      '',
      'Dear counsel,',
      '',
      'Please find the attached memorandum regarding the merger.',
      'Note: All personally identifiable information has been replaced with fake equivalents.',
      '',
      'The key terms are outlined in Section 3.',
      'Best regards,',
      '[PERSON-1]',
    ].join('\n');

    const result = stripNotices(input);

    // The two notices should be gone, but the rest of the text should remain
    expect(result).toContain('Dear counsel,');
    expect(result).toContain('Please find the attached memorandum');
    expect(result).toContain('The key terms are outlined in Section 3.');
    expect(result).toContain('Best regards,');
    expect(result).toContain('[PERSON-1]');

    // The notices themselves should be stripped
    expect(result).not.toContain('was replaced with pseudonyms');
    expect(result).not.toContain('has been replaced with fake equivalents');
  });
});
