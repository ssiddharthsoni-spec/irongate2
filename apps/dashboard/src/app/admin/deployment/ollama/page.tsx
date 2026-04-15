'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

/**
 * Ollama Deployment Wizard
 *
 * Simplifies Path B (org-wide Ollama deployment via MDM) from a 2-4 hour
 * manual process to a 15-minute guided flow:
 *   1. Admin picks target platforms (Mac/Windows/Linux)
 *   2. Page generates the install script + ready-to-paste MDM policy
 *   3. Admin copies the policy into their MDM and deploys
 *   4. Status table shows deployment progress per device
 */

type Platform = 'macos' | 'windows' | 'linux';

interface DeviceStatus {
  userId: string;
  email?: string;
  platform?: string;
  ollamaInstalled: boolean;
  ollamaReachable: boolean;
  modelPulled: boolean;
  lastSeen: string | null;
}

export default function OllamaDeploymentPage() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();
  const [firmInfo, setFirmInfo] = useState<{ firmId?: string; enrollmentCode?: string }>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['macos', 'windows']));
  const [mdmPlatform, setMdmPlatform] = useState<'jamf' | 'intune' | 'workspace' | 'custom'>('intune');
  const [copied, setCopied] = useState<string | null>(null);
  const [deviceStatuses, setDeviceStatuses] = useState<DeviceStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);

  // Fetch firm info + device status
  useEffect(() => {
    (async () => {
      try {
        const [firmRes, statusRes] = await Promise.all([
          apiFetch('/admin/firm'),
          apiFetch('/admin/deployment/ollama-status').catch(() => null),
        ]);
        if (firmRes.ok) {
          const data = await firmRes.json();
          setFirmInfo({ firmId: data.id, enrollmentCode: data.enrollmentCode });
        }
        if (statusRes?.ok) {
          const data = await statusRes.json();
          setDeviceStatuses(data.devices ?? []);
        }
      } catch {
        /* graceful degradation */
      } finally {
        setStatusLoading(false);
      }
    })();
  }, [apiFetch]);

  const scriptBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/deploy/ollama`
    : 'https://irongate-dashboard.vercel.app/deploy/ollama';

  // ── MDM policy generators ──────────────────────────────────────────────────

  function ironGateManagedPolicy(): string {
    return JSON.stringify(
      {
        deploymentMode: { Value: 'local-only' },
        enrollmentCode: { Value: firmInfo.enrollmentCode ?? '<YOUR-ENROLLMENT-CODE>' },
        firmId: { Value: firmInfo.firmId ?? '<YOUR-FIRM-ID>' },
        localEndpoint: { Value: 'http://localhost:11434/api/generate' },
        localModel: { Value: 'gemma4:e2b' },
        localFormat: { Value: 'ollama' },
        allowedAITools: { Value: ['chatgpt', 'claude', 'gemini', 'copilot'] },
      },
      null,
      2,
    );
  }

  function intuneWindowsScript(): string {
    return `# Intune PowerShell Deploy Script
# Upload this via: Devices → Scripts and remediations → Platform scripts → Add
# Platform: Windows 10 and later | Run in 64-bit PowerShell Host: Yes

Invoke-WebRequest -Uri "${scriptBaseUrl}/install-windows.ps1" \\
    -OutFile "$env:TEMP\\install-ollama.ps1" -UseBasicParsing
PowerShell -ExecutionPolicy Bypass -File "$env:TEMP\\install-ollama.ps1"
`;
  }

  function jamfMacScript(): string {
    return `#!/bin/bash
# Jamf Pro Script — Upload via:
#   Settings → Computer management → Scripts → New
# Category: Iron Gate | Priority: After | Frequency: Once per computer

curl -fsSL "${scriptBaseUrl}/install-macos.sh" | bash
`;
  }

  function intuneMacScript(): string {
    return `#!/bin/bash
# Intune for Mac Shell Script — Upload via:
#   Devices → macOS → Shell scripts → Add
# Run script as signed-in user: No | Hide script notifications: Yes

curl -fsSL "${scriptBaseUrl}/install-macos.sh" | bash
`;
  }

  function workspaceOneLinux(): string {
    return `#!/bin/bash
# VMware Workspace ONE / Generic Linux MDM
# Deploy as a shell-script workflow to Linux endpoints

curl -fsSL "${scriptBaseUrl}/install-linux.sh" | sudo bash
`;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  function handleCopy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
      addToast({ type: 'success', message: `${label} copied to clipboard` });
    });
  }

  const togglePlatform = (p: Platform) => {
    const next = new Set(selectedPlatforms);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelectedPlatforms(next);
  };

  // Compute deployment health numbers
  const totalDevices = deviceStatuses.length;
  const readyDevices = deviceStatuses.filter((d) => d.ollamaReachable && d.modelPulled).length;
  const partialDevices = deviceStatuses.filter((d) => d.ollamaInstalled && !d.modelPulled).length;
  const missingDevices = totalDevices - readyDevices - partialDevices;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
        <span>/</span>
        <Link href="/admin/deployment" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Deployment</Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Ollama Setup</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Org-wide Ollama Deployment</h1>
        <p className="text-[#6e6e73] dark:text-[#86868b] text-sm leading-relaxed max-w-2xl">
          Deploy Ollama to every managed device so all employees get enhanced on-device
          detection accuracy (Tier 2) without installing anything themselves. This page
          generates the install scripts and MDM policy snippets for your environment.
        </p>
      </div>

      {/* ── Step 1: Choose platforms ──────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 1 — Target platforms</h2>
        <p className="text-[13px] text-[#86868b] dark:text-[#636366] mb-4">
          Select the operating systems you need to cover. You can deploy to multiple platforms in parallel.
        </p>
        <div className="flex flex-wrap gap-3">
          {(['macos', 'windows', 'linux'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={`px-4 py-3 rounded-xl border-2 transition-colors min-w-[140px] text-left ${
                selectedPlatforms.has(p)
                  ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20'
                  : 'border-[#d2d2d7]/60 dark:border-[#38383a]/60 bg-white dark:bg-[#1c1c1e]'
              }`}
            >
              <div className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {p === 'macos' ? 'macOS' : p === 'windows' ? 'Windows' : 'Linux'}
              </div>
              <div className="text-[11px] text-[#86868b] mt-0.5">
                {p === 'macos' ? 'Jamf / Kandji / Intune' : p === 'windows' ? 'Intune / SCCM / WS1' : 'Ansible / SSH / Puppet'}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Step 2: Choose MDM platform ───────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 2 — MDM platform</h2>
        <p className="text-[13px] text-[#86868b] dark:text-[#636366] mb-4">
          Pick what you use. We&apos;ll tailor the deploy instructions.
        </p>
        <select
          value={mdmPlatform}
          onChange={(e) => setMdmPlatform(e.target.value as typeof mdmPlatform)}
          className="px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] text-sm min-w-[240px]"
        >
          <option value="intune">Microsoft Intune</option>
          <option value="jamf">Jamf Pro</option>
          <option value="workspace">VMware Workspace ONE</option>
          <option value="custom">Custom / Ansible / SSH</option>
        </select>
      </section>

      {/* ── Step 3: Deploy ─────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 3 — Deploy the install scripts</h2>
        <p className="text-[13px] text-[#86868b] dark:text-[#636366] mb-4">
          The scripts below are hosted at a stable URL. Paste them into your MDM.
          They&apos;re idempotent — safe to re-run if a deploy fails mid-install.
        </p>

        <div className="space-y-4">
          {selectedPlatforms.has('macos') && (
            <DeployCard
              title="macOS — Jamf / Kandji / Intune for Mac"
              script={mdmPlatform === 'intune' ? intuneMacScript() : jamfMacScript()}
              rawScriptUrl={`${scriptBaseUrl}/install-macos.sh`}
              copied={copied === 'mac-script'}
              onCopy={() => handleCopy('mac-script', mdmPlatform === 'intune' ? intuneMacScript() : jamfMacScript())}
            />
          )}
          {selectedPlatforms.has('windows') && (
            <DeployCard
              title="Windows — Intune / SCCM / Workspace ONE"
              script={intuneWindowsScript()}
              rawScriptUrl={`${scriptBaseUrl}/install-windows.ps1`}
              copied={copied === 'win-script'}
              onCopy={() => handleCopy('win-script', intuneWindowsScript())}
            />
          )}
          {selectedPlatforms.has('linux') && (
            <DeployCard
              title="Linux — Ansible / SSH / Workspace ONE"
              script={workspaceOneLinux()}
              rawScriptUrl={`${scriptBaseUrl}/install-linux.sh`}
              copied={copied === 'linux-script'}
              onCopy={() => handleCopy('linux-script', workspaceOneLinux())}
            />
          )}
        </div>
      </section>

      {/* ── Step 4: Update IronGate managed policy ────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 4 — Update IronGate managed policy</h2>
        <p className="text-[13px] text-[#86868b] dark:text-[#636366] mb-4">
          After Ollama is installed on the devices, update the IronGate extension&apos;s
          managed policy to enable Tier 2 detection. Paste this into your existing
          managed-extension configuration (Google Admin Console / Intune / Jamf):
        </p>
        <CodeBlock
          text={ironGateManagedPolicy()}
          copied={copied === 'managed-policy'}
          onCopy={() => handleCopy('managed-policy', ironGateManagedPolicy())}
        />
        <div className="mt-3 text-[12px] text-[#86868b] dark:text-[#636366]">
          <p>The <code className="bg-[#f5f5f7] dark:bg-[#2c2c2e] px-1 py-0.5 rounded text-[11px]">localEndpoint</code> and <code className="bg-[#f5f5f7] dark:bg-[#2c2c2e] px-1 py-0.5 rounded text-[11px]">localModel</code> fields are what enable Tier 2. The extension auto-detects Ollama when these are set.</p>
        </div>
      </section>

      {/* ── Step 5: Deployment status ─────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 5 — Deployment status</h2>
            <p className="text-[13px] text-[#86868b] dark:text-[#636366]">
              Per-device health. Updates as extensions phone home with their Ollama status.
            </p>
          </div>
          {!statusLoading && totalDevices > 0 && (
            <div className="flex gap-3 text-[12px]">
              <span className="px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-medium">
                {readyDevices} ready
              </span>
              {partialDevices > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 font-medium">
                  {partialDevices} partial
                </span>
              )}
              {missingDevices > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] font-medium">
                  {missingDevices} pending
                </span>
              )}
            </div>
          )}
        </div>

        {statusLoading ? (
          <div className="h-32 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        ) : totalDevices === 0 ? (
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-8 text-center">
            <p className="text-sm text-[#86868b] dark:text-[#636366]">
              No devices have reported Ollama status yet. Once your MDM deploys the script and
              extensions start phoning home, device health will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Device</th>
                  <th className="px-4 py-2.5 font-medium">Platform</th>
                  <th className="px-4 py-2.5 font-medium">Ollama</th>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {deviceStatuses.map((d) => (
                  <tr key={d.userId} className="border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                    <td className="px-4 py-2.5 text-[#1d1d1f] dark:text-[#f5f5f7]">{d.email ?? d.userId.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-[#86868b]">{d.platform ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {d.ollamaReachable ? (
                        <span className="text-green-600 dark:text-green-400">● Running</span>
                      ) : d.ollamaInstalled ? (
                        <span className="text-yellow-600 dark:text-yellow-400">● Installed, not running</span>
                      ) : (
                        <span className="text-[#86868b]">○ Not installed</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {d.modelPulled ? (
                        <span className="text-green-600 dark:text-green-400">✓</span>
                      ) : (
                        <span className="text-[#86868b]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[#86868b]">
                      {d.lastSeen ? new Date(d.lastSeen).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Help callout ──────────────────────────────────────────────────── */}
      <div className="bg-iron-50/60 dark:bg-iron-900/10 border border-iron-200/60 dark:border-iron-800/40 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-iron-800 dark:text-iron-200 mb-1">Need a walkthrough?</h3>
        <p className="text-[13px] text-iron-700/80 dark:text-iron-300/70 leading-relaxed">
          The full step-by-step runbook for each MDM platform lives at{' '}
          <a href="https://github.com/ssiddharthsoni-spec/irongate2/blob/main/docs/deployment/OLLAMA_MDM.md" target="_blank" rel="noopener noreferrer" className="text-iron-600 dark:text-iron-400 underline">
            docs/deployment/OLLAMA_MDM.md
          </a>. For implementation support, email{' '}
          <a href="mailto:support@irongate.ai" className="text-iron-600 dark:text-iron-400 underline">support@irongate.ai</a>.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function CodeBlock({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="relative">
      <pre className="bg-[#0a0a0a] dark:bg-[#000] text-[#f5f5f7] text-[12px] leading-relaxed p-4 rounded-lg overflow-x-auto border border-[#38383a]/60 font-mono">
        {text}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className={`absolute top-3 right-3 px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
          copied
            ? 'bg-green-600 text-white'
            : 'bg-white/10 hover:bg-white/20 text-white'
        }`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function DeployCard({ title, script, rawScriptUrl, copied, onCopy }: { title: string; script: string; rawScriptUrl: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</h3>
        <a
          href={rawScriptUrl}
          download
          className="text-[12px] text-iron-600 dark:text-iron-400 hover:underline font-medium"
        >
          Download raw script
        </a>
      </div>
      <CodeBlock text={script} copied={copied} onCopy={onCopy} />
    </div>
  );
}
