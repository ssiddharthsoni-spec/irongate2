// ============================================================================
// Iron Gate — Secret Scanner
// ============================================================================
// Detects API keys, tokens, credentials, and connection strings.
// Critical for dev shop and engineering team segments.
// Secrets are always scored at critical level.
// ============================================================================

interface DetectedSecret {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex';
}

interface SecretPattern {
  type: string;
  patterns: RegExp[];
  confidence: number;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'API_KEY',
    patterns: [
      /\bsk-[a-zA-Z0-9]{20,}\b/g,                          // OpenAI-style
      /\bsk_live_[a-zA-Z0-9]{24,}\b/g,                      // Stripe-style
      /\bsk-ant-[a-zA-Z0-9\-]{20,}\b/g,                     // Anthropic-style
      /\bghp_[a-zA-Z0-9]{36}\b/g,                           // GitHub PAT
      /\bgho_[a-zA-Z0-9]{36}\b/g,                           // GitHub OAuth
      /\bghs_[a-zA-Z0-9]{36}\b/g,                           // GitHub App
      /\bxoxb-[0-9]+-[a-zA-Z0-9]+\b/g,                      // Slack bot token
      /\bxoxp-[0-9]+-[a-zA-Z0-9]+\b/g,                      // Slack user token
      /\bSG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}\b/g,     // SendGrid
    ],
    confidence: 0.95,
  },
  {
    type: 'AWS_CREDENTIAL',
    patterns: [
      /\bAKIA[0-9A-Z]{16}\b/g,                              // AWS Access Key ID
      /\bASIA[0-9A-Z]{16}\b/g,                              // AWS Temp Access Key
    ],
    confidence: 0.95,
  },
  {
    type: 'GCP_CREDENTIAL',
    patterns: [
      /\bAIza[0-9A-Za-z_-]{35}\b/g,                         // GCP API Key
    ],
    confidence: 0.9,
  },
  {
    type: 'DATABASE_URI',
    patterns: [
      /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^\s"']+/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'AUTH_TOKEN',
    patterns: [
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,  // JWT
    ],
    confidence: 0.9,
  },
  {
    type: 'PRIVATE_KEY',
    patterns: [
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    ],
    confidence: 0.99,
  },
];

/**
 * Scan text for secrets (API keys, tokens, credentials).
 * Returns detected secrets with positions and types.
 */
export function scanForSecrets(text: string): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];
  const seen = new Set<string>();

  for (const { type, patterns, confidence } of SECRET_PATTERNS) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const key = `${match.index}-${match.index + match[0].length}-${type}`;
        if (!seen.has(key)) {
          seen.add(key);
          secrets.push({
            type,
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence,
            source: 'regex',
          });
        }
      }
    }
  }

  return secrets;
}
