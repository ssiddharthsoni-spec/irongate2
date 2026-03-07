/**
 * MCP Tool Call Interceptor
 *
 * Intercepts MCP tool calls and results, scanning for PII.
 * Decides whether to pass, pseudonymize, or block based on sensitivity score.
 */

import type { MCPProxyConfig } from './config';
import type { ScanResult, DetectedEntity } from './scanner';
import { scanToolCallArgs, scanToolResult, flattenToString, detectEntities } from './scanner';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InterceptedCall {
  toolName: string;
  args: Record<string, unknown>;
  scanResult: ScanResult;
  action: 'pass' | 'pseudonymize' | 'block';
  timestamp: string;
}

export interface InterceptResult {
  modifiedArgs: Record<string, unknown>;
  intercepted: InterceptedCall;
}

export interface InterceptResultResponse {
  modifiedResult: unknown;
  intercepted: InterceptedCall;
}

// ── Pseudonymization ──────────────────────────────────────────────────────────

/** Map of original values to pseudonyms, scoped per request for de-pseudonymization */
export interface PseudonymMap {
  forward: Map<string, string>;  // original -> pseudonym
  reverse: Map<string, string>;  // pseudonym -> original
}

/** Counter for generating unique pseudonyms per type */
const typeCounters = new Map<string, number>();

function resetCounters(): void {
  typeCounters.clear();
}

function nextPseudonym(type: string): string {
  const count = (typeCounters.get(type) || 0) + 1;
  typeCounters.set(type, count);

  switch (type) {
    case 'PERSON':
      return `[PERSON_${count}]`;
    case 'EMAIL':
      return `person${count}@example.com`;
    case 'PHONE_NUMBER':
      return `[PHONE_${count}]`;
    case 'SSN':
      return `[SSN_REDACTED_${count}]`;
    case 'CREDIT_CARD':
      return `[CARD_REDACTED_${count}]`;
    case 'ACCOUNT_NUMBER':
      return `[ACCT_REDACTED_${count}]`;
    case 'IP_ADDRESS':
      return `10.0.0.${count}`;
    case 'MEDICAL_RECORD':
      return `[MRN_REDACTED_${count}]`;
    case 'PASSPORT_NUMBER':
      return `[PASSPORT_REDACTED_${count}]`;
    case 'DRIVERS_LICENSE':
      return `[DL_REDACTED_${count}]`;
    case 'MONETARY_AMOUNT':
      return `$[AMOUNT_${count}]`;
    case 'EMPLOYEE_ID':
      return `[EMP_REDACTED_${count}]`;
    case 'API_KEY':
    case 'AWS_CREDENTIAL':
    case 'PRIVATE_KEY':
    case 'DATABASE_URI':
      return `[SECRET_REDACTED_${count}]`;
    case 'UK_NINO':
      return `[NINO_REDACTED_${count}]`;
    case 'EU_IBAN':
      return `[IBAN_REDACTED_${count}]`;
    default:
      return `[REDACTED_${type}_${count}]`;
  }
}

/**
 * Create a new pseudonym map for a request lifecycle.
 */
export function createPseudonymMap(): PseudonymMap {
  resetCounters();
  return {
    forward: new Map(),
    reverse: new Map(),
  };
}

/**
 * Pseudonymize a string by replacing detected entities with pseudonyms.
 * Returns the modified string and populates the pseudonym map.
 */
function pseudonymizeString(text: string, entities: DetectedEntity[], pmap: PseudonymMap): string {
  if (entities.length === 0) return text;

  // Process entities from end to start to preserve positions
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let result = text;

  for (const entity of sorted) {
    const original = entity.text;

    // Reuse existing pseudonym for the same original text
    let pseudonym = pmap.forward.get(original);
    if (!pseudonym) {
      pseudonym = nextPseudonym(entity.type);
      pmap.forward.set(original, pseudonym);
      pmap.reverse.set(pseudonym, original);
    }

    result = result.slice(0, entity.start) + pseudonym + result.slice(entity.end);
  }

  return result;
}

/**
 * De-pseudonymize a string by restoring original values from the pseudonym map.
 */
export function dePseudonymize(text: string, pmap: PseudonymMap): string {
  let result = text;
  for (const [pseudonym, original] of pmap.reverse) {
    // Replace all occurrences
    while (result.includes(pseudonym)) {
      result = result.replace(pseudonym, original);
    }
  }
  return result;
}

/**
 * Recursively pseudonymize values in an object/array.
 */
function pseudonymizeValue(value: unknown, pmap: PseudonymMap): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    const entities = detectEntities(value);
    if (entities.length === 0) return value;
    return pseudonymizeString(value, entities, pmap);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => pseudonymizeValue(item, pmap));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = pseudonymizeValue(v, pmap);
    }
    return result;
  }

  return value;
}

/**
 * Recursively de-pseudonymize values in an object/array.
 */
function dePseudonymizeValue(value: unknown, pmap: PseudonymMap): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return dePseudonymize(value, pmap);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => dePseudonymizeValue(item, pmap));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = dePseudonymizeValue(v, pmap);
    }
    return result;
  }

  return value;
}

// ── Interceptor Logic ─────────────────────────────────────────────────────────

/**
 * Determine the action to take based on scan result and config.
 */
function determineAction(
  scanResult: ScanResult,
  config: MCPProxyConfig,
): 'pass' | 'pseudonymize' | 'block' {
  if (scanResult.score >= config.blockThreshold) {
    return 'block';
  }

  if (
    scanResult.hasSensitiveData &&
    config.enablePseudonymization &&
    scanResult.score >= config.pseudonymizeThreshold
  ) {
    return 'pseudonymize';
  }

  return 'pass';
}

/**
 * Intercept an MCP tool call before it is forwarded upstream.
 *
 * Scans the arguments for PII and either passes, pseudonymizes, or blocks.
 * Returns modified arguments and an audit record.
 */
export function interceptToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: MCPProxyConfig,
  pmap?: PseudonymMap,
): InterceptResult {
  const scanResult = scanToolCallArgs(args);
  const action = determineAction(scanResult, config);

  let modifiedArgs = args;

  if (action === 'pseudonymize' && pmap) {
    modifiedArgs = pseudonymizeValue(args, pmap) as Record<string, unknown>;
  }

  const intercepted: InterceptedCall = {
    toolName,
    args, // original args for the audit log
    scanResult,
    action,
    timestamp: new Date().toISOString(),
  };

  return { modifiedArgs, intercepted };
}

/**
 * Intercept an MCP tool result before returning it to the caller.
 *
 * Scans the result for PII and can de-pseudonymize if a pseudonym map was used
 * on the outgoing call.
 */
export function interceptToolResult(
  toolName: string,
  result: unknown,
  config: MCPProxyConfig,
  pmap?: PseudonymMap,
): InterceptResultResponse {
  const scanResult = scanToolResult(result);
  const action = determineAction(scanResult, config);

  let modifiedResult = result;

  // If we pseudonymized on the way out, de-pseudonymize the result
  if (pmap && pmap.reverse.size > 0) {
    modifiedResult = dePseudonymizeValue(result, pmap);
  }

  // If the result itself has new PII (from the upstream tool), pseudonymize it
  if (action === 'pseudonymize' && config.enablePseudonymization) {
    const resultPmap = createPseudonymMap();
    modifiedResult = pseudonymizeValue(modifiedResult, resultPmap);
  }

  const intercepted: InterceptedCall = {
    toolName,
    args: {}, // no args for result interception
    scanResult,
    action,
    timestamp: new Date().toISOString(),
  };

  return { modifiedResult, intercepted };
}
