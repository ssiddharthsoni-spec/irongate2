# IronGate — Google Workspace Deployment Guide

**Audience:** Google Workspace administrators deploying IronGate to managed Chrome / Chromium browsers.
**Time required:** ~15 minutes from start to first user protected.
**Prerequisites:** Google Workspace admin account with Chrome management privileges, IronGate firm account with admin access.

---

## Overview

IronGate deploys to Chrome via Google Admin Console's Chrome management, identical to how you'd deploy any other managed Chrome extension. End users require no action — the extension installs automatically the next time their Chrome starts, reads the firm configuration you push via managed policy, and auto-enrolls silently.

Outcome after deployment:
- Extension installed on every Chrome managed by your Workspace
- Extension pre-configured with your firm's enrollment code
- Zero end-user setup required
- Users see a shield icon appear in Chrome; clicking it shows "Protected by [your firm]"
- All prompts to ChatGPT / Claude / Gemini / Copilot are automatically sanitized

---

## Step 1 — Get your deployment credentials from IronGate

1. Sign in to the IronGate admin dashboard at `https://irongate-dashboard.vercel.app`
2. Navigate to **Admin → Enrollment Codes**
3. Click **Create Code**
   - Label: `Google Workspace deployment` (or any name you prefer)
   - Max uses: leave blank for unlimited, or cap at your headcount
   - Expires: leave blank for no expiration, or set a rotation date
4. Click **Create**. Copy the generated code (format: `XXXX-XXXX`, e.g., `STER-4K9X`)
5. From **Admin → Deployment**, copy your **Firm ID** (UUID format)

Keep these two values ready — you'll paste them into the Google Admin Console in Step 3.

---

## Step 2 — Add IronGate as a force-installed extension

1. Sign in to **[Google Admin Console](https://admin.google.com)** as an administrator
2. In the left navigation: **Devices → Chrome → Apps & extensions**
3. Select the **Users & browsers** tab
4. At the top, select the **Organizational Unit (OU)** you want to deploy to
   - **Tip:** Start with a pilot OU (e.g., `Pilot Users`) containing 5-10 test users before rolling out firm-wide
5. Click the yellow **+** button in the bottom-right, then choose **Add Chrome app or extension by ID**
6. In the dialog:
   - **Extension ID:** `<IRONGATE_EXTENSION_ID>` (available from your IronGate admin dashboard under **Admin → Deployment → Extension ID**)
   - **From:** Select `From the Chrome Web Store`
7. Click **Save**

The extension now appears in the list. Click on it to open its configuration panel.

---

## Step 3 — Configure the managed policy

In the extension's configuration panel:

1. Under **Installation policy**, select **Force install + pin to browser toolbar**
2. Under **Policy for extensions**, paste the following JSON (replace the bracketed values with yours from Step 1):

```json
{
  "deploymentMode": {
    "Value": "local-only"
  },
  "enrollmentCode": {
    "Value": "STER-4K9X"
  },
  "firmId": {
    "Value": "your-firm-uuid-here"
  },
  "supportContact": {
    "Value": "it@yourfirm.com"
  },
  "allowedAITools": {
    "Value": ["chatgpt", "claude", "gemini", "copilot"]
  },
  "killSwitch": {
    "Value": false
  }
}
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `deploymentMode` | Yes | `local-only` (recommended — detection stays on-device), `hybrid` (opt-in cloud escalation for ambiguous cases), or `server-only` (legacy). |
| `enrollmentCode` | Yes | The code from Step 1. Associates devices with your firm. |
| `firmId` | Recommended | Your IronGate firm UUID. Used for audit-log correlation. |
| `supportContact` | Recommended | Displayed to users in error messages. E.g., `Slack #it-help` or `it@yourfirm.com`. |
| `allowedAITools` | Optional | Whitelist of AI tools. Omit for all 10 supported tools. Valid values: `chatgpt`, `claude`, `gemini`, `copilot`, `perplexity`, `deepseek`, `poe`, `groq`, `huggingface`, `you`. |
| `killSwitch` | Optional | Set to `true` during incidents to block all AI requests org-wide. |

3. Click **Save**

---

## Step 4 — Verify the deployment

The policy propagates to managed Chrome instances typically within 1-10 minutes. To verify:

1. On a managed device in the target OU, open Chrome
2. Visit `chrome://policy` and click **Reload policies**
3. Look for `IronGate` in the list — you should see the fields you configured
4. Visit `chrome://extensions` — you should see the IronGate extension listed with an **Installed by your administrator** note
5. Click the IronGate shield icon in the toolbar. The sidepanel should display:
   > 🛡️ Protected by IronGate
   > Managed by [your firm name]
   > IT Support: [your support contact]
6. Open ChatGPT or Claude. Type a test prompt containing a fake name and a fake SSN (e.g., `Draft a summary for Sarah Johnson, SSN 123-45-6789`). The extension will silently pseudonymize before sending to the AI provider.

### Expected behavior

- The extension installs automatically on Chrome restart (or within ~10 minutes for open Chromes)
- No sign-up, no API key entry, no prompts to the user
- Badge in toolbar shows green when no sensitive data detected, orange/red when sensitive data is present
- Sidepanel shows "Protected by [firm]" — no configuration UI (it's locked by managed policy)

### If you don't see the extension after 10 minutes

1. Check the user is in the correct OU: **Admin Console → Directory → Users → [user] → Organizational unit**
2. Confirm the extension has `Force install` set (not just `Allow install`)
3. Have the user run `chrome://policy` → `Reload policies` manually
4. Check `chrome://extensions` for any installation errors
5. Escalate to `support@irongate.ai` with the user's email and the extension status screen

---

## Step 5 — Verify protection is active (optional but recommended)

On a test Chrome:

1. Open `https://chatgpt.com` (sign in to your ChatGPT account)
2. Type: `"Draft a memo for my client Robert Johnson (SSN 423-55-8901) regarding his damages claim of $4.2M."`
3. Send the message
4. **Expected:** ChatGPT's response will refer to a different name (e.g., "Emily Rogers") — that's IronGate working. ChatGPT's servers received the pseudonymized version; the employee sees the original name restored in the response via in-browser de-pseudonymization.
5. Open the IronGate sidepanel (click the shield icon). You'll see the detected entity types listed (PERSON, SSN, MONETARY).

At this point, protection is live.

---

## Step 6 — Monitor deployment from the IronGate dashboard

1. Sign in to `irongate-dashboard.vercel.app`
2. Navigate to **Admin → Deployment Health**
3. You'll see:
   - Total devices enrolled
   - Active in last 24 hours
   - Chrome version distribution
   - Stale extensions (not heard from in 7+ days)

Go to **Dashboard** for aggregate activity across all your users (counts of detections by entity type, AI tool usage, etc.).

---

## Advanced: restricting which AI tools are allowed

If you want to block certain AI tools entirely (e.g., only allow Copilot in a healthcare org), modify `allowedAITools`:

```json
{
  "allowedAITools": {
    "Value": ["copilot"]
  }
}
```

Users visiting blocked tools will see a message: `"[Tool] is not approved by [your firm]. Contact [supportContact]."`

---

## Advanced: emergency kill switch

During a compliance hold, active incident, or legal matter freeze, flip the kill switch to block all AI tool traffic org-wide. Change the managed policy:

```json
{
  "killSwitch": {
    "Value": true
  }
}
```

Takes effect within minutes as Chrome refreshes policy. Users see a configurable notice explaining the block and your support contact.

To restore access: set `killSwitch` back to `false`. Decisions are audited in **Admin → Audit Log**.

---

## Rolling out to the full organization

Once the pilot OU is verified:

1. Go back to **Devices → Chrome → Apps & extensions → Users & browsers**
2. Select the parent OU or your entire organization
3. Either:
   - (a) Move the IronGate extension up a level (it inherits down), or
   - (b) Repeat Steps 2-3 for each additional OU

Users across the organization will have IronGate installed within minutes.

---

## Uninstallation

To remove IronGate from an OU:

1. **Admin Console → Devices → Chrome → Apps & extensions**
2. Select the OU
3. Find IronGate in the list, click the three-dot menu, choose **Remove from organization**

The extension uninstalls from all devices in that OU at the next policy refresh. All user data stored locally by the extension is wiped. Historical audit-log events remain in the IronGate dashboard for retention compliance (configurable per-firm, default 90 days).

---

## Support

- **Documentation:** https://irongate.ai/docs
- **Deployment issues:** support@irongate.ai
- **Security concerns:** security@irongate.ai
- **Status page:** https://status.irongate.ai

For urgent deployment issues (pilot going live), contact your IronGate account executive directly.
