# Google Workspace One-Click Deploy — Setup Guide

**Audience:** YOU (Siddharth / IronGate operator), doing this ONCE. After
setup, customers click "Connect Google Workspace" and the whole deploy flow
takes 30 seconds per customer.

**Time required:** ~30-45 minutes end-to-end.

**Goal:** Enable the Google Workspace OAuth integration so customers can
deploy IronGate to their managed Chromes with one click — no JSON copy-paste,
no Admin Console navigation.

---

## Overview

The integration flow (once live):

```
Customer clicks "Connect Google Workspace" in IronGate dashboard
  ↓
Redirected to accounts.google.com for consent
  ↓
Admin approves → returns to IronGate with access + refresh tokens
  ↓
IronGate stores tokens encrypted, fetches OU list
  ↓
Admin picks OU, clicks "Deploy"
  ↓
IronGate's API calls Google Chrome Policy API to push extension policy
  ↓
Extensions install on managed Chromes within 10 minutes
```

For this to work, IronGate needs to be registered as a Google OAuth
application with the right scopes. That's what this guide sets up.

---

## Prerequisites

- A Google account (personal or Workspace — either works for creating the GCP project)
- ~30 minutes of focused time
- Access to Render (to set env vars on the API)

---

## Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click the project dropdown (top-left) → **New Project**
3. Name: `IronGate Production` (or similar)
4. Organization: leave default
5. Click **Create**
6. Wait ~30 seconds for the project to provision, then select it from the dropdown

---

## Step 2 — Enable the required APIs

1. In the Cloud Console, go to **APIs & Services → Library**
2. Search for and enable each of the following:
   - **Admin SDK API** (gives Directory API access — listing OUs, customer info)
   - **Chrome Policy API** (pushes Chrome management policies to customer Workspaces)
3. Confirm both are enabled by going to **APIs & Services → Enabled APIs & services**

---

## Step 3 — Configure the OAuth consent screen

This is what users see when they click "Connect Google Workspace."

1. **APIs & Services → OAuth consent screen**
2. **User Type:** choose **External** (required for customers outside your Google Workspace to use the integration). Click Create.
3. Fill in the app information:
   - **App name:** `IronGate`
   - **User support email:** `support@irongate.ai` (or your email)
   - **App logo:** upload IronGate logo (optional, but improves trust)
   - **Application home page:** `https://irongate.ai` (or dashboard URL)
   - **Application privacy policy:** `https://irongate-dashboard.vercel.app/privacy`
   - **Application terms of service:** `https://irongate-dashboard.vercel.app/terms`
   - **Authorized domains:** add `irongate.ai` and `vercel.app` (covers dashboard URL)
   - **Developer contact:** your email
4. Click **Save and Continue**
5. **Scopes** screen: click **Add or Remove Scopes** and paste these scopes one at a time:
   ```
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/admin.directory.orgunit.readonly
   https://www.googleapis.com/auth/admin.directory.customer.readonly
   https://www.googleapis.com/auth/chrome.management.policy
   ```
   These are sensitive/restricted scopes (flagged in the Google UI). Click **Update** to save.
6. **Test users** screen: add your own email + any pilot customer admin emails. **In "testing" mode, only listed users can authorize the app** (max 100 users). Good enough for initial pilots.
7. Click **Save and Continue** through the summary.

### About "testing" vs "production" mode

- **Testing mode** (default after the steps above): app is immediately usable by up to 100 listed test users. No Google review required. **Start here.**
- **Production mode** (for public availability): Google requires a security review because of the sensitive scopes. Can take 4-12 weeks. Apply for this once you have paying customers and the app is stable. Until then, add each pilot customer's admin as a test user.

---

## Step 4 — Create OAuth 2.0 credentials

1. **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. **Application type:** **Web application**
4. **Name:** `IronGate Web OAuth Client`
5. **Authorized redirect URIs** — add these (exact match required):
   - `http://localhost:3000/v1/auth/mdm/google/callback` (for local dev)
   - `https://irongate-api.onrender.com/v1/auth/mdm/google/callback` (production)
   - If you're using a custom API domain (e.g., `api.irongate.ai`), add that too
6. Click **Create**
7. A modal shows your **Client ID** and **Client Secret**. Copy both — you'll paste them into Render env vars next.

---

## Step 5 — Set API environment variables on Render

1. Render Dashboard → `irongate-api` service → **Environment**
2. Add these three env vars:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<the client ID from step 4>
   GOOGLE_OAUTH_CLIENT_SECRET=<the client secret from step 4>
   API_URL=https://irongate-api.onrender.com
   ```
   (`API_URL` is used to build the redirect URI dynamically. Make sure it matches what you registered in step 4.)
3. Also confirm these are already set (required for token encryption):
   ```
   IRON_GATE_ENCRYPTION_SECRET=<a random 32+ character string>
   IRON_GATE_SIGNING_SECRET=<a random 32+ character string — can be same or different>
   ```
4. Click **Save Changes**. Render redeploys automatically (takes ~2 min).

---

## Step 6 — Apply the database migration

The `mdm_connections` table needs to exist in production Supabase.

1. Supabase Dashboard → SQL Editor → New query
2. Paste the contents of `apps/api/src/db/migrations/production_mdm_connections.sql`
3. Click **Run**
4. Verify: **Database → Tables → mdm_connections** should now appear

---

## Step 7 — Test the flow end-to-end

1. Sign in to `https://irongate-dashboard.vercel.app` as an admin
2. Navigate to `/admin/deployment/google-workspace`
3. Click **Connect Google Workspace**
4. Google consent screen appears — approve the 4 scopes
5. You're redirected back to IronGate with a green "Connected" banner
6. Click an OU in the list
7. Paste the IronGate extension ID (from Chrome Web Store; during beta, use your unpacked extension ID)
8. Click **Deploy IronGate to [OU name]**
9. Within 10 minutes, Chromes in that OU auto-install the extension and self-enroll

### If something breaks

- **"Not a valid redirect URI"** — the URL in Step 4 must match the `API_URL` env var from Step 5 exactly, including protocol and no trailing slash.
- **"Access blocked: This app's request is invalid"** — check the OAuth consent screen status; you must have completed Step 3 with your email added as a test user.
- **"Invalid grant" on token exchange** — usually means the authorization code was already used or expired. Start the flow again.
- **`Chrome Policy deploy failed: 403`** — the authorized admin doesn't have Chrome management privileges. Have them ensure their Google Workspace role includes Chrome Management admin permissions.

---

## What the integration pushes to the customer's Chrome

Two policies per OU, deployed in one batch API call:

**1. Extension Install Forcelist** — force-installs the IronGate extension on every Chrome in the OU.

**2. Extension Managed Configuration** — pushes the firm's IronGate settings:
```json
{
  "deploymentMode": "local-only",
  "enrollmentCode": "<firm's enrollment code>",
  "firmId": "<firm's UUID>",
  "allowedAITools": ["chatgpt", "claude", "gemini", "copilot"]
}
```

The IronGate extension reads this managed config on startup and auto-enrolls silently. No user action needed.

---

## Security notes

- **Tokens are encrypted at rest** using AES-256-GCM with per-firm-derived keys (`apps/api/src/lib/token-encryption.ts`). A database breach doesn't yield plaintext Google tokens.
- **State parameter is signed** with HMAC-SHA256 to prevent OAuth CSRF attacks.
- **Refresh tokens are rotated** on each refresh (Google's default behavior).
- **Scopes are minimal** — only the 4 scopes needed for listing OUs + pushing Chrome policies. No email access, no file access, no calendar, nothing else.
- **Customer can revoke at any time** via `myaccount.google.com` → Security → Third-party access, OR via the "Disconnect" button in IronGate dashboard.

---

## What about Microsoft Intune / Jamf Pro?

Same architectural pattern, different API:
- **Intune** uses Microsoft Graph API — similar OAuth flow, uses Microsoft identity platform
- **Jamf Pro** uses its own API — uses client_credentials grant instead of user OAuth

These are the next integrations to build once Google Workspace is stable. The
`mdm_connections` table and encryption infrastructure already support them —
just add:
- `apps/api/src/services/microsoft-intune.ts`
- `apps/api/src/services/jamf-pro.ts`
- Additional routes in `mdm-oauth.ts` for each provider
- Dashboard pages at `/admin/deployment/intune` and `/admin/deployment/jamf`

Estimated effort: 2-3 days per additional provider.

---

## Going to production (when you have paying customers)

1. **Submit OAuth consent screen for verification** — `APIs & Services → OAuth consent screen → Prepare for verification`. Fill in the required fields (privacy policy URL, scope justification, demo video showing how you use the data).
2. **Google security team reviews** your app — takes 4-12 weeks, they may come back with questions.
3. **Once approved**, the app moves to "In Production" mode and any Google Workspace admin can use it without being added as a test user.
4. Until then, you can run in "testing" mode indefinitely with up to 100 test users — fine for early pilots.

---

## Support contacts

- **Google Cloud issues:** https://cloud.google.com/support
- **Chrome Policy API questions:** https://developers.google.com/chrome/policy
- **OAuth flow debugging:** https://developers.google.com/identity/protocols/oauth2/web-server
- **IronGate dev:** Slack #engineering
