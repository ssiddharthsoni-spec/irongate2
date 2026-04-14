// ============================================================================
// Jamf Pro API client
// ============================================================================
//
// Unlike Google Workspace / Microsoft Intune, Jamf Pro does NOT use a
// user-facing OAuth redirect. Each customer runs their own Jamf Pro server
// (e.g., https://sterling.jamfcloud.com) and the customer's Jamf admin
// provisions an API Role + API Client inside Jamf that grants IronGate
// scoped access. The admin then pastes three values into IronGate:
//
//   1. Jamf Pro URL  (e.g., https://sterling.jamfcloud.com)
//   2. API Client ID
//   3. API Client Secret
//
// IronGate exchanges those via the OAuth 2.0 `client_credentials` grant
// against `{jamfUrl}/api/oauth/token` to get a SHORT-LIVED bearer token
// (~30 min, no refresh token). Tokens are fetched on-demand for every
// operation — cheap, 1 HTTP request — and NOT persisted. Only the
// credentials themselves are stored encrypted at rest.
//
// See docs/deployment/JAMF_ONECLICK.md for the customer admin runbook.
// ============================================================================

import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JamfCredentials {
  jamfUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface JamfComputerGroup {
  id: number;
  name: string;
  isSmart: boolean;
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/**
 * Strip trailing slashes and validate the scheme so callers can paste
 * "https://sterling.jamfcloud.com/" or "https://sterling.jamfcloud.com"
 * interchangeably.
 */
function normalizeJamfUrl(jamfUrl: string): string {
  const trimmed = jamfUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error('[jamf-pro] Jamf URL must start with https://');
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// OAuth: client_credentials grant for short-lived bearer token
// ---------------------------------------------------------------------------

/**
 * Exchange API client credentials for a short-lived access token.
 * Jamf tokens expire in ~30 minutes and cannot be refreshed — the caller
 * must simply re-authenticate with the same credentials.
 */
export async function getJamfAccessToken(
  creds: JamfCredentials,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const baseUrl = normalizeJamfUrl(creds.jamfUrl);

  const response = await fetch(`${baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[jamf-pro] token exchange failed: ${response.status} ${err.substring(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Verification — cheap sanity check that the creds + URL + role all work
// ---------------------------------------------------------------------------

/**
 * Verify the Jamf connection by fetching a short-lived token and pinging a
 * trivial endpoint (`/api/v1/jamf-pro-version`). Used during the initial
 * "Connect" flow so we can fail fast with a clear error before storing
 * anything.
 */
export async function verifyJamfConnection(
  creds: JamfCredentials,
): Promise<{ ok: boolean; jamfVersion?: string; error?: string }> {
  try {
    const baseUrl = normalizeJamfUrl(creds.jamfUrl);
    const { accessToken } = await getJamfAccessToken(creds);

    const response = await fetch(`${baseUrl}/api/v1/jamf-pro-version`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: `Jamf responded ${response.status}: ${body.substring(0, 200)}`,
      };
    }

    const data = (await response.json()) as { version?: string };
    return { ok: true, jamfVersion: data.version };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Computer groups — the deployment targets
// ---------------------------------------------------------------------------

/**
 * List all computer groups (both static and smart) visible to the API
 * client. The customer picks one of these as the deployment scope.
 */
export async function listJamfComputerGroups(
  creds: JamfCredentials,
): Promise<JamfComputerGroup[]> {
  const baseUrl = normalizeJamfUrl(creds.jamfUrl);
  const { accessToken } = await getJamfAccessToken(creds);

  const response = await fetch(`${baseUrl}/api/v1/computer-groups`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `[jamf-pro] list computer groups failed: ${response.status} ${err.substring(0, 200)}`,
    );
  }

  // Jamf's v1 endpoint returns either a bare array or an object with
  // `results` depending on which Jamf version is running. Handle both.
  const raw = (await response.json()) as
    | Array<{ id: number | string; name: string; isSmart?: boolean; is_smart?: boolean }>
    | {
        results?: Array<{
          id: number | string;
          name: string;
          isSmart?: boolean;
          is_smart?: boolean;
        }>;
      };

  const rows = Array.isArray(raw) ? raw : raw.results ?? [];
  return rows.map((r) => ({
    id: typeof r.id === 'string' ? parseInt(r.id, 10) : r.id,
    name: r.name,
    isSmart: r.isSmart ?? r.is_smart ?? false,
  }));
}

// ---------------------------------------------------------------------------
// Deploy — push IronGate as a macOS configuration profile
// ---------------------------------------------------------------------------

export interface DeployIronGateJamfInput {
  creds: JamfCredentials;
  groupId: number;
  extensionId: string;
  enrollmentCode: string;
  firmId: string;
  supportContact?: string;
  allowedAITools?: string[];
  deploymentMode?: 'local-only' | 'hybrid' | 'server-only';
  enableOllama?: boolean;
}

/**
 * Build the inner Chrome managed-config blob. This is the same payload the
 * Chrome extension reads via `chrome.storage.managed`.
 */
function buildManagedConfig(input: DeployIronGateJamfInput): Record<string, unknown> {
  const {
    enrollmentCode,
    firmId,
    supportContact,
    allowedAITools,
    deploymentMode = 'local-only',
    enableOllama = false,
  } = input;

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
  return managedConfig;
}

/**
 * XML-escape a string for embedding inside a Jamf XML payload. We keep this
 * dependency-free intentionally — the surface area is small.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the embedded Apple `.mobileconfig` (plist-like XML) payload that
 * configures Chrome: force-install IronGate + push the managed policy.
 *
 * TODO(production): The exact <key> / <string> field names for Chrome's
 * macOS managed preferences domain (`com.google.Chrome`) should be
 * validated against a real Jamf instance with a real managed Chrome. The
 * structure is correct (ExtensionInstallForcelist + 3rdparty managed
 * extension config keyed by extensionId), but Chrome's Apple plist keys
 * occasionally drift. Reference: Chrome Enterprise Policy List.
 */
function buildChromeMobileConfig(
  input: DeployIronGateJamfInput,
  profileUuid: string,
  payloadUuid: string,
): string {
  const { extensionId } = input;
  const managedConfig = buildManagedConfig(input);
  const managedConfigJson = JSON.stringify(managedConfig);

  // The force-install value Chrome expects:
  //   "<extensionId>;https://clients2.google.com/service/update2/crx"
  const forceInstallEntry = `${extensionId};https://clients2.google.com/service/update2/crx`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.google.Chrome</string>
      <key>PayloadIdentifier</key>
      <string>com.irongate.chrome.policy.${xmlEscape(payloadUuid)}</string>
      <key>PayloadUUID</key>
      <string>${xmlEscape(payloadUuid)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadDisplayName</key>
      <string>IronGate Chrome Policy</string>
      <key>ExtensionInstallForcelist</key>
      <array>
        <string>${xmlEscape(forceInstallEntry)}</string>
      </array>
      <key>ExtensionSettings</key>
      <dict>
        <key>${xmlEscape(extensionId)}</key>
        <dict>
          <key>installation_mode</key>
          <string>force_installed</string>
          <key>update_url</key>
          <string>https://clients2.google.com/service/update2/crx</string>
        </dict>
      </dict>
      <!--
        3rdparty managed extension configuration. Chrome reads this and
        surfaces it to the extension via chrome.storage.managed.
      -->
      <key>3rdparty</key>
      <dict>
        <key>extensions</key>
        <dict>
          <key>${xmlEscape(extensionId)}</key>
          <dict>
            <key>managedConfiguration</key>
            <string>${xmlEscape(managedConfigJson)}</string>
          </dict>
        </dict>
      </dict>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>IronGate - Chrome Extension Deployment</string>
  <key>PayloadIdentifier</key>
  <string>com.irongate.profile.${xmlEscape(profileUuid)}</string>
  <key>PayloadUUID</key>
  <string>${xmlEscape(profileUuid)}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadScope</key>
  <string>System</string>
</dict>
</plist>`;
}

/**
 * Deploy IronGate as a Jamf OS X Configuration Profile scoped to the given
 * computer group.
 *
 * Note: configuration profiles live on Jamf's CLASSIC API (JSSResource),
 * not the v1 JSON API — Jamf hasn't migrated profiles yet. The classic
 * API takes XML and returns XML. We POST to osxconfigurationprofiles/id/0
 * where id=0 is Jamf's convention for "create new".
 */
export async function deployIronGateToJamfGroup(
  input: DeployIronGateJamfInput,
): Promise<{ profileId: number; profileName: string }> {
  const baseUrl = normalizeJamfUrl(input.creds.jamfUrl);
  const { accessToken } = await getJamfAccessToken(input.creds);

  const profileName = `IronGate - Chrome Extension Deployment`;
  // UUIDs are required by the mobileconfig spec. crypto.randomUUID is
  // available in Node 19+ (we're on 20+ in CI).
  const profileUuid = crypto.randomUUID();
  const payloadUuid = crypto.randomUUID();

  const mobileconfig = buildChromeMobileConfig(input, profileUuid, payloadUuid);

  // Jamf's classic API expects the entire mobileconfig XML to be embedded
  // inside the <payloads> element as a CDATA-wrapped string. See:
  // https://developer.jamf.com/jamf-pro/reference/createosxconfigurationprofilebyid
  const profileXml = `<?xml version="1.0" encoding="UTF-8"?>
<os_x_configuration_profile>
  <general>
    <name>${xmlEscape(profileName)}</name>
    <description>Force-installs the IronGate Chrome extension and pushes managed policy (firmId: ${xmlEscape(input.firmId)}).</description>
    <distribution_method>Install Automatically</distribution_method>
    <redeploy_on_update>Newly Assigned</redeploy_on_update>
    <category>
      <name>Security</name>
    </category>
    <payloads><![CDATA[${mobileconfig}]]></payloads>
  </general>
  <scope>
    <computer_groups>
      <computer_group>
        <id>${input.groupId}</id>
      </computer_group>
    </computer_groups>
  </scope>
</os_x_configuration_profile>`;

  const response = await fetch(`${baseUrl}/JSSResource/osxconfigurationprofiles/id/0`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/xml',
      Accept: 'application/xml',
    },
    body: profileXml,
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('Jamf configuration profile create failed', {
      status: response.status,
      error: err.substring(0, 500),
      groupId: input.groupId,
    });
    throw new Error(
      `[jamf-pro] profile create failed: ${response.status} ${err.substring(0, 200)}`,
    );
  }

  // Jamf returns XML like: <?xml ...?><osxconfigurationprofile><id>42</id></osxconfigurationprofile>
  const xml = await response.text();
  const match = xml.match(/<id>(\d+)<\/id>/);
  const profileId = match ? parseInt(match[1], 10) : -1;

  logger.info('Jamf configuration profile created', {
    profileId,
    profileName,
    groupId: input.groupId,
  });

  return { profileId, profileName };
}
