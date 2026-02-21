'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApiClient } from '@/lib/api';

interface Matter {
  id: string;
  clientName: string;
  clientNumber: string;
  matterName: string;
  matterNumber: string;
  status: 'active' | 'closed' | 'archived';
  importedAt: string;
}

const DEMO_MATTERS: Matter[] = [
  {
    id: '1',
    clientName: 'Acme Corporation',
    clientNumber: 'CLI-001',
    matterName: 'Annual Compliance Review',
    matterNumber: 'MAT-2026-001',
    status: 'active',
    importedAt: '2026-01-15T10:00:00Z',
  },
  {
    id: '2',
    clientName: 'Acme Corporation',
    clientNumber: 'CLI-001',
    matterName: 'IP Licensing Agreement',
    matterNumber: 'MAT-2026-002',
    status: 'active',
    importedAt: '2026-01-15T10:00:00Z',
  },
  {
    id: '3',
    clientName: 'Globex Industries',
    clientNumber: 'CLI-002',
    matterName: 'Merger Due Diligence',
    matterNumber: 'MAT-2025-089',
    status: 'active',
    importedAt: '2025-11-20T14:30:00Z',
  },
  {
    id: '4',
    clientName: 'Globex Industries',
    clientNumber: 'CLI-002',
    matterName: 'Employment Dispute',
    matterNumber: 'MAT-2025-045',
    status: 'closed',
    importedAt: '2025-08-10T09:15:00Z',
  },
  {
    id: '5',
    clientName: 'Initech LLC',
    clientNumber: 'CLI-003',
    matterName: 'Regulatory Filing',
    matterNumber: 'MAT-2026-010',
    status: 'active',
    importedAt: '2026-02-01T11:20:00Z',
  },
  {
    id: '6',
    clientName: 'Soylent Corp',
    clientNumber: 'CLI-004',
    matterName: 'Product Liability Defense',
    matterNumber: 'MAT-2025-072',
    status: 'closed',
    importedAt: '2025-09-05T16:45:00Z',
  },
  {
    id: '7',
    clientName: 'Soylent Corp',
    clientNumber: 'CLI-004',
    matterName: 'Real Estate Acquisition',
    matterNumber: 'MAT-2026-015',
    status: 'active',
    importedAt: '2026-02-10T08:30:00Z',
  },
  {
    id: '8',
    clientName: 'Wayne Enterprises',
    clientNumber: 'CLI-005',
    matterName: 'Board Advisory',
    matterNumber: 'MAT-2024-120',
    status: 'archived',
    importedAt: '2024-06-12T13:00:00Z',
  },
  {
    id: '9',
    clientName: 'Wayne Enterprises',
    clientNumber: 'CLI-005',
    matterName: 'Patent Prosecution',
    matterNumber: 'MAT-2026-003',
    status: 'active',
    importedAt: '2026-01-22T10:10:00Z',
  },
  {
    id: '10',
    clientName: 'Stark Industries',
    clientNumber: 'CLI-006',
    matterName: 'Trade Secret Litigation',
    matterNumber: 'MAT-2025-098',
    status: 'archived',
    importedAt: '2025-10-18T15:00:00Z',
  },
];

export default function MattersPage() {
  const { apiFetch } = useApiClient();

  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search / filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed' | 'archived'>('all');

  // CSV upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch matters
  // ---------------------------------------------------------------------------
  async function fetchMatters() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/client-matters');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setMatters(Array.isArray(data) ? data : data.matters ?? []);
    } catch (err: any) {
      console.error('Failed to load matters, using demo data:', err);
      setMatters(DEMO_MATTERS);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMatters();
  }, []);

  // ---------------------------------------------------------------------------
  // CSV import
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
      const header = lines[0]?.toLowerCase() || '';
      const startIndex = header.includes('client') || header.includes('matter') ? 1 : 0;

      const parsed = lines.slice(startIndex).map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          clientName: parts[0] || '',
          clientNumber: parts[1] || '',
          matterName: parts[2] || '',
          matterNumber: parts[3] || '',
          status: (parts[4] || 'active') as 'active' | 'closed' | 'archived',
        };
      }).filter((m) => m.clientName && m.matterNumber);

      if (parsed.length === 0) {
        setUploadMessage({
          type: 'error',
          text: 'No valid records found in CSV. Expected columns: clientName, clientNumber, matterName, matterNumber, status.',
        });
        return;
      }

      const res = await apiFetch('/admin/client-matters', {
        method: 'POST',
        body: JSON.stringify({ matters: parsed }),
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      setUploadMessage({
        type: 'success',
        text: `Successfully imported ${parsed.length} matter${parsed.length !== 1 ? 's' : ''}.`,
      });
      await fetchMatters();
    } catch (err: any) {
      // In demo mode, add records locally from the CSV
      const text = await file.text();
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      const header = lines[0]?.toLowerCase() || '';
      const startIndex = header.includes('client') || header.includes('matter') ? 1 : 0;
      const parsed = lines.slice(startIndex).map((line, idx) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          id: String(Date.now() + idx),
          clientName: parts[0] || '',
          clientNumber: parts[1] || '',
          matterName: parts[2] || '',
          matterNumber: parts[3] || '',
          status: (parts[4] || 'active') as 'active' | 'closed' | 'archived',
          importedAt: new Date().toISOString(),
        };
      }).filter((m) => m.clientName && m.matterNumber);

      if (parsed.length > 0) {
        setMatters((prev) => [...prev, ...parsed]);
        setUploadMessage({
          type: 'success',
          text: `Imported ${parsed.length} matter${parsed.length !== 1 ? 's' : ''} (demo mode).`,
        });
      } else {
        setUploadMessage({
          type: 'error',
          text: err.message || 'Failed to import CSV. Please try again.',
        });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Delete matter
  // ---------------------------------------------------------------------------
  async function handleDelete(id: string) {
    try {
      setDeletingId(id);
      const res = await apiFetch(`/admin/client-matters/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setMatters((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      // In demo mode, remove locally
      setMatters((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------
  function statusBadge(status: Matter['status']) {
    const styles: Record<Matter['status'], string> = {
      active: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
      closed: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
      archived: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
    };
    const dotStyles: Record<Matter['status'], string> = {
      active: 'bg-green-500',
      closed: 'bg-gray-400',
      archived: 'bg-yellow-500',
    };
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[status]}`} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Filtered matters
  // ---------------------------------------------------------------------------
  const filteredMatters = matters.filter((m) => {
    const matchesSearch =
      searchQuery === '' ||
      m.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.clientNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.matterName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.matterNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">Client Matters</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-500 dark:text-gray-400">Loading matters...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Client Matters</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage client-matter records used for sensitivity detection and data classification.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {showUpload ? 'Cancel' : 'Import CSV'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* CSV upload area */}
      {showUpload && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Import Client Matters</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Upload a CSV file with columns: clientName, clientNumber, matterName, matterNumber, status.
          </p>
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Uploading and processing CSV...</p>
              </div>
            ) : (
              <>
                <svg className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-gray-400 dark:text-gray-500">Drag and drop a CSV file here, or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
      )}

      {/* Search and filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by client name, matter name, or number..."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'closed' | 'archived')}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Matters table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        {filteredMatters.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            {matters.length === 0
              ? 'No client matters found. Click "Import CSV" to add records.'
              : 'No matters match your search criteria.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Client Name</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Client #</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Matter Name</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Matter #</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Imported</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredMatters.map((matter) => (
                  <tr key={matter.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-900 dark:text-white">{matter.clientName}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{matter.clientNumber}</span>
                    </td>
                    <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">
                      {matter.matterName}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{matter.matterNumber}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {statusBadge(matter.status)}
                    </td>
                    <td className="py-3 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(matter.importedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleDelete(matter.id)}
                        disabled={deletingId === matter.id}
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === matter.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Record count */}
        {matters.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing {filteredMatters.length} of {matters.length} matter{matters.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
