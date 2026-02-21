'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApiClient } from '../../lib/api';

export default function AdminPage() {
  const { apiFetch } = useApiClient();
  const [firmName, setFirmName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [mode, setMode] = useState<'audit' | 'proxy'>('audit');
  const [thresholds, setThresholds] = useState({ warn: 40, block: 70, proxy: 50 });

  // Loading / feedback states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // 1. Load firm config on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function fetchFirmConfig() {
      try {
        setLoading(true);
        const response = await apiFetch('/admin/firm');

        if (!response.ok) throw new Error(`Server responded with ${response.status}`);

        const data = await response.json();

        // Initialize firm name and industry from API response
        if (data.firmName) setFirmName(data.firmName);
        if (data.industry) setIndustry(data.industry);

        // Initialize mode from API response
        if (data.mode === 'audit' || data.mode === 'proxy') {
          setMode(data.mode);
        }

        // Initialize thresholds from API response
        if (data.config?.thresholds) {
          const t = data.config.thresholds;
          setThresholds({
            warn: t.passthrough ?? 25,
            block: t.cloudMasked ?? 75,
            proxy: t.cloudMasked ?? 75,
          });
        }
      } catch (err) {
        console.error('Failed to load firm config:', err);
        // Keep default local state if API is unavailable
      } finally {
        setLoading(false);
      }
    }

    fetchFirmConfig();
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Save thresholds + mode
  // ---------------------------------------------------------------------------
  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage(null);

      const response = await apiFetch('/admin/firm', {
        method: 'PUT',
        body: JSON.stringify({
          firmName,
          industry,
          mode,
          config: {
            thresholds: {
              passthrough: thresholds.warn,
              cloudMasked: thresholds.block,
            },
          },
        }),
      });

      if (!response.ok) throw new Error(`Server responded with ${response.status}`);

      setSaveMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch (err: any) {
      setSaveMessage({
        type: 'error',
        text: err.message || 'Failed to save settings. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CSV upload + parse + POST
  // ---------------------------------------------------------------------------
  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setUploadMessage(null);

      const text = await file.text();
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

      // Skip header row if it looks like a header
      const startIndex = lines[0]?.toLowerCase().includes('clientname') ? 1 : 0;

      const matters = lines.slice(startIndex).map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          clientName: parts[0] || '',
          matterNumber: parts[1] || '',
          sensitivityLevel: 'medium' as const,
        };
      }).filter((m) => m.clientName && m.matterNumber);

      if (matters.length === 0) {
        setUploadMessage({ type: 'error', text: 'No valid records found in CSV. Expected columns: clientName, matterNumber.' });
        return;
      }

      const response = await apiFetch('/admin/client-matters', {
        method: 'POST',
        body: JSON.stringify({ matters }),
      });

      if (!response.ok) throw new Error(`Server responded with ${response.status}`);

      setUploadMessage({
        type: 'success',
        text: `Successfully imported ${matters.length} client-matter record${matters.length !== 1 ? 's' : ''}.`,
      });
    } catch (err: any) {
      setUploadMessage({
        type: 'error',
        text: err.message || 'Failed to upload client-matter data. Please try again.',
      });
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">Admin Settings</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-500 dark:text-gray-400">Loading configuration...</span>
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">Admin Settings</h1>

      {/* Firm Details */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border dark:border-gray-700 mb-6">
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
              <option value="general">General</option>
              <option value="legal">Legal</option>
              <option value="finance">Finance</option>
              <option value="healthcare">Healthcare</option>
              <option value="technology">Technology</option>
              <option value="consulting">Consulting</option>
              <option value="manufacturing">Manufacturing</option>
            </select>
          </div>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border dark:border-gray-700 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Operation Mode</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setMode('audit')}
            className={`p-4 rounded-lg border-2 text-left ${
              mode === 'audit' ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20' : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <p className="font-medium dark:text-white">Audit Mode</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Monitor only. No interference with AI tool usage.</p>
          </button>
          <button
            onClick={() => setMode('proxy')}
            className={`p-4 rounded-lg border-2 text-left ${
              mode === 'proxy' ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20' : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <p className="font-medium dark:text-white">Proxy Mode</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Intercept and protect sensitive prompts automatically.</p>
          </button>
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border dark:border-gray-700 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Sensitivity Thresholds</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Warn Threshold: {thresholds.warn}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.warn}
              onChange={(e) => setThresholds({ ...thresholds, warn: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Block Threshold: {thresholds.block}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.block}
              onChange={(e) => setThresholds({ ...thresholds, block: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proxy Threshold: {thresholds.proxy}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.proxy}
              onChange={(e) => setThresholds({ ...thresholds, proxy: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
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
            <span
              className={`text-sm font-medium ${
                saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {saveMessage.text}
            </span>
          )}
        </div>
      </div>

      {/* Client/Matter Import */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Client/Matter Data</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Import client and matter data to enhance detection accuracy.
          Upload a CSV with columns: clientName, matterNumber, aliases, parties.
        </p>
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Uploading and processing CSV...</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-400 dark:text-gray-500">Drag and drop CSV file here, or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                aria-label="Upload CSV file"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Browse Files
              </button>
            </>
          )}
        </div>

        {uploadMessage && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm font-medium ${
              uploadMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}
          >
            {uploadMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}
