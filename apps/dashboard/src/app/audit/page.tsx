'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

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
/*  Demo data — shown when the API is not yet available                */
/* ------------------------------------------------------------------ */

function getDemoStatus(): AuditStatus {
  return {
    chainLength: 2847,
    lastHash: 'a3f7c9e1d4b285f60e12d9c8ab3471fe90cd5e8f2b617a439d0e8c7f1a254b63',
    lastPosition: 2846,
    isValid: true,
  };
}

function getDemoChain(limit: number, offset: number): ChainResponse {
  const total = 2847;
  const hashes = [
    'a3f7c9e1d4b2', 'e8f2b617a439', 'd0e8c7f1a254', 'b63c4d91ef08',
    '5a7b2c3d4e5f', '1f2e3d4c5b6a', '9a8b7c6d5e4f', '0f1e2d3c4b5a',
    '7c8d9e0f1a2b', '3b4c5d6e7f8a', '6e7f8a9b0c1d', '2d3e4f5a6b7c',
    'f1a2b3c4d5e6', '8a9b0c1d2e3f', '4f5a6b7c8d9e', 'c1d2e3f4a5b6',
    'b5c6d7e8f9a0', '0a1b2c3d4e5f', 'd7e8f9a0b1c2', '3c4d5e6f7a8b',
    'e9f0a1b2c3d4', '6f7a8b9c0d1e', '1b2c3d4e5f6a', 'a0b1c2d3e4f5',
    '5e6f7a8b9c0d', '8b9c0d1e2f3a', '2f3a4b5c6d7e', 'c3d4e5f6a7b8',
    '7a8b9c0d1e2f', '4e5f6a7b8c9d', '9c0d1e2f3a4b', 'f6a7b8c9d0e1',
    '0d1e2f3a4b5c', 'a7b8c9d0e1f2', '5c6d7e8f9a0b', 'b8c9d0e1f2a3',
    '1e2f3a4b5c6d', 'd0e1f2a3b4c5', '6d7e8f9a0b1c', '2a3b4c5d6e7f',
    'e1f2a3b4c5d6', '7e8f9a0b1c2d', '3b4c5d6e7f8a', 'c5d6e7f8a9b0',
    '8f9a0b1c2d3e', '4c5d6e7f8a9b', 'a9b0c1d2e3f4', 'f2a3b4c5d6e7',
    '5d6e7f8a9b0c', '0c1d2e3f4a5b',
  ];

  const actions = [
    'prompt_scanned', 'entity_detected', 'policy_enforced', 'prompt_blocked',
    'document_scanned', 'alert_triggered', 'redaction_applied', 'prompt_allowed',
    'session_started', 'config_updated',
  ];

  const count = Math.min(limit, Math.max(0, total - offset));
  const entries: ChainEntry[] = Array.from({ length: count }, (_, i) => {
    const pos = total - 1 - offset - i;
    const seed = ((pos * 17 + 31) % 50);
    const actionIdx = (pos * 7 + 3) % actions.length;
    const hashIdx = pos % hashes.length;
    const prevIdx = (pos + 1) % hashes.length;
    const baseTime = new Date('2026-02-20T12:00:00Z').getTime();
    return {
      chainPosition: pos,
      eventHash: hashes[hashIdx] + hashes[(hashIdx + 1) % hashes.length].slice(0, 4) +
        hashes[(hashIdx + 2) % hashes.length].slice(0, 8) +
        hashes[(hashIdx + 3) % hashes.length].slice(0, 8) +
        hashes[(hashIdx + 4) % hashes.length].slice(0, 8) +
        hashes[(hashIdx + 5) % hashes.length].slice(0, 8),
      previousHash: hashes[prevIdx] + hashes[(prevIdx + 1) % hashes.length].slice(0, 4) +
        hashes[(prevIdx + 2) % hashes.length].slice(0, 8) +
        hashes[(prevIdx + 3) % hashes.length].slice(0, 8) +
        hashes[(prevIdx + 4) % hashes.length].slice(0, 8) +
        hashes[(prevIdx + 5) % hashes.length].slice(0, 8),
      action: actions[actionIdx],
      sensitivityScore: 10 + seed * 1.8,
      createdAt: new Date(baseTime - pos * 43200).toISOString(),
    };
  });

  return { entries, total, limit, offset };
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function AuditPage() {
  const { apiFetch } = useApiClient();

  // Status
  const [status, setStatus] = useState<AuditStatus>(getDemoStatus());
  const [isLive, setIsLive] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Verify
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Chain table
  const [chain, setChain] = useState<ChainResponse>(getDemoChain(50, 0));
  const [pagination, setPagination] = useState({ limit: 50, offset: 0 });
  const [chainLoading, setChainLoading] = useState(true);

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
      setIsLive(true);
    } catch {
      // API unavailable — keep demo data
      setIsLive(false);
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
      const params = new URLSearchParams({
        limit: String(pagination.limit),
        offset: String(pagination.offset),
      });
      const response = await apiFetch(`/audit/chain?${params}`);
      if (!response.ok) throw new Error(`Chain ${response.status}`);
      const data: ChainResponse = await response.json();
      setChain(data);
      setIsLive(true);
    } catch {
      // API unavailable — show demo data for current page
      if (!isLive) {
        setChain(getDemoChain(pagination.limit, pagination.offset));
      }
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
      // If API is unavailable, show a demo result
      if (!isLive) {
        setVerifyResult({ valid: true, totalEvents: status.chainLength });
      } else {
        setVerifyError(err.message || 'Verification failed');
      }
    } finally {
      setVerifying(false);
    }
  }, [apiFetch, isLive, status.chainLength]);

  /* ---------- Helpers ---------- */
  function truncateHash(hash: string, len = 12): string {
    if (!hash) return '--';
    return hash.length > len ? hash.slice(0, len) + '...' : hash;
  }

  function formatAction(action: string): string {
    return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const totalPages = Math.ceil(chain.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cryptographic Audit Chain</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tamper-proof event log with hash-linked integrity verification
            {!isLive && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                Demo Data
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Chain Integrity Banner */}
      <div
        className={`rounded-xl p-5 mb-6 border ${
          status.isValid
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
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
            <h2 className={`text-lg font-semibold ${status.isValid ? 'text-green-800' : 'text-red-800'}`}>
              {status.isValid ? 'Chain Integrity Verified' : 'Chain Integrity Broken'}
            </h2>
            <p className={`text-sm mt-0.5 ${status.isValid ? 'text-green-700' : 'text-red-700'}`}>
              {status.isValid
                ? 'All events are cryptographically linked and unmodified.'
                : 'The audit chain has been tampered with or contains inconsistencies.'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Chain Length</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {statusLoading ? '--' : status.chainLength.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">total events recorded</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Last Position</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {statusLoading ? '--' : status.lastPosition.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">most recent chain index</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Last Hash</p>
          <p className="text-lg font-mono font-bold text-gray-900 mt-1 break-all">
            {statusLoading ? '--' : truncateHash(status.lastHash, 20)}
          </p>
          <p className="text-xs text-gray-400 mt-1">SHA-256 head of chain</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Status</p>
          <p className={`text-3xl font-bold mt-1 ${status.isValid ? 'text-green-600' : 'text-red-600'}`}>
            {statusLoading ? '--' : status.isValid ? 'Valid' : 'Broken'}
          </p>
          <p className="text-xs text-gray-400 mt-1">chain integrity</p>
        </div>
      </div>

      {/* Verify Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Chain Verification</h2>
            <p className="text-sm text-gray-500 mt-1">
              Run a full cryptographic verification of the entire audit chain.
            </p>
          </div>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              verifying
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
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

        {/* Verify result */}
        {verifyResult && (
          <div
            className={`mt-4 p-4 rounded-lg border ${
              verifyResult.valid
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
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
              <span className={`text-sm font-medium ${verifyResult.valid ? 'text-green-800' : 'text-red-800'}`}>
                {verifyResult.valid
                  ? `Verification passed -- all ${verifyResult.totalEvents.toLocaleString()} events are intact.`
                  : `Verification failed -- chain broken at position ${verifyResult.brokenAt?.toLocaleString() ?? 'unknown'} (${verifyResult.totalEvents.toLocaleString()} events checked).`}
              </span>
            </div>
          </div>
        )}

        {/* Verify error */}
        {verifyError && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{verifyError}</p>
          </div>
        )}
      </div>

      {/* Chain Events Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Audit Chain Events</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {chain.total.toLocaleString()} total entries
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Position</th>
                <th className="px-6 py-3">Event Hash</th>
                <th className="px-6 py-3">Previous Hash</th>
                <th className="px-6 py-3">Action</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {chainLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading chain events...
                    </div>
                  </td>
                </tr>
              ) : chain.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    No audit entries found
                  </td>
                </tr>
              ) : (
                chain.entries.map((entry) => (
                  <tr key={entry.chainPosition} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm font-medium text-gray-900">
                      #{entry.chainPosition.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-gray-600" title={entry.eventHash}>
                      {truncateHash(entry.eventHash, 12)}
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-gray-400" title={entry.previousHash}>
                      {truncateHash(entry.previousHash, 12)}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-900">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {formatAction(entry.action)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${
                          entry.sensitivityScore > 85
                            ? 'text-red-700 bg-red-50'
                            : entry.sensitivityScore > 60
                            ? 'text-orange-700 bg-orange-50'
                            : entry.sensitivityScore > 25
                            ? 'text-yellow-700 bg-yellow-50'
                            : 'text-green-700 bg-green-50'
                        }`}
                      >
                        {Math.round(entry.sensitivityScore)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600" suppressHydrationWarning>
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
          <button
            onClick={() =>
              setPagination((p) => ({
                ...p,
                offset: Math.max(0, p.offset - p.limit),
              }))
            }
            disabled={pagination.offset === 0}
            className="px-3 py-1.5 text-sm rounded border disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {currentPage} of {totalPages} ({chain.total.toLocaleString()} entries)
          </span>
          <button
            onClick={() =>
              setPagination((p) => ({
                ...p,
                offset: p.offset + p.limit,
              }))
            }
            disabled={pagination.offset + pagination.limit >= chain.total}
            className="px-3 py-1.5 text-sm rounded border disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
