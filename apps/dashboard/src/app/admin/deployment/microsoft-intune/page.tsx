'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

/**
 * Microsoft Intune one-click deployment page.
 *
 * Flow:
 *   1. Admin clicks "Connect Microsoft Intune" → Microsoft OAuth consent →
 *      callback saves encrypted tokens → returns here with ?connected=1
 *   2. Page fetches Azure AD security groups via Graph API
 *   3. Admin picks a group, configures policy (enrollment code, Ollama,
 *      allowed AI tools)
 *   4. Admin clicks "Deploy IronGate" → Graph API creates a Settings Catalog
 *      configuration policy and assigns it to the group
 *   5. Within 15-60 minutes, every managed Chrome in the group auto-installs
 *      the extension and self-enrolls
 */

interface ConnectionStatus {
  connected: boolean;
  authorizedByEmail?: string;
  domain?: string;
  tenantId?: string;
  scopes?: string[];
  lastVerifiedAt?: string | null;
  connectedAt?: string;
}

interface AzureAdGroup {
  id: string;
  displayName: string;
  description?: string;
  mailNickname?: string;
  securityEnabled?: boolean;
}

interface FirmInfo {
  id: string;
  enrollmentCode?: string;
}

function MicrosoftIntunePageContent() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get('connected');
  const errorParam = searchParams.get('error');

  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [statusLoading, setStatusLoading] = useState(true);
  const [groups, setGroups] = useState<AzureAdGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [firmInfo, setFirmInfo] = useState<FirmInfo | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [extensionId, setExtensionId] = useState<string>('');
  const [enableOllama, setEnableOllama] = useState<boolean>(false);
  const [allowedTools, setAllowedTools] = useState<Set<string>>(
    new Set(['chatgpt', 'claude', 'gemini', 'copilot']),
  );

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    message: string;
    groupName?: string;
    groupId: string;
  } | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/intune/status');
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
      const res = await apiFetch('/admin/mdm-oauth/intune/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups ?? []);
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to load groups' }));
        addToast({ type: 'error', message: err.error || 'Failed to load Azure AD groups' });
      }
    } catch {
      addToast({ type: 'error', message: 'Failed to load Azure AD groups' });
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

  // ── Toast on connect success/failure from OAuth callback ────────────────
  useEffect(() => {
    if (connectedParam === '1') {
      addToast({ type: 'success', message: 'Microsoft Intune connected successfully' });
    } else if (errorParam) {
      addToast({ type: 'error', message: `Connection failed: ${errorParam}` });
    }
  }, [connectedParam, errorParam, addToast]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleConnect() {
    try {
      const res = await apiFetch('/admin/mdm-oauth/intune/initiate', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to start OAuth flow' }));
        addToast({ type: 'error', message: err.error || 'Failed to start OAuth flow' });
        return;
      }
      const { startUrl } = await res.json();
      window.location.href = startUrl;
    } catch {
      addToast({ type: 'error', message: 'Network error. Please try again.' });
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Microsoft Intune? Existing deployments stay in place — this only removes IronGate's ability to push further policy updates.",
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch('/admin/mdm-oauth/intune/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus({ connected: false });
        setGroups([]);
        addToast({ type: 'success', message: 'Microsoft Intune disconnected' });
      } else {
        addToast({ type: 'error', message: 'Failed to disconnect' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error' });
    }
  }

  async function handleDeploy() {
    const selected = groups.find((g) => g.id === selectedGroupId);
    if (!selectedGroupId || !extensionId || !firmInfo?.enrollmentCode) {
      addToast({ type: 'error', message: 'Please fill all required fields' });
      return;
    }
    setDeploying(true);
    setDeployResult(null);
    try {
      const res = await apiFetch('/admin/mdm-oauth/intune/deploy', {
        method: 'POST',
        body: JSON.stringify({
          groupId: selectedGroupId,
          groupName: selected?.displayName,
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
          groupName: data.groupName ?? selected?.displayName,
          groupId: data.groupId,
        });
        addToast({
          type: 'success',
          message: `Deployed to ${data.groupName ?? selected?.displayName ?? data.groupId}`,
        });
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

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
          Admin
        </Link>
        <span>/</span>
        <Link href="/admin/deployment" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
          Deployment
        </Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Microsoft Intune</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          Microsoft Intune — One-Click Deploy
        </h1>
        <p className="text-[#6e6e73] dark:text-[#86868b] text-sm leading-relaxed max-w-2xl">
          Connect your Microsoft Intune (Endpoint Manager) once. IronGate pushes the
          Chrome extension force-install policy and firm configuration directly to
          your managed Chromes — no JSON copy-paste, no Intune menus.
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
                  Authorized by <strong>{status.authorizedByEmail}</strong>
                  {status.domain && ` (${status.domain})`}
                </p>
                {status.tenantId && (
                  <p className="text-[11px] text-green-700/60 dark:text-green-300/50 mt-0.5 font-mono">
                    Tenant {status.tenantId}
                  </p>
                )}
                {status.connectedAt && (
                  <p className="text-[11px] text-green-700/60 dark:text-green-300/50 mt-1">
                    Connected{' '}
                    {new Date(status.connectedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-white dark:hover:bg-[#2c2c2e] transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 bg-white dark:bg-[#1c1c1e] p-8 text-center">
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Not connected</h3>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5 max-w-md mx-auto">
              Connect your Microsoft Intune tenant to push IronGate to managed Chromes
              without touching the Endpoint Manager console.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 23 23" fill="currentColor" aria-hidden="true">
                <path d="M1 1h10v10H1z" fill="#f35325" />
                <path d="M12 1h10v10H12z" fill="#81bc06" />
                <path d="M1 12h10v10H1z" fill="#05a6f0" />
                <path d="M12 12h10v10H12z" fill="#ffba08" />
              </svg>
              Connect Microsoft Intune
            </button>
            <p className="text-[11px] text-[#86868b] mt-4">
              You&apos;ll be redirected to Microsoft for admin consent. Requires an Intune / Global
              Administrator account.
            </p>
          </div>
        )}
      </section>

      {/* ── Deploy flow (only when connected) ────────────────────────────── */}
      {status.connected && !deployResult && (
        <section className="space-y-8">
          {/* Step 1: Pick group */}
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Step 1 — Pick an Azure AD security group
            </h2>
            <p className="text-[13px] text-[#86868b] mb-4">
              Start with a pilot group (e.g., &ldquo;Litigation Team&rdquo;). You can re-deploy
              to larger groups once the pilot is validated.
            </p>
            {groupsLoading ? (
              <div className="h-24 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
            ) : groups.length === 0 ? (
              <div className="text-sm text-[#86868b] p-4 rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-center">
                No Azure AD security groups found. Create at least one security group in Azure AD first.
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
                      name="aad-group"
                      value={g.id}
                      checked={selectedGroupId === g.id}
                      onChange={() => setSelectedGroupId(g.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {g.displayName}
                      </div>
                      <div className="text-[11px] text-[#86868b] font-mono">{g.id}</div>
                      {g.description && (
                        <div className="text-[12px] text-[#86868b] mt-0.5">{g.description}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Policy config */}
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Step 2 — Configure the policy
            </h2>
            <p className="text-[13px] text-[#86868b] mb-4">
              These settings will be pushed to every managed Chrome in the selected group
              as part of the IronGate managed policy.
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
                  {firmInfo?.enrollmentCode || (
                    <span className="text-[#86868b]">
                      No code yet — create one in Admin → Enrollment Codes
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
                  Allowed AI tools
                </label>
                <div className="flex flex-wrap gap-2">
                  {['chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'deepseek', 'poe', 'groq', 'huggingface', 'you'].map(
                    (t) => (
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
                    ),
                  )}
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
                      <Link
                        href="/admin/deployment/ollama"
                        className="text-iron-600 dark:text-iron-400 underline"
                      >
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
                : `Deploy IronGate to ${selectedGroup?.displayName || '(select a group)'}`}
            </button>
            <p className="text-[11px] text-[#86868b] text-center mt-3">
              Extensions will install on each device within 15-60 minutes as Intune and Chrome refresh their policies.
            </p>
          </div>
        </section>
      )}

      {/* ── Deploy result ─────────────────────────────────────────────────── */}
      {deployResult && (
        <div className="rounded-xl border border-green-200/60 dark:border-green-900/40 bg-green-50/60 dark:bg-green-900/10 p-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
            <div>
              <h3 className="text-base font-semibold text-green-800 dark:text-green-200 mb-1">
                Deployed to {deployResult.groupName ?? deployResult.groupId}
              </h3>
              <p className="text-[13px] text-green-700/80 dark:text-green-300/70 leading-relaxed">
                {deployResult.message}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeployResult(null);
                    setSelectedGroupId('');
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
            href="https://github.com/ssiddharthsoni-spec/irongate2/blob/main/docs/deployment/INTUNE_ONECLICK.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-iron-600 dark:text-iron-400 underline"
          >
            Microsoft Intune One-Click Deploy runbook
          </a>
          . Support:{' '}
          <a href="mailto:support@irongate.ai" className="text-iron-600 dark:text-iron-400 underline">
            support@irongate.ai
          </a>
        </p>
      </div>
    </div>
  );
}

export default function MicrosoftIntunePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="h-8 w-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded animate-pulse" />
        </div>
      }
    >
      <MicrosoftIntunePageContent />
    </Suspense>
  );
}
