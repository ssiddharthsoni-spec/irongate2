'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/lib/api';

interface Control {
  name: string;
  status: 'pass' | 'fail' | 'partial';
  details: string;
}

interface ComplianceReport {
  score: number;
  frameworks: string[];
  controls: Control[];
  generatedAt: string;
}

type DateRange = '7d' | '30d' | '90d' | 'all';

export default function ComplianceReportPage() {
  const { apiFetch } = useApiClient();
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [exporting, setExporting] = useState(false);

  async function fetchReport() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/compliance/report?range=${dateRange}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load compliance report.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchReport(); }, [dateRange]);

  function downloadCSV() {
    if (!report) return;
    setExporting(true);
    try {
      const headers = ['Control', 'Status', 'Details'];
      const rows = report.controls.map(c => [
        c.name,
        c.status,
        `"${c.details.replace(/"/g, '""')}"`,
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `irongate-compliance-report-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
    pass: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
    fail: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
    partial: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  };

  if (loading) {
    return (
      <div className="max-w-5xl">
        <div className="h-8 w-64 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-8" />
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map(i => <div key={i} className="h-28 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />)}
        </div>
        <div className="h-96 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
      </div>
    );
  }

  const passCount = report?.controls.filter(c => c.status === 'pass').length || 0;
  const failCount = report?.controls.filter(c => c.status === 'fail').length || 0;
  const partialCount = report?.controls.filter(c => c.status === 'partial').length || 0;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-2">
            <Link href="/reports/exposure" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Reports</Link>
            <span>/</span>
            <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Compliance</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Compliance Report</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Automated compliance posture assessment based on your Iron Gate configuration.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date range picker */}
          <div className="flex items-center bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-0.5">
            {(['7d', '30d', '90d', 'all'] as DateRange[]).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  dateRange === range
                    ? 'bg-white dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm'
                    : 'text-[#6e6e73] dark:text-[#86868b]'
                }`}
              >
                {range === 'all' ? 'All' : range}
              </button>
            ))}
          </div>
          <button
            onClick={downloadCSV}
            disabled={exporting || !report}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-iron-600 text-white hover:bg-iron-700 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Download CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchReport} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Retry</button>
        </div>
      )}

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">Score</p>
              <p className={`text-3xl font-bold tabular-nums ${
                report.score >= 80 ? 'text-green-600 dark:text-green-400' :
                report.score >= 60 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400'
              }`}>{report.score}</p>
              <p className="text-[11px] text-[#86868b] mt-1">out of 100</p>
            </div>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">Passing</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400 tabular-nums">{passCount}</p>
              <p className="text-[11px] text-[#86868b] mt-1">controls</p>
            </div>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">Partial</p>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{partialCount}</p>
              <p className="text-[11px] text-[#86868b] mt-1">controls</p>
            </div>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">Failing</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400 tabular-nums">{failCount}</p>
              <p className="text-[11px] text-[#86868b] mt-1">controls</p>
            </div>
          </div>

          {/* Frameworks */}
          {report.frameworks.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {report.frameworks.map(fw => (
                <span key={fw} className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-iron-50 dark:bg-iron-900/20 text-iron-700 dark:text-iron-300 border border-iron-200 dark:border-iron-800">
                  {fw}
                </span>
              ))}
            </div>
          )}

          {/* Controls table */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
            <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Control Details</h2>
              <p className="text-[12px] text-[#86868b] mt-0.5">
                Generated {new Date(report.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
            <div className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
              {report.controls.map((control, i) => {
                const colors = statusColors[control.status] || statusColors.partial;
                return (
                  <div key={i} className="flex items-start gap-4 px-6 py-4 hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                    <div className="shrink-0 mt-0.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${colors.bg} ${colors.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                        {control.status === 'pass' ? 'Pass' : control.status === 'fail' ? 'Fail' : 'Partial'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{control.name}</p>
                      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-0.5">{control.details}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
