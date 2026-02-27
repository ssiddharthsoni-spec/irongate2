/**
 * Smart Prompt Rewriter — Priority 10.3
 *
 * Instead of replacing "John Smith" with "[PERSON-0001]", uses realistic
 * fake values that produce more natural prompts for better AI responses.
 */

import type { DetectedEntity } from '../detection/types';
import type { PseudonymMapping, PseudonymResult } from '../detection/pseudonymizer';

// Realistic replacement pools
const FAKE_NAMES = [
  'James Wilson', 'Emily Davis', 'Robert Johnson', 'Sarah Miller',
  'Michael Brown', 'Jennifer Taylor', 'David Anderson', 'Lisa Thomas',
  'William Jackson', 'Maria White', 'Richard Harris', 'Patricia Martin',
];

const FAKE_ORGS = [
  'Acme Corp', 'Globex Industries', 'Initech Solutions', 'Vandelay Enterprises',
  'Hooli Technologies', 'Pied Piper Inc', 'Stark Industries', 'Wayne Enterprises',
];

const FAKE_EMAILS = [
  'user1@example.com', 'contact@sample.org', 'info@demo.net',
  'admin@test.com', 'hello@placeholder.io',
];

const FAKE_PHONES = [
  '(555) 123-4567', '(555) 987-6543', '(555) 246-8135',
  '(555) 369-2580', '(555) 741-9630',
];

const FAKE_AMOUNTS = [
  '$100,000', '$250,000', '$500,000', '$1,000,000', '$5,000,000',
];

/**
 * Smart pseudonymize using realistic fake values.
 * Produces more natural-looking text that AI can respond to usefully.
 */
export function smartPseudonymize(
  text: string,
  entities: DetectedEntity[]
): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  const counters: Record<string, number> = {};
  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    let pseudonym = seen.get(normalizedText);

    if (!pseudonym) {
      counters[entity.type] = (counters[entity.type] || 0) + 1;
      pseudonym = generateSmartReplacement(entity.type, counters[entity.type]);
      seen.set(normalizedText, pseudonym);
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
    }

    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  mappings.reverse();
  return { maskedText, mappings };
}

function generateSmartReplacement(type: string, index: number): string {
  const idx = index - 1;

  switch (type) {
    case 'PERSON':
      return FAKE_NAMES[idx % FAKE_NAMES.length];
    case 'ORGANIZATION':
      return FAKE_ORGS[idx % FAKE_ORGS.length];
    case 'EMAIL':
      return FAKE_EMAILS[idx % FAKE_EMAILS.length];
    case 'PHONE_NUMBER':
      return FAKE_PHONES[idx % FAKE_PHONES.length];
    case 'SSN':
      return 'XXX-XX-XXXX';
    case 'CREDIT_CARD':
      return 'XXXX-XXXX-XXXX-0000';
    case 'MONETARY_AMOUNT':
      return FAKE_AMOUNTS[idx % FAKE_AMOUNTS.length];
    case 'IP_ADDRESS':
      return '10.0.0.' + (idx + 1);
    case 'DATE':
      return '01/01/2000';
    case 'ACCOUNT_NUMBER':
      return 'ACCT-' + String(idx + 1).padStart(6, '0');
    case 'MEDICAL_RECORD':
      return 'MRN-' + String(idx + 1).padStart(6, '0');
    case 'PASSPORT_NUMBER':
      return 'X' + String(idx + 1).padStart(8, '0');
    case 'DRIVERS_LICENSE':
      return 'DL-' + String(idx + 1).padStart(7, '0');
    case 'API_KEY':
      return 'sk-test-' + 'x'.repeat(32);
    case 'DATABASE_URI':
      return 'postgres://user:pass@localhost:5432/testdb';
    case 'PRIVATE_KEY':
      return '[REDACTED-KEY]';
    default:
      return `[${type}-${index}]`;
  }
}

/**
 * De-pseudonymize smart replacements back to originals.
 */
export function smartDepseudonymize(
  text: string,
  mappings: PseudonymMapping[]
): string {
  let result = text;
  for (const mapping of mappings) {
    result = result.replaceAll(mapping.pseudonym, mapping.original);
  }
  return result;
}
