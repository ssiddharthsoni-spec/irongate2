'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../../../lib/api';

interface SsoConfig {
  ssoRequired: boolean;
  provider: string | null;
}

export default function SsoConfigPage() {
  const { apiFetch } = useApiClient();

  const [config, setConfig] = useState<SsoConfig>({ ssoRequired: false, provider: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch SSO config
  // ---------------------------------------------------------------------------
  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch('/enterprise/sso-config');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      setConfig({
        ssoRequired: !!data.ssoRequired,
        provider: data.provider ?? null,
      });
    } catch (err: any) {
      console.error('Failed to fetch SSO config:', err);
      setError(err.message || 'Unable to fetch SSO configuration. The API may be unavailable.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ---------------------------------------------------------------------------
  // Toggle SSO requirement
  // ---------------------------------------------------------------------------
  function handleToggleClick() {
    setFeedback(null);

    // If enabling SSO, show the warning first
    if (!config.ssoRequired) {
      setShowWarning(true);
      return;
    }

    // Disabling SSO — proceed directly
    performToggle(false);
  }

  function handleConfirmEnable() {
    setShowWarning(false);
    performToggle(true);
  }

  async function performToggle(newValue: boolean) {
    try {
      setSaving(true);
      setFeedback(null);

      const response = await apiFetch('/enterprise/sso-config', {
        method: 'PUT',
        body: JSON.stringify({ ssoRequired: newValue }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server responded with ${response.status}`);
      }

      setConfig((prev) => ({ ...prev, ssoRequired: newValue }));
      setFeedback({
        type: 'success',
        text: newValue
          ? 'SSO enforcement enabled. All users must now authenticate via your identity provider.'
          : 'SSO enforcement disabled. Users can sign in with any supported method.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err.message || 'Failed to update SSO configuration. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">
          SSO Configuration
        </h1>
        <div className="space-y-6">
          {/* Skeleton card 1 */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 animate-pulse">
            <div className="h-5 w-40 bg-[#d2d2d7]/60 dark:bg-[#38383a] rounded mb-4" />
            <div className="h-4 w-64 bg-[#d2d2d7]/40 dark:bg-[#38383a]/60 rounded mb-3" />
            <div className="h-4 w-48 bg-[#d2d2d7]/40 dark:bg-[#38383a]/60 rounded" />
          </div>
          {/* Skeleton card 2 */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 animate-pulse">
            <div className="h-5 w-56 bg-[#d2d2d7]/60 dark:bg-[#38383a] rounded mb-4" />
            <div className="flex items-center justify-between">
              <div className="h-4 w-48 bg-[#d2d2d7]/40 dark:bg-[#38383a]/60 rounded" />
              <div className="h-8 w-14 bg-[#d2d2d7]/40 dark:bg-[#38383a]/60 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (error && !config.provider && !config.ssoRequired) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">
          SSO Configuration
        </h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="text-red-600 dark:text-red-400 text-xl font-bold">!</span>
            </div>
            <div>
              <p className="text-base font-semibold text-red-700 dark:text-red-400 mb-1">
                Failed to load SSO configuration
              </p>
              <p className="text-sm text-red-600/80 dark:text-red-400/70">{error}</p>
            </div>
            <button
              type="button"
              onClick={fetchConfig}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e]"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">
        SSO Configuration
      </h1>

      {/* Inline error banner (for non-blocking errors after initial load) */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* SSO Provider Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
          Identity Provider
        </h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Your SSO provider is configured through Clerk. To change providers, update your Clerk organization settings.
        </p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
            <span className="text-sm font-bold text-[#424245] dark:text-[#a1a1a6]">
              {config.provider ? config.provider.charAt(0).toUpperCase() : '?'}
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {config.provider || 'No provider configured'}
            </p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
              {config.provider ? 'Active via Clerk' : 'Configure a provider in Clerk to enable SSO'}
            </p>
          </div>
          <span
            className={`ml-auto px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
              config.provider
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
            }`}
          >
            {config.provider ? 'Connected' : 'Not configured'}
          </span>
        </div>
      </div>

      {/* SSO Enforcement Toggle Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          Require SSO for all users
        </h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5">
          When enabled, every user in your organization must authenticate through your identity provider. Alternative sign-in methods will be disabled.
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                config.ssoRequired
                  ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                  : 'bg-[#86868b]'
              }`}
            />
            <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {config.ssoRequired ? 'SSO enforcement is active' : 'SSO enforcement is off'}
            </span>
          </div>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={config.ssoRequired}
            onClick={handleToggleClick}
            disabled={saving}
            className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
              config.ssoRequired ? 'bg-green-500' : 'bg-[#d2d2d7] dark:bg-[#38383a]'
            } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                config.ssoRequired ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Feedback message */}
      {feedback && (
        <div
          className={`mb-6 p-4 rounded-xl text-sm font-medium ${
            feedback.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Warning Modal — shown when enabling SSO */}
      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-amber-600 dark:text-amber-400 text-lg font-bold">!</span>
              </div>
              <h3 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                Enable SSO Enforcement?
              </h3>
            </div>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6 leading-relaxed">
              Enabling SSO enforcement will require all users to authenticate via your identity
              provider. Users without SSO credentials will be locked out.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowWarning(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEnable}
                disabled={saving}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
                  saving ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Enabling...
                  </span>
                ) : (
                  'Enable SSO'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
