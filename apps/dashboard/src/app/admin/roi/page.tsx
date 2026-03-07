'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApiClient } from '../../../lib/api';

/* -- Types ----------------------------------------------------------------- */

interface RoiData {
  totalEventsBlocked: number;
  breachCostAvoided: number;
  complianceHoursSaved: number;
  riskTrend: {
    current: number;
    previous: number;
    direction: 'up' | 'down' | 'flat';
  };
  entityBreakdown: Record<string, number>;
  period: { start: string; end: string };
}

/* -- Helpers --------------------------------------------------------------- */

const COST_PER_RECORD = 165;

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function TrendArrow({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'up') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block">
        <path d="M8 3v10M8 3l4 4M8 3L4 7" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (direction === 'down') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block">
        <path d="M8 13V3M8 13l4-4M8 13L4 9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block">
      <path d="M3 8h10" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const DIRECTION_STYLES: Record<string, string> = {
  up: 'text-red-600 dark:text-red-400',
  down: 'text-green-600 dark:text-green-400',
  flat: 'text-gray-500 dark:text-gray-400',
};

const DIRECTION_LABELS: Record<string, string> = {
  up: 'Risk increasing',
  down: 'Risk decreasing',
  flat: 'Risk stable',
};

/* -- Skeleton -------------------------------------------------------------- */

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="h-8 w-56 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-80 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-8" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        <div className="h-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
      </div>
    </div>
  );
}

/* -- Page ------------------------------------------------------------------ */

export default function AdminRoiPage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<RoiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    try {
      const res = await apiFetch('/enterprise/roi');
      if (!res.ok) throw new Error(`API error (${res.status})`);
      const json: RoiData = await res.json();
      if (!cancelled) setData(json);
    } catch (err: any) {
      if (!cancelled) {
        setError(err.message || 'Failed to load ROI data.');
      }
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  /* Loading state */
  if (loading) return <LoadingSkeleton />;

  /* Error state */
  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
          <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
          <span>/</span>
          <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">ROI Dashboard</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">ROI Dashboard</h1>
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{error || 'Failed to load ROI data.'}</span>
          <button
            onClick={load}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* Computed values */
  const breachCostDisplay = formatCurrency(data.breachCostAvoided);
  const entries = Object.entries(data.entityBreakdown).sort(([, a], [, b]) => b - a);
  const maxEntityCount = entries.length > 0 ? Math.max(...entries.map(([, v]) => v)) : 1;
  const trendDelta = data.riskTrend.current - data.riskTrend.previous;
  const trendPercent = data.riskTrend.previous > 0
    ? Math.abs(Math.round((trendDelta / data.riskTrend.previous) * 100))
    : 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">ROI Dashboard</span>
      </nav>

      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">ROI Dashboard</h1>
          <p className="text-[#6e6e73] dark:text-[#86868b] text-sm">
            Return on investment for Iron Gate data protection &middot;{' '}
            {formatDate(data.period.start)} &ndash; {formatDate(data.period.end)}
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] dark:text-[#2997ff] dark:hover:text-[#6cb6ff] transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Hero stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Breach Cost Avoided */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">
            Breach Cost Avoided
          </p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
            {breachCostDisplay}
          </p>
          <p className="text-[11px] text-[#86868b]">
            Based on ${COST_PER_RECORD}/record industry average
          </p>
        </div>

        {/* Compliance Hours Saved */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">
            Compliance Hours Saved
          </p>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">
            {formatNumber(data.complianceHoursSaved)}
          </p>
          <p className="text-[11px] text-[#86868b]">
            Hours of manual review automated
          </p>
        </div>

        {/* Events Blocked */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">
            Events Blocked
          </p>
          <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
            {formatNumber(data.totalEventsBlocked)}
          </p>
          <p className="text-[11px] text-[#86868b]">
            Sensitive data transmissions intercepted
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Risk Trend */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Risk Trend</h2>
          <p className="text-[12px] text-[#86868b] mb-5">Current risk score vs. previous period</p>

          <div className="flex items-center gap-6">
            {/* Current score */}
            <div className="flex-1 text-center">
              <p className="text-[11px] font-medium text-[#86868b] uppercase tracking-wider mb-1">Current</p>
              <p className="text-4xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                {data.riskTrend.current}
              </p>
            </div>

            {/* Direction indicator */}
            <div className="flex flex-col items-center gap-1">
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${DIRECTION_STYLES[data.riskTrend.direction]}`}>
                <TrendArrow direction={data.riskTrend.direction} />
                {trendPercent > 0 && <span>{trendPercent}%</span>}
              </div>
              <p className={`text-[11px] font-medium ${DIRECTION_STYLES[data.riskTrend.direction]}`}>
                {DIRECTION_LABELS[data.riskTrend.direction]}
              </p>
            </div>

            {/* Previous score */}
            <div className="flex-1 text-center">
              <p className="text-[11px] font-medium text-[#86868b] uppercase tracking-wider mb-1">Previous</p>
              <p className="text-4xl font-bold text-[#86868b] tabular-nums">
                {data.riskTrend.previous}
              </p>
            </div>
          </div>
        </div>

        {/* Entity Breakdown */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Entity Breakdown</h2>
          <p className="text-[12px] text-[#86868b] mb-5">Blocked events by detected entity type</p>

          {entries.length === 0 ? (
            <p className="text-sm text-[#86868b] italic">No entity data for this period.</p>
          ) : (
            <div className="space-y-3">
              {entries.map(([type, count]) => {
                const pct = Math.max((count / maxEntityCount) * 100, 2);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] capitalize">
                        {type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[12px] font-medium text-[#86868b] tabular-nums">
                        {formatNumber(count)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#0071e3] dark:bg-[#2997ff] transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
