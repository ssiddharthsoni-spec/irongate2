// ============================================================================
// Google Workspace API client
// ============================================================================
//
// Provides the subset of Google APIs IronGate needs to one-click-deploy to
// a customer's Workspace: OAuth token exchange/refresh, Directory API (list
// OUs), and Chrome Policy API (push managed extension policy).
//
// We use raw fetch() instead of pulling the `googleapis` SDK — fewer deps,
// tighter control, and only ~5 endpoints actually needed.
// ============================================================================

import { logger } from '../lib/logger';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADMIN_DIRECTORY_API = 'https://admin.googleapis.com/admin/directory/v1';
const GOOGLE_CHROME_POLICY_API = 'https://chromepolicy.googleapis.com/v1';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * OAuth scopes IronGate requests. Each one is justified:
 *
 *   admin.directory.orgunit.readonly — list the customer's OUs so admin
 *     can pick which group to deploy IronGate to
 *   admin.directory.customer.readonly — read customer ID for Chrome Policy API
 *   chrome.management.policy — push the Chrome extension force-install +
 *     managed extension config policies
 *   userinfo.email — confirm which admin authorized (for audit log)
 */
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  'https://www.googleapis.com/auth/admin.directory.customer.readonly',
  'https://www.googleapis.com/auth/chrome.management.policy',
].join(' ');

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: Date;
  scope: string;
}

export interface OrgUnit {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// OAuth: exchange authorization code for tokens
// ---------------------------------------------------------------------------

export async function exchangeGoogleAuthCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[google-workspace] GOOGLE_OAUTH_CLIENT_ID / _SECRET not configured');
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[google-workspace] token exchange failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

// ---------------------------------------------------------------------------
// OAuth: refresh access token using stored refresh token
// ---------------------------------------------------------------------------

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[google-workspace] GOOGLE_OAUTH_CLIENT_ID / _SECRET not configured');
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[google-workspace] token refresh failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Userinfo — used to capture which admin authorized the connection
// ---------------------------------------------------------------------------

export async function getGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  hd?: string; // hosted domain
  sub: string;
}> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`[google-workspace] userinfo failed: ${response.status}`);
  return response.json() as Promise<{ email: string; hd?: string; sub: string }>;
}

// ---------------------------------------------------------------------------
// Customer lookup — needed as the `customer` parameter for Chrome Policy API
// ---------------------------------------------------------------------------

export async function getGoogleCustomerId(accessToken: string): Promise<string> {
  const response = await fetch(`${GOOGLE_ADMIN_DIRECTORY_API}/customers/my_customer`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[google-workspace] customer lookup failed: ${response.status} ${err}`);
  }
  const data = (await response.json()) as { id: string };
  return data.id;
}

// ---------------------------------------------------------------------------
// Directory API — list organizational units
// ---------------------------------------------------------------------------

export async function listOrgUnits(accessToken: string): Promise<OrgUnit[]> {
  const response = await fetch(
    `${GOOGLE_ADMIN_DIRECTORY_API}/customer/my_customer/orgunits?type=all`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[google-workspace] list OUs failed: ${response.status} ${err}`);
  }
  const data = (await response.json()) as { organizationUnits?: OrgUnit[] };
  return data.organizationUnits ?? [];
}

// ---------------------------------------------------------------------------
// Chrome Policy API — push the IronGate extension force-install + managed
// config to a specific OU
// ---------------------------------------------------------------------------

export interface DeployIronGatePolicyInput {
  accessToken: string;
  customerId: string;
  orgUnitPath: string; // e.g., "/Litigation Team"
  extensionId: string; // the IronGate extension's Chrome Web Store ID
  enrollmentCode: string;
  firmId: string;
  supportContact?: string;
  allowedAITools?: string[];
  deploymentMode?: 'local-only' | 'hybrid' | 'server-only';
  enableOllama?: boolean;
}

/**
 * Deploy the IronGate extension to the target OU via Chrome Policy API.
 * Sets two policies in one batch:
 *   1. ExtensionInstallForcelist — force-install the extension
 *   2. ExtensionSettings (managed policy) — push the firm's config
 *
 * Returns the number of policies successfully updated.
 */
export async function deployIronGateToOrgUnit(
  input: DeployIronGatePolicyInput,
): Promise<{ policiesApplied: number }> {
  const {
    accessToken,
    customerId,
    orgUnitPath,
    extensionId,
    enrollmentCode,
    firmId,
    supportContact,
    allowedAITools,
    deploymentMode = 'local-only',
    enableOllama = false,
  } = input;

  // Build the managed extension settings blob the extension reads via
  // chrome.storage.managed.
  const managedConfig: Record<string, unknown> = {
    deploymentMode,
    enrollmentCode,
    firmId,
  };
  if (supportContact) managedConfig.supportContact = supportContact;
  if (allowedAITools && allowedAITools.length > 0) managedConfig.allowedAITools = allowedAITools;
  if (enableOllama) {
    managedConfig.localEndpoint = 'http://localhost:11434/api/generate';
    managedConfig.localModel = 'llama3.2:3b';
    managedConfig.localFormat = 'ollama';
  }

  // Chrome Policy API takes a batch of policy modifications. Two entries:
  // force-install the extension, and set its managed config.
  const requestBody = {
    requests: [
      {
        policyTargetKey: {
          targetResource: orgUnitPath.startsWith('orgunits/')
            ? orgUnitPath
            : `orgunits/${orgUnitPath.replace(/^\//, '')}`,
          additionalTargetKeys: {
            'app_id': `chrome:${extensionId}`,
          },
        },
        policyValue: {
          policySchema: 'chrome.users.apps.InstallType',
          value: { appInstallType: 'FORCED' },
        },
        updateMask: 'appInstallType',
      },
      {
        policyTargetKey: {
          targetResource: orgUnitPath.startsWith('orgunits/')
            ? orgUnitPath
            : `orgunits/${orgUnitPath.replace(/^\//, '')}`,
          additionalTargetKeys: {
            'app_id': `chrome:${extensionId}`,
          },
        },
        policyValue: {
          policySchema: 'chrome.users.apps.ManagedConfiguration',
          value: { managedConfiguration: JSON.stringify(managedConfig) },
        },
        updateMask: 'managedConfiguration',
      },
    ],
  };

  const response = await fetch(
    `${GOOGLE_CHROME_POLICY_API}/customers/${customerId}/policies/orgunits:batchModify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    logger.error('Chrome Policy API deploy failed', {
      status: response.status,
      error: err.substring(0, 500),
      orgUnitPath,
    });
    throw new Error(`[google-workspace] Chrome Policy deploy failed: ${response.status} ${err.substring(0, 200)}`);
  }

  return { policiesApplied: 2 };
}
