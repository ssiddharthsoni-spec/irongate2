/**
 * OpenAI request/response parser.
 * Extracts text from chat completion messages for scanning,
 * and rebuilds the body with pseudonymized text.
 */

export interface TextSegment {
  text: string;
  messageIndex: number;
  contentPartIndex?: number; // For array content
  field: 'content' | 'system';
}

interface OpenAIMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
  [key: string]: any;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  [key: string]: any;
}

const SEGMENT_DELIMITER = '\n\x00---SEGMENT---\x00\n';

/**
 * Extract all text from an OpenAI chat completion request.
 * Returns the combined text for scanning and segment metadata for reconstruction.
 */
export function extractTextFromOpenAI(body: OpenAIChatRequest): {
  fullText: string;
  segments: TextSegment[];
} {
  const segments: TextSegment[] = [];
  const textParts: string[] = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (typeof msg.content === 'string') {
      segments.push({ text: msg.content, messageIndex: i, field: 'content' });
      textParts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const part = msg.content[j];
        if (part.type === 'text' && part.text) {
          segments.push({
            text: part.text,
            messageIndex: i,
            contentPartIndex: j,
            field: 'content',
          });
          textParts.push(part.text);
        }
      }
    }
  }

  return {
    fullText: textParts.join(SEGMENT_DELIMITER),
    segments,
  };
}

/**
 * Rebuild the OpenAI request body with pseudonymized text.
 * The maskedTexts array must be the same length as segments.
 */
export function rebuildOpenAIRequest(
  originalBody: OpenAIChatRequest,
  segments: TextSegment[],
  maskedTexts: string[],
): OpenAIChatRequest {
  // Deep clone to avoid mutating the original
  const body = JSON.parse(JSON.stringify(originalBody)) as OpenAIChatRequest;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const masked = maskedTexts[s];
    const msg = body.messages[seg.messageIndex];

    if (typeof msg.content === 'string') {
      msg.content = masked;
    } else if (Array.isArray(msg.content) && seg.contentPartIndex !== undefined) {
      const part = msg.content[seg.contentPartIndex];
      if (part && part.type === 'text') {
        part.text = masked;
      }
    }
  }

  return body;
}

/**
 * Extract text content from an OpenAI non-streaming response for depseudonymization.
 */
export function extractResponseText(responseBody: any): string | null {
  const choice = responseBody?.choices?.[0];
  if (!choice) return null;

  const content = choice.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Replace text content in an OpenAI non-streaming response.
 */
export function rebuildResponse(responseBody: any, newText: string): any {
  const body = JSON.parse(JSON.stringify(responseBody));
  if (body?.choices?.[0]?.message?.content) {
    body.choices[0].message.content = newText;
  }
  return body;
}

/**
 * Build an OpenAI-format error response for blocked requests.
 */
export function buildBlockResponse(explanation: string, score: number) {
  return {
    error: {
      message: `Iron Gate: Request blocked due to sensitive content (score: ${score}/100). ${explanation}`,
      type: 'iron_gate_policy_violation',
      param: null,
      code: 'content_policy_violation',
    },
  };
}

export { SEGMENT_DELIMITER };
