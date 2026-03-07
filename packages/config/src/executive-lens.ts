export interface ExecutiveLensRule {
  pattern: string;
  entityTypes: string[];
  autoPrivate: boolean;
  description: string;
}

export const EXECUTIVE_LENS_RULES: Record<string, ExecutiveLensRule[]> = {
  legal: [
    { pattern: 'litigation_strategy', entityTypes: ['PRIVILEGE_MARKER', 'LITIGATION_STRATEGY'], autoPrivate: true, description: 'Litigation strategy with privilege markers' },
    { pattern: 'trade_secret', entityTypes: ['TRADE_SECRET', 'PROPRIETARY_FORMULA'], autoPrivate: true, description: 'Trade secrets or proprietary formulas' },
    { pattern: 'client_matter_privilege', entityTypes: ['CLIENT_MATTER_PAIR', 'PRIVILEGE_MARKER'], autoPrivate: true, description: 'Privileged client-matter content' },
  ],
  finance: [
    { pattern: 'mnpi', entityTypes: ['MNPI', 'FINANCIAL_INSTRUMENT'], autoPrivate: true, description: 'Material non-public information' },
    { pattern: 'deal_leak', entityTypes: ['DEAL_CODENAME', 'MONETARY_AMOUNT'], autoPrivate: true, description: 'Deal codename with financial details' },
  ],
  healthcare: [
    { pattern: 'clinical_phi', entityTypes: ['CLINICAL_DATA', 'MEDICAL_RECORD'], autoPrivate: true, description: 'Clinical data with patient identifiers' },
    { pattern: 'mental_health', entityTypes: ['CLINICAL_DATA', 'PERSON'], autoPrivate: true, description: 'Mental health records with patient names' },
  ],
  technology: [
    { pattern: 'credential_leak', entityTypes: ['API_KEY', 'DATABASE_URI'], autoPrivate: true, description: 'API keys or database credentials' },
    { pattern: 'private_key_exposure', entityTypes: ['PRIVATE_KEY', 'AWS_CREDENTIAL'], autoPrivate: true, description: 'Private keys or cloud credentials' },
  ],
  general: [
    { pattern: 'pii_combo', entityTypes: ['SSN', 'PERSON'], autoPrivate: true, description: 'SSN paired with personal identity' },
    { pattern: 'financial_pii', entityTypes: ['CREDIT_CARD', 'PERSON'], autoPrivate: true, description: 'Credit card with personal identity' },
  ],
};

// ── Industry Weight Profiles ─────────────────────────────────────────────────
// Each profile adjusts entity weights relative to defaults for that industry.
// New firms pick a profile at onboarding; it seeds their starting weights
// before adaptive learning kicks in.

export type IndustryProfileId = 'legal' | 'finance' | 'healthcare' | 'government' | 'technology' | 'general';

export interface IndustryProfile {
  id: IndustryProfileId;
  name: string;
  description: string;
  /** Entity type weight overrides (merged on top of scorer defaults) */
  weights: Record<string, number>;
  /** Semantic classifier clusters to boost for this industry */
  boostedClusters: string[];
  /** Compliance frameworks typically associated with this industry */
  defaultFrameworks: string[];
}

export const INDUSTRY_PROFILES: Record<IndustryProfileId, IndustryProfile> = {
  legal: {
    id: 'legal',
    name: 'Legal / Law Firm',
    description: 'Optimized for attorney-client privilege, litigation strategy, and case management',
    weights: {
      // Boost legal-specific types
      PRIVILEGE_MARKER: 40,       // Default 30 → 40 (privilege is paramount)
      MATTER_NUMBER: 30,          // Default 20 → 30
      CLIENT_MATTER_PAIR: 35,     // Default 25 → 35
      OPPOSING_COUNSEL: 25,       // Default 15 → 25
      LITIGATION_STRATEGY: 40,    // High — case strategy is always sensitive
      TRADE_SECRET: 35,           // Default 30 → 35
      // Reduce noise from common legal document elements
      MONETARY_AMOUNT: 8,         // Default 12 → 8 (amounts in legal docs are routine)
      DATE: 1,                    // Default 2 → 1 (dates everywhere in legal)
      ORGANIZATION: 6,            // Default 8 → 6 (org names are routine in filings)
    },
    boostedClusters: ['legal_strategy', 'board_communications'],
    defaultFrameworks: ['soc2'],
  },

  finance: {
    id: 'finance',
    name: 'Finance / Investment Banking',
    description: 'Optimized for MNPI, deal flow, trading strategy, and regulatory compliance',
    weights: {
      // Boost financial-specific types
      MNPI: 45,                   // Material non-public info is the #1 concern
      DEAL_CODENAME: 35,          // Default 20 → 35
      FINANCIAL_INSTRUMENT: 25,   // Default 15 → 25
      CONFIDENTIAL_METRIC: 30,    // Internal metrics are highly sensitive
      ACCOUNT_NUMBER: 30,         // Default 25 → 30
      // Monetary amounts are MORE sensitive in finance (potential MNPI)
      MONETARY_AMOUNT: 18,        // Default 12 → 18
      // Person names in finance context often indicate insider relationships
      PERSON: 15,                 // Default 10 → 15
    },
    boostedClusters: ['ma_deal', 'financial_intel', 'board_communications'],
    defaultFrameworks: ['soc2', 'glba'],
  },

  healthcare: {
    id: 'healthcare',
    name: 'Healthcare / Life Sciences',
    description: 'Optimized for PHI, clinical data, HIPAA compliance, and patient safety',
    weights: {
      // Boost healthcare-specific types
      MEDICAL_RECORD: 45,         // Default 35 → 45 (PHI is strictly regulated)
      CLINICAL_DATA: 40,          // Clinical data is always sensitive
      // Patient identifiers are critical under HIPAA
      PERSON: 20,                 // Default 10 → 20 (could be patient name)
      DATE: 5,                    // Default 2 → 5 (DOB is PHI under HIPAA)
      PHONE_NUMBER: 20,           // Default 15 → 20
      EMAIL: 18,                  // Default 12 → 18
      // Location can identify patients (HIPAA geographic subdivision rule)
      LOCATION: 8,                // Default 3 → 8
    },
    boostedClusters: ['healthcare_phi'],
    defaultFrameworks: ['hipaa', 'soc2'],
  },

  government: {
    id: 'government',
    name: 'Government / Defense',
    description: 'Optimized for classified information, ITAR/EAR, CUI, and clearance levels',
    weights: {
      // Boost government-specific types
      CLASSIFICATION_MARKING: 50, // Default 40 → 50 (classified is highest priority)
      CUI_MARKING: 40,            // Default 30 → 40
      EXPORT_CONTROL: 40,         // Default 30 → 40 (ITAR violations are criminal)
      // Everything is more sensitive in government context
      PERSON: 15,                 // Default 10 → 15 (cleared personnel)
      ORGANIZATION: 12,           // Default 8 → 12 (agency names can be sensitive)
      LOCATION: 8,                // Default 3 → 8 (facility locations)
      IP_ADDRESS: 15,             // Default 8 → 15 (government network infrastructure)
    },
    boostedClusters: ['government_classified', 'tech_security'],
    defaultFrameworks: ['soc2'],
  },

  technology: {
    id: 'technology',
    name: 'Technology / SaaS',
    description: 'Optimized for source code, credentials, infrastructure, and product secrets',
    weights: {
      // Boost tech-specific types
      API_KEY: 40,                // Default 30 → 40
      AWS_CREDENTIAL: 45,        // Default 35 → 45
      GCP_CREDENTIAL: 40,        // Default 30 → 40
      DATABASE_URI: 45,          // Default 35 → 45
      PRIVATE_KEY: 45,           // Default 40 → 45
      AUTH_TOKEN: 30,            // Default 25 → 30
      IP_ADDRESS: 12,            // Default 8 → 12 (infrastructure leaks)
      // Reduce noise from common tech content
      PERSON: 8,                 // Default 10 → 8 (developer names are routine)
      MONETARY_AMOUNT: 8,        // Default 12 → 8
    },
    boostedClusters: ['tech_security', 'competitive_intel'],
    defaultFrameworks: ['soc2'],
  },

  general: {
    id: 'general',
    name: 'General / Cross-Industry',
    description: 'Balanced defaults for organizations without a specific industry profile',
    weights: {
      // No overrides — use scorer defaults as-is
    },
    boostedClusters: [],
    defaultFrameworks: ['soc2'],
  },
};

/**
 * Get the weight overrides for a given industry profile.
 * Returns an empty object for unknown profile IDs (falls back to scorer defaults).
 */
export function getIndustryWeights(profileId: string): Record<string, number> {
  const profile = INDUSTRY_PROFILES[profileId as IndustryProfileId];
  return profile?.weights ?? {};
}

/**
 * Get the boosted semantic clusters for a given industry.
 */
export function getIndustryBoostedClusters(profileId: string): string[] {
  const profile = INDUSTRY_PROFILES[profileId as IndustryProfileId];
  return profile?.boostedClusters ?? [];
}

/**
 * Get all available industry profile IDs and names (for onboarding UI).
 */
export function getAvailableProfiles(): Array<{ id: string; name: string; description: string }> {
  return Object.values(INDUSTRY_PROFILES).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
}
