'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Department {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  userCount?: number;
  policyCount?: number;
}

type PolicyType = 'allowed_sites' | 'blocked_entity_types' | 'can_bypass' | 'max_sensitivity';

interface Policy {
  policyType: PolicyType;
  policyValue: string;
  isActive: boolean;
}

const POLICY_TYPES: PolicyType[] = [
  'allowed_sites',
  'blocked_entity_types',
  'can_bypass',
  'max_sensitivity',
];

const POLICY_LABELS: Record<PolicyType, string> = {
  allowed_sites: 'Allowed Sites',
  blocked_entity_types: 'Blocked Entity Types',
  can_bypass: 'Can Bypass',
  max_sensitivity: 'Max Sensitivity',
};

const ENTITY_TYPE_OPTIONS = [
  'SSN',
  'CREDIT_CARD',
  'EMAIL',
  'PERSON',
  'PHONE_NUMBER',
  'ADDRESS',
  'DATE_OF_BIRTH',
  'PASSPORT',
  'DRIVER_LICENSE',
  'BANK_ACCOUNT',
  'IP_ADDRESS',
  'MEDICAL_RECORD',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DepartmentsPage() {
  const { apiFetch } = useApiClient();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Expanded department + policies
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  // Policy editor drafts — keyed by policyType
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, { value: string; isActive: boolean }>>({});
  const [savingPolicy, setSavingPolicy] = useState<string | null>(null);
  const [deletingPolicy, setDeletingPolicy] = useState<string | null>(null);
  const [policyMessage, setPolicyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit department
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [updating, setUpdating] = useState(false);

  // Delete department
  const [deletingDeptId, setDeletingDeptId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch departments
  // ---------------------------------------------------------------------------
  const fetchDepartments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/departments');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setDepartments(Array.isArray(data) ? data : data.departments ?? []);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        setDepartments([]);
      } else {
        setError(err.message || 'Failed to load departments.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchDepartments();
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch policies for a department
  // ---------------------------------------------------------------------------
  async function fetchPolicies(deptId: string) {
    try {
      setPoliciesLoading(true);
      setPolicyMessage(null);
      const res = await apiFetch(`/admin/departments/${deptId}/policies`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      const list: Policy[] = Array.isArray(data) ? data : data.policies ?? [];
      setPolicies(list);

      // Initialise drafts from existing policies
      const drafts: Record<string, { value: string; isActive: boolean }> = {};
      for (const p of list) {
        drafts[p.policyType] = { value: p.policyValue, isActive: p.isActive };
      }
      setPolicyDrafts(drafts);
    } catch (err: any) {
      if (!err?.message?.includes('404')) {
        setPolicyMessage({ type: 'error', text: err.message || 'Failed to load policies.' });
      }
      setPolicies([]);
      setPolicyDrafts({});
    } finally {
      setPoliciesLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle expand
  // ---------------------------------------------------------------------------
  function handleToggleExpand(deptId: string) {
    if (expandedId === deptId) {
      setExpandedId(null);
      setPolicies([]);
      setPolicyDrafts({});
      setPolicyMessage(null);
    } else {
      setExpandedId(deptId);
      fetchPolicies(deptId);
    }
  }

  // ---------------------------------------------------------------------------
  // Create department
  // ---------------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;

    try {
      setCreating(true);
      setCreateError(null);
      const res = await apiFetch('/admin/departments', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setCreateName('');
      setCreateDescription('');
      setShowCreateForm(false);
      await fetchDepartments();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create department.');
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Update department
  // ---------------------------------------------------------------------------
  async function handleUpdate(deptId: string) {
    if (!editName.trim()) return;
    try {
      setUpdating(true);
      const res = await apiFetch(`/admin/departments/${deptId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setEditingId(null);
      await fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to update department.');
    } finally {
      setUpdating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete department
  // ---------------------------------------------------------------------------
  async function handleDeleteDept(deptId: string) {
    try {
      setDeletingDeptId(deptId);
      const res = await apiFetch(`/admin/departments/${deptId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      if (expandedId === deptId) {
        setExpandedId(null);
        setPolicies([]);
        setPolicyDrafts({});
      }
      setDepartments((prev) => prev.filter((d) => d.id !== deptId));
    } catch (err: any) {
      setError(err.message || 'Failed to delete department.');
    } finally {
      setDeletingDeptId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Save policy
  // ---------------------------------------------------------------------------
  async function handleSavePolicy(deptId: string, policyType: PolicyType) {
    const draft = policyDrafts[policyType];
    if (!draft) return;

    try {
      setSavingPolicy(policyType);
      setPolicyMessage(null);
      const res = await apiFetch(`/admin/departments/${deptId}/policies`, {
        method: 'PUT',
        body: JSON.stringify({
          policyType,
          policyValue: draft.value,
          isActive: draft.isActive,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setPolicyMessage({ type: 'success', text: `Policy "${POLICY_LABELS[policyType]}" saved.` });
      await fetchPolicies(deptId);
    } catch (err: any) {
      setPolicyMessage({ type: 'error', text: err.message || 'Failed to save policy.' });
    } finally {
      setSavingPolicy(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete policy
  // ---------------------------------------------------------------------------
  async function handleDeletePolicy(deptId: string, policyType: PolicyType) {
    try {
      setDeletingPolicy(policyType);
      setPolicyMessage(null);
      const res = await apiFetch(`/admin/departments/${deptId}/policies/${policyType}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setPolicyMessage({ type: 'success', text: `Policy "${POLICY_LABELS[policyType]}" removed.` });
      await fetchPolicies(deptId);
    } catch (err: any) {
      setPolicyMessage({ type: 'error', text: err.message || 'Failed to delete policy.' });
    } finally {
      setDeletingPolicy(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Draft helpers
  // ---------------------------------------------------------------------------
  function getDraft(policyType: PolicyType) {
    return policyDrafts[policyType] ?? { value: '', isActive: true };
  }

  function setDraftValue(policyType: PolicyType, value: string) {
    setPolicyDrafts((prev) => ({
      ...prev,
      [policyType]: { ...getDraft(policyType), value },
    }));
  }

  function setDraftActive(policyType: PolicyType, isActive: boolean) {
    setPolicyDrafts((prev) => ({
      ...prev,
      [policyType]: { ...getDraft(policyType), isActive },
    }));
  }

  function toggleBlockedEntity(policyType: PolicyType, entity: string) {
    const draft = getDraft(policyType);
    const current = draft.value ? draft.value.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const next = current.includes(entity)
      ? current.filter((e) => e !== entity)
      : [...current, entity];
    setDraftValue(policyType, next.join(','));
  }

  // ---------------------------------------------------------------------------
  // Policy editor per type
  // ---------------------------------------------------------------------------
  function renderPolicyEditor(deptId: string, policyType: PolicyType) {
    const draft = getDraft(policyType);
    const existingPolicy = policies.find((p) => p.policyType === policyType);
    const isSaving = savingPolicy === policyType;
    const isDeleting = deletingPolicy === policyType;

    return (
      <div
        key={policyType}
        className="p-4 rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-[#f5f5f7]/50 dark:bg-[#2c2c2e]/50"
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {POLICY_LABELS[policyType]}
          </h4>
          <label className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#86868b]">
            <span>Active</span>
            <button
              type="button"
              onClick={() => setDraftActive(policyType, !draft.isActive)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                draft.isActive ? 'bg-iron-600' : 'bg-[#d2d2d7] dark:bg-[#48484a]'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  draft.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </label>
        </div>

        {policyType === 'allowed_sites' && (
          <div>
            <label className="block text-xs text-[#6e6e73] dark:text-[#86868b] mb-1">
              Comma-separated domains
            </label>
            <input
              type="text"
              value={draft.value}
              onChange={(e) => setDraftValue(policyType, e.target.value)}
              placeholder="chat.openai.com, claude.ai, gemini.google.com"
              className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
            />
          </div>
        )}

        {policyType === 'blocked_entity_types' && (
          <div>
            <label className="block text-xs text-[#6e6e73] dark:text-[#86868b] mb-2">
              Select entity types to block
            </label>
            <div className="flex flex-wrap gap-2">
              {ENTITY_TYPE_OPTIONS.map((entity) => {
                const selected = draft.value
                  ? draft.value.split(',').map((s) => s.trim()).includes(entity)
                  : false;
                return (
                  <label
                    key={entity}
                    className="flex items-center gap-1.5 text-xs text-[#424245] dark:text-[#a1a1a6]"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleBlockedEntity(policyType, entity)}
                      className="rounded border-[#d2d2d7] text-iron-600 focus:ring-iron-500"
                    />
                    <span className="font-mono bg-[#f5f5f7] dark:bg-[#38383a] px-1.5 py-0.5 rounded text-[11px]">
                      {entity}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {policyType === 'can_bypass' && (
          <div>
            <label className="block text-xs text-[#6e6e73] dark:text-[#86868b] mb-1">
              Allow users in this department to bypass warnings
            </label>
            <button
              type="button"
              onClick={() => setDraftValue(policyType, draft.value === 'true' ? 'false' : 'true')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                draft.value === 'true' ? 'bg-iron-600' : 'bg-[#d2d2d7] dark:bg-[#48484a]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  draft.value === 'true' ? 'translate-x-[22px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
            <span className="ml-2 text-xs text-[#6e6e73] dark:text-[#86868b]">
              {draft.value === 'true' ? 'Bypass allowed' : 'Bypass denied'}
            </span>
          </div>
        )}

        {policyType === 'max_sensitivity' && (
          <div>
            <label className="block text-xs text-[#6e6e73] dark:text-[#86868b] mb-1">
              Maximum sensitivity score (0-100)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.value}
              onChange={(e) => setDraftValue(policyType, e.target.value)}
              placeholder="60"
              className="w-32 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
            />
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => handleSavePolicy(deptId, policyType)}
            disabled={isSaving}
            className={`px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-colors ${
              isSaving ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          {existingPolicy && (
            <button
              onClick={() => handleDeletePolicy(deptId, policyType)}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
            <li>
              <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
                Admin
              </a>
            </li>
            <li>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </li>
            <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Departments</li>
          </ol>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Department Policies</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading departments...</span>
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
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li>
            <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
              Admin
            </a>
          </li>
          <li>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Departments</li>
        </ol>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Department Policies</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Configure per-team AI usage policies and restrictions.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-iron-600 hover:bg-iron-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {showCreateForm ? 'Cancel' : 'Create Department'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Create department form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">New Department</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Name
              </label>
              <input
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Litigation, Corporate, IP"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Brief description of the department"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
              />
            </div>

            {createError && (
              <div className="p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                {createError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={creating}
                className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${
                  creating ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
                }`}
              >
                {creating ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  'Create Department'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Departments list */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        {departments.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
              </svg>
            </div>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              No departments configured. Create your first department to enable per-team AI policies.
            </p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1.5fr_80px_90px_100px] gap-4 px-6 py-3 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Name</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Description</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Users</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Policies</span>
              <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide text-right">Actions</span>
            </div>

            {/* Rows */}
            {departments.map((dept) => (
              <div key={dept.id} className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 last:border-b-0">
                {/* Department row */}
                {editingId === dept.id ? (
                  <div className="px-6 py-4 space-y-3">
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500"
                        placeholder="Department name"
                      />
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="flex-1 rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500"
                        placeholder="Description (optional)"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(dept.id)}
                        disabled={updating}
                        className={`px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-colors ${
                          updating ? 'bg-iron-400 cursor-not-allowed' : 'bg-iron-600 hover:bg-iron-700'
                        }`}
                      >
                        {updating ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7] dark:border-[#38383a] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-[1fr_1.5fr_80px_90px_100px] gap-4 px-6 py-4 items-center cursor-pointer hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors"
                    onClick={() => handleToggleExpand(dept.id)}
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-4 h-4 text-[#86868b] transition-transform ${expandedId === dept.id ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                      <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{dept.name}</span>
                    </div>
                    <span className="text-sm text-[#6e6e73] dark:text-[#86868b] truncate">
                      {dept.description || '--'}
                    </span>
                    <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                      {dept.userCount ?? '--'}
                    </span>
                    <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                      {dept.policyCount ?? '--'}
                    </span>
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingId(dept.id);
                          setEditName(dept.name);
                          setEditDescription(dept.description || '');
                        }}
                        className="text-xs font-medium text-iron-600 dark:text-iron-400 hover:text-iron-800 dark:hover:text-iron-300 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteDept(dept.id)}
                        disabled={deletingDeptId === dept.id}
                        className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingDeptId === dept.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded policy editor */}
                {expandedId === dept.id && editingId !== dept.id && (
                  <div className="px-6 pb-6">
                    <div className="ml-6 border-l-2 border-iron-200 dark:border-iron-800 pl-6">
                      <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
                        Policies for {dept.name}
                      </h3>

                      {policyMessage && (
                        <div
                          className={`mb-4 p-3 rounded-lg text-sm font-medium ${
                            policyMessage.type === 'success'
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {policyMessage.text}
                        </div>
                      )}

                      {policiesLoading ? (
                        <div className="flex items-center gap-3 py-4">
                          <div className="w-5 h-5 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
                          <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading policies...</span>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {POLICY_TYPES.map((pt) => renderPolicyEditor(dept.id, pt))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
