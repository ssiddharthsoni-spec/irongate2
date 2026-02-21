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
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */

function getDemoData(): TrustScoreResponse {
  const base = new Date('2026-02-20T00:00:00Z').getTime();

  return {
    score: {
      overall: 76,
      dimensions: [
        {
          name: 'Detection Accuracy',
          score: 82,
          weight: 25,
          description:
            'Measures the precision and recall of sensitive-data detection across all monitored AI interactions.',
        },
        {
          name: 'Feedback Participation',
          score: 61,
          weight: 15,
          description:
            'Tracks how actively users review and provide feedback on flagged events, improving model quality over time.',
        },
        {
          name: 'Policy Compliance',
          score: 78,
          weight: 30,
          description:
            'Evaluates adherence to organization-defined governance policies, including blocking rules and data-handling procedures.',
        },
        {
          name: 'Chain Integrity',
          score: 71,
          weight: 15,
          description:
            'Verifies the completeness and tamper-resistance of the audit trail for every AI interaction event.',
        },
        {
          name: 'Coverage Completeness',
          score: 68,
          weight: 15,
          description:
            'Assesses the percentage of AI tools and user groups actively monitored by Iron Gate.',
        },
      ],
      firmId: 'demo',
      computedAt: '2026-02-20T12:00:00.000Z',
    },
    history: Array.from({ length: 30 }, (_, i) => {
      const day = new Date(base - (29 - i) * 86400000);
      const seed1 = ((i * 7 + 13) % 30);
      const seed2 = ((i * 11 + 3) % 15);
      const seed3 = ((i * 5 + 9) % 10);
      return {
        date: day.toISOString().split('T')[0],
        totalEvents: 80 + seed1 * 4,
        avgScore: 70 + seed2,
        complianceRate: 85 + seed3,
      };
    }),
  };
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
  if (score >= 80) return 'bg-green-50 border-green-200';
  if (score >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
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
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
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
        <span className="text-sm text-gray-500 mt-1">{scoreLabel(score)}</span>
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
    <div className={`rounded-xl p-5 border ${scoreBg(dimension.score)}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{dimension.name}</h3>
        <span className="text-xs font-medium text-gray-500 bg-white/70 rounded-full px-2 py-0.5">
          {dimension.weight}% weight
        </span>
      </div>

      <div className={`text-3xl font-bold mb-2 ${scoreColor(dimension.score)}`}>
        {dimension.score}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/60 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: barWidth,
            backgroundColor: gaugeStrokeColor(dimension.score),
          }}
        />
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">{dimension.description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function TrustScorePage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<TrustScoreResponse>(getDemoData());
  const [isLive, setIsLive] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchTrustScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTrustScore() {
    try {
      setSyncing(true);
      const response = await apiFetch('/dashboard/trust-score?days=30');

      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
      setIsLive(true);
    } catch {
      // API not available — keep using demo data silently
      setIsLive(false);
    } finally {
      setSyncing(false);
    }
  }

  const { score, history } = data;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trust Score</h1>
          <p className="text-sm text-gray-500">
            Composite governance health across 5 dimensions
            {!isLive && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                Demo Data
              </span>
            )}
            {syncing && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                Syncing...
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchTrustScore}
          disabled={syncing}
          className="px-4 py-2 bg-iron-600 text-white rounded-lg text-sm hover:bg-iron-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Composite Score Gauge */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6 flex flex-col items-center">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Composite Trust Score</h2>
        <CircularGauge score={score.overall} />
        <p className="text-xs text-gray-400 mt-2" suppressHydrationWarning>
          Computed {new Date(score.computedAt).toLocaleString()}
        </p>
      </div>

      {/* Dimension Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Dimensions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {score.dimensions.map((dim) => (
            <DimensionCard key={dim.name} dimension={dim} />
          ))}
        </div>
      </div>

      {/* 30-Day Trend */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">30-Day Trend</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3 pr-4">Events</th>
                <th className="pb-3 pr-4">Avg Score</th>
                <th className="pb-3">Compliance Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((entry) => (
                <tr key={entry.date} className="hover:bg-gray-50">
                  <td className="py-2.5 pr-4 text-sm text-gray-900 font-medium">
                    {entry.date}
                  </td>
                  <td className="py-2.5 pr-4 text-sm text-gray-600">
                    {entry.totalEvents.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        entry.avgScore >= 80
                          ? 'bg-green-100 text-green-700'
                          : entry.avgScore >= 60
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {entry.avgScore}
                    </span>
                  </td>
                  <td className="py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500"
                          style={{ width: `${Math.min(entry.complianceRate, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-700 text-xs font-medium">
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
