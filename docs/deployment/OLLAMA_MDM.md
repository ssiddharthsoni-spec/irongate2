# Deploying Ollama to Every Managed Device (Path B)

**Audience:** IT administrators deploying IronGate's optional Tier 2 detection (local LLM) across 50-500+ managed Chromebooks, Macs, Windows PCs, or Linux workstations.

**Time required:** ~15 minutes of admin work. Devices complete their part in the background over the following 24-48 hours.

**Prerequisites:**
- IronGate is already deployed to your Chrome/Edge extensions via MDM (see [GOOGLE_WORKSPACE.md](./GOOGLE_WORKSPACE.md), [MICROSOFT_INTUNE.md](./MICROSOFT_INTUNE.md), or [JAMF_PRO.md](./JAMF_PRO.md))
- MDM console admin access with script deployment privileges
- Target devices have at least 8GB RAM (4GB+ free) and 3GB free disk
- Target devices have internet access to reach `ollama.com` once

---

## The big picture

| Phase | Who | What |
|---|---|---|
| 1 | You (admin) | Open the IronGate dashboard's Ollama deployment wizard |
| 2 | You (admin) | Pick platforms + MDM; copy the install-script wrapper to your MDM |
| 3 | You (admin) | Update the IronGate managed policy with `localEndpoint` + `localModel` |
| 4 | MDM | Silently installs Ollama + pulls `llama3.2:3b` on every target device |
| 5 | IronGate extension | Auto-detects Ollama, enables Tier 2, reports status home |
| 6 | You (admin) | Watch devices turn green in the deployment status table |

No user involvement. No per-device visits. No employee downtime.

---

## Step 1 — Open the deployment wizard

1. Sign in to `irongate-dashboard.vercel.app`
2. **Admin → Deployment → Ollama Setup**
   (or go directly to `/admin/deployment/ollama`)

The wizard has five steps on one page, generates everything you need, and shows live device status as the rollout proceeds.

---

## Step 2 — Pick your target platforms

Tick the boxes for OSes in your fleet:

- **macOS** — Macs managed by Jamf Pro, Kandji, Munki, Mosyle, or Intune for Mac
- **Windows** — PCs managed by Intune, SCCM, or VMware Workspace ONE
- **Linux** — workstations managed by Ansible, SSH rollouts, or Puppet/Chef

Select any combination. The wizard generates platform-specific scripts.

---

## Step 3 — Pick your MDM

Pick what you use. The wizard pre-formats the install invocation for that platform:

- Microsoft Intune
- Jamf Pro
- VMware Workspace ONE
- Custom / Ansible / SSH

---

## Step 4 — Deploy the install scripts

The wizard shows a card per platform you selected. Each card contains:

- A **pre-formatted script** ready to paste into your MDM (click "Copy")
- A **download link** to the raw install script (hosted at irongate-dashboard.vercel.app/deploy/ollama/)
- A **note** explaining where to paste it in your MDM console

### 4a — Microsoft Intune (Windows)

1. Copy the Windows script from the wizard
2. In Intune: **Devices → Scripts and remediations → Platform scripts → Add**
3. Platform: **Windows 10 and later**
4. Paste the script. Settings:
   - **Run this script using the logged on credentials:** No
   - **Enforce script signature check:** No
   - **Run script in 64 bit PowerShell Host:** Yes
5. **Assignments:** Select your target device group (start with a pilot)
6. **Create**

Intune pushes the script within ~1 hour. The script installs Ollama silently, pulls the model (~2GB, 3-5 min), and verifies it's reachable on localhost:11434.

### 4b — Jamf Pro (macOS)

1. Copy the Mac script from the wizard
2. In Jamf: **Settings → Computer management → Scripts → New**
3. Name: `IronGate - Install Ollama`
4. Category: your preferred (e.g., "IronGate")
5. Paste the script
6. **Options tab:** Priority = After; Frequency = Once per computer
7. **Save**
8. **Computers → Policies → New Policy**
   - Name: `IronGate - Install Ollama`
   - Trigger: Recurring check-in
   - Execution frequency: Once per computer
   - Payload: add the script you just saved
   - Scope: target computer group
9. **Save**

Deploys on next Jamf check-in (~15 min).

### 4c — VMware Workspace ONE (macOS)

Same as Jamf, but via Workspace ONE UEM → Freestyle Orchestrator → Workflow with a Shell Script action. The install URL and script body are identical.

### 4d — Intune for Mac (alternative macOS path)

1. **Devices → macOS → Shell scripts → Add**
2. Name: `IronGate - Install Ollama`
3. Paste the macOS script from the wizard
4. Run script as signed-in user: **No**
5. Hide script notifications on device: **Yes**
6. Frequency: **Once**
7. Max retries: **3**
8. Assign to target group

### 4e — Ansible / SSH (Linux)

For Linux fleets, the simplest path is a single Ansible play or SSH one-liner. The wizard shows:

```bash
curl -fsSL https://irongate-dashboard.vercel.app/deploy/ollama/install-linux.sh | sudo bash
```

In Ansible:

```yaml
- name: Install IronGate Ollama
  hosts: knowledge_workers
  become: true
  tasks:
    - name: Run IronGate install script
      shell: |
        curl -fsSL https://irongate-dashboard.vercel.app/deploy/ollama/install-linux.sh | bash
      args:
        creates: /usr/local/bin/ollama
```

The `creates: /usr/local/bin/ollama` guard makes the play idempotent — skips already-installed hosts.

---

## Step 5 — Update the IronGate managed policy

Once Ollama is installed on devices, the IronGate extension needs to know to use it. Copy the managed policy JSON from the wizard and paste it into your existing IronGate extension managed policy (same place where you set `enrollmentCode`).

The two new fields are:

```json
{
  "localEndpoint": { "Value": "http://localhost:11434/api/generate" },
  "localModel": { "Value": "llama3.2:3b" }
}
```

When the extension starts and sees these fields populated, it:
1. Tests `localhost:11434/api/tags` to confirm Ollama is reachable
2. If yes: enables Tier 2 detection automatically
3. If no (Ollama not yet installed or not yet running): falls back to Tier 1 only — no errors, no user-visible issues

This is forward-compatible: the managed policy can be updated _before_ the install script runs; the extension waits for Ollama to appear.

---

## Step 6 — Monitor rollout status

Back in the deployment wizard, the bottom section shows every enrolled device and its Ollama status:

| State | Meaning |
|---|---|
| **● Ready** (green) | Ollama installed, running, model pulled. Tier 2 fully active. |
| **● Partial** (yellow) | Ollama installed, model still pulling OR service not running. Wait 10-30 min. |
| **○ Pending** (gray) | Device hasn't reported yet — either MDM hasn't deployed the script or extension hasn't phoned home. |

Typical rollout timeline for 100-200 devices:

- **0-1 hour:** MDM policies propagate to all target devices
- **1-4 hours:** Install scripts execute on devices as users log in or check-in triggers
- **2-8 hours:** Most devices show "Partial" (Ollama installed, model downloading)
- **6-24 hours:** Most devices show "Ready" (model pull complete)
- **24-48 hours:** Full fleet coverage

Devices that remain "Pending" after 48 hours usually have one of: MDM enrollment issues, network restrictions blocking ollama.com, insufficient disk space. Troubleshoot via the table's "Last seen" column.

---

## Common issues and fixes

### "Model pull is hanging on slow corporate networks"

By default the install script tries to pull the model during install. On a 10 Mbps corporate uplink, 200 devices pulling 2GB simultaneously = 400GB of wifi traffic, which WILL strangle your network.

**Fix:** Stagger the rollout. In your MDM, deploy the install script to small batches (e.g., 20 devices at a time) with a few-hour gap between batches. Or deploy overnight when wifi is idle.

Alternative: self-host the model file on an internal CDN and modify the install script to pull from your internal URL instead of registry.ollama.com.

### "Some devices won't install because of disk space"

The install script fails gracefully if disk is full — logs to `/var/log/irongate-ollama-install.log` (Mac/Linux) or `C:\ProgramData\IronGate\ollama-install.log` (Windows). Review these logs; free up disk and re-run.

### "Users report their Mac fans spinning up"

Ollama uses ~40-80% CPU for 2-3 seconds per prompt while running Tier 2 classification. On laptops this is noticeable. Options:

- **Accept it** — most users don't notice; the spike is brief.
- **Lower the sensitivity setting** in IronGate admin to reduce how often Tier 2 fires.
- **Move to Path C** (centralized Ollama server) — see [OLLAMA_CENTRAL_SERVER.md](./OLLAMA_CENTRAL_SERVER.md) (coming soon).

### "Our security team blocks ollama.com at the firewall"

Ollama's install script and model registry both hit `ollama.com` and `registry.ollama.ai`. Whitelist both domains, OR mirror the installer + model files internally and modify the install script to pull from your internal mirror.

### "Antivirus flags the Ollama service"

Rare but happens with aggressive EDR tools like CrowdStrike or SentinelOne. Ollama's binary is signed by Ollama Inc. — add an allow rule for the signed binary.

### "Re-running the script after a failed install"

All three scripts (Mac, Windows, Linux) are **idempotent**. Re-running them is safe — they detect existing installs and skip completed steps. Just re-deploy from your MDM; failed devices will catch up on the next run.

---

## Uninstalling Ollama org-wide

If you decide to roll back to Tier 1 only:

1. In your MDM, deploy a script that runs:

   **macOS:**
   ```bash
   sudo rm -rf /Applications/Ollama.app
   sudo rm -rf /usr/local/bin/ollama
   sudo rm -rf ~/.ollama
   ```

   **Windows:**
   ```powershell
   & "$env:LOCALAPPDATA\Programs\Ollama\Uninstall.exe" /S
   Remove-Item -Recurse -Force "$env:USERPROFILE\.ollama" -ErrorAction SilentlyContinue
   ```

   **Linux:**
   ```bash
   sudo systemctl stop ollama
   sudo systemctl disable ollama
   sudo rm /usr/local/bin/ollama
   sudo rm -rf /usr/share/ollama
   ```

2. Remove the `localEndpoint` and `localModel` fields from the IronGate managed policy
3. Extensions auto-detect Ollama is gone and fall back to Tier 1 seamlessly

---

## Hardware requirements — what to expect on each device

| Dimension | Idle | Running Tier 2 |
|---|---|---|
| RAM | ~500MB | ~4GB (2-3 second peak per prompt) |
| Disk | ~2.5GB (model file) | — |
| CPU | <1% | 40-80% on 1-2 cores for 2-3 sec |
| Battery impact (laptop) | Negligible | ~5-10% reduction during heavy AI use |
| Network | Zero (localhost only) | Zero |

Minimum supported hardware:

- **macOS:** M1 or later; Intel Macs with 8GB+ RAM
- **Windows:** Windows 10/11 with 8GB+ RAM
- **Linux:** x86_64 or ARM64 with 8GB+ RAM

Devices under 8GB RAM can install Ollama but will experience noticeable slowdowns when Tier 2 runs. For these devices, keep deployment to Tier 1 only.

---

## Why this deployment path is preferred for 100+ users

| Path | Pros | Cons |
|---|---|---|
| **Path A — Self-serve** (employees install themselves) | Zero admin effort | 20-40% adoption; inconsistent detection across the firm |
| **Path B — MDM-push** (this guide) | 100% coverage, uniform detection | Admin has to own Ollama lifecycle |
| **Path C — Centralized server** (internal GPU box) | Best perf, one place to update | Requires hardware, networking, uptime mgmt |

For 100-200 user firms with standardized hardware, **Path B is the sweet spot**: consistent coverage with predictable ongoing effort.

---

## Support

- **Deployment issues:** support@irongate.ai
- **Status page:** https://status.irongate.ai
- **Live wizard:** `irongate-dashboard.vercel.app/admin/deployment/ollama`
- **Raw install scripts:** `irongate-dashboard.vercel.app/deploy/ollama/`
