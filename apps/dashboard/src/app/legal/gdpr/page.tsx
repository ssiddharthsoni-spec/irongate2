'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

interface GdprRequest {
  id: string;
  status: 'pending' | 'scheduled' | 'executed' | 'cancelled';
  reason: string;
  scheduledAt: string | null;
  executedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

const STATUS_BADGES: Record<GdprRequest['status'], { label: string; classes: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  },
  scheduled: {
    label: 'Scheduled',
    classes: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
  },
  executed: {
    label: 'Executed',
    classes: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800',
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-gray-100 dark:bg-gray-800/30 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
  },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function GdprPage() {
  const { apiFetch } = useApiClient();

  const [requests, setRequests] = useState<GdprRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/enterprise/gdpr/requests');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load deletion requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || !reason.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch('/enterprise/gdpr/delete', {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), confirm: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server responded with ${res.status}`);
      }
      setReason('');
      setConfirmed(false);
      setShowForm(false);
      await fetchRequests();
    } catch (err: any) {
      setError(err.message || 'Failed to submit deletion request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      setCancellingId(id);
      setError(null);
      const res = await apiFetch(`/enterprise/gdpr/requests/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server responded with ${res.status}`);
      }
      await fetchRequests();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel deletion request.');
    } finally {
      setCancellingId(null);
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          GDPR Data Deletion
        </h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
          Article 17 — Right to Erasure
        </p>
        <div className="space-y-6 animate-pulse">
          <div className="h-20 bg-[#e5e5ea] dark:bg-[#38383a] rounded-xl" />
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 space-y-4">
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/3" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-5/6" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-4/6" />
          </div>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 space-y-4">
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/4" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-40" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
          GDPR Data Deletion
        </h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-5 py-2.5 rounded-lg text-sm text-white font-medium transition-colors bg-iron-600 hover:bg-iron-700"
          >
            Request Data Deletion
          </button>
        )}
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Article 17 — Right to Erasure. Submit and manage data deletion requests
        for your organization.
      </p>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchRequests}
            className="shrink-0 ml-3 underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* 30-day grace period notice */}
      <div className="mb-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
              30-Day Grace Period
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              All deletion requests are subject to a 30-day grace period. During
              this time, you may cancel the request. Once the grace period
              expires, deletion is permanent and irreversible. All organization
              data including events, pseudonym maps, entity graphs, and user
              accounts will be erased.
            </p>
          </div>
        </div>
      </div>

      {/* Confirmation form */}
      {showForm && (
        <div className="mb-8 bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border-2 border-red-200 dark:border-red-900/60 overflow-hidden">
          <div className="p-5 bg-red-50 dark:bg-red-900/20 border-b-2 border-red-200 dark:border-red-900/60">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
                Request Data Deletion
              </h2>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Reason for deletion <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="e.g., End of contract, switching providers, GDPR subject access request..."
                rows={4}
                maxLength={2000}
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm resize-none placeholder:text-[#86868b]"
              />
              <p className="mt-1 text-xs text-[#86868b]">
                {reason.length}/2000 characters
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#d2d2d7] dark:border-[#38383a] text-iron-600 focus:ring-iron-500"
              />
              <span className="text-sm text-[#424245] dark:text-[#a1a1a6]">
                I understand this action is irreversible after the grace period
              </span>
            </label>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting || !confirmed || !reason.trim()}
                className={`px-6 py-2.5 rounded-lg text-sm text-white font-medium transition-colors ${
                  submitting || !confirmed || !reason.trim()
                    ? 'bg-red-300 dark:bg-red-900/40 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? 'Submitting...' : 'Submit Deletion Request'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setReason('');
                  setConfirmed(false);
                }}
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#424245] dark:text-[#a1a1a6] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#38383a] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Existing requests table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Deletion Requests
          </h2>
          <p className="text-xs text-[#86868b] mt-1">
            History of all data deletion requests for your organization
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="p-12 text-center">
            <svg
              className="w-10 h-10 mx-auto mb-3 text-[#d2d2d7] dark:text-[#48484a]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
              />
            </svg>
            <p className="text-sm text-[#86868b]">
              No deletion requests have been submitted.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <th className="text-left px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">
                    Date Requested
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">
                    Reason
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">
                    Scheduled Date
                  </th>
                  <th className="text-right px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                {requests.map((req) => {
                  const badge = STATUS_BADGES[req.status];
                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">
                        {formatDate(req.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-[#424245] dark:text-[#a1a1a6] max-w-xs truncate">
                        {req.reason}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[#424245] dark:text-[#a1a1a6] whitespace-nowrap">
                        {req.scheduledAt ? formatDate(req.scheduledAt) : '--'}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        {req.status === 'pending' ? (
                          <button
                            onClick={() => handleCancel(req.id)}
                            disabled={cancellingId === req.id}
                            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              cancellingId === req.id
                                ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-white dark:bg-[#2c2c2e] text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20'
                            }`}
                          >
                            {cancellingId === req.id
                              ? 'Cancelling...'
                              : 'Cancel'}
                          </button>
                        ) : (
                          <span className="text-xs text-[#86868b]">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
