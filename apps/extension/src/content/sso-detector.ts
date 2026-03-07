/**
 * SSO Account Detection for AI Tool Pages
 *
 * Detects whether the current user on an AI tool page is using a corporate SSO
 * account or a personal account. This enables policy tiering: full enforcement
 * (blocking, pseudonymization) for corporate accounts, warning-only for personal.
 *
 * Detection methods:
 * 1. DOM inspection for corporate email domains in profile/settings elements
 * 2. SSO provider markers (Okta, Azure AD, Google Workspace session cookies/DOM)
 * 3. Comparison against known corporate email domains from firm config
 * 4. URL-based SSO indicators (e.g., /sso/, /saml/, /oauth/)
 */

export type AccountType = 'corporate' | 'personal' | 'unknown';

export interface SSODetectionResult {
  accountType: AccountType;
  emailDomain?: string;
  ssoProvider?: string;
  confidence: number; // 0-1
}

// ── SSO Provider Signatures ──────────────────────────────────────────────────
// DOM markers and URL patterns that indicate enterprise SSO login.

interface SSOProviderSignature {
  name: string;
  /** DOM selectors that indicate this SSO provider is active */
  domSelectors: string[];
  /** URL substrings that indicate SSO login flow */
  urlPatterns: RegExp[];
  /** Meta tag or attribute patterns */
  metaPatterns: Array<{ name: string; contentPattern: RegExp }>;
}

const SSO_PROVIDERS: SSOProviderSignature[] = [
  {
    name: 'Okta',
    domSelectors: [
      '[data-okta-uid]',
      '.okta-sign-in',
      '#okta-sign-in',
      '[class*="okta"]',
    ],
    urlPatterns: [
      /\.okta\.com/i,
      /\/sso\/okta/i,
      /oktapreview\.com/i,
    ],
    metaPatterns: [
      { name: 'okta-template', contentPattern: /.+/ },
    ],
  },
  {
    name: 'Azure AD',
    domSelectors: [
      '[data-aad-tenant]',
      '[class*="microsoft-auth"]',
      '#azure-ad-container',
    ],
    urlPatterns: [
      /login\.microsoftonline\.com/i,
      /\/\.auth\/login\/aad/i,
      /\/saml2\/idp/i,
    ],
    metaPatterns: [
      { name: 'ms-identity', contentPattern: /.+/ },
    ],
  },
  {
    name: 'Google Workspace',
    domSelectors: [
      '[data-google-workspace]',
      '[data-hd]', // hosted domain marker
    ],
    urlPatterns: [
      /accounts\.google\.com\/.*hd=/i,
      /\/ServiceLogin\?.*hd=/i,
    ],
    metaPatterns: [],
  },
  {
    name: 'SAML',
    domSelectors: [],
    urlPatterns: [
      /\/saml\//i,
      /\/sso\//i,
      /\/saml2\//i,
      /SAMLRequest/i,
      /SAMLResponse/i,
    ],
    metaPatterns: [],
  },
  {
    name: 'OneLogin',
    domSelectors: [
      '[class*="onelogin"]',
      '#onelogin-container',
    ],
    urlPatterns: [
      /\.onelogin\.com/i,
      /\/sso\/onelogin/i,
    ],
    metaPatterns: [],
  },
  {
    name: 'Auth0',
    domSelectors: [
      '[class*="auth0"]',
      '#auth0-lock-container',
    ],
    urlPatterns: [
      /\.auth0\.com/i,
      /\/authorize\?.*connection=/i,
    ],
    metaPatterns: [],
  },
];

// ── Known personal email domains ─────────────────────────────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com',
  'proton.me', 'mail.com', 'zoho.com', 'yandex.com', 'gmx.com',
  'gmx.net', 'fastmail.com', 'tutanota.com', 'tuta.com',
  'hey.com', 'pm.me', 'inbox.com',
]);

// ── AI tool profile selectors ────────────────────────────────────────────────
// Selectors where AI tools typically display the logged-in user's email.

interface AIToolProfileSelector {
  aiToolId: string;
  /** CSS selectors that may contain the user's email address */
  emailSelectors: string[];
}

const AI_TOOL_PROFILE_SELECTORS: AIToolProfileSelector[] = [
  {
    aiToolId: 'chatgpt',
    emailSelectors: [
      '[data-testid="profile-button"]',
      '.text-token-text-secondary',
      'nav [class*="email"]',
      '[class*="user-email"]',
      '[class*="account"] [class*="email"]',
    ],
  },
  {
    aiToolId: 'claude',
    emailSelectors: [
      '[data-testid="user-menu"]',
      '[class*="user-email"]',
      '[class*="account-email"]',
      'button[class*="user"] span',
    ],
  },
  {
    aiToolId: 'gemini',
    emailSelectors: [
      '[data-email]',
      'a[href*="SignOutOptions"] + div',
      '[class*="gb_"] [data-email]',
      'header [aria-label*="Account"]',
    ],
  },
  {
    aiToolId: 'copilot',
    emailSelectors: [
      '[data-testid="user-profile"]',
      '#mectrl_currentAccount_secondary',
      '[class*="account-info"] [class*="email"]',
    ],
  },
];

// ── Email Extraction ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Extract email addresses from text content of DOM elements matching selectors.
 */
function extractEmailsFromDOM(selectors: string[]): string[] {
  const emails: string[] = [];
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        // Check textContent
        const text = el.textContent?.trim() ?? '';
        const match = text.match(EMAIL_REGEX);
        if (match) {
          emails.push(match[0].toLowerCase());
        }
        // Check data attributes
        const dataEmail = (el as HTMLElement).dataset?.email;
        if (dataEmail) {
          const attrMatch = dataEmail.match(EMAIL_REGEX);
          if (attrMatch) {
            emails.push(attrMatch[0].toLowerCase());
          }
        }
        // Check aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          const ariaMatch = ariaLabel.match(EMAIL_REGEX);
          if (ariaMatch) {
            emails.push(ariaMatch[0].toLowerCase());
          }
        }
      }
    } catch {
      // Selector may be invalid or DOM access restricted
    }
  }
  return [...new Set(emails)]; // deduplicate
}

/**
 * Broad DOM scan for any visible email address on the page.
 * Only checks likely profile/settings regions to limit performance impact.
 */
function broadEmailScan(): string[] {
  const candidates: string[] = [];
  const profileRegions = document.querySelectorAll(
    'nav, header, [role="banner"], [class*="profile"], [class*="account"], ' +
    '[class*="settings"], [class*="user"], [id*="profile"], [id*="account"]'
  );
  for (const region of profileRegions) {
    const text = region.textContent ?? '';
    const matches = text.match(new RegExp(EMAIL_REGEX.source, 'g'));
    if (matches) {
      for (const m of matches) {
        candidates.push(m.toLowerCase());
      }
    }
  }
  return [...new Set(candidates)];
}

// ── SSO URL Detection ────────────────────────────────────────────────────────

function detectSSOFromURL(): { provider: string; confidence: number } | null {
  const url = window.location.href;
  const referrer = document.referrer;

  for (const provider of SSO_PROVIDERS) {
    for (const pattern of provider.urlPatterns) {
      if (pattern.test(url) || pattern.test(referrer)) {
        return { provider: provider.name, confidence: 0.7 };
      }
    }
  }
  return null;
}

// ── SSO DOM Detection ────────────────────────────────────────────────────────

function detectSSOFromDOM(): { provider: string; confidence: number } | null {
  for (const provider of SSO_PROVIDERS) {
    // Check DOM selectors
    for (const selector of provider.domSelectors) {
      try {
        if (document.querySelector(selector)) {
          return { provider: provider.name, confidence: 0.6 };
        }
      } catch {
        // Invalid selector — skip
      }
    }

    // Check meta tags
    for (const meta of provider.metaPatterns) {
      const metaEl = document.querySelector(`meta[name="${meta.name}"]`);
      if (metaEl) {
        const content = metaEl.getAttribute('content') ?? '';
        if (meta.contentPattern.test(content)) {
          return { provider: provider.name, confidence: 0.5 };
        }
      }
    }
  }
  return null;
}

// ── Domain Classification ────────────────────────────────────────────────────

function classifyDomain(
  emailDomain: string,
  corporateDomains: string[],
): AccountType {
  // Normalize for comparison
  const normalized = emailDomain.toLowerCase().trim();

  // Check against corporate domains list
  const normalizedCorporate = corporateDomains.map(d => d.toLowerCase().trim());
  if (normalizedCorporate.includes(normalized)) {
    return 'corporate';
  }

  // Check known personal domains
  if (PERSONAL_DOMAINS.has(normalized)) {
    return 'personal';
  }

  // Unknown domain that is not in the personal list — likely corporate
  // but we cannot be certain without it being in the corporate list
  return 'unknown';
}

// ── Main Detection Function ──────────────────────────────────────────────────

/**
 * Detect whether the current user on an AI tool page is using a corporate SSO
 * account or a personal account.
 *
 * @param corporateDomains - List of known corporate email domains from the firm config
 * @param aiToolId - Identifier for the current AI tool (e.g., 'chatgpt', 'claude')
 * @returns Detection result with account type, confidence, and metadata
 */
export function detectAccountType(
  corporateDomains: string[],
  aiToolId: string,
): SSODetectionResult {
  let bestResult: SSODetectionResult = {
    accountType: 'unknown',
    confidence: 0,
  };

  // ── Method 1: Check AI tool-specific profile selectors for email ──────
  const toolSelectors = AI_TOOL_PROFILE_SELECTORS.find(t => t.aiToolId === aiToolId);
  if (toolSelectors) {
    const emails = extractEmailsFromDOM(toolSelectors.emailSelectors);
    for (const email of emails) {
      const domain = email.split('@')[1];
      if (domain) {
        const accountType = classifyDomain(domain, corporateDomains);
        const confidence = accountType === 'corporate' ? 0.95
          : accountType === 'personal' ? 0.9
          : 0.5;
        if (confidence > bestResult.confidence) {
          bestResult = { accountType, emailDomain: domain, confidence };
        }
      }
    }
  }

  // ── Method 2: Broad DOM scan for emails in profile regions ────────────
  if (bestResult.confidence < 0.8) {
    const broadEmails = broadEmailScan();
    for (const email of broadEmails) {
      const domain = email.split('@')[1];
      if (domain) {
        const accountType = classifyDomain(domain, corporateDomains);
        // Broad scan is less reliable than tool-specific selectors
        const confidence = accountType === 'corporate' ? 0.8
          : accountType === 'personal' ? 0.75
          : 0.4;
        if (confidence > bestResult.confidence) {
          bestResult = { accountType, emailDomain: domain, confidence };
        }
      }
    }
  }

  // ── Method 3: SSO provider detection via URL ──────────────────────────
  const urlSSO = detectSSOFromURL();
  if (urlSSO && bestResult.accountType !== 'personal') {
    // SSO URL markers strongly suggest corporate usage
    if (bestResult.confidence < urlSSO.confidence) {
      bestResult = {
        accountType: 'corporate',
        ssoProvider: urlSSO.provider,
        confidence: urlSSO.confidence,
        emailDomain: bestResult.emailDomain,
      };
    } else if (bestResult.accountType === 'corporate') {
      // Augment with SSO provider info
      bestResult.ssoProvider = urlSSO.provider;
      bestResult.confidence = Math.min(1, bestResult.confidence + 0.1);
    }
  }

  // ── Method 4: SSO provider detection via DOM markers ──────────────────
  if (bestResult.confidence < 0.7) {
    const domSSO = detectSSOFromDOM();
    if (domSSO) {
      if (bestResult.accountType === 'unknown') {
        bestResult = {
          accountType: 'corporate',
          ssoProvider: domSSO.provider,
          confidence: domSSO.confidence,
          emailDomain: bestResult.emailDomain,
        };
      } else if (bestResult.accountType === 'corporate') {
        bestResult.ssoProvider = domSSO.provider;
        bestResult.confidence = Math.min(1, bestResult.confidence + 0.1);
      }
    }
  }

  return bestResult;
}

// ── Exported Utilities ───────────────────────────────────────────────────────

/** Check if a given domain is a known personal email provider. */
export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase().trim());
}

/** Get the list of known personal domains (for testing/admin). */
export function getPersonalDomains(): ReadonlySet<string> {
  return PERSONAL_DOMAINS;
}
