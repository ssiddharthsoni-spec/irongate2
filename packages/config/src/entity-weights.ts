import type { EntityType } from '@iron-gate/types';

/**
 * Weight configuration for entity types in sensitivity scoring.
 * Higher weights = more sensitive entity types.
 */
export const ENTITY_WEIGHTS: Record<EntityType, number> = {
  PERSON: 10,
  ORGANIZATION: 8,
  LOCATION: 3,
  DATE: 2,
  PHONE_NUMBER: 15,
  EMAIL: 12,
  CREDIT_CARD: 30,
  SSN: 40,
  MONETARY_AMOUNT: 12,
  ACCOUNT_NUMBER: 25,
  IP_ADDRESS: 8,
  MEDICAL_RECORD: 35,
  PASSPORT_NUMBER: 35,
  DRIVERS_LICENSE: 30,
  MATTER_NUMBER: 20,
  CLIENT_MATTER_PAIR: 25,
  PRIVILEGE_MARKER: 30,
  DEAL_CODENAME: 20,
  OPPOSING_COUNSEL: 15,
  // Secret/credential types
  API_KEY: 50,
  DATABASE_URI: 50,
  AUTH_TOKEN: 45,
  PRIVATE_KEY: 50,
  AWS_CREDENTIAL: 50,
  GCP_CREDENTIAL: 45,
  AZURE_CREDENTIAL: 45,
  // Industry-specific entity types
  FINANCIAL_INSTRUMENT: 30,
  TRADE_SECRET: 50,
  LITIGATION_STRATEGY: 45,
  PROPRIETARY_FORMULA: 50,
  MNPI: 50,
  CLINICAL_DATA: 40,
  CONFIDENTIAL_METRIC: 35,
};

export const LEGAL_KEYWORDS = [
  'privileged',
  'attorney-client',
  'work product',
  'without prejudice',
  'confidential',
  'under seal',
  'protective order',
  'settlement',
  'mediation',
  'arbitration',
  'deposition',
  'subpoena',
  'motion to compel',
  'discovery',
  'litigation hold',
  'retainer',
  'engagement letter',
  'fee agreement',
  'conflict check',
  'ethical wall',
];

export const PRIVILEGE_MARKERS = [
  'attorney-client privilege',
  'work product doctrine',
  'privileged and confidential',
  'attorney work product',
  'protected communication',
  'legal professional privilege',
  'litigation privilege',
  'common interest privilege',
  'joint defense privilege',
];
