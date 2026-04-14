'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

/**
 * Google Workspace one-click deployment page.
 *
 * Flow:
 *   1. Admin clicks "Connect Google Workspace" → OAuth consent → callback
 *      saves encrypted tokens → returns here with ?connected=1
 *   2. Page fetches OUs via Directory API
 *   3. Admin picks an OU, configures policy (enrollment code, Ollama,
 *      allowed AI tools)
 *   4. Admin clicks "Deploy IronGate" → Chrome Policy API pushes the
 *      force-install + managed config
 *   5. Within 1-10 minutes, every Chrome in the OU auto-installs the
 *      extension and self-enrolls
 */

interface ConnectionStatus {
  connected: boolean;
  authorizedByEmail?: string;
  domain?: string;
  scopes?: string[];
  lastVerifiedAt?: string | null;
  connectedAt?: string;
}

interface OrgUnit {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
  description?: string;
}

interface FirmInfo {
  id: string;
  enrollmentCode?: string;
}

function GoogleWorkspacePageContent() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get('connected');
  const errorParam = searchParams.get('error');

  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [statusLoading, setStatusLoading] = useState(true);
  const [ous, setOus] = useState<OrgUnit[]>([]);
  const [ousLoading, setOusLoading] = useState(false);
  const [firmInfo, setFirmInfo] = useState<FirmInfo | null>(null);

  const [selectedOu, setSelectedOu] = useState<string>('');
  const [extensionId, setExtensionId] = useState<string>('');
  const [enableOllama, setEnableOllama] = useState<boolean>(false);
  const [allowedTools, setAllowedTools] = useState<Set<string>>(
    new Set(['chatgpt', 'claude', 'gemini', 'copilot']),
  );

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ message: string; orgUnitPath: string } | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/google/status');
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

  const loadOus = useCallback(async () => {
    setOusLoading(true);
    try {
      const res = await apiFetch('/admin/mdm-oauth/google/org-units');
      if (res.ok) {
        const data = await res.json();
        setOus(data.orgUnits ?? []);
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to load OUs' }));
        addToast({ type: 'error', message: err.error || 'Failed to load organizational units' });
      }
    } catch {
      addToast({ type: 'error', message: 'Failed to load organizational units' });
    } finally {
      setOusLoading(false);
    }
  }, [apiFetch, addToast]);

  useEffect(() => {
    loadStatus();
    loadFirmInfo();
  }, [loadStatus, loadFirmInfo]);

  useEffect(() => {
    if (status.connected) loadOus();
  }, [status.connected, loadOus]);

  // ── Toast on connect success/failure from OAuth callback ────────────────
  useEffect(() => {
    if (connectedParam === '1') {
      addToast({ type: 'success', message: 'Google Workspace connected successfully' });
    } else if (errorParam) {
      addToast({ type: 'error', message: `Connection failed: ${errorParam}` });
    }
  }, [connectedParam, errorParam, addToast]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleConnect() {
    try {
      const res = await apiFetch('/admin/mdm-oauth/google/initiate', { method: 'POST' });
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
    if (!confirm('Disconnect Google Workspace? Existing deployments stay in place — this only removes IronGate\'s ability to push further policy updates.')) {
      return;
    }
    try {
      const res = await apiFetch('/admin/mdm-oauth/google/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus({ connected: false });
        setOus([]);
        addToast({ type: 'success', message: 'Google Workspace disconnected' });
      } else {
        addToast({ type: 'error', message: 'Failed to disconnect' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error' });
    }
  }

  async function handleDeploy() {
    if (!selectedOu || !extensionId || !firmInfo?.enrollmentCode) {
      addToast({ type: 'error', message: 'Please fill all required fields' });
      return;
    }
    setDeploying(true);
    setDeployResult(null);
    try {
      const res = await apiFetch('/admin/mdm-oauth/google/deploy', {
        method: 'POST',
        body: JSON.stringify({
          orgUnitPath: selectedOu,
          extensionId,
          enrollmentCode: firmInfo.enrollmentCode,
          allowedAITools: Array.from(allowedTools),
          deploymentMode: 'local-only',
          enableOllama,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDeployResult({ message: data.message, orgUnitPath: data.orgUnitPath });
        addToast({ type: 'success', message: `Deployed to ${data.orgUnitPath}` });
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
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Google Workspace</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Google Workspace — One-Click Deploy</h1>
        <p className="text-[#6e6e73] dark:text-[#86868b] text-sm leading-relaxed max-w-2xl">
          Connect your Google Workspace once. IronGate pushes the Chrome extension
          force-install policy and firm configuration directly to your managed
          Chromes — no JSON copy-paste, no MDM menus.
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
                {status.connectedAt && (
                  <p className="text-[11px] text-green-700/60 dark:text-green-300/50 mt-1">
                    Connected {new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
              Connect your Google Workspace to push IronGate to managed Chromes without
              touching the Admin Console.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Connect Google Workspace
            </button>
            <p className="text-[11px] text-[#86868b] mt-4">
              You&apos;ll be redirected to Google for consent. Requires a Google Workspace admin account.
            </p>
          </div>
        )}
      </section>

      {/* ── Deploy flow (only when connected) ────────────────────────────── */}
      {status.connected && !deployResult && (
        <section className="space-y-8">
          {/* Step 1: Pick OU */}
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 1 — Pick an organizational unit</h2>
            <p className="text-[13px] text-[#86868b] mb-4">
              Start with a pilot OU (e.g., &ldquo;Litigation Team&rdquo;). You can re-deploy to
              larger OUs once the pilot is validated.
            </p>
            {ousLoading ? (
              <div className="h-24 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
            ) : ous.length === 0 ? (
              <div className="text-sm text-[#86868b] p-4 rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-center">
                No organizational units found. Create at least one OU in Google Admin Console first.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-xl border border-[#d2d2d7]/60 dark:border-[#38383a]/60 p-2">
                {ous.map((ou) => (
                  <label
                    key={ou.orgUnitId}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedOu === ou.orgUnitPath
                        ? 'bg-iron-50 dark:bg-iron-900/20'
                        : 'hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ou"
                      value={ou.orgUnitPath}
                      checked={selectedOu === ou.orgUnitPath}
                      onChange={() => setSelectedOu(ou.orgUnitPath)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{ou.name}</div>
                      <div className="text-[11px] text-[#86868b] font-mono">{ou.orgUnitPath}</div>
                      {ou.description && (
                        <div className="text-[12px] text-[#86868b] mt-0.5">{ou.description}</div>
                      )}
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
              These settings will be pushed to every Chrome in the selected OU as
              part of the IronGate managed policy.
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
              disabled={!selectedOu || !extensionId || !firmInfo?.enrollmentCode || deploying}
              className="w-full py-3 bg-iron-600 hover:bg-iron-700 disabled:bg-[#d2d2d7] dark:disabled:bg-[#38383a] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {deploying ? 'Deploying...' : `Deploy IronGate to ${selectedOu || '(select an OU)'}`}
            </button>
            <p className="text-[11px] text-[#86868b] text-center mt-3">
              Extensions will install on each device within 1-10 minutes as Chrome refreshes its policy.
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
                Deployed to {deployResult.orgUnitPath}
              </h3>
              <p className="text-[13px] text-green-700/80 dark:text-green-300/70 leading-relaxed">{deployResult.message}</p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeployResult(null);
                    setSelectedOu('');
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-green-600/40 dark:border-green-400/40 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors"
                >
                  Deploy to another OU
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
            href="https://github.com/ssiddharthsoni-spec/irongate2/blob/main/docs/deployment/GOOGLE_WORKSPACE_ONECLICK.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-iron-600 dark:text-iron-400 underline"
          >
            Google Workspace One-Click Deploy runbook
          </a>
          . Support: <a href="mailto:support@irongate.ai" className="text-iron-600 dark:text-iron-400 underline">support@irongate.ai</a>
        </p>
      </div>
    </div>
  );
}

export default function GoogleWorkspacePage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-6 py-10"><div className="h-8 w-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded animate-pulse" /></div>}>
      <GoogleWorkspacePageContent />
    </Suspense>
  );
}
