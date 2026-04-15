// ============================================================================
// Microsoft Intune (Endpoint Manager) API client
// ============================================================================
//
// Provides the subset of Microsoft Graph APIs IronGate needs to one-click-deploy
// to a customer's Intune tenant: OAuth token exchange/refresh, Organization +
// Groups lookup, and Intune configuration policy creation/assignment.
//
// Mirrors services/google-workspace.ts structurally. We use raw fetch() instead
// of pulling @azure/msal-node or @microsoft/microsoft-graph-client — fewer
// deps, tighter control, only a handful of endpoints actually needed.
// ============================================================================

import { logger } from '../lib/logger';

const MICROSOFT_OAUTH_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_OAUTH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * OAuth scopes IronGate requests from Microsoft Graph. Each one is justified:
 *
 *   offline_access — required for Microsoft to issue a refresh token so
 *     IronGate can renew access tokens without forcing the admin to
 *     re-consent every hour
 *   User.Read — read the authorizing admin's profile (email, displayName)
 *     for audit log
 *   Organization.Read.All — read tenant metadata (tenantId, displayName,
 *     verifiedDomains) for audit + multi-tenant routing
 *   Group.Read.All — list Azure AD security groups (Intune's deployment
 *     target units, equivalent to Google OUs)
 *   DeviceManagementConfiguration.ReadWrite.All — create and assign Intune
 *     Settings Catalog configuration policies (the Chrome extension force-
 *     install + managed config blob)
 */
export const INTUNE_OAUTH_SCOPES = [
  'offline_access',
  'User.Read',
  'Organization.Read.All',
  'Group.Read.All',
  'DeviceManagementConfiguration.ReadWrite.All',
].join(' ');

export const MICROSOFT_OAUTH_AUTHORIZE_ENDPOINT = MICROSOFT_OAUTH_AUTHORIZE_URL;

export interface IntuneTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: Date;
  scope: string;
}

export interface AzureAdGroup {
  id: string;
  displayName: string;
  description?: string;
  mailNickname?: string;
  securityEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// OAuth: exchange authorization code for tokens
// ---------------------------------------------------------------------------

export async function exchangeIntuneAuthCode(
  code: string,
  redirectUri: string,
): Promise<IntuneTokens> {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      '[microsoft-intune] MICROSOFT_OAUTH_CLIENT_ID / _SECRET not configured',
    );
  }

  const response = await fetch(MICROSOFT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: INTUNE_OAUTH_SCOPES,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[microsoft-intune] token exchange failed: ${response.status} ${err}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope ?? INTUNE_OAUTH_SCOPES,
  };
}

// ---------------------------------------------------------------------------
// OAuth: refresh access token using stored refresh token
// ---------------------------------------------------------------------------

export async function refreshIntuneAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      '[microsoft-intune] MICROSOFT_OAUTH_CLIENT_ID / _SECRET not configured',
    );
  }

  const response = await fetch(MICROSOFT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      scope: INTUNE_OAUTH_SCOPES,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[microsoft-intune] token refresh failed: ${response.status} ${err}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Userinfo — used to capture which admin authorized the connection
// ---------------------------------------------------------------------------

export async function getIntuneUserInfo(accessToken: string): Promise<{
  email: string;
  displayName: string;
  id: string;
}> {
  const response = await fetch(`${MICROSOFT_GRAPH_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[microsoft-intune] userinfo failed: ${response.status} ${err}`,
    );
  }
  const data = (await response.json()) as {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
  };
  return {
    id: data.id,
    displayName: data.displayName ?? data.userPrincipalName ?? '',
    email: data.mail ?? data.userPrincipalName ?? '',
  };
}

// ---------------------------------------------------------------------------
// Tenant lookup — needed for audit + to surface the tenant in the UI
// ---------------------------------------------------------------------------

export async function getIntuneTenantInfo(accessToken: string): Promise<{
  tenantId: string;
  displayName: string;
  primaryDomain?: string;
}> {
  const response = await fetch(`${MICROSOFT_GRAPH_API}/organization`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[microsoft-intune] tenant lookup failed: ${response.status} ${err}`,
    );
  }
  const data = (await response.json()) as {
    value?: Array<{
      id: string;
      displayName?: string;
      verifiedDomains?: Array<{ name: string; isDefault?: boolean; isInitial?: boolean }>;
    }>;
  };
  const org = data.value?.[0];
  if (!org) {
    throw new Error('[microsoft-intune] tenant lookup returned no organizations');
  }
  const primary =
    org.verifiedDomains?.find((d) => d.isDefault)?.name ??
    org.verifiedDomains?.find((d) => d.isInitial)?.name ??
    org.verifiedDomains?.[0]?.name;
  return {
    tenantId: org.id,
    displayName: org.displayName ?? '',
    primaryDomain: primary,
  };
}

// ---------------------------------------------------------------------------
// Graph API — list Azure AD security groups (Intune deployment targets)
// ---------------------------------------------------------------------------

export async function listIntuneGroups(accessToken: string): Promise<AzureAdGroup[]> {
  // We filter to securityEnabled groups only because Intune policy assignments
  // target security groups (not mail-only distribution lists). $top=999 is the
  // Graph API max for groups.
  const url = new URL(`${MICROSOFT_GRAPH_API}/groups`);
  url.searchParams.set('$filter', 'securityEnabled eq true');
  url.searchParams.set('$select', 'id,displayName,description,mailNickname,securityEnabled');
  url.searchParams.set('$top', '999');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[microsoft-intune] list groups failed: ${response.status} ${err}`,
    );
  }
  const data = (await response.json()) as { value?: AzureAdGroup[] };
  return data.value ?? [];
}

// ---------------------------------------------------------------------------
// Intune — create + assign a Settings Catalog configuration policy that
// force-installs the IronGate Chrome extension and pushes managed config
// ---------------------------------------------------------------------------

export interface DeployIntuneInput {
  accessToken: string;
  groupId: string;
  groupName?: string;
  extensionId: string;
  enrollmentCode: string;
  firmId: string;
  supportContact?: string;
  allowedAITools?: string[];
  deploymentMode?: 'local-only' | 'hybrid' | 'server-only';
  enableOllama?: boolean;
}

/**
 * Deploy the IronGate extension to a target Azure AD security group via Intune.
 *
 * Approach:
 *   1. POST /deviceManagement/configurationPolicies — create a Settings Catalog
 *      policy with the Chrome ExtensionInstallForcelist setting + Extension
 *      Managed Configuration (via the com.google.chrome.device ADMX-backed
 *      settings catalog entries)
 *   2. POST /deviceManagement/configurationPolicies/{id}/assign — bind the
 *      policy to the target Azure AD security group
 *
 * NOTE: The Settings Catalog schema for Chrome extension policies is complex
 * and evolves with Microsoft's catalog revisions. The settingDefinitionId
 * strings below follow the documented `com.google.chrome.device` ADMX-backed
 * pattern at the time of writing (2026). If Microsoft renames or restructures
 * these catalog IDs, this function may need tuning. We deliberately keep the
 * shape minimal so the mapping is easy to audit.
 */
export async function deployIronGateToIntuneGroup(
  input: DeployIntuneInput,
): Promise<{ policyId: string; assignmentId: string }> {
  const {
    accessToken,
    groupId,
    groupName,
    extensionId,
    enrollmentCode,
    firmId,
    supportContact,
    allowedAITools,
    deploymentMode = 'local-only',
    enableOllama = false,
  } = input;

  // Build the managed extension settings blob the extension reads via
  // chrome.storage.managed. Identical shape to the Google Workspace deploy,
  // so the extension doesn't need to care where the config came from.
  const managedConfig: Record<string, unknown> = {
    deploymentMode,
    enrollmentCode,
    firmId,
  };
  if (supportContact) managedConfig.supportContact = supportContact;
  if (allowedAITools && allowedAITools.length > 0) managedConfig.allowedAITools = allowedAITools;
  if (enableOllama) {
    managedConfig.localEndpoint = 'http://localhost:11434/api/generate';
    managedConfig.localModel = 'gemma4:e2b';
    managedConfig.localFormat = 'ollama';
  }

  // Force-install directive format (documented Chrome policy syntax):
  //   <extension-id>;<update-url>
  // Using the Chrome Web Store update URL ensures auto-updates.
  const forceInstallValue = `${extensionId};https://clients2.google.com/service/update2/crx`;

  const policyName = groupName
    ? `IronGate — ${groupName}`
    : `IronGate — ${groupId.slice(0, 8)}`;

  // ── Step 1: create the Settings Catalog configuration policy ──────────────
  const policyBody = {
    name: policyName,
    description:
      'IronGate Chrome extension force-install + managed configuration. Managed by IronGate dashboard; do not edit manually.',
    platforms: 'windows10',
    technologies: 'mdm',
    roleScopeTagIds: ['0'],
    settings: [
      // ExtensionInstallForcelist — force-install the IronGate extension
      {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
        settingInstance: {
          '@odata.type':
            '#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance',
          settingDefinitionId:
            'device_vendor_msft_policy_config_chrome~policy~googlechrome~extensions_extensioninstallforcelist',
          simpleSettingCollectionValue: [
            {
              '@odata.type':
                '#microsoft.graph.deviceManagementConfigurationStringSettingValue',
              value: forceInstallValue,
            },
          ],
        },
      },
      // ExtensionSettings (managed configuration) — push IronGate's firm config
      // The Chrome policy expects a JSON map keyed by extension ID where each
      // entry describes install behavior + managed config. We serialize it as
      // a single JSON string per Chrome's documented ExtensionSettings schema.
      {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
        settingInstance: {
          '@odata.type':
            '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance',
          settingDefinitionId:
            'device_vendor_msft_policy_config_chrome~policy~googlechrome~extensions_extensionsettings',
          simpleSettingValue: {
            '@odata.type':
              '#microsoft.graph.deviceManagementConfigurationStringSettingValue',
            value: JSON.stringify({
              [extensionId]: {
                installation_mode: 'force_installed',
                update_url: 'https://clients2.google.com/service/update2/crx',
                managed_configuration: managedConfig,
              },
            }),
          },
        },
      },
    ],
  };

  const createResponse = await fetch(
    `${MICROSOFT_GRAPH_API}/deviceManagement/configurationPolicies`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(policyBody),
    },
  );

  if (!createResponse.ok) {
    const err = await createResponse.text();
    logger.error('Intune configuration policy create failed', {
      status: createResponse.status,
      error: err.substring(0, 500),
      groupId,
    });
    throw new Error(
      `[microsoft-intune] create policy failed: ${createResponse.status} ${err.substring(0, 200)}`,
    );
  }

  const created = (await createResponse.json()) as { id: string };
  const policyId = created.id;

  // ── Step 2: assign the policy to the target Azure AD security group ───────
  const assignBody = {
    assignments: [
      {
        id: crypto.randomUUID(),
        target: {
          '@odata.type': '#microsoft.graph.groupAssignmentTarget',
          groupId,
        },
      },
    ],
  };

  const assignResponse = await fetch(
    `${MICROSOFT_GRAPH_API}/deviceManagement/configurationPolicies/${policyId}/assign`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(assignBody),
    },
  );

  if (!assignResponse.ok) {
    const err = await assignResponse.text();
    logger.error('Intune configuration policy assign failed', {
      status: assignResponse.status,
      error: err.substring(0, 500),
      groupId,
      policyId,
    });
    // The policy was created but not assigned; surface the error so the
    // caller can decide whether to clean up or retry. We keep the orphan
    // policy in Intune so the admin can see what was attempted.
    throw new Error(
      `[microsoft-intune] assign policy failed: ${assignResponse.status} ${err.substring(0, 200)}`,
    );
  }

  // The assignment endpoint returns 204 No Content on success (or sometimes a
  // body with the assignment array). Either way, policy creation + assign
  // succeeded. The assignment ID is synthesized client-side above.
  const assignmentId = assignBody.assignments[0].id;

  return { policyId, assignmentId };
}
