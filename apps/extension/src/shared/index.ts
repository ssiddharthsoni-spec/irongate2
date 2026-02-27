/**
 * Shared Core — Iron Gate Extension
 *
 * All shared modules re-exported from a single barrel.
 * Import from '@/shared' for clean access to scanner, pseudonymizer, and attestation.
 */

// Scanner
export {
  detectEntities,
  computeRiskScore,
  detectWithRegex,
  computeScore,
  DEFAULT_ENTITY_TYPES,
} from './scanner';

export type {
  DetectedEntity,
  DetectionResult,
  ModelStatus,
  SensitivityLevel,
  SensitivityScore,
  ScoreBreakdown,
} from './scanner';

// Pseudonymizer
export {
  pseudonymize,
  depseudonymize,
  pseudonymizeSameLength,
  pseudonymizeLocal,
} from './pseudonymizer';

export type { PseudonymMapping, PseudonymResult } from './pseudonymizer';

// Attestation
export {
  hashPrompt,
  hmacSign,
  generateSigningKey,
  createAttestation,
  verifyAttestation,
} from './attestation';

export type { AttestationRecord } from './attestation';

// Context-Aware Detection
export {
  applyCoOccurrenceRules,
  classifyContext,
  applyContextAnalysis,
  isCodeContext,
  suppressCodeFalsePositives,
  applyContextAwareDetection,
} from './context-analyzer';

export type {
  CoOccurrenceResult,
  ContextCategory,
  ContextWindowResult,
  ContextAwareResult,
} from './context-analyzer';

// Compliance Packs
export {
  detectCustomEntities,
  applyBoostRules,
  getCompliancePack,
  getAllCompliancePacks,
  detectWithPacks,
  LEGAL_PACK,
  HEALTHCARE_PACK,
  FINANCIAL_PACK,
  COMPLIANCE_PACKS,
} from './compliance-packs';

export type {
  CustomEntityDefinition,
  CompliancePack,
  BoostRule,
} from './compliance-packs';

// Health Reporter
export { runHealthCheck, recordError } from './health-reporter';
export type { HealthStatus } from './health-reporter';

// Graceful Failure
export {
  recordFailure,
  clearFailure,
  getActiveFailures,
  isFailureActive,
  getStatusMessage,
  safeDetect,
  canQueueLocally,
} from './graceful-failure';
export type { FailureMode, FailureState } from './graceful-failure';

// Platform Policy
export {
  checkPlatformPolicy,
  generateBlockOverlay,
  generateJustificationModal,
} from './platform-policy';
export type { PlatformPolicy, PlatformAction, PlatformDecision } from './platform-policy';

// Matter Isolation
export { detectCrossMatterReference } from './matter-isolation';
export type { MatterDefinition, CrossMatterWarning } from './matter-isolation';

// Smart Rewriter
export { smartPseudonymize, smartDepseudonymize } from './smart-rewriter';

// Prompt Templates
export {
  applyTemplate,
  filterTemplates,
  getPracticeGroups,
  DEFAULT_TEMPLATES,
} from './prompt-templates';
export type { PromptTemplate } from './prompt-templates';
