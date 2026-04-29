/**
 * Gemini Wire Parser — batchexecute body extraction and replacement
 *
 * Gemini's API uses a batchexecute format:
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: f.req=URL_ENCODED([[RPC_NAME, JSON_STRING, null, TOKEN]])
 *
 * The JSON_STRING contains deeply nested arrays with the user's prompt text
 * as a plain string (NOT encrypted or opaque). The prompt can be found and
 * replaced within this structure.
 *
 * This parser:
 * 1. URL-decodes the body
 * 2. Extracts the f.req parameter
 * 3. Parses the nested JSON to find the prompt string
 * 4. Replaces it with pseudonymized text
 * 5. Re-encodes the body
 */

/**
 * Extract the user's prompt text from a Gemini batchexecute body.
 * Returns the longest natural-language string found in the nested JSON.
 */
export function extractPromptFromBatchexecute(body: string): string | null {
  try {
    const params = new URLSearchParams(body);
    const fReq = params.get('f.req');
    if (!fReq) return null;

    // Parse the outer array: [[rpcName, jsonString, null, token]]
    const outer = JSON.parse(fReq);
    if (!Array.isArray(outer)) return null;

    // Walk the nested structure to find all strings
    const candidates: string[] = [];
    function walkArray(arr: any): void {
      if (typeof arr === 'string' && arr.length >= 20) {
        // Try to parse as nested JSON (the inner payload is a JSON string)
        try {
          const inner = JSON.parse(arr);
          walkArray(inner);
        } catch {
          // Not JSON — this is a leaf string. Check if it looks like natural language.
          if (looksLikeNaturalLanguage(arr)) {
            candidates.push(arr);
          }
        }
      } else if (Array.isArray(arr)) {
        for (const item of arr) {
          walkArray(item);
        }
      }
    }
    walkArray(outer);

    if (candidates.length === 0) return null;

    // Return the longest candidate — typically the user's prompt
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  } catch {
    return null;
  }
}

/**
 * Replace the user's prompt text in a Gemini batchexecute body.
 * Finds the original text and replaces it at all nesting levels.
 */
export function replacePromptInBatchexecute(body: string, original: string, replacement: string): string | null {
  if (!original || !replacement || original === replacement) return null;

  try {
    const params = new URLSearchParams(body);
    const fReq = params.get('f.req');
    if (!fReq) return null;

    // The prompt appears as a plain string within nested JSON strings.
    // We need to replace it at every level of JSON serialization.
    // Strategy: replace in the f.req value, then re-encode.

    // Level 1: The prompt appears directly in a JSON string value
    let modified = fReq;

    // Escape for JSON string context (the prompt is inside a JSON.stringify'd string)
    const origJsonEscaped = jsonEscape(original);
    const replJsonEscaped = jsonEscape(replacement);

    // Replace at the deepest level first (most specific match)
    if (modified.includes(origJsonEscaped)) {
      modified = modified.split(origJsonEscaped).join(replJsonEscaped);
    }

    // Also try double-escaped (JSON within JSON)
    const origDoubleEscaped = jsonEscape(origJsonEscaped);
    const replDoubleEscaped = jsonEscape(replJsonEscaped);
    if (modified.includes(origDoubleEscaped)) {
      modified = modified.split(origDoubleEscaped).join(replDoubleEscaped);
    }

    // Also try the raw string (in case it appears unescaped somewhere)
    if (modified.includes(original) && original !== origJsonEscaped) {
      modified = modified.split(original).join(replacement);
    }

    if (modified === fReq) return null; // nothing was replaced

    // Re-encode
    params.set('f.req', modified);
    return params.toString();
  } catch {
    return null;
  }
}

/**
 * Verify that a batchexecute body contains the expected text (pseudonym or original).
 * Used for wire-level verification after DOM pre-submit.
 */
export function batchexecuteContainsText(body: string, text: string): boolean {
  if (!text || text.length < 3) return false;
  try {
    const params = new URLSearchParams(body);
    const fReq = params.get('f.req');
    if (!fReq) return false;

    // Check both raw and JSON-escaped forms
    return fReq.includes(text) || fReq.includes(jsonEscape(text));
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function looksLikeNaturalLanguage(str: string): boolean {
  if (str.length < 20) return false;
  // Must contain spaces (natural language has word boundaries)
  if (!str.includes(' ')) return false;
  // Must not be mostly special characters (base64, encrypted data)
  const alphaCount = (str.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount / str.length < 0.4) return false;
  // Must not look like a URL, hash, or token
  if (/^https?:\/\//i.test(str)) return false;
  if (/^[a-f0-9]{32,}$/i.test(str)) return false;
  return true;
}
