'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  code: string;
  entityTypes: string[];
  isActive: boolean;
  hitCount: number;
  falsePositiveRate: number;
  createdAt: string;
}

export default function PluginsPage() {
  const { apiFetch } = useApiClient();

  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formVersion, setFormVersion] = useState('1.0.0');
  const [formCode, setFormCode] = useState('');
  const [formEntityTypes, setFormEntityTypes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Toggle / delete state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch plugins
  // ---------------------------------------------------------------------------
  async function fetchPlugins() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/plugins');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setPlugins(Array.isArray(data) ? data : data.plugins ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load plugins.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlugins();
  }, []);

  // ---------------------------------------------------------------------------
  // Upload plugin
  // ---------------------------------------------------------------------------
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formCode.trim()) return;

    const entityTypes = formEntityTypes
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      setSubmitting(true);
      setFormError(null);
      const res = await apiFetch('/admin/plugins', {
        method: 'POST',
        body: JSON.stringify({
          name: formName.trim(),
          description: formDescription.trim(),
          version: formVersion.trim(),
          code: formCode,
          entityTypes,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setFormName('');
      setFormDescription('');
      setFormVersion('1.0.0');
      setFormCode('');
      setFormEntityTypes('');
      setShowForm(false);
      await fetchPlugins();
    } catch (err: any) {
      setFormError(err.message || 'Failed to upload plugin.');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle active state
  // ---------------------------------------------------------------------------
  async function handleToggle(plugin: Plugin) {
    try {
      setTogglingId(plugin.id);
      const res = await apiFetch(`/admin/plugins/${plugin.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !plugin.isActive }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id ? { ...p, isActive: !p.isActive } : p,
        ),
      );
    } catch (err: any) {
      setError(err.message || 'Failed to toggle plugin.');
    } finally {
      setTogglingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete plugin
  // ---------------------------------------------------------------------------
  async function handleDelete(id: string) {
    try {
      setDeletingId(id);
      const res = await apiFetch(`/admin/plugins/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setPlugins((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete plugin.');
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Plugins</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-500">Loading plugins...</span>
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
        <h1 className="text-2xl font-bold text-gray-900">Plugins</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : 'Upload Plugin'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Upload Plugin form */}
      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Plugin</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Custom Plugin"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Version
                </label>
                <input
                  type="text"
                  value={formVersion}
                  onChange={(e) => setFormVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="A brief description of what this plugin does"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entity Types
              </label>
              <input
                type="text"
                value={formEntityTypes}
                onChange={(e) => setFormEntityTypes(e.target.value)}
                placeholder="client_name, matter_number, ssn (comma-separated)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Comma-separated list of entity types this plugin detects.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Code
              </label>
              <textarea
                required
                rows={10}
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="// Plugin detection logic..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
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
                    Uploading...
                  </span>
                ) : (
                  'Upload Plugin'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plugins table */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        {plugins.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No plugins installed. Click &quot;Upload Plugin&quot; to add one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-3 font-medium text-gray-500">Name</th>
                  <th className="pb-3 font-medium text-gray-500">Version</th>
                  <th className="pb-3 font-medium text-gray-500">Entity Types</th>
                  <th className="pb-3 font-medium text-gray-500">Hits</th>
                  <th className="pb-3 font-medium text-gray-500">FP Rate</th>
                  <th className="pb-3 font-medium text-gray-500">Status</th>
                  <th className="pb-3 font-medium text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plugins.map((plugin) => (
                  <tr key={plugin.id}>
                    <td className="py-3 pr-4">
                      <div>
                        <p className="font-medium text-gray-900">{plugin.name}</p>
                        {plugin.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                            {plugin.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-gray-600">{plugin.version}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {plugin.entityTypes.map((et) => (
                          <span
                            key={et}
                            className="inline-block bg-iron-50 text-iron-700 text-xs font-medium px-2 py-0.5 rounded-full"
                          >
                            {et}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-gray-600 tabular-nums">
                      {plugin.hitCount.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`text-xs font-medium ${
                          plugin.falsePositiveRate > 0.2
                            ? 'text-red-600'
                            : plugin.falsePositiveRate > 0.1
                              ? 'text-yellow-600'
                              : 'text-green-600'
                        }`}
                      >
                        {(plugin.falsePositiveRate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        onClick={() => handleToggle(plugin)}
                        disabled={togglingId === plugin.id}
                        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: plugin.isActive ? '#4c6ef5' : '#d1d5db',
                        }}
                        role="switch"
                        aria-checked={plugin.isActive}
                      >
                        <span
                          className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            plugin.isActive ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleDelete(plugin.id)}
                        disabled={deletingId === plugin.id}
                        className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === plugin.id ? 'Deleting...' : 'Delete'}
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
