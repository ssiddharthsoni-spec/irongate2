'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrollmentCode {
  id: string;
  code: string;
  label?: string;
  maxUses?: number | null;
  usedCount: number;
  expiresAt?: string | null;
  revoked: boolean;
  createdAt: string;
}

type CodeStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

function getCodeStatus(code: EnrollmentCode): CodeStatus {
  if (code.revoked) return 'revoked';
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return 'expired';
  if (code.maxUses != null && code.usedCount >= code.maxUses) return 'exhausted';
  return 'active';
}

const STATUS_STYLES: Record<CodeStatus, string> = {
  active: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  expired: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  revoked: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  exhausted: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
};

const STATUS_LABELS: Record<CodeStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  exhausted: 'Exhausted',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EnrollmentCodesPage() {
  const { apiFetch } = useApiClient();

  const [codes, setCodes] = useState<EnrollmentCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [createMaxUses, setCreateMaxUses] = useState('');
  const [createExpiresAt, setCreateExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Revoke
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch codes
  // ---------------------------------------------------------------------------
  const fetchCodes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/enrollment-codes');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setCodes(Array.isArray(data) ? data : data.codes ?? []);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        setCodes([]);
      } else {
        setError(err.message || 'Failed to load enrollment codes.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchCodes();
  }, []);

  // ---------------------------------------------------------------------------
  // Create code
  // ---------------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    try {
      setCreating(true);
      setCreateError(null);

      const body: Record<string, unknown> = {};
      if (createLabel.trim()) body.label = createLabel.trim();
      if (createMaxUses.trim()) body.maxUses = parseInt(createMaxUses, 10);
      if (createExpiresAt.trim()) body.expiresAt = new Date(createExpiresAt).toISOString();

      const res = await apiFetch('/admin/enrollment-codes', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      setCreateLabel('');
      setCreateMaxUses('');
      setCreateExpiresAt('');
      setShowCreateModal(false);
      await fetchCodes();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create enrollment code.');
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Copy to clipboard
  // ---------------------------------------------------------------------------
  async function handleCopy(code: EnrollmentCode) {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopiedId(code.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = code.code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(code.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  // ---------------------------------------------------------------------------
  // Revoke code
  // ---------------------------------------------------------------------------
  async function handleRevoke(codeId: string) {
    try {
      setRevokingId(codeId);
      const res = await apiFetch(`/admin/enrollment-codes/${codeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      await fetchCodes();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke enrollment code.');
    } finally {
      setRevokingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
            <li>
              <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
                Admin
              </a>
            </li>
            <li>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </li>
            <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Enrollment Codes</li>
          </ol>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Enrollment Codes</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading enrollment codes...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li>
            <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
              Admin
            </a>
          </li>
          <li>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Enrollment Codes</li>
        </ol>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Enrollment Codes</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Create and manage codes that employees use to join your organization.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          Create Code
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => {
              setShowCreateModal(false);
              setCreateError(null);
            }}
          />

          {/* Modal */}
          <div className="relative bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Create Enrollment Code</h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  placeholder="e.g. Q2 Onboarding, Engineering Team"
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Max Uses (optional)
                </label>
                <input
                  type="number"
                  min={1}
                  value={createMaxUses}
                  onChange={(e) => setCreateMaxUses(e.target.value)}
                  placeholder="Unlimited if left blank"
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Expiry Date (optional)
                </label>
                <input
                  type="datetime-local"
                  value={createExpiresAt}
                  onChange={(e) => setCreateExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
                />
              </div>

              {createError && (
                <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                  {createError}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={creating}
                  className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                    creating ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
                  }`}
                >
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    'Create Code'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError(null);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7] dark:border-[#38383a] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Codes table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        {codes.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No enrollment codes yet</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              Create your first code to start onboarding employees.
            </p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_80px_120px_90px_100px] gap-4 px-6 py-3 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Code</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Label</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Uses</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Expires</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Status</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide text-right">Actions</span>
            </div>

            {/* Rows */}
            {codes.map((code) => {
              const status = getCodeStatus(code);
              return (
                <div
                  key={code.id}
                  className="grid grid-cols-[1fr_1fr_80px_120px_90px_100px] gap-4 px-6 py-4 items-center border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 last:border-b-0"
                >
                  <span className="text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                    {code.code}
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b] truncate">
                    {code.label || '--'}
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                    {code.usedCount}{code.maxUses != null ? `/${code.maxUses}` : ''}
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                    {code.expiresAt
                      ? new Date(code.expiresAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Never'}
                  </span>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleCopy(code)}
                      className="text-xs font-medium text-iron-600 dark:text-iron-400 hover:text-iron-800 dark:hover:text-iron-300 transition-colors"
                    >
                      {copiedId === code.id ? 'Copied!' : 'Copy'}
                    </button>
                    {!code.revoked && (
                      <button
                        onClick={() => handleRevoke(code.id)}
                        disabled={revokingId === code.id}
                        className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {revokingId === code.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
