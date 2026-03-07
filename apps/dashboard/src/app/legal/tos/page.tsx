'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface TosStatus {
  currentVersion: string;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  needsReAcceptance: boolean;
}

export default function TermsOfServicePage() {
  const { apiFetch } = useApiClient();
  const [tos, setTos] = useState<TosStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  async function fetchTos() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/enterprise/tos');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setTos(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load Terms of Service status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTos(); }, []);

  async function handleAccept() {
    if (!tos) return;
    try {
      setAccepting(true);
      setError(null);
      const res = await apiFetch('/enterprise/tos/accept', {
        method: 'POST',
        body: JSON.stringify({ version: tos.currentVersion }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      await fetchTos();
    } catch (err: any) {
      setError(err.message || 'Failed to accept Terms of Service.');
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Terms of Service</h1>
        <div className="space-y-4">
          <div className="h-32 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
          <div className="h-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Terms of Service</h1>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Review and accept the Iron Gate Terms of Service for your organization.
      </p>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchTos} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Retry</button>
        </div>
      )}

      {/* Acceptance Status */}
      {tos?.accepted && !tos.needsReAcceptance && (
        <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">Terms Accepted</p>
              <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                Version {tos.acceptedVersion} accepted on{' '}
                {tos.acceptedAt ? new Date(tos.acceptedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Re-acceptance Warning */}
      {tos?.needsReAcceptance && (
        <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-amber-600 text-lg shrink-0">&#9888;</span>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Updated Terms Available</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                A new version ({tos.currentVersion}) of the Terms of Service is available. Your organization previously accepted version {tos.acceptedVersion}. Please review and accept the updated terms.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Terms Summary */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Terms Summary</h2>
            {tos && (
              <span className="text-xs text-[#86868b] font-mono">v{tos.currentVersion}</span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4 text-sm text-[#424245] dark:text-[#a1a1a6]">
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Service Description</h3>
            <p>Iron Gate provides AI data governance tools including browser extension monitoring, proxy-based redaction, and compliance reporting for enterprise use.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Data Processing</h3>
            <p>Iron Gate processes prompt data in transit to detect sensitive information. Data is pseudonymized and encrypted. Retention periods are configurable by your organization.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Compliance</h3>
            <p>Iron Gate supports GDPR, SOC 2, and HIPAA compliance workflows. Audit logs and compliance exports are available to administrators.</p>
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Liability</h3>
            <p>Iron Gate is provided &quot;as-is&quot; for data governance assistance. It does not guarantee prevention of all data leakage. Organizations remain responsible for their own compliance posture.</p>
          </div>
        </div>

        {/* Accept Button */}
        {(!tos?.accepted || tos?.needsReAcceptance) && (
          <div className="p-6 bg-[#f5f5f7] dark:bg-[#2c2c2e] border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <button
              onClick={handleAccept}
              disabled={accepting}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors ${
                accepting ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {accepting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Accepting...
                </span>
              ) : tos?.needsReAcceptance ? (
                'Accept Updated Terms'
              ) : (
                'I Accept the Terms of Service'
              )}
            </button>
            <p className="text-xs text-[#86868b] mt-2">
              By clicking accept, you agree to the Iron Gate Terms of Service on behalf of your organization.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
