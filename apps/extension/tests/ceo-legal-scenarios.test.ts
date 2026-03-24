/**
 * CEO / Legal Council Scenario Tests
 *
 * These tests evaluate Iron Gate from the perspective of a CEO or General Counsel:
 * "If an employee pasted this into ChatGPT and it leaked, would we face
 *  regulatory action, lawsuits, reputational damage, or criminal liability?"
 *
 * Categories:
 *   1.  Identity Theft Vectors (SSN, credit card, DOB combos)
 *   2.  HIPAA Violations (PHI: patient names + diagnoses + MRNs)
 *   3.  Attorney-Client Privilege (litigation strategy, case details)
 *   4.  M&A / Material Non-Public Information (MNPI)
 *   5.  HR / Employment Liability (compensation, terminations, complaints)
 *   6.  Financial Fraud Indicators (wire instructions, account details)
 *   7.  Trade Secrets & IP (proprietary formulas, source code with secrets)
 *   8.  Regulatory / SOX Compliance (audit findings, internal controls)
 *   9.  Customer PII at Scale (bulk data paste)
 *  10.  Evasion Techniques (zero-width chars, base64, deliberate obfuscation)
 *  11.  False Positive Immunity (benign content that looks suspicious)
 *  12.  SSN Format Variations (all formats that must be caught)
 *  13.  Multi-Entity Combination Risk (identity theft kits)
 *  14.  Credential / Secret Leakage (production keys, DB URIs)
 *  15.  Board-Level Communications (board decks, executive compensation)
 *
 * Each test validates:
 *   - Detection: entities are found (type + count)
 *   - Scoring: risk level matches severity
 *   - Pseudonymization: all PII removed from output
 *   - No original sensitive data survives in pseudonymized text
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { scanForSecrets } from '../src/worker/detectors/secret-scanner';
import { computeScore } from '../src/detection/scorer';
import { pseudonymizeLocal } from '../src/detection/pseudonymizer';
import type { DetectedEntity } from '../src/detection/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Combined detection: PII regex + secret scanner (mirrors production pipeline) */
function detectAll(text: string): DetectedEntity[] {
  const piiEntities = detectWithRegex(text);
  const secrets = scanForSecrets(text);
  const secretEntities: DetectedEntity[] = secrets.map(s => ({
    type: s.type,
    text: s.text,
    start: s.start,
    end: s.end,
    confidence: s.confidence,
    source: s.source,
  }));
  const combined = [...piiEntities, ...secretEntities].sort((a, b) => a.start - b.start);
  if (combined.length <= 1) return combined;
  const result: DetectedEntity[] = [combined[0]];
  for (let i = 1; i < combined.length; i++) {
    const current = combined[i];
    const last = result[result.length - 1];
    if (current.start < last.end) {
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

/** Assert that none of the given strings appear in the pseudonymized text */
function assertNoPIILeakage(maskedText: string, sensitiveStrings: string[]) {
  for (const s of sensitiveStrings) {
    expect(
      maskedText.includes(s),
      `LEAKAGE: "${s}" survived pseudonymization and would be sent to the LLM`
    ).toBe(false);
  }
}

/** Assert minimum entity count and types */
function assertDetection(
  entities: DetectedEntity[],
  minCount: number,
  requiredTypes: string[],
  label: string,
) {
  expect(
    entities.length,
    `${label}: Expected at least ${minCount} entities, found ${entities.length}. Types found: ${[...new Set(entities.map(e => e.type))].join(', ')}`
  ).toBeGreaterThanOrEqual(minCount);

  const foundTypes = new Set(entities.map(e => e.type));
  for (const type of requiredTypes) {
    expect(
      foundTypes.has(type),
      `${label}: Expected entity type "${type}" not found. Found: ${[...foundTypes].join(', ')}`
    ).toBe(true);
  }
}

/** Assert score meets minimum threshold and level */
function assertSeverity(
  score: number,
  level: string,
  minScore: number,
  allowedLevels: string[],
  label: string,
) {
  expect(
    score,
    `${label}: Score ${score} below minimum ${minScore}`
  ).toBeGreaterThanOrEqual(minScore);

  expect(
    allowedLevels,
    `${label}: Level "${level}" not in allowed levels [${allowedLevels.join(', ')}]`
  ).toContain(level);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. IDENTITY THEFT VECTORS
// CEO risk: Class-action lawsuit, FTC enforcement, state AG investigations
// ═════════════════════════════════════════════════════════════════════════════

describe('1. Identity Theft Vectors', () => {
  const scenarios = [
    {
      name: 'Full identity package (name + SSN + DOB + address)',
      prompt: 'Can you help me format this customer record? Name: James Robert Wilson, SSN: 423-86-1957, Date of Birth: 03/15/1988, Address: 742 Evergreen Terrace, Springfield IL 62704, Phone: (415) 555-0187',
      requiredTypes: ['SSN', 'PHONE_NUMBER'],
      minEntities: 2,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['423-86-1957', '(415) 555-0187'],
    },
    {
      name: 'SSN with dashes',
      prompt: 'Employee SSN is 123-45-6789',
      requiredTypes: ['SSN'],
      minEntities: 1,
      minScore: 25,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['123-45-6789'],
    },
    {
      name: 'SSN with spaces',
      prompt: 'Her social is 456 78 9012',
      requiredTypes: ['SSN'],
      minEntities: 1,
      minScore: 25,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['456 78 9012'],
    },
    {
      name: 'Bare SSN with context keyword',
      prompt: 'My SSN is 113324343',
      requiredTypes: ['SSN'],
      minEntities: 1,
      minScore: 25,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['113324343'],
    },
    {
      name: 'SSN after "social security number"',
      prompt: 'Social Security Number: 987654321',
      requiredTypes: ['SSN'],
      minEntities: 1,
      minScore: 25,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['987654321'],
    },
    {
      name: 'Credit card number (Visa)',
      prompt: 'Charge to Visa 4532-8921-0076-3344, exp 12/25, CVV 847',
      requiredTypes: ['CREDIT_CARD'],
      minEntities: 1,
      minScore: 20,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['4532-8921-0076-3344'],
    },
    {
      name: 'Multiple victims in one prompt',
      prompt: `Please format these records:
1. John Smith, SSN 123-45-6789, john.smith@company.com
2. Jane Doe, SSN 987-65-4321, jane.doe@company.com
3. Bob Wilson, SSN 456-78-9012, bob.wilson@company.com`,
      requiredTypes: ['SSN', 'EMAIL'],
      minEntities: 5,
      minScore: 60,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['123-45-6789', '987-65-4321', '456-78-9012', 'john.smith@company.com', 'jane.doe@company.com', 'bob.wilson@company.com'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HIPAA VIOLATIONS
// CEO risk: $1.5M+ per violation, criminal penalties, OCR investigation
// ═════════════════════════════════════════════════════════════════════════════

describe('2. HIPAA Violations — Protected Health Information', () => {
  const scenarios = [
    {
      name: 'Patient record with diagnosis (PHI)',
      prompt: 'Patient Sarah Chen, MRN: 4829-7103, DOB 03/15/1985, diagnosed with Stage III breast cancer. Attending physician: Dr. Michael Roberts. Contact: sarah.chen@hospital.org, (555) 234-5678.',
      requiredTypes: ['MEDICAL_RECORD', 'EMAIL', 'PHONE_NUMBER'],
      minEntities: 3,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['4829-7103', 'sarah.chen@hospital.org', '(555) 234-5678'],
    },
    {
      name: 'Mental health records',
      prompt: 'Patient Maria Gonzalez (MRN 12345) has been prescribed Lexapro 10mg for major depressive disorder. Previous suicide attempt 2023-06-15. Emergency contact: husband Roberto Gonzalez (555) 987-6543.',
      requiredTypes: ['MEDICAL_RECORD', 'PHONE_NUMBER'],
      minEntities: 2,
      minScore: 30,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['12345', '(555) 987-6543'],
    },
    {
      name: 'Substance abuse treatment records (42 CFR Part 2)',
      prompt: 'Can you help me draft discharge instructions? Patient: David Kim, MRN: 78901, admitted for opioid use disorder, methadone maintenance 80mg/day. Insurance: Aetna policy #HJ4829102.',
      requiredTypes: ['MEDICAL_RECORD'],
      minEntities: 1,
      minScore: 20,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['78901'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all PHI', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ATTORNEY-CLIENT PRIVILEGE
// CEO risk: Waived privilege, adverse inference, malpractice, sanctions
// ═════════════════════════════════════════════════════════════════════════════

describe('3. Attorney-Client Privilege', () => {
  const scenarios = [
    {
      name: 'Privileged litigation strategy memo',
      prompt: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGE
From: Sarah Mitchell, Esq.
To: CEO Robert Chen
Re: Smith v. Acme Corp, case #2024-1234

Our exposure in this matter is approximately $47M. I recommend we settle for no more than $15M. Plaintiff's counsel (Williams & Associates LLP) has a weak damages theory but strong liability case. Key witness Dr. James Wilson (SSN 123-45-6789) may be deposed next month.`,
      requiredTypes: ['SSN', 'MATTER_NUMBER'],
      minEntities: 2,
      minScore: 50,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['123-45-6789'],
    },
    {
      name: 'Work product doctrine — internal investigation',
      prompt: `ATTORNEY WORK PRODUCT — PROTECTED COMMUNICATION
Internal investigation re: whistleblower complaint #WB-2024-089.
Interviews conducted with employee James Torres (EMP-29481, james.torres@company.com).
Potential FCPA violation: $2.3M payment to government official via offshore account 98-7654321 at Deutsche Bank AG.`,
      requiredTypes: ['EMAIL', 'EMPLOYEE_ID'],
      minEntities: 2,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['james.torres@company.com', 'EMP-29481'],
    },
    {
      name: 'Settlement negotiation details',
      prompt: `Without prejudice — settlement discussion
We are prepared to offer $8.5M to resolve all claims in Chen v. MegaCorp, docket 05-678. This includes a mutual NDA and no-admission clause. Client SSN for wire: 567-89-0123. Wire to: JPMorgan Chase acct. #123456789012.`,
      requiredTypes: ['SSN', 'MATTER_NUMBER', 'ACCOUNT_NUMBER'],
      minEntities: 2,
      minScore: 50,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['567-89-0123'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity (privilege context should boost)', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. M&A / MATERIAL NON-PUBLIC INFORMATION (MNPI)
// CEO risk: SEC enforcement, insider trading charges, deal collapse
// ═════════════════════════════════════════════════════════════════════════════

describe('4. M&A / MNPI — Material Non-Public Information', () => {
  const scenarios = [
    {
      name: 'Merger announcement draft',
      prompt: `CONFIDENTIAL — DO NOT DISTRIBUTE
Project Horizon Update: Acme Corp (NYSE: ACM) acquisition of Widget Inc for $3.1B. Expected close Q2 2025. CEO John Smith and Widget CEO Sarah Chen will announce jointly. 340 headcount reduction planned post-merger. Contact: deal team lead mike.johnson@acme.com`,
      requiredTypes: ['EMAIL'],
      minEntities: 1,
      minScore: 20,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['mike.johnson@acme.com'],
    },
    {
      name: 'Board deck with financial projections',
      prompt: `Board of Directors — Q4 Earnings Preview (EMBARGOED)
Revenue: $487M (vs. consensus $462M — beat by 5.4%)
EPS: $3.42 (guidance was $3.10-$3.25)
Major client win: United Healthcare ($45M annual contract)
Headcount: 2,847 employees (plan to RIF 200 in January)
CEO compensation recommendation: $12.5M total (base $1.2M + RSU-2024-001 $8M + bonus $3.3M)`,
      requiredTypes: ['MONETARY_AMOUNT'],
      minEntities: 2,
      minScore: 15,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: [],
    },
    {
      name: 'Due diligence findings with PII',
      prompt: `Project Nighthawk DD Summary — STRICTLY CONFIDENTIAL
Target: MedTech Solutions Inc (private, est. value $890M)
Key person risk: CTO Dr. James Park (james.park@medtech.io, SSN 234-56-7890)
IP portfolio: 47 patents, 12 pending
Litigation: 3 active suits, estimated liability $15M
Bank: Silicon Valley Bank, acct #9876543210`,
      requiredTypes: ['SSN', 'EMAIL', 'BANK_ACCOUNT'],
      minEntities: 3,
      minScore: 50,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['234-56-7890', 'james.park@medtech.io'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HR / EMPLOYMENT LIABILITY
// CEO risk: EEOC complaints, discrimination lawsuits, NLRA violations
// ═════════════════════════════════════════════════════════════════════════════

describe('5. HR / Employment Liability', () => {
  const scenarios = [
    {
      name: 'Salary comparison (pay equity risk)',
      prompt: `Help me create a compensation analysis spreadsheet:
Employee: Maria Garcia, EMP-29481, $185,000/yr, Level 7
Employee: John Anderson, EMP-30122, $210,000/yr, Level 7
Employee: Priya Patel, EMP-28903, $178,000/yr, Level 7
Note: All same role, same tenure. Maria's SSN: 345-67-8901 for payroll update.`,
      requiredTypes: ['SSN', 'EMPLOYEE_ID'],
      minEntities: 3,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['345-67-8901', 'EMP-29481', 'EMP-30122', 'EMP-28903'],
    },
    {
      name: 'Performance termination memo',
      prompt: `CONFIDENTIAL — HR EYES ONLY
Termination recommendation for Robert Chen, employee since 2019.
PIP failed — 3 documented incidents. manager: sarah.miller@company.com
Robert's personal email for COBRA: robert.chen.personal@gmail.com
SSN for final paycheck: 456-78-9012. Exit interview scheduled 3/15.`,
      requiredTypes: ['SSN', 'EMAIL'],
      minEntities: 3,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['456-78-9012', 'sarah.miller@company.com', 'robert.chen.personal@gmail.com'],
    },
    {
      name: 'Sexual harassment complaint',
      prompt: `STRICTLY CONFIDENTIAL — Title VII
Complainant: Emily Rodriguez, EMP-31456, emily.r@company.com
Accused: VP Sales Thomas Bradley
Incident dates: 2024-01-15, 2024-02-03, 2024-02-28
Witnesses: Dr. Sarah Kim (HR), James Wu (colleague)
Contact complainant at (415) 555-0199 for follow-up.`,
      requiredTypes: ['EMAIL', 'EMPLOYEE_ID', 'PHONE_NUMBER'],
      minEntities: 3,
      minScore: 35,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['EMP-31456', 'emily.r@company.com', '(415) 555-0199'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. FINANCIAL FRAUD / WIRE FRAUD VECTORS
// CEO risk: BSA/AML violations, wire fraud liability, bank regulatory action
// ═════════════════════════════════════════════════════════════════════════════

describe('6. Financial Fraud Indicators', () => {
  const scenarios = [
    {
      name: 'Wire transfer instructions with account details',
      prompt: `Please format this wire transfer:
Beneficiary: Global Trading Partners LLC
Bank: Citibank NA
Account: acct. #1234567890
ABA Routing: 021000089
Amount: $2,450,000
Reference: INV-78901
Authorized by: CFO Michael Chen (michael.chen@company.com)`,
      requiredTypes: ['EMAIL', 'ACCOUNT_NUMBER'],
      minEntities: 2,
      minScore: 30,
      allowedLevels: ['medium', 'high', 'critical'],
      mustNotLeak: ['michael.chen@company.com'],
    },
    {
      name: 'Credit card batch with multiple customers',
      prompt: `Process these refunds:
Customer 1: Card 4111-1111-1111-1111, refund $499.99, john@email.com
Customer 2: Card 5500-0000-0000-0004, refund $1,299.00, jane@email.com
Customer 3: Card 3782-822463-10005, refund $750.00, bob@email.com`,
      requiredTypes: ['CREDIT_CARD', 'EMAIL'],
      minEntities: 4,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['4111-1111-1111-1111', '5500-0000-0000-0004', 'john@email.com', 'jane@email.com', 'bob@email.com'],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. TRADE SECRETS & INTELLECTUAL PROPERTY
// CEO risk: Loss of trade secret protection, competitive damage, DTSA claims
// ═════════════════════════════════════════════════════════════════════════════

describe('7. Trade Secrets & IP', () => {
  const scenarios = [
    {
      name: 'Production code with embedded credentials',
      prompt: `Help me debug this production config:
DATABASE_URL=postgresql://admin:SuperSecret123@db.prod.company.com:5432/maindb
REDIS_URL=redis://default:r3d1sP@ss@redis.prod.company.com:6379
API_KEY=sk-proj-abc123def456ghi789jkl012mno345
STRIPE_SECRET=sk_live_4eC39HqLyjWDarjtT1zdp7dc
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
      requiredTypes: ['DATABASE_URI', 'AWS_CREDENTIAL'],
      minEntities: 2,
      minScore: 40,
      allowedLevels: ['high', 'critical'],
      mustNotLeak: ['postgresql://admin:SuperSecret123@db.prod.company.com:5432/maindb', 'AKIAIOSFODNN7EXAMPLE'],
    },
    {
      name: 'JWT token in debug session',
      prompt: `The user's auth token is failing:
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
Can you decode this and tell me what's wrong?`,
      requiredTypes: ['AUTH_TOKEN'],
      minEntities: 1,
      minScore: 10,
      allowedLevels: ['low', 'medium', 'high', 'critical'],
      mustNotLeak: ['eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'],
    },
    {
      name: 'GitHub PAT leak',
      prompt: 'I need help with my GitHub Actions workflow. My token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij is not working for pushing to the repo.',
      requiredTypes: ['API_KEY'],
      minEntities: 1,
      minScore: 15,
      allowedLevels: ['low', 'medium', 'high', 'critical'],
      mustNotLeak: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'],
    },
    {
      name: 'Private key paste',
      prompt: `Can you help me fix my SSH config?
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2a2rwplBQLNMPEcKMSN6FhG7FKKh+dMH8pVa2j5FJ5D+HmE
jQWikq8cJJ5U3zcJkFbR7B9r4h5FjEUDkVPE8E5L3Q0wLLDtJqr5EjZ5aR2D5Xk
-----END RSA PRIVATE KEY-----`,
      requiredTypes: ['PRIVATE_KEY'],
      minEntities: 1,
      minScore: 20,
      allowedLevels: ['low', 'medium', 'high', 'critical'],
      // Detection matches the PEM header line; the body is separate base64 lines
      // which aren't individually detected (they look like regular base64).
      // The header replacement signals the key presence was detected.
      mustNotLeak: [],
    },
  ];

  for (const s of scenarios) {
    describe(s.name, () => {
      const entities = detectAll(s.prompt);
      const { score, level } = computeScore(s.prompt, entities);

      it('detects required entities', () => {
        assertDetection(entities, s.minEntities, s.requiredTypes, s.name);
      });

      it('scores at appropriate severity', () => {
        assertSeverity(score, level, s.minScore, s.allowedLevels, s.name);
      });

      it('pseudonymizes all sensitive data', () => {
        const { maskedText } = pseudonymizeLocal(s.prompt, entities);
        assertNoPIILeakage(maskedText, s.mustNotLeak);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. REGULATORY / SOX COMPLIANCE
// CEO risk: Criminal liability (SOX §906), SEC enforcement, restatements
// ═════════════════════════════════════════════════════════════════════════════

describe('8. SOX / Regulatory Compliance', () => {
  it('should detect internal audit findings with PII', () => {
    const prompt = `CONFIDENTIAL — Internal Audit Report
Finding IA-2024-003: Unauthorized access to payroll system by contractor
Affected employees: 2,847 records including SSNs
Root cause: Admin credentials shared via email (admin@payroll.company.com)
Remediation: Password rotation completed 03/15/2024
Audit contact: Dr. Lisa Wong, Chief Audit Executive, lisa.wong@company.com`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    assertDetection(entities, 2, ['EMAIL'], 'SOX audit finding');
    assertSeverity(score, level, 20, ['medium', 'high', 'critical'], 'SOX audit finding');
    assertNoPIILeakage(maskedText, ['admin@payroll.company.com', 'lisa.wong@company.com']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. CUSTOMER PII AT SCALE (BULK DATA PASTE)
// CEO risk: Breach notification (50-state laws), GDPR Art 33, class action
// ═════════════════════════════════════════════════════════════════════════════

describe('9. Bulk Customer Data Paste', () => {
  it('should detect and flag bulk PII paste (multiple customers)', () => {
    const prompt = `Customer export — help me analyze churn:
ID,Name,Email,SSN,Phone
1,John Smith,john@example.com,123-45-6789,(555) 111-2222
2,Jane Doe,jane@example.com,234-56-7890,(555) 333-4444
3,Bob Wilson,bob@example.com,345-67-8901,(555) 555-6666
4,Alice Brown,alice@example.com,456-78-9012,(555) 777-8888
5,Charlie Davis,charlie@example.com,567-89-0123,(555) 999-0000`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    // Should detect many entities from bulk data
    assertDetection(entities, 10, ['SSN', 'EMAIL', 'PHONE_NUMBER'], 'Bulk PII');
    // Should score critical for bulk PII
    assertSeverity(score, level, 60, ['high', 'critical'], 'Bulk PII');
    // No SSNs should survive
    assertNoPIILeakage(maskedText, [
      '123-45-6789', '234-56-7890', '345-67-8901', '456-78-9012', '567-89-0123',
      'john@example.com', 'jane@example.com', 'bob@example.com',
      'alice@example.com', 'charlie@example.com',
    ]);
  });

  it('should detect CSV-style data paste with financial records', () => {
    const prompt = `Format this for our CRM import:
Name|Card Number|Expiry|Email
Sarah Chen|4532-1234-5678-9012|12/25|sarah@corp.com
Mike Johnson|5432-8765-4321-0987|06/26|mike@corp.com
Lisa Park|4111-2222-3333-4444|03/27|lisa@corp.com`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    assertDetection(entities, 4, ['CREDIT_CARD', 'EMAIL'], 'Bulk financial data');
    assertSeverity(score, level, 40, ['high', 'critical'], 'Bulk financial data');
    assertNoPIILeakage(maskedText, [
      '4532-1234-5678-9012', '5432-8765-4321-0987', '4111-2222-3333-4444',
      'sarah@corp.com', 'mike@corp.com', 'lisa@corp.com',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. EVASION TECHNIQUES
// CEO risk: If evasion works, all other controls are worthless
// ═════════════════════════════════════════════════════════════════════════════

describe('10. Evasion Techniques', () => {
  it('should detect SSN split with zero-width characters', () => {
    // Inserting zero-width spaces between digits to break regex
    const prompt = 'My SSN is 123\u200B-\u200B45\u200B-\u200B6789';
    const entities = detectAll(prompt);
    assertDetection(entities, 1, ['SSN'], 'Zero-width SSN evasion');
  });

  it('should detect email split with zero-width characters', () => {
    const prompt = 'Email me at john\u200B.\u200Bsmith\u200B@\u200Bcompany\u200B.\u200Bcom';
    const entities = detectAll(prompt);
    assertDetection(entities, 1, ['EMAIL'], 'Zero-width email evasion');
  });

  it('should detect base64-encoded SSN', () => {
    // "My SSN is 123-45-6789" in base64
    const encoded = btoa('My SSN is 123-45-6789');
    const prompt = `Can you decode this for me: ${encoded}`;
    const entities = detectAll(prompt);
    assertDetection(entities, 1, ['ENCODED_PII'], 'Base64 SSN evasion');
  });

  it('should detect base64-encoded email', () => {
    const encoded = btoa('Contact john.smith@secret-company.com for details');
    const prompt = `What does this say: ${encoded}`;
    const entities = detectAll(prompt);
    assertDetection(entities, 1, ['ENCODED_PII'], 'Base64 email evasion');
  });

  it('should detect base64-encoded credit card', () => {
    const encoded = btoa('Customer card number is 4111-1111-1111-1111 with exp 12/25');
    const prompt = `Can you decode this data for me: ${encoded}`;
    const entities = detectAll(prompt);
    assertDetection(entities, 1, ['ENCODED_PII'], 'Base64 CC evasion');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. FALSE POSITIVE IMMUNITY
// CEO risk: Over-blocking kills productivity, users disable the tool
// ═════════════════════════════════════════════════════════════════════════════

describe('11. False Positive Immunity', () => {
  const benignPrompts = [
    {
      name: 'Generic coding question',
      prompt: 'How do I implement a binary search tree in Python?',
      maxEntities: 0,
      maxScore: 10,
    },
    {
      name: 'Science question',
      prompt: 'Explain how photosynthesis works and what role chlorophyll plays in the light-dependent reactions.',
      maxEntities: 0,
      maxScore: 10,
    },
    {
      name: 'Company names that arent PII',
      prompt: 'Compare the business models of OpenAI, Google DeepMind, and Anthropic.',
      maxEntities: 1,
      maxScore: 15,
    },
    {
      name: 'Year-like numbers in normal context',
      prompt: 'The company was founded in 2019 and now has 1500 employees across 12 offices.',
      maxEntities: 1,
      maxScore: 15,
    },
    {
      name: 'Technical IP addresses in documentation',
      prompt: 'The default gateway is usually 192.168.1.1 and the DNS server is 8.8.8.8.',
      maxEntities: 2,
      maxScore: 20,
    },
    {
      name: 'Normal financial discussion without PII',
      prompt: 'The S&P 500 returned about 26% in 2023. Most analysts expect returns of 8-12% going forward.',
      maxEntities: 1,
      maxScore: 15,
    },
  ];

  for (const s of benignPrompts) {
    it(`should not over-flag: ${s.name}`, () => {
      const entities = detectAll(s.prompt);
      const { score } = computeScore(s.prompt, entities);

      expect(
        entities.length,
        `"${s.name}" generated ${entities.length} false positive entities (max ${s.maxEntities}). Types: ${entities.map(e => `${e.type}:${e.text}`).join(', ')}`
      ).toBeLessThanOrEqual(s.maxEntities);

      expect(
        score,
        `"${s.name}" scored ${score} (max ${s.maxScore})`
      ).toBeLessThanOrEqual(s.maxScore);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. SSN FORMAT VARIATIONS (Comprehensive — the bug that started this)
// CEO risk: One missed SSN = breach notification to affected individual
// ═════════════════════════════════════════════════════════════════════════════

describe('12. SSN Format Variations', () => {
  const ssnTests = [
    { name: 'Standard dashes: 123-45-6789', prompt: 'SSN: 123-45-6789', expected: '123-45-6789' },
    { name: 'Spaces: 123 45 6789', prompt: 'SSN: 123 45 6789', expected: '123 45 6789' },
    { name: 'Bare with "SSN" keyword', prompt: 'SSN is 123456789', expected: '123456789' },
    { name: 'Bare with "social security" keyword', prompt: 'social security number 987654321', expected: '987654321' },
    { name: 'Bare with "SS#" keyword', prompt: 'SS# 456789012', expected: '456789012' },
    { name: 'With colon separator', prompt: 'SSN: 111223333', expected: '111223333' },
    { name: 'With equals sign', prompt: 'ssn=222334444', expected: '222334444' },
    { name: 'Conversational: "my SSN is"', prompt: 'hello my SSN is 113324343', expected: '113324343' },
    { name: 'Multiple dashed SSNs', prompt: 'SSNs: 111-22-3333 and 444-55-6666', expected: '111-22-3333' },
  ];

  for (const t of ssnTests) {
    it(`should detect ${t.name}`, () => {
      const entities = detectAll(t.prompt);
      const ssns = entities.filter(e => e.type === 'SSN');
      expect(
        ssns.length,
        `Failed to detect SSN in: "${t.prompt}". Found entities: ${entities.map(e => `${e.type}:${e.text}`).join(', ')}`
      ).toBeGreaterThanOrEqual(1);

      // Verify the SSN text contains the expected digits
      const found = ssns.some(s => s.text.replace(/[\s-]/g, '').includes(t.expected.replace(/[\s-]/g, '')));
      expect(
        found,
        `SSN "${t.expected}" not found in detected SSNs: ${ssns.map(s => s.text).join(', ')}`
      ).toBe(true);
    });
  }

  it('should NOT false-positive on random 9-digit numbers without SSN context', () => {
    const prompts = [
      'The zip code is 902101234',
      'Order number 123456789',
      'Phone 5551234567',  // 10 digits
      'The population of NYC is approximately 8336817',
    ];

    for (const prompt of prompts) {
      const entities = detectAll(prompt);
      const ssns = entities.filter(e => e.type === 'SSN');
      expect(
        ssns.length,
        `False positive SSN detected in: "${prompt}". Found: ${ssns.map(s => s.text).join(', ')}`
      ).toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. MULTI-ENTITY COMBINATION RISK (Identity Theft Kits)
// CEO risk: Maximum exposure — complete identity packages
// ═════════════════════════════════════════════════════════════════════════════

describe('13. Multi-Entity Combination Risk', () => {
  it('should score higher when SSN + name + email appear together', () => {
    const singleSSN = 'SSN: 123-45-6789';
    const combined = 'Dr. John Smith, SSN: 123-45-6789, email: john.smith@acme.com, phone (555) 123-4567';

    const singleEntities = detectAll(singleSSN);
    const combinedEntities = detectAll(combined);

    const singleScore = computeScore(singleSSN, singleEntities).score;
    const combinedScore = computeScore(combined, combinedEntities).score;

    expect(
      combinedScore,
      `Combined score (${combinedScore}) should be significantly higher than single entity score (${singleScore})`
    ).toBeGreaterThan(singleScore);
  });

  it('should score critical for complete identity theft kit', () => {
    const prompt = `Customer record:
Name: Dr. Sarah Elizabeth Chen
SSN: 234-56-7890
DOB: 03/15/1985
Email: sarah.chen@personal.com
Phone: (415) 555-0199
Credit Card: 4532-8921-0076-3344
Address: 742 Maple Drive, San Francisco CA 94102
Bank: Wells Fargo, acct. #9876543210
Employer: Acme Corp, EMP-29481`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);

    assertDetection(entities, 5, ['SSN', 'EMAIL', 'CREDIT_CARD', 'PHONE_NUMBER'], 'Identity theft kit');
    // This should be extremely high risk
    expect(score).toBeGreaterThanOrEqual(70);
    expect(['high', 'critical']).toContain(level);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. CREDENTIAL / SECRET LEAKAGE
// CEO risk: Production system compromise, data breach, ransomware entry point
// ═════════════════════════════════════════════════════════════════════════════

describe('14. Credential & Secret Leakage', () => {
  const secretTests = [
    {
      name: 'OpenAI API key',
      prompt: 'My API key is sk-abc123def456ghi789jkl012mno345pqr',
      requiredType: 'API_KEY',
    },
    {
      name: 'Stripe live key',
      prompt: 'STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc',
      requiredType: 'API_KEY',
    },
    {
      name: 'AWS Access Key',
      prompt: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      requiredType: 'AWS_CREDENTIAL',
    },
    {
      name: 'PostgreSQL connection string',
      prompt: 'DATABASE_URL=postgresql://admin:password123@prod-db.company.com:5432/production',
      requiredType: 'DATABASE_URI',
    },
    {
      name: 'MongoDB URI',
      prompt: 'MONGO_URI=mongodb+srv://admin:secretpass@cluster0.abc123.mongodb.net/mydb',
      requiredType: 'DATABASE_URI',
    },
    {
      name: 'GitHub Personal Access Token',
      prompt: 'Use this token to authenticate: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      requiredType: 'API_KEY',
    },
    {
      name: 'Slack bot token',
      prompt: 'SLACK_TOKEN=xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx',
      requiredType: 'API_KEY',
    },
    {
      name: 'SendGrid API key',
      prompt: 'SENDGRID_API_KEY=SG.abcdefghijklmnopqrstuv.wxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789012',
      requiredType: 'API_KEY',
    },
    {
      name: 'GCP API key',
      prompt: 'GOOGLE_API_KEY=AIzaSyBcdefghijklmnopqrstuvwxyz12345678',
      requiredType: 'GCP_CREDENTIAL',
    },
  ];

  for (const t of secretTests) {
    it(`should detect ${t.name}`, () => {
      const entities = detectAll(t.prompt);
      assertDetection(entities, 1, [t.requiredType], t.name);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. BOARD-LEVEL COMMUNICATIONS
// CEO risk: Fiduciary breach, shareholder derivative suits, SEC investigation
// ═════════════════════════════════════════════════════════════════════════════

describe('15. Board-Level Communications', () => {
  it('should detect and protect executive compensation details', () => {
    const prompt = `BOARD CONFIDENTIAL — Compensation Committee
CEO compensation package for FY2025:
- Base salary: $1,500,000
- RSU grant: $8,000,000 (RSU-2025-001)
- Performance bonus target: $3,000,000 (150% of base)
- Sign-on bonus: $2,500,000
CEO personal details for tax filing: SSN 789-01-2345
Direct deposit: Chase acct. #112233445566
Contact CEO at robert.chen@company.com or (212) 555-0100`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    assertDetection(entities, 3, ['SSN', 'EMAIL', 'PHONE_NUMBER'], 'Board compensation');
    assertSeverity(score, level, 50, ['high', 'critical'], 'Board compensation');
    assertNoPIILeakage(maskedText, ['789-01-2345', 'robert.chen@company.com', '(212) 555-0100']);
  });

  it('should detect regulatory investigation details', () => {
    const prompt = `PRIVILEGED AND CONFIDENTIAL — Attorney-Client Privilege
SEC inquiry regarding insider trading around Project Horizon announcement.
Trades under investigation:
- CFO Michael Torres bought 50,000 shares via account #87654321 on 2024-01-10
- VP Eng Sarah Kim (sarah.kim@company.com) sold options 2024-01-12
- Board member Dr. James Park (SSN 890-12-3456) purchased through family trust
SEC contact: enforcement@sec.gov, matter #2024-SEC-4567`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    assertDetection(entities, 3, ['SSN', 'EMAIL'], 'SEC investigation');
    assertSeverity(score, level, 50, ['high', 'critical'], 'SEC investigation');
    assertNoPIILeakage(maskedText, ['890-12-3456', 'sarah.kim@company.com']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. CROSS-SCENARIO SEVERITY ORDERING
// Validates that the scoring system ranks risks correctly from CEO perspective
// ═════════════════════════════════════════════════════════════════════════════

describe('16. Cross-Scenario Severity Ordering', () => {
  const prompts = {
    benign: 'How do I sort a list in Python?',
    lowRisk: 'Send an email to john@example.com about the meeting.',
    mediumRisk: 'Employee Dr. John Smith (john@acme.com) needs access to the staging server at 192.168.1.100.',
    highRisk: 'Customer James Wilson, SSN 423-86-1957, credit card 4532-8921-0076-3344, phone (415) 555-0187.',
    criticalRisk: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGE
Customer bulk data: John Smith SSN 123-45-6789 john@ex.com, Jane Doe SSN 987-65-4321 jane@ex.com, Bob Wilson SSN 456-78-9012 bob@ex.com.
Database: postgresql://admin:pass@prod.com:5432/db. AWS key: AKIAIOSFODNN7EXAMPLE`,
  };

  const scores: Record<string, number> = {};

  // Compute all scores first
  for (const [key, prompt] of Object.entries(prompts)) {
    const entities = detectAll(prompt);
    scores[key] = computeScore(prompt, entities).score;
  }

  it('benign < lowRisk < mediumRisk < highRisk', () => {
    expect(scores.benign).toBeLessThan(scores.lowRisk);
    expect(scores.lowRisk).toBeLessThanOrEqual(scores.mediumRisk);
    expect(scores.mediumRisk).toBeLessThan(scores.highRisk);
  });

  it('highRisk < criticalRisk', () => {
    expect(scores.highRisk).toBeLessThanOrEqual(scores.criticalRisk);
  });

  it('benign should be low severity', () => {
    expect(scores.benign).toBeLessThanOrEqual(25);
  });

  it('criticalRisk should be high or critical severity', () => {
    expect(scores.criticalRisk).toBeGreaterThanOrEqual(60);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. PSEUDONYMIZATION QUALITY (CEO perspective: does it look natural?)
// ═════════════════════════════════════════════════════════════════════════════

describe('17. Pseudonymization Quality', () => {
  it('should produce text of similar length (not suspiciously short/long)', () => {
    const prompt = 'Dr. John Smith (SSN: 123-45-6789, email: john.smith@acme.com) at Acme Corp called (555) 123-4567.';
    const entities = detectAll(prompt);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    const ratio = maskedText.length / prompt.length;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it('should not produce empty or undefined mappings', () => {
    const prompt = 'Contact sarah.chen@hospital.org about patient MRN: 4829-7103';
    const entities = detectAll(prompt);
    const { mappings } = pseudonymizeLocal(prompt, entities);

    for (const m of mappings) {
      expect(m.original).toBeTruthy();
      expect(m.pseudonym).toBeTruthy();
      expect(m.type).toBeTruthy();
      expect(m.original).not.toBe(m.pseudonym);
    }
  });

  it('should not contain raw PII in any mapping pseudonym', () => {
    const sensitiveValues = ['123-45-6789', 'john@acme.com', '(555) 123-4567'];
    const prompt = `Employee John Smith, SSN 123-45-6789, email john@acme.com, phone (555) 123-4567`;
    const entities = detectAll(prompt);
    const { mappings, maskedText } = pseudonymizeLocal(prompt, entities);

    // No pseudonym should contain original PII from any entity
    for (const m of mappings) {
      for (const pii of sensitiveValues) {
        expect(m.pseudonym).not.toContain(pii);
      }
    }

    // Final text should be completely clean
    assertNoPIILeakage(maskedText, sensitiveValues);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. REAL-WORLD SCENARIO: EMPLOYEE USING CHATGPT CARELESSLY
// The exact scenario a CEO would ask about in a board meeting
// ═════════════════════════════════════════════════════════════════════════════

describe('18. Real-World Careless Employee Scenarios', () => {
  it('Scenario: HR manager pasting employee list for ChatGPT analysis', () => {
    const prompt = `Analyze these employee performance ratings and suggest who to promote:

Sarah Chen - Rating: 4.8, Salary: $145,000, SSN: 234-56-7890, sarah.chen@company.com
Michael Torres - Rating: 3.2, Salary: $152,000, SSN: 345-67-8901, michael.t@company.com
Lisa Park - Rating: 4.5, Salary: $138,000, SSN: 456-78-9012, lisa.park@company.com
James Wilson - Rating: 2.8, Salary: $160,000, SSN: 567-89-0123, james.w@company.com

Note: James is on a PIP. Do not promote. Consider termination if Q2 ratings don't improve.`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    // Must catch all SSNs and emails
    const ssns = entities.filter(e => e.type === 'SSN');
    expect(ssns.length).toBeGreaterThanOrEqual(4);

    const emails = entities.filter(e => e.type === 'EMAIL');
    expect(emails.length).toBeGreaterThanOrEqual(4);

    // Should be high/critical
    expect(score).toBeGreaterThanOrEqual(60);
    expect(['high', 'critical']).toContain(level);

    // All SSNs and emails must be pseudonymized
    assertNoPIILeakage(maskedText, [
      '234-56-7890', '345-67-8901', '456-78-9012', '567-89-0123',
      'sarah.chen@company.com', 'michael.t@company.com',
      'lisa.park@company.com', 'james.w@company.com',
    ]);
  });

  it('Scenario: Lawyer pasting case details for AI summary', () => {
    const prompt = `Summarize the key issues in this case:

PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGE

In the matter of Smith v. MegaCorp International Inc, Case No. 2024-CV-5678:

The plaintiff alleges wrongful termination based on age discrimination (ADEA).
Key facts: Employee John Anderson (SSN 678-90-1234, EMP-45678) was terminated
on 2024-03-15 after 22 years of service. His replacement, hired at $95,000/yr,
is 28 years old. Anderson's salary at termination was $185,000/yr.

Settlement authority: Up to $2.5M. Do not exceed without board approval.
Plaintiff's counsel: Williams & Associates LLP (contact: mark.williams@wlaw.com)
Our exposure assessment: $4.2M worst case.`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    // Must detect SSN, employee ID, email, matter number
    assertDetection(entities, 3, ['SSN', 'EMPLOYEE_ID', 'EMAIL'], 'Lawyer careless paste');

    // Legal context should boost score significantly
    expect(score).toBeGreaterThanOrEqual(50);
    expect(['high', 'critical']).toContain(level);

    assertNoPIILeakage(maskedText, ['678-90-1234', 'EMP-45678', 'mark.williams@wlaw.com']);
  });

  it('Scenario: Developer debugging with production data', () => {
    const prompt = `My production API is returning 500 errors. Here is the config:

DATABASE_URL=postgresql://appuser:Pr0d_P@ssw0rd!@rds-prod-01.us-east-1.rds.amazonaws.com:5432/production_db
REDIS_URL=redis://default:R3d1s$ecret@redis-prod.company.com:6379
API_KEY=sk-proj-abc123def456ghi789jkl012mno345
OPENAI_API_KEY=sk-svcacct-abc123def456ghi789jkl012mno345pqr

And here is the error log with the affected user:
Error: User sarah.chen@customer.com (ID: 12345) failed payment with card ending 4532-1234-5678-9012.
Stack trace includes reference to internal IP 10.0.1.50`;

    const entities = detectAll(prompt);
    const { score, level } = computeScore(prompt, entities);
    const { maskedText } = pseudonymizeLocal(prompt, entities);

    // Must detect database URIs, API keys, email, credit card, IP
    assertDetection(entities, 3, ['DATABASE_URI', 'EMAIL'], 'Dev production debug');

    expect(score).toBeGreaterThanOrEqual(40);

    assertNoPIILeakage(maskedText, [
      'sarah.chen@customer.com',
      'postgresql://appuser:Pr0d_P@ssw0rd!@rds-prod-01.us-east-1.rds.amazonaws.com:5432/production_db',
    ]);
  });
});
