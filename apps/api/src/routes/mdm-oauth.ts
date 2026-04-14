// ============================================================================
// MDM OAuth Routes — Google Workspace integration (Phase 1)
// ============================================================================
//
// Flow:
//   1. Admin clicks "Connect Google Workspace" in IronGate dashboard
//   2. Browser hits GET /v1/auth/mdm/google/start?state=<firm-session>
//      → redirects to Google's OAuth consent screen
//   3. Admin approves; Google redirects to GET /v1/auth/mdm/google/callback
//      with ?code=...
//   4. IronGate exchanges the code for tokens, encrypts, stores in
//      mdm_connections table, then redirects the admin back to the
//      dashboard at /admin/deployment/google-workspace?connected=1
//   5. Dashboard UI can now call protected admin routes to list OUs,
//      push the IronGate policy, etc.
//
// Callback is PUBLIC (no auth middleware) because Google redirects the
// user's browser without any IronGate auth context. We authenticate via
// a signed `state` parameter that embeds the firmId + userId + nonce.

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { mdmConnections, users } from '../db/schema';
import {
  exchangeGoogleAuthCode,
  getGoogleUserInfo,
  getGoogleCustomerId,
  GOOGLE_OAUTH_SCOPES,
  listOrgUnits,
  deployIronGateToOrgUnit,
  refreshGoogleAccessToken,
} from '../services/google-workspace';
import { encryptForFirm, decryptForFirm } from '../lib/token-encryption';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

export const mdmOAuthPublicRoutes = new Hono<AppEnv>();
export const mdmOAuthAdminRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// State signing helpers (prevents CSRF on OAuth callback)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getStateSecret(): string {
  return (
    process.env.IRON_GATE_SIGNING_SECRET ||
    process.env.JWT_SIGNING_KEY ||
    process.env.IRON_GATE_MASTER_SECRET ||
    'dev-only-do-not-ship'
  );
}

function signState(payload: { firmId: string; userId: string; nonce: string; exp: number }): string {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', getStateSecret()).update(json).digest('hex');
  return Buffer.from(`${json}.${sig}`, 'utf8').toString('base64url');
}

function verifyState(token: string): { firmId: string; userId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return null;
    const json = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expectedSig = crypto.createHmac('sha256', getStateSecret()).update(json).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null;
    const parsed = JSON.parse(json) as { firmId: string; userId: string; nonce: string; exp: number };
    if (Date.now() > parsed.exp) return null;
    return { firmId: parsed.firmId, userId: parsed.userId };
  } catch {
    return null;
  }
}

function buildGoogleRedirectUri(): string {
  // The redirect URI must match exactly what's registered in Google Cloud
  // Console → APIs & Services → Credentials → OAuth 2.0 Client IDs.
  const base = process.env.API_URL || process.env.IRON_GATE_API_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/v1/auth/mdm/google/callback`;
}

// ===========================================================================
// PUBLIC ROUTES — mounted under /v1/auth (no auth middleware)
// ===========================================================================

/**
 * GET /v1/auth/mdm/google/start
 *
 * Authenticated via query-string signed-state (issued by the admin endpoint
 * below). Redirects the browser to Google's OAuth consent screen.
 */
mdmOAuthPublicRoutes.get('/google/start', async (c) => {
  const state = c.req.query('state');
  if (!state) return c.json({ error: 'Missing state' }, 400);

  const verified = verifyState(state);
  if (!verified) return c.json({ error: 'Invalid or expired state' }, 401);

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return c.json({ error: 'Google OAuth not configured on this server. Set GOOGLE_OAUTH_CLIENT_ID.' }, 500);
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', buildGoogleRedirectUri());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES);
  authUrl.searchParams.set('access_type', 'offline'); // for refresh token
  authUrl.searchParams.set('prompt', 'consent'); // force refresh_token issuance
  authUrl.searchParams.set('state', state);

  return c.redirect(authUrl.toString(), 302);
});

/**
 * GET /v1/auth/mdm/google/callback
 *
 * Google redirects here after the admin consents. Exchange the code for
 * tokens, encrypt, store, then bounce back to the dashboard.
 */
mdmOAuthPublicRoutes.get('/google/callback', async (c) => {
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    logger.warn('Google OAuth consent denied', { error });
    return c.redirect(`${dashboardUrl}/admin/deployment/google-workspace?error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !state) {
    return c.redirect(`${dashboardUrl}/admin/deployment/google-workspace?error=missing_code`, 302);
  }

  const verified = verifyState(state);
  if (!verified) {
    return c.redirect(`${dashboardUrl}/admin/deployment/google-workspace?error=invalid_state`, 302);
  }

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeGoogleAuthCode(code, buildGoogleRedirectUri());

    // 2. Fetch user info + customer ID for audit + later API calls
    const [userInfo, customerId] = await Promise.all([
      getGoogleUserInfo(tokens.accessToken),
      getGoogleCustomerId(tokens.accessToken).catch(() => null),
    ]);

    // 3. Encrypt tokens for storage
    const tokenPayload = JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
    });
    const encrypted = encryptForFirm(tokenPayload, verified.firmId);

    // 4. Upsert into mdm_connections
    await db
      .insert(mdmConnections)
      .values({
        firmId: verified.firmId,
        provider: 'google_workspace',
        encryptedTokens: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
        authorizedByEmail: userInfo.email,
        scopes: tokens.scope.split(' '),
        accessTokenExpiresAt: tokens.expiresAt,
        providerAccountId: customerId ?? null,
        providerDomain: userInfo.hd ?? null,
        lastVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [mdmConnections.firmId, mdmConnections.provider],
        set: {
          encryptedTokens: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          encryptionAuthTag: encrypted.authTag,
          authorizedByEmail: userInfo.email,
          scopes: tokens.scope.split(' '),
          accessTokenExpiresAt: tokens.expiresAt,
          providerAccountId: customerId ?? null,
          providerDomain: userInfo.hd ?? null,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    logger.info('Google Workspace connected', {
      firmId: verified.firmId,
      userEmail: userInfo.email,
      domain: userInfo.hd,
    });

    return c.redirect(`${dashboardUrl}/admin/deployment/google-workspace?connected=1`, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Google Workspace OAuth callback failed', { error: message });
    return c.redirect(
      `${dashboardUrl}/admin/deployment/google-workspace?error=${encodeURIComponent(message)}`,
      302,
    );
  }
});

// ===========================================================================
// ADMIN ROUTES — mounted under /v1/admin (authenticated)
// ===========================================================================

/**
 * POST /v1/admin/mdm/google/initiate
 *
 * Called by the dashboard UI when the admin clicks "Connect Google Workspace".
 * Returns a signed state-carrying URL that the browser should navigate to.
 */
mdmOAuthAdminRoutes.post('/google/initiate', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const state = signState({
    firmId,
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  });

  const apiBase = process.env.API_URL || process.env.IRON_GATE_API_URL || 'http://localhost:3000';
  const startUrl = `${apiBase.replace(/\/$/, '')}/v1/auth/mdm/google/start?state=${encodeURIComponent(state)}`;

  return c.json({ startUrl, expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString() });
});

/**
 * GET /v1/admin/mdm/google/status
 *
 * Check whether this firm has an active Google Workspace connection, and
 * return metadata for the UI (authorized email, domain, scopes, last verified).
 */
mdmOAuthAdminRoutes.get('/google/status', async (c) => {
  const firmId = c.get('firmId');

  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')))
    .limit(1);

  if (!row) return c.json({ connected: false });

  return c.json({
    connected: true,
    authorizedByEmail: row.authorizedByEmail,
    domain: row.providerDomain,
    scopes: row.scopes,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    connectedAt: row.createdAt.toISOString(),
  });
});

/**
 * POST /v1/admin/mdm/google/disconnect
 *
 * Revoke the stored tokens. User-facing UI calls this when the admin
 * wants to unlink. We don't call Google's revoke endpoint here — the user
 * can revoke from myaccount.google.com if they want — just deletes our
 * local record.
 */
mdmOAuthAdminRoutes.post('/google/disconnect', async (c) => {
  const firmId = c.get('firmId');
  await db
    .delete(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')));
  return c.json({ disconnected: true });
});

/**
 * GET /v1/admin/mdm/google/org-units
 *
 * List the firm's Google Workspace organizational units so the admin
 * can pick where to deploy.
 */
mdmOAuthAdminRoutes.get('/google/org-units', async (c) => {
  const firmId = c.get('firmId');
  const accessToken = await getValidAccessToken(firmId);
  if (!accessToken) return c.json({ error: 'Not connected. Connect Google Workspace first.' }, 400);

  try {
    const ous = await listOrgUnits(accessToken);
    return c.json({ orgUnits: ous });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list OUs' }, 502);
  }
});

/**
 * POST /v1/admin/mdm/google/deploy
 *
 * THE ONE-CLICK DEPLOY. Pushes the IronGate Chrome extension + managed
 * policy to the selected OU via Google's Chrome Policy API.
 */
mdmOAuthAdminRoutes.post('/google/deploy', async (c) => {
  const firmId = c.get('firmId');

  const bodySchema = z.object({
    orgUnitPath: z.string().min(1),
    extensionId: z.string().min(10),
    enrollmentCode: z.string().min(1),
    supportContact: z.string().optional(),
    allowedAITools: z.array(z.string()).optional(),
    deploymentMode: z.enum(['local-only', 'hybrid', 'server-only']).optional(),
    enableOllama: z.boolean().optional(),
  });

  const body = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid payload', issues: parsed.error.issues }, 400);

  const accessToken = await getValidAccessToken(firmId);
  if (!accessToken) return c.json({ error: 'Not connected. Connect Google Workspace first.' }, 400);

  // Fetch the customer ID we stored during OAuth (fast path)
  const [conn] = await db
    .select({ providerAccountId: mdmConnections.providerAccountId })
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')))
    .limit(1);

  const customerId = conn?.providerAccountId;
  if (!customerId) {
    return c.json({ error: 'Customer ID not available. Reconnect Google Workspace.' }, 400);
  }

  try {
    const result = await deployIronGateToOrgUnit({
      accessToken,
      customerId,
      orgUnitPath: parsed.data.orgUnitPath,
      extensionId: parsed.data.extensionId,
      enrollmentCode: parsed.data.enrollmentCode,
      firmId,
      supportContact: parsed.data.supportContact,
      allowedAITools: parsed.data.allowedAITools,
      deploymentMode: parsed.data.deploymentMode ?? 'local-only',
      enableOllama: parsed.data.enableOllama ?? false,
    });

    // Touch lastVerifiedAt — proves the connection is still working
    await db
      .update(mdmConnections)
      .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')));

    logger.info('IronGate deployed to Google Workspace OU', {
      firmId,
      orgUnitPath: parsed.data.orgUnitPath,
      policiesApplied: result.policiesApplied,
    });

    return c.json({
      ok: true,
      policiesApplied: result.policiesApplied,
      orgUnitPath: parsed.data.orgUnitPath,
      message:
        'IronGate has been deployed to the selected organizational unit. Extensions will install on each device within 1-10 minutes as Chrome refreshes its policy.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Internal helper — load tokens, refresh if expired, return valid access token
// ---------------------------------------------------------------------------

async function getValidAccessToken(firmId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')))
    .limit(1);

  if (!row) return null;

  const decrypted = decryptForFirm(
    { ciphertext: row.encryptedTokens, iv: row.encryptionIv, authTag: row.encryptionAuthTag },
    firmId,
  );
  const tokens = JSON.parse(decrypted) as {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
  };

  // If access token still valid (with 5-min buffer), use it
  if (row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - 5 * 60 * 1000 > Date.now()) {
    return tokens.accessToken;
  }

  // Otherwise refresh
  if (!tokens.refreshToken) {
    logger.warn('Access token expired and no refresh token available', { firmId });
    return null;
  }

  try {
    const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
    const newPayload = JSON.stringify({ ...tokens, accessToken: refreshed.accessToken });
    const newEncrypted = encryptForFirm(newPayload, firmId);

    await db
      .update(mdmConnections)
      .set({
        encryptedTokens: newEncrypted.ciphertext,
        encryptionIv: newEncrypted.iv,
        encryptionAuthTag: newEncrypted.authTag,
        accessTokenExpiresAt: refreshed.expiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'google_workspace')));

    return refreshed.accessToken;
  } catch (err) {
    logger.error('Token refresh failed', { firmId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
