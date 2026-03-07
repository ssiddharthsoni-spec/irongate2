import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const mdmRoutes = new Hono<AppEnv>();

const EXTENSION_ID = process.env.CHROME_EXTENSION_ID || 'YOUR_EXTENSION_ID_HERE';
const CRX_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';

const formatSchema = z.object({
  format: z.enum(['intune', 'jamf', 'workspace_one']),
});

/**
 * GET /mdm/export?format=intune|jamf|workspace_one
 *
 * Generates a device management configuration profile that IT admins
 * can import into their MDM to force-install the Iron Gate Chrome extension.
 */
mdmRoutes.get('/export', async (c) => {
  const query = formatSchema.safeParse({ format: c.req.query('format') });
  if (!query.success) {
    return c.json(
      { error: 'Invalid or missing format parameter. Use one of: intune, jamf, workspace_one' },
      400,
    );
  }

  const firmId = c.get('firmId');

  const [firm] = await db
    .select({
      id: firms.id,
      name: firms.name,
      mode: firms.mode,
      config: firms.config,
    })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  const config = (firm.config ?? {}) as Record<string, any>;
  const apiUrl = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || 'https://api.irongate.dev';
  const complianceFrameworks = config.complianceFrameworks
    ? (Array.isArray(config.complianceFrameworks)
        ? config.complianceFrameworks.join(', ')
        : String(config.complianceFrameworks))
    : 'none';

  const { format } = query.data;

  if (format === 'intune') {
    const profile = {
      extensionInstallForceList: {
        Value: `${EXTENSION_ID};${CRX_UPDATE_URL}`,
      },
      policy: {
        apiUrl,
        firmId: firm.id,
        complianceFramework: complianceFrameworks,
        mode: firm.mode,
      },
    };
    return c.json({ format: 'intune', profile, generatedAt: new Date().toISOString() });
  }

  if (format === 'jamf') {
    const profile = {
      PayloadContent: [
        {
          PayloadType: 'com.google.Chrome.extensions.managed',
          ExtensionInstallForceList: [EXTENSION_ID],
          PayloadDisplayName: 'Iron Gate Extension Policy',
        },
      ],
      ExtensionSettings: {
        [EXTENSION_ID]: {
          apiUrl,
          firmId: firm.id,
          mode: firm.mode,
        },
      },
    };
    return c.json({ format: 'jamf', profile, generatedAt: new Date().toISOString() });
  }

  // workspace_one
  const profile = {
    ExtensionInstallForceList: [`${EXTENSION_ID};${CRX_UPDATE_URL}`],
    ExtensionSettings: {
      [EXTENSION_ID]: {
        installation_mode: 'force_installed',
        update_url: CRX_UPDATE_URL,
        apiUrl,
        firmId: firm.id,
        mode: firm.mode,
      },
    },
  };
  return c.json({ format: 'workspace_one', profile, generatedAt: new Date().toISOString() });
});

/**
 * GET /mdm/deployment-guide
 *
 * Returns markdown deployment instructions for each supported MDM platform.
 */
mdmRoutes.get('/deployment-guide', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db
    .select({ id: firms.id, name: firms.name })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  const guide = `# Iron Gate MDM Deployment Guide

## Overview

This guide explains how to force-install the Iron Gate Chrome extension across your organization using your MDM platform.

**Extension ID:** \`${EXTENSION_ID}\`
**Firm ID:** \`${firm.id}\`

---

## Microsoft Intune

1. Sign in to the [Microsoft Endpoint Manager admin center](https://endpoint.microsoft.com).
2. Navigate to **Devices > Configuration profiles > Create profile**.
3. Select **Platform: Windows 10 and later**, **Profile type: Templates**, then choose **Administrative Templates**.
4. Search for **Configure the list of force-installed apps and extensions** under Computer Configuration > Google Chrome > Extensions.
5. Enable the policy and add the following value:
   \`\`\`
   ${EXTENSION_ID};${CRX_UPDATE_URL}
   \`\`\`
6. To push the managed policy configuration, use the **Configure extension management settings** policy and paste the JSON from the \`GET /v1/admin/mdm/export?format=intune\` endpoint.
7. Assign the profile to the appropriate device groups.
8. Sync devices to apply the policy.

---

## Jamf Pro (macOS)

1. Log in to your Jamf Pro console.
2. Navigate to **Computers > Configuration Profiles > New**.
3. Under **Application & Custom Settings**, select **Upload** and choose **com.google.Chrome** as the preference domain.
4. Upload the JSON profile from the \`GET /v1/admin/mdm/export?format=jamf\` endpoint as a custom .plist or JSON payload.
5. Alternatively, use the **Google Chrome - Extensions** payload:
   - Set **ExtensionInstallForceList** to: \`${EXTENSION_ID}\`
6. Scope the profile to the desired computer groups or all managed Macs.
7. Distribute the profile.

---

## VMware Workspace ONE (AirWatch)

1. Log in to the Workspace ONE UEM Console.
2. Navigate to **Devices > Profiles & Resources > Profiles > Add > Add Profile**.
3. Select **Chrome OS** or **Windows** depending on your fleet.
4. Under **Chrome Browser Settings**, locate **Extensions**:
   - Add \`${EXTENSION_ID};${CRX_UPDATE_URL}\` to the force-install list.
5. For managed extension configuration, paste the JSON from the \`GET /v1/admin/mdm/export?format=workspace_one\` endpoint into the **ExtensionSettings** policy.
6. Assign the profile to the appropriate Smart Groups.
7. Publish the profile.

---

## Verification

After deployment, verify the extension is installed:

1. On a managed device, open Chrome and navigate to \`chrome://extensions\`.
2. Confirm **Iron Gate** appears with the status "Installed by your administrator".
3. Open the Iron Gate side panel and verify it connects to your firm's API.

## Troubleshooting

- **Extension not appearing:** Ensure the device has synced with the MDM. Force a policy refresh if needed.
- **Extension not connecting:** Verify the API URL is reachable from the corporate network. Check firewall rules for \`api.irongate.dev\`.
- **Policy not applied:** Confirm the Chrome browser is managed. On Chrome, visit \`chrome://policy\` to inspect active policies.
`;

  return c.json({
    format: 'markdown',
    guide,
    generatedAt: new Date().toISOString(),
  });
});
