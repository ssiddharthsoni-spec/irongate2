/**
 * OpenAI-compatible routes.
 * Handles /v1/chat/completions and passes through other OpenAI endpoints.
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import {
  extractTextFromOpenAI,
  rebuildOpenAIRequest,
  extractResponseText,
  rebuildResponse,
  buildBlockResponse,
} from '../parsers/openai';
import { interceptRequest, sha256 } from '../pipeline/interceptor';
import { createOpenAIStreamTransformer } from '../streaming/sse-transformer';
import { logEvent } from './event-logger';
import type { GatewayConfig } from '../config';

export function createOpenAIRoutes(config: GatewayConfig) {
  const routes = new Hono();
  const upstreamBase = config.upstreams.openai;

  // ── POST /v1/chat/completions ──────────────────────────────────────────

  routes.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json();
    const isStreaming = body.stream === true;
    const sessionId = uuidv4();

    // 1. Extract text for scanning
    const { fullText, segments } = extractTextFromOpenAI(body);

    if (!fullText.trim()) {
      // No text to scan — passthrough
      return forwardPassthrough(c, `${upstreamBase}/v1/chat/completions`, body);
    }

    // 2. Run detection pipeline (with fail-open)
    let result;
    try {
      result = interceptRequest(fullText, segments, config.firmId, sessionId, config);
    } catch (error) {
      console.error('[Gateway] Pipeline error, failing open:', error);
      if (config.failOpen) {
        return forwardPassthrough(c, `${upstreamBase}/v1/chat/completions`, body);
      }
      return c.json(buildBlockResponse('Internal pipeline error', 0), 500);
    }

    // Log event (fire-and-forget)
    sha256(fullText).then((hash) => {
      logEvent({
        firmId: config.firmId,
        aiToolId: 'gateway:openai',
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
        return forwardPassthrough(c, `${upstreamBase}/v1/chat/completions`, body);

      case 'block':
        return c.json(buildBlockResponse(result.explanation, result.score), 403);

      case 'pseudonymize': {
        if (!result.maskedSegments || !result.pseudonymizer) {
          return forwardPassthrough(c, `${upstreamBase}/v1/chat/completions`, body);
        }

        // Rebuild request with pseudonymized text
        const maskedBody = rebuildOpenAIRequest(body, segments, result.maskedSegments);

        // Forward to upstream
        const upstreamUrl = `${upstreamBase}/v1/chat/completions`;
        const upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: buildUpstreamHeaders(c.req.raw.headers),
          body: JSON.stringify(maskedBody),
        });

        if (!upstreamResponse.ok) {
          // Forward upstream error as-is
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: filterResponseHeaders(upstreamResponse.headers),
          });
        }

        if (isStreaming && upstreamResponse.body) {
          // Pipe through depseudonymizing transformer
          const transformer = createOpenAIStreamTransformer(result.pseudonymizer);
          const transformedStream = upstreamResponse.body.pipeThrough(transformer);
          return new Response(transformedStream, {
            status: 200,
            headers: filterResponseHeaders(upstreamResponse.headers),
          });
        }

        // Non-streaming: depseudonymize the JSON response
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

  // ── Passthrough routes (no scanning) ──────────────────────────────────

  const passthroughPaths = ['/v1/models', '/v1/embeddings', '/v1/images', '/v1/audio'];
  for (const path of passthroughPaths) {
    routes.all(`${path}`, (c) => proxyAll(c, upstreamBase));
    routes.all(`${path}/*`, (c) => proxyAll(c, upstreamBase));
  }

  return routes;
}

// ── Helper: Forward request to upstream unchanged ─────────────────────

async function forwardPassthrough(c: any, url: string, body: any): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildUpstreamHeaders(c.req.raw.headers),
    body: JSON.stringify(body),
  });

  return new Response(response.body, {
    status: response.status,
    headers: filterResponseHeaders(response.headers),
  });
}

// ── Helper: Proxy any request to upstream ──────────────────────────────

async function proxyAll(c: any, upstreamBase: string): Promise<Response> {
  const url = `${upstreamBase}${c.req.path}`;
  const method = c.req.method;

  const init: RequestInit = {
    method,
    headers: buildUpstreamHeaders(c.req.raw.headers),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await c.req.raw.text();
  }

  const response = await fetch(url, init);
  return new Response(response.body, {
    status: response.status,
    headers: filterResponseHeaders(response.headers),
  });
}

// ── Helper: Build headers for upstream request ────────────────────────

function buildUpstreamHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers();
  // Forward auth and content-type
  const auth = originalHeaders.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');

  // Forward any OpenAI-specific headers
  const org = originalHeaders.get('OpenAI-Organization');
  if (org) headers.set('OpenAI-Organization', org);
  const project = originalHeaders.get('OpenAI-Project');
  if (project) headers.set('OpenAI-Project', project);

  return headers;
}

// ── Helper: Filter response headers ───────────────────────────────────

function filterResponseHeaders(headers: Headers): HeadersInit {
  const filtered: Record<string, string> = {};
  const passthrough = ['content-type', 'x-request-id', 'openai-model', 'openai-processing-ms'];
  for (const key of passthrough) {
    const value = headers.get(key);
    if (value) filtered[key] = value;
  }
  // Always allow streaming
  if (headers.get('content-type')?.includes('text/event-stream')) {
    filtered['content-type'] = 'text/event-stream';
    filtered['cache-control'] = 'no-cache';
    filtered['connection'] = 'keep-alive';
  }
  return filtered;
}
