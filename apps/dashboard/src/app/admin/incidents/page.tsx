'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/lib/api';

/* -- Types ----------------------------------------------------------------- */

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  reportedBy: string;
  assignedTo: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  rootCause: string | null;
  remediation: string | null;
  affectedUsers: number;
  createdAt: string;
  updatedAt: string;
}

type Severity = Incident['severity'];
type Status = Incident['status'];

/* -- Helpers --------------------------------------------------------------- */

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const SEVERITY_STYLES: Record<Severity, { badge: string; dot: string }> = {
  low: {
    badge: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]',
    dot: 'bg-[#86868b]',
  },
  medium: {
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  high: {
    badge: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  critical: {
    badge: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
};

const STATUS_STYLES: Record<Status, { badge: string; dot: string }> = {
  open: {
    badge: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  investigating: {
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  resolved: {
    badge: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  closed: {
    badge: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]',
    dot: 'bg-[#86868b]',
  },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/* -- Loading Skeleton ------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li><span>Admin</span></li>
          <li><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Incidents</li>
        </ol>
      </nav>
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Incident Tracking</h1>
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="h-4 w-48 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
              <div className="h-5 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full" />
              <div className="h-5 w-20 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full" />
              <div className="flex-1" />
              <div className="h-4 w-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -- Expanded Detail / Status Update Form ---------------------------------- */

function IncidentDetail({
  incident,
  onUpdate,
}: {
  incident: Incident;
  onUpdate: (id: string, payload: { status: Status; rootCause: string; remediation: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>(incident.status);
  const [rootCause, setRootCause] = useState(incident.rootCause ?? '');
  const [remediation, setRemediation] = useState(incident.remediation ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSubmitting(true);
      setUpdateError(null);
      setUpdateSuccess(false);
      await onUpdate(incident.id, { status, rootCause, remediation });
      setUpdateSuccess(true);
      setTimeout(() => setUpdateSuccess(false), 3000);
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update incident.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-[#fafafa] dark:bg-[#161617] px-6 py-5">
      {/* Detail fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="sm:col-span-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Description</p>
          <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.description || 'No description provided.'}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Reported By</p>
          <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.reportedBy || '-'}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Assigned To</p>
          <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.assignedTo || 'Unassigned'}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Affected Users</p>
          <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.affectedUsers}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Last Updated</p>
          <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{formatTimestamp(incident.updatedAt)}</p>
        </div>
        {incident.resolvedAt && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Resolved At</p>
            <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{formatTimestamp(incident.resolvedAt)}</p>
          </div>
        )}
        {incident.closedAt && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Closed At</p>
            <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{formatTimestamp(incident.closedAt)}</p>
          </div>
        )}
        {incident.rootCause && (
          <div className="sm:col-span-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Root Cause</p>
            <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.rootCause}</p>
          </div>
        )}
        {incident.remediation && (
          <div className="sm:col-span-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b] mb-1">Remediation</p>
            <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{incident.remediation}</p>
          </div>
        )}
      </div>

      {/* Status update form */}
      <div className="border-t border-[#d2d2d7]/30 dark:border-[#38383a]/40 pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#86868b] mb-3">Update Incident</h4>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full sm:w-48 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
            >
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Root Cause</label>
            <textarea
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              rows={2}
              placeholder="Describe the root cause of the incident..."
              className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366] resize-vertical"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">Remediation</label>
            <textarea
              value={remediation}
              onChange={(e) => setRemediation(e.target.value)}
              rows={2}
              placeholder="Describe remediation steps taken or planned..."
              className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366] resize-vertical"
            />
          </div>

          {updateError && (
            <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
              {updateError}
            </div>
          )}

          {updateSuccess && (
            <div className="p-3 rounded-lg text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
              Incident updated successfully.
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                submitting
                  ? 'bg-iron-400 cursor-not-allowed'
                  : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Updating...
                </span>
              ) : (
                'Update Incident'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -- Page ------------------------------------------------------------------ */

export default function IncidentsPage() {
  const { apiFetch } = useApiClient();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New incident form state
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSeverity, setFormSeverity] = useState<Severity>('medium');
  const [formAffectedUsers, setFormAffectedUsers] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch incidents
  // ---------------------------------------------------------------------------
  const fetchIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/incidents');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // ---------------------------------------------------------------------------
  // Create incident
  // ---------------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim()) return;

    try {
      setSubmitting(true);
      setFormError(null);
      const res = await apiFetch('/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim(),
          severity: formSeverity,
          affectedUsers: formAffectedUsers,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setFormTitle('');
      setFormDescription('');
      setFormSeverity('medium');
      setFormAffectedUsers(0);
      setShowForm(false);
      await fetchIncidents();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create incident.');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Update incident
  // ---------------------------------------------------------------------------
  async function handleUpdate(
    id: string,
    payload: { status: Status; rootCause: string; remediation: string },
  ) {
    const res = await apiFetch(`/incidents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    await fetchIncidents();
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return <LoadingSkeleton />;
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li>
            <Link href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
              Admin
            </Link>
          </li>
          <li>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Incidents</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Incident Tracking</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113]"
        >
          {showForm ? 'Cancel' : 'New Incident'}
        </button>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        SOC 2 incident management. Track, investigate, and resolve security incidents with full audit history.
      </p>

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400">
          <span>{error}</span>
          <button
            onClick={() => { setError(null); fetchIncidents(); }}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* New Incident form */}
      {showForm && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Report New Incident</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Title
              </label>
              <input
                type="text"
                required
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Brief incident title..."
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Description
              </label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
                placeholder="Describe the incident in detail..."
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366] resize-vertical"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Severity
                </label>
                <select
                  value={formSeverity}
                  onChange={(e) => setFormSeverity(e.target.value as Severity)}
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Affected Users
                </label>
                <input
                  type="number"
                  min={0}
                  value={formAffectedUsers}
                  onChange={(e) => setFormAffectedUsers(parseInt(e.target.value, 10) || 0)}
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                />
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                {formError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                  submitting
                    ? 'bg-iron-400 cursor-not-allowed'
                    : 'bg-iron-600 hover:bg-iron-700'
                }`}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  'Create Incident'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Incidents list */}
      {incidents.length === 0 ? (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <svg
              className="w-12 h-12 text-[#d2d2d7] dark:text-[#38383a] mb-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No incidents recorded</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              Click &quot;New Incident&quot; to report a security incident.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-left">
                  <th className="px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Title</th>
                  <th className="px-4 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Severity</th>
                  <th className="px-4 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Status</th>
                  <th className="px-4 py-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Created</th>
                  <th className="px-6 py-3 font-medium text-[#6e6e73] dark:text-[#86868b] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                {incidents.map((incident) => {
                  const isExpanded = expandedId === incident.id;
                  return (
                    <React.Fragment key={incident.id}>
                      <tr className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                        <td className="px-6 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : incident.id)}
                            className="flex items-center gap-2 text-left group"
                          >
                            <svg
                              className={`w-3.5 h-3.5 shrink-0 text-[#86868b] transition-transform duration-200 ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] group-hover:text-iron-600 dark:group-hover:text-iron-400 transition-colors">
                              {incident.title}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <SeverityBadge severity={incident.severity} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={incident.status} />
                        </td>
                        <td className="px-4 py-3 text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap tabular-nums">
                          {formatTimestamp(incident.createdAt)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : incident.id)}
                            className="text-iron-600 hover:text-iron-800 dark:text-iron-400 dark:hover:text-iron-300 text-xs font-medium px-2 py-1 rounded-lg hover:bg-iron-50 dark:hover:bg-iron-900/20 transition-colors"
                          >
                            {isExpanded ? 'Collapse' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <IncidentDetail incident={incident} onUpdate={handleUpdate} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Record count */}
          <div className="px-6 py-3 border-t border-[#d2d2d7]/30 dark:border-[#38383a]/60">
            <p className="text-xs text-[#86868b] dark:text-[#636366]">
              {incidents.length} incident{incidents.length !== 1 ? 's' : ''} total
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
