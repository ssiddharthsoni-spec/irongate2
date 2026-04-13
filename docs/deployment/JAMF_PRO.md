# IronGate — Jamf Pro Deployment Guide

**Audience:** Jamf Pro administrators deploying IronGate to managed macOS devices running Chrome, Edge, Brave, or any Chromium-based browser.
**Time required:** ~20 minutes from start to first user protected.
**Prerequisites:** Jamf Pro admin account with Configuration Profile privileges, IronGate firm account with admin access, managed Macs with Chrome installed.

---

## Overview

IronGate deploys to Jamf-managed Macs via a macOS Configuration Profile that specifies Chrome's `ExtensionInstallForcelist` and the IronGate-specific managed extension settings in a single profile. Jamf pushes the profile; Chrome picks it up on next restart and auto-installs + auto-configures the extension.

Outcome after deployment:
- Extension force-installed on every managed Chrome/Edge/Brave
- Extension pre-configured with your firm's enrollment code
- Auto-enrollment happens silently on first Chrome restart
- Users see a shield icon; clicking it shows "Protected by [your firm]"

---

## Step 1 — Get your deployment credentials from IronGate

1. Sign in to `https://irongate-dashboard.vercel.app`
2. **Admin → Enrollment Codes → Create Code**
   - Label: `Jamf deployment`
3. Copy the code (`XXXX-XXXX` format)
4. From **Admin → Deployment**, copy the **Firm ID** (UUID) and **Extension ID**

---

## Step 2 — Create the Configuration Profile

1. Sign in to **Jamf Pro**
2. **Computers → Configuration Profiles → New**
3. **General:**
   - Name: `IronGate - Chrome Extension Deployment`
   - Category: `Security` (or your preferred category)
   - Distribution Method: `Install Automatically`
   - Level: `Computer Level`

### Add the Application & Custom Settings payload

4. In the left panel, scroll to **Application & Custom Settings → External Applications**
5. Click **Configure** (or **Add** if already present)
6. **Source:** Custom Schema
7. **Preference Domain:** `com.google.Chrome`

   (For Edge use `com.microsoft.Edge`, for Brave use `com.brave.Browser`, or add separate External Applications payloads for each.)

8. **Property List:** Paste the following XML (replace bracketed values with yours from Step 1):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Force-install IronGate from the Chrome Web Store -->
    <key>ExtensionInstallForcelist</key>
    <array>
        <string>EXTENSION_ID_HERE;https://clients2.google.com/service/update2/crx</string>
    </array>

    <!-- IronGate managed extension settings -->
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

Replace:
- `EXTENSION_ID_HERE` (2 places) — your IronGate extension ID
- `STER-4K9X` — your enrollment code
- `your-firm-uuid` — your firm ID
- `it@yourfirm.com` — your internal IT contact

### Field reference

| Key | Required | Description |
|---|---|---|
| `deploymentMode` | Yes | `local-only` (recommended — detection stays on-device), `hybrid`, or `server-only` |
| `enrollmentCode` | Yes | From IronGate dashboard |
| `firmId` | Recommended | For audit-log correlation |
| `supportContact` | Recommended | Shown to users |
| `allowedAITools` | Optional | Whitelist AI tools. Omit for all 10 supported. |
| `killSwitch` | Optional | Set `<true/>` for org-wide emergency block |

### Scope

9. **Scope tab:**
   - Start with a pilot smart group (e.g., `All Managed Macs - IronGate Pilot`) containing 5-10 test users
   - For full rollout, change to `All Managed Computers` or your target smart group

10. **Save**

---

## Step 3 — Verify on a test machine

1. On a Jamf-enrolled test Mac, force the profile to install:
   - **System Settings → Privacy & Security → Profiles → Refresh** (or `sudo profiles renew -type configuration`)
2. Restart Chrome
3. Go to `chrome://policy` and click **Reload policies**. You should see IronGate's managed fields populated.
4. Go to `chrome://extensions` — the IronGate extension is installed with an "Installed by your administrator" note, no remove button
5. Click the shield icon in the toolbar. Sidepanel shows:
   > 🛡️ Protected by IronGate
   > Managed by [your firm name]
   > IT Support: [your support contact]

---

## Step 4 — Test protection end-to-end

1. Visit `https://chatgpt.com` (employee signs in normally)
2. Type: `"Draft a memo about my client Sarah Johnson (SSN 423-55-8901) regarding the Acme Corp dispute."`
3. Send
4. **Expected:** ChatGPT's response uses a pseudonym (e.g., `"Emily Rogers"`) — confirming IronGate intercepted and sanitized before send. The employee sees `"Sarah Johnson"` restored in the rendered response via in-browser de-pseudonymization.
5. Open the IronGate sidepanel — detected entities (PERSON, SSN, ORGANIZATION) are listed

At this point the pilot is validated.

---

## Step 5 — Monitor from the IronGate dashboard

- **Admin → Deployment Health:** device count, activity, version distribution
- **Dashboard:** aggregate detections (counts by entity type, AI tool, severity)
- **Admin → Audit Log:** compliance-grade event records

---

## Step 6 — Full-firm rollout

After pilot validation:

1. **Configuration Profiles → IronGate - Chrome Extension Deployment → Scope**
2. Change the scope from the pilot smart group to `All Managed Computers` (or your target population)
3. Save

Jamf pushes the profile update to all targeted Macs on next check-in (typically within 15 minutes).

---

## Kill switch for incidents

Edit the Configuration Profile and change:

```xml
<key>killSwitch</key>
<false/>
```

To:

```xml
<key>killSwitch</key>
<true/>
```

Save. Jamf re-pushes, Chrome picks it up on next policy refresh, and all AI tool traffic is blocked org-wide. Restore access by setting it back to `<false/>`. Kill switch changes are recorded in the IronGate audit log.

---

## Supporting Edge and Brave in addition to Chrome

If your users also use Edge or Brave, add additional **External Applications** payloads in the same Configuration Profile with these preference domains:

- Edge: `com.microsoft.Edge`
- Brave: `com.brave.Browser`

Each payload uses the same plist XML structure — just the preference domain differs.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Profile not installing | `sudo profiles renew -type configuration` on the Mac; check Jamf check-in status |
| Profile installed but extension missing | Verify `chrome://policy` shows IronGate fields; check `chrome://extensions` for errors; ensure extension ID in both `ExtensionInstallForcelist` AND `3rdparty.extensions` match exactly |
| Extension installed but shows self-serve onboarding | Managed config isn't reaching the extension — usually a typo in the preference domain or extension ID |
| Enrollment code rejected | Code expired / revoked / over limit — regenerate in IronGate dashboard and update the profile |
| Users report extension disappearing | Chrome profile corruption; have user remove and re-add Chrome profile, Jamf will re-enforce |

---

## Uninstallation

1. **Jamf Pro → Configuration Profiles → IronGate - Chrome Extension Deployment**
2. Remove from scope (or delete the profile)
3. Jamf pushes the removal; Chrome uninstalls the extension on next policy refresh
4. Local data stored by the extension is wiped automatically
5. (Optional) Delete user records from the IronGate dashboard via **Admin → Users**

---

## Support

- **Deployment issues:** support@irongate.ai
- **Security:** security@irongate.ai
- **Status page:** https://status.irongate.ai
