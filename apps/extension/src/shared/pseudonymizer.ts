/**
 * Shared Pseudonymizer Module
 *
 * Re-exports from the unified detection/pseudonymizer.
 * This is the public API for the rest of the extension.
 */

export type { PseudonymMapping, PseudonymResult, PseudonymMode, PseudonymizerConfig } from '../detection/pseudonymizer';

export {
  pseudonymizeLocal,
  pseudonymizeSameLength,
  depseudonymize,
  depseudonymizeWithMap,
  sanitizeMappingsForTransit,
  resolveIdentities,
  getForwardMap,
  getReverseMap,
  getReverseMapObject,
  restoreMaps,
  resetMaps,
  setPseudonymMode,
  getPseudonymMode,
} from '../detection/pseudonymizer';

import type { DetectedEntity } from '../detection/types';
import type { PseudonymResult } from '../detection/pseudonymizer';
import { pseudonymizeLocal } from '../detection/pseudonymizer';

/**
 * Convenience alias: pseudonymize detected entities in text.
 */
export function pseudonymize(text: string, entities: DetectedEntity[]): PseudonymResult {
  return pseudonymizeLocal(text, entities);
}
