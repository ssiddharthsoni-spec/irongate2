'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface DpaStatus {
  currentVersion: string;
  accepted: boolean;
  lastAccepted: {
    version: string;
    signerName: string;
    signerTitle: string | null;
    signerEmail: string;
    acceptedAt: string;
  } | null;
}

export default function DpaPage() {
  const { apiFetch } = useApiClient();

  const [status, setStatus] = useState<DpaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function fetchStatus() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/enterprise/dpa');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setStatus(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load DPA status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStatus(); }, []);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch('/enterprise/dpa/accept', {
        method: 'POST',
        body: JSON.stringify({ signerName, signerTitle: signerTitle || undefined, signerEmail }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setSuccess(true);
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to accept DPA.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Data Processing Agreement</h1>
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-12">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Data Processing Agreement</h1>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Review and accept the DPA to enable enterprise data processing features.
      </p>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchStatus} className="shrink-0 ml-3 underline font-semibold">Retry</button>
        </div>
      )}

      {/* Acceptance Status */}
      {status?.accepted && status.lastAccepted && (
        <div className="mb-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <h2 className="text-lg font-semibold text-green-800 dark:text-green-300">DPA Accepted</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-green-700 dark:text-green-400 font-medium">Signer:</span>
              <span className="ml-2 text-green-800 dark:text-green-300">{status.lastAccepted.signerName}</span>
            </div>
            <div>
              <span className="text-green-700 dark:text-green-400 font-medium">Version:</span>
              <span className="ml-2 text-green-800 dark:text-green-300">{status.lastAccepted.version}</span>
            </div>
            <div>
              <span className="text-green-700 dark:text-green-400 font-medium">Email:</span>
              <span className="ml-2 text-green-800 dark:text-green-300">{status.lastAccepted.signerEmail}</span>
            </div>
            <div>
              <span className="text-green-700 dark:text-green-400 font-medium">Date:</span>
              <span className="ml-2 text-green-800 dark:text-green-300">
                {new Date(status.lastAccepted.acceptedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* DPA Content Summary */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden mb-8">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            DPA v{status?.currentVersion} — Key Terms
          </h2>
        </div>
        <div className="p-6 space-y-4 text-sm text-[#424245] dark:text-[#a1a1a6]">
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Data Processing</h3>
            <p>Iron Gate processes data solely for the purpose of detecting and protecting sensitive information in AI workflows. No customer data is used for model training.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Data Minimization</h3>
            <p>Only cryptographic hashes of detected entities are stored server-side. Raw PII is never transmitted to or stored on Iron Gate servers.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Sub-processors</h3>
            <p>Infrastructure: Render (compute), Supabase (database), Resend (email). All sub-processors maintain SOC 2 Type II compliance.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Data Deletion</h3>
            <p>Upon request, all firm data is permanently deleted within 30 days. An automated purge process covers events, pseudonym maps, feedback, and all derived data.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Breach Notification</h3>
            <p>Iron Gate will notify the data controller within 72 hours of discovering a personal data breach, in accordance with GDPR Article 33.</p>
          </div>
        </div>
      </div>

      {/* Acceptance Form */}
      {!status?.accepted && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Accept DPA</h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6">
            An authorized representative of your organization must accept the DPA.
          </p>

          {success && (
            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 text-sm font-medium">
              DPA accepted successfully.
            </div>
          )}

          <form onSubmit={handleAccept} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Full Name *</label>
              <input
                type="text" required value={signerName} onChange={e => setSignerName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Title</label>
              <input
                type="text" value={signerTitle} onChange={e => setSignerTitle(e.target.value)}
                placeholder="General Counsel"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Email *</label>
              <input
                type="email" required value={signerEmail} onChange={e => setSignerEmail(e.target.value)}
                placeholder="jane.smith@company.com"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit" disabled={submitting}
              className={`px-6 py-2.5 rounded-lg text-sm text-white font-medium transition-colors ${
                submitting ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {submitting ? 'Accepting...' : 'Accept DPA'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
