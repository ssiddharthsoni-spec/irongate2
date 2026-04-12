'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useApiClient } from '../../lib/api';

export default function AdminPage() {
  const { apiFetch } = useApiClient();
  const [firmName, setFirmName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [mode] = useState<'proxy'>('proxy');

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

        // Mode is always proxy — no need to initialize from API
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

      // Strip CSV formula injection characters (=, +, -, @, tab, carriage return)
      const sanitizeCsvCell = (cell: string): string => cell.replace(/^[=+\-@\t\r]+/, '');

      const matters = lines.slice(startIndex).map((line) => {
        const parts = line.split(',').map((p) => sanitizeCsvCell(p.trim()));
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
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Admin Settings</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading configuration...</span>
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
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Admin Settings</h1>

      {/* Firm Details */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border dark:border-[#38383a]/60 mb-6">
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

      {/* Save Firm Details */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
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
              saveMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {saveMessage.text}
          </span>
        )}
      </div>

      {/* Admin Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Link
          href="/admin/enrollment"
          className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-700 transition-colors group"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-iron-50 dark:bg-iron-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] group-hover:text-iron-600 dark:group-hover:text-iron-400 transition-colors">
                Enrollment Codes
              </h3>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                Create and manage enrollment codes for employee onboarding.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/admin/departments"
          className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-700 transition-colors group"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-iron-50 dark:bg-iron-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] group-hover:text-iron-600 dark:group-hover:text-iron-400 transition-colors">
                Department Policies
              </h3>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                Configure per-team AI usage policies and restrictions.
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Client/Matter Import */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Client/Matter Data</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Import client and matter data to enhance detection accuracy.
          Upload a CSV with columns: clientName, matterNumber, aliases, parties.
        </p>
        <div className="border-2 border-dashed border-[#d2d2d7] dark:border-[#38383a] rounded-lg p-8 text-center">
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Uploading and processing CSV...</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#86868b] dark:text-[#636366]">Drag and drop CSV file here, or click to browse</p>
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
                className="mt-3 px-4 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] rounded-lg text-sm hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a]"
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
