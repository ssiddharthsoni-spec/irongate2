# IronGate Enterprise — IT Deployment Templates

This directory contains copy-paste deployment templates for the three device management systems most enterprise customers use. Each template configures IronGate Enterprise to run in **local-only mode** with the validated default model (Llama 3.2 3B).

## What gets deployed

When you push these templates via your device management system, every employee laptop will receive:

1. **The IronGate Chrome extension**, force-installed via Chrome Enterprise managed policy
2. **A managed policy** that locks the deployment to `local-only` mode pointing at the local Ollama service
3. **An audit log destination** that writes to your firm's S3 bucket / SIEM / webhook (you choose)
4. **A signed policy bundle URL** pointing at your firm's policy server (optional)
5. **A per-firm pseudonymization key** so all audit logs are correlatable across users

## Prerequisites

Before deploying these templates, your fleet must have:

- **Chrome 138+** (for the `LanguageModel` API fallback path) OR Chrome 110+ (Ollama path only)
- **Ollama installed** with the `llama3.2:3b` model pulled — see `installer/` for the Ollama deployment package
- **Managed Chrome policy** enabled on the fleet (Chrome Enterprise license, or unmanaged Chromium)
- **22 GB free disk** per machine (model + Chrome cache + Ollama)
- **16 GB RAM** per machine (recommended; 8 GB works but is slow)

## The three templates

| File | Tool | Format |
|---|---|---|
| `intune-policy.xml` | Microsoft Intune (Windows fleets) | OMA-URI Configuration Profile |
| `jamf-policy.plist` | Jamf Pro (Mac fleets) | macOS Configuration Profile (Property List) |
| `workspace-policy.json` | Google Workspace Admin (cross-platform) | Chrome Enterprise managed policy JSON |

Pick the one matching your tool. Replace the placeholder values (marked with `<<REPLACE_ME>>`) with your firm's actual values.

## Validation after deployment

After deploying to a pilot machine, run the health check tool to verify:

```bash
node scripts/irongate-healthcheck.mjs --json
```

It outputs JSON your monitoring tool can ingest. Exit code 0 = healthy, 1 = degraded, 2 = unhealthy.

## Security review notes

For your security team:

- **Zero outbound network calls during detection.** The extension only reaches `localhost:11434` (Ollama) for classification. No requests leave the device.
- **The model weights are open-source.** Llama 3.2 3B is published by Meta under the Llama Community License. SHA-256 hashes are documented in `installer/MANIFEST.txt` so you can verify byte-for-byte what you're deploying.
- **Audit logs are customer-controlled.** Default is `none` (no logs leave the device). When configured for S3/syslog/webhook, the data goes to YOUR endpoint, not IronGate's.
- **The policy bundle is signed.** If you provide a `policyBundleUrl`, the extension will only accept bundles signed with the public key bound to your firmId at install time.

## Support

For deployment help: contact your IronGate enterprise account manager.
For end-user issues: see the deployment runbook at `enterprise/runbook/`.
