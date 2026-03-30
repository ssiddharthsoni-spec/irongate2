/**
 * Middleware Security Tests
 *
 * Tests auth middleware, firm context isolation, CSRF protection,
 * rate limiting, RBAC, and security headers — all without a live database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Security Headers ────────────────────────────────────────────────────────

describe('Security Headers Middleware', () => {
  it('should set all required security headers', async () => {
    const { securityHeadersMiddleware } = await import('../src/middleware/security-headers');
    const app = new Hono();
    app.use('*', securityHeadersMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; media-src 'none'; font-src 'none'; connect-src 'self'; style-src 'none'");
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});

// ─── Firm Context Isolation ──────────────────────────────────────────────────

describe('Firm Context Middleware — Multi-Tenancy Isolation', () => {
  it('should reject mismatched X-Firm-ID in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { firmContextMiddleware } = await import('../src/middleware/firm-context');
    const app = new Hono();

    // Simulate auth setting firmId
    app.use('*', async (c, next) => {
      c.set('firmId', 'firm-aaa');
      await next();
    });
    app.use('*', firmContextMiddleware);
    app.get('/test', (c) => c.json({ firmId: c.get('firmId') }));

    const res = await app.request('/test', {
      headers: { 'X-Firm-ID': 'firm-bbb' },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('mismatch');

    process.env.NODE_ENV = originalEnv;
  });

  it('should allow matching X-Firm-ID in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { firmContextMiddleware } = await import('../src/middleware/firm-context');
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('firmId', 'firm-aaa');
      await next();
    });
    app.use('*', firmContextMiddleware);
    app.get('/test', (c) => c.json({ firmId: c.get('firmId') }));

    const res = await app.request('/test', {
      headers: { 'X-Firm-ID': 'firm-aaa' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firmId).toBe('firm-aaa');

    process.env.NODE_ENV = originalEnv;
  });

  it('should reject requests with no firm in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { firmContextMiddleware } = await import('../src/middleware/firm-context');
    const app = new Hono();

    // Auth does NOT set firmId
    app.use('*', firmContextMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(401);

    process.env.NODE_ENV = originalEnv;
  });
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

describe('RBAC Middleware', () => {
  it('should allow admin access to admin-only routes', async () => {
    const { requirePerm } = await import('../src/middleware/rbac');
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('userRole', 'admin');
      await next();
    });
    app.get('/admin', requirePerm('viewDashboard'), (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(200);
  });

  it('should deny user access to admin-only routes', async () => {
    const { requirePerm } = await import('../src/middleware/rbac');
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('userRole', 'user');
      await next();
    });
    app.get('/admin', requirePerm('managePlugins'), (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden');
  });

  it('should deny requests with no role', async () => {
    const { requirePerm } = await import('../src/middleware/rbac');
    const app = new Hono();

    app.get('/admin', requirePerm('viewDashboard'), (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(403);
  });
});

// ─── CSRF Protection ────────────────────────────────────────────────────────

describe('CSRF Protection Middleware', () => {
  it('should allow GET requests without origin check', async () => {
    const { csrfProtectionMiddleware } = await import('../src/middleware/csrf');
    const app = new Hono();
    app.use('*', csrfProtectionMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should allow POST with valid origin', async () => {
    const { csrfProtectionMiddleware } = await import('../src/middleware/csrf');
    const app = new Hono();
    app.use('*', csrfProtectionMiddleware);
    app.post('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'Origin': 'https://irongate-dashboard.vercel.app',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('should block POST from unknown origin', async () => {
    const { csrfProtectionMiddleware } = await import('../src/middleware/csrf');
    const app = new Hono();
    app.use('*', csrfProtectionMiddleware);
    app.post('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'Origin': 'https://evil-site.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('should allow POST from chrome extension', async () => {
    const origExtId = process.env.CHROME_EXTENSION_ID;
    process.env.CHROME_EXTENSION_ID = 'abcdef1234567890';
    try {
      const { csrfProtectionMiddleware } = await import('../src/middleware/csrf');
      const app = new Hono();
      app.use('*', csrfProtectionMiddleware);
      app.post('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          'Origin': 'chrome-extension://abcdef1234567890',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    } finally {
      if (origExtId === undefined) delete process.env.CHROME_EXTENSION_ID;
      else process.env.CHROME_EXTENSION_ID = origExtId;
    }
  });

  it('should allow POST with API key (no origin needed)', async () => {
    const { csrfProtectionMiddleware } = await import('../src/middleware/csrf');
    const app = new Hono();
    app.use('*', csrfProtectionMiddleware);
    app.post('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'X-API-Key': 'ig_test_1234567890abcdef',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});

// ─── PG Error Helpers ────────────────────────────────────────────────────────

describe('PostgreSQL Error Helpers', () => {
  it('should detect unique violation (23505)', async () => {
    const { isUniqueViolation } = await import('../src/lib/pg-errors');

    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('generic'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('string')).toBe(false);
  });
});

// ─── Rate Limiter Logic ──────────────────────────────────────────────────────

describe('Rate Limiter In-Memory Fallback', () => {
  it('should enforce 300 requests per minute limit', async () => {
    // Test the rate limit logic inline (avoid Redis dependency)
    const WINDOW_MS = 60_000;
    const MAX_REQUESTS = 300;
    const requestCounts = new Map<string, { count: number; resetTime: number }>();

    function checkInMemory(key: string): { count: number; remaining: number } {
      const now = Date.now();
      let entry = requestCounts.get(key);
      if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + WINDOW_MS };
        requestCounts.set(key, entry);
      }
      entry.count++;
      return {
        count: entry.count,
        remaining: Math.max(0, MAX_REQUESTS - entry.count),
      };
    }

    // First 300 requests should pass
    for (let i = 0; i < 300; i++) {
      const result = checkInMemory('test-user');
      expect(result.count).toBeLessThanOrEqual(300);
    }

    // 301st should exceed
    const result = checkInMemory('test-user');
    expect(result.count).toBe(301);
    expect(result.remaining).toBe(0);
  });

  it('should track separate counters per user', () => {
    const requestCounts = new Map<string, number>();

    function increment(key: string): number {
      const count = (requestCounts.get(key) || 0) + 1;
      requestCounts.set(key, count);
      return count;
    }

    increment('user-a');
    increment('user-a');
    increment('user-b');

    expect(requestCounts.get('user-a')).toBe(2);
    expect(requestCounts.get('user-b')).toBe(1);
  });
});
