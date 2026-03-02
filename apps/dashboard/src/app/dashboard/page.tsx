'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
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
  const { user, isLoaded: isUserLoaded } = useUser();
  // Start with demo data immediately — no loading/error state flash
  const [data, setData] = useState<FirmOverview>(getDemoData());
  const [firmName, setFirmName] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(30);

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  async function fetchDashboardData() {
    try {
      setSyncing(true);
      setFetchError(null);
      const response = await apiFetch(`/dashboard/overview?days=${timeRange}`);

      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
      setIsLive(true);

      // Fetch firm name if we don't have it yet
      if (!firmName) {
        apiFetch('/admin/firm').then(async (r) => {
          if (r.ok) {
            const firm = await r.json();
            if (firm.name) setFirmName(firm.name);
          }
        }).catch(() => {});
      }
    } catch {
      // API not available — keep using demo data
      setIsLive(false);
      setFetchError('Unable to connect to API. Showing demo data.');
    } finally {
      setSyncing(false);
    }
  }

  const distributionData = [
    { name: 'Low (0-25)', value: data.scoreDistribution.low, color: RISK_COLORS.low },
    { name: 'Medium (26-60)', value: data.scoreDistribution.medium, color: RISK_COLORS.medium },
    { name: 'High (61-85)', value: data.scoreDistribution.high, color: RISK_COLORS.high },
    { name: 'Critical (86-100)', value: data.scoreDistribution.critical, color: RISK_COLORS.critical },
  ];

  function handleExportDashboard() {
    const rows = [
      ['Iron Gate Dashboard Report'],
      ['Generated', new Date().toISOString()],
      ['Time Range', `${timeRange} days`],
      [],
      ['Summary'],
      ['Total Interactions', String(data.totalInteractions)],
      ['Avg Sensitivity Score', String(data.avgSensitivityScore)],
      ['High Risk Events', String(data.scoreDistribution.high + data.scoreDistribution.critical)],
      ['Actions Taken', String(data.totalProtected)],
      ['Blocked', String(data.totalBlocked)],
      [],
      ['Tool Breakdown'],
      ['Tool', 'Count', 'Percentage'],
      ...data.toolBreakdown.map(t => [t.toolName, String(t.count), `${t.percentage}%`]),
      [],
      ['Top Users'],
      ['User', 'Prompts', 'Avg Score', 'High Risk Count'],
      ...data.topUsers.map(u => [u.displayName, String(u.promptCount), String(u.avgScore), String(u.highRiskCount)]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
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
      {/* Demo data banner */}
      {!isLive && !syncing && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3">
          <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
            <span className="font-medium">Demo Mode</span> — Showing sample data. {fetchError || 'Connect your API to see live metrics.'}
          </p>
          <button
            onClick={fetchDashboardData}
            className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline flex-shrink-0"
          >
            Retry
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
            {syncing && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                Syncing...
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard title="Total Interactions" value={data.totalInteractions.toLocaleString()} />
        <SummaryCard title="Avg Sensitivity Score" value={String(data.avgSensitivityScore)} color={
          data.avgSensitivityScore > 60 ? 'text-risk-high' : data.avgSensitivityScore > 25 ? 'text-risk-medium' : 'text-risk-low'
        } />
        <SummaryCard title="High Risk Events" value={String(data.scoreDistribution.high + data.scoreDistribution.critical)} color="text-risk-high" />
        <SummaryCard title="Actions Taken" value={String(data.totalProtected)} subtitle={`${data.totalBlocked} blocked`} />
      </div>

      {/* Iron Gate Impact */}
      {(() => {
        const impact = data.impact || getDemoImpactData();
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
                {(data.totalInteractions ?? 0).toLocaleString()} AI interactions and took protective action on{' '}
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
                  <ActionStatRow label="Blocked" count={impact.actionDistribution.block} total={data.totalInteractions} color="bg-red-500" />
                  <ActionStatRow label="Warned" count={impact.actionDistribution.warn} total={data.totalInteractions} color="bg-orange-400" />
                  <ActionStatRow label="Redacted" count={impact.actionDistribution.proxy} total={data.totalInteractions} color="bg-yellow-400" />
                  <ActionStatRow label="Allowed" count={impact.actionDistribution.pass} total={data.totalInteractions} color="bg-green-400" />
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
            <ToolBreakdownChart data={data.toolBreakdown} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Daily Trend</h2>
        <div style={{ width: '100%', height: 300 }}>
          <DailyTrendChart data={data.dailyTrend} />
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
              {data.topUsers.map((user) => (
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
            {data.recentHighRisk.length === 0 ? (
              <p className="text-sm text-[#86868b] dark:text-[#636366] text-center py-8">No high risk events</p>
            ) : (
              data.recentHighRisk.slice(0, 10).map((event: any) => (
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

function getDemoImpactData(): ImpactData {
  return {
    totalEntitiesDetected: 4283,
    totalActionsProtected: 632,
    entityBreakdown: [
      { entityType: 'PERSON', count: 1247 },
      { entityType: 'EMAIL', count: 834 },
      { entityType: 'ORGANIZATION', count: 621 },
      { entityType: 'SSN', count: 312 },
      { entityType: 'MONETARY_AMOUNT', count: 289 },
      { entityType: 'PHONE_NUMBER', count: 245 },
      { entityType: 'CREDIT_CARD', count: 178 },
      { entityType: 'MATTER_NUMBER', count: 156 },
      { entityType: 'PRIVILEGE_MARKER', count: 134 },
      { entityType: 'API_KEY', count: 98 },
      { entityType: 'DEAL_CODENAME', count: 87 },
      { entityType: 'MEDICAL_RECORD', count: 82 },
    ],
    actionDistribution: { pass: 2215, warn: 412, block: 143, proxy: 77, override: 0 },
    previousPeriod: {
      totalInteractions: 2341,
      totalEntitiesDetected: 3512,
      totalProtected: 498,
      avgSensitivityScore: 38.2,
    },
    trends: {
      entitiesChange: 22,
      protectedChange: 27,
      interactionsChange: 22,
    },
  };
}

function getDemoData(): FirmOverview {
  return {
    totalInteractions: 2847,
    totalProtected: 187,
    totalBlocked: 43,
    avgSensitivityScore: 41.7,
    scoreDistribution: { low: 1123, medium: 956, high: 534, critical: 234 },
    toolBreakdown: [
      { toolId: 'chatgpt', toolName: 'ChatGPT', count: 1281, percentage: 45 },
      { toolId: 'claude', toolName: 'Claude', count: 741, percentage: 26 },
      { toolId: 'gemini', toolName: 'Gemini', count: 427, percentage: 15 },
      { toolId: 'copilot', toolName: 'Copilot', count: 285, percentage: 10 },
      { toolId: 'perplexity', toolName: 'Perplexity', count: 113, percentage: 4 },
    ],
    dailyTrend: Array.from({ length: 30 }, (_, i) => {
      // Use a fixed base to avoid SSR/client hydration mismatch from Date.now()
      const base = new Date('2026-02-20T00:00:00Z').getTime();
      const dayOfWeek = new Date(base - (29 - i) * 86400000).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const baseCount = isWeekend ? 40 : 95;
      const baseScore = isWeekend ? 22 : 38;
      const countSeed = ((i * 7 + 13) % 50);
      const scoreSeed = ((i * 11 + 7) % 20);
      return {
        date: new Date(base - (29 - i) * 86400000).toISOString().split('T')[0],
        count: baseCount + countSeed,
        avgScore: baseScore + scoreSeed,
      };
    }),
    topUsers: [
      { userId: '1', displayName: 'Siddharth Soni', promptCount: 347, avgScore: 48.3, highRiskCount: 31 },
      { userId: '2', displayName: 'Emily Dawson', promptCount: 298, avgScore: 35.2, highRiskCount: 14 },
      { userId: '3', displayName: 'Marcus Rivera', promptCount: 276, avgScore: 52.7, highRiskCount: 42 },
      { userId: '4', displayName: 'Jennifer Hartwell', promptCount: 251, avgScore: 29.1, highRiskCount: 8 },
      { userId: '5', displayName: 'David Okonkwo', promptCount: 189, avgScore: 44.6, highRiskCount: 22 },
    ],
    recentHighRisk: [
      { id: 'evt-001', aiToolId: 'chatgpt', sensitivityScore: 94, createdAt: '2026-02-20T11:00:00.000Z', entities: ['SSN', 'PRIVILEGE_MARKER', 'MONETARY_AMOUNT'] },
      { id: 'evt-002', aiToolId: 'claude', sensitivityScore: 87, createdAt: '2026-02-20T10:00:00.000Z', entities: ['PERSON', 'MATTER_NUMBER', 'EMAIL'] },
      { id: 'evt-003', aiToolId: 'gemini', sensitivityScore: 92, createdAt: '2026-02-20T09:00:00.000Z', entities: ['SSN', 'ACCOUNT_NUMBER', 'DEAL_CODENAME'] },
      { id: 'evt-004', aiToolId: 'chatgpt', sensitivityScore: 78, createdAt: '2026-02-20T07:00:00.000Z', entities: ['PRIVILEGE_MARKER', 'PERSON'] },
      { id: 'evt-005', aiToolId: 'claude', sensitivityScore: 71, createdAt: '2026-02-20T05:00:00.000Z', entities: ['MONETARY_AMOUNT', 'ORGANIZATION'] },
      { id: 'evt-006', aiToolId: 'chatgpt', sensitivityScore: 85, createdAt: '2026-02-20T03:00:00.000Z', entities: ['CLIENT_MATTER_PAIR', 'OPPOSING_COUNSEL'] },
      { id: 'evt-007', aiToolId: 'gemini', sensitivityScore: 69, createdAt: '2026-02-19T23:00:00.000Z', entities: ['EMAIL', 'PHONE_NUMBER', 'PERSON'] },
      { id: 'evt-008', aiToolId: 'copilot', sensitivityScore: 76, createdAt: '2026-02-19T18:00:00.000Z', entities: ['DEAL_CODENAME', 'MONETARY_AMOUNT'] },
      { id: 'evt-009', aiToolId: 'chatgpt', sensitivityScore: 91, createdAt: '2026-02-19T12:00:00.000Z', entities: ['SSN', 'MEDICAL_RECORD'] },
      { id: 'evt-010', aiToolId: 'claude', sensitivityScore: 82, createdAt: '2026-02-19T08:00:00.000Z', entities: ['PRIVILEGE_MARKER', 'MATTER_NUMBER', 'PERSON'] },
    ],
    impact: getDemoImpactData(),
  };
}
