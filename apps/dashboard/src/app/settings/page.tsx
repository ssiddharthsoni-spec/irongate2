'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../lib/api';

const INDUSTRIES = [
  { value: 'general', label: 'General' },
  { value: 'legal', label: 'Legal' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'technology', label: 'Technology' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'government', label: 'Government' },
  { value: 'education', label: 'Education' },
];

const RETENTION_OPTIONS = [30, 60, 90, 180];

export default function GeneralSettingsPage() {
  const { apiFetch } = useApiClient();

  const [firmName, setFirmName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [retention, setRetention] = useState(90);
  // Optimistic-lock token — read on GET, echoed on PUT. Server uses it
  // to reject concurrent writes with 409 instead of silently clobbering
  // another admin's edits.
  const [firmVersion, setFirmVersion] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchConfig() {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch('/admin/firm');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      if (data.name) setFirmName(data.name);
      if (data.config?.industry) setIndustry(data.config.industry);
      if (data.config?.retention) setRetention(data.config.retention);
      if (typeof data.version === 'number') setFirmVersion(data.version);
    } catch (err: any) {
      setError(err.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
  }, []);

  async function handleSave() {
    if (firmVersion === null) {
      setSaveMessage({ type: 'error', text: 'Firm config not loaded yet. Try again in a moment.' });
      return;
    }
    try {
      setSaving(true);
      setSaveMessage(null);
      const response = await apiFetch('/admin/firm', {
        method: 'PUT',
        body: JSON.stringify({
          name: firmName,
          config: { industry, retention },
          version: firmVersion,
        }),
      });

      // Optimistic-lock conflict — another admin wrote between our read
      // and our write. The server tells us the current version. Refetch
      // transparently so the user can re-apply their changes on fresh state.
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        setSaveMessage({
          type: 'error',
          text:
            body?.message ||
            'This firm was modified by someone else. Refreshing the form — please re-apply your changes.',
        });
        await fetchConfig();
        return;
      }

      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const updated = await response.json().catch(() => null);
      if (updated && typeof updated.version === 'number') setFirmVersion(updated.version);
      setSaveMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <div className="h-5 w-32 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse mb-4" />
            <div className="h-10 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const retentionIndex = RETENTION_OPTIONS.indexOf(retention) !== -1
    ? RETENTION_OPTIONS.indexOf(retention)
    : 2;

  return (
    <div className="space-y-6 max-w-2xl">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={fetchConfig}
            className="ml-4 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Firm Details */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Firm Details</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="firmName" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              Firm Name
            </label>
            <input
              id="firmName"
              type="text"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="Enter firm name"
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label htmlFor="industry" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              Industry
            </label>
            <select
              id="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            >
              {INDUSTRIES.map((ind) => (
                <option key={ind.value} value={ind.value}>{ind.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Protection Mode */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Protection Mode</h2>
        <div className="flex items-center gap-3 p-4 bg-iron-50 dark:bg-iron-900/20 rounded-lg border border-iron-200 dark:border-iron-800">
          <div className="w-10 h-10 bg-iron-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-iron-800 dark:text-iron-200">Protect Mode Active</p>
            <p className="text-xs text-iron-600 dark:text-iron-400">
              Sensitive data is automatically redacted before reaching AI services.
            </p>
          </div>
        </div>
      </div>

      {/* Data Retention */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Data Retention</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          How long event data is retained before automatic deletion.
        </p>
        <div>
          <input
            type="range"
            min="0"
            max={RETENTION_OPTIONS.length - 1}
            value={retentionIndex}
            onChange={(e) => setRetention(RETENTION_OPTIONS[parseInt(e.target.value)])}
            className="w-full accent-iron-600"
            aria-label="Data retention period"
          />
          <div className="flex justify-between mt-2">
            {RETENTION_OPTIONS.map((days) => (
              <span
                key={days}
                className={`text-xs font-medium ${
                  retention === days
                    ? 'text-iron-600 dark:text-iron-400'
                    : 'text-[#86868b] dark:text-[#636366]'
                }`}
              >
                {days} days
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] ${
            saving
              ? 'bg-iron-400 dark:bg-iron-800 cursor-not-allowed'
              : 'bg-iron-600 hover:bg-iron-700'
          }`}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            'Save Settings'
          )}
        </button>
        {saveMessage && (
          <span className={`text-sm font-medium ${saveMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {saveMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}
