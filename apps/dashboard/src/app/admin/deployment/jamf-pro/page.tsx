'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

/**
 * Jamf Pro one-click deployment page.
 *
 * Unlike Google Workspace, Jamf Pro does not use user-redirect OAuth.
 * Instead, the customer admin provisions an API Role + API Client inside
 * their Jamf instance and pastes three values here:
 *
 *   1. Jamf Pro URL (e.g., https://sterling.jamfcloud.com)
 *   2. API Client ID
 *   3. API Client Secret
 *
 * On submit, IronGate verifies the credentials by exchanging them for a
 * short-lived bearer token and pinging a trivial endpoint, then encrypts
 * and stores them. Subsequent operations (list groups, deploy) fetch a
 * fresh access token on-demand via client_credentials — Jamf tokens
 * expire after ~30 min and there's no refresh token.
 */

interface ConnectionStatus {
  connected: boolean;
  jamfUrl?: string;
  jamfHost?: string;
  lastVerifiedAt?: string | null;
  connectedAt?: string;
}

interface ComputerGroup {
  id: number;
  name: string;
  isSmart: boolean;
}

interface FirmInfo {
  id: string;
  enrollmentCode?: string;
}

function JamfProPageContent() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');

  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [statusLoading, setStatusLoading] = useState(true);
  const [groups, setGroups] = useState<ComputerGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [firmInfo, setFirmInfo] = useState<FirmInfo | null>(null);

  // Connect form
  const [jamfUrl, setJamfUrl] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [clientSecret, setClientSecret] = useState<string>('');
  const [connecting, setConnecting] = useState<boolean>(false);

  // Deploy form
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [extensionId, setExtensionId] = useState<string>('');
  const [enableOllama, setEnableOllama] = useState<boolean>(false);
  const [allowedTools, setAllowedTools] = useState<Set<string>>(
    new Set(['chatgpt', 'claude', 'gemini', 'copilot']),
  );

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    message: string;
    profileName: string;
    profileId: number;
  } | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      /* graceful — show not-connected */
    } finally {
      setStatusLoading(false);
    }
  }, [apiFetch]);

  const loadFirmInfo = useCallback(async () => {
    try {
      const res = await apiFetch('/admin/firm');
      if (res.ok) {
        const data = await res.json();
        setFirmInfo({ id: data.id, enrollmentCode: data.enrollmentCode });
      }
    } catch {
      /* ignore */
    }
  }, [apiFetch]);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/computer-groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data.computerGroups ?? []);
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to load groups' }));
        addToast({ type: 'error', message: err.error || 'Failed to load computer groups' });
      }
    } catch {
      addToast({ type: 'error', message: 'Failed to load computer groups' });
    } finally {
      setGroupsLoading(false);
    }
  }, [apiFetch, addToast]);

  useEffect(() => {
    loadStatus();
    loadFirmInfo();
  }, [loadStatus, loadFirmInfo]);

  useEffect(() => {
    if (status.connected) loadGroups();
  }, [status.connected, loadGroups]);

  useEffect(() => {
    if (errorParam) {
      addToast({ type: 'error', message: `Connection failed: ${errorParam}` });
    }
  }, [errorParam, addToast]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!jamfUrl.trim() || !clientId.trim() || !clientSecret) {
      addToast({ type: 'error', message: 'All three fields are required.' });
      return;
    }
    if (!/^https:\/\//i.test(jamfUrl.trim())) {
      addToast({ type: 'error', message: 'Jamf URL must start with https://' });
      return;
    }

    setConnecting(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/connect', {
        method: 'POST',
        body: JSON.stringify({
          jamfUrl: jamfUrl.trim(),
          clientId: clientId.trim(),
          clientSecret,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast({
          type: 'success',
          message: `Jamf Pro connected${data.jamfVersion ? ` (v${data.jamfVersion})` : ''}`,
        });
        // Clear the secret out of memory once we've successfully stored it.
        setClientSecret('');
        await loadStatus();
      } else {
        addToast({ type: 'error', message: data.error || 'Failed to connect' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setConnecting(false);
    }
  }

  async function handleTestConnection() {
    addToast({ type: 'success', message: 'Testing connection...' });
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/computer-groups');
      if (res.ok) {
        const data = await res.json();
        const groupCount = data.groups?.length ?? data.computerGroups?.length ?? 0;
        addToast({
          type: 'success',
          message: `Connection healthy — ${groupCount} computer group${groupCount === 1 ? '' : 's'} accessible.`,
        });
        await loadGroups();
        await loadStatus();
      } else {
        const err = await res.json().catch(() => ({ error: 'Connection test failed' }));
        addToast({ type: 'error', message: `Connection failed: ${err.error || res.status}` });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error during connection test' });
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Jamf Pro? Existing configuration profiles in Jamf stay in place — this only removes IronGate's ability to push further policy updates.",
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus({ connected: false });
        setGroups([]);
        setJamfUrl('');
        setClientId('');
        setClientSecret('');
        addToast({ type: 'success', message: 'Jamf Pro disconnected' });
      } else {
        addToast({ type: 'error', message: 'Failed to disconnect' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error' });
    }
  }

  async function handleDeploy() {
    if (!selectedGroupId || !extensionId || !firmInfo?.enrollmentCode) {
      addToast({ type: 'error', message: 'Please fill all required fields' });
      return;
    }
    setDeploying(true);
    setDeployResult(null);
    try {
      const res = await apiFetch('/admin/mdm-oauth/jamf/deploy', {
        method: 'POST',
        body: JSON.stringify({
          groupId: selectedGroupId,
          extensionId,
          enrollmentCode: firmInfo.enrollmentCode,
          allowedAITools: Array.from(allowedTools),
          deploymentMode: 'local-only',
          enableOllama,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDeployResult({
          message: data.message,
          profileName: data.profileName,
          profileId: data.profileId,
        });
        addToast({ type: 'success', message: `Deployed to group ${selectedGroupId}` });
      } else {
        addToast({ type: 'error', message: data.error || 'Deployment failed' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error during deployment' });
    } finally {
      setDeploying(false);
    }
  }

  function toggleTool(t: string) {
    const next = new Set(allowedTools);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setAllowedTools(next);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
        <span>/</span>
        <Link href="/admin/deployment" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Deployment</Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Jamf Pro</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Jamf Pro — One-Click Deploy</h1>
        <p className="text-[#6e6e73] dark:text-[#86868b] text-sm leading-relaxed max-w-2xl">
          Connect your Jamf Pro instance once. IronGate creates a scoped
          configuration profile that force-installs the Chrome extension
          and pushes firm policy to every Mac in the target computer group —
          no XML copy-paste, no Jamf menus.
        </p>
      </div>

      {/* ── Connection state ─────────────────────────────────────────────── */}
      <section className="mb-10">
        {statusLoading ? (
          <div className="h-24 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        ) : status.connected ? (
          <div className="rounded-xl border border-green-200/60 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">Connected</h3>
                </div>
                <p className="text-[13px] text-green-700/80 dark:text-green-300/70">
                  <strong>{status.jamfHost || status.jamfUrl}</strong>
                </p>
                {status.connectedAt && (
                  <p className="text-[11px] text-green-700/60 dark:text-green-300/50 mt-1">
                    Connected {new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-green-600/30 dark:border-green-400/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors"
                >
                  Test connection
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-white dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 bg-white dark:bg-[#1c1c1e] p-8">
            <div className="max-w-lg mx-auto">
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1 text-center">Connect Jamf Pro</h3>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6 text-center">
                In Jamf, create an API Role named &ldquo;IronGate&rdquo; with permissions to read
                computer groups and manage OS X configuration profiles, then create an
                API Client bound to that role. Paste the three values below.{' '}
                <a
                  href="https://github.com/ssiddharthsoni-spec/irongate2/blob/main/docs/deployment/JAMF_ONECLICK.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-iron-600 dark:text-iron-400 underline"
                >
                  Step-by-step guide
                </a>
              </p>

              <form onSubmit={handleConnect} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                    Jamf Pro URL
                  </label>
                  <input
                    type="url"
                    required
                    value={jamfUrl}
                    onChange={(e) => setJamfUrl(e.target.value)}
                    placeholder="https://yourcompany.jamfcloud.com"
                    className="w-full px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#1c1c1e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-mono"
                  />
                  <p className="text-[11px] text-[#86868b] mt-1">
                    Must start with https://. Trailing slash is optional.
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                    API Client ID
                  </label>
                  <input
                    type="text"
                    required
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="e.g., 3c5b1a6f-..."
                    autoComplete="off"
                    className="w-full px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#1c1c1e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                    API Client Secret
                  </label>
                  <input
                    type="password"
                    required
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Paste the secret shown when you generated the client"
                    autoComplete="new-password"
                    className="w-full px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#1c1c1e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-mono"
                  />
                  <p className="text-[11px] text-[#86868b] mt-1">
                    Encrypted at rest. Never displayed back in the UI. If you lose it, regenerate the client secret in Jamf.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={connecting}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-iron-600 hover:bg-iron-700 disabled:bg-[#d2d2d7] dark:disabled:bg-[#38383a] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
                >
                  {connecting ? 'Verifying...' : 'Connect Jamf Pro'}
                </button>
              </form>
            </div>
          </div>
        )}
      </section>

      {/* ── Deploy flow (only when connected) ────────────────────────────── */}
      {status.connected && !deployResult && (
        <section className="space-y-8">
          {/* Step 1: Pick computer group */}
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 1 — Pick a computer group</h2>
            <p className="text-[13px] text-[#86868b] mb-4">
              Start with a pilot group (e.g., &ldquo;IronGate Pilot&rdquo;). Smart groups that
              auto-populate by criteria work too. You can re-deploy to larger groups
              once the pilot is validated.
            </p>
            {groupsLoading ? (
              <div className="h-24 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
            ) : groups.length === 0 ? (
              <div className="text-sm text-[#86868b] p-4 rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-center">
                No computer groups found. Create at least one computer group in Jamf Pro first,
                or check that the API Role has the &ldquo;Read Computer Groups&rdquo; permission.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 p-2">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedGroupId === g.id
                        ? 'bg-iron-50 dark:bg-iron-900/20'
                        : 'hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="group"
                      value={g.id}
                      checked={selectedGroupId === g.id}
                      onChange={() => setSelectedGroupId(g.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{g.name}</div>
                      <div className="text-[11px] text-[#86868b] font-mono">
                        id: {g.id} · {g.isSmart ? 'smart group' : 'static group'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Policy config */}
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 2 — Configure the policy</h2>
            <p className="text-[13px] text-[#86868b] mb-4">
              These settings will be embedded in the Jamf configuration profile as the
              Chrome managed-policy payload.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  IronGate Chrome Web Store extension ID
                </label>
                <input
                  type="text"
                  value={extensionId}
                  onChange={(e) => setExtensionId(e.target.value)}
                  placeholder="e.g., abcdefghijklmnopqrstuvwxyzabcdef"
                  className="w-full px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#1c1c1e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-mono"
                />
                <p className="text-[11px] text-[#86868b] mt-1">
                  The 32-char extension ID from the IronGate Chrome Web Store listing. Ask IronGate support if unsure.
                </p>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Enrollment code
                </label>
                <div className="px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-mono">
                  {firmInfo?.enrollmentCode || <span className="text-[#86868b]">No code yet — create one in Admin → Enrollment Codes</span>}
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">Allowed AI tools</label>
                <div className="flex flex-wrap gap-2">
                  {['chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'deepseek', 'poe', 'groq', 'huggingface', 'you'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTool(t)}
                      className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                        allowedTools.has(t)
                          ? 'bg-iron-600 text-white'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableOllama}
                    onChange={(e) => setEnableOllama(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      Enable Tier 2 on-device LLM (Ollama)
                    </div>
                    <div className="text-[11px] text-[#86868b] mt-0.5">
                      Requires deploying Ollama separately — see{' '}
                      <Link href="/admin/deployment/ollama" className="text-iron-600 dark:text-iron-400 underline">
                        Ollama Setup
                      </Link>
                      . If you haven&apos;t set up Ollama yet, leave this off for now.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Step 3: Deploy */}
          <div className="pt-4 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <button
              type="button"
              onClick={handleDeploy}
              disabled={!selectedGroupId || !extensionId || !firmInfo?.enrollmentCode || deploying}
              className="w-full py-3 bg-iron-600 hover:bg-iron-700 disabled:bg-[#d2d2d7] dark:disabled:bg-[#38383a] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {deploying
                ? 'Deploying...'
                : `Deploy IronGate to ${
                    selectedGroupId
                      ? groups.find((g) => g.id === selectedGroupId)?.name ?? `group ${selectedGroupId}`
                      : '(select a group)'
                  }`}
            </button>
            <p className="text-[11px] text-[#86868b] text-center mt-3">
              Macs in the selected group will receive the profile on their next Jamf check-in (typically within 15 minutes).
            </p>
          </div>
        </section>
      )}

      {/* ── Deploy result ─────────────────────────────────────────────────── */}
      {deployResult && (
        <div className="rounded-xl border border-green-200/60 dark:border-green-900/40 bg-green-50/60 dark:bg-green-900/10 p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            <div>
              <h3 className="text-base font-semibold text-green-800 dark:text-green-200 mb-1">
                Profile created: {deployResult.profileName}
                {deployResult.profileId > 0 && (
                  <span className="text-[12px] font-normal text-green-700/70 dark:text-green-300/60 ml-2 font-mono">
                    (id: {deployResult.profileId})
                  </span>
                )}
              </h3>
              <p className="text-[13px] text-green-700/80 dark:text-green-300/70 leading-relaxed">{deployResult.message}</p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeployResult(null);
                    setSelectedGroupId(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-green-600/40 dark:border-green-400/40 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors"
                >
                  Deploy to another group
                </button>
                <Link
                  href="/admin/deployment"
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  View device health
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Help footer ───────────────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <p className="text-[12px] text-[#86868b]">
          Setting this up for the first time? See the{' '}
          <a
            href="https://github.com/ssiddharthsoni-spec/irongate2/blob/main/docs/deployment/JAMF_ONECLICK.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-iron-600 dark:text-iron-400 underline"
          >
            Jamf Pro One-Click Deploy runbook
          </a>
          . Support: <a href="mailto:support@irongate.ai" className="text-iron-600 dark:text-iron-400 underline">support@irongate.ai</a>
        </p>
      </div>
    </div>
  );
}

export default function JamfProPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-6 py-10"><div className="h-8 w-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded animate-pulse" /></div>}>
      <JamfProPageContent />
    </Suspense>
  );
}
