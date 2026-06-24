/**
 * Key-name sensitivity detector.
 *
 * For structurally-parsed records (env vars, prose key:value pairs), the
 * variable NAME is itself a sensitivity signal — independent of whether the
 * VALUE matches any known credential format. This detector classifies a key
 * name and returns the entity type to apply if the value should be masked
 * regardless of format.
 *
 * Why this layer exists: real-world credentials don't always match published
 * format prefixes. A user testing with `AWS_SECRET_ACCESS_KEY=key-xxxxx`,
 * a generated random `API_KEY=hX7mPq...`, or any custom token format slips
 * past value-format regex but is unmistakably a credential by its name.
 * Without this layer, detection coverage degrades to "only formats we've
 * seen before."
 *
 * Pairs with `structural-parser.ts`: parser hands us `record.key`, this
 * decides if `record.value` should be flagged as a credential, and (since
 * we know record.valueSpan from the parser) the resulting entity has a
 * span that's exact and non-overlapping with anything else.
 */

export type SensitiveKeyType =
  | 'AWS_CREDENTIAL'
  | 'GCP_CREDENTIAL'
  | 'AZURE_CREDENTIAL'
  | 'PRIVATE_KEY'
  | 'API_KEY'
  | 'AUTH_TOKEN'
  | 'DATABASE_URI'
  | 'PASSWORD'
  // Labeled identifiers in prose (healthcare / insurance / finance / identity).
  // All map to existing HIGH_PII entity types so they pseudonymize AND hit the
  // always-critical floor. The LABEL is the signal; value format is irrelevant.
  | 'MEDICAL_RECORD'
  | 'ACCOUNT_NUMBER'
  | 'SSN';

interface KeyClassifier {
  // Tested case-insensitively against the key name.
  pattern: RegExp;
  type: SensitiveKeyType;
  // Confidence: how strongly the name implies sensitivity. Used by dedup
  // tie-breakers when multiple detectors hit the same span.
  confidence: number;
}

// Order matters — first match wins. More specific patterns come first.
const CLASSIFIERS: KeyClassifier[] = [
  // ── Cloud provider credentials (most specific first) ───────────────────
  // AWS: AWS_*KEY, AWS_*SECRET, AWS_SESSION_TOKEN, AWS_ACCESS_KEY_ID, etc.
  // Allow trailing suffixes like _ID, _ARN: e.g. AWS_ACCESS_KEY_ID,
  // AWS_SECRET_ACCESS_KEY both match.
  { pattern: /^(?:AWS|S3)_.*(?:KEY|SECRET|TOKEN|PASSWORD)(?:_[A-Z0-9]+)?$/i, type: 'AWS_CREDENTIAL', confidence: 0.95 },
  // GCP: GCP_KEY, GOOGLE_APPLICATION_CREDENTIALS, GCLOUD_*
  { pattern: /^(?:GCP|GOOGLE|GCLOUD)_.*(?:KEY|SECRET|TOKEN|CREDENTIALS?)(?:_[A-Z0-9]+)?$/i, type: 'GCP_CREDENTIAL', confidence: 0.95 },
  // Azure: AZURE_CLIENT_SECRET, AZURE_TENANT_KEY, AZURE_CLIENT_ID etc.
  { pattern: /^AZURE_.*(?:KEY|SECRET|TOKEN|PASSWORD)(?:_[A-Z0-9]+)?$/i, type: 'AZURE_CREDENTIAL', confidence: 0.95 },

  // ── Private keys ─────────────────────────────────────────────────────────
  { pattern: /(?:^|_)PRIVATE[_-]?KEY(?:$|_)/i, type: 'PRIVATE_KEY', confidence: 0.95 },
  { pattern: /^SSH_.*KEY$/i, type: 'PRIVATE_KEY', confidence: 0.9 },

  // ── Database connection strings ──────────────────────────────────────────
  { pattern: /^(?:DATABASE|DB|MYSQL|POSTGRES|POSTGRESQL|MONGO|MONGODB|REDIS)_(?:URL|URI|CONNECTION)$/i, type: 'DATABASE_URI', confidence: 0.95 },
  { pattern: /^CONNECTION_STRING$/i, type: 'DATABASE_URI', confidence: 0.9 },

  // ── Standalone access-key / token / secret ID patterns ──────────────────
  // Catches `ACCESS_KEY_ID=…` / `SECRET_ACCESS_KEY=…` even without AWS_ prefix
  // (e.g. when paste artifacts strip the leading `AWS_`). Confidence slightly
  // lower than the AWS-prefixed version since the name is more generic.
  { pattern: /^ACCESS[_-]?KEY[_-]?ID$/i, type: 'AWS_CREDENTIAL', confidence: 0.9 },
  { pattern: /^SECRET[_-]?ACCESS[_-]?KEY$/i, type: 'AWS_CREDENTIAL', confidence: 0.9 },

  // ── OAuth / bearer tokens ────────────────────────────────────────────────
  { pattern: /(?:^|_)BEARER[_-]?TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.9 },
  { pattern: /(?:^|_)ACCESS[_-]?TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.9 },
  { pattern: /(?:^|_)REFRESH[_-]?TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.9 },
  { pattern: /(?:^|_)SESSION[_-]?TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.9 },
  { pattern: /(?:^|_)JWT(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.85 },
  { pattern: /(?:^|_)AUTH[_-]?TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.9 },

  // ── Passwords ────────────────────────────────────────────────────────────
  { pattern: /(?:^|_)(?:PASSWORD|PASSWD|PWD)(?:$|_)/i, type: 'PASSWORD', confidence: 0.95 },

  // ── Generic API keys / secrets (catch-all, lower confidence) ─────────────
  // STRIPE_SECRET, STRIPE_API_KEY, GITHUB_TOKEN, SENDGRID_API_KEY, etc.
  { pattern: /^(?:STRIPE|GITHUB|GITLAB|SENDGRID|TWILIO|SLACK|DISCORD|OPENAI|ANTHROPIC)_.*(?:KEY|SECRET|TOKEN)$/i, type: 'API_KEY', confidence: 0.95 },
  // Generic *_SECRET, *_API_KEY, *_TOKEN tail patterns.
  { pattern: /(?:^|_)SECRET(?:$|_)/i, type: 'API_KEY', confidence: 0.85 },
  { pattern: /(?:^|_)API[_-]?KEY(?:$|_)/i, type: 'API_KEY', confidence: 0.9 },
  { pattern: /(?:^|_)CLIENT[_-]?SECRET(?:$|_)/i, type: 'API_KEY', confidence: 0.95 },
  { pattern: /(?:^|_)CREDENTIALS?(?:$|_)/i, type: 'API_KEY', confidence: 0.85 },
  // Bare TOKEN — lower confidence, only if it's exactly TOKEN or *_TOKEN.
  { pattern: /(?:^|_)TOKEN(?:$|_)/i, type: 'AUTH_TOKEN', confidence: 0.8 },
  // Bare KEY — only if specifically *_KEY (avoids matching things like KEYBOARD)
  { pattern: /(?:^|_)KEY$/i, type: 'API_KEY', confidence: 0.7 },

  // ── Labeled identifiers in prose (the label IS the signal) ──────────────
  // These catch values that have NO distinctive format (MRN "MED-789012",
  // Insurance ID "BCBS-2024-456789", "Account: 483726159") which value-format
  // regex can never reliably match. Matched against the prose label after
  // normalizing spaces to underscores (see classifyKeyName), so "Insurance
  // ID" tests as "INSURANCE_ID", "Medical Record Number" as
  // "MEDICAL_RECORD_NUMBER", etc.
  //
  // Healthcare:
  { pattern: /(?:^|_)(?:MRN|MEDICAL[_-]?RECORD(?:[_-]?(?:NO|NUMBER|ID))?|PATIENT[_-]?(?:ID|NO|NUMBER)|CHART[_-]?(?:NO|NUMBER)|NPI)(?:$|_)/i, type: 'MEDICAL_RECORD', confidence: 0.9 },
  // Health insurance identifiers:
  { pattern: /(?:^|_)(?:INSURANCE(?:[_-]?ID)?|MEMBER(?:[_-]?ID)?|POLICY(?:[_-]?(?:NO|NUMBER))?|GROUP(?:[_-]?(?:NO|NUMBER))?|PLAN[_-]?ID|CLAIM(?:[_-]?(?:NO|NUMBER))?|SUBSCRIBER[_-]?ID)(?:$|_)/i, type: 'ACCOUNT_NUMBER', confidence: 0.85 },
  // Financial / banking identifiers:
  { pattern: /(?:^|_)(?:ACCOUNT(?:[_-]?(?:NO|NUMBER))?|ACCT|ROUTING(?:[_-]?(?:NO|NUMBER))?|ABA|IBAN|SWIFT(?:[_-]?(?:CODE|BIC))?|BANK[_-]?ACCOUNT|BENEFICIARY[_-]?ACCOUNT|SORT[_-]?CODE)(?:$|_)/i, type: 'ACCOUNT_NUMBER', confidence: 0.85 },
  // Government / identity numbers:
  { pattern: /(?:^|_)(?:SSN|SOCIAL[_-]?SECURITY(?:[_-]?(?:NO|NUMBER))?|TAX[_-]?ID|TIN|EIN|PASSPORT(?:[_-]?(?:NO|NUMBER))?|DRIVERS?[_-]?LICEN[CS]E)(?:$|_)/i, type: 'SSN', confidence: 0.9 },
];

export interface KeyNameClassification {
  sensitive: boolean;
  type: SensitiveKeyType;
  confidence: number;
}

const NEGATIVE: KeyNameClassification = { sensitive: false, type: 'API_KEY', confidence: 0 };

/**
 * Decide whether the value of an env var with this `key` should be treated
 * as a credential, and what entity type to apply.
 *
 * Returns sensitive=false for keys that don't match any credential pattern.
 */
export function classifyKeyName(key: string | null | undefined): KeyNameClassification {
  if (!key) return NEGATIVE;
  const trimmed = key.trim();
  if (trimmed.length < 3 || trimmed.length > 128) return NEGATIVE;

  // Normalize prose labels to the underscore form the patterns expect:
  // "Insurance ID" → "INSURANCE_ID", "Medical Record Number" →
  // "MEDICAL_RECORD_NUMBER", "Group #" → "GROUP". Trailing punctuation
  // (the "#" from "Group #", stray ".") is stripped. Both the raw and the
  // normalized form are tested so env-var keys (already underscored) and
  // prose labels both match.
  const normalized = trimmed
    .replace(/[#:.]+$/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');

  for (const c of CLASSIFIERS) {
    if (c.pattern.test(trimmed) || c.pattern.test(normalized)) {
      return { sensitive: true, type: c.type, confidence: c.confidence };
    }
  }
  return NEGATIVE;
}

/**
 * True iff `v` is shaped like an identifier/secret rather than prose.
 * Used to gate PROSE-label protection: "Account: 483726159" and
 * "Insurance ID: BCBS-2024-456789" are identifiers (have digits); "Member:
 * Lisa Park" and "Member: John is on the team" are prose (no digit, has
 * spaces) and must fall through to the normal PERSON/ORG detectors instead
 * of being masked as a numeric account. Identifier = contains a digit, OR is
 * a single compact token (no internal whitespace) of length ≥ 5.
 */
export function looksLikeIdentifierValue(v: string): boolean {
  const t = (v || '').trim();
  if (t.length === 0) return false;
  if (/\d/.test(t)) return true;            // any digit → identifier-ish
  if (!/\s/.test(t) && t.length >= 5) return true; // compact single token (codes, keys)
  return false;
}

/**
 * True iff the value `v` looks like a placeholder/template, not real data.
 * Used to suppress key-name detection for values like `<your-key-here>`,
 * `xxxxx`, `${ENV_VAR}` so we don't mask non-credentials and waste swaps.
 *
 * Note: this is INTENTIONALLY conservative — when in doubt, treat as real.
 * Iron Gate's safety posture is to over-pseudonymize rather than under-.
 */
export function isObviousPlaceholder(v: string): boolean {
  if (!v) return true;
  const t = v.trim();
  if (t.length === 0) return true;
  // Empty quotes
  if (t === '""' || t === "''") return true;
  // ${ENV_VAR} or $ENV_VAR shell substitutions (no actual secret value)
  if (/^\$(?:\{[A-Z_][A-Z0-9_]*\}|[A-Z_][A-Z0-9_]*)$/.test(t)) return true;
  // <placeholder>, <YOUR_KEY>, etc.
  if (/^<[^>]{1,80}>$/.test(t)) return true;
  // Pure repetition (xxxxx, *****, etc.) — common placeholder pattern
  if (t.length >= 3 && t.length <= 64 && /^(.)\1+$/.test(t)) return true;
  return false;
}
