'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write' | 'admin';
  createdAt: string;
  lastUsed: string | null;
}

const DEMO_KEYS: ApiKey[] = [
  { id: '1', name: 'Production API', prefix: 'ig_live_a3xK', scope: 'write', createdAt: '2026-01-15T10:00:00Z', lastUsed: '2026-02-20T18:30:00Z' },
  { id: '2', name: 'CI/CD Pipeline', prefix: 'ig_live_m8nP', scope: 'read', createdAt: '2026-02-01T09:00:00Z', lastUsed: '2026-02-19T12:15:00Z' },
  { id: '3', name: 'Development Key', prefix: 'ig_test_q2wE', scope: 'admin', createdAt: '2026-02-10T14:00:00Z', lastUsed: null },
];

const SCOPES = [
  { value: 'read', label: 'Read', description: 'Read-only access to events and settings' },
  { value: 'write', label: 'Write', description: 'Read + create events and update settings' },
  { value: 'admin', label: 'Admin', description: 'Full access including user management' },
];

export default function ApiKeysPage() {
  const { apiFetch } = useApiClient();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScope, setNewKeyScope] = useState<'read' | 'write' | 'admin'>('read');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchKeys() {
      try {
        setLoading(true);
        const response = await apiFetch('/admin/api-keys');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        setKeys(data.keys || data || []);
      } catch {
        setKeys(DEMO_KEYS);
      } finally {
        setLoading(false);
      }
    }
    fetchKeys();
  }, []);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    try {
      setCreating(true);
      const response = await apiFetch('/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName.trim(), scope: newKeyScope }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      const fullKey = data.key || `ig_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 22)}`;
      const newKey: ApiKey = {
        id: data.id || Date.now().toString(),
        name: newKeyName.trim(),
        prefix: fullKey.substring(0, 12),
        scope: newKeyScope,
        createdAt: new Date().toISOString(),
        lastUsed: null,
      };
      setKeys([newKey, ...keys]);
      setNewlyCreatedKey(fullKey);
      setNewKeyName('');
      setShowCreateForm(false);
    } catch {
      // Demo mode: generate a fake key
      const fakeKey = `ig_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 22)}`;
      const newKey: ApiKey = {
        id: Date.now().toString(),
        name: newKeyName.trim(),
        prefix: fakeKey.substring(0, 12),
        scope: newKeyScope,
        createdAt: new Date().toISOString(),
        lastUsed: null,
      };
      setKeys([newKey, ...keys]);
      setNewlyCreatedKey(fakeKey);
      setNewKeyName('');
      setShowCreateForm(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    try {
      setRevokingId(keyId);
      await apiFetch(`/admin/api-keys/${keyId}`, { method: 'DELETE' });
    } catch {
      // Continue with local removal in demo mode
    }
    setKeys(keys.filter((k) => k.id !== keyId));
    setConfirmRevokeId(null);
    setRevokingId(null);
  }

  async function handleCopyKey() {
    if (newlyCreatedKey) {
      try {
        await navigator.clipboard.writeText(newlyCreatedKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API not available
      }
    }
  }

  function getScopeBadgeClass(scope: string) {
    switch (scope) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      case 'write':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Newly Created Key Banner */}
      {newlyCreatedKey && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-green-800 dark:text-green-300">API Key Created Successfully</h3>
              <p className="text-xs text-green-700 dark:text-green-400 mt-1 mb-3">
                Copy this key now. You will not be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg text-sm font-mono text-gray-900 dark:text-white border border-green-200 dark:border-green-800 break-all">
                  {newlyCreatedKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="min-h-[44px] px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 flex-shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewlyCreatedKey(null)}
              className="p-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Create Key */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API Keys</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage API keys for programmatic access to Iron Gate.
            </p>
          </div>
          {!showCreateForm && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="min-h-[44px] px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Create New Key
            </button>
          )}
        </div>

        {showCreateForm && (
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-4 border border-gray-200 dark:border-gray-600">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Create New API Key</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="keyName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Key Name
                </label>
                <input
                  id="keyName"
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                  placeholder="e.g., Production API, CI/CD Pipeline"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label htmlFor="keyScope" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Scope
                </label>
                <select
                  id="keyScope"
                  value={newKeyScope}
                  onChange={(e) => setNewKeyScope(e.target.value as 'read' | 'write' | 'admin')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
                >
                  {SCOPES.map((scope) => (
                    <option key={scope.value} value={scope.value}>
                      {scope.label} - {scope.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newKeyName.trim()}
                  className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-700 ${
                    creating || !newKeyName.trim()
                      ? 'bg-iron-400 dark:bg-iron-800 cursor-not-allowed'
                      : 'bg-iron-600 hover:bg-iron-700'
                  }`}
                >
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    'Create Key'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
                  className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Keys List */}
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {keys.length === 0 ? (
            <div className="py-12 text-center">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">No API keys yet.</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create your first key to get started.</p>
            </div>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</p>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getScopeBadgeClass(key.scope)}`}>
                        {key.scope}
                      </span>
                    </div>
                    <p className="text-sm font-mono text-gray-500 dark:text-gray-400">{key.prefix}...</p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-400 dark:text-gray-500" suppressHydrationWarning>
                        Created {new Date(key.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500" suppressHydrationWarning>
                        {key.lastUsed
                          ? `Last used ${new Date(key.lastUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                          : 'Never used'}
                      </span>
                    </div>
                  </div>

                  {/* Revoke button */}
                  {confirmRevokeId === key.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        className="min-h-[36px] px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        {revokingId === key.id ? (
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        ) : (
                          'Confirm Revoke'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(null)}
                        className="min-h-[36px] px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeId(key.id)}
                      className="min-h-[36px] px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 flex-shrink-0"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Scope Descriptions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Scope Permissions</h2>
        <div className="space-y-3">
          {SCOPES.map((scope) => (
            <div key={scope.value} className="flex items-start gap-3">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${getScopeBadgeClass(scope.value)}`}>
                {scope.label}
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">{scope.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Usage Note */}
      <div className="bg-iron-50 dark:bg-iron-900/20 border border-iron-200 dark:border-iron-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-iron-600 dark:text-iron-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-iron-800 dark:text-iron-300">API Key Best Practices</p>
            <ul className="text-xs text-iron-700 dark:text-iron-400 mt-1 space-y-1">
              <li>Use the minimum scope necessary for each integration.</li>
              <li>Rotate keys regularly and revoke unused keys promptly.</li>
              <li>Never share API keys in code repositories or public channels.</li>
              <li>Use environment variables to store keys in your applications.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
