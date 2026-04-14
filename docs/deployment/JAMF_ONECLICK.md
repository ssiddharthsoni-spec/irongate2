# Jamf Pro One-Click Deploy — Setup Guide

This runbook covers the Jamf Pro integration in two parts:

- **Section A** — for the IronGate operator (you, Siddharth). TL;DR: there's
  no one-time setup. Jamf uses per-customer credentials, so unlike Google
  Workspace there is no OAuth app to register.
- **Section B** — for the customer's Jamf admin (e.g., Priya at Sterling).
  Covers provisioning the API Role + API Client so she can paste three
  values into IronGate and click Connect.

---

## Section A — For the IronGate Operator

### Nothing to set up once, ever

Unlike Google Workspace (where IronGate is registered as a single OAuth
application that every customer consents to) and Microsoft Intune (same
pattern via Azure AD app registration), Jamf Pro uses **per-customer API
clients**. Each customer:

1. Runs their own Jamf instance at their own URL.
2. Provisions an API Role + API Client inside their Jamf.
3. Pastes the URL, Client ID, and Client Secret into IronGate.

IronGate stores those credentials encrypted at rest (same AES-256-GCM
per-firm key derivation we use for Google/Intune tokens) and fetches a
short-lived bearer token on-demand for every operation.

### How the integration works

```
Customer admin pastes { jamfUrl, clientId, clientSecret } in IronGate
  ↓
IronGate calls POST {jamfUrl}/api/oauth/token?grant_type=client_credentials
  ↓
Jamf returns access_token (expires in ~30 min, no refresh token)
  ↓
IronGate hits GET {jamfUrl}/api/v1/jamf-pro-version to verify it works
  ↓
If OK: encrypt creds with encryptForFirm() → store in mdm_connections
  ↓
Admin picks a computer group → IronGate creates an OS X Configuration
Profile via POST {jamfUrl}/JSSResource/osxconfigurationprofiles/id/0
  ↓
Managed Macs receive the profile on their next Jamf check-in (~15 min).
```

### Why we don't persist access tokens

Jamf access tokens live ~30 minutes and Jamf **does not issue refresh
tokens**. The only way to get a new token is to repeat the
`client_credentials` exchange with the stored secret. That's a single
cheap HTTP request, so the API re-auths on every operation rather than
managing expiry state. Keeps the code simple and avoids stale-token bugs.

### Code touchpoints

| File | Purpose |
| --- | --- |
| `apps/api/src/services/jamf-pro.ts` | Token exchange + verification + list groups + deploy profile |
| `apps/api/src/routes/mdm-oauth.ts` | Admin routes under `/v1/admin/mdm-oauth/jamf/*` |
| `apps/dashboard/src/app/admin/deployment/jamf-pro/page.tsx` | UI |

### Known production caveat

The embedded `.mobileconfig` payload written by
`buildChromeMobileConfig()` uses Chrome's standard managed preferences
keys (`ExtensionInstallForcelist`, `ExtensionSettings`, `3rdparty`). The
structure is correct, but the exact Apple plist key names for
`com.google.Chrome` occasionally drift across Chrome / macOS versions.
When validating against a real Jamf + real managed Mac during the first
customer pilot, expect to tune 1–2 field names. The TODO comment in
`jamf-pro.ts` calls this out.

---

## Section B — For the Customer Admin (Priya at Sterling)

You are a Jamf Pro administrator. Follow these steps to give IronGate the
permissions it needs to deploy the Chrome extension to your managed Macs.
The permissions are scoped — IronGate can only read computer groups and
manage OS X configuration profiles. It cannot read user data, enroll new
devices, or make changes outside of configuration profiles.

**Time required:** ~10 minutes.

### Step 1 — Log into Jamf Pro

Go to your Jamf URL (e.g., `https://yourcompany.jamfcloud.com`). You'll
need a Jamf admin account — a Site Admin is not sufficient because API
Roles live at the instance level.

### Step 2 — Create an API Role named "IronGate"

1. Click the **gear icon** (Settings) in the top-right.
2. Go to **System Settings** → **API Roles and Clients**.
3. Select the **API Roles** tab.
4. Click **New**.
5. Set **Display Name** to `IronGate`.
6. Under **Privileges**, enable exactly these:
   - Read Computer Groups
   - Read Computers
   - Create OS X Configuration Profiles
   - Update OS X Configuration Profiles
   - Read OS X Configuration Profiles
7. Click **Save**.

> **Why each privilege?**
>
> - *Read Computer Groups* — so IronGate can list your groups in the UI
>   and let you pick a deployment target.
> - *Read Computers* — used only by the connection verification step to
>   confirm the role works (optional but harmless).
> - *Create / Update / Read OS X Configuration Profiles* — the actual
>   deploy action creates a profile, and re-deploys update the existing
>   one.

### Step 3 — Create an API Client bound to that role

1. Still in **API Roles and Clients**, switch to the **API Clients** tab.
2. Click **New**.
3. **Display Name:** `IronGate Integration`
4. **API Roles:** select `IronGate` (the role you just created).
5. **Access Token Lifetime:** leave at the default (30 minutes).
6. Toggle **Enable API Client** to ON.
7. Click **Save**.

### Step 4 — Generate and copy the Client Secret

1. On the API Client detail page, click **Generate Client Secret**.
2. **Copy the secret immediately.** Jamf shows it exactly once — if you
   lose it, you'll have to regenerate.
3. Also copy the **Client ID** (always visible on the detail page).

### Step 5 — Paste into IronGate

1. In your IronGate dashboard, go to **Admin** → **Deployment** →
   **Jamf Pro**.
2. Fill in:
   - **Jamf Pro URL:** e.g., `https://yourcompany.jamfcloud.com`
   - **API Client ID:** the value from Jamf
   - **API Client Secret:** the secret you copied in Step 4
3. Click **Connect Jamf Pro**.
4. IronGate will verify the credentials (exchanges them for a token and
   pings Jamf). If everything's wired up correctly, you'll see a green
   **Connected** banner with your Jamf host name.

### Step 6 — Deploy to a pilot group

1. Select a computer group (start with a small pilot — e.g., 5–10 Macs).
2. Enter the IronGate Chrome Web Store extension ID (IronGate support can
   provide this if you don't already have it).
3. Configure allowed AI tools and the Ollama toggle.
4. Click **Deploy IronGate**.

IronGate creates a new OS X Configuration Profile in your Jamf instance
scoped to that computer group. The profile is named
**"IronGate - Chrome Extension Deployment"** and lives under the
**Security** category. Macs in the group receive the policy on their next
Jamf check-in (typically within 15 minutes).

---

## Troubleshooting

### "Could not verify Jamf credentials"

The verification step either couldn't reach Jamf or got an error back.
Common causes:

- **Wrong URL.** Double-check that you copied the URL from your browser
  when signed into Jamf. Some customers have `*.jamfcloud.com`, others
  have self-hosted URLs. The URL must be reachable from the public
  internet (IronGate's API needs to hit it).
- **Client ID / Secret typo.** Regenerate the secret in Jamf and paste
  fresh — don't try to copy-paste a previously shown secret, because
  Jamf only displays each secret once.
- **Client is disabled in Jamf.** On the API Client detail page, the
  **Enable API Client** toggle must be ON.

### "403 when listing computer groups"

The API Role is missing the **Read Computer Groups** privilege. Edit the
`IronGate` role in Jamf, enable the privilege, and click Save. You don't
need to reconnect in IronGate — the fix is immediate.

### "Token expired" during deploy

This should never surface to the UI because IronGate re-authenticates with
`client_credentials` on every operation. If you do see it, it means the
API client itself was disabled or its secret was rotated. Re-enable (or
regenerate the secret and re-paste in IronGate).

### "Profile create failed: 400"

Usually means the role is missing **Create OS X Configuration Profiles**.
Less commonly, Jamf rejects the payload because the Chrome extension ID
in the profile isn't a valid 32-character lowercase alphanumeric string.
Confirm the extension ID field in IronGate matches exactly what the
Chrome Web Store listing shows.

### SSL / self-signed certificate issues

If your Jamf instance uses a self-signed or private-CA certificate
(uncommon for Jamf Cloud, occasional for self-hosted), IronGate's token
fetch will fail with a TLS error. Options:

1. Install a publicly trusted certificate on your Jamf server
   (recommended).
2. Contact IronGate support — we can configure the API's outbound HTTP
   client to trust your internal CA for your tenant.

### Rotating the Client Secret

Jamf lets you regenerate API Client secrets at any time without
disrupting existing deployments. To rotate:

1. In Jamf, go to **API Clients** → `IronGate Integration` →
   **Generate Client Secret**. Copy the new value.
2. In IronGate, click **Disconnect** on the Jamf Pro page, then reconnect
   with the new secret.
3. Existing configuration profiles in Jamf stay in place — only
   IronGate's ability to push *new* profiles is briefly interrupted.
