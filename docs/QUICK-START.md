# Deploy Iron Gate to Your Company in 10 Minutes

This guide walks a tech lead through deploying Iron Gate to protect their organization's AI tool usage.

## Prerequisites

- A Chrome-based browser (Chrome, Edge, Brave, Arc)
- An email address for the admin account

## Step 1: Create Your Organization

1. Go to [irongate-dashboard.vercel.app/sign-up](https://irongate-dashboard.vercel.app/sign-up)
2. Create an account with your work email
3. Complete the onboarding wizard:
   - **Firm name** and industry
   - **Protection mode**: Choose "Monitor" (observe only) or "Protect" (auto-redact PII)
   - **Sensitivity thresholds**: Set when to warn, block, or proxy
   - **Team invites** (optional): Add colleagues by email
4. **Copy the API key** shown on the final screen — this is the key your team will use to connect

> The API key starts with `ig_` and is only shown once. Store it securely (e.g., password manager or internal wiki).

## Step 2: Install the Chrome Extension

### Option A: Manual Install (per person)

1. Download the extension ZIP from the dashboard's **Install** page
2. Unzip to a folder
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **"Load unpacked"** and select the unzipped folder
5. The Iron Gate shield icon appears in the toolbar

### Option B: Chrome Enterprise Policy (organization-wide)

For managed Chrome deployments, use the `ExtensionInstallForcelist` policy:

```json
{
  "ExtensionInstallForcelist": [
    "<extension-id>;https://github.com/ssiddharthsoni-spec/irongate2/releases/latest/download/iron-gate-extension-v0.2.1.zip"
  ]
}
```

Replace `<extension-id>` with the ID shown in `chrome://extensions` after the first manual install.

## Step 3: Connect the Extension

1. Right-click the Iron Gate toolbar icon → **"Open side panel"**
2. The setup wizard appears automatically
3. Click **"Get Started"**
4. Paste the API key from Step 1 → click **"Connect"**
5. Choose your protection mode (Monitor or Protect) → click **"Start Monitoring"**

Share the API key with your team via your preferred secure channel (Slack DM, email, password manager).

## Step 4: Verify Protection

Test that everything works:

1. Open [chatgpt.com](https://chatgpt.com) (or any supported AI tool)
2. Type a test prompt containing fake PII:
   ```
   Please summarize this: John Smith (SSN: 123-45-6789) called from 555-0100 about account #AC-9182.
   ```
3. Open the Iron Gate side panel — you should see:
   - **Monitor mode**: Entities detected with sensitivity score
   - **Protect mode**: Entities auto-pseudonymized before reaching the AI

## Step 5: Monitor Your Team

Use the [Iron Gate Dashboard](https://irongate-dashboard.vercel.app) to:

- **Events**: See every AI interaction across your organization
- **Reports**: Weekly compliance summaries
- **Audit Log**: Full audit trail of all detections and actions
- **Settings**: Adjust thresholds, manage API keys, configure alerts

## Supported AI Tools

| Tool | Status |
|------|--------|
| ChatGPT | Fully supported |
| Claude | Fully supported |
| Gemini | Fully supported |
| Microsoft Copilot | Fully supported |
| DeepSeek | Fully supported |
| Perplexity | Fully supported |
| Poe | Fully supported |
| You.com | Fully supported |
| HuggingFace Chat | Fully supported |
| Groq | Fully supported |

## Troubleshooting

### Extension side panel is blank
Right-click the Iron Gate icon → "Open side panel". If nothing appears, reload the extension in `chrome://extensions`.

### "No API key configured" warning
Open the side panel → the setup wizard will guide you through connecting. Paste your organization's API key.

### Protection not working on a site
1. Check that the site is in the supported list above
2. Hard refresh the page (Ctrl+Shift+R / Cmd+Shift+R)
3. Check the side panel — the shield icon should show "Monitoring [Tool Name]"

### Need to change the API key
Open the side panel → click the gear icon (Settings) → update the API key field.
