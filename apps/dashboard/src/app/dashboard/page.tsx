'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
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
}

const RISK_COLORS = {
  low: '#51cf66',
  medium: '#fcc419',
  high: '#ff922b',
  critical: '#ff6b6b',
};

export default function DashboardPage() {
  const { apiFetch } = useApiClient();
  // Start with demo data immediately — no loading/error state flash
  const [data, setData] = useState<FirmOverview>(getDemoData());
  const [firmName, setFirmName] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [timeRange, setTimeRange] = useState(30);

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  async function fetchDashboardData() {
    try {
      setSyncing(true);
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
      // API not available — keep using demo data silently
      setIsLive(false);
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{firmName || 'Your Organization'}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Iron Gate — Shadow AI Governance Dashboard
            {!isLive && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                Demo Data
              </span>
            )}
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
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
              }`}
            >
              {days}d
            </button>
          ))}
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

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Sensitivity Distribution</h2>
          <div style={{ width: '100%', height: 300 }}>
            <SensitivityDistributionChart data={distributionData} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">AI Tool Usage</h2>
          <div style={{ width: '100%', height: 300 }}>
            <ToolBreakdownChart data={data.toolBreakdown} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Daily Trend</h2>
        <div style={{ width: '100%', height: 300 }}>
          <DailyTrendChart data={data.dailyTrend} />
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Users */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top Users</h2>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="pb-3">User</th>
                <th className="pb-3">Prompts</th>
                <th className="pb-3">Avg Score</th>
                <th className="pb-3">High Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.topUsers.map((user) => (
                <tr key={user.userId}>
                  <td className="py-2 text-sm text-gray-900 dark:text-white">{user.displayName}</td>
                  <td className="py-2 text-sm text-gray-600 dark:text-gray-400">{user.promptCount}</td>
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent High Risk Events</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.recentHighRisk.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No high risk events</p>
            ) : (
              data.recentHighRisk.slice(0, 10).map((event: any) => (
                <div key={event.id} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{event.aiToolId}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2" suppressHydrationWarning>
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
    <div className="flex items-center justify-center h-[300px] bg-gray-50 dark:bg-gray-700/50 rounded-lg animate-pulse">
      <span className="text-sm text-gray-400 dark:text-gray-500">Loading chart...</span>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  color = 'text-gray-900',
}: {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
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
  };
}
