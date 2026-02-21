'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface Webhook {
  id: string;
  url: string;
  secret: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
}

const AVAILABLE_EVENT_TYPES = ['high_risk_detected', 'event_created', '*'];

export default function WebhooksPage() {
  const { apiFetch } = useApiClient();

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  async function fetchWebhooks() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/webhooks');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setWebhooks(Array.isArray(data) ? data : data.webhooks ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load webhooks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWebhooks();
  }, []);

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
    } catch (err: any) {
      setFormError(err.message || 'Failed to create webhook.');
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
    } catch (err: any) {
      setError(err.message || 'Failed to delete webhook.');
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
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Webhooks</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-500">Loading webhooks...</span>
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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Webhook'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Add Webhook form */}
      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Webhook</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Endpoint URL
              </label>
              <input
                type="url"
                required
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secret
              </label>
              <input
                type="text"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                placeholder="whsec_..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Event Types
              </label>
              <div className="flex flex-wrap gap-3">
                {AVAILABLE_EVENT_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formEventTypes.includes(type)}
                      onChange={() => toggleEventType(type)}
                      className="rounded border-gray-300 text-iron-600 focus:ring-iron-500"
                    />
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {type}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
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

      {/* Webhooks table */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        {webhooks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No webhooks configured. Click &quot;Add Webhook&quot; to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-3 font-medium text-gray-500">URL</th>
                  <th className="pb-3 font-medium text-gray-500">Event Types</th>
                  <th className="pb-3 font-medium text-gray-500">Status</th>
                  <th className="pb-3 font-medium text-gray-500">Created</th>
                  <th className="pb-3 font-medium text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {webhooks.map((wh) => (
                  <tr key={wh.id}>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs break-all">{wh.url}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {wh.eventTypes.map((et) => (
                          <span
                            key={et}
                            className="inline-block bg-iron-50 text-iron-700 text-xs font-medium px-2 py-0.5 rounded-full"
                          >
                            {et}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                          wh.isActive
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            wh.isActive ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        {wh.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">
                      {new Date(wh.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleDelete(wh.id)}
                        disabled={deletingId === wh.id}
                        className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === wh.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
