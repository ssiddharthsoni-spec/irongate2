# IronGate — Microsoft Intune Deployment Guide

**Audience:** Microsoft Intune / Endpoint Manager administrators deploying IronGate to managed Windows 10/11 and macOS devices running Chrome or Edge.
**Time required:** ~25 minutes from start to first user protected.
**Prerequisites:** Intune admin account with device configuration privileges, IronGate firm account with admin access, devices already enrolled in Intune with Chrome / Edge installed.

---

## Overview

IronGate deploys to Intune-managed devices via a Chrome / Edge extension force-install policy plus an extension-specific managed settings policy. Both Chrome and Edge read the same managed-extension configuration format, so one policy covers both browsers.

Outcome after deployment:
- Extension installed on every managed Chrome/Edge across your device fleet
- Extension pre-configured with your firm's enrollment code
- Auto-enrollment happens silently on first Chrome restart — no user action
- Users see a shield icon appear; clicking it shows "Protected by [your firm]"

---

## Step 1 — Get your deployment credentials from IronGate

1. Sign in to the IronGate admin dashboard at `https://irongate-dashboard.vercel.app`
2. Navigate to **Admin → Enrollment Codes → Create Code**
   - Label: `Intune deployment`
   - Max uses + expiration per your preference
3. Copy the generated code (format: `XXXX-XXXX`)
4. From **Admin → Deployment**, copy your **Firm ID** (UUID) and the **Chrome Web Store Extension ID**

---

## Step 2 — Create the Chrome extension force-install policy (Windows)

### For Windows devices

1. Sign in to the **[Microsoft Intune admin center](https://intune.microsoft.com)**
2. Go to **Devices → Configuration → Policies**
3. Click **+ Create → New Policy**
4. Platform: **Windows 10 and later**
5. Profile type: **Settings catalog**
6. Click **Create**
7. Name: `Chrome - Force install IronGate`
8. Click **Next** → **Add settings**
9. In the Settings picker, search for `ExtensionInstallForcelist`
10. Under **Google Chrome → Extensions**, select `Extension Installation Forcelist` (and optionally `Microsoft Edge → Extensions → Control which extensions are installed silently` for Edge coverage)
11. Close the picker and configure the setting:
    - **Enabled**
    - Add a value:
    ```
    <EXTENSION_ID>;https://clients2.google.com/service/update2/crx
    ```
    where `<EXTENSION_ID>` is your IronGate extension ID from Step 1
12. Click **Next**
13. **Assignments:** Select the device group or user group to deploy to (start with a pilot group of 5-10)
14. Click **Next** → **Next** → **Create**

### For macOS devices

1. Go to **Devices → Configuration → Policies**
2. Click **+ Create → New Policy**
3. Platform: **macOS**
4. Profile type: **Templates → Preference file**
5. Click **Create**
6. Name: `Chrome - Force install IronGate (Mac)`
7. **Preference domain:** `com.google.Chrome`
8. **Property list file:** Upload a `.plist` file with this content:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ExtensionInstallForcelist</key>
    <array>
        <string>EXTENSION_ID_HERE;https://clients2.google.com/service/update2/crx</string>
    </array>
</dict>
</plist>
```

Replace `EXTENSION_ID_HERE` with your actual extension ID.

9. **Assignments:** Target the Mac device group
10. **Create**

---

## Step 3 — Create the IronGate managed settings policy

This is the policy that pushes your firm's enrollment code and configuration to the extension.

### For Windows

1. **Devices → Configuration → Policies → + Create → New Policy**
2. Platform: **Windows 10 and later**
3. Profile type: **Settings catalog**
4. Name: `IronGate - Managed settings`
5. **Add settings** → search for `3rdparty`
6. Navigate to **Google Chrome → 3rdparty → extensions**, enable it, and set the value to this JSON (one entry per managed extension):

```json
{
  "EXTENSION_ID_HERE": {
    "deploymentMode": "local-only",
    "enrollmentCode": "STER-4K9X",
    "firmId": "your-firm-uuid",
    "supportContact": "it@yourfirm.com",
    "allowedAITools": ["chatgpt", "claude", "gemini", "copilot"],
    "killSwitch": false
  }
}
```

Replace:
- `EXTENSION_ID_HERE` — your IronGate extension ID
- `STER-4K9X` — your enrollment code from Step 1
- `your-firm-uuid` — your firm ID from Step 1
- `it@yourfirm.com` — your internal IT contact

7. **Assignments:** Same group as Step 2 (Windows device/user group)
8. **Create**

### For macOS

For Mac, the managed settings live alongside the force-install in the preference plist:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ExtensionInstallForcelist</key>
    <array>
        <string>EXTENSION_ID_HERE;https://clients2.google.com/service/update2/crx</string>
    </array>
    <key>3rdparty</key>
    <dict>
        <key>extensions</key>
        <dict>
            <key>EXTENSION_ID_HERE</key>
            <dict>
                <key>deploymentMode</key>
                <string>local-only</string>
                <key>enrollmentCode</key>
                <string>STER-4K9X</string>
                <key>firmId</key>
                <string>your-firm-uuid</string>
                <key>supportContact</key>
                <string>it@yourfirm.com</string>
                <key>allowedAITools</key>
                <array>
                    <string>chatgpt</string>
                    <string>claude</string>
                    <string>gemini</string>
                    <string>copilot</string>
                </array>
                <key>killSwitch</key>
                <false/>
            </dict>
        </dict>
    </dict>
</dict>
</plist>
```

Update the profile from Step 2 with the combined plist.

### Field reference

| Field | Required | Description |
|---|---|---|
| `deploymentMode` | Yes | `local-only` (recommended), `hybrid`, or `server-only` |
| `enrollmentCode` | Yes | From IronGate dashboard |
| `firmId` | Recommended | For audit-log correlation |
| `supportContact` | Recommended | Shown to users in error messages |
| `allowedAITools` | Optional | Restrict to specific tools. Omit for all 10 supported tools. |
| `killSwitch` | Optional | Org-wide emergency block |

---

## Step 4 — Deploy and verify

1. On an Intune-enrolled test device, force a policy refresh:
   - **Windows:** Settings → Accounts → Access work or school → [Work account] → Info → Sync
   - **macOS:** System Settings → Privacy & Security → Profiles → find the Intune config profile
2. Restart Chrome / Edge
3. Verify:
   - `chrome://extensions` (or `edge://extensions`) shows IronGate as "Installed by your administrator"
   - The shield icon appears in the toolbar
   - Clicking the icon opens a sidepanel showing "Protected by [your firm]"
4. Test: open `chatgpt.com`, type a sensitive prompt, verify pseudonymization by checking the AI response references a fake name

---

## Step 5 — Monitor

From the IronGate admin dashboard:
- **Admin → Deployment Health:** see total installed devices, active in 24h, Chrome/Edge version distribution
- **Dashboard:** aggregate activity across the firm — counts by entity type, AI tool, severity
- **Admin → Audit Log:** compliance-grade record of every detection event

---

## Full-firm rollout

After pilot validation:

1. Modify Step 2's assignment to target the full organization (or a larger device group)
2. Modify Step 3's assignment to match
3. Policies propagate automatically; new enrollments get IronGate on first Chrome launch

---

## Kill switch for incidents

During a compliance hold or active incident:

1. **Devices → Configuration → Policies →** edit the IronGate managed settings
2. Change `"killSwitch": false` to `"killSwitch": true`
3. Save and push

Takes effect within minutes. Users see a notice explaining the block and your support contact. To restore access, set `killSwitch` back to `false`. The kill switch activation is audit-logged.

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| Extension not appearing after policy push | Policy not synced | Force sync from device, or wait 1-2 hours |
| Extension installed but shows self-serve onboarding | Managed policy JSON not reaching the extension | Verify the `3rdparty.extensions.[ID]` JSON structure; check `chrome://policy` on the device |
| Extension shows "enrollment code invalid" | Code expired / revoked / exceeded max uses | Generate a new code in IronGate dashboard, update policy |
| Users report "extension disabled" | Chrome extension process crashed | Rare; check `chrome://extensions` for errors, escalate to support@irongate.ai |
| High latency on AI requests | Render API cold-start | Upgrade to Render paid tier to keep API warm, or hit health endpoint periodically |

---

## Uninstallation

To remove IronGate:

1. Delete the force-install policy from Step 2
2. Delete the managed settings policy from Step 3
3. Push an update — Chrome uninstalls the extension automatically on next sync
4. (Optional) Remove user records from the IronGate dashboard via **Admin → Users** if you want the data cleared from IronGate too

---

## Support

- **Deployment issues:** support@irongate.ai
- **Security:** security@irongate.ai
- **Status:** https://status.irongate.ai
