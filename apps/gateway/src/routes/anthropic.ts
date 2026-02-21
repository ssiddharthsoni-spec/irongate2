/**
 * Anthropic-compatible routes.
 * Handles /v1/messages for Anthropic API format.
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import {
  extractTextFromAnthropic,
  rebuildAnthropicRequest,
  extractResponseText,
  rebuildResponse,
  buildBlockResponse,
} from '../parsers/anthropic';
import { interceptRequest, sha256 } from '../pipeline/interceptor';
import { createAnthropicStreamTransformer } from '../streaming/sse-transformer';
import { logEvent } from './event-logger';
import type { GatewayConfig } from '../config';

export function createAnthropicRoutes(config: GatewayConfig) {
  const routes = new Hono();
  const upstreamBase = config.upstreams.anthropic;

  // ── POST /v1/messages ──────────────────────────────────────────────

  routes.post('/v1/messages', async (c) => {
    const body = await c.req.json();
    const isStreaming = body.stream === true;
    const sessionId = uuidv4();

    // 1. Extract text
    const { fullText, segments } = extractTextFromAnthropic(body);

    if (!fullText.trim()) {
      return forwardPassthrough(c, `${upstreamBase}/v1/messages`, body);
    }

    // 2. Run detection pipeline (with fail-open)
    let result;
    try {
      result = interceptRequest(fullText, segments, config.firmId, sessionId, config);
    } catch (error) {
      console.error('[Gateway] Pipeline error, failing open:', error);
      if (config.failOpen) {
        return forwardPassthrough(c, `${upstreamBase}/v1/messages`, body);
      }
      return c.json(buildBlockResponse('Internal pipeline error', 0), 500);
    }

    // Log event (fire-and-forget)
    sha256(fullText).then((hash) => {
      logEvent({
        firmId: config.firmId,
        aiToolId: 'gateway:anthropic',
        promptHash: hash,
        promptLength: fullText.length,
        sensitivityScore: result.score,
        sensitivityLevel: result.level as any,
        entities: result.entities,
        action: result.action === 'passthrough' ? 'pass' : result.action === 'pseudonymize' ? 'proxy' : 'block',
        captureMethod: 'gateway',
        sessionId,
        metadata: { model: body.model, streaming: isStreaming },
      });
    }).catch(() => {});

    // 3. Act on decision
    switch (result.action) {
      case 'passthrough':
        return forwardPassthrough(c, `${upstreamBase}/v1/messages`, body);

      case 'block':
        return c.json(buildBlockResponse(result.explanation, result.score), 403);

      case 'pseudonymize': {
        if (!result.maskedSegments || !result.pseudonymizer) {
          return forwardPassthrough(c, `${upstreamBase}/v1/messages`, body);
        }

        const maskedBody = rebuildAnthropicRequest(body, segments, result.maskedSegments);

        const upstreamUrl = `${upstreamBase}/v1/messages`;
        const upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: buildAnthropicHeaders(c.req.raw.headers),
          body: JSON.stringify(maskedBody),
        });

        if (!upstreamResponse.ok) {
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: filterResponseHeaders(upstreamResponse.headers),
          });
        }

        if (isStreaming && upstreamResponse.body) {
          const transformer = createAnthropicStreamTransformer(result.pseudonymizer);
          const transformedStream = upstreamResponse.body.pipeThrough(transformer);
          return new Response(transformedStream, {
            status: 200,
            headers: filterResponseHeaders(upstreamResponse.headers),
          });
        }

        // Non-streaming: depseudonymize
        const responseJson = await upstreamResponse.json();
        const responseText = extractResponseText(responseJson);
        if (responseText) {
          const depseudonymized = result.pseudonymizer.depseudonymize(responseText);
          return c.json(rebuildResponse(responseJson, depseudonymized));
        }
        return c.json(responseJson);
      }
    }
  });

  return routes;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function forwardPassthrough(c: any, url: string, body: any): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildAnthropicHeaders(c.req.raw.headers),
    body: JSON.stringify(body),
  });

  return new Response(response.body, {
    status: response.status,
    headers: filterResponseHeaders(response.headers),
  });
}

function buildAnthropicHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  // Forward Anthropic auth
  const apiKey = originalHeaders.get('x-api-key');
  if (apiKey) headers.set('x-api-key', apiKey);

  // Forward Anthropic version
  const version = originalHeaders.get('anthropic-version');
  if (version) headers.set('anthropic-version', version);

  // Forward beta header
  const beta = originalHeaders.get('anthropic-beta');
  if (beta) headers.set('anthropic-beta', beta);

  return headers;
}

function filterResponseHeaders(headers: Headers): HeadersInit {
  const filtered: Record<string, string> = {};
  const passthrough = ['content-type', 'request-id', 'x-request-id'];
  for (const key of passthrough) {
    const value = headers.get(key);
    if (value) filtered[key] = value;
  }
  if (headers.get('content-type')?.includes('text/event-stream')) {
    filtered['content-type'] = 'text/event-stream';
    filtered['cache-control'] = 'no-cache';
    filtered['connection'] = 'keep-alive';
  }
  return filtered;
}
