'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface BaaStatus {
  signed: boolean;
  signedAt: string | null;
  signedBy: string | null;
  signerName: string | null;
  signerTitle: string | null;
  version: string;
}

const BAA_KEY_TERMS = [
  {
    title: 'Permitted Uses of PHI',
    description:
      'Iron Gate may use or disclose Protected Health Information (PHI) only as permitted by the BAA, as required by law, or as otherwise authorized by the Covered Entity. PHI is used solely for providing AI governance and data protection services.',
  },
  {
    title: 'Safeguards Requirement',
    description:
      'Iron Gate implements administrative, physical, and technical safeguards that reasonably and appropriately protect the confidentiality, integrity, and availability of PHI. This includes AES-256-GCM encryption at rest, TLS 1.3 in transit, and zero-knowledge pseudonymization.',
  },
  {
    title: 'Breach Notification Obligations',
    description:
      'Iron Gate will report any unauthorized use or disclosure of PHI, including any security incident, to the Covered Entity without unreasonable delay and no later than 60 days after discovery. Reports include the nature of the breach, types of PHI involved, and mitigation steps taken.',
  },
  {
    title: 'Return or Destruction of PHI',
    description:
      'Upon termination of the agreement, Iron Gate will return or destroy all PHI in its possession within 30 days. Where return or destruction is not feasible, protections under the BAA extend to retained PHI, and further use or disclosure is limited to the purposes that make return or destruction infeasible.',
  },
  {
    title: 'Subcontractor Obligations',
    description:
      'Iron Gate ensures that any subcontractors or sub-processors that create, receive, maintain, or transmit PHI on behalf of the Business Associate agree to the same restrictions, conditions, and requirements that apply to the Business Associate under this BAA.',
  },
  {
    title: 'Access and Amendment Rights',
    description:
      'Iron Gate will make PHI available to the Covered Entity as required to satisfy obligations under HIPAA, including individual access and amendment requests. An audit trail of all PHI access is maintained and available upon request.',
  },
];

export default function BaaPage() {
  const { apiFetch } = useApiClient();

  const [status, setStatus] = useState<BaaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function fetchStatus() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/enterprise/baa');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: BaaStatus = await res.json();
      setStatus(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load BAA status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    if (!status) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch('/enterprise/baa/sign', {
        method: 'POST',
        body: JSON.stringify({
          signerName,
          signerTitle,
          signerEmail,
          version: status.version,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setSuccess(true);
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to sign BAA.');
    } finally {
      setSubmitting(false);
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">
          Business Associate Agreement
        </h1>
        <div className="space-y-6 animate-pulse">
          <div className="h-4 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-2/3" />
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 space-y-4">
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/3" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-5/6" />
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/4 mt-6" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-3 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-4/5" />
          </div>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6 space-y-4">
            <div className="h-5 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-1/3" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-full" />
            <div className="h-10 bg-[#e5e5ea] dark:bg-[#38383a] rounded w-40" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
        Business Associate Agreement
      </h1>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        Review and sign the HIPAA Business Associate Agreement to enable PHI
        processing protections.
      </p>

      {/* Error state with retry */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchStatus}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Signed status card */}
      {status?.signed && (
        <div className="mb-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-green-800 dark:text-green-300">
              BAA Signed
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {status.signerName && (
              <div>
                <span className="text-green-700 dark:text-green-400 font-medium">
                  Signer:
                </span>
                <span className="ml-2 text-green-800 dark:text-green-300">
                  {status.signerName}
                </span>
              </div>
            )}
            {status.signerTitle && (
              <div>
                <span className="text-green-700 dark:text-green-400 font-medium">
                  Title:
                </span>
                <span className="ml-2 text-green-800 dark:text-green-300">
                  {status.signerTitle}
                </span>
              </div>
            )}
            {status.signedBy && (
              <div>
                <span className="text-green-700 dark:text-green-400 font-medium">
                  Email:
                </span>
                <span className="ml-2 text-green-800 dark:text-green-300">
                  {status.signedBy}
                </span>
              </div>
            )}
            {status.signedAt && (
              <div>
                <span className="text-green-700 dark:text-green-400 font-medium">
                  Date:
                </span>
                <span className="ml-2 text-green-800 dark:text-green-300">
                  {new Date(status.signedAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
            <div>
              <span className="text-green-700 dark:text-green-400 font-medium">
                Version:
              </span>
              <span className="ml-2 text-green-800 dark:text-green-300">
                {status.version}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* HIPAA Compliance Notice */}
      <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
            />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-semibold mb-1">HIPAA Compliance Notice</p>
            <p className="text-blue-700 dark:text-blue-400">
              This Business Associate Agreement is required under the Health
              Insurance Portability and Accountability Act (HIPAA) when Iron Gate
              processes Protected Health Information (PHI) on behalf of a Covered
              Entity. Signing this BAA is mandatory for healthcare organizations
              using Iron Gate.
            </p>
          </div>
        </div>
      </div>

      {/* BAA Key Terms */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden mb-8">
        <div className="p-6 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              BAA Key Terms
            </h2>
            {status && (
              <span className="text-xs text-[#86868b] font-mono">
                v{status.version}
              </span>
            )}
          </div>
          <p className="text-xs text-[#86868b] mt-1">
            HIPAA Business Associate Agreement requirements
          </p>
        </div>
        <div className="p-6 space-y-5 text-sm text-[#424245] dark:text-[#a1a1a6]">
          {BAA_KEY_TERMS.map((term) => (
            <div key={term.title}>
              <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                {term.title}
              </h3>
              <p>{term.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Signing Form -- only shown when BAA is not yet signed */}
      {!status?.signed && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
            Sign BAA
          </h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6">
            An authorized representative of your organization must sign the
            Business Associate Agreement. By signing, you confirm that your
            organization is a Covered Entity or Business Associate under HIPAA
            and that this BAA governs Iron Gate&apos;s handling of PHI.
          </p>

          {success && (
            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 text-sm font-medium">
              BAA signed successfully.
            </div>
          )}

          <form onSubmit={handleSign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Title *
              </label>
              <input
                type="text"
                required
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                placeholder="Chief Privacy Officer"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Email *
              </label>
              <input
                type="email"
                required
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="jane.smith@hospital.org"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className={`px-6 py-2.5 rounded-lg text-sm text-white font-medium transition-colors ${
                submitting
                  ? 'bg-iron-400 cursor-not-allowed'
                  : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing...
                </span>
              ) : (
                'Sign Business Associate Agreement'
              )}
            </button>
            <p className="text-xs text-[#86868b] mt-1">
              By signing, you agree to the BAA terms on behalf of your
              organization.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
