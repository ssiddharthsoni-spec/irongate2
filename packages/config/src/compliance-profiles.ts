/**
 * Compliance Framework Profiles
 *
 * Each profile defines entity handling rules, risk multipliers,
 * retention policies, and required controls for a specific regulation.
 * Firms select one or more profiles, and the system enforces the
 * STRICTEST rule when profiles overlap.
 */

export type ComplianceFrameworkId =
  | 'soc2'
  | 'hipaa'
  | 'gdpr'
  | 'pci_dss'
  | 'ccpa'
  | 'glba'
  | 'ferpa'
  | 'custom';

export type EntityAction = 'redact' | 'pseudonymize' | 'flag' | 'block' | 'allow';

export interface EntityHandlingRule {
  entityType: string;
  action: EntityAction;
  riskMultiplier: number;
  justification: string;
}

export interface RetentionPolicy {
  auditLogDays: number;
  eventDataDays: number;
  pseudonymMapDays: number;
  deleteRawPrompts: boolean;
}

export interface ComplianceProfile {
  id: ComplianceFrameworkId;
  name: string;
  shortName: string;
  description: string;
  version: string;
  entityRules: EntityHandlingRule[];
  retentionPolicy: RetentionPolicy;
  requiredControls: string[];
  riskMultiplier: number;
  autoBlockThreshold: number;
  requiresEncryptionAtRest: boolean;
  requiresAuditTrail: boolean;
  reportingFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

// ─── SOC 2 Type II ─────────────────────────────────────────────────────────

export const SOC2_PROFILE: ComplianceProfile = {
  id: 'soc2',
  name: 'SOC 2 Type II',
  shortName: 'SOC 2',
  description: 'Service Organization Control 2 — Trust Services Criteria for security, availability, processing integrity, confidentiality, and privacy.',
  version: '2024',
  entityRules: [
    { entityType: 'SSN', action: 'redact', riskMultiplier: 2.0, justification: 'CC6.1 — Logical access controls for PII' },
    { entityType: 'CREDIT_CARD', action: 'redact', riskMultiplier: 2.0, justification: 'CC6.1 — Financial data protection' },
    { entityType: 'API_KEY', action: 'block', riskMultiplier: 3.0, justification: 'CC6.6 — Credential management' },
    { entityType: 'DATABASE_URI', action: 'block', riskMultiplier: 3.0, justification: 'CC6.6 — System boundary protection' },
    { entityType: 'PRIVATE_KEY', action: 'block', riskMultiplier: 3.0, justification: 'CC6.1 — Cryptographic key management' },
    { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.2, justification: 'P3.1 — Personal information collection controls' },
    { entityType: 'EMAIL', action: 'pseudonymize', riskMultiplier: 1.3, justification: 'P3.1 — Contact information protection' },
    { entityType: 'PHONE_NUMBER', action: 'pseudonymize', riskMultiplier: 1.3, justification: 'P3.1 — Contact information protection' },
    { entityType: 'IP_ADDRESS', action: 'flag', riskMultiplier: 1.1, justification: 'CC7.2 — System monitoring' },
  ],
  retentionPolicy: { auditLogDays: 365, eventDataDays: 365, pseudonymMapDays: 90, deleteRawPrompts: true },
  requiredControls: [
    'Cryptographic audit trail',
    'Access logging for all administrative actions',
    'Encryption at rest for stored data',
    'Incident response procedures documented',
    'Annual penetration testing',
    'Employee security awareness training',
  ],
  riskMultiplier: 1.3,
  autoBlockThreshold: 85,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'quarterly',
};

// ─── HIPAA ──────────────────────────────────────────────────────────────────

export const HIPAA_PROFILE: ComplianceProfile = {
  id: 'hipaa',
  name: 'HIPAA',
  shortName: 'HIPAA',
  description: 'Health Insurance Portability and Accountability Act — Protects individually identifiable health information (PHI).',
  version: '2024',
  entityRules: [
    { entityType: 'MEDICAL_RECORD', action: 'block', riskMultiplier: 3.0, justification: '§164.502 — PHI use and disclosure restrictions' },
    { entityType: 'CLINICAL_DATA', action: 'block', riskMultiplier: 3.0, justification: '§164.502 — Clinical PHI protection' },
    { entityType: 'PERSON', action: 'redact', riskMultiplier: 2.0, justification: '§164.514(b) — De-identification of patient names' },
    { entityType: 'SSN', action: 'redact', riskMultiplier: 2.5, justification: '§164.514(b)(2)(i)(C) — SSN as PHI identifier' },
    { entityType: 'DATE', action: 'pseudonymize', riskMultiplier: 1.5, justification: '§164.514(b)(2)(i)(A) — Dates as PHI identifiers' },
    { entityType: 'PHONE_NUMBER', action: 'redact', riskMultiplier: 2.0, justification: '§164.514(b)(2)(i)(D) — Phone as PHI identifier' },
    { entityType: 'EMAIL', action: 'redact', riskMultiplier: 2.0, justification: '§164.514(b)(2)(i)(E) — Email as PHI identifier' },
    { entityType: 'ACCOUNT_NUMBER', action: 'redact', riskMultiplier: 2.0, justification: '§164.514(b)(2)(i)(J) — Account numbers as PHI' },
    { entityType: 'IP_ADDRESS', action: 'redact', riskMultiplier: 1.8, justification: '§164.514(b)(2)(i)(O) — IP addresses as PHI identifiers' },
    { entityType: 'LOCATION', action: 'pseudonymize', riskMultiplier: 1.5, justification: '§164.514(b)(2)(i)(B) — Geographic data smaller than state' },
  ],
  retentionPolicy: { auditLogDays: 2190, eventDataDays: 2190, pseudonymMapDays: 365, deleteRawPrompts: true },
  requiredControls: [
    'Business Associate Agreement (BAA) with AI vendor',
    'Access controls with unique user identification',
    'Automatic logoff after inactivity',
    'Audit controls for PHI access',
    'Encryption of PHI in transit and at rest',
    'Breach notification procedures',
    'Risk assessment documentation',
    'Workforce training on PHI handling',
  ],
  riskMultiplier: 2.0,
  autoBlockThreshold: 60,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'monthly',
};

// ─── GDPR ───────────────────────────────────────────────────────────────────

export const GDPR_PROFILE: ComplianceProfile = {
  id: 'gdpr',
  name: 'GDPR',
  shortName: 'GDPR',
  description: 'General Data Protection Regulation — EU regulation for personal data protection and privacy rights.',
  version: '2024',
  entityRules: [
    { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'Art. 4(5) — Pseudonymisation as safeguard' },
    { entityType: 'EMAIL', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'Art. 4(1) — Email as personal data identifier' },
    { entityType: 'PHONE_NUMBER', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'Art. 4(1) — Phone as personal data identifier' },
    { entityType: 'LOCATION', action: 'pseudonymize', riskMultiplier: 1.3, justification: 'Art. 4(1) — Location as personal data' },
    { entityType: 'SSN', action: 'redact', riskMultiplier: 2.5, justification: 'Art. 9 — National identification numbers as special category' },
    { entityType: 'MEDICAL_RECORD', action: 'redact', riskMultiplier: 2.5, justification: 'Art. 9(1) — Health data as special category' },
    { entityType: 'CLINICAL_DATA', action: 'redact', riskMultiplier: 2.5, justification: 'Art. 9(1) — Health data as special category' },
    { entityType: 'IP_ADDRESS', action: 'pseudonymize', riskMultiplier: 1.3, justification: 'Recital 30 — IP addresses as personal data' },
    { entityType: 'PASSPORT_NUMBER', action: 'redact', riskMultiplier: 2.0, justification: 'Art. 87 — National identification number processing' },
    { entityType: 'CREDIT_CARD', action: 'redact', riskMultiplier: 2.0, justification: 'Art. 4(1) — Financial identifiers as personal data' },
  ],
  retentionPolicy: { auditLogDays: 1095, eventDataDays: 730, pseudonymMapDays: 365, deleteRawPrompts: true },
  requiredControls: [
    'Data Protection Impact Assessment (DPIA)',
    'Lawful basis for processing documented',
    'Data subject rights procedures (access, erasure, portability)',
    'Data breach notification within 72 hours',
    'Data Processing Agreement (DPA) with AI vendor',
    'Records of processing activities (Art. 30)',
    'Data Protection Officer (DPO) appointment if required',
    'Cross-border transfer safeguards (SCCs or adequacy)',
  ],
  riskMultiplier: 1.5,
  autoBlockThreshold: 70,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'monthly',
};

// ─── PCI DSS ────────────────────────────────────────────────────────────────

export const PCI_DSS_PROFILE: ComplianceProfile = {
  id: 'pci_dss',
  name: 'PCI DSS v4.0',
  shortName: 'PCI DSS',
  description: 'Payment Card Industry Data Security Standard — Protects cardholder data and sensitive authentication data.',
  version: '4.0',
  entityRules: [
    { entityType: 'CREDIT_CARD', action: 'block', riskMultiplier: 5.0, justification: 'Req 3.4 — PAN must be rendered unreadable' },
    { entityType: 'ACCOUNT_NUMBER', action: 'block', riskMultiplier: 3.0, justification: 'Req 3 — Cardholder data protection' },
    { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'Req 3.3 — Cardholder name protection' },
    { entityType: 'API_KEY', action: 'block', riskMultiplier: 3.0, justification: 'Req 8.6 — Service account credential protection' },
    { entityType: 'AUTH_TOKEN', action: 'block', riskMultiplier: 3.0, justification: 'Req 8.3 — Authentication data protection' },
    { entityType: 'DATABASE_URI', action: 'block', riskMultiplier: 3.0, justification: 'Req 6.3 — Secure application development' },
  ],
  retentionPolicy: { auditLogDays: 365, eventDataDays: 365, pseudonymMapDays: 90, deleteRawPrompts: true },
  requiredControls: [
    'Network segmentation for cardholder data environment',
    'Strong cryptography for PAN storage',
    'Access restricted on need-to-know basis',
    'Unique ID for each person with access',
    'Logging of all access to cardholder data',
    'Regular vulnerability scanning',
    'Penetration testing at least annually',
    'Incident response plan tested annually',
  ],
  riskMultiplier: 2.5,
  autoBlockThreshold: 50,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'quarterly',
};

// ─── CCPA ───────────────────────────────────────────────────────────────────

export const CCPA_PROFILE: ComplianceProfile = {
  id: 'ccpa',
  name: 'CCPA / CPRA',
  shortName: 'CCPA',
  description: 'California Consumer Privacy Act — California consumer data privacy rights and business obligations.',
  version: '2024',
  entityRules: [
    { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.3, justification: '§1798.140(v) — Name as personal information' },
    { entityType: 'EMAIL', action: 'pseudonymize', riskMultiplier: 1.3, justification: '§1798.140(v) — Email as personal information' },
    { entityType: 'SSN', action: 'redact', riskMultiplier: 2.0, justification: '§1798.140(v)(1)(A) — SSN as personal information' },
    { entityType: 'DRIVERS_LICENSE', action: 'redact', riskMultiplier: 2.0, justification: '§1798.140(v)(1)(A) — DL as personal information' },
    { entityType: 'PASSPORT_NUMBER', action: 'redact', riskMultiplier: 2.0, justification: '§1798.140(v)(1)(A) — Passport as personal information' },
    { entityType: 'PHONE_NUMBER', action: 'pseudonymize', riskMultiplier: 1.3, justification: '§1798.140(v) — Phone as personal information' },
    { entityType: 'LOCATION', action: 'flag', riskMultiplier: 1.1, justification: '§1798.140(v)(1)(G) — Geolocation data' },
    { entityType: 'IP_ADDRESS', action: 'flag', riskMultiplier: 1.1, justification: '§1798.140(v) — Online identifiers' },
    { entityType: 'CREDIT_CARD', action: 'redact', riskMultiplier: 2.0, justification: '§1798.140(v)(1)(A) — Financial information' },
  ],
  retentionPolicy: { auditLogDays: 730, eventDataDays: 365, pseudonymMapDays: 180, deleteRawPrompts: true },
  requiredControls: [
    'Consumer data request procedures (access, delete, opt-out)',
    'Privacy policy disclosing AI tool usage',
    'Data inventory and mapping',
    'Service provider agreements for data processing',
    'Reasonable security measures implementation',
    'Employee training on consumer rights',
  ],
  riskMultiplier: 1.2,
  autoBlockThreshold: 75,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'quarterly',
};

// ─── GLBA ───────────────────────────────────────────────────────────────────

export const GLBA_PROFILE: ComplianceProfile = {
  id: 'glba',
  name: 'GLBA',
  shortName: 'GLBA',
  description: 'Gramm-Leach-Bliley Act — Protects consumers\' nonpublic personal financial information held by financial institutions.',
  version: '2024',
  entityRules: [
    { entityType: 'SSN', action: 'redact', riskMultiplier: 2.5, justification: '§6802 — Nonpublic personal information protection' },
    { entityType: 'ACCOUNT_NUMBER', action: 'redact', riskMultiplier: 2.5, justification: '§6802 — Account number as NPI' },
    { entityType: 'CREDIT_CARD', action: 'redact', riskMultiplier: 2.5, justification: '§6802 — Credit card as NPI' },
    { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.5, justification: '§6802 — Consumer identity protection' },
    { entityType: 'FINANCIAL_INSTRUMENT', action: 'flag', riskMultiplier: 1.5, justification: 'Safeguards Rule — Financial instrument data' },
    { entityType: 'MONETARY_AMOUNT', action: 'flag', riskMultiplier: 1.3, justification: 'Safeguards Rule — Transaction amount protection' },
    { entityType: 'MNPI', action: 'block', riskMultiplier: 3.0, justification: '§6802 — Material nonpublic information' },
  ],
  retentionPolicy: { auditLogDays: 1825, eventDataDays: 1825, pseudonymMapDays: 365, deleteRawPrompts: true },
  requiredControls: [
    'Information Security Program (ISP) designation',
    'Risk assessment for customer information',
    'Safeguards Rule compliance',
    'Privacy notice to customers',
    'Service provider oversight',
    'Incident response plan',
  ],
  riskMultiplier: 1.8,
  autoBlockThreshold: 65,
  requiresEncryptionAtRest: true,
  requiresAuditTrail: true,
  reportingFrequency: 'quarterly',
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const COMPLIANCE_PROFILES: Record<ComplianceFrameworkId, ComplianceProfile> = {
  soc2: SOC2_PROFILE,
  hipaa: HIPAA_PROFILE,
  gdpr: GDPR_PROFILE,
  pci_dss: PCI_DSS_PROFILE,
  ccpa: CCPA_PROFILE,
  glba: GLBA_PROFILE,
  ferpa: {
    id: 'ferpa',
    name: 'FERPA',
    shortName: 'FERPA',
    description: 'Family Educational Rights and Privacy Act — Protects student education records.',
    version: '2024',
    entityRules: [
      { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.5, justification: '§99.3 — Student identity protection' },
      { entityType: 'SSN', action: 'redact', riskMultiplier: 2.0, justification: '§99.3 — SSN as education record identifier' },
      { entityType: 'DATE', action: 'pseudonymize', riskMultiplier: 1.2, justification: '§99.3 — Date of birth in education records' },
      { entityType: 'EMAIL', action: 'pseudonymize', riskMultiplier: 1.3, justification: '§99.3 — Student contact information' },
      { entityType: 'ACCOUNT_NUMBER', action: 'redact', riskMultiplier: 1.5, justification: '§99.3 — Student ID numbers' },
    ],
    retentionPolicy: { auditLogDays: 1825, eventDataDays: 730, pseudonymMapDays: 365, deleteRawPrompts: true },
    requiredControls: [
      'Annual notification to parents/eligible students',
      'Written consent for disclosure',
      'Directory information designation',
      'Record of disclosures maintained',
      'Complaint procedures established',
    ],
    riskMultiplier: 1.3,
    autoBlockThreshold: 70,
    requiresEncryptionAtRest: true,
    requiresAuditTrail: true,
    reportingFrequency: 'monthly',
  },
  custom: {
    id: 'custom',
    name: 'Custom Profile',
    shortName: 'Custom',
    description: 'Custom compliance profile configured by the firm administrator.',
    version: '1.0',
    entityRules: [],
    retentionPolicy: { auditLogDays: 365, eventDataDays: 365, pseudonymMapDays: 90, deleteRawPrompts: true },
    requiredControls: [],
    riskMultiplier: 1.0,
    autoBlockThreshold: 80,
    requiresEncryptionAtRest: false,
    requiresAuditTrail: false,
    reportingFrequency: 'monthly',
  },
};

/**
 * Given multiple active profiles, compute the merged entity handling rules.
 * Uses the STRICTEST rule when profiles overlap on an entity type.
 */
export function mergeEntityRules(profileIds: ComplianceFrameworkId[]): EntityHandlingRule[] {
  const ACTION_SEVERITY: Record<EntityAction, number> = {
    allow: 0,
    flag: 1,
    pseudonymize: 2,
    redact: 3,
    block: 4,
  };

  const merged = new Map<string, EntityHandlingRule>();

  for (const id of profileIds) {
    const profile = COMPLIANCE_PROFILES[id];
    if (!profile) continue;
    for (const rule of profile.entityRules) {
      const existing = merged.get(rule.entityType);
      if (!existing || ACTION_SEVERITY[rule.action] > ACTION_SEVERITY[existing.action]) {
        merged.set(rule.entityType, rule);
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * Compute the effective risk multiplier for a set of active profiles.
 * Returns the maximum multiplier across all profiles.
 */
export function getEffectiveRiskMultiplier(profileIds: ComplianceFrameworkId[]): number {
  let max = 1.0;
  for (const id of profileIds) {
    const profile = COMPLIANCE_PROFILES[id];
    if (profile && profile.riskMultiplier > max) max = profile.riskMultiplier;
  }
  return max;
}

/**
 * Get the strictest auto-block threshold across active profiles.
 * Returns the LOWEST threshold (most restrictive).
 */
export function getEffectiveBlockThreshold(profileIds: ComplianceFrameworkId[]): number {
  let min = 100;
  for (const id of profileIds) {
    const profile = COMPLIANCE_PROFILES[id];
    if (profile && profile.autoBlockThreshold < min) min = profile.autoBlockThreshold;
  }
  return min;
}
