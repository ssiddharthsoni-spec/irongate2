'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ExecutiveSummary {
  totalInteractions: number;
  uniqueUsers: number;
  avgSensitivityScore: number;
  highRiskInteractions: number;
  criticalInteractions: number;
  maxSensitivityScore: number;
}

interface ToolBreakdownEntry {
  toolId: string;
  count: number;
  avgScore: number;
  highRiskCount: number;
}

interface ScoreDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

interface DailyTrendEntry {
  date: string;
  count: number;
  avgScore: number;
}

interface ExposureReport {
  reportDate: string;
  periodDays: number;
  executiveSummary: ExecutiveSummary;
  toolBreakdown: ToolBreakdownEntry[];
  scoreDistribution: ScoreDistribution;
  dailyTrend: DailyTrendEntry[];
  recommendations: string[];
}

/* ------------------------------------------------------------------ */
/*  Period options                                                     */
/* ------------------------------------------------------------------ */

const PERIOD_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

function sensitivityScoreColor(score: number): string {
  if (score > 85) return 'text-red-500';
  if (score > 60) return 'text-orange-500';
  if (score > 25) return 'text-yellow-500';
  return 'text-green-500';
}

function sensitivityScoreBg(score: number): string {
  if (score > 85) return 'bg-red-50';
  if (score > 60) return 'bg-orange-50';
  if (score > 25) return 'bg-yellow-50';
  return 'bg-green-50';
}

/* ------------------------------------------------------------------ */
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */

function getDemoReport(days: number): ExposureReport {
  return {
    reportDate: new Date().toISOString(),
    periodDays: days,
    executiveSummary: {
      totalInteractions: 12847,
      uniqueUsers: 156,
      avgSensitivityScore: 34.2,
      highRiskInteractions: 1568,
      criticalInteractions: 334,
      maxSensitivityScore: 97,
    },
    toolBreakdown: [
      { toolId: 'ChatGPT', count: 6421, avgScore: 32.5, highRiskCount: 789 },
      { toolId: 'Claude', count: 3212, avgScore: 38.1, highRiskCount: 456 },
      { toolId: 'Gemini', count: 1927, avgScore: 30.8, highRiskCount: 234 },
      { toolId: 'Copilot', count: 1287, avgScore: 28.4, highRiskCount: 89 },
    ],
    scoreDistribution: { low: 7823, medium: 3456, high: 1234, critical: 334 },
    dailyTrend: Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * 86400000)
        .toISOString()
        .split('T')[0],
      count: Math.floor(300 + Math.random() * 200),
      avgScore: Math.floor(25 + Math.random() * 25),
    })),
    recommendations: [
      'Deploy Iron Gate Proxy Mode to automatically protect sensitive prompts before they reach external AI tools.',
      'Implement mandatory user training on AI tool data hygiene and acceptable use policies.',
      'Configure custom sensitivity thresholds aligned with your organization\'s risk appetite.',
      'Enable real-time Slack/Teams alerts for critical sensitivity events (score > 85).',
      'Schedule weekly exposure report reviews with your security and compliance teams.',
      'Restrict high-sensitivity data categories (SSN, API keys, credentials) from all AI tools.',
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                           */
/* ------------------------------------------------------------------ */

function KpiCard({
  label,
  value,
  colorClass,
  bgClass,
}: {
  label: string;
  value: string | number;
  colorClass?: string;
  bgClass?: string;
}) {
  return (
    <div
      className={`rounded-xl p-5 border border-gray-200 shadow-sm ${bgClass || 'bg-white'}`}
    >
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${colorClass || 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stacked Bar                                                        */
/* ------------------------------------------------------------------ */

function StackedBar({ distribution }: { distribution: ScoreDistribution }) {
  const total =
    distribution.low +
    distribution.medium +
    distribution.high +
    distribution.critical;

  if (total === 0) return null;

  const segments = [
    { key: 'Low', count: distribution.low, color: 'bg-green-500' },
    { key: 'Medium', count: distribution.medium, color: 'bg-yellow-500' },
    { key: 'High', count: distribution.high, color: 'bg-orange-500' },
    { key: 'Critical', count: distribution.critical, color: 'bg-red-500' },
  ];

  return (
    <div>
      {/* Bar */}
      <div className="w-full h-8 rounded-lg overflow-hidden flex">
        {segments.map((seg) => {
          const pct = (seg.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={seg.key}
              className={`${seg.color} relative group transition-all duration-300`}
              style={{ width: `${pct}%` }}
              title={`${seg.key}: ${seg.count.toLocaleString()} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
        {segments.map((seg) => {
          const pct = ((seg.count / total) * 100).toFixed(1);
          return (
            <div key={seg.key} className="flex items-center gap-2 text-sm">
              <span className={`w-3 h-3 rounded-sm ${seg.color}`} />
              <span className="text-gray-700 font-medium">{seg.key}</span>
              <span className="text-gray-400">
                {seg.count.toLocaleString()} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool Breakdown Table                                               */
/* ------------------------------------------------------------------ */

function ToolBreakdownTable({ tools }: { tools: ToolBreakdownEntry[] }) {
  const maxCount = Math.max(...tools.map((t) => t.count), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="pb-3 pr-4">Tool</th>
            <th className="pb-3 pr-4">Usage Count</th>
            <th className="pb-3 pr-4">Avg Score</th>
            <th className="pb-3 pr-4">High-Risk</th>
            <th className="pb-3">Usage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tools.map((tool) => {
            const barPct = (tool.count / maxCount) * 100;
            return (
              <tr key={tool.toolId} className="hover:bg-gray-50">
                <td className="py-3 pr-4 text-sm font-medium text-gray-900">
                  {tool.toolId}
                </td>
                <td className="py-3 pr-4 text-sm text-gray-700">
                  {tool.count.toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-sm">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${sensitivityScoreColor(tool.avgScore)} ${sensitivityScoreBg(tool.avgScore)}`}
                  >
                    {tool.avgScore}
                  </span>
                </td>
                <td className="py-3 pr-4 text-sm font-semibold text-orange-500">
                  {tool.highRiskCount.toLocaleString()}
                </td>
                <td className="py-3 min-w-[120px]">
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-iron-500 transition-all duration-500"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Daily Trend (CSS Bar Chart)                                        */
/* ------------------------------------------------------------------ */

function DailyTrendChart({ trend }: { trend: DailyTrendEntry[] }) {
  const maxCount = Math.max(...trend.map((d) => d.count), 1);

  return (
    <div>
      {/* Bar chart */}
      <div className="flex items-end gap-[2px] h-40">
        {trend.map((day) => {
          const heightPct = (day.count / maxCount) * 100;
          const barColor =
            day.avgScore > 85
              ? 'bg-red-500'
              : day.avgScore > 60
                ? 'bg-orange-500'
                : day.avgScore > 25
                  ? 'bg-yellow-500'
                  : 'bg-green-500';

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  <p className="font-semibold">{day.date}</p>
                  <p>Count: {day.count}</p>
                  <p>Avg Score: {day.avgScore}</p>
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

      {/* X-axis labels — show first, middle, and last dates */}
      {trend.length > 0 && (
        <div className="flex justify-between mt-2">
          <span className="text-xs text-gray-400">{trend[0].date}</span>
          {trend.length > 2 && (
            <span className="text-xs text-gray-400">
              {trend[Math.floor(trend.length / 2)].date}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {trend[trend.length - 1].date}
          </span>
        </div>
      )}

      {/* Color legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Low (&le;25)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500" /> Medium
          (26-60)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" /> High
          (61-85)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Critical
          (&gt;85)
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function ExposureReportPage() {
  const { apiFetch } = useApiClient();
  const [report, setReport] = useState<ExposureReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/reports/exposure?days=${days}`);
      if (response.ok) {
        setReport(await response.json());
      } else {
        setReport(getDemoReport(days));
      }
    } catch {
      setReport(getDemoReport(days));
    } finally {
      setLoading(false);
    }
  }, [days, apiFetch]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  /* Loading state */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-iron-200 border-t-iron-600 rounded-full animate-spin mb-3" />
          <p className="text-gray-500 text-sm">Generating report...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-red-500">Failed to load report.</p>
      </div>
    );
  }

  const { executiveSummary } = report;

  return (
    <div className="max-w-5xl mx-auto">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Shadow AI Exposure Report
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Generated{' '}
            <span suppressHydrationWarning>
              {new Date(report.reportDate).toLocaleDateString()}
            </span>{' '}
            &mdash; Last {report.periodDays} days
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Refresh */}
          <button
            onClick={fetchReport}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            Refresh
          </button>

          {/* Export PDF */}
          <button
            onClick={() => alert('PDF export will be available in a future release.')}
            className="px-4 py-2 bg-iron-600 text-white rounded-lg text-sm hover:bg-iron-700 transition-colors"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* ---- Executive Summary ---- */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Executive Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            label="Total Interactions"
            value={executiveSummary.totalInteractions}
          />
          <KpiCard
            label="Unique Users"
            value={executiveSummary.uniqueUsers}
          />
          <KpiCard
            label="Avg Sensitivity"
            value={executiveSummary.avgSensitivityScore}
            colorClass={sensitivityScoreColor(executiveSummary.avgSensitivityScore)}
            bgClass={`${sensitivityScoreBg(executiveSummary.avgSensitivityScore)} border border-gray-200 shadow-sm`}
          />
          <KpiCard
            label="High-Risk"
            value={executiveSummary.highRiskInteractions}
            colorClass="text-orange-500"
            bgClass="bg-orange-50 border border-gray-200 shadow-sm"
          />
          <KpiCard
            label="Critical"
            value={executiveSummary.criticalInteractions}
            colorClass="text-red-500"
            bgClass="bg-red-50 border border-gray-200 shadow-sm"
          />
          <KpiCard
            label="Max Score"
            value={executiveSummary.maxSensitivityScore}
          />
        </div>
      </section>

      {/* ---- Score Distribution ---- */}
      <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Sensitivity Score Distribution
        </h2>
        <StackedBar distribution={report.scoreDistribution} />
      </section>

      {/* ---- AI Tool Breakdown ---- */}
      <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          AI Tool Breakdown
        </h2>
        <ToolBreakdownTable tools={report.toolBreakdown} />
      </section>

      {/* ---- Daily Trend ---- */}
      <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Daily Trend
        </h2>
        <DailyTrendChart trend={report.dailyTrend} />
      </section>

      {/* ---- Recommendations ---- */}
      <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Recommendations
        </h2>
        <ul className="space-y-3">
          {report.recommendations.map((rec, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-sm font-medium mt-0.5">
                {i + 1}
              </span>
              <span className="text-sm text-gray-700 leading-relaxed">
                {rec}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
