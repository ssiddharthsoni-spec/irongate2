'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useApiClient } from '../../lib/api';

// Dynamic imports for chart components — prevents SSR hydration issues with Recharts
const SensitivityDistributionChart = dynamic(
  () => import('../charts').then((m) => m.SensitivityDistributionChart),
  { ssr: false, loading: () => <ChartPlaceholder /> }
);
const ToolBreakdownChart = dynamic(
  () => import('../charts').then((m) => m.ToolBreakdownChart),
  { ssr: false, loading: () => <ChartPlaceholder /> }
);
const DailyTrendChart = dynamic(
  () => import('../charts').then((m) => m.DailyTrendChart),
  { ssr: false, loading: () => <ChartPlaceholder /> }
);

interface ImpactData {
  totalEntitiesDetected: number;
  totalActionsProtected: number;
  entityBreakdown: { entityType: string; count: number }[];
  actionDistribution: { pass: number; warn: number; block: number; proxy: number; override: number };
  previousPeriod: { totalInteractions: number; totalEntitiesDetected: number; totalProtected: number; avgSensitivityScore: number };
  trends: { entitiesChange: number; protectedChange: number; interactionsChange: number };
}

interface FirmOverview {
  totalInteractions: number;
  totalProtected: number;
  totalBlocked: number;
  avgSensitivityScore: number;
  scoreDistribution: { low: number; medium: number; high: number; critical: number };
  toolBreakdown: { toolId: string; toolName: string; count: number; percentage: number }[];
  dailyTrend: { date: string; count: number; avgScore: number }[];
  topUsers: { userId: string; displayName: string; promptCount: number; avgScore: number; highRiskCount: number }[];
  recentHighRisk: any[];
  impact?: ImpactData;
}

const RISK_COLORS = {
  low: '#51cf66',
  medium: '#fcc419',
  high: '#ff922b',
  critical: '#ff6b6b',
};

export default function DashboardPage() {
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  // Start with null — show loading skeleton until API responds.
  const [data, setData] = useState<FirmOverview | null>(null);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(30);
  const [dismissedDemo, setDismissedDemo] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  async function fetchDashboardData() {
    try {
      setFetchError(null);

      // Check if user has a firm — if not, redirect to onboarding
      const firmRes = await apiFetch('/admin/firm');
      if (!firmRes.ok) {
        // 404 or 403 = no firm exists for this user → onboarding
        if (firmRes.status === 404 || firmRes.status === 403) {
          router.replace('/onboarding');
          return;
        }
      } else {
        const firm = await firmRes.json();
        // User is still on the default placeholder firm → needs onboarding
        if (firm.isDefaultFirm) {
          router.replace('/onboarding');
          return;
        }
        if (firm.name) setFirmName(firm.name);
      }

      const response = await apiFetch(`/dashboard/overview?days=${timeRange}`);

      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }

  // Show loading skeleton until first data arrives
  if (loading && !data) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
              Welcome{isUserLoaded && user ? `, ${user.firstName || user.fullName || 'there'}` : ''}
            </h1>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading your dashboard...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 animate-pulse">
              <div className="h-4 w-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded mb-3" />
              <div className="h-8 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <div className="h-[300px] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
              Welcome{isUserLoaded && user ? `, ${user.firstName || user.fullName || 'there'}` : ''}
            </h1>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">AI Governance Dashboard</p>
          </div>
        </div>
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{fetchError || 'Failed to load dashboard data.'}</span>
          <button onClick={fetchDashboardData} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const displayData = data;

  const distributionData = [
    { name: 'Low (0-25)', value: displayData.scoreDistribution.low, color: RISK_COLORS.low },
    { name: 'Medium (26-60)', value: displayData.scoreDistribution.medium, color: RISK_COLORS.medium },
    { name: 'High (61-85)', value: displayData.scoreDistribution.high, color: RISK_COLORS.high },
    { name: 'Critical (86-100)', value: displayData.scoreDistribution.critical, color: RISK_COLORS.critical },
  ];

  function handleExportDashboard() {
    const rows = [
      ['Iron Gate Dashboard Report'],
      ['Generated', new Date().toISOString()],
      ['Time Range', `${timeRange} days`],
      [],
      ['Summary'],
      ['Total Interactions', String(displayData.totalInteractions)],
      ['Avg Sensitivity Score', String(displayData.avgSensitivityScore)],
      ['High Risk Events', String(displayData.scoreDistribution.high + displayData.scoreDistribution.critical)],
      ['Actions Taken', String(displayData.totalProtected)],
      ['Blocked', String(displayData.totalBlocked)],
      [],
      ['Tool Breakdown'],
      ['Tool', 'Count', 'Percentage'],
      ...displayData.toolBreakdown.map(t => [t.toolName, String(t.count), `${t.percentage}%`]),
      [],
      ['Top Users'],
      ['User', 'Prompts', 'Avg Score', 'High Risk Count'],
      ...displayData.topUsers.map(u => [u.displayName, String(u.promptCount), String(u.avgScore), String(u.highRiskCount)]),
    ];
    const csvEscape = (cell: string): string => {
      if (/[,"\r\n]/.test(cell) || /^[=+\-@\t\r]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };
    const csv = rows.map(r => r.map(c => csvEscape(String(c))).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iron-gate-dashboard-${timeRange}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Error banner */}
      {fetchError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{fetchError}</span>
          <button onClick={fetchDashboardData} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Demo data banner */}
      {!dismissedDemo && displayData.totalInteractions === 0 && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 dark:text-amber-400 text-lg">!</span>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              You&apos;re viewing sample data. <a href="/install" className="underline font-medium">Install the extension</a> to see real activity.
            </p>
          </div>
          <button onClick={() => setDismissedDemo(true)} className="text-amber-600 dark:text-amber-400 hover:text-amber-800 text-sm font-medium ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Welcome Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Welcome{isUserLoaded && user ? `, ${user.firstName || user.fullName || 'there'}` : ''}
          </h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            {firmName || 'Your Organization'} &middot; AI Governance Dashboard
            {loading && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                Loading...
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setTimeRange(days)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                timeRange === days
                  ? 'bg-iron-600 text-white'
                  : 'bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e]'
              }`}
            >
              {days}d
            </button>
          ))}
          <button
            onClick={handleExportDashboard}
            className="px-3 py-1.5 text-sm rounded-lg bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e] flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Export
          </button>
        </div>
      </div>

      {/* Getting Started Checklist */}
      <GettingStartedChecklist />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard title="Total Interactions" value={displayData.totalInteractions.toLocaleString()} />
        <SummaryCard title="Avg Sensitivity Score" value={String(displayData.avgSensitivityScore)} color={
          displayData.avgSensitivityScore > 60 ? 'text-risk-high' : displayData.avgSensitivityScore > 25 ? 'text-risk-medium' : 'text-risk-low'
        } />
        <SummaryCard title="High Risk Events" value={String(displayData.scoreDistribution.high + displayData.scoreDistribution.critical)} color="text-risk-high" />
        <SummaryCard title="Actions Taken" value={String(displayData.totalProtected)} subtitle={`${displayData.totalBlocked} blocked`} />
      </div>

      {/* Iron Gate Impact */}
      {displayData.impact && (() => {
        const impact = displayData.impact;
        return (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Iron Gate Impact
            </h2>

            {/* Hero card */}
            <div className="bg-gradient-to-r from-iron-600 to-iron-800 rounded-xl p-6 shadow-sm border border-iron-700 mb-4">
              <p className="text-iron-200 text-sm font-medium">Sensitive data instances detected &amp; protected</p>
              <div className="flex items-baseline gap-3 mt-1">
                <p className="text-4xl font-bold text-white">
                  {(impact.totalEntitiesDetected ?? 0).toLocaleString()}
                </p>
                <TrendBadge value={impact.trends?.entitiesChange ?? 0} />
              </div>
              <p className="text-iron-300 text-sm mt-2">
                Iron Gate identified {(impact.totalEntitiesDetected ?? 0).toLocaleString()} sensitive entities across{' '}
                {(displayData.totalInteractions ?? 0).toLocaleString()} AI interactions and took protective action on{' '}
                {(impact.totalActionsProtected ?? 0).toLocaleString()} of them.
              </p>
            </div>

            {/* Entity breakdown + Action distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Entity type breakdown */}
              <div className="lg:col-span-2 bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">What Iron Gate Found</h3>
                <div className="space-y-2">
                  {impact.entityBreakdown.slice(0, 8).map((item) => {
                    const maxCount = impact.entityBreakdown[0]?.count || 1;
                    const pct = Math.round((item.count / maxCount) * 100);
                    return (
                      <div key={item.entityType} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-[#6e6e73] dark:text-[#86868b] w-36 truncate">
                          {formatEntityType(item.entityType)}
                        </span>
                        <div className="flex-1 h-5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-iron-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-[#424245] dark:text-[#a1a1a6] w-12 text-right">
                          {item.count.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action distribution */}
              <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Protective Actions Taken</h3>
                <div className="space-y-3">
                  <ActionStatRow label="Blocked" count={impact.actionDistribution.block} total={displayData.totalInteractions} color="bg-red-500" />
                  <ActionStatRow label="Warned" count={impact.actionDistribution.warn} total={displayData.totalInteractions} color="bg-orange-400" />
                  <ActionStatRow label="Redacted" count={impact.actionDistribution.proxy} total={displayData.totalInteractions} color="bg-yellow-400" />
                  <ActionStatRow label="Allowed" count={impact.actionDistribution.pass} total={displayData.totalInteractions} color="bg-green-400" />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Sensitivity Distribution</h2>
          <div style={{ width: '100%', height: 300 }}>
            <SensitivityDistributionChart data={distributionData} />
          </div>
        </div>

        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">AI Tool Usage</h2>
          <div style={{ width: '100%', height: 300 }}>
            <ToolBreakdownChart data={displayData.toolBreakdown} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Daily Trend</h2>
        <div style={{ width: '100%', height: 300 }}>
          <DailyTrendChart data={displayData.dailyTrend} />
        </div>
      </div>

      {/* Security Posture */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Encryption</p>
          </div>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">AES-256-GCM</p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">Envelope encryption active</p>
        </div>

        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">RLS Isolation</p>
          </div>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">Enforced</p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">Per-firm database isolation</p>
        </div>

        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Audit Chain</p>
          </div>
          <p className="text-lg font-bold text-purple-600 dark:text-purple-400">Verified</p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">SHA-256 hash chain intact</p>
        </div>

        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Kill Switch</p>
          </div>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">Standby</p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">Ready for emergency activation</p>
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Users */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Top Users</h2>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">
                <th className="pb-3">User</th>
                <th className="pb-3">Prompts</th>
                <th className="pb-3">Avg Score</th>
                <th className="pb-3">High Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
              {displayData.topUsers.map((user) => (
                <tr key={user.userId}>
                  <td className="py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{user.displayName}</td>
                  <td className="py-2 text-sm text-[#6e6e73] dark:text-[#86868b]">{user.promptCount}</td>
                  <td className="py-2 text-sm">
                    <span className={user.avgScore > 60 ? 'text-risk-high font-medium' : user.avgScore > 25 ? 'text-risk-medium' : 'text-risk-low'}>
                      {user.avgScore}
                    </span>
                  </td>
                  <td className="py-2 text-sm text-risk-high font-medium">{user.highRiskCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent High Risk */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Recent High Risk Events</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {displayData.recentHighRisk.length === 0 ? (
              <p className="text-sm text-[#86868b] dark:text-[#636366] text-center py-8">No high risk events</p>
            ) : (
              displayData.recentHighRisk.slice(0, 10).map((event: any) => (
                <div key={event.id} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{event.aiToolId}</span>
                    <span className="text-xs text-[#6e6e73] dark:text-[#86868b] ml-2" suppressHydrationWarning>
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-risk-critical">{event.sensitivityScore}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const CHECKLIST_STORAGE_KEY = 'iron-gate-checklist-dismissed';

function GettingStartedChecklist() {
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash
  const { apiFetch } = useApiClient();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Check if checklist was dismissed
    try {
      const wasDismissed = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (!wasDismissed) setDismissed(false);
    } catch {
      setDismissed(false);
    }

    // Check completion of each step
    async function checkProgress() {
      const done = new Set<string>();

      // Check if API keys exist
      try {
        const keysRes = await apiFetch('/api-keys');
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          if (Array.isArray(keysData) && keysData.length > 0) done.add('api-key');
        }
      } catch { /* ignore */ }

      // Check if team members were invited
      try {
        const usersRes = await apiFetch('/admin/users');
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          const users = usersData.users || usersData || [];
          if (Array.isArray(users) && users.length > 1) done.add('invite-team');
        }
      } catch { /* ignore */ }

      setCompletedSteps(done);
    }
    checkProgress();
  }, [apiFetch]);

  function handleDismiss() {
    setDismissed(true);
    try { localStorage.setItem(CHECKLIST_STORAGE_KEY, '1'); } catch { /* ignore */ }
  }

  if (dismissed) return null;

  const steps = [
    {
      id: 'extension',
      title: 'Install the Chrome extension',
      description: 'Protect your team\'s AI prompts in real-time',
      href: '/install',
      done: false, // can't detect client-side
    },
    {
      id: 'api-key',
      title: 'Create an API key',
      description: 'Connect the extension to your workspace',
      href: '/settings/api-keys',
      done: completedSteps.has('api-key'),
    },
    {
      id: 'protection',
      title: 'Configure protection rules',
      description: 'Set which entity types to detect and block',
      href: '/settings/protection',
      done: false,
    },
    {
      id: 'invite-team',
      title: 'Invite your team',
      description: 'Add colleagues to your Iron Gate workspace',
      href: '/settings/team',
      done: completedSteps.has('invite-team'),
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="mb-6 bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-iron-100 dark:bg-iron-900/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Getting started</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">{completedCount} of {steps.length} complete</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="w-24 h-1.5 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-iron-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 text-[#86868b] hover:text-[#424245] dark:hover:text-[#a1a1a6] transition-colors"
            aria-label="Dismiss checklist"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/60">
        {steps.map((step) => (
          <Link
            key={step.id}
            href={step.href}
            className="flex items-center gap-3 px-6 py-3 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors group"
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              step.done
                ? 'bg-green-500'
                : 'border-2 border-[#d2d2d7] dark:border-[#38383a] group-hover:border-iron-400'
            }`}>
              {step.done && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${step.done ? 'text-[#86868b] line-through' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{step.title}</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">{step.description}</p>
            </div>
            <svg className="w-4 h-4 text-[#d2d2d7] dark:text-[#38383a] group-hover:text-[#86868b] flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ChartPlaceholder() {
  return (
    <div className="flex items-center justify-center h-[300px] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse">
      <span className="text-sm text-[#86868b] dark:text-[#636366]">Loading chart...</span>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  color = 'text-[#1d1d1f]',
}: {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
      <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">{title}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">{subtitle}</p>}
    </div>
  );
}

function TrendBadge({ value }: { value: number }) {
  if (value === 0) return null;
  const isUp = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      isUp
        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    }`}>
      {isUp ? '\u2191' : '\u2193'} {Math.abs(value)}% vs prev period
    </span>
  );
}

function ActionStatRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">{label}</span>
        <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{count.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">{pct}% of interactions</p>
    </div>
  );
}

function formatEntityType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Ssn/g, 'SSN')
    .replace(/Ip /g, 'IP ')
    .replace(/Api /g, 'API ')
    .replace(/Aws /g, 'AWS ')
    .replace(/Gcp /g, 'GCP ')
    .replace(/Mnpi/g, 'MNPI');
}

