# IronGate Enterprise Deployment Runbook

**Document version:** 1.0
**Audience:** IT engineers deploying IronGate Enterprise to a fleet
**Read time:** 90 minutes (deployment time: 4-8 hours per fleet)

This runbook walks an IT engineer through the full IronGate Enterprise deployment from zero to a fleet of 100+ machines running Sovereign Mode in production.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Pre-flight checklist](#2-pre-flight-checklist)
3. [Phase 1: Pilot installation (1 machine)](#3-phase-1-pilot-installation-1-machine)
4. [Phase 2: Configuration](#4-phase-2-configuration)
5. [Phase 3: Validation](#5-phase-3-validation)
6. [Phase 4: Pilot rollout (10-25 machines)](#6-phase-4-pilot-rollout-10-25-machines)
7. [Phase 5: Fleet rollout](#7-phase-5-fleet-rollout)
8. [Phase 6: Day 2 operations](#8-phase-6-day-2-operations)
9. [Troubleshooting](#9-troubleshooting)
10. [Reference](#10-reference)

---

## 1. Prerequisites

Before you begin, confirm the following:

### 1.1 Hardware requirements per machine

| Component | Minimum | Recommended |
|---|---|---|
| OS | macOS 13+ / Windows 10+ / modern Linux | macOS 14+ / Windows 11 |
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk free | 4 GB | 10 GB |

If your fleet has machines that don't meet the minimum, see section 9.4 for deployment options.

### 1.2 Infrastructure prerequisites

- A fleet management system: Microsoft Intune, Jamf Pro, Google Workspace Admin, or Active Directory Group Policy
- Chrome Enterprise license OR managed Chromium (so you can push extensions via policy)
- A SIEM or log destination (S3 / syslog / webhook) — only if you're enabling audit logs
- A signed policy bundle hosting URL — only if you're using customer-controlled detection rules

### 1.3 Permissions you need

- Admin access to your fleet management system
- Ability to push managed extension policies via Chrome Enterprise
- Ability to install software on managed machines (for Ollama)
- A code signing certificate (only if you're modifying the IronGate installer; not required for stock deployment)

### 1.4 Files you'll need

Get these from your IronGate enterprise account manager:

| File | Purpose |
|---|---|
| `IronGate-Enterprise-1.0.pkg` (macOS) | Signed installer with bundled Ollama |
| `IronGate-Enterprise-1.0.msi` (Windows) | Same for Windows |
| `MANIFEST.txt` | Cryptographic hashes of every bundled component |
| `intune-policy.xml` | Microsoft Intune deployment template |
| `jamf-policy.plist` | Jamf Pro deployment template |
| `workspace-policy.json` | Google Workspace Admin deployment template |
| `irongate-healthcheck.mjs` | Standalone health-check tool |
| `security-whitepaper.md` | For your security team |

---

## 2. Pre-flight checklist

Before installing on a single machine, run through this checklist:

- [ ] You have read the security whitepaper and your security team has approved the deployment
- [ ] You have generated a 64-character pseudonym key: `openssl rand -hex 32` and stored it in your secrets manager
- [ ] You have decided on the deployment mode: Sovereign (`local-only`) is the default for regulated firms
- [ ] You have decided on the audit log destination: `none` (privacy-first), `s3`, `syslog`, `webhook`, or `irongate-dashboard`
- [ ] If using audit logs: you have provisioned the destination (S3 bucket policy, syslog server endpoint, webhook URL with auth token)
- [ ] If using signed policy bundles: you have generated an Ed25519 keypair and the bundle hosting URL is set up
- [ ] You have a pilot machine identified: 1 laptop you control, ideally one with the same hardware spec as the typical fleet machine
- [ ] You have admin access to that pilot machine
- [ ] You have allocated 4-8 hours of focused time for the pilot phase
- [ ] You have a backup plan: you can roll back the pilot machine in case of issues

---

## 3. Phase 1: Pilot installation (1 machine)

**Time: 30 minutes.**

The goal: install IronGate on one machine end-to-end and verify the green badge appears in the sidepanel.

### Step 1: Install Ollama + the model + the IronGate extension via the installer package

**On macOS:**

```bash
# Verify the installer signature
codesign -dv IronGate-Enterprise-1.0.pkg

# Install (requires admin)
sudo installer -pkg IronGate-Enterprise-1.0.pkg -target /

# Watch the install log
tail -f /var/log/irongate-install.log
```

The installer:
1. Unpacks Ollama into `/Library/IronGate/ollama/`
2. Symlinks the Ollama binary to `/usr/local/bin/ollama`
3. Creates `/Library/LaunchDaemons/com.irongate.ollama.plist`
4. Loads the launchd service (Ollama starts on port 11434)
5. Pulls the `gemma4:e2b` model (~7.2 GB, takes 3-15 minutes on a fast network)
6. Runs the health check

**On Windows (PowerShell as Administrator):**

```powershell
# Verify the installer signature
Get-AuthenticodeSignature -FilePath IronGate-Enterprise-1.0.msi

# Install
msiexec /i IronGate-Enterprise-1.0.msi /qb /l*v "C:\ProgramData\IronGate\install-msi.log"

# Watch the install log
Get-Content "C:\ProgramData\IronGate\install.log" -Wait
```

### Step 2: Install the IronGate Chrome extension (manual for the pilot)

For the pilot, install the extension manually so you can verify behavior before pushing it via managed policy. Open Chrome and:

1. Go to `chrome://extensions`
2. Enable Developer Mode (top right)
3. Click "Load unpacked"
4. Point at the `apps/extension/dist` folder from your IronGate distribution
5. Note the Extension ID that appears (you'll need this for the managed policy in step 5)

### Step 3: Open the sidepanel

Click the IronGate icon in Chrome's toolbar. The sidepanel opens. You should see:

- A **gray "Initializing..."** badge briefly
- Then either:
  - A **gray "Cloud classification"** badge (if no managed policy is set yet — expected for a fresh pilot install)
  - A **green "🛡 Sovereign mode active"** badge (if you've already pushed a managed policy)

If you see the gray badge, that's correct for now — we'll push the managed policy next.

### Step 4: Run the health check

```bash
# macOS
node /Library/IronGate/healthcheck.mjs

# Windows
node "C:\Program Files\IronGate\healthcheck.mjs"
```

You should see:

```
═══════════════════════════════════════════════════════════════
  IronGate Enterprise Health Check
═══════════════════════════════════════════════════════════════
  Endpoint: http://localhost:11434/api/generate
  Model:    gemma4:e2b
───────────────────────────────────────────────────────────────
  ✓ Ollama endpoint reachable                http://localhost:11434/api/tags [54ms]
  ✓ Expected model loaded                    gemma4:e2b
  ✓ Cold inference roundtrip                 Response: "ok" [15048ms]
  ✓ Inference latency under 3s               1723ms
  ✓ Classification accuracy                  5/6 sanity tests passed [1256ms]
───────────────────────────────────────────────────────────────
  ✅ Overall: HEALTHY
═══════════════════════════════════════════════════════════════
```

Cold start the first time is slow (~15 seconds) because the model is loading into memory. Subsequent calls are 1-3 seconds.

If any check fails, see [section 9 Troubleshooting](#9-troubleshooting).

---

## 4. Phase 2: Configuration

**Time: 30 minutes.**

Now configure the managed policy that locks the deployment mode and points the extension at the local Ollama service.

### Step 1: Pick your deployment template

| Your fleet management system | Use this template |
|---|---|
| Microsoft Intune | `intune-policy.xml` |
| Jamf Pro | `jamf-policy.plist` |
| Google Workspace Admin | `workspace-policy.json` |
| Other (AD GPO, MDM, etc.) | The policy schema is in `managed_schema.json` — write your own |

### Step 2: Fill in the placeholders

Open your chosen template. Replace every `<<REPLACE_ME>>` with your firm's actual values:

| Placeholder | What to put | Example |
|---|---|---|
| `IRONGATE_EXTENSION_ID` | The Chrome extension ID (from Step 2 of Phase 1) | `aabbccddeeffgghh11223344` |
| `<<REPLACE_ME: none\|s3\|syslog\|webhook>>` | Your audit log destination | `none` (recommended for first pilot) |
| `<<REPLACE_ME: 64-hex-char key>>` | Your pseudonym key | Output of `openssl rand -hex 32` |
| `<<REPLACE_ME: your-firm-identifier>>` | Internal firm ID | `acme-legal-2026` |
| `<<REPLACE_ME: helpdesk@firm.com>>` | Internal IT support contact | `it-help@yourcompany.com` |
| `<<REPLACE_ME: https://policy.firm.internal/...>>` | Policy bundle URL (or leave empty) | `https://policy.acme-legal.internal/irongate/bundle.json` |

### Step 3: Push the managed policy

**Microsoft Intune:**

1. Open Intune admin center → Devices → Configuration profiles → Create profile
2. Platform: Windows 10 and later
3. Profile type: Templates → Custom
4. Upload your filled-in `intune-policy.xml`
5. Assign to your pilot user/device group
6. Save and deploy

**Jamf Pro:**

1. Computers → Configuration Profiles → New
2. Application & Custom Settings → Upload
3. Preference Domain: `com.google.Chrome`
4. Upload your filled-in `jamf-policy.plist`
5. Scope to your pilot computer group
6. Save

**Google Workspace Admin:**

1. Devices → Chrome → Apps & extensions → Users & browsers
2. Select your pilot OU
3. Click + → Add Chrome app or extension by ID
4. Enter the IronGate extension ID
5. Set Installation policy: Force install
6. Click the extension in the list → paste the contents of `workspace-policy.json` into the policy panel
7. Save

### Step 4: Wait for policy propagation

Managed policies take 1-30 minutes to propagate depending on your fleet management system. Force a sync if your system supports it:

- **Intune:** On the pilot machine, Settings → Accounts → Access work or school → Connected → Info → Sync
- **Jamf:** `sudo jamf policy` on the pilot machine
- **Workspace:** Open `chrome://policy` on the pilot machine and click "Reload policies"

### Step 5: Verify the policy applied

On the pilot machine, open `chrome://policy` and search for "irongate". You should see your managed config values listed under "Extensions" with status "OK".

---

## 5. Phase 3: Validation

**Time: 30 minutes.**

Now verify the full pipeline works end-to-end on the pilot machine.

### Test 1: The badge turns green

Open the IronGate sidepanel. You should see a **green "🛡 Sovereign mode active"** badge. Click it to expand. It should show:

- Mode: `local-only`
- Model: `gemma4:e2b`
- Endpoint: `http://localhost:11434/api/generate`
- Status: `Reachable + model loaded`
- Latency: `<3000ms`
- Audit log: `none` (or whatever you configured)

**If the badge is red or gray:** see [section 9 Troubleshooting](#9-troubleshooting).

### Test 2: Open ChatGPT and submit a green prompt

```
How do I reverse a string in Python?
```

This is a benign prompt. It should pass through normally. Verify in the IronGate sidepanel that an event was recorded with zone=`green`.

### Test 3: Submit a red prompt

```
My SSN is 123-45-6789 and my name is Sarah Johnson. Help me file for disability benefits.
```

IronGate should pseudonymize this. The actual prompt sent to OpenAI should NOT contain "123-45-6789" or "Sarah Johnson". Verify by:

1. Opening Chrome DevTools → Network tab BEFORE submitting
2. Submit the prompt
3. Find the POST to `chatgpt.com/backend-api/conversation`
4. Inspect the request body — you should see a fake SSN and a fake name in place of the originals
5. The response from ChatGPT will contain the fake names; IronGate de-pseudonymizes them as they stream in so the user sees the originals

This is the most important test. If the request body still contains the original PII, **stop the rollout immediately and contact IronGate support**.

### Test 4: Submit an amber prompt

```
Confidential: We are evaluating an acquisition of a competitor for roughly $2B. Draft board talking points.
```

This has no direct PII but is business-confidential. Tier 1 alone might miss it (regex finds nothing). The local Tier 2 LLM should classify it as AMBER and pseudonymize the financial details. Verify in the sidepanel that an event was recorded with zone=`amber` and Tier 2 was consulted.

### Test 5: Run the network egress packet capture

This is the verification that your security team will want.

```bash
# macOS — capture for 5 minutes during normal usage
sudo tcpdump -i any -w irongate-capture.pcap not host 127.0.0.1 and not host ::1

# Then open ChatGPT and submit several real-looking prompts

# Stop tcpdump and analyze
tcpdump -r irongate-capture.pcap -nn | sort -u | head -50
```

Expected outbound destinations:
- `chatgpt.com`, `openai.com` (or whichever AI tool you used)
- Standard OS chatter (NTP, DNS, OS updates)
- Your audit sink (if configured)
- Your policy bundle URL (if configured, once per hour)

**Should NOT see:** `irongate-api.onrender.com`, `api.openai.com`, `api.anthropic.com`, any IronGate-controlled domain.

### Test 6: Pull the plug — verify fail-closed behavior

```bash
# macOS: stop the Ollama service
sudo launchctl unload /Library/LaunchDaemons/com.irongate.ollama.plist
```

Now open ChatGPT and submit an AMBER prompt (e.g., the M&A test from Test 4). IronGate should:
- Show a red badge in the sidepanel
- Display an error notification
- BLOCK the prompt from being sent (because Sovereign Mode fails closed)

If the prompt goes through anyway, **the fail-closed contract is broken — stop the rollout and contact IronGate support**.

Restart Ollama:

```bash
sudo launchctl load /Library/LaunchDaemons/com.irongate.ollama.plist
```

The badge returns to green within 30 seconds.

---

## 6. Phase 4: Pilot rollout (10-25 machines)

**Time: 1-3 days.**

Once Phase 3 passes, deploy to a small pilot group:

### Step 1: Identify pilot users

Pick 10-25 users who:
- Are tolerant of new tools and willing to give feedback
- Use AI tools daily (so you get real usage data)
- Cover the typical hardware mix in your fleet
- Include at least one person from each office/team

### Step 2: Push the same managed policy + installer to the pilot group

In your fleet management system, expand the scope of the policy and installer from "1 pilot machine" to the pilot group.

### Step 3: Notify the pilot users

Send an email like this:

> Subject: IronGate pilot rollout
>
> We're piloting IronGate, a tool that protects sensitive data when you use AI tools like ChatGPT. The pilot starts today and runs for 2 weeks.
>
> What changes for you:
> - Nothing visible during normal use
> - The IronGate icon appears in your Chrome toolbar — click it to see the green "Sovereign mode" badge
> - If you try to send sensitive data (SSNs, credit cards, etc.) the data is automatically pseudonymized before reaching the AI tool
> - Your prompts never leave your laptop — IronGate runs entirely on your device
>
> If anything feels off (slow performance, blocked legitimate prompts, errors), reply to this email or message me on Slack.
>
> Thanks for participating.

### Step 4: Monitor the pilot

Run the health check on every pilot machine daily. Track:

```bash
# JSON output for ingestion
node irongate-healthcheck.mjs --json | jq '.overall'
```

Watch for:
- Machines reporting unhealthy → see Troubleshooting
- High false-positive rate (legitimate prompts getting blocked)
- High latency complaints (P50 should be 1-3 seconds)
- Memory/CPU complaints (Ollama uses 4-6 GB RAM at idle)

### Step 5: Daily 5-minute pilot standup (optional but recommended)

For the first week, do a 5-minute daily check-in with the pilot users. The first 2-3 days surface 80% of the issues you'll encounter at fleet scale.

### Step 6: After 2 weeks, decide

If the pilot has been clean (no false positives, no machines unhealthy, no user complaints), proceed to Phase 5. If not, fix the issues before scaling.

---

## 7. Phase 5: Fleet rollout

**Time: 1-4 weeks depending on fleet size.**

### Recommended rollout cadence

| Week | Scope | Cumulative |
|---|---|---|
| Week 1 | 5% of fleet | 5% |
| Week 2 | 15% more | 20% |
| Week 3 | 30% more | 50% |
| Week 4 | 50% more | 100% |

This gives you time to catch issues at each stage before they affect everyone.

### What to monitor

1. **Per-machine health** via `irongate-healthcheck.mjs --json` ingested into your monitoring system
2. **Per-user audit log volume** if you've enabled an audit sink
3. **Tickets to IT** mentioning IronGate, ChatGPT, or AI tools
4. **Sidepanel badge color** spot-checks (green vs red)

---

## 8. Phase 6: Day 2 operations

Once IronGate is fully deployed, here's what your team needs to operate it:

### 8.1 Monitoring

Set up a dashboard in your monitoring system (Datadog, Splunk, etc.) that ingests `irongate-healthcheck.mjs --json` from each machine. Alert on:

- Health status `unhealthy` or `degraded` for >15 minutes
- Cold inference latency >30 seconds (indicates machine memory pressure)
- Classification accuracy <80% (indicates model issues)

### 8.2 Updates

Two things update independently:

1. **The IronGate extension** — auto-updates via Chrome Web Store / Chrome Enterprise managed policy
2. **The Ollama service + model** — does NOT auto-update. Push updates via your fleet management system the same way you push other software.

Both update paths are tested in pre-release. Test on a small group before pushing to the fleet.

### 8.3 Rotating the pseudonym key

The `pseudonymKey` in managed config should be rotated every 6-12 months. To rotate:

1. Generate a new key: `openssl rand -hex 32`
2. Update the managed policy with the new key
3. Push to the fleet
4. **Note:** rotating the key invalidates all previous pseudonyms — same original entity will now produce a different fake. This is by design (it limits forensic correlation across rotation periods).

### 8.4 Updating policy bundles

If you're using customer-controlled signed policy bundles:

1. Edit your detection rules (regex patterns, contextual keywords, scoring weights)
2. Re-sign the bundle with your Ed25519 private key
3. Upload the signed bundle to your `policyBundleUrl`
4. The extensions in the fleet auto-fetch within 1 hour

### 8.5 Disabling IronGate temporarily (kill switch)

If you need to disable IronGate fleet-wide (e.g., during an outage of an unrelated tool that IronGate was incorrectly blocking), set `killSwitch: true` in the managed policy. The extension will stop intercepting AI tool requests. Push via your fleet management system.

---

## 9. Troubleshooting

### 9.1 Sidepanel badge is red

Click the badge to expand the diagnostic. Common causes:

| Symptom | Cause | Fix |
|---|---|---|
| "Local LLM unreachable" | Ollama service is down | Restart Ollama: `sudo launchctl load /Library/LaunchDaemons/com.irongate.ollama.plist` |
| "Model not loaded" | Ollama is running but gemma4:e2b is not pulled | Run `ollama pull gemma4:e2b` |
| "Probe timed out" | Ollama is overloaded or starved for memory | Check Activity Monitor / Task Manager for memory usage; restart Ollama |
| "Configuration error" | Managed policy has a typo or missing required field | Check `chrome://policy` for the IronGate config and validate against `managed_schema.json` |

### 9.2 Health check fails

Run with `--json` and inspect each check:

```bash
node irongate-healthcheck.mjs --json | jq '.checks'
```

| Failed check | Fix |
|---|---|
| `Ollama endpoint reachable` | Ollama service is down — restart it |
| `Expected model loaded` | Run `ollama pull gemma4:e2b` |
| `Cold inference roundtrip` | Model is loaded but inference is failing — check Ollama logs at `/var/log/irongate-ollama.err` |
| `Inference latency under 3s` | Machine is starved for memory — close other apps or upgrade RAM |
| `Classification accuracy` | Model is responding but giving wrong answers — verify the model is `gemma4:e2b`, not a different version |

### 9.3 "Tier 2 disabled after 3 consecutive failures"

This means the local LLM has failed 3 times in a row in `hybrid` mode. In Sovereign Mode (`local-only`), there is no automatic disable — failures are surfaced as red badges and blocked prompts.

To recover:
1. Verify Ollama is healthy: run the health check
2. Verify the model is loaded: `ollama list`
3. Restart the extension: `chrome://extensions` → reload IronGate

### 9.4 Machine doesn't meet hardware requirements

Some machines in your fleet might have <8 GB RAM or <4 GB free disk. Options:

1. **Use Chrome built-in Gemini Nano** for those machines — set `localFormat: "chrome-builtin"` in the managed policy. No Ollama, no 2 GB model. Requires Chrome 138+ and 16 GB RAM.
2. **Upgrade the hardware** — IronGate is built for modern enterprise laptops. Machines that can't run a 2 GB local model in 2026 are due for replacement anyway.
3. **Use hybrid mode** for those machines — `deploymentMode: "hybrid"` falls back to IronGate's server-side classification when local is unreachable. **Not Sovereign Mode**, but acceptable for some compliance postures.
4. **Exclude the machine from IronGate** until it's upgraded.

### 9.5 User complains about latency

Cold start of the first prompt of the day takes 5-15 seconds (model loads into memory). After that, P50 is 1-3 seconds. If the user is seeing >5 seconds on every prompt, the machine is memory-starved.

Workarounds:
- Make sure `OLLAMA_KEEP_ALIVE=30m` is set in the launchd / Windows service environment (this keeps the model resident for 30 minutes)
- Close unused apps
- Upgrade RAM

### 9.6 User complains about false positives

If a legitimate prompt is being incorrectly flagged:

1. Capture the exact prompt
2. Reproduce on your test machine
3. If it's a Tier 1 false positive (regex), update the policy bundle to suppress the rule
4. If it's a Tier 2 false positive (LLM), it's a model classification error — there's no immediate fix, but you can adjust the system prompt in the policy bundle

### 9.7 The ChatGPT request body still contains original PII

**This is a P0 incident.** Stop using IronGate immediately and contact IronGate support: security@irongate.ai. Provide:
- Extension version (visible in `chrome://extensions`)
- Sample prompt and the captured network request
- Output of `node irongate-healthcheck.mjs --json`
- Output of `chrome://policy` filtered to IronGate

This should never happen — every release is gated by tests that verify pseudonymization is applied correctly. If you see it, we need to know within minutes.

---

## 10. Reference

### 10.1 Managed policy schema

The complete managed policy schema is in `apps/extension/managed_schema.json`. Every key documented there is settable from your fleet management tool.

### 10.2 Architecture invariants (test-enforced contract)

The privacy contract is enforced by `apps/extension/tests/architecture-invariants.test.ts`. Read this if you want to verify the contract independently.

### 10.3 Health check exit codes

| Exit code | Meaning | Action |
|---|---|---|
| 0 | Healthy | None |
| 1 | Degraded (some warnings) | Investigate within 24 hours |
| 2 | Unhealthy (critical failure) | Investigate immediately, possibly disable AI tool access on this machine |

### 10.4 Files installed

**macOS:**

```
/Library/IronGate/
  ollama/                         # Ollama application bundle
  healthcheck.mjs                 # Standalone health check tool
  MODEL_MANIFEST.txt              # Bundled model manifest
/usr/local/bin/ollama             # Symlink to Ollama binary
/Library/LaunchDaemons/com.irongate.ollama.plist
/var/log/irongate-install.log
/var/log/irongate-ollama.log
/var/log/irongate-ollama.err
```

**Windows:**

```
C:\Program Files\IronGate\
  ollama\                         # Ollama installation
  healthcheck.mjs
  MODEL_MANIFEST.txt
  postinstall.ps1
C:\ProgramData\IronGate\install.log
```

Plus the Llama 3.2 3B model in Ollama's user data directory:

- macOS: `~/.ollama/models/`
- Windows: `%USERPROFILE%\.ollama\models\`

### 10.5 Logs to inspect when something is wrong

| What to check | macOS path | Windows path |
|---|---|---|
| Install log | `/var/log/irongate-install.log` | `C:\ProgramData\IronGate\install.log` |
| Ollama service stdout | `/var/log/irongate-ollama.log` | Event Viewer → Applications and Services → IronGate Ollama |
| Ollama service stderr | `/var/log/irongate-ollama.err` | Same as above |
| Extension console | `chrome://extensions` → IronGate → Inspect views → service worker | Same |
| Managed policy | `chrome://policy` | Same |
| Health check JSON | `node irongate-healthcheck.mjs --json` | Same |

### 10.6 Contact

| Issue | Contact |
|---|---|
| Security incident (CRIT-level) | security@irongate.ai |
| Deployment support | enterprise@irongate.ai |
| Bug reports | support@irongate.ai |
| Escalation (account manager) | provided at sale time |

---

**End of runbook.**
You should now have a working IronGate Enterprise deployment in Sovereign Mode.
If you got here without surprises, congratulations — your firm just removed an entire compliance bottleneck.
