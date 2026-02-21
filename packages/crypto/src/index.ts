// @iron-gate/crypto — AES-256-GCM encryption + SHA-256 hashing for Iron Gate
export {
  encrypt,
  decrypt,
  deriveKey,
  generateSalt,
  saltToHex,
  hexToSalt,
} from './aes-gcm';

export {
  sha256,
  chainHash,
} from './hashing';

export {
  encryptForFirm,
  decryptForFirm,
  generateDataKey,
} from './kms-encryption';

export type {
  EnvelopeEncryptedPayload,
  DataKeyResult,
} from './kms-encryption';

export {
  generateFirmKeyPair,
  encryptWithPublicKey,
  decryptWithPrivateKey,
} from './envelope-encryption';

export type {
  FirmKeyPair,
} from './envelope-encryption';

export {
  ROLES,
  hasPermission,
  requirePermission,
} from './rbac';

export type {
  Role,
  Permission,
} from './rbac';
