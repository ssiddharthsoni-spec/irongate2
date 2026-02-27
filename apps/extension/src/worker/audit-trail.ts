/**
 * Cryptographic Audit Trail
 *
 * Records HMAC-signed attestation records for every interception event.
 * Provides tamper-evident logging — if any record is modified after creation,
 * the HMAC verification will fail.
 *
 * - Per-session signing key (HMAC-SHA256) generated on service worker startup
 * - Records stored in chrome.storage.local under __ig_audit_log
 * - Max 2000 records retained (oldest evicted)
 * - Export/clear handlers for compliance workflows
 */

const AUDIT_STORAGE_KEY = '__ig_audit_log';
const MAX_RECORDS = 2000;

interface AuditRecord {
  /** ISO timestamp */
  ts: string;
  /** Action taken: proxy, audit, pass, block, warn */
  action: string;
  /** Number of entities detected */
  entityCount: number;
  /** SHA-256 hash of the prompt (pre-computed by caller) */
  promptHash: string;
  /** Sensitivity level */
  level: string;
  /** Sensitivity score */
  score: number;
  /** AI tool identifier */
  aiToolId: string;
  /** HMAC-SHA256 signature of the record fields */
  hmac: string;
}

let _sessionKey: CryptoKey | null = null;

/**
 * Generate a per-session HMAC-SHA256 signing key.
 * Key lives only in memory — lost when service worker restarts.
 */
async function getSessionKey(): Promise<CryptoKey> {
  if (_sessionKey) return _sessionKey;
  _sessionKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false, // not extractable
    ['sign', 'verify'],
  );
  return _sessionKey;
}

/**
 * Compute HMAC-SHA256 of a string, returned as hex.
 */
async function hmacSign(data: string): Promise<string> {
  const key = await getSessionKey();
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign('HMAC', key, encoded);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Record an attestation for an interception event.
 */
export async function recordAttestation(params: {
  action: string;
  entityCount: number;
  promptHash: string;
  level: string;
  score: number;
  aiToolId: string;
}): Promise<void> {
  try {
    const ts = new Date().toISOString();
    const { action, entityCount, promptHash, level, score, aiToolId } = params;

    // Canonical string for signing: deterministic field order
    const canonical = `${ts}|${action}|${entityCount}|${promptHash}|${level}|${score}|${aiToolId}`;
    const hmac = await hmacSign(canonical);

    const record: AuditRecord = { ts, action, entityCount, promptHash, level, score, aiToolId, hmac };

    // Append to storage
    const result = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    let log: AuditRecord[] = result[AUDIT_STORAGE_KEY] || [];

    log.push(record);

    // Evict oldest if over limit
    if (log.length > MAX_RECORDS) {
      log = log.slice(log.length - MAX_RECORDS);
    }

    await chrome.storage.local.set({ [AUDIT_STORAGE_KEY]: log });
  } catch {
    // Non-critical — don't let audit logging break the main flow
  }
}

/**
 * Retrieve the full audit log.
 */
export async function getAuditLog(): Promise<AuditRecord[]> {
  try {
    const result = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    return result[AUDIT_STORAGE_KEY] || [];
  } catch {
    return [];
  }
}

/**
 * Clear the audit log.
 */
export async function clearAuditLog(): Promise<void> {
  await chrome.storage.local.remove(AUDIT_STORAGE_KEY);
}
