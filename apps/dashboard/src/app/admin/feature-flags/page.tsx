'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../../../lib/api';

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export default function FeatureFlagsPage() {
  const { apiFetch } = useApiClient();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // New flag form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    try {
      const response = await apiFetch('/admin/feature-flags');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      setFlags(data.flags || []);
      setError(null);
    } catch (err: any) {
      setError('Unable to fetch feature flags.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  async function toggleFlag(flag: FeatureFlag) {
    setSaving(flag.key);
    try {
      const response = await apiFetch('/admin/feature-flags', {
        method: 'PUT',
        body: JSON.stringify({
          key: flag.key,
          enabled: !flag.enabled,
          description: flag.description,
        }),
      });
      if (!response.ok) throw new Error(`Failed to update flag`);
      await fetchFlags();
    } catch {
      setError(`Failed to toggle ${flag.key}`);
    } finally {
      setSaving(null);
    }
  }

  async function deleteFlag(key: string) {
    if (!confirm(`Delete feature flag "${key}"? This cannot be undone.`)) return;
    setSaving(key);
    try {
      const response = await apiFetch(`/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`Failed to delete flag`);
      await fetchFlags();
    } catch {
      setError(`Failed to delete ${key}`);
    } finally {
      setSaving(null);
    }
  }

  async function addFlag() {
    if (!newKey.trim()) {
      setAddError('Key is required');
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(newKey)) {
      setAddError('Key must be lowercase snake_case (e.g. tier2_ner)');
      return;
    }
    setAddError(null);
    setSaving('__new__');
    try {
      const response = await apiFetch('/admin/feature-flags', {
        method: 'PUT',
        body: JSON.stringify({
          key: newKey.trim(),
          enabled: false,
          description: newDescription.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create flag');
      }
      setNewKey('');
      setNewDescription('');
      setShowAddForm(false);
      await fetchFlags();
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Loading feature flags...</div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
          <p className="text-sm text-gray-500 mt-1">
            Toggle features for your organization. Changes sync to all extensions within 15 minutes.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-iron-600 text-white rounded-lg text-sm font-medium hover:bg-iron-700 transition-colors"
        >
          {showAddForm ? 'Cancel' : 'Add Flag'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Add Flag Form */}
      {showAddForm && (
        <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-700 mb-3">New Feature Flag</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Key (snake_case)</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. tier2_ner"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What does this flag control?"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
            </div>
            {addError && (
              <p className="text-xs text-red-600">{addError}</p>
            )}
            <button
              onClick={addFlag}
              disabled={saving === '__new__'}
              className="px-4 py-2 bg-iron-600 text-white rounded-md text-sm font-medium hover:bg-iron-700 disabled:opacity-50 transition-colors"
            >
              {saving === '__new__' ? 'Creating...' : 'Create Flag'}
            </button>
          </div>
        </div>
      )}

      {/* Flags List */}
      <div className="bg-white border rounded-lg shadow-sm divide-y">
        {flags.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No feature flags configured. Click &ldquo;Add Flag&rdquo; to create one.
          </div>
        ) : (
          flags.map((flag) => (
            <div key={flag.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono font-medium text-gray-900">{flag.key}</code>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      flag.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {flag.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                {flag.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{flag.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => toggleFlag(flag)}
                  disabled={saving === flag.key}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    flag.enabled ? 'bg-iron-600' : 'bg-gray-200'
                  } ${saving === flag.key ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      flag.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <button
                  onClick={() => deleteFlag(flag.key)}
                  disabled={saving === flag.key}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Delete flag"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        Feature flags are synced to extensions every 15 minutes via policy refresh.
      </p>
    </div>
  );
}
