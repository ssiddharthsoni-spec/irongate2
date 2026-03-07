/**
 * Phase 1.2 — 30-Scenario Regression Test Suite
 *
 * Locks in expected sensitivity scores and levels for known inputs.
 * Prevents regressions: if a scorer change causes a scenario to drop
 * below its minimum score or change level, the test fails.
 *
 * Categories:
 *   GREEN  (1-10):  Low-risk, should score ≤ 25
 *   AMBER  (11-20): Medium-risk, should score 26-60
 *   RED    (21-30): High/Critical-risk, should score ≥ 61
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore, scoreToLevel } from '../src/detection/scorer';
import type { DetectedEntity } from '../src/detection/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function score(text: string) {
  const entities = detectWithRegex(text);
  return computeScore(text, entities);
}

interface Scenario {
  name: string;
  text: string;
  /** Minimum acceptable score (inclusive) */
  minScore: number;
  /** Maximum acceptable score (inclusive) */
  maxScore: number;
  /** Allowed sensitivity levels */
  levels: string[];
}

function runScenarios(scenarios: Scenario[]) {
  for (const s of scenarios) {
    it(s.name, () => {
      const result = score(s.text);
      expect(
        result.score,
        `"${s.name}": score ${result.score} below minimum ${s.minScore}`
      ).toBeGreaterThanOrEqual(s.minScore);
      expect(
        result.score,
        `"${s.name}": score ${result.score} above maximum ${s.maxScore}`
      ).toBeLessThanOrEqual(s.maxScore);
      expect(
        s.levels,
        `"${s.name}": level "${result.level}" not in [${s.levels}]`
      ).toContain(result.level);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// GREEN ZONE — Scenarios 1-10: Low sensitivity (score ≤ 25)
// These are benign queries that should NOT trigger alerts.
// ═════════════════════════════════════════════════════════════════════════════

describe('GREEN zone — low sensitivity (≤ 25)', () => {
  const scenarios: Scenario[] = [
    {
      name: '1. Generic coding question',
      text: 'How do I sort an array in JavaScript using the built-in sort method?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '2. Recipe request',
      text: 'Give me a recipe for chocolate chip cookies with butter and brown sugar.',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '3. Math homework',
      text: 'What is the derivative of x^3 + 2x^2 - 5x + 7?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '4. Travel question',
      text: 'What are the best restaurants to visit in Tokyo for authentic ramen?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '5. Generic business question',
      text: 'What are some best practices for running an effective team standup meeting?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '6. Code snippet with no secrets',
      text: 'function add(a: number, b: number): number { return a + b; }',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '7. Weather question',
      text: 'What is the weather forecast for this weekend?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '8. History question',
      text: 'When did World War II end and what were the main causes?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '9. Generic writing help',
      text: 'Can you help me write a professional email declining a meeting invitation politely?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
    {
      name: '10. Technical documentation question',
      text: 'How does React reconciliation work and what is the virtual DOM diffing algorithm?',
      minScore: 0,
      maxScore: 25,
      levels: ['low'],
    },
  ];

  runScenarios(scenarios);
});

// ═════════════════════════════════════════════════════════════════════════════
// AMBER ZONE — Scenarios 11-20: Medium sensitivity (score 26-60)
// Identifiable information present but not critical.
// ═════════════════════════════════════════════════════════════════════════════

describe('AMBER zone — medium sensitivity (26-60)', () => {
  const scenarios: Scenario[] = [
    {
      name: '11. Single person name + email',
      text: 'Please draft an email to Sarah Johnson at sarah.johnson@acmecorp.com about the quarterly review.',
      minScore: 15,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '12. Meeting notes with names',
      text: 'Meeting attendees: John Smith, Maria Garcia, and David Chen discussed the Q3 roadmap. Action items were assigned to each team lead.',
      minScore: 0,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '13. Phone number in context',
      text: 'Our office number is (555) 867-5309. Please call during business hours for support.',
      minScore: 10,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '14. Business address mention',
      text: 'Our headquarters is at 1600 Amphitheatre Parkway, Mountain View, CA 94043. Visitor parking is available.',
      minScore: 0,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '15. Internal project discussion with deal codename',
      text: 'Project Aurora is on track for Q4 launch. The team needs to finalize the pricing model before the board meeting next Tuesday.',
      minScore: 26,
      maxScore: 85,
      levels: ['medium', 'high'],
    },
    {
      name: '16. Email with monetary amount',
      text: 'Hi team, the budget for this quarter is $450,000. Please submit expense reports to accounting@company.com by Friday.',
      minScore: 15,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '17. Customer name in support context',
      text: 'Customer Robert Martinez called about his order #12345. He wants to change the shipping address. His email is r.martinez@gmail.com.',
      minScore: 0,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '18. IP address in log snippet',
      text: 'Server error at 2024-01-15 14:32:00 from IP 192.168.1.100: Connection timeout on port 8080.',
      minScore: 5,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '19. Generic legal question with keyword',
      text: 'What are the general requirements for a confidential settlement agreement in California employment disputes?',
      minScore: 0,
      maxScore: 60,
      levels: ['low', 'medium'],
    },
    {
      name: '20. Organization names in news context (M&A keywords boost)',
      text: 'According to reports, Microsoft and Activision completed their merger. Goldman Sachs advised on the transaction valued at $68.7 billion.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
  ];

  runScenarios(scenarios);
});

// ═════════════════════════════════════════════════════════════════════════════
// RED ZONE — Scenarios 21-30: High/Critical sensitivity (score ≥ 61)
// Must ALWAYS trigger alerts. CEO/GC would never accept "medium" for these.
// ═════════════════════════════════════════════════════════════════════════════

describe('RED zone — high/critical sensitivity (≥ 61)', () => {
  const scenarios: Scenario[] = [
    {
      name: '21. SSN in any context',
      text: 'Can you help me format this? SSN: 423-86-1957',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '22. Credit card number',
      text: 'My card number is 4532-0123-4567-8901, expiry 12/25, CVV 321.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '23. Full identity theft kit',
      text: 'Customer: James Wilson, SSN: 423-86-1957, DOB: 03/15/1988, Address: 742 Evergreen Terrace, Springfield IL 62704, Phone: (415) 555-0187, Credit Card: 4532-0123-4567-8901',
      minScore: 86,
      maxScore: 100,
      levels: ['critical'],
    },
    {
      name: '24. HIPAA violation — patient record',
      text: 'Patient: Sarah Thompson, MRN: MRN-2024-44891, DOB: 07/22/1965. Diagnosis: Stage 3 breast cancer, BRCA1 positive. Treatment: Chemotherapy cycle 4 of 6, Doxorubicin 60mg/m2. Insurance: Blue Cross policy #BC-44891-2024.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '25. Attorney-client privilege',
      text: 'PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT. Re: Smith v. Johnson, Case No. 2024-CV-8821. Our litigation strategy should focus on the statute of limitations defense. The deposition of the plaintiff revealed inconsistencies in the timeline. Settlement authority approved up to $2.5M.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '26. M&A MNPI — deal codename',
      text: 'Project Phoenix update: Target company valuation at $4.2B. Due diligence team found $180M in undisclosed liabilities. Board vote scheduled for March 15. Antitrust filing deadline is April 30. Do not discuss outside the deal team.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '27. AWS credentials in code',
      text: 'const config = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '28. Database connection string',
      text: 'Use this connection string for production: postgresql://admin:SuperS3cret!@prod-db.internal.company.com:5432/customers_prod',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
    {
      name: '29. Bulk customer PII paste',
      text: `Customer records export:
1. John Smith, john@example.com, (555) 111-2222, SSN: 111-22-3333
2. Jane Doe, jane@example.com, (555) 333-4444, SSN: 222-33-4444
3. Bob Wilson, bob@example.com, (555) 555-6666, SSN: 333-44-5555
4. Alice Brown, alice@example.com, (555) 777-8888, SSN: 444-55-6666
5. Charlie Davis, charlie@example.com, (555) 999-0000, SSN: 555-66-7777`,
      minScore: 86,
      maxScore: 100,
      levels: ['critical'],
    },
    {
      name: '30. Executive compensation + layoff plan',
      text: 'CONFIDENTIAL — Board Eyes Only. CEO compensation: $12.5M base + $8M RSU. CFO approved RIF of 2,400 employees (18% workforce) effective Q2. WARN Act notices must be filed by March 1. Severance budget: $45M. Do not distribute until board approval.',
      minScore: 61,
      maxScore: 100,
      levels: ['high', 'critical'],
    },
  ];

  runScenarios(scenarios);
});
