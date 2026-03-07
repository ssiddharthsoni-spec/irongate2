'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ComplianceControl {
  name: string;
  status: 'pass' | 'fail' | 'partial';
  details: string;
}

interface ComplianceReport {
  score: number;
  frameworks: string[];
  controls: ComplianceControl[];
  generatedAt: string;
}

interface ExposureSummary {
  totalExposures: number;
  blockedCount: number;
  allowedCount: number;
  pseudonymizedCount: number;
}

interface EntityBreakdown {
  entityType: string;
  count: number;
  percentage: number;
}

interface RiskUser {
  userId: string;
  displayName: string;
  exposureCount: number;
  avgScore: number;
}

interface ScoreTrendEntry {
  date: string;
  score: number;
}

interface ReportsData {
  compliance: ComplianceReport;
  exposureSummary: ExposureSummary;
  entityBreakdown: EntityBreakdown[];
  topRiskUsers: RiskUser[];
  scoreTrend: ScoreTrendEntry[];
}

/* ------------------------------------------------------------------ */
/*  Period options                                                     */
/* ------------------------------------------------------------------ */

const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: 'all' },
] as const;

/* ------------------------------------------------------------------ */
/*  Empty data placeholder                                             */
/* ------------------------------------------------------------------ */

function getEmptyData(): ReportsData {
  return {
    compliance: {
      score: 0,
      frameworks: [],
      controls: [],
      generatedAt: new Date().toISOString(),
    },
    exposureSummary: {
      totalExposures: 0,
      blockedCount: 0,
      allowedCount: 0,
      pseudonymizedCount: 0,
    },
    entityBreakdown: [],
    topRiskUsers: [],
    scoreTrend: [],
  };
}

/* ------------------------------------------------------------------ */
/*  CSV export                                                         */
/* ------------------------------------------------------------------ */

function generateCSV(data: ReportsData): string {
  const lines: string[] = [];

  // Compliance Summary
  lines.push('COMPLIANCE REPORT');
  lines.push(`Generated At,${data.compliance.generatedAt}`);
  lines.push(`Overall Score,${data.compliance.score}`);
  lines.push(`Frameworks,"${data.compliance.frameworks.join(', ')}"`);
  lines.push('');

  // Controls
  lines.push('CONTROLS');
  lines.push('Control Name,Status,Details');
  for (const c of data.compliance.controls) {
    lines.push(`"${c.name}",${c.status},"${c.details}"`);
  }
  lines.push('');

  // Exposure Summary
  lines.push('EXPOSURE SUMMARY');
  lines.push('Metric,Value');
  lines.push(`Total Exposures,${data.exposureSummary.totalExposures}`);
  lines.push(`Blocked,${data.exposureSummary.blockedCount}`);
  lines.push(`Allowed,${data.exposureSummary.allowedCount}`);
  lines.push(`Pseudonymized,${data.exposureSummary.pseudonymizedCount}`);
  lines.push('');

  // Entity Breakdown
  lines.push('ENTITY TYPE BREAKDOWN');
  lines.push('Entity Type,Count,Percentage');
  for (const e of data.entityBreakdown) {
    lines.push(`"${e.entityType}",${e.count},${e.percentage}%`);
  }
  lines.push('');

  // Top Risk Users
  lines.push('TOP RISK USERS');
  lines.push('User,Exposure Count,Avg Score');
  for (const u of data.topRiskUsers) {
    lines.push(`"${u.displayName}",${u.exposureCount},${u.avgScore}`);
  }
  lines.push('');

  // Score Trend
  lines.push('COMPLIANCE SCORE TREND');
  lines.push('Date,Score');
  for (const t of data.scoreTrend) {
    lines.push(`${t.date},${t.score}`);
  }

  return lines.join('\n');
}

function downloadCSV(data: ReportsData) {
  const csv = generateCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `irongate-compliance-report-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'partial' }) {
  const styles: Record<string, string> = {
    pass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    partial: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  };
  const labels: Record<string, string> = {
    pass: 'Pass',
    fail: 'Fail',
    partial: 'Partial',
  };

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Score ring                                                         */
/* ------------------------------------------------------------------ */

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? 'stroke-green-500' :
    score >= 60 ? 'stroke-yellow-500' :
    'stroke-red-500';

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-[#d2d2d7]/40 dark:stroke-[#38383a]/60"
        />
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${color} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">{score}</span>
        <span className="text-xs text-[#6e6e73] dark:text-[#86868b]">/ 100</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-[#d2d2d7]/40 dark:bg-[#38383a]/60 rounded ${className || ''}`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Score + controls skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <Skeleton className="h-36 w-36 rounded-full mx-auto mb-4" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
        <div className="lg:col-span-2 bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full mb-2" />
          ))}
        </div>
      </div>

      {/* Entity + users skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <Skeleton className="h-5 w-44 mb-4" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full mb-2" />
          ))}
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <Skeleton className="h-5 w-36 mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full mb-2" />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function ReportsPage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>('30');

  const fetchData = useCallback(async (selectedPeriod: string) => {
    try {
      setLoading(true);
      setError(null);

      const query = selectedPeriod === 'all' ? '' : `?days=${selectedPeriod}`;
      const response = await apiFetch(`/compliance/report${query}`);

      if (response.ok) {
        const json = await response.json();
        const compliance: ComplianceReport = json.compliance || json;
        setData({
          compliance,
          exposureSummary: json.exposureSummary || getEmptyData().exposureSummary,
          entityBreakdown: json.entityBreakdown || [],
          topRiskUsers: json.topRiskUsers || [],
          scoreTrend: json.scoreTrend || [],
        });
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load compliance report.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const retryFetch = useCallback(() => {
    setError(null);
    fetchData(period);
  }, [fetchData, period]);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  /* ---- Loading state ---- */
  if (loading) {
    return <LoadingSkeleton />;
  }

  /* ---- Error state ---- */
  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
            Failed to load report
          </h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">{error}</p>
          <button
            onClick={retryFetch}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { compliance, exposureSummary, entityBreakdown, topRiskUsers, scoreTrend } = data;
  const passCount = compliance.controls.filter(c => c.status === 'pass').length;
  const failCount = compliance.controls.filter(c => c.status === 'fail').length;
  const partialCount = compliance.controls.filter(c => c.status === 'partial').length;

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Compliance Reports
          </h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Generated{' '}
            <span suppressHydrationWarning>
              {new Date(compliance.generatedAt).toLocaleDateString()}
            </span>
            {' '}&mdash;{' '}
            {compliance.frameworks.join(', ')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-lg text-sm bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Download CSV */}
          <button
            onClick={() => downloadCSV(data)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Report
          </button>
        </div>
      </div>

      {/* ---- Exposure Summary KPIs ---- */}
      <section>
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
          Exposure Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5 shadow-sm">
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">Total Exposures</p>
            <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {exposureSummary.totalExposures.toLocaleString()}
            </p>
          </div>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5 shadow-sm">
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">Blocked</p>
            <p className="text-3xl font-bold text-red-500">
              {exposureSummary.blockedCount.toLocaleString()}
            </p>
          </div>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5 shadow-sm">
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">Allowed</p>
            <p className="text-3xl font-bold text-green-500">
              {exposureSummary.allowedCount.toLocaleString()}
            </p>
          </div>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-5 shadow-sm">
            <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">Pseudonymized</p>
            <p className="text-3xl font-bold text-blue-500">
              {exposureSummary.pseudonymizedCount.toLocaleString()}
            </p>
          </div>
        </div>
      </section>

      {/* ---- Compliance Score + Controls ---- */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Ring */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4 text-center">
            Compliance Score
          </h2>
          <ScoreRing score={compliance.score} />
          <div className="flex justify-center gap-4 mt-5 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-[#6e6e73] dark:text-[#86868b]">{passCount} Pass</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <span className="text-[#6e6e73] dark:text-[#86868b]">{partialCount} Partial</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-[#6e6e73] dark:text-[#86868b]">{failCount} Fail</span>
            </span>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {compliance.frameworks.map((fw) => (
              <span
                key={fw}
                className="px-2.5 py-1 text-xs font-medium rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
              >
                {fw}
              </span>
            ))}
          </div>
        </div>

        {/* Controls Table */}
        <div className="lg:col-span-2 bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
            Control Status
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                  <th className="pb-3 pr-4">Control</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/40">
                {compliance.controls.map((control, i) => (
                  <tr key={i} className="hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]/50">
                    <td className="py-3 pr-4 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">
                      {control.name}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={control.status} />
                    </td>
                    <td className="py-3 text-[#6e6e73] dark:text-[#86868b] text-xs leading-relaxed">
                      {control.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Entity Breakdown + Top Risk Users ---- */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Entity Type Breakdown */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
            Entity Type Breakdown
          </h2>
          <div className="space-y-3">
            {entityBreakdown.map((entity) => (
              <div key={entity.entityType}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[#424245] dark:text-[#a1a1a6] font-medium">
                    {entity.entityType}
                  </span>
                  <span className="text-xs text-[#86868b] dark:text-[#636366]">
                    {entity.count.toLocaleString()} ({entity.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${entity.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Risk Users */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
            Top Risk Users
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4">Exposures</th>
                  <th className="pb-3">Avg Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/40">
                {topRiskUsers.map((user) => {
                  const scoreColor =
                    user.avgScore > 85 ? 'text-red-500' :
                    user.avgScore > 60 ? 'text-orange-500' :
                    user.avgScore > 25 ? 'text-yellow-600 dark:text-yellow-500' :
                    'text-green-500';
                  const scoreBg =
                    user.avgScore > 85 ? 'bg-red-50 dark:bg-red-900/20' :
                    user.avgScore > 60 ? 'bg-orange-50 dark:bg-orange-900/20' :
                    user.avgScore > 25 ? 'bg-yellow-50 dark:bg-yellow-900/20' :
                    'bg-green-50 dark:bg-green-900/20';

                  return (
                    <tr key={user.userId} className="hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]/50">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                            {user.displayName.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {user.displayName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[#424245] dark:text-[#a1a1a6]">
                        {user.exposureCount.toLocaleString()}
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${scoreColor} ${scoreBg}`}>
                          {user.avgScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Compliance Score Trend ---- */}
      <section className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
          Compliance Score Trend
        </h2>
        {scoreTrend.length > 0 ? (
          <div>
            {/* Bar chart */}
            <div className="flex items-end gap-[2px] h-40">
              {scoreTrend.map((entry) => {
                const heightPct = entry.score;
                const barColor =
                  entry.score >= 80 ? 'bg-green-500' :
                  entry.score >= 60 ? 'bg-yellow-500' :
                  'bg-red-500';

                return (
                  <div
                    key={entry.date}
                    className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-[#1d1d1f] text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                        <p className="font-semibold">{entry.date}</p>
                        <p>Score: {entry.score}</p>
                      </div>
                    </div>
                    <div
                      className={`w-full rounded-t ${barColor} transition-all duration-300 min-h-[2px]`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* X-axis labels */}
            <div className="flex justify-between mt-2">
              <span className="text-xs text-[#86868b] dark:text-[#636366]">{scoreTrend[0].date}</span>
              {scoreTrend.length > 2 && (
                <span className="text-xs text-[#86868b] dark:text-[#636366]">
                  {scoreTrend[Math.floor(scoreTrend.length / 2)].date}
                </span>
              )}
              <span className="text-xs text-[#86868b] dark:text-[#636366]">
                {scoreTrend[scoreTrend.length - 1].date}
              </span>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-[#6e6e73] dark:text-[#86868b]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Good (80+)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500" /> Fair (60-79)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Poor (&lt;60)
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] text-center py-8">
            No trend data available for the selected period.
          </p>
        )}
      </section>
    </div>
  );
}
