export { detect, detectFirmAware } from './detector';
export { score, scoreFirmAware } from './scorer';
export type { ScoreResult, SensitivityLevel } from './scorer';
export { classifyIntent, getIntentWeight, isQuickPassthrough } from './intent-classifier';
export type { IntentClassification, IntentCategory, IntentDirection } from './intent-classifier';
export { detectStructure } from './structure-detector';
export type { StructureDetectionResult, StructureType } from './structure-detector';
export { contextualizeEntities, getContextRiskMultiplier } from './entity-contextualizer';
export type { ContextualizedEntity, EntityContext } from './entity-contextualizer';
