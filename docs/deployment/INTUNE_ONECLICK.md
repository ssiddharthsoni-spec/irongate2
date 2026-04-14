# Microsoft Intune One-Click Deploy — Setup Guide

**Audience:** YOU (Siddharth / IronGate operator), doing this ONCE. After
setup, customers click "Connect Microsoft Intune" and the whole deploy flow
takes 30-60 seconds per customer.

**Time required:** ~30-45 minutes end-to-end.

**Goal:** Enable the Microsoft Intune (Endpoint Manager) OAuth integration so
customers can deploy IronGate to their managed Chromes with one click — no
Settings Catalog clicking, no copy-paste of extension IDs, no manual policy
assignment.

---

## Overview

The integration flow (once live):

```
Customer clicks "Connect Microsoft Intune" in IronGate dashboard
  ↓
Redirected to login.microsoftonline.com for admin consent
  ↓
Intune / Global Admin approves scopes → returns to IronGate with
  access + refresh tokens
  ↓
IronGate stores tokens encrypted, fetches Azure AD security-group list
  ↓
Admin picks a group, clicks "Deploy"
  ↓
IronGate's API calls Microsoft Graph:
    POST /deviceManagement/configurationPolicies     (creates Settings
                                                     Catalog policy with
                                                     Chrome force-install
                                                     + managed config)
    POST /deviceManagement/configurationPolicies/
         {id}/assign                                 (binds policy to
                                                     the selected Azure
                                                     AD security group)
  ↓
Extensions install on managed Chromes within 15-60 minutes
  (Intune sync cadence + Chrome policy refresh)
```

For this to work, IronGate needs to be registered as a multi-tenant Azure AD
app with the right Graph permissions. That's what this guide sets up.

---

## Prerequisites

- An Azure account with access to an Azure AD tenant you control (a Microsoft
  365 developer tenant works — https://developer.microsoft.com/microsoft-365/dev-program)
- ~30 minutes of focused time
- Access to Render (to set env vars on the API)

---

## Step 1 — Create an Azure AD App Registration

1. Go to https://portal.azure.com
2. Navigate to **Azure Active Directory** (aka **Microsoft Entra ID**) →
   **App registrations**
3. Click **+ New registration**
4. Fill in:
   - **Name:** `IronGate`
   - **Supported account types:** **Accounts in any organizational directory
     (Any Microsoft Entra ID tenant — Multitenant)**

     This is critical — IronGate is a SaaS serving many customer tenants.
     Do NOT choose single-tenant.
   - **Redirect URI:**
     - Platform: **Web**
     - URL: `https://irongate-api.onrender.com/v1/auth/mdm/intune/callback`
5. Click **Register**
6. On the **Overview** page, copy and save:
   - **Application (client) ID** → this becomes `MICROSOFT_OAUTH_CLIENT_ID`
   - **Directory (tenant) ID** → note for your own reference (IronGate uses
     the `/common` endpoint, not tenant-specific)

---

## Step 2 — Add a client secret

1. From the app's **Overview** page, click **Certificates & secrets** in the
   left nav
2. Under **Client secrets**, click **+ New client secret**
3. Description: `IronGate production`
4. Expires: **24 months** (or per your rotation policy — max 24 months for
   secrets; consider certificates for longer rotation cadence)
5. Click **Add**
6. **COPY THE SECRET VALUE NOW** — it displays once and then Microsoft hides
   it forever. If you lose it, you'll need to generate a new one.
7. This value becomes `MICROSOFT_OAUTH_CLIENT_SECRET`

---

## Step 3 — Configure API permissions (Microsoft Graph)

1. In the app registration, click **API permissions** in the left nav
2. Click **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Search for and tick each of these permissions:
   - `offline_access` — required for refresh tokens
   - `User.Read` — read the authorizing admin's profile (audit)
   - `Organization.Read.All` — read tenant metadata (tenantId, display name,
     verified domains)
   - `Group.Read.All` — list Azure AD security groups (deployment targets)
   - `DeviceManagementConfiguration.ReadWrite.All` — create and assign Intune
     Settings Catalog policies
4. Click **Add permissions**
5. (Optional, for your own test tenant only) Click **Grant admin consent for
   [Your Tenant]**. This pre-approves the scopes for your own directory.
   Customer tenants will still see their own consent prompt — that's expected
   and desired, since each customer admin must consent on behalf of their
   own tenant.

### Why customers see an extra "admin consent" prompt

Several of these scopes (especially `DeviceManagementConfiguration.ReadWrite.All`,
`Group.Read.All`, `Organization.Read.All`) are **admin-consent-required**
permissions. When a customer Global or Intune Admin visits the Microsoft
consent screen, Microsoft will surface a dialog that reads roughly:

> IronGate needs your organization's consent to allow it to read groups and
> manage device configuration on behalf of everyone in your directory.

This is normal. It is the Microsoft equivalent of Google's "sensitive scopes"
consent — but more prominent in the UI. There is no way to avoid it; it's
the correct security posture. Let customers know in onboarding that they
will see this prompt and that they need to be a Global Administrator or
Intune Administrator to approve it.

---

## Step 4 — Set API environment variables on Render

1. Render Dashboard → `irongate-api` service → **Environment**
2. Add these two env vars:
   ```
   MICROSOFT_OAUTH_CLIENT_ID=<the Application (client) ID from Step 1>
   MICROSOFT_OAUTH_CLIENT_SECRET=<the secret VALUE from Step 2>
   ```
3. Confirm these are already set (from the Google Workspace setup or earlier
   deployment):
   ```
   API_URL=https://irongate-api.onrender.com
   DASHBOARD_URL=https://irongate-dashboard.vercel.app
   IRON_GATE_ENCRYPTION_SECRET=<a random 32+ character string>
   IRON_GATE_SIGNING_SECRET=<a random 32+ character string>
   ```
   (`API_URL` is used to build the redirect URI. It must exactly match what
   you registered in Step 1.)
4. Click **Save Changes**. Render redeploys automatically (takes ~2 min).

---

## Step 5 — Verify the `mdm_connections` table supports Microsoft Intune

The table's `provider` enum already includes `microsoft_intune`. No schema
change needed. If you want to double-check:

1. Supabase Dashboard → SQL Editor
2. Run:
   ```sql
   SELECT enum_range(NULL::mdm_provider);
   ```
3. Confirm the output includes `microsoft_intune`. (If not, apply the
   latest migration in `apps/api/src/db/migrations/`.)

---

## Step 6 — Test the flow end-to-end

1. Sign in to `https://irongate-dashboard.vercel.app` as an admin
2. Navigate to `/admin/deployment/microsoft-intune`
3. Click **Connect Microsoft Intune**
4. Microsoft consent screen appears. As a Global or Intune Admin, approve the
   5 scopes. You'll see the additional "admin consent for the organization"
   prompt described above — that's expected.
5. You're redirected back to IronGate with a green "Connected" banner showing
   the tenant ID and the admin email that authorized the connection.
6. The Azure AD security group list loads. Pick a pilot group (e.g., one that
   contains only your own test device — Microsoft 365 dev tenants come with
   a couple of default groups you can use).
7. Paste the IronGate extension ID (from Chrome Web Store; during beta, use
   your unpacked extension ID). Leave defaults for allowed tools / Ollama.
8. Click **Deploy IronGate to [group name]**
9. Confirm success banner. In the Intune admin center (https://intune.microsoft.com)
   under **Devices → Configuration**, you should see a new Settings Catalog
   policy named `IronGate — [group name]` with the group assignment.
10. Within 15-60 minutes, managed Chromes in the group auto-install the
    extension and self-enroll. (Intune sync + Chrome policy refresh cycles
    are longer than Google's — this is an Intune characteristic, not an
    IronGate bug.)

### If something breaks

- **`AADSTS50011: The redirect URI … does not match the redirect URIs
  configured`** — the `Redirect URI` in Step 1 must match exactly what the
  server builds from `API_URL`. Verify both have the same protocol and no
  trailing slash, and both point to `/v1/auth/mdm/intune/callback`.
- **`AADSTS65001: The user or administrator has not consented to use the
  application`** — the authorizing account does not have permission to grant
  admin consent for the tenant. Ask the customer to use a Global or Intune
  Administrator account.
- **`AADSTS90002: Tenant 'common' not found`** — you're using a personal
  Microsoft account (outlook.com / hotmail.com) instead of a work/school
  account. IronGate's integration requires an Azure AD (work/school) admin
  account — personal MSAs have no Intune to manage.
- **`403 Forbidden` on `/deviceManagement/configurationPolicies`** — the
  authorizing admin lacks the Intune Administrator role. In Azure AD →
  Roles and administrators, assign **Intune Administrator** (or Global
  Administrator) to their account.
- **"Insufficient privileges to complete the operation"** on group listing —
  admin consent was not granted for `Group.Read.All`. Re-run the connect
  flow; make sure the customer clicks through the consent prompt completely.
- **Settings Catalog policy appears but extensions don't install** — Chrome
  policy refresh is slow on Windows (up to ~90 minutes in some deployments).
  You can force-refresh by running `gpupdate /force` on the device, or check
  `chrome://policy` in Chrome on the device to confirm the policy was
  received. If not received, check the Intune policy's deployment status
  under **Devices → Configuration → [policy] → Device assignment status**.

---

## `/common` vs tenant-specific endpoints

IronGate uses `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`.
The `/common` endpoint lets any Azure AD tenant consent — which is what we
want for a multi-tenant SaaS.

Alternatives (that we intentionally do NOT use):
- `/organizations` — similar to `/common`, but excludes personal MSAs.
  Functionally equivalent for our use case; we picked `/common` because
  Microsoft filters out MSAs anyway once any of our required scopes are
  attached (none of them are valid on a personal account).
- `/{tenant-id}` — single-tenant endpoint. Would force us to know the
  customer's tenant ID before the OAuth flow, which defeats the one-click
  experience. Don't use this.

---

## What the integration pushes to the customer's Chrome

One Settings Catalog configuration policy per deploy, with two Chrome policy
settings inside:

**1. `ExtensionInstallForcelist`** — force-installs the IronGate extension
on every managed Chrome in the target Azure AD security group. Value:
`<extension-id>;https://clients2.google.com/service/update2/crx` (the
Chrome Web Store update URL, which ensures auto-updates).

**2. `ExtensionSettings` (managed configuration)** — pushes the firm's
IronGate settings as a JSON map, keyed by extension ID:
```json
{
  "<extension-id>": {
    "installation_mode": "force_installed",
    "update_url": "https://clients2.google.com/service/update2/crx",
    "managed_configuration": {
      "deploymentMode": "local-only",
      "enrollmentCode": "<firm's enrollment code>",
      "firmId": "<firm's UUID>",
      "allowedAITools": ["chatgpt", "claude", "gemini", "copilot"]
    }
  }
}
```

The IronGate extension reads the managed config on startup via
`chrome.storage.managed` and auto-enrolls silently. No user action needed.

**Settings Catalog schema note:** Microsoft periodically revises the
`settingDefinitionId` strings in its Chrome ADMX catalog. The service file
(`apps/api/src/services/microsoft-intune.ts`) uses the documented IDs as of
2026. If Microsoft renames them, update that file — no other changes should
be required.

---

## Security notes

- **Tokens are encrypted at rest** using AES-256-GCM with per-firm-derived
  keys (`apps/api/src/lib/token-encryption.ts`). A database breach doesn't
  yield plaintext Microsoft tokens.
- **State parameter is signed** with HMAC-SHA256 to prevent OAuth CSRF.
- **Refresh tokens rotate** on each refresh per Microsoft identity platform
  defaults.
- **Scopes are minimal** — 5 scopes that strictly match the deployment task:
  list groups, read tenant metadata, read/write Intune config, read the
  authorizing admin's profile, and offline access for refresh. No mail, no
  files, no calendar, no Teams — nothing else.
- **Customers can revoke at any time** via Azure AD → Enterprise applications
  → IronGate → Properties → Delete, OR via the "Disconnect" button in the
  IronGate dashboard (which deletes IronGate's stored tokens but leaves
  already-deployed Intune policies in place).

---

## Going to the Microsoft Partner Network / AppSource (future)

Multi-tenant Azure AD apps don't require Microsoft review to work — any
tenant admin can consent to them today. However, if you want the IronGate
listing to appear in Microsoft AppSource or the Intune integrations
directory, you'll need to:

1. Enroll IronGate in the Microsoft Partner Network (free for ISVs)
2. Complete publisher verification in the Azure AD app registration
3. Submit a listing to AppSource with pricing, screenshots, and a demo

This is a marketing / distribution step — not required for the integration
to work. Defer until you have paying customers.

---

## Support contacts

- **Azure AD / app registration issues:** https://docs.microsoft.com/azure/active-directory/develop/
- **Microsoft Graph questions:** https://learn.microsoft.com/graph/
- **Intune Settings Catalog reference:** https://learn.microsoft.com/mem/intune/configuration/settings-catalog
- **OAuth 2.0 on Microsoft identity platform:** https://learn.microsoft.com/azure/active-directory/develop/v2-oauth2-auth-code-flow
- **IronGate dev:** Slack #engineering
