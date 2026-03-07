'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Dimension {
  name: string;
  score: number;
  weight: number;
  description: string;
}

interface TrustScore {
  overall: number;
  dimensions: Dimension[];
  firmId: string;
  computedAt: string;
}

interface HistoryEntry {
  date: string;
  totalEvents: number;
  avgScore: number;
  complianceRate: number;
}

interface TrustScoreResponse {
  score: TrustScore;
  history: HistoryEntry[];
}

/* ------------------------------------------------------------------ */
/*  Score color helpers                                                 */
/* ------------------------------------------------------------------ */

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
  if (score >= 60) return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800';
  return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
}

function gaugeStrokeColor(score: number): string {
  if (score >= 80) return '#16a34a'; // green-600
  if (score >= 60) return '#ca8a04'; // yellow-600
  return '#dc2626'; // red-600
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Moderate';
  return 'At Risk';
}

/* ------------------------------------------------------------------ */
/*  Circular Gauge (SVG)                                               */
/* ------------------------------------------------------------------ */

function CircularGauge({ score }: { score: number }) {
  const size = 220;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(score, 0), 100) / 100;
  const dashOffset = circumference * (1 - progress);
  const color = gaugeStrokeColor(score);

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-[#d2d2d7] dark:text-[#38383a]"
        />
        {/* Score arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out, stroke 0.4s ease' }}
        />
      </svg>
      {/* Center label — positioned over the SVG */}
      <div className="flex flex-col items-center -mt-[156px] mb-[72px]">
        <span className={`text-5xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">{scoreLabel(score)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dimension Card                                                     */
/* ------------------------------------------------------------------ */

function DimensionCard({ dimension }: { dimension: Dimension }) {
  const barWidth = `${Math.min(Math.max(dimension.score, 0), 100)}%`;

  return (
    <div className={`rounded-xl p-5 border transition-shadow hover:shadow-md ${scoreBg(dimension.score)}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{dimension.name}</h3>
        <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] bg-white/70 dark:bg-black/20 rounded-full px-2 py-0.5">
          {dimension.weight}% weight
        </span>
      </div>

      <div className={`text-3xl font-bold mb-2 ${scoreColor(dimension.score)}`}>
        {dimension.score}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/60 dark:bg-white/10 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: barWidth,
            backgroundColor: gaugeStrokeColor(dimension.score),
          }}
        />
      </div>

      <p className="text-xs text-[#6e6e73] dark:text-[#86868b] leading-relaxed">{dimension.description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function TrustScorePage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<TrustScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchTrustScore();
  }, []);

  async function fetchTrustScore() {
    try {
      setSyncing(true);
      setError(null);
      const response = await apiFetch('/dashboard/trust-score?days=30');

      if (!response.ok) throw new Error('Failed to fetch trust score.');
      const json = await response.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Failed to load trust score.');
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Trust Score</h1>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading...</p>
          </div>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
          <div className="h-[220px] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Trust Score</h1>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Composite governance health across 5 dimensions</p>
          </div>
        </div>
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{error || 'Failed to load trust score.'}</span>
          <button onClick={fetchTrustScore} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { score, history } = data;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Trust Score</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            Composite governance health across 5 dimensions
            {syncing && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                Syncing...
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchTrustScore}
          disabled={syncing}
          className="min-h-[44px] px-4 py-2 bg-iron-600 text-white rounded-lg text-sm hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Composite Score Gauge */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6 flex flex-col items-center">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-6">Composite Trust Score</h2>
        <CircularGauge score={score.overall} />
        <p className="text-xs text-[#86868b] dark:text-[#636366] mt-2" suppressHydrationWarning>
          Computed {new Date(score.computedAt).toLocaleString()}
        </p>
      </div>

      {/* Dimension Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Score Dimensions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {score.dimensions.map((dim) => (
            <DimensionCard key={dim.name} dimension={dim} />
          ))}
        </div>
      </div>

      {/* 30-Day Trend */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">30-Day Trend</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3 pr-4">Events</th>
                <th className="pb-3 pr-4">Avg Score</th>
                <th className="pb-3">Compliance Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
              {history.map((entry) => (
                <tr key={entry.date} className="hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]/50">
                  <td className="py-2.5 pr-4 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                    {entry.date}
                  </td>
                  <td className="py-2.5 pr-4 text-sm text-[#6e6e73] dark:text-[#86868b]">
                    {entry.totalEvents.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        entry.avgScore >= 80
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : entry.avgScore >= 60
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}
                    >
                      {entry.avgScore}
                    </span>
                  </td>
                  <td className="py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500"
                          style={{ width: `${Math.min(entry.complianceRate, 100)}%` }}
                        />
                      </div>
                      <span className="text-[#424245] dark:text-[#a1a1a6] text-xs font-medium">
                        {entry.complianceRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
