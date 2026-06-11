// ============================================================================
// @core — Pure business logic. No Chrome APIs. No DOM. No React.
//
// Compiles independently. Runs in Node for tests. This is where the
// detectors, judgment interface, dedupe resolver, and evidence bundler live.
// ============================================================================

// Contracts
export type { Detection, EntityType, DetectorSource } from '../contracts/entities';
export { ENTITY_TYPES, BRIGHT_LINE_TYPES, VALUE_TYPES, VERDICTS, LEVELS } from '../contracts/entities';
export type { EvidenceBundle, FirmPolicySnapshot, ContextualSignal, BrightLineFlag } from '../contracts/evidence';
export { DEFAULT_FIRM_POLICY } from '../contracts/evidence';
export type { Judgment, Verdict, JudgmentSource, JudgedEntity, AffectedSpan, ModelIdentity } from '../contracts/judgment';
export { scoreToLevel, scoreToVerdict } from '../contracts/judgment';
export type { DetectionResult, ActivityItem } from '../contracts/detection-result';
export { toActivityItem, entityCountsByType, totalEntitiesDetected } from '../contracts/detection-result';
export type { Message, MessageType } from '../contracts/messages';
export { MESSAGE_TYPES, isValidMessage, assertNever } from '../contracts/messages';

// Detectors
export type { Detector } from './detectors/interface';
export { DetectorRegistry } from './detectors/interface';
export { createDictionaryDetector, brandDictionaryDetector } from './detectors/dictionary-detector';

// Dedupe
export { dedupeDetections, mergeDetections } from './dedupe/resolver';

// Evidence
export { buildEvidenceBundle } from './evidence-bundler';
