/**
 * Core interception pipeline.
 * Runs incoming prompt text through Iron Gate's detection → scoring → pseudonymization.
 * Imports directly from the API app — zero code duplication.
 */

import { detect } from '../../../api/src/detection/detector';
import { score as scoreText } from '../../../api/src/detection/scorer';
import { Pseudonymizer } from '../../../api/src/proxy/pseudonymizer';
import type { DetectedEntity } from '@iron-gate/types';
import type { GatewayConfig } from '../config';
import type { TextSegment } from '../parsers/openai';

const SEGMENT_DELIMITER = '\n\x00---SEGMENT---\x00\n';

export interface InterceptionResult {
  action: 'passthrough' | 'pseudonymize' | 'block';
  score: number;
  level: string;
  explanation: string;
  entities: DetectedEntity[];
  pseudonymizer?: Pseudonymizer;
  maskedSegments?: string[];
}

/**
 * Run the full detection pipeline on extracted text.
 */
export function interceptRequest(
  fullText: string,
  segments: TextSegment[],
  firmId: string,
  sessionId: string,
  config: GatewayConfig,
): InterceptionResult {
  // 1. Detect entities
  const entities = detect(fullText);

  // 2. Score sensitivity (strip delimiters for accurate scoring)
  const cleanText = fullText.replaceAll(SEGMENT_DELIMITER, '\n');
  const scoreResult = scoreText(cleanText, entities);

  // 3. Decide action
  const action = decideAction(scoreResult.score, config);

  // 4. Pseudonymize if needed
  if (action === 'pseudonymize' && entities.length > 0) {
    const pseudonymizer = new Pseudonymizer(sessionId, firmId);

    // Pseudonymize the full text, then split back into segments
    const result = pseudonymizer.pseudonymize(fullText, entities);
    const maskedSegments = result.maskedText.split(SEGMENT_DELIMITER);

    return {
      action,
      score: scoreResult.score,
      level: scoreResult.level,
      explanation: scoreResult.explanation,
      entities,
      pseudonymizer,
      maskedSegments,
    };
  }

  return {
    action,
    score: scoreResult.score,
    level: scoreResult.level,
    explanation: scoreResult.explanation,
    entities,
  };
}

function decideAction(
  score: number,
  config: GatewayConfig,
): 'passthrough' | 'pseudonymize' | 'block' {
  if (score >= config.thresholds.block) return 'block';
  if (score >= config.thresholds.pseudonymize) return 'pseudonymize';
  return 'passthrough';
}

/**
 * Compute SHA-256 hash for audit logging (never store plaintext).
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
