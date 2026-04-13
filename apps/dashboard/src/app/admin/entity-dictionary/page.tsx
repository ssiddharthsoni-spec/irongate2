'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityCategory = 'CLIENT_NAME' | 'MATTER_NAME' | 'PROJECT_CODENAME' | 'INTERNAL_ID' | 'CUSTOM';

interface EntityEntry {
  id: string;
  value: string;
  category: EntityCategory;
  notes?: string;
  addedBy?: string;
  createdAt?: string;
}

const CATEGORIES: EntityCategory[] = [
  'CLIENT_NAME',
  'MATTER_NAME',
  'PROJECT_CODENAME',
  'INTERNAL_ID',
  'CUSTOM',
];

const CATEGORY_LABELS: Record<EntityCategory, string> = {
  CLIENT_NAME: 'Client Name',
  MATTER_NAME: 'Matter Name',
  PROJECT_CODENAME: 'Project Codename',
  INTERNAL_ID: 'Internal ID',
  CUSTOM: 'Custom',
};

const CATEGORY_STYLES: Record<EntityCategory, string> = {
  CLIENT_NAME: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  MATTER_NAME: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  PROJECT_CODENAME: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
  INTERNAL_ID: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400',
  CUSTOM: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EntityDictionaryPage() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();

  const [entries, setEntries] = useState<EntityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<EntityCategory | 'ALL'>('ALL');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntityEntry | null>(null);

  // Form state
  const [formValue, setFormValue] = useState('');
  const [formCategory, setFormCategory] = useState<EntityCategory>('CLIENT_NAME');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setComingSoon(false);
      const res = await apiFetch('/admin/entity-dictionary');
      if (res.status === 404) {
        setComingSoon(true);
        setEntries([]);
        return;
      }
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : data.entries ?? []);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        setComingSoon(true);
        setEntries([]);
      } else {
        setError(err.message || 'Failed to load entity dictionary.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Escape closes modal
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && showModal) closeModal();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  function openCreateModal() {
    setEditingEntry(null);
    setFormValue('');
    setFormCategory('CLIENT_NAME');
    setFormNotes('');
    setFormError(null);
    setShowModal(true);
  }

  function openEditModal(entry: EntityEntry) {
    setEditingEntry(entry);
    setFormValue(entry.value);
    setFormCategory(entry.category);
    setFormNotes(entry.notes || '');
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEntry(null);
    setFormError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formValue.trim()) {
      setFormError('Value is required.');
      return;
    }
    try {
      setSaving(true);
      setFormError(null);

      const body = {
        value: formValue.trim(),
        category: formCategory,
        notes: formNotes.trim() || undefined,
      };

      const res = editingEntry
        ? await apiFetch(`/admin/entity-dictionary/${editingEntry.id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        : await apiFetch('/admin/entity-dictionary', {
            method: 'POST',
            body: JSON.stringify(body),
          });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      addToast({
        type: 'success',
        message: editingEntry ? 'Entry updated.' : 'Entry added to dictionary.',
      });
      closeModal();
      await fetchEntries();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save entry.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: EntityEntry) {
    if (!window.confirm(`Delete "${entry.value}"?`)) return;
    try {
      setDeletingId(entry.id);
      const res = await apiFetch(`/admin/entity-dictionary/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({ type: 'success', message: 'Entry deleted.' });
      await fetchEntries();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to delete entry.' });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleImportCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setImporting(true);
      const csv = await file.text();
      const res = await apiFetch('/admin/entity-dictionary/import', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const result = await res.json().catch(() => ({}));
      addToast({
        type: 'success',
        message: result?.imported
          ? `Imported ${result.imported} entries.`
          : 'CSV imported successfully.',
      });
      await fetchEntries();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to import CSV.' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          e.value.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes && e.notes.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [entries, searchQuery, categoryFilter]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
          Admin
        </a>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Entity Dictionary</span>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Entity Dictionary</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            {entries.length > 0
              ? `Managing ${entries.length} custom ${entries.length === 1 ? 'entity' : 'entities'}.`
              : 'Teach IronGate about your organization\u2019s specific terminology.'}
          </p>
        </div>
        {!comingSoon && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportCsv}
              aria-label="Import CSV"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import CSV'}
            </button>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-iron-600 text-white hover:bg-iron-700 transition-colors"
            >
              + Add Entry
            </button>
          </div>
        )}
      </div>

      {comingSoon && (
        <div className="mb-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                This feature is coming soon
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Custom entity dictionaries are in beta. You&apos;ll be able to upload client names, matter
                codes, and internal terminology to sharpen detection for your firm.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      {!comingSoon && entries.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entities..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b]"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as EntityCategory | 'ALL')}
            className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
          >
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading dictionary...</span>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          {entries.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                No custom entities yet
              </p>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                Add your first entity to teach IronGate about your organization&apos;s specific terminology.
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-16 px-6">
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">No entries match your filters.</p>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[2fr_150px_1fr_120px_110px] gap-4 px-6 py-3 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Value</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Category</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Added by</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Added at</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide text-right">Actions</span>
              </div>
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[2fr_150px_1fr_120px_110px] gap-4 px-6 py-4 items-center border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                      {entry.value}
                    </p>
                    {entry.notes && (
                      <p className="text-xs text-[#86868b] truncate mt-0.5">{entry.notes}</p>
                    )}
                  </div>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_STYLES[entry.category]}`}>
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b] truncate">
                    {entry.addedBy || '--'}
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '--'}
                  </span>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => openEditModal(entry)}
                      className="text-xs font-medium text-iron-600 dark:text-iron-400 hover:text-iron-800 dark:hover:text-iron-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(entry)}
                      disabled={deletingId === entry.id}
                      className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                    >
                      {deletingId === entry.id ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 w-full max-w-md">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
              {editingEntry ? 'Edit Entry' : 'Add Entity'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Value <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder="e.g. Acme Corp, Project Falcon"
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b]"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Category
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as EntityCategory)}
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={3}
                  placeholder="Context about when this entity appears."
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] resize-none"
                />
              </div>

              {formError && (
                <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                  {formError}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                    saving ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
                  }`}
                >
                  {saving ? 'Saving...' : editingEntry ? 'Save Changes' : 'Add Entity'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7] dark:border-[#38383a] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
