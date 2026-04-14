'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApiClient } from '../../../lib/api';

/* -- Types ----------------------------------------------------------------- */

interface VersionBucket {
  version: string;
  count: number;
}

interface StaleExtension {
  userId: string;
  lastSeen: string;
  version: string;
}

interface DeploymentHealth {
  total_extensions: number;
  active_last_24h: number;
  active_last_7d: number;
  version_distribution: VersionBucket[];
  stale_extensions: StaleExtension[];
}

/* -- Helpers --------------------------------------------------------------- */

const AUTO_REFRESH_MS = 60_000;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

type HealthStatus = 'healthy' | 'degraded' | 'critical';

function computeStatus(total: number, active24h: number): HealthStatus {
  if (total === 0) return 'healthy';
  const pct = (active24h / total) * 100;
  if (pct >= 80) return 'healthy';
  if (pct >= 50) return 'degraded';
  return 'critical';
}

const STATUS_CONFIG: Record<HealthStatus, { label: string; dot: string; bg: string; text: string }> = {
  healthy: {
    label: 'Healthy',
    dot: 'bg-green-500',
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-400',
  },
  degraded: {
    label: 'Degraded',
    dot: 'bg-yellow-500',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    text: 'text-yellow-700 dark:text-yellow-400',
  },
  critical: {
    label: 'Critical',
    dot: 'bg-red-500',
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-400',
  },
};

/* -- Page ------------------------------------------------------------------ */

export default function DeploymentHealthPage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<DeploymentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await apiFetch('/admin/deployment/health', { signal });
      if (res.status === 404) throw new Error('NOT_FOUND');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load deployment health.');
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, [apiFetch]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);

    const interval = setInterval(() => {
      fetchData();
    }, AUTO_REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchData]);

  function handleSendReminder(userId: string) {
    setReminderSent((prev) => new Set(prev).add(userId));
  }

  /* -- Loading skeleton ---------------------------------------------------- */

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="h-8 w-64 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse mb-8" />
        <div className="h-64 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
          <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
          <span>/</span>
          <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Deployment Health</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Deployment Health</h1>
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{error || 'Failed to load deployment health.'}</span>
          <button onClick={() => fetchData()} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    total_extensions,
    active_last_24h,
    active_last_7d,
    version_distribution,
    stale_extensions,
  } = data;

  const staleCount = total_extensions - active_last_7d;
  const status = computeStatus(total_extensions, active_last_24h);
  const statusCfg = STATUS_CONFIG[status];
  const maxVersionCount = Math.max(...version_distribution.map((v) => v.count), 1);

  const statCards = [
    {
      label: 'Total Installed',
      value: total_extensions.toLocaleString(),
      sub: 'Extensions deployed',
      color: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    },
    {
      label: 'Active (24h)',
      value: active_last_24h.toLocaleString(),
      sub: total_extensions > 0 ? `${Math.round((active_last_24h / total_extensions) * 100)}% of total` : '--',
      color: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Active (7d)',
      value: active_last_7d.toLocaleString(),
      sub: total_extensions > 0 ? `${Math.round((active_last_7d / total_extensions) * 100)}% of total` : '--',
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Stale (7d+)',
      value: staleCount.toLocaleString(),
      sub: staleCount === 0 ? 'All extensions active' : `${staleCount} need attention`,
      color: staleCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    },
  ];

  /* -- Render -------------------------------------------------------------- */

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Deployment Health</span>
      </nav>

      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Deployment Health</h1>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>
              <span className={`w-2 h-2 rounded-full ${statusCfg.dot} animate-pulse`} />
              {statusCfg.label}
            </span>
          </div>
          <p className="text-[#6e6e73] dark:text-[#86868b] text-sm mt-1">
            Monitor extension rollout, adoption, and version distribution across your organization.
          </p>
        </div>
        {lastUpdated && (
          <p className="text-[12px] text-[#86868b] whitespace-nowrap tabular-nums">
            Last updated: {formatTimestamp(lastUpdated)}
          </p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60"
          >
            <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">{card.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
            <p className="text-[11px] text-[#86868b] mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Version distribution */}
      {version_distribution.length > 0 && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 mb-8">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Version Distribution</h2>
          <p className="text-[12px] text-[#86868b] mb-5">
            {version_distribution.length} version{version_distribution.length !== 1 ? 's' : ''} detected across {total_extensions} installations
          </p>
          <div className="space-y-3">
            {version_distribution.map((v, i) => {
              const pct = Math.round((v.count / total_extensions) * 100);
              const barWidth = Math.max((v.count / maxVersionCount) * 100, 2);
              const isLatest = i === 0;
              return (
                <div key={v.version} className="flex items-center gap-4">
                  <div className="w-16 shrink-0 text-right">
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                      v{v.version}
                    </span>
                  </div>
                  <div className="flex-1 h-7 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-md overflow-hidden relative">
                    <div
                      className={`h-full rounded-md transition-all duration-500 ${
                        isLatest
                          ? 'bg-iron-600 dark:bg-iron-500'
                          : 'bg-[#86868b]/30 dark:bg-[#48484a]'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="w-20 shrink-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                      {v.count}
                    </span>
                    <span className="text-[11px] text-[#86868b] tabular-nums">
                      ({pct}%)
                    </span>
                  </div>
                  {isLatest && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-iron-600 dark:text-iron-400 bg-iron-600/10 dark:bg-iron-400/10 px-1.5 py-0.5 rounded">
                      Latest
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* One-Click MDM Deploy */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-8">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">One-Click MDM Deploy</h2>
              <p className="text-[12px] text-[#86868b] mt-0.5">
                Connect your MDM once, deploy to any device group with a single click. No policy JSON, no menu navigation.
              </p>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 whitespace-nowrap">Recommended</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
          {([
            {
              name: 'Google Workspace',
              href: '/admin/deployment/google-workspace',
              description: 'OAuth-based push. Works with managed Chrome on any OS.',
              color: 'bg-blue-50 dark:bg-blue-900/20',
              iconColor: 'text-blue-600 dark:text-blue-400',
              icon: (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              ),
            },
            {
              name: 'Microsoft Intune',
              href: '/admin/deployment/microsoft-intune',
              description: 'OAuth-based push. Uses Microsoft Graph API for Windows + macOS fleets.',
              color: 'bg-sky-50 dark:bg-sky-900/20',
              iconColor: 'text-sky-600 dark:text-sky-400',
              icon: (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="2" y="2" width="9" height="9" rx="0.5" />
                  <rect x="13" y="2" width="9" height="9" rx="0.5" opacity="0.8" />
                  <rect x="2" y="13" width="9" height="9" rx="0.5" opacity="0.8" />
                  <rect x="13" y="13" width="9" height="9" rx="0.5" opacity="0.6" />
                </svg>
              ),
            },
            {
              name: 'Jamf Pro',
              href: '/admin/deployment/jamf-pro',
              description: 'API-based push with your Jamf client credentials. macOS fleets.',
              color: 'bg-purple-50 dark:bg-purple-900/20',
              iconColor: 'text-purple-600 dark:text-purple-400',
              icon: (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
          ] as const).map((provider) => (
            <Link
              key={provider.name}
              href={provider.href}
              className="flex flex-col p-5 rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-700 transition-colors group bg-white dark:bg-[#1c1c1e]"
            >
              <div className={`w-12 h-12 rounded-xl ${provider.color} flex items-center justify-center mb-3 ${provider.iconColor}`}>
                {provider.icon}
              </div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1 group-hover:text-iron-600 dark:group-hover:text-iron-400 transition-colors">
                {provider.name}
              </h3>
              <p className="text-[11px] text-[#86868b] leading-relaxed mb-3">{provider.description}</p>
              <div className="mt-auto flex items-center gap-1 text-[11px] font-medium text-iron-600 dark:text-iron-400">
                Open wizard
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* MDM Deployment Profiles (legacy — manual download + paste) */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-8">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Manual MDM Deployment Profiles</h2>
          <p className="text-[12px] text-[#86868b] mt-0.5">
            Prefer to paste policy JSON manually? Download pre-configured profiles for each MDM.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
          {([
            {
              name: 'Microsoft Intune',
              description: 'Windows & macOS policy for Chrome extension force-install via Intune.',
              icon: (
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1" className="fill-blue-500" />
                  <rect x="13" y="3" width="8" height="8" rx="1" className="fill-blue-400" />
                  <rect x="3" y="13" width="8" height="8" rx="1" className="fill-blue-400" />
                  <rect x="13" y="13" width="8" height="8" rx="1" className="fill-blue-300" />
                </svg>
              ),
              filename: 'irongate-intune-profile.json',
            },
            {
              name: 'JAMF Pro',
              description: 'macOS configuration profile for Chrome extension deployment via JAMF.',
              icon: (
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" className="stroke-[#1d1d1f] dark:stroke-[#f5f5f7]" strokeWidth="2" />
                  <path d="M8 12l3 3 5-5" className="stroke-[#1d1d1f] dark:stroke-[#f5f5f7]" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
              filename: 'irongate-jamf-profile.mobileconfig',
            },
            {
              name: 'Workspace ONE',
              description: 'VMware Workspace ONE (AirWatch) profile for Chrome extension management.',
              icon: (
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M4 8l8-4 8 4-8 4-8-4z" className="fill-green-500" />
                  <path d="M4 12l8 4 8-4" className="stroke-green-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16l8 4 8-4" className="stroke-green-300" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
              filename: 'irongate-ws1-profile.json',
            },
          ] as const).map((mdm) => (
            <div key={mdm.name} className="flex flex-col items-center text-center p-5 rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-700 transition-colors">
              <div className="mb-3">{mdm.icon}</div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{mdm.name}</h3>
              <p className="text-[11px] text-[#86868b] mb-4 leading-relaxed">{mdm.description}</p>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify({
                    name: 'Iron Gate Browser Extension',
                    extensionId: 'irongate-extension-id',
                    installationType: 'force_installed',
                    updateUrl: 'https://clients2.google.com/service/update2/crx',
                    mdmPlatform: mdm.name,
                    generatedAt: new Date().toISOString(),
                  }, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = mdm.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="mt-auto px-4 py-2 text-xs font-medium rounded-lg border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                Download Profile
              </button>
            </div>
          ))}
        </div>
        <div className="px-6 pb-5">
          <p className="text-[11px] text-[#86868b]">
            Profiles include the Chrome extension ID and force-install policy. Customize the JSON before uploading to your MDM console. See <a href="https://docs.irongate.ai/mdm" target="_blank" rel="noopener noreferrer" className="text-iron-600 dark:text-iron-400 underline">MDM deployment docs</a> for step-by-step guides.
          </p>
        </div>
      </div>

      {/* Ollama deployment wizard link */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-8">
        <div className="px-6 py-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-iron-50 dark:bg-iron-900/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Org-wide Ollama deployment</h2>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">Optional</span>
            </div>
            <p className="text-[13px] text-[#86868b] dark:text-[#636366] mb-3 leading-relaxed">
              Enable Tier 2 local-LLM detection on every managed device via your MDM in ~15 minutes.
              Generate install scripts + policy in the wizard — no per-device setup.
            </p>
            <Link
              href="/admin/deployment/ollama"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-iron-600 dark:text-iron-400 hover:text-iron-700 dark:hover:text-iron-300 transition-colors"
            >
              Open wizard
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* Stale extensions table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Stale Extensions</h2>
          <p className="text-[12px] text-[#86868b] mt-0.5">
            {stale_extensions.length} extension{stale_extensions.length !== 1 ? 's' : ''} inactive for 7+ days
          </p>
        </div>

        {stale_extensions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              All extensions are active. Nothing to show here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] font-medium text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Last Seen</th>
                  <th className="px-6 py-3">Days Inactive</th>
                  <th className="px-6 py-3">Version</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                {stale_extensions.map((ext) => {
                  const inactive = daysAgo(ext.lastSeen);
                  const sent = reminderSent.has(ext.userId);
                  return (
                    <tr key={ext.userId} className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                      <td className="px-6 py-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] font-mono text-xs">
                        {ext.userId}
                      </td>
                      <td className="px-6 py-3 text-[#6e6e73] dark:text-[#86868b]">
                        {formatDate(ext.lastSeen)}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                          inactive >= 14
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                            : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400'
                        }`}>
                          {inactive}d
                        </span>
                      </td>
                      <td className="px-6 py-3 text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                        v{ext.version}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => handleSendReminder(ext.userId)}
                          disabled={sent}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
                            sent
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 cursor-default'
                              : 'bg-iron-600 hover:bg-iron-700 text-white'
                          }`}
                        >
                          {sent ? 'Reminder Sent' : 'Send Reminder'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
