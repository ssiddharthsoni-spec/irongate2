// ============================================================================
// Iron Gate — Email Service (Resend)
// ============================================================================
// Sends transactional emails via Resend. Falls back to console logging when
// RESEND_API_KEY is not configured (development mode).
// ============================================================================

import { Resend } from 'resend';

const FROM_ADDRESS = 'Iron Gate <notifications@irongate.ai>';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (resend) return resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  resend = new Resend(apiKey);
  return resend;
}

// ---------------------------------------------------------------------------
// Shared HTML layout
// ---------------------------------------------------------------------------

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Iron Gate</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0d9488, #0f766e); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                <span style="display: inline-block; width: 32px; height: 32px; background-color: rgba(255,255,255,0.2); border-radius: 6px; text-align: center; line-height: 32px; font-size: 18px; margin-right: 10px; vertical-align: middle;">&#x1f6e1;</span>
                Iron Gate
              </h1>
              <p style="margin: 6px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; letter-spacing: 0.5px;">AI DATA PROTECTION</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 8px; color: #94a3b8; font-size: 12px;">
                Iron Gate &mdash; Protecting sensitive data in AI workflows.
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 11px;">
                &copy; ${new Date().getFullYear()} Iron Gate Security, Inc. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
  <tr>
    <td style="background-color: #0d9488; border-radius: 6px;">
      <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">
        ${text}
      </a>
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// Send helper
// ---------------------------------------------------------------------------

async function sendEmail(to: string, subject: string, html: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = getResend();

  if (!client) {
    console.log('[Email] Development fallback — RESEND_API_KEY not set');
    console.log(`[Email] To: ${to}`);
    console.log(`[Email] Subject: ${subject}`);
    console.log(`[Email] Body length: ${html.length} chars`);
    return { success: true, id: `dev-${Date.now()}` };
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Email] Failed to send:', message);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public email functions
// ---------------------------------------------------------------------------

/**
 * Welcome email sent after a user signs up.
 */
export async function sendWelcomeEmail(to: string, name: string) {
  const subject = 'Welcome to Iron Gate';
  const displayName = name || 'there';

  const html = emailLayout(`
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 22px; font-weight: 600;">Welcome aboard, ${displayName}!</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
      Thank you for joining Iron Gate. Your organization is now set up to detect and protect sensitive data flowing into AI tools.
    </p>
    <p style="margin: 0 0 8px; color: #475569; font-size: 15px; line-height: 1.6;">
      Here&rsquo;s what you can do next:
    </p>
    <ul style="margin: 0 0 16px; padding-left: 20px; color: #475569; font-size: 15px; line-height: 1.8;">
      <li>Install the browser extension to start monitoring AI interactions</li>
      <li>Configure your sensitivity thresholds in the dashboard</li>
      <li>Invite team members to your organization</li>
      <li>Set up webhook integrations for real-time alerts</li>
    </ul>
    ${ctaButton('Open Dashboard', process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app')}
    <p style="margin: 0; color: #94a3b8; font-size: 13px;">
      If you have any questions, reply to this email and we&rsquo;ll be happy to help.
    </p>
  `);

  return sendEmail(to, subject, html);
}

/**
 * Invite email sent to a team member being added to a firm.
 */
export async function sendInviteEmail(to: string, inviterName: string, firmName: string, inviteToken: string) {
  const subject = `You've been invited to ${firmName} on Iron Gate`;
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';
  const acceptUrl = `${dashboardUrl}/invite/accept?token=${inviteToken}`;

  const html = emailLayout(`
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 22px; font-weight: 600;">You&rsquo;re invited!</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
      <strong>${inviterName}</strong> has invited you to join <strong>${firmName}</strong> on Iron Gate, the AI data protection platform.
    </p>
    <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
      Iron Gate helps organizations detect and protect sensitive information before it enters AI tools like ChatGPT, Claude, and others.
    </p>
    ${ctaButton('Accept Invitation', acceptUrl)}
    <p style="margin: 0 0 8px; color: #94a3b8; font-size: 13px;">
      This invitation expires in 7 days. If you didn&rsquo;t expect this email, you can safely ignore it.
    </p>
    <p style="margin: 0; color: #cbd5e1; font-size: 12px; word-break: break-all;">
      Or copy this link: ${acceptUrl}
    </p>
  `);

  return sendEmail(to, subject, html);
}

/**
 * Security alert email triggered by high-sensitivity events.
 */
export async function sendAlertEmail(to: string, alertTitle: string, alertBody: string, dashboardUrl: string) {
  const subject = `[Alert] ${alertTitle}`;

  const html = emailLayout(`
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: #dc2626; font-size: 14px; font-weight: 600;">
        &#9888; Security Alert
      </p>
    </div>
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 22px; font-weight: 600;">${alertTitle}</h2>
    <p style="margin: 0 0 24px; color: #475569; font-size: 15px; line-height: 1.6;">
      ${alertBody}
    </p>
    ${ctaButton('View in Dashboard', dashboardUrl)}
    <p style="margin: 0; color: #94a3b8; font-size: 13px;">
      You are receiving this because your organization has email alerts enabled for security events. You can adjust these settings in your notification preferences.
    </p>
  `);

  return sendEmail(to, subject, html);
}

/**
 * Weekly digest summarizing the firm's AI data protection activity.
 */
export async function sendWeeklyDigest(
  to: string,
  firmName: string,
  stats: { prompts: number; entities: number; avgScore: number; topEntities: string[] },
) {
  const subject = `Weekly Report: ${firmName} — Iron Gate`;
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';

  const topEntitiesHtml = stats.topEntities.length > 0
    ? stats.topEntities
        .map(
          (e) =>
            `<span style="display: inline-block; background-color: #f0fdfa; color: #0d9488; padding: 4px 12px; border-radius: 16px; font-size: 13px; margin: 2px 4px 2px 0; border: 1px solid #99f6e4;">${e}</span>`,
        )
        .join('')
    : '<span style="color: #94a3b8; font-size: 14px;">No entities detected this week</span>';

  const html = emailLayout(`
    <h2 style="margin: 0 0 8px; color: #1e293b; font-size: 22px; font-weight: 600;">Weekly Summary</h2>
    <p style="margin: 0 0 24px; color: #64748b; font-size: 14px;">${firmName} &mdash; Last 7 days</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td width="33%" style="padding: 16px; background-color: #f0fdfa; border-radius: 8px; text-align: center;">
          <p style="margin: 0 0 4px; color: #0d9488; font-size: 28px; font-weight: 700;">${stats.prompts.toLocaleString()}</p>
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Prompts Scanned</p>
        </td>
        <td width="4%"></td>
        <td width="33%" style="padding: 16px; background-color: #f0fdfa; border-radius: 8px; text-align: center;">
          <p style="margin: 0 0 4px; color: #0d9488; font-size: 28px; font-weight: 700;">${stats.entities.toLocaleString()}</p>
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Entities Found</p>
        </td>
        <td width="4%"></td>
        <td width="33%" style="padding: 16px; background-color: #f0fdfa; border-radius: 8px; text-align: center;">
          <p style="margin: 0 0 4px; color: #0d9488; font-size: 28px; font-weight: 700;">${stats.avgScore.toFixed(1)}</p>
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Avg Risk Score</p>
        </td>
      </tr>
    </table>

    <h3 style="margin: 0 0 12px; color: #334155; font-size: 16px; font-weight: 600;">Top Entity Types</h3>
    <div style="margin-bottom: 28px;">
      ${topEntitiesHtml}
    </div>

    ${ctaButton('View Full Report', `${dashboardUrl}/reports`)}
    <p style="margin: 0; color: #94a3b8; font-size: 13px;">
      This digest is sent weekly. Manage your notification preferences in the dashboard settings.
    </p>
  `);

  return sendEmail(to, subject, html);
}

/**
 * Password reset email (for non-Clerk auth flows).
 */
export async function sendPasswordReset(to: string, resetUrl: string) {
  const subject = 'Reset your Iron Gate password';

  const html = emailLayout(`
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 22px; font-weight: 600;">Password Reset</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
      We received a request to reset the password for your Iron Gate account. Click the button below to choose a new password.
    </p>
    ${ctaButton('Reset Password', resetUrl)}
    <p style="margin: 0 0 8px; color: #475569; font-size: 14px; line-height: 1.6;">
      This link will expire in 1 hour. If you did not request a password reset, please ignore this email &mdash; your password will remain unchanged.
    </p>
    <p style="margin: 0; color: #cbd5e1; font-size: 12px; word-break: break-all;">
      Or copy this link: ${resetUrl}
    </p>
  `);

  return sendEmail(to, subject, html);
}
