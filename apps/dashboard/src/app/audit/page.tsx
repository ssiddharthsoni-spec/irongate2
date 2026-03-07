'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AuditStatus {
  chainLength: number;
  lastHash: string;
  lastPosition: number;
  isValid: boolean;
}

interface VerifyResult {
  valid: boolean;
  brokenAt?: number;
  totalEvents: number;
}

interface ChainEntry {
  chainPosition: number;
  eventHash: string;
  previousHash: string;
  action: string;
  sensitivityScore: number;
  createdAt: string;
}

interface ChainResponse {
  entries: ChainEntry[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function AuditPage() {
  const { apiFetch } = useApiClient();

  // Status
  const [status, setStatus] = useState<AuditStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Verify
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Chain table
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0 });
  const [chainLoading, setChainLoading] = useState(true);
  const [chainError, setChainError] = useState<string | null>(null);

  /* ---------- Fetch status ---------- */
  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      setStatusLoading(true);
      setStatusError(null);
      const response = await apiFetch('/audit/status');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data: AuditStatus = await response.json();
      setStatus(data);
    } catch {
      setStatusError('Failed to load audit status.');
    } finally {
      setStatusLoading(false);
    }
  }

  /* ---------- Fetch chain entries ---------- */
  useEffect(() => {
    fetchChain();
  }, [pagination]);

  async function fetchChain() {
    try {
      setChainLoading(true);
      setChainError(null);
      const params = new URLSearchParams({
        limit: String(pagination.limit),
        offset: String(pagination.offset),
      });
      const response = await apiFetch(`/audit/chain?${params}`);
      if (!response.ok) throw new Error(`Chain ${response.status}`);
      const data: ChainResponse = await response.json();
      setChain(data);
    } catch {
      setChainError('Failed to load audit chain.');
    } finally {
      setChainLoading(false);
    }
  }

  /* ---------- Verify chain ---------- */
  const handleVerify = useCallback(async () => {
    try {
      setVerifying(true);
      setVerifyError(null);
      setVerifyResult(null);
      const response = await apiFetch('/audit/verify');
      if (!response.ok) throw new Error(`Verify failed (${response.status})`);
      const data: VerifyResult = await response.json();
      setVerifyResult(data);
    } catch (err: any) {
      setVerifyError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }, [apiFetch]);

  /* ---------- Export chain ---------- */
  function handleExportAuditChain() {
    const rows = [
      ['Position', 'Event Hash', 'Previous Hash', 'Action', 'Sensitivity Score', 'Created At'],
      ...(chain?.entries ?? []).map(e => [
        String(e.chainPosition),
        e.eventHash,
        e.previousHash,
        e.action,
        String(Math.round(e.sensitivityScore)),
        e.createdAt,
      ]),
    ];
    const csv = rows.map(r => r.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iron-gate-audit-chain.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Helpers ---------- */
  function truncateHash(hash: string, len = 12): string {
    if (!hash) return '--';
    return hash.length > len ? hash.slice(0, len) + '...' : hash;
  }

  function formatAction(action: string): string {
    return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const totalPages = Math.ceil((chain?.total ?? 0) / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      {/* Error banner */}
      {statusError && !statusLoading && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-red-800 dark:text-red-300 flex-1">
            <span className="font-medium">Error</span> — {statusError}
          </p>
          <button
            onClick={fetchStatus}
            className="text-xs font-medium text-red-700 dark:text-red-300 hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Cryptographic Audit Chain</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Tamper-proof event log with hash-linked integrity verification
          </p>
        </div>
      </div>

      {/* Chain Integrity Banner */}
      {statusLoading ? (
        <div className="rounded-xl p-5 mb-6 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-[#f5f5f7] dark:bg-[#1c1c1e] animate-pulse">
          <div className="h-6 w-48 bg-[#d2d2d7] dark:bg-[#38383a] rounded" />
          <div className="h-4 w-72 bg-[#d2d2d7] dark:bg-[#38383a] rounded mt-2" />
        </div>
      ) : status ? (
        <div
          className={`rounded-xl p-5 mb-6 border ${
            status.isValid
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
          }`}
        >
          <div className="flex items-center gap-3">
            {status.isValid ? (
              <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            )}
            <div>
              <h2 className={`text-lg font-semibold ${status.isValid ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                {status.isValid ? 'Chain Integrity Verified' : 'Chain Integrity Broken'}
              </h2>
              <p className={`text-sm mt-0.5 ${status.isValid ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {status.isValid
                  ? 'All events are cryptographically linked and unmodified.'
                  : 'The audit chain has been tampered with or contains inconsistencies.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Chain Length</p>
          <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
            {statusLoading ? '--' : (status?.chainLength ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">total events recorded</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Last Position</p>
          <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
            {statusLoading ? '--' : (status?.lastPosition ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">most recent chain index</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Last Hash</p>
          <p className="text-lg font-mono font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1 break-all" title={status?.lastHash ?? ''}>
            {statusLoading ? '--' : truncateHash(status?.lastHash ?? '', 20)}
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1" title="SHA-256 is a cryptographic hash function that produces a unique 64-character fingerprint for any data">SHA-256 head of chain</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Status</p>
          <p className={`text-3xl font-bold mt-1 ${status?.isValid ? 'text-green-600' : 'text-red-600'}`}>
            {statusLoading ? '--' : status ? (status.isValid ? 'Valid' : 'Broken') : '--'}
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">chain integrity</p>
        </div>
      </div>

      {/* Verify Section */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Chain Verification</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
              Run a full cryptographic verification of the entire audit chain to confirm no events have been tampered with or deleted.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportAuditChain}
              className="min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-medium border border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Export CSV
            </button>
            <button
              onClick={handleVerify}
              disabled={verifying}
              className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] ${
                verifying
                  ? 'bg-[#f5f5f7] text-[#86868b] cursor-not-allowed dark:bg-[#2c2c2e] dark:text-[#636366]'
                  : 'bg-iron-600 text-white hover:bg-iron-700'
              }`}
            >
              {verifying && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {verifying ? 'Verifying...' : 'Verify Chain'}
            </button>
          </div>
        </div>

        {/* Verify result */}
        {verifyResult && (
          <div
            className={`mt-4 p-4 rounded-lg border ${
              verifyResult.valid
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {verifyResult.valid ? (
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span className={`text-sm font-medium ${verifyResult.valid ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                {verifyResult.valid
                  ? `Verification passed -- all ${(verifyResult.totalEvents ?? 0).toLocaleString()} events are intact.`
                  : `Verification failed -- chain broken at position ${verifyResult.brokenAt?.toLocaleString() ?? 'unknown'} (${(verifyResult.totalEvents ?? 0).toLocaleString()} events checked).`}
              </span>
            </div>
          </div>
        )}

        {/* Verify error */}
        {verifyError && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-400">{verifyError}</p>
          </div>
        )}
      </div>

      {/* Chain Events Table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Audit Chain Events</h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-0.5">
            {(chain?.total ?? 0).toLocaleString()} total entries
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f5f5f7] dark:bg-[#1c1c1e]/80 text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">
                <th className="px-6 py-3">Position</th>
                <th className="px-6 py-3">Event Hash</th>
                <th className="px-6 py-3">Previous Hash</th>
                <th className="px-6 py-3">Action</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
              {chainLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-[#86868b] dark:text-[#636366]">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-[#86868b] dark:text-[#636366]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading chain events...
                    </div>
                  </td>
                </tr>
              ) : (chain?.entries ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={
                        <svg className="w-12 h-12 text-[#d2d2d7] dark:text-[#38383a]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                        </svg>
                      }
                      title="No audit entries found"
                      description="Events will appear here once AI interactions are captured by the Iron Gate extension."
                    />
                  </td>
                </tr>
              ) : (
                (chain?.entries ?? []).map((entry) => (
                  <tr key={entry.chainPosition} className="hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]">
                    <td className="px-6 py-3 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      #{entry.chainPosition.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-[#6e6e73] dark:text-[#86868b]" title={entry.eventHash}>
                      {truncateHash(entry.eventHash, 12)}
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-[#86868b] dark:text-[#636366]" title={entry.previousHash}>
                      {truncateHash(entry.previousHash, 12)}
                    </td>
                    <td className="px-6 py-3 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]">
                        {formatAction(entry.action)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${
                          entry.sensitivityScore > 85
                            ? 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/20'
                            : entry.sensitivityScore > 60
                            ? 'text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-900/20'
                            : entry.sensitivityScore > 25
                            ? 'text-yellow-700 bg-yellow-50 dark:text-yellow-300 dark:bg-yellow-900/20'
                            : 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/20'
                        }`}
                      >
                        {Math.round(entry.sensitivityScore)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap" suppressHydrationWarning>
                      {new Date(entry.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60 flex items-center justify-between">
          <button
            onClick={() =>
              setPagination((p) => ({
                ...p,
                offset: Math.max(0, p.offset - p.limit),
              }))
            }
            disabled={pagination.offset === 0}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            Previous
          </button>
          <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            Page {currentPage} of {totalPages} ({(chain?.total ?? 0).toLocaleString()} entries)
          </span>
          <button
            onClick={() =>
              setPagination((p) => ({
                ...p,
                offset: p.offset + p.limit,
              }))
            }
            disabled={pagination.offset + pagination.limit >= (chain?.total ?? 0)}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
