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
  const [mode, setMode] = useState<'audit' | 'proxy'>('audit');
  const [retention, setRetention] = useState(90);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Demo data fallback
  const DEMO_CONFIG = {
    firmName: 'Acme Legal LLP',
    industry: 'legal',
    mode: 'audit' as const,
    retention: 90,
  };

  useEffect(() => {
    async function fetchConfig() {
      try {
        setLoading(true);
        const response = await apiFetch('/admin/firm');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.firmName) setFirmName(data.firmName);
        if (data.industry) setIndustry(data.industry);
        if (data.mode === 'audit' || data.mode === 'proxy') setMode(data.mode);
        if (data.retention) setRetention(data.retention);
      } catch {
        // Fallback to demo data
        setFirmName(DEMO_CONFIG.firmName);
        setIndustry(DEMO_CONFIG.industry);
        setMode(DEMO_CONFIG.mode);
        setRetention(DEMO_CONFIG.retention);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage(null);
      const response = await apiFetch('/admin/firm', {
        method: 'PUT',
        body: JSON.stringify({ firmName, industry, mode, retention }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
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
          <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
            <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
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
      {/* Firm Details */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Firm Details</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="firmName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Firm Name
            </label>
            <input
              id="firmName"
              type="text"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="Enter firm name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label htmlFor="industry" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Industry
            </label>
            <select
              id="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            >
              {INDUSTRIES.map((ind) => (
                <option key={ind.value} value={ind.value}>{ind.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Protection Mode */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Protection Mode</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setMode('audit')}
            className={`p-4 rounded-lg border-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
              mode === 'audit'
                ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <p className="font-medium text-gray-900 dark:text-white">Audit Mode</p>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Monitor only. No interference with AI tool usage.</p>
          </button>
          <button
            type="button"
            onClick={() => setMode('proxy')}
            className={`p-4 rounded-lg border-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
              mode === 'proxy'
                ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
              </svg>
              <p className="font-medium text-gray-900 dark:text-white">Proxy Mode</p>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Intercept and protect sensitive prompts automatically.</p>
          </button>
        </div>
      </div>

      {/* Data Retention */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Data Retention</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
                    : 'text-gray-400 dark:text-gray-500'
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
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
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
