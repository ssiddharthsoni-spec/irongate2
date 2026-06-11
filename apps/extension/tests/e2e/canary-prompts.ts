/**
 * Canary prompts for real-platform regression testing.
 *
 * Each canary corresponds to a bug we've hit during development. The test
 * harness submits these to the real LLM platform and asserts:
 *
 *   1. **Wire**: the actual network request to the platform's API does NOT
 *      contain any of `sensitiveStrings`. This is the security-critical
 *      assertion — if any of these reach the wire, the product has leaked.
 *
 *   2. **Bubble**: after the platform renders the user-message bubble,
 *      Iron Gate's DOM-level de-pseudonymization restores ALL of
 *      `sensitiveStrings` so the user sees their originals back.
 *
 *   3. **Response cleanliness**: the assistant response text contains NONE
 *      of the corruption markers we've seen during the session:
 *      `entity["`, `entity[`, byte-shift artifacts like `tischarge` (where
 *      "dis" was eaten from "discharge"), or raw `cite_turn` citation tokens.
 *
 * Adding a new canary: pick a bug that's hit production, write the prompt
 * that triggers it, list every PII string that MUST never reach the wire.
 * If the test then fails, that's the bug. If it passes, the bug is fixed.
 */

export interface Canary {
  /** Short ID, used in test names and screenshots. */
  id: string;
  /** Human-readable description. */
  name: string;
  /** The literal prompt typed into the platform's input. */
  prompt: string;
  /**
   * Substrings of the prompt that MUST NOT appear in the wire payload.
   * Iron Gate's outbound pseudonymization should replace every one of these.
   */
  sensitiveStrings: string[];
  /**
   * Original substrings that MUST appear in the rendered user bubble after
   * Iron Gate's DOM-level de-pseudo runs. Usually equal to `sensitiveStrings`
   * but can differ if the platform splits the text in ways that prevent
   * exact matching (e.g. SSN rendered as `<span>123</span><span>-45-</span>`).
   */
  expectedInBubble: string[];
}

// Match `entity["category","name"]` and its truncated variants. The regex is
// permissive on the closing bracket since ChatGPT sometimes emits incomplete
// markers when offsets shift.
export const ENTITY_MARKER_RE = /entity\[/;
// Match `cite_turn0search0` and `mainstreciteturn0search0` family of citation
// placeholders that leaked into visible text in earlier builds.
export const CITE_TOKEN_RE = /(?:mainstre)?cite[_a-z]*turn\d+search\d+|turn\d+search\d+/i;

export const CANARIES: Canary[] = [
  {
    id: 'healthcare-discharge',
    name: 'Healthcare discharge note',
    prompt:
      "Summarize this discharge note: Patient Jane Miller, MRN: MED-789012, " +
      "DOB: 10/22/1965. Admitted 03/01/2026 for acute pancreatitis. " +
      "Insurance ID: BCBS-2024-456789. Attending: Dr. Richard Lee, " +
      "NPI: 890 722 3220. Discharged 03/07/2026 on Pantoprazole 40mg.",
    sensitiveStrings: [
      'Jane Miller',
      'MED-789012',
      '10/22/1965',
      'BCBS-2024-456789',
      'Richard Lee',
      '890 722 3220',
    ],
    expectedInBubble: [
      'Jane Miller',
      '10/22/1965',
      'Richard Lee',
    ],
  },
  {
    id: 'legal-litigation-hold',
    name: 'Legal litigation hold notice',
    prompt:
      "Draft a litigation hold notice. Case: Smith v. Acme Corp, " +
      "Case No. 2024-CV-03891. Plaintiff's counsel is attorney " +
      "Michael Roberts at Kirkland & Ellis, mroberts@kirkland.com. " +
      "Client SSN: 321-54-9876. Settlement offer: $1.2 million.",
    sensitiveStrings: [
      'Acme Corp',
      '2024-CV-03891',
      'Michael Roberts',
      'mroberts@kirkland.com',
      '321-54-9876',
    ],
    expectedInBubble: [
      'Acme Corp',
      'Michael Roberts',
      'mroberts@kirkland.com',
      '321-54-9876',
    ],
  },
  {
    id: 'financial-portfolio',
    name: 'Financial portfolio review',
    prompt:
      "Review portfolio for client Rebecca Foster, account #WF-9283746. " +
      "Holdings: 500 shares AAPL at $189.50, 200 shares MSFT at $412.30. " +
      "Total value: $177,210. Advisor: Mark Johnson, CRD# 5678901.",
    sensitiveStrings: [
      'Rebecca Foster',
      'WF-9283746',
      'Mark Johnson',
      '5678901',
    ],
    expectedInBubble: [
      'Rebecca Foster',
      'WF-9283746',
      'Mark Johnson',
    ],
  },
  {
    id: 'env-file-secrets',
    name: '.env file credentials (DEF-016 false-positive check)',
    prompt:
      "Help me debug my .env file: " +
      "DATABASE_URL=postgres://produser:P@ssw0rd!@db.mycompany.com:5432/maindb " +
      "REDIS_URL=redis://default:secretRedis@redis.internal:6379 " +
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE " +
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY " +
      "Stripe_SECRET=sk_live_51HG8v2CjzKLMno9876543",
    sensitiveStrings: [
      'P@ssw0rd!',
      'secretRedis',
      'AKIAIOSFODNN7EXAMPLE',
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'sk_live_51HG8v2CjzKLMno9876543',
    ],
    // Bubble after de-pseudo should still show the user's verbatim text
    expectedInBubble: [
      'DATABASE_URL=postgres',
      'AKIAIOSFODNN7EXAMPLE',
    ],
  },
];
