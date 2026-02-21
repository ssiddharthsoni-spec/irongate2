import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { alerts } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { dispatchAlert, getAlerts, acknowledgeAlert } from '../services/alert-system';
import type { AppEnv } from '../types';

export const alertRoutes = new Hono<AppEnv>();

// GET / — List alerts for the firm
alertRoutes.get('/', async (c) => {
  const firmId = c.get('firmId');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const severity = c.req.query('severity') as 'info' | 'warning' | 'critical' | undefined;

  const results = await getAlerts(firmId, { limit, offset, severity });

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(alerts)
    .where(eq(alerts.firmId, firmId));

  // Count unacknowledged
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)` })
    .from(alerts)
    .where(and(eq(alerts.firmId, firmId), sql`${alerts.acknowledgedAt} IS NULL`));

  return c.json({
    alerts: results,
    total: Number(count),
    unread: Number(unread),
    limit,
    offset,
  });
});

// PATCH /:id/acknowledge — Acknowledge an alert
alertRoutes.patch('/:id/acknowledge', async (c) => {
  const userId = c.get('userId');
  const alertId = c.req.param('id');

  const [updated] = await acknowledgeAlert(alertId, userId);
  if (!updated) {
    return c.json({ error: 'Alert not found' }, 404);
  }

  return c.json(updated);
});

// POST /acknowledge-all — Acknowledge all alerts for the firm
alertRoutes.post('/acknowledge-all', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  await db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
    .where(and(eq(alerts.firmId, firmId), sql`${alerts.acknowledgedAt} IS NULL`));

  return c.json({ success: true });
});

// POST /test — Send a test alert (for testing notification channels)
alertRoutes.post('/test', async (c) => {
  const firmId = c.get('firmId');

  const alertId = await dispatchAlert({
    firmId,
    type: 'test_alert',
    severity: 'info',
    title: 'Test Alert — Iron Gate notification test',
    body: 'This is a test alert to verify your notification channels are configured correctly.',
    metadata: { test: true },
  });

  return c.json({ success: true, alertId });
});
