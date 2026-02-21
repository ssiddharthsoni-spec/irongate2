/**
 * Iron Gate — Security Module Barrel Export
 *
 * Re-exports every security primitive so consumers can import from a single
 * path:
 *
 *   import { hashEntitiesLocally, createGuardedFetch, ... } from '../security';
 */

// Client-side entity hashing
export {
  hashEntitiesLocally,
  resetSessionSalt,
  type DetectedPosition,
  type HashedEntity,
} from './client-hash';

// Certificate pinning
export {
  PINNED_HASHES,
  validateCertificate,
  validateCertificateWithLogging,
} from './cert-pinning';

// Network guard (outbound request lockdown)
export {
  ALLOWED_HOSTS,
  validateOutboundRequest,
  reportSecurityAnomaly,
  createGuardedFetch,
  type SecurityAnomalyType,
  type SecurityAnomalyDetails,
} from './network-guard';

// Kill-switch poller
export {
  POLL_INTERVAL,
  checkKillSwitch,
  startKillSwitchPoller,
  type KillSwitchState,
} from './kill-switch-poller';

// Local storage policy
export {
  BLOCKED_KEYS,
  sanitizeStorageWrite,
  sanitizeStorageWriteBatch,
  clearSensitiveData,
  isAllowedKey,
  StoragePolicyViolationError,
  type AllowedStorageKeys,
} from './local-storage-policy';
