'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/lib/api';

/* -- Types ----------------------------------------------------------------- */

interface Webhook {
  id: string;
  url: string;
  secret: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
}

interface Delivery {
  id: string;
  webhookId: string;
  eventType: string;
  statusCode: number | null;
  responseBody?: string | null;
  attemptNumber: number;
  attempt?: number;
  deliveredAt: string;
  success: boolean;
  error?: string | null;
}

/* -- Helpers --------------------------------------------------------------- */

const AVAILABLE_EVENT_TYPES = ['high_risk_detected', 'event_created', '*'];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusCodeColor(code: number | null): string {
  if (code === null) return 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]';
  if (code >= 200 && code < 300) return 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400';
  if (code >= 400 && code < 500) return 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400';
  if (code >= 500) return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400';
  return 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]';
}

/* -- Skeleton -------------------------------------------------------------- */

function LoadingSkeleton() {
  return (
    <div className="max-w-5xl">
      <div className="h-8 w-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-8" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}

/* -- Delivery Log Component ------------------------------------------------ */

function DeliveryLog({ webhookId }: { webhookId: string }) {
  const { apiFetch } = useApiClient();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redelivering, setRedelivering] = useState<Set<string>>(new Set());
  const [redelivered, setRedelivered] = useState<Set<string>>(new Set());

  const fetchDeliveries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/enterprise/webhook-deliveries/${webhookId}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setDeliveries(data.deliveries ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery log.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, webhookId]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  async function handleRedeliver(deliveryId: string) {
    try {
      setRedelivering((prev) => new Set(prev).add(deliveryId));
      const res = await apiFetch(`/enterprise/webhook-deliveries/${deliveryId}/redeliver`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setRedelivered((prev) => new Set(prev).add(deliveryId));
      // Refresh the list after a short delay to show the new attempt
      setTimeout(() => fetchDeliveries(), 1500);
    } catch {
      // Silently handle — the button will reset
    } finally {
      setRedelivering((prev) => {
        const next = new Set(prev);
        next.delete(deliveryId);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
          <span className="text-xs text-[#86868b]">Loading delivery log...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-4">
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400">
          <span>{error}</span>
          <button
            onClick={fetchDeliveries}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="px-6 py-6 text-center">
        <p className="text-xs text-[#86868b]">No deliveries recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#86868b] mb-3">
        Recent Deliveries
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] font-medium text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <th className="pb-2 pr-4">Event Type</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Attempt</th>
              <th className="pb-2 pr-4">Delivered At</th>
              <th className="pb-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#d2d2d7]/20 dark:divide-[#38383a]/40">
            {deliveries.map((d) => {
              const attemptNum = d.attemptNumber ?? d.attempt ?? 1;
              const isRedelivering = redelivering.has(d.id);
              const wasRedelivered = redelivered.has(d.id);
              return (
                <tr key={d.id} className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span className="font-mono bg-[#f5f5f7] dark:bg-[#2c2c2e] px-2 py-0.5 rounded text-[#424245] dark:text-[#a1a1a6]">
                      {d.eventType}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full ${statusCodeColor(d.statusCode)}`}
                    >
                      {d.statusCode ?? 'N/A'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                    #{attemptNum}
                  </td>
                  <td className="py-2.5 pr-4 text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap tabular-nums">
                    {formatTimestamp(d.deliveredAt)}
                  </td>
                  <td className="py-2.5 text-right">
                    {!d.success && (
                      <button
                        onClick={() => handleRedeliver(d.id)}
                        disabled={isRedelivering || wasRedelivered}
                        className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 ${
                          wasRedelivered
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 cursor-default'
                            : isRedelivering
                              ? 'bg-iron-100 dark:bg-iron-900/20 text-iron-400 cursor-not-allowed'
                              : 'bg-iron-600 hover:bg-iron-700 text-white'
                        }`}
                      >
                        {wasRedelivered ? 'Queued' : isRedelivering ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Sending...
                          </span>
                        ) : 'Re-deliver'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -- Page ------------------------------------------------------------------ */

export default function WebhooksPage() {
  const { apiFetch } = useApiClient();

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEventTypes, setFormEventTypes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch webhooks
  // ---------------------------------------------------------------------------
  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/webhooks');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setWebhooks(Array.isArray(data) ? data : data.webhooks ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  // ---------------------------------------------------------------------------
  // Add webhook
  // ---------------------------------------------------------------------------
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formUrl.trim()) return;

    try {
      setSubmitting(true);
      setFormError(null);
      const res = await apiFetch('/admin/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: formUrl.trim(),
          secret: formSecret.trim(),
          eventTypes: formEventTypes,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setFormUrl('');
      setFormSecret('');
      setFormEventTypes([]);
      setShowForm(false);
      await fetchWebhooks();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create webhook.');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete webhook
  // ---------------------------------------------------------------------------
  async function handleDelete(id: string) {
    try {
      setDeletingId(id);
      const res = await apiFetch(`/admin/webhooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook.');
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle event type checkbox
  // ---------------------------------------------------------------------------
  function toggleEventType(type: string) {
    setFormEventTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return <LoadingSkeleton />;
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
          Admin
        </Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Webhooks</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Webhooks</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Webhook'}
        </button>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Manage webhook subscriptions and inspect delivery history. Click a webhook to view its delivery log.
      </p>

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400">
          <span>{error}</span>
          <button
            onClick={() => { setError(null); fetchWebhooks(); }}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Add Webhook form */}
      {showForm && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Add Webhook</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Endpoint URL
              </label>
              <input
                type="url"
                required
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Secret
              </label>
              <input
                type="text"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                placeholder="whsec_..."
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
                Event Types
              </label>
              <div className="flex flex-wrap gap-3">
                {AVAILABLE_EVENT_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-[#424245] dark:text-[#a1a1a6]">
                    <input
                      type="checkbox"
                      checked={formEventTypes.includes(type)}
                      onChange={() => toggleEventType(type)}
                      className="rounded border-[#d2d2d7] text-iron-600 focus:ring-iron-500"
                    />
                    <span className="font-mono text-xs bg-[#f5f5f7] dark:bg-[#2c2c2e] px-2 py-0.5 rounded">
                      {type}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                {formError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                  submitting
                    ? 'bg-iron-400 cursor-not-allowed'
                    : 'bg-iron-600 hover:bg-iron-700'
                }`}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  'Create Webhook'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Webhooks list */}
      {webhooks.length === 0 ? (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] text-center py-8">
            No webhooks configured. Click &quot;Add Webhook&quot; to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => {
            const isExpanded = expandedId === wh.id;
            return (
              <div
                key={wh.id}
                className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden transition-all"
              >
                {/* Webhook summary row */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : wh.id)}
                  className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors"
                >
                  {/* Expand/collapse chevron */}
                  <svg
                    className={`w-4 h-4 shrink-0 text-[#86868b] transition-transform duration-200 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>

                  {/* URL */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate font-mono">
                      {wh.url}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {wh.eventTypes.map((et) => (
                        <span
                          key={et}
                          className="inline-block bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 text-[11px] font-medium px-2 py-0.5 rounded-full"
                        >
                          {et}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Status badge */}
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
                      wh.isActive
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        wh.isActive ? 'bg-green-500' : 'bg-[#86868b]'
                      }`}
                    />
                    {wh.isActive ? 'Active' : 'Inactive'}
                  </span>

                  {/* Created date */}
                  <span className="text-xs text-[#86868b] whitespace-nowrap shrink-0 hidden sm:block">
                    {new Date(wh.createdAt).toLocaleDateString()}
                  </span>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(wh.id);
                    }}
                    disabled={deletingId === wh.id}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed shrink-0 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    {deletingId === wh.id ? 'Deleting...' : 'Delete'}
                  </button>
                </button>

                {/* Expanded delivery log */}
                {isExpanded && (
                  <div className="border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-[#fafafa] dark:bg-[#161617]">
                    <DeliveryLog webhookId={wh.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
