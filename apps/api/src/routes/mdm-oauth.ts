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
import {
  exchangeIntuneAuthCode,
  refreshIntuneAccessToken,
  getIntuneUserInfo,
  getIntuneTenantInfo,
  listIntuneGroups,
  deployIronGateToIntuneGroup,
  INTUNE_OAUTH_SCOPES,
} from '../services/microsoft-intune';
import {
  verifyJamfConnection,
  listJamfComputerGroups,
  deployIronGateToJamfGroup,
  type JamfCredentials,
} from '../services/jamf-pro';
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

// ===========================================================================
// Microsoft Intune (Endpoint Manager) — same pattern as Google Workspace
// ===========================================================================
//
// Flow mirrors the Google integration above. Key differences:
//   - Uses Microsoft identity platform (login.microsoftonline.com/common)
//   - Tenant is multi-tenant (`/common`) — customers grant admin consent
//     per-tenant the first time they connect
//   - Deployment target is an Azure AD security group (vs Google's OU)
//   - Policy is an Intune Settings Catalog configuration profile

function buildIntuneRedirectUri(): string {
  const base = process.env.API_URL || process.env.IRON_GATE_API_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/v1/auth/mdm/intune/callback`;
}

// ---------------------------------------------------------------------------
// PUBLIC ROUTES — mounted under /v1/auth (no auth middleware)
// ---------------------------------------------------------------------------

/**
 * GET /v1/auth/mdm/intune/start
 *
 * Authenticated via query-string signed-state. Redirects to Microsoft's
 * OAuth consent screen on the multi-tenant `/common` endpoint.
 */
mdmOAuthPublicRoutes.get('/intune/start', async (c) => {
  const state = c.req.query('state');
  if (!state) return c.json({ error: 'Missing state' }, 400);

  const verified = verifyState(state);
  if (!verified) return c.json({ error: 'Invalid or expired state' }, 401);

  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  if (!clientId) {
    return c.json(
      { error: 'Microsoft OAuth not configured on this server. Set MICROSOFT_OAUTH_CLIENT_ID.' },
      500,
    );
  }

  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', buildIntuneRedirectUri());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', INTUNE_OAUTH_SCOPES);
  authUrl.searchParams.set('response_mode', 'query');
  // `prompt=consent` ensures the tenant admin sees the consent dialog
  // (needed because DeviceManagementConfiguration.ReadWrite.All requires
  // explicit admin consent per tenant).
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return c.redirect(authUrl.toString(), 302);
});

/**
 * GET /v1/auth/mdm/intune/callback
 *
 * Microsoft redirects here after the admin consents. Exchange code → tokens,
 * encrypt, store, redirect back to the dashboard.
 */
mdmOAuthPublicRoutes.get('/intune/callback', async (c) => {
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  if (error) {
    logger.warn('Microsoft Intune OAuth consent denied', { error, errorDescription });
    const msg = errorDescription ? `${error}: ${errorDescription}` : error;
    return c.redirect(
      `${dashboardUrl}/admin/deployment/microsoft-intune?error=${encodeURIComponent(msg)}`,
      302,
    );
  }

  if (!code || !state) {
    return c.redirect(
      `${dashboardUrl}/admin/deployment/microsoft-intune?error=missing_code`,
      302,
    );
  }

  const verified = verifyState(state);
  if (!verified) {
    return c.redirect(
      `${dashboardUrl}/admin/deployment/microsoft-intune?error=invalid_state`,
      302,
    );
  }

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeIntuneAuthCode(code, buildIntuneRedirectUri());

    // 2. Fetch user + tenant info for audit + later API calls
    const [userInfo, tenantInfo] = await Promise.all([
      getIntuneUserInfo(tokens.accessToken),
      getIntuneTenantInfo(tokens.accessToken).catch(() => null),
    ]);

    // 3. Encrypt tokens for storage
    const tokenPayload = JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
    });
    const encrypted = encryptForFirm(tokenPayload, verified.firmId);

    // 4. Upsert into mdm_connections (provider = microsoft_intune)
    await db
      .insert(mdmConnections)
      .values({
        firmId: verified.firmId,
        provider: 'microsoft_intune',
        encryptedTokens: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
        authorizedByEmail: userInfo.email,
        scopes: tokens.scope.split(' '),
        accessTokenExpiresAt: tokens.expiresAt,
        providerAccountId: tenantInfo?.tenantId ?? null,
        providerDomain: tenantInfo?.primaryDomain ?? null,
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
          providerAccountId: tenantInfo?.tenantId ?? null,
          providerDomain: tenantInfo?.primaryDomain ?? null,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    logger.info('Microsoft Intune connected', {
      firmId: verified.firmId,
      userEmail: userInfo.email,
      tenantId: tenantInfo?.tenantId,
      tenantDomain: tenantInfo?.primaryDomain,
    });

    return c.redirect(
      `${dashboardUrl}/admin/deployment/microsoft-intune?connected=1`,
      302,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Microsoft Intune OAuth callback failed', { error: message });
    return c.redirect(
      `${dashboardUrl}/admin/deployment/microsoft-intune?error=${encodeURIComponent(message)}`,
      302,
    );
  }
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES — mounted under /v1/admin/mdm-oauth (authenticated)
// ---------------------------------------------------------------------------

/**
 * POST /v1/admin/mdm-oauth/intune/initiate
 *
 * Returns a signed state-carrying URL that the browser should navigate to
 * in order to start the Microsoft OAuth flow.
 */
mdmOAuthAdminRoutes.post('/intune/initiate', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const state = signState({
    firmId,
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  });

  const apiBase = process.env.API_URL || process.env.IRON_GATE_API_URL || 'http://localhost:3000';
  const startUrl = `${apiBase.replace(/\/$/, '')}/v1/auth/mdm/intune/start?state=${encodeURIComponent(state)}`;

  return c.json({ startUrl, expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString() });
});

/**
 * GET /v1/admin/mdm-oauth/intune/status
 */
mdmOAuthAdminRoutes.get('/intune/status', async (c) => {
  const firmId = c.get('firmId');

  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'microsoft_intune')))
    .limit(1);

  if (!row) return c.json({ connected: false });

  return c.json({
    connected: true,
    authorizedByEmail: row.authorizedByEmail,
    domain: row.providerDomain,
    tenantId: row.providerAccountId,
    scopes: row.scopes,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    connectedAt: row.createdAt.toISOString(),
  });
});

/**
 * POST /v1/admin/mdm-oauth/intune/disconnect
 */
mdmOAuthAdminRoutes.post('/intune/disconnect', async (c) => {
  const firmId = c.get('firmId');
  await db
    .delete(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'microsoft_intune')));
  return c.json({ disconnected: true });
});

/**
 * GET /v1/admin/mdm-oauth/intune/groups
 *
 * List the tenant's Azure AD security groups so the admin can pick a
 * deployment target.
 */
mdmOAuthAdminRoutes.get('/intune/groups', async (c) => {
  const firmId = c.get('firmId');
  const accessToken = await getValidIntuneAccessToken(firmId);
  if (!accessToken) return c.json({ error: 'Not connected. Connect Microsoft Intune first.' }, 400);

  try {
    const groups = await listIntuneGroups(accessToken);
    return c.json({ groups });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list groups' }, 502);
  }
});

/**
 * POST /v1/admin/mdm-oauth/intune/deploy
 *
 * Creates a Settings Catalog configuration policy in Intune that force-
 * installs the IronGate Chrome extension + pushes the firm's managed
 * config, then assigns it to the selected Azure AD security group.
 */
mdmOAuthAdminRoutes.post('/intune/deploy', async (c) => {
  const firmId = c.get('firmId');

  const bodySchema = z.object({
    groupId: z.string().min(1),
    groupName: z.string().optional(),
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

  const accessToken = await getValidIntuneAccessToken(firmId);
  if (!accessToken) return c.json({ error: 'Not connected. Connect Microsoft Intune first.' }, 400);

  try {
    const result = await deployIronGateToIntuneGroup({
      accessToken,
      groupId: parsed.data.groupId,
      groupName: parsed.data.groupName,
      extensionId: parsed.data.extensionId,
      enrollmentCode: parsed.data.enrollmentCode,
      firmId,
      supportContact: parsed.data.supportContact,
      allowedAITools: parsed.data.allowedAITools,
      deploymentMode: parsed.data.deploymentMode ?? 'local-only',
      enableOllama: parsed.data.enableOllama ?? false,
    });

    await db
      .update(mdmConnections)
      .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'microsoft_intune')));

    logger.info('IronGate deployed to Intune group', {
      firmId,
      groupId: parsed.data.groupId,
      policyId: result.policyId,
    });

    return c.json({
      ok: true,
      policyId: result.policyId,
      assignmentId: result.assignmentId,
      groupId: parsed.data.groupId,
      groupName: parsed.data.groupName,
      message:
        'IronGate has been deployed to the selected Azure AD group. Extensions will install on each device within 15-60 minutes as Intune + Chrome refresh their policies.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Internal helper — load Intune tokens, refresh if expired
// ---------------------------------------------------------------------------

async function getValidIntuneAccessToken(firmId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'microsoft_intune')))
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

  if (row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - 5 * 60 * 1000 > Date.now()) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    logger.warn('Intune access token expired and no refresh token available', { firmId });
    return null;
  }

  try {
    const refreshed = await refreshIntuneAccessToken(tokens.refreshToken);
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
      .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'microsoft_intune')));

    return refreshed.accessToken;
  } catch (err) {
    logger.error('Intune token refresh failed', {
      firmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ===========================================================================
// JAMF PRO — admin-only routes (no public redirect pair)
// ===========================================================================
//
// Jamf uses per-customer credentials: the customer admin provisions an API
// Role + API Client inside THEIR Jamf instance and pastes three values into
// IronGate. There is no user-redirect OAuth — so no /start or /callback.
// All Jamf interactions live under the admin router.
//
// Credential storage: we encrypt `{ jamfUrl, clientId, clientSecret }` as
// JSON using `encryptForFirm` (same AES-256-GCM path Google/Intune use).
// We do NOT persist access tokens — they expire every ~30 minutes and are
// cheap to re-issue, so every Jamf operation does a fresh client_credentials
// exchange on-demand.

/** Load + decrypt stored Jamf credentials for this firm, or null. */
async function getJamfCredentials(firmId: string): Promise<JamfCredentials | null> {
  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'jamf_pro')))
    .limit(1);

  if (!row) return null;

  try {
    const decrypted = decryptForFirm(
      { ciphertext: row.encryptedTokens, iv: row.encryptionIv, authTag: row.encryptionAuthTag },
      firmId,
    );
    const parsed = JSON.parse(decrypted) as JamfCredentials;
    if (!parsed.jamfUrl || !parsed.clientId || !parsed.clientSecret) return null;
    return parsed;
  } catch (err) {
    logger.error('Failed to decrypt Jamf credentials', {
      firmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * POST /v1/admin/mdm-oauth/jamf/connect
 *
 * Body: { jamfUrl, clientId, clientSecret }
 *
 * Verifies the credentials by exchanging them for a token + pinging a
 * trivial endpoint, then encrypts + stores them. Fails fast with a clear
 * error if the credentials are wrong or the role is missing permissions.
 */
mdmOAuthAdminRoutes.post('/jamf/connect', async (c) => {
  const firmId = c.get('firmId');

  const bodySchema = z.object({
    jamfUrl: z.string().min(1).refine((s) => /^https:\/\//i.test(s.trim()), {
      message: 'Jamf URL must start with https://',
    }),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  });

  const body = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid payload', issues: parsed.error.issues }, 400);

  const creds: JamfCredentials = {
    jamfUrl: parsed.data.jamfUrl.trim().replace(/\/+$/, ''),
    clientId: parsed.data.clientId.trim(),
    clientSecret: parsed.data.clientSecret,
  };

  // Verify BEFORE storing — we don't want to persist bad credentials.
  const verification = await verifyJamfConnection(creds);
  if (!verification.ok) {
    return c.json(
      {
        error:
          verification.error ||
          'Could not verify Jamf credentials. Double-check the URL, Client ID, and Client Secret.',
      },
      400,
    );
  }

  // Encrypt + upsert
  const encrypted = encryptForFirm(JSON.stringify(creds), firmId);
  const jamfHost = (() => {
    try {
      return new URL(creds.jamfUrl).host;
    } catch {
      return null;
    }
  })();

  await db
    .insert(mdmConnections)
    .values({
      firmId,
      provider: 'jamf_pro',
      encryptedTokens: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
      // Jamf has no "admin email" from OAuth — record the client ID prefix
      // instead, for audit purposes. Stored as varchar(255).
      authorizedByEmail: `jamf-client:${creds.clientId.substring(0, 32)}`,
      scopes: [],
      accessTokenExpiresAt: null,
      providerAccountId: creds.jamfUrl,
      providerDomain: jamfHost,
      lastVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mdmConnections.firmId, mdmConnections.provider],
      set: {
        encryptedTokens: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
        authorizedByEmail: `jamf-client:${creds.clientId.substring(0, 32)}`,
        providerAccountId: creds.jamfUrl,
        providerDomain: jamfHost,
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  logger.info('Jamf Pro connected', {
    firmId,
    jamfHost,
    jamfVersion: verification.jamfVersion,
  });

  return c.json({
    ok: true,
    jamfUrl: creds.jamfUrl,
    jamfVersion: verification.jamfVersion,
  });
});

/**
 * GET /v1/admin/mdm-oauth/jamf/status
 *
 * Return connection metadata for the UI. Does NOT echo the clientId or
 * clientSecret — only the Jamf URL + verification timestamp.
 */
mdmOAuthAdminRoutes.get('/jamf/status', async (c) => {
  const firmId = c.get('firmId');

  const [row] = await db
    .select()
    .from(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'jamf_pro')))
    .limit(1);

  if (!row) return c.json({ connected: false });

  return c.json({
    connected: true,
    jamfUrl: row.providerAccountId,
    jamfHost: row.providerDomain,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    connectedAt: row.createdAt.toISOString(),
  });
});

/**
 * POST /v1/admin/mdm-oauth/jamf/disconnect
 *
 * Remove the stored credentials. Note: existing configuration profiles in
 * Jamf stay in place — this only stops IronGate from pushing new ones.
 */
mdmOAuthAdminRoutes.post('/jamf/disconnect', async (c) => {
  const firmId = c.get('firmId');
  await db
    .delete(mdmConnections)
    .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'jamf_pro')));
  return c.json({ disconnected: true });
});

/**
 * GET /v1/admin/mdm-oauth/jamf/computer-groups
 *
 * List Jamf computer groups so the admin can pick a deployment target.
 */
mdmOAuthAdminRoutes.get('/jamf/computer-groups', async (c) => {
  const firmId = c.get('firmId');
  const creds = await getJamfCredentials(firmId);
  if (!creds) return c.json({ error: 'Not connected. Connect Jamf Pro first.' }, 400);

  try {
    const groups = await listJamfComputerGroups(creds);
    return c.json({ computerGroups: groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

/**
 * POST /v1/admin/mdm-oauth/jamf/deploy
 *
 * THE ONE-CLICK DEPLOY (Jamf flavor). Creates a Jamf OS X Configuration
 * Profile scoped to the target computer group that force-installs the
 * IronGate Chrome extension and pushes the firm's managed policy.
 */
mdmOAuthAdminRoutes.post('/jamf/deploy', async (c) => {
  const firmId = c.get('firmId');

  const bodySchema = z.object({
    groupId: z.number().int().positive(),
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

  const creds = await getJamfCredentials(firmId);
  if (!creds) return c.json({ error: 'Not connected. Connect Jamf Pro first.' }, 400);

  try {
    const result = await deployIronGateToJamfGroup({
      creds,
      groupId: parsed.data.groupId,
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
      .where(and(eq(mdmConnections.firmId, firmId), eq(mdmConnections.provider, 'jamf_pro')));

    logger.info('IronGate deployed to Jamf computer group', {
      firmId,
      groupId: parsed.data.groupId,
      profileId: result.profileId,
    });

    return c.json({
      ok: true,
      profileId: result.profileId,
      profileName: result.profileName,
      groupId: parsed.data.groupId,
      message:
        'IronGate has been deployed as a Jamf configuration profile. Managed Macs in the selected computer group will receive the policy on their next Jamf check-in (typically within 15 minutes).',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});
