'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface DeletionStatus {
  hasPendingRequest: boolean;
  status?: 'pending' | 'executed' | 'cancelled';
  scheduledAt?: string;
  createdAt?: string;
  cancelledAt?: string | null;
  executedAt?: string | null;
}

const DATA_CATEGORIES = [
  {
    label: 'Events & Audit Logs',
    description: 'All sensitivity scan events, action logs, and compliance audit trails',
  },
  {
    label: 'Pseudonym Maps',
    description: 'Cryptographic mappings between original entities and pseudonymized values',
  },
  {
    label: 'Entity Graphs',
    description: 'Co-occurrence data, inferred entities, and sensitivity patterns',
  },
  {
    label: 'Feedback Records',
    description: 'User feedback on detection accuracy and false positive reports',
  },
  {
    label: 'Webhook Subscriptions & Delivery Logs',
    description: 'All configured webhook endpoints and their delivery history',
  },
  {
    label: 'User Accounts & API Keys',
    description: 'All user records, roles, API keys, and extension registrations',
  },
  {
    label: 'Organization Settings',
    description: 'Firm configuration, department policies, weight overrides, and feature flags',
  },
];

function formatCountdown(scheduledAt: string): string {
  const now = new Date().getTime();
  const target = new Date(scheduledAt).getTime();
  const diff = target - now;

  if (diff <= 0) return 'Imminent';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} min`;
}

export default function DataDeletionPage() {
  const { apiFetch } = useApiClient();

  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Request form
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [countdown, setCountdown] = useState('');

  async function fetchStatus() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/enterprise/deletion-status');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setStatus(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load deletion status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  // Live countdown timer
  useEffect(() => {
    if (status?.status !== 'pending' || !status.scheduledAt) return;
    setCountdown(formatCountdown(status.scheduledAt));
    const interval = setInterval(() => {
      setCountdown(formatCountdown(status.scheduledAt!));
    }, 60000);
    return () => clearInterval(interval);
  }, [status]);

  async function handleRequestDeletion(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== 'DELETE') return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch('/enterprise/request-deletion', {
        method: 'POST',
        body: JSON.stringify({
          confirm: true,
          reason: reason || 'No reason provided',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server responded with ${res.status}`);
      }
      setConfirmText('');
      setReason('');
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to request deletion.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelDeletion() {
    try {
      setCancelling(true);
      setError(null);
      const res = await apiFetch('/enterprise/cancel-deletion', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server responded with ${res.status}`);
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel deletion request.');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">
          Data Deletion
        </h1>
        <div className="space-y-6 animate-pulse">
          <div className="h-4 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-2/3" />
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 space-y-4">
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/3" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-5/6" />
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

  const isPending = status?.status === 'pending';
  const isExecuted = status?.status === 'executed';

  return (
    <div className="max-w-3xl mx-auto py-12">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
        Data Deletion
      </h1>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        GDPR Article 17 — Request permanent deletion of all your
        organization's data.
      </p>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchStatus}
            className="shrink-0 ml-3 underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* State: Executed */}
      {isExecuted && (
        <div className="mb-8 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <svg
              className="w-6 h-6 text-[#6e6e73]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              Data Deletion Complete
            </h2>
          </div>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            All organization data was permanently deleted on{' '}
            <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {new Date(status.executedAt!).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            .
          </p>
        </div>
      )}

      {/* State: Pending */}
      {isPending && (
        <div className="mb-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <svg
              className="w-6 h-6 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300">
              Deletion Scheduled
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm mb-5">
            <div>
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                Requested:
              </span>
              <span className="ml-2 text-amber-800 dark:text-amber-300">
                {new Date(status.createdAt!).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                Scheduled:
              </span>
              <span className="ml-2 text-amber-800 dark:text-amber-300">
                {new Date(status.scheduledAt!).toLocaleDateString()}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                Time remaining:
              </span>
              <span className="ml-2 text-amber-800 dark:text-amber-300 font-semibold">
                {countdown}
              </span>
            </div>
          </div>
          <button
            onClick={handleCancelDeletion}
            disabled={cancelling}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              cancelling
                ? 'bg-amber-200 dark:bg-amber-800 text-amber-500 cursor-not-allowed'
                : 'bg-white dark:bg-[#1c1c1e] text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40'
            }`}
          >
            {cancelling ? 'Cancelling...' : 'Cancel Deletion Request'}
          </button>
        </div>
      )}

      {/* What will be deleted */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden mb-8">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Data Included in Deletion
          </h2>
          <p className="text-xs text-[#86868b] mt-1">
            The following data categories will be permanently removed
          </p>
        </div>
        <div className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
          {DATA_CATEGORIES.map((cat) => (
            <div key={cat.label} className="px-6 py-4 flex items-start gap-3">
              <svg
                className="w-4 h-4 text-red-500 dark:text-red-400 mt-0.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {cat.label}
                </p>
                <p className="text-xs text-[#86868b] mt-0.5">
                  {cat.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone — Request Deletion */}
      {!isPending && !isExecuted && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border-2 border-red-200 dark:border-red-900/60 overflow-hidden">
          <div className="p-6 bg-red-50 dark:bg-red-900/20 border-b-2 border-red-200 dark:border-red-900/60">
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
                Danger Zone
              </h2>
            </div>
          </div>

          <div className="p-6">
            <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1">
                This action will permanently delete all your organization's data
                within 30 days. This cannot be undone.
              </p>
              <p className="text-xs text-red-600 dark:text-red-400">
                A 30-day grace period applies. You may cancel the request at any
                time during this period. After the grace period expires, deletion
                is irreversible.
              </p>
            </div>

            <form onSubmit={handleRequestDeletion} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Reason for deletion (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Switching providers, end of contract, etc."
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Type <span className="font-mono font-bold text-red-600 dark:text-red-400">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || confirmText !== 'DELETE'}
                className={`px-6 py-2.5 rounded-lg text-sm text-white font-medium transition-colors ${
                  submitting || confirmText !== 'DELETE'
                    ? 'bg-red-300 dark:bg-red-900/40 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700'
                }`}
              >
                {submitting ? 'Requesting...' : 'Request Data Deletion'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
