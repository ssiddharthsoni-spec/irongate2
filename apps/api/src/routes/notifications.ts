// ============================================================================
// Iron Gate — Notification Routes
// ============================================================================
// Manages notification preferences (stored in firms.config.notifications)
// and provides a test endpoint for sending sample emails.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { sendAlertEmail } from '../services/email';
import type { AppEnv } from '../types';

export const notificationRoutes = new Hono<AppEnv>();

// Default notification preferences
const DEFAULT_PREFERENCES = {
  emailAlerts: true,
  alertOnCritical: true,
  alertOnHigh: true,
  alertOnBlock: true,
  alertOnOverride: false,
  weeklyDigest: true,
  digestDay: 'monday' as string,
  recipients: [] as string[], // additional recipients beyond the admin
};

type NotificationPreferences = typeof DEFAULT_PREFERENCES;

// ---------------------------------------------------------------------------
// GET /v1/notifications/preferences — Get firm notification preferences
// ---------------------------------------------------------------------------
notificationRoutes.get('/preferences', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db
    .select({ config: firms.config })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  const config = (firm.config as Record<string, unknown>) || {};
  const notifications = (config.notifications as NotificationPreferences) || DEFAULT_PREFERENCES;

  return c.json({
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...notifications,
    },
  });
});

// ---------------------------------------------------------------------------
// PUT /v1/notifications/preferences — Update notification preferences
// ---------------------------------------------------------------------------
notificationRoutes.put('/preferences', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

  const preferencesSchema = z.object({
    emailAlerts: z.boolean().optional(),
    alertOnCritical: z.boolean().optional(),
    alertOnHigh: z.boolean().optional(),
    alertOnBlock: z.boolean().optional(),
    alertOnOverride: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
    digestDay: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).optional(),
    recipients: z.array(z.string().email()).optional(),
  });

  const parsed = preferencesSchema.parse(body);

  // Merge with existing config
  const [firm] = await db
    .select({ config: firms.config })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  const existingConfig = (firm.config as Record<string, unknown>) || {};
  const existingNotifications = (existingConfig.notifications as Partial<NotificationPreferences>) || {};

  const updatedNotifications = {
    ...DEFAULT_PREFERENCES,
    ...existingNotifications,
    ...parsed,
  };

  const [updated] = await db
    .update(firms)
    .set({
      config: { ...existingConfig, notifications: updatedNotifications },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId))
    .returning();

  return c.json({ preferences: updatedNotifications });
});

// ---------------------------------------------------------------------------
// POST /v1/notifications/test — Send a test notification email
// ---------------------------------------------------------------------------
notificationRoutes.post('/test', async (c) => {
  const userId = c.get('userId');

  // Look up the requesting user's email
  const [user] = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';

  const result = await sendAlertEmail(
    user.email,
    'Test Notification',
    'This is a test notification from Iron Gate. If you received this email, your notification settings are configured correctly.',
    dashboardUrl,
  );

  if (!result.success) {
    return c.json({ error: 'Failed to send test email', details: result.error }, 500);
  }

  return c.json({
    ok: true,
    message: `Test email sent to ${user.email}`,
    emailId: result.id,
  });
});
