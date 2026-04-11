/**
 * Signed Policy Bundle Loader — verify and apply customer-controlled detection rules
 *
 * v1.0 SOVEREIGN MODE CONTRACT:
 *
 * Detection rules (regex patterns, scoring weights, AMBER zone keyword lists,
 * policy decisions) ship inside the extension by default. Enterprise customers
 * who want to update rules without pushing a new extension version can host
 * their own policy bundles at a customer-controlled URL.
 *
 * The bundle is:
 *   1. Hosted at the customer's policyBundleUrl (managed config)
 *   2. Signed with the customer's Ed25519 private key (one-time setup)
 *   3. The corresponding public key is bound to the firmId at install time
 *      and stored in chrome.storage.local (write-once)
 *   4. Fetched periodically by the extension
 *   5. Verified against the bound public key
 *   6. Applied to detection state if verification passes
 *
 * Why this design:
 *   - Customer never gives IronGate their detection rules — they're customer IP
 *   - Extension never fetches rules from IronGate's servers — pure customer infra
 *   - Tampering by anyone other than the firm's policy admin is detected
 *     (signature verification fails)
 *   - The public key is write-once locally so a malicious update can't replace it
 *
 * Bundle format:
 *   {
 *     "schema": "irongate.policy.v1",
 *     "firmId": "<firmId from managed config>",
 *     "issuedAt": "<ISO 8601>",
 *     "expiresAt": "<ISO 8601>",  // bundles auto-rotate
 *     "rules": { ... },           // detection rules (regex, keywords, weights)
 *     "signature": "<base64 ed25519 signature over the canonical JSON>"
 *   }
 *
 * Verification uses the WebCrypto SubtleCrypto Ed25519 implementation
 * (Chrome 113+, available in service workers).
 */

export interface PolicyBundle {
  schema: 'irongate.policy.v1';
  firmId: string;
  issuedAt: string;
  expiresAt: string;
  rules: {
    /** Custom regex patterns to add to entity detection */
    customEntities?: Array<{ type: string; pattern: string; confidence: number }>;
    /** Additional AMBER-zone keywords */
    contextualKeywords?: Array<{ keyword: string; weight: number; category: string }>;
    /** Scoring weight overrides */
    scoringWeights?: Record<string, number>;
    /** Allowed AI tools (firm policy override) */
    allowedAITools?: string[];
    /** Custom block messages */
    customBlockMessage?: string;
  };
  signature: string;
}

export interface BundleVerifyResult {
  ok: boolean;
  bundle: PolicyBundle | null;
  error: string | null;
  /** Reason this bundle should not be applied even if signature is valid */
  rejectReason?: 'expired' | 'firm-mismatch' | 'schema-mismatch' | 'signature-invalid' | 'fetch-failed';
}

const PUBLIC_KEY_STORAGE_KEY = 'irongate.policyBundlePublicKey';
const LAST_BUNDLE_STORAGE_KEY = 'irongate.lastValidBundle';
const BUNDLE_FETCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Bind a public key to this device. Called once at deployment time, typically
 * via the deployment installer or first-run setup. The key is write-once —
 * subsequent calls with a different key are rejected to prevent tampering.
 */
export async function bindPolicyPublicKey(publicKeyBase64: string): Promise<{ ok: boolean; error?: string }> {
  const existing = await chrome.storage.local.get(PUBLIC_KEY_STORAGE_KEY);
  if (existing[PUBLIC_KEY_STORAGE_KEY]) {
    if (existing[PUBLIC_KEY_STORAGE_KEY] === publicKeyBase64) return { ok: true };
    return {
      ok: false,
      error: 'A different public key is already bound to this device. Tampering attempt or misconfiguration.',
    };
  }

  // Validate the key is parseable as Ed25519
  try {
    const keyBytes = base64Decode(publicKeyBase64);
    if (keyBytes.length !== 32) {
      return { ok: false, error: `Ed25519 public key must be 32 bytes, got ${keyBytes.length}` };
    }
    await crypto.subtle.importKey('raw', toBufferSource(keyBytes), { name: 'Ed25519' }, false, ['verify']);
  } catch (err) {
    return { ok: false, error: `Invalid Ed25519 public key: ${(err as Error).message}` };
  }

  await chrome.storage.local.set({ [PUBLIC_KEY_STORAGE_KEY]: publicKeyBase64 });
  return { ok: true };
}

/**
 * Fetch a signed policy bundle from the customer-controlled URL.
 */
export async function fetchPolicyBundle(bundleUrl: string): Promise<BundleVerifyResult> {
  if (!bundleUrl || !/^https:\/\//i.test(bundleUrl)) {
    return { ok: false, bundle: null, error: 'bundleUrl must be HTTPS', rejectReason: 'fetch-failed' };
  }

  let response: Response;
  try {
    response = await fetch(bundleUrl, {
      method: 'GET',
      cache: 'no-cache',
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, bundle: null, error: `fetch failed: ${(err as Error).message}`, rejectReason: 'fetch-failed' };
  }

  if (!response.ok) {
    return { ok: false, bundle: null, error: `HTTP ${response.status}`, rejectReason: 'fetch-failed' };
  }

  let bundle: PolicyBundle;
  try {
    bundle = (await response.json()) as PolicyBundle;
  } catch (err) {
    return { ok: false, bundle: null, error: `invalid JSON: ${(err as Error).message}`, rejectReason: 'fetch-failed' };
  }

  return verifyPolicyBundle(bundle);
}

/**
 * Verify a policy bundle against the bound public key.
 * Performs all the checks: schema, firm match, expiry, signature.
 */
export async function verifyPolicyBundle(
  bundle: PolicyBundle,
  expectedFirmId?: string,
): Promise<BundleVerifyResult> {
  // Schema check
  if (bundle?.schema !== 'irongate.policy.v1') {
    return {
      ok: false,
      bundle: null,
      error: `Unknown bundle schema: ${bundle?.schema}`,
      rejectReason: 'schema-mismatch',
    };
  }

  // Firm match
  if (expectedFirmId && bundle.firmId !== expectedFirmId) {
    return {
      ok: false,
      bundle: null,
      error: `Bundle firmId "${bundle.firmId}" does not match expected "${expectedFirmId}"`,
      rejectReason: 'firm-mismatch',
    };
  }

  // Expiry
  const expiresAt = new Date(bundle.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) {
    return {
      ok: false,
      bundle: null,
      error: 'Invalid expiresAt timestamp',
      rejectReason: 'schema-mismatch',
    };
  }
  if (expiresAt < Date.now()) {
    return {
      ok: false,
      bundle: null,
      error: `Bundle expired at ${bundle.expiresAt}`,
      rejectReason: 'expired',
    };
  }

  // Load bound public key
  const stored = await chrome.storage.local.get(PUBLIC_KEY_STORAGE_KEY);
  const publicKeyBase64 = stored[PUBLIC_KEY_STORAGE_KEY] as string | undefined;
  if (!publicKeyBase64) {
    return {
      ok: false,
      bundle: null,
      error: 'No public key bound to this device. Bundle cannot be verified.',
      rejectReason: 'signature-invalid',
    };
  }

  // Verify signature
  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      toBufferSource(base64Decode(publicKeyBase64)),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    // Build the canonical bytes that were signed: bundle minus signature, JSON-stringified
    // with stable key ordering
    const { signature, ...rest } = bundle;
    const canonical = canonicalJsonStringify(rest);
    const canonicalBytes = new TextEncoder().encode(canonical);
    const signatureBytes = base64Decode(signature);

    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      toBufferSource(signatureBytes),
      toBufferSource(canonicalBytes),
    );

    if (!valid) {
      return {
        ok: false,
        bundle: null,
        error: 'Signature verification failed',
        rejectReason: 'signature-invalid',
      };
    }
  } catch (err) {
    return {
      ok: false,
      bundle: null,
      error: `verification crashed: ${(err as Error).message}`,
      rejectReason: 'signature-invalid',
    };
  }

  // Cache the verified bundle for offline use
  try {
    await chrome.storage.local.set({ [LAST_BUNDLE_STORAGE_KEY]: bundle });
  } catch { /* storage unavailable */ }

  return { ok: true, bundle, error: null };
}

/**
 * Get the currently active policy bundle (the last one that verified).
 * Returns null if no bundle has ever been applied.
 */
export async function getActiveBundle(): Promise<PolicyBundle | null> {
  try {
    const stored = await chrome.storage.local.get(LAST_BUNDLE_STORAGE_KEY);
    return (stored[LAST_BUNDLE_STORAGE_KEY] as PolicyBundle) || null;
  } catch {
    return null;
  }
}

/**
 * Start the periodic bundle fetcher. Called once at extension startup if
 * managed config has policyBundleUrl set.
 */
export function startPolicyBundlePoller(
  bundleUrl: string,
  expectedFirmId: string | undefined,
  onUpdate: (bundle: PolicyBundle) => void,
  onError: (error: string) => void,
): () => void {
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    const result = await fetchPolicyBundle(bundleUrl);
    if (cancelled) return;
    if (result.ok && result.bundle) {
      // Re-verify with firmId
      const final = expectedFirmId
        ? await verifyPolicyBundle(result.bundle, expectedFirmId)
        : result;
      if (final.ok && final.bundle) {
        onUpdate(final.bundle);
      } else if (final.error) {
        onError(final.error);
      }
    } else if (result.error) {
      onError(result.error);
    }
  };

  // Initial fetch
  void tick();
  // Periodic fetch
  const id = setInterval(() => void tick(), BUNDLE_FETCH_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Cast a Uint8Array to BufferSource for WebCrypto APIs.
 * TypeScript's strict mode requires the underlying buffer be ArrayBuffer
 * (not SharedArrayBuffer). Our Uint8Arrays always own their buffer, so
 * this cast is safe at runtime.
 */
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  // Slice to guarantee we have a fresh ArrayBuffer (not SharedArrayBuffer)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Canonical JSON serialization: sort object keys recursively.
 * Required so that bundle producer and verifier compute the same bytes.
 * The signature is computed over the canonical bytes, so any non-canonical
 * serialization differences would cause verification to fail.
 */
function canonicalJsonStringify(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as object).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify((obj as Record<string, unknown>)[k]));
  return '{' + parts.join(',') + '}';
}
