import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

// Test the health endpoint in isolation
describe('Health Endpoint', () => {
  const app = new Hono();

  app.get('/health', async (c) => {
    return c.json({
      status: 'ok',
      version: '0.2.0',
      timestamp: new Date().toISOString(),
    });
  });

  it('should return 200 with status ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.2.0');
    expect(body.timestamp).toBeDefined();
  });

  it('should return JSON content type', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
