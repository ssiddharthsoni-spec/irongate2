/**
 * Anthropic request/response parser.
 * Handles the Anthropic /v1/messages format with top-level system field.
 */

import type { TextSegment } from './openai';

const SEGMENT_DELIMITER = '\n\x00---SEGMENT---\x00\n';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: string; text?: string }>;
  stream?: boolean;
  max_tokens: number;
  [key: string]: any;
}

/**
 * Extract all text from an Anthropic messages request.
 */
export function extractTextFromAnthropic(body: AnthropicRequest): {
  fullText: string;
  segments: TextSegment[];
} {
  const segments: TextSegment[] = [];
  const textParts: string[] = [];

  // Extract system prompt (top-level field)
  if (body.system) {
    if (typeof body.system === 'string') {
      segments.push({ text: body.system, messageIndex: -1, field: 'system' });
      textParts.push(body.system);
    } else if (Array.isArray(body.system)) {
      for (let j = 0; j < body.system.length; j++) {
        const part = body.system[j];
        if (part.type === 'text' && part.text) {
          segments.push({
            text: part.text,
            messageIndex: -1,
            contentPartIndex: j,
            field: 'system',
          });
          textParts.push(part.text);
        }
      }
    }
  }

  // Extract message content
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
 * Rebuild the Anthropic request body with pseudonymized text.
 */
export function rebuildAnthropicRequest(
  originalBody: AnthropicRequest,
  segments: TextSegment[],
  maskedTexts: string[],
): AnthropicRequest {
  const body = JSON.parse(JSON.stringify(originalBody)) as AnthropicRequest;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const masked = maskedTexts[s];

    if (seg.field === 'system') {
      if (typeof body.system === 'string') {
        body.system = masked;
      } else if (Array.isArray(body.system) && seg.contentPartIndex !== undefined) {
        const part = body.system[seg.contentPartIndex];
        if (part && part.type === 'text') {
          part.text = masked;
        }
      }
    } else {
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
  }

  return body;
}

/**
 * Extract text content from an Anthropic non-streaming response.
 */
export function extractResponseText(responseBody: any): string | null {
  const content = responseBody?.content;
  if (!Array.isArray(content)) return null;

  const textParts = content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text);

  return textParts.length > 0 ? textParts.join('\n') : null;
}

/**
 * Replace text content in an Anthropic non-streaming response.
 */
export function rebuildResponse(responseBody: any, newText: string): any {
  const body = JSON.parse(JSON.stringify(responseBody));
  if (Array.isArray(body?.content)) {
    const textBlockIndex = body.content.findIndex((b: any) => b.type === 'text');
    if (textBlockIndex >= 0) {
      body.content[textBlockIndex].text = newText;
    }
  }
  return body;
}

/**
 * Build an Anthropic-format error response for blocked requests.
 */
export function buildBlockResponse(explanation: string, score: number) {
  return {
    type: 'error',
    error: {
      type: 'iron_gate_policy_violation',
      message: `Iron Gate: Request blocked due to sensitive content (score: ${score}/100). ${explanation}`,
    },
  };
}
