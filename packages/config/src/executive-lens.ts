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
