// ============================================================================
// Iron Gate — Alert System Service
// ============================================================================
// Centralized alert dispatching for security events. Routes alerts to
// configured channels: in-app (DB), email, Slack, and custom webhooks.
// ============================================================================

import { db } from '../db/client';
import { firms, users, alerts } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { dispatch as dispatchWebhook } from './webhook-dispatcher';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertPayload {
  firmId: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // The user who triggered the alert (optional)
}

/**
 * Dispatch an alert to all configured channels for the firm.
 * Always stores in-app (DB). Conditionally sends email, Slack, webhook.
 */
export async function dispatchAlert(payload: AlertPayload): Promise<string> {
  // 1. Store alert in database (always)
  const [alert] = await db
    .insert(alerts)
    .values({
      firmId: payload.firmId,
      alertType: payload.type,
      severity: payload.severity,
      title: payload.title,
      body: payload.body,
      metadata: payload.metadata ?? {},
    })
    .returning();

  // 2. Get firm config to determine notification preferences
  const [firm] = await db
    .select()
    .from(firms)
    .where(eq(firms.id, payload.firmId))
    .limit(1);

  if (!firm) return alert.id;

  const config = (firm.config ?? {}) as Record<string, any>;
  const notifications = config.notifications ?? {};

  // 3. Dispatch to enabled channels (fire-and-forget)
  const dispatches: Promise<void>[] = [];

  // Email notification
  if (notifications.emailEnabled && payload.severity !== 'info') {
    dispatches.push(sendAlertEmails(payload, firm.name ?? 'Your Firm'));
  }

  // Slack notification
  if (notifications.slackWebhookUrl) {
    dispatches.push(sendSlackAlert(notifications.slackWebhookUrl, payload));
  }

  // Custom webhook
  if (notifications.webhookUrl) {
    dispatches.push(sendCustomWebhook(notifications.webhookUrl, payload));
  }

  // Registered webhook subscriptions
  dispatches.push(
    dispatchWebhook(payload.firmId, payload.type, {
      alertId: alert.id,
      ...payload,
    }),
  );

  // Fire-and-forget — don't block the caller
  Promise.allSettled(dispatches).catch((err) => {
    console.error('[AlertSystem] Dispatch error:', err);
  });

  return alert.id;
}

/**
 * Get alerts for a firm, paginated.
 */
export async function getAlerts(
  firmId: string,
  options: { limit?: number; offset?: number; severity?: AlertSeverity } = {},
) {
  const { limit = 50, offset = 0, severity } = options;

  const conditions = [eq(alerts.firmId, firmId)];
  if (severity) {
    conditions.push(eq(alerts.severity, severity));
  }

  return db
    .select()
    .from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Acknowledge an alert.
 */
export async function acknowledgeAlert(alertId: string, userId: string) {
  return db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
    .where(eq(alerts.id, alertId))
    .returning();
}

// ---------------------------------------------------------------------------
// Channel implementations
// ---------------------------------------------------------------------------

async function sendAlertEmails(payload: AlertPayload, firmName: string): Promise<void> {
  try {
    // Get admin users for the firm
    const admins = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.firmId, payload.firmId), eq(users.role, 'admin')));

    if (admins.length === 0) return;

    // Try to use Resend if available, otherwise log
    try {
      const { sendAlertEmail } = await import('./email');
      const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';

      for (const admin of admins) {
        await sendAlertEmail(
          admin.email,
          payload.title,
          payload.body || `A ${payload.severity} alert was triggered for ${firmName}.`,
          `${dashboardUrl}/dashboard`,
        );
      }
    } catch {
      console.log(`[AlertSystem] Email service not configured. Alert: ${payload.title}`);
    }
  } catch (error) {
    console.error('[AlertSystem] Failed to send email alerts:', error);
  }
}

async function sendSlackAlert(webhookUrl: string, payload: AlertPayload): Promise<void> {
  const colorMap: Record<AlertSeverity, string> = {
    info: '#00B4D8',
    warning: '#F59E0B',
    critical: '#EF4444',
  };

  const emojiMap: Record<AlertSeverity, string> = {
    info: ':information_source:',
    warning: ':warning:',
    critical: ':rotating_light:',
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color: colorMap[payload.severity],
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${emojiMap[payload.severity]} *Iron Gate Alert*\n*${payload.title}*${payload.body ? `\n${payload.body}` : ''}`,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `Severity: *${payload.severity}* | Type: \`${payload.type}\``,
                  },
                ],
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View in Dashboard' },
                    url: `${process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app'}/dashboard`,
                  },
                ],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error('[AlertSystem] Slack delivery failed:', error);
  }
}

async function sendCustomWebhook(webhookUrl: string, payload: AlertPayload): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IronGate-Event': 'alert',
      },
      body: JSON.stringify({
        type: payload.type,
        severity: payload.severity,
        title: payload.title,
        body: payload.body,
        metadata: payload.metadata,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error('[AlertSystem] Custom webhook delivery failed:', error);
  }
}
