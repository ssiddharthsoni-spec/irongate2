'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApiClient } from '../../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DictionaryEntity {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  metadata: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VersionInfo {
  hash: string;
  entityCount: number;
  lastUpdated: string;
}

type EntityCategory = 'person' | 'organization' | 'project' | 'client' | 'location' | 'custom';

const CATEGORIES: EntityCategory[] = ['person', 'organization', 'project', 'client', 'location', 'custom'];

const CATEGORY_COLORS: Record<string, string> = {
  person: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  organization: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  project: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  client: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  location: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  custom: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300',
};

const PAGE_SIZE = 50;

// ─── Page Component ──────────────────────────────────────────────────────────

export default function EntityDictionaryPage() {
  const { apiFetch } = useApiClient();

  // Data state
  const [entities, setEntities] = useState<DictionaryEntity[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});

  // UI state
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<DictionaryEntity | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Debounce search input
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Show toast with auto-dismiss
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Data Fetching ───────────────────────────────────────────────────────

  const fetchEntities = useCallback(async () => {
    try {
      setFetchError(null);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterCategory) params.set('category', filterCategory);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await apiFetch(`/admin/entity-dictionary?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch entities (${res.status})`);
      const json = await res.json();

      setEntities(json.entities || json.data || json || []);
      setTotalCount(json.total ?? json.totalCount ?? (json.entities || json.data || json).length);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load entity dictionary.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, offset, filterCategory, debouncedSearch]);

  const fetchVersion = useCallback(async () => {
    try {
      const res = await apiFetch('/admin/entity-dictionary/version');
      if (res.ok) {
        const json = await res.json();
        setVersionInfo(json);
      }
    } catch {
      // non-critical
    }
  }, [apiFetch]);

  const fetchCategoryCounts = useCallback(async () => {
    try {
      // Fetch all entities grouped by category via export
      const res = await apiFetch('/admin/entity-dictionary/export');
      if (res.ok) {
        const json = await res.json();
        const all: DictionaryEntity[] = json.entities || json.data || json || [];
        const counts: Record<string, number> = {};
        all.forEach((e) => {
          counts[e.category] = (counts[e.category] || 0) + 1;
        });
        setCategoryCounts(counts);
      }
    } catch {
      // non-critical
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    fetchVersion();
    fetchCategoryCounts();
  }, [fetchVersion, fetchCategoryCounts]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function handleAddEntity(data: { name: string; category: string; aliases: string[]; metadata: Record<string, unknown> | null }) {
    try {
      const res = await apiFetch('/admin/entity-dictionary', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed (${res.status})`);
      }
      showToast(`Entity "${data.name}" added successfully.`, 'success');
      setShowAddModal(false);
      setOffset(0);
      fetchEntities();
      fetchVersion();
      fetchCategoryCounts();
    } catch (err: any) {
      showToast(err.message || 'Failed to add entity.', 'error');
    }
  }

  async function handleUpdateEntity(id: string, data: Partial<DictionaryEntity>) {
    try {
      const res = await apiFetch(`/admin/entity-dictionary/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed (${res.status})`);
      }
      showToast('Entity updated successfully.', 'success');
      setEditingEntity(null);
      fetchEntities();
      fetchVersion();
      fetchCategoryCounts();
    } catch (err: any) {
      showToast(err.message || 'Failed to update entity.', 'error');
    }
  }

  async function handleDeactivate(id: string) {
    try {
      const res = await apiFetch(`/admin/entity-dictionary/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed (${res.status})`);
      }
      showToast('Entity deactivated.', 'success');
      setDeleteConfirm(null);
      fetchEntities();
      fetchVersion();
      fetchCategoryCounts();
    } catch (err: any) {
      showToast(err.message || 'Failed to deactivate entity.', 'error');
    }
  }

  async function handleBulkImport(input: string, format: 'json' | 'csv') {
    try {
      let parsed: { name: string; category: string; aliases: string[]; metadata?: Record<string, unknown> }[];

      if (format === 'json') {
        parsed = JSON.parse(input);
        if (!Array.isArray(parsed)) throw new Error('Input must be a JSON array.');
      } else {
        // CSV: name,category,aliases (pipe-separated aliases)
        const lines = input.trim().split('\n').filter((l) => l.trim());
        // Skip header if present
        const start = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;
        parsed = lines.slice(start).map((line) => {
          const parts = line.split(',').map((s) => s.trim());
          if (parts.length < 2) throw new Error(`Invalid CSV line: "${line}"`);
          return {
            name: parts[0],
            category: parts[1],
            aliases: parts[2] ? parts[2].split('|').map((a) => a.trim()).filter(Boolean) : [],
          };
        });
      }

      if (parsed.length === 0) throw new Error('No entities to import.');

      const res = await apiFetch('/admin/entity-dictionary/bulk', {
        method: 'POST',
        body: JSON.stringify({ entities: parsed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Bulk import failed (${res.status})`);
      }
      const result = await res.json();
      showToast(`Imported ${result.imported ?? result.count ?? parsed.length} entities.`, 'success');
      setShowBulkModal(false);
      setOffset(0);
      fetchEntities();
      fetchVersion();
      fetchCategoryCounts();
    } catch (err: any) {
      showToast(err.message || 'Bulk import failed.', 'error');
    }
  }

  async function handleExport() {
    try {
      const res = await apiFetch('/admin/entity-dictionary/export');
      if (!res.ok) throw new Error('Export failed');
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `entity-dictionary-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(err.message || 'Export failed.', 'error');
    }
  }

  // ─── Computed ────────────────────────────────────────────────────────────

  const totalEntities = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // ─── Loading State ───────────────────────────────────────────────────────

  if (loading && entities.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Entity Dictionary</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 animate-pulse">
              <div className="h-4 w-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded mb-3" />
              <div className="h-8 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="h-[400px] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Error banner */}
      {fetchError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{fetchError}</span>
          <button onClick={() => { fetchEntities(); }} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Entity Dictionary</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            Manage known entities for detection and pseudonymization
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-iron-600 text-white hover:bg-iron-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Entity
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e] transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Bulk Import
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e] transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        <StatsCard label="Total" value={totalEntities} />
        {CATEGORIES.map((cat) => (
          <StatsCard
            key={cat}
            label={cat.charAt(0).toUpperCase() + cat.slice(1)}
            value={categoryCounts[cat] || 0}
            active={filterCategory === cat}
            onClick={() => {
              setFilterCategory(filterCategory === cat ? '' : cat);
              setOffset(0);
            }}
          />
        ))}
      </div>

      {/* Sync Status */}
      {versionInfo && (
        <div className="mb-6 flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-[#1c1c1e] rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-[#6e6e73] dark:text-[#86868b]">
            Dictionary version: <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">{versionInfo.hash?.slice(0, 12) || 'N/A'}</span>
          </span>
          <span className="text-xs text-[#86868b] dark:text-[#636366]">
            {versionInfo.entityCount != null && <>{versionInfo.entityCount} entities</>}
            {versionInfo.lastUpdated && (
              <> &middot; Last updated {new Date(versionInfo.lastUpdated).toLocaleDateString()}</>
            )}
          </span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search entities by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Entity Table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Aliases</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/60">
              {entities.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#86868b] dark:text-[#636366]">
                    {debouncedSearch || filterCategory
                      ? 'No entities match your filters.'
                      : 'No entities in the dictionary yet. Add one to get started.'}
                  </td>
                </tr>
              ) : (
                entities.map((entity) => (
                  <tr key={entity.id} className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                    <td className="px-6 py-3">
                      <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{entity.name}</span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[entity.category] || CATEGORY_COLORS.custom}`}>
                        {entity.category}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(entity.aliases || []).length === 0 ? (
                          <span className="text-xs text-[#86868b] dark:text-[#636366]">--</span>
                        ) : (
                          (entity.aliases || []).slice(0, 3).map((alias, i) => (
                            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]">
                              {alias}
                            </span>
                          ))
                        )}
                        {(entity.aliases || []).length > 3 && (
                          <span className="text-xs text-[#86868b] dark:text-[#636366]">+{entity.aliases.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                        entity.isActive
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-[#86868b] dark:text-[#636366]'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${entity.isActive ? 'bg-green-500' : 'bg-[#d2d2d7] dark:bg-[#38383a]'}`} />
                        {entity.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingEntity(entity)}
                          className="p-1.5 rounded-lg text-[#6e6e73] dark:text-[#86868b] hover:text-iron-600 dark:hover:text-iron-400 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                          </svg>
                        </button>
                        {deleteConfirm === entity.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeactivate(entity.id)}
                              className="px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 text-xs font-medium text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(entity.id)}
                            className="p-1.5 rounded-lg text-[#6e6e73] dark:text-[#86868b] hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Deactivate"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-[#d2d2d7]/30 dark:border-[#38383a]/60">
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
              Showing {offset + 1}--{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-[#6e6e73] dark:text-[#86868b]">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Entity Modal */}
      {showAddModal && (
        <EntityFormModal
          title="Add Entity"
          onSubmit={(data) => handleAddEntity(data)}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Edit Entity Modal */}
      {editingEntity && (
        <EntityFormModal
          title="Edit Entity"
          initial={editingEntity}
          onSubmit={(data) => handleUpdateEntity(editingEntity.id, data)}
          onClose={() => setEditingEntity(null)}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <BulkImportModal
          onImport={handleBulkImport}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}

// ─── Sub-Components ────────────────────────────────────────────────────────

function StatsCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const base = 'bg-white dark:bg-[#1c1c1e] rounded-xl p-4 shadow-sm border transition-colors';
  const borderClass = active
    ? 'border-iron-500 dark:border-iron-400 ring-1 ring-iron-500/30'
    : 'border-[#d2d2d7]/40 dark:border-[#38383a]/60';
  const interactive = onClick ? 'cursor-pointer hover:border-iron-400 dark:hover:border-iron-500' : '';

  return (
    <div className={`${base} ${borderClass} ${interactive}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b]">{label}</p>
      <p className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

function EntityFormModal({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: DictionaryEntity;
  onSubmit: (data: { name: string; category: string; aliases: string[]; metadata: Record<string, unknown> | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState<string>(initial?.category || 'person');
  const [aliasesText, setAliasesText] = useState((initial?.aliases || []).join(', '));
  const [metadataText, setMetadataText] = useState(initial?.metadata ? JSON.stringify(initial.metadata, null, 2) : '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }

    let metadata: Record<string, unknown> | null = null;
    if (metadataText.trim()) {
      try {
        metadata = JSON.parse(metadataText);
      } catch {
        setFormError('Metadata must be valid JSON.');
        return;
      }
    }

    const aliases = aliasesText
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    setSubmitting(true);
    onSubmit({ name: name.trim(), category, aliases, metadata });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</h2>
          <button onClick={onClose} className="p-1 text-[#86868b] hover:text-[#424245] dark:hover:text-[#a1a1a6] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {formError && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-600 dark:text-red-400">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#2c2c2e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#2c2c2e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Aliases</label>
            <input
              type="text"
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              placeholder="Comma-separated, e.g. J. Smith, Johnny"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#2c2c2e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
            />
            <p className="mt-1 text-xs text-[#86868b] dark:text-[#636366]">Separate multiple aliases with commas</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Metadata (optional)</label>
            <textarea
              value={metadataText}
              onChange={(e) => setMetadataText(e.target.value)}
              placeholder='{"department": "Engineering"}'
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#2c2c2e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500 font-mono"
            />
            <p className="mt-1 text-xs text-[#86868b] dark:text-[#636366]">JSON object with additional entity data</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-iron-600 text-white hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Saving...' : initial ? 'Save Changes' : 'Add Entity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkImportModal({
  onImport,
  onClose,
}: {
  onImport: (input: string, format: 'json' | 'csv') => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [input, setInput] = useState('');

  const csvExample = `name,category,aliases
John Smith,person,J. Smith|Johnny
Acme Corp,organization,Acme|ACME Inc
Project Phoenix,project,Phoenix|PX-2024`;

  const jsonExample = `[
  { "name": "John Smith", "category": "person", "aliases": ["J. Smith", "Johnny"] },
  { "name": "Acme Corp", "category": "organization", "aliases": ["Acme", "ACME Inc"] }
]`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Bulk Import</h2>
          <button onClick={onClose} className="p-1 text-[#86868b] hover:text-[#424245] dark:hover:text-[#a1a1a6] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Format Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => { setFormat('csv'); setInput(''); }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                format === 'csv'
                  ? 'bg-iron-600 text-white'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]'
              }`}
            >
              CSV
            </button>
            <button
              onClick={() => { setFormat('json'); setInput(''); }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                format === 'json'
                  ? 'bg-iron-600 text-white'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]'
              }`}
            >
              JSON
            </button>
          </div>

          {/* Example */}
          <div className="px-3 py-2 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/30 dark:border-[#38383a]/40">
            <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">Example format:</p>
            <pre className="text-xs text-[#424245] dark:text-[#a1a1a6] font-mono whitespace-pre-wrap">
              {format === 'csv' ? csvExample : jsonExample}
            </pre>
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Paste your {format === 'csv' ? 'CSV' : 'JSON'} data
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={10}
              placeholder={format === 'csv' ? 'name,category,aliases\n...' : '[\n  { "name": "...", "category": "...", "aliases": [] }\n]'}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#2c2c2e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500 font-mono"
            />
            {format === 'csv' && (
              <p className="mt-1 text-xs text-[#86868b] dark:text-[#636366]">
                Use pipe (|) to separate multiple aliases within the aliases column
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onImport(input, format)}
              disabled={!input.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-iron-600 text-white hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
