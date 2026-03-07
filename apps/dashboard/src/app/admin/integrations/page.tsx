'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface ScimStatus {
  hasToken: boolean;
  tokenPrefix: string | null;
  scimBaseUrl: string;
}

export default function IntegrationsPage() {
  const { apiFetch } = useApiClient();

  const [scim, setScim] = useState<ScimStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function fetchScimStatus() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/scim-token');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setScim(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load SCIM status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchScimStatus(); }, []);

  async function handleGenerate() {
    try {
      setGenerating(true);
      setError(null);
      setNewToken(null);
      const res = await apiFetch('/admin/scim-token', { method: 'POST' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setNewToken(data.token);
      await fetchScimStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to generate SCIM token.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke the SCIM token? Any configured identity provider (Okta, Azure AD) will immediately lose access.')) return;
    try {
      setRevoking(true);
      setError(null);
      setNewToken(null);
      const res = await apiFetch('/admin/scim-token', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      await fetchScimStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke SCIM token.');
    } finally {
      setRevoking(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Integrations</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Integrations</h1>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Connect Iron Gate with your identity provider for automated user provisioning.
      </p>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* SCIM Configuration Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">SCIM 2.0 Provisioning</h2>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                Automatically provision and deprovision users via Okta, Azure AD, or any SCIM-compatible identity provider.
              </p>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              scim?.hasToken
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${scim?.hasToken ? 'bg-green-500' : 'bg-[#86868b]'}`} />
              {scim?.hasToken ? 'Active' : 'Not configured'}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
              SCIM Base URL
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 rounded-lg text-sm font-mono">
                {scim?.scimBaseUrl || 'Loading...'}
              </code>
              <button
                onClick={() => copyToClipboard(scim?.scimBaseUrl || '')}
                className="px-3 py-2 text-sm text-iron-600 hover:text-iron-700 dark:text-iron-400 font-medium"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-[#86868b] mt-1">
              Enter this URL in your identity provider&apos;s SCIM configuration.
            </p>
          </div>

          {/* Token Status */}
          <div>
            <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
              Bearer Token
            </label>
            {scim?.hasToken ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] px-3 py-2 rounded-lg text-sm font-mono">
                    {scim.tokenPrefix}
                  </code>
                  <span className="text-xs text-[#86868b]">Token is set. The full value cannot be retrieved.</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                No token generated. Click below to create one.
              </p>
            )}
          </div>

          {/* Newly generated token (shown once) */}
          {newToken && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-600 text-lg">&#9888;</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                    Copy this token now — it won&apos;t be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 rounded border border-amber-300 dark:border-amber-700 text-xs font-mono break-all">
                      {newToken}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newToken)}
                      className="shrink-0 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                generating ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </span>
              ) : scim?.hasToken ? (
                'Rotate Token'
              ) : (
                'Generate Token'
              )}
            </button>

            {scim?.hasToken && (
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {revoking ? 'Revoking...' : 'Revoke Token'}
              </button>
            )}
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] p-6 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Setup Instructions</h3>
          <ol className="text-sm text-[#424245] dark:text-[#a1a1a6] space-y-2 list-decimal list-inside">
            <li>Generate a SCIM bearer token above</li>
            <li>In your identity provider (Okta, Azure AD, OneLogin), create a new SCIM app integration</li>
            <li>Set the <strong>Base URL</strong> to the SCIM Base URL shown above</li>
            <li>Set the <strong>Authentication</strong> to &quot;OAuth Bearer Token&quot; and paste the generated token</li>
            <li>Enable user provisioning and group push</li>
            <li>Test the connection — your IdP should show a successful connection</li>
          </ol>
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide mb-2">Supported Operations</h4>
            <div className="flex flex-wrap gap-2">
              {['Create Users', 'Update Users', 'Deactivate Users', 'Create Groups', 'Push Groups', 'Group Membership'].map(op => (
                <span key={op} className="inline-block bg-white dark:bg-[#1c1c1e] text-[#424245] dark:text-[#a1a1a6] text-xs font-medium px-2 py-1 rounded border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                  {op}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
