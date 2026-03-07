/**
 * Phase 1.3 — Detection Pipeline Latency Benchmark
 *
 * Measures p50/p95/p99 latencies for the full detection pipeline
 * (regex detection + scoring) across different input sizes and types.
 *
 * Budget: < 50ms p95 for typical prompts (< 2000 chars)
 *
 * Run: npx vitest bench tests/detection-perf.bench.ts
 */

import { bench, describe } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';

// ── Test Inputs ──────────────────────────────────────────────────────────────

const SHORT_BENIGN = 'How do I sort an array in JavaScript?';

const MEDIUM_PII = `Please review this customer record:
Name: James Wilson, SSN: 423-86-1957, DOB: 03/15/1988,
Address: 742 Evergreen Terrace, Springfield IL 62704,
Phone: (415) 555-0187, Email: jwilson@acmecorp.com`;

const LONG_LEGAL = `PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT
Re: Smith v. Johnson, Case No. 2024-CV-8821

Our litigation strategy should focus on three key areas:

1. Statute of Limitations Defense: The plaintiff's claims were filed
   outside the applicable 3-year window. Discovery of the alleged harm
   occurred no later than January 2020.

2. Deposition Summary: The deposition of plaintiff Sarah Thompson
   revealed significant inconsistencies. She stated under oath that
   she first learned of the data breach on March 15, 2020, but email
   records show notification was sent to sarah.thompson@example.com
   on February 1, 2020.

3. Settlement Considerations: Based on our analysis of comparable cases
   (Anderson v. DataCorp, 2022-CV-1122; Martinez v. CloudBase, 2023-CV-3344),
   settlement authority should be set at $2.5M maximum. The mediation
   scheduled for April 15 with Judge Williams presents our best opportunity.

Financial exposure assessment: $4.2M worst case, $1.8M most likely.
Insurance coverage: Liability policy #POL-2024-88991 covers up to $3M.

Action items for the deal team:
- File motion to compel by March 1
- Prepare witness list by March 15
- Subpoena records from third-party processor

Contact: Robert Chen, Esq. at (212) 555-0199 or rchen@lawfirm.com
Matter Number: MTR-2024-0042
`.repeat(2); // ~2000 chars

const BULK_PII = Array.from({ length: 50 }, (_, i) =>
  `${i + 1}. Customer${i}, SSN: ${100 + i}-${20 + i}-${3000 + i}, email: user${i}@example.com, (555) ${String(100 + i).padStart(3, '0')}-${String(4000 + i).padStart(4, '0')}`
).join('\n'); // ~5000 chars, 50 records

const VERY_LONG_DOC = LONG_LEGAL.repeat(5); // ~10000 chars

// ── Benchmarks ───────────────────────────────────────────────────────────────

describe('Detection pipeline — regex only', () => {
  bench('short benign (40 chars)', () => {
    detectWithRegex(SHORT_BENIGN);
  });

  bench('medium PII (200 chars)', () => {
    detectWithRegex(MEDIUM_PII);
  });

  bench('long legal doc (2000 chars)', () => {
    detectWithRegex(LONG_LEGAL);
  });

  bench('bulk PII (5000 chars, 50 records)', () => {
    detectWithRegex(BULK_PII);
  });

  bench('very long doc (10000 chars)', () => {
    detectWithRegex(VERY_LONG_DOC);
  });
});

describe('Full pipeline — detect + score', () => {
  bench('short benign (40 chars)', () => {
    const entities = detectWithRegex(SHORT_BENIGN);
    computeScore(SHORT_BENIGN, entities);
  });

  bench('medium PII (200 chars)', () => {
    const entities = detectWithRegex(MEDIUM_PII);
    computeScore(MEDIUM_PII, entities);
  });

  bench('long legal doc (2000 chars)', () => {
    const entities = detectWithRegex(LONG_LEGAL);
    computeScore(LONG_LEGAL, entities);
  });

  bench('bulk PII (5000 chars, 50 records)', () => {
    const entities = detectWithRegex(BULK_PII);
    computeScore(BULK_PII, entities);
  });

  bench('very long doc (10000 chars)', () => {
    const entities = detectWithRegex(VERY_LONG_DOC);
    computeScore(VERY_LONG_DOC, entities);
  });
});
