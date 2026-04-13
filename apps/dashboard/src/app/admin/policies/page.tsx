'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionType = 'allow' | 'warn' | 'block' | 'pseudonymize_allow';

interface PolicyRule {
  id: string;
  name: string;
  entityTypes: string[];
  aiTools: string[];
  userRoles: string[];
  action: ActionType;
  blockMessage?: string;
  enabled: boolean;
  createdAt?: string;
}

const ENTITY_TYPES = [
  'PERSON',
  'SSN',
  'CREDIT_CARD',
  'EMAIL',
  'PHONE_NUMBER',
  'ORGANIZATION',
  'MEDICAL_RECORD',
  'API_KEY',
  'MONETARY_AMOUNT',
  'ADDRESS',
  'DATE_OF_BIRTH',
  'IP_ADDRESS',
  'PASSPORT',
  'BANK_ACCOUNT',
];

const AI_TOOLS = [
  'chatgpt',
  'claude',
  'gemini',
  'copilot',
  'perplexity',
  'deepseek',
  'poe',
  'groq',
  'huggingface',
  'you',
];

const USER_ROLES = ['admin', 'user', 'viewer'];

const ACTION_LABELS: Record<ActionType, string> = {
  allow: 'Allow',
  warn: 'Warn',
  block: 'Block',
  pseudonymize_allow: 'Pseudonymize + Allow',
};

const ACTION_STYLES: Record<ActionType, string> = {
  allow: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  warn: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  block: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  pseudonymize_allow: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
};

// ---------------------------------------------------------------------------
// Multi-select chip component
// ---------------------------------------------------------------------------
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  required,
  optional,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  required?: boolean;
  optional?: boolean;
}) {
  function toggle(val: string) {
    if (selected.includes(val)) onChange(selected.filter((s) => s !== val));
    else onChange([...selected, val]);
  }
  return (
    <div>
      <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
        {label} {required && <span className="text-red-500">*</span>}
        {optional && <span className="text-[#86868b] font-normal"> (optional — applies to all if empty)</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                isSelected
                  ? 'bg-iron-600 text-white border-iron-600'
                  : 'bg-white dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] border-[#d2d2d7] dark:border-[#38383a] hover:border-iron-400'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PoliciesPage() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();

  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<PolicyRule | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEntityTypes, setFormEntityTypes] = useState<string[]>([]);
  const [formAiTools, setFormAiTools] = useState<string[]>([]);
  const [formUserRoles, setFormUserRoles] = useState<string[]>([]);
  const [formAction, setFormAction] = useState<ActionType>('warn');
  const [formBlockMessage, setFormBlockMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch rules
  // ---------------------------------------------------------------------------
  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setComingSoon(false);
      const res = await apiFetch('/admin/policies');
      if (res.status === 404) {
        setComingSoon(true);
        setRules([]);
        return;
      }
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setRules(Array.isArray(data) ? data : data.rules ?? []);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        setComingSoon(true);
        setRules([]);
      } else {
        setError(err.message || 'Failed to load policy rules.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Escape key closes modal
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && showModal) closeModal();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  function openCreateModal() {
    setEditingRule(null);
    setFormName('');
    setFormEntityTypes([]);
    setFormAiTools([]);
    setFormUserRoles([]);
    setFormAction('warn');
    setFormBlockMessage('');
    setFormError(null);
    setShowModal(true);
  }

  function openEditModal(rule: PolicyRule) {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormEntityTypes(rule.entityTypes || []);
    setFormAiTools(rule.aiTools || []);
    setFormUserRoles(rule.userRoles || []);
    setFormAction(rule.action);
    setFormBlockMessage(rule.blockMessage || '');
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingRule(null);
    setFormError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!formName.trim()) {
      setFormError('Rule name is required.');
      return;
    }
    if (formEntityTypes.length === 0) {
      setFormError('Select at least one entity type.');
      return;
    }
    if (formAiTools.length === 0) {
      setFormError('Select at least one AI tool.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      const body = {
        name: formName.trim(),
        entityTypes: formEntityTypes,
        aiTools: formAiTools,
        userRoles: formUserRoles,
        action: formAction,
        blockMessage: formAction === 'block' ? formBlockMessage.trim() || undefined : undefined,
      };

      const res = editingRule
        ? await apiFetch(`/admin/policies/${editingRule.id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        : await apiFetch('/admin/policies', {
            method: 'POST',
            body: JSON.stringify(body),
          });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      addToast({
        type: 'success',
        message: editingRule ? 'Rule updated successfully.' : 'Rule created successfully.',
      });
      closeModal();
      await fetchRules();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save rule.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(rule: PolicyRule) {
    try {
      setTogglingId(rule.id);
      const res = await apiFetch(`/admin/policies/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({ type: 'success', message: `Rule ${!rule.enabled ? 'enabled' : 'disabled'}.` });
      await fetchRules();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to toggle rule.' });
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(rule: PolicyRule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    try {
      setDeletingId(rule.id);
      const res = await apiFetch(`/admin/policies/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({ type: 'success', message: 'Rule deleted.' });
      await fetchRules();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to delete rule.' });
    } finally {
      setDeletingId(null);
    }
  }

  function formatCondition(rule: PolicyRule) {
    const entities = rule.entityTypes.length ? rule.entityTypes.join(', ') : 'any entity';
    const tools = rule.aiTools.length ? rule.aiTools.join(', ') : 'any tool';
    const roles = rule.userRoles.length ? ` from ${rule.userRoles.join(', ')}` : '';
    return `IF ${entities} in ${tools}${roles}`;
  }

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
        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Policy Rules</span>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Policy Rules</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Build rules to govern what data can be sent to which AI tools.
          </p>
        </div>
        {!comingSoon && (
          <button
            onClick={openCreateModal}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-iron-600 text-white hover:bg-iron-700 transition-colors"
          >
            + Create Rule
          </button>
        )}
      </div>

      {/* Coming soon banner */}
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
                The policy engine is in beta. Below is a preview of how you&apos;ll build rules once it&apos;s available.
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

      {/* Loading */}
      {loading ? (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading policy rules...</span>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          {rules.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                {comingSoon ? 'Policy engine preview' : 'No policy rules yet'}
              </p>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
                {comingSoon
                  ? 'Rules like "Block SSN to ChatGPT" or "Pseudonymize client names for all tools" will show up here.'
                  : 'Create your first rule to govern AI usage.'}
              </p>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[1.3fr_2fr_130px_90px_130px] gap-4 px-6 py-3 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Name</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Condition</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Action</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide">Status</span>
                <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide text-right">Actions</span>
              </div>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-[1.3fr_2fr_130px_90px_130px] gap-4 px-6 py-4 items-center border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 last:border-b-0"
                >
                  <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                    {rule.name}
                  </span>
                  <span className="text-sm text-[#6e6e73] dark:text-[#86868b] truncate" title={formatCondition(rule)}>
                    {formatCondition(rule)}
                  </span>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLES[rule.action]}`}>
                      {ACTION_LABELS[rule.action]}
                    </span>
                  </span>
                  <span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        rule.enabled
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
                      }`}
                    >
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </span>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => handleToggleEnabled(rule)}
                      disabled={togglingId === rule.id}
                      className="text-xs font-medium text-iron-600 dark:text-iron-400 hover:text-iron-800 dark:hover:text-iron-300 disabled:opacity-50"
                    >
                      {togglingId === rule.id ? '...' : rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => openEditModal(rule)}
                      className="text-xs font-medium text-iron-600 dark:text-iron-400 hover:text-iron-800 dark:hover:text-iron-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      disabled={deletingId === rule.id}
                      className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                    >
                      {deletingId === rule.id ? '...' : 'Delete'}
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
          <div className="relative bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              {editingRule ? 'Edit Rule' : 'Create Rule'}
            </h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5">
              IF [entity type] IN [AI tool] FROM [user role] THEN [action].
            </p>

            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                  Rule name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Block SSN to ChatGPT"
                  className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
                />
              </div>

              <MultiSelect
                label="Entity types"
                options={ENTITY_TYPES}
                selected={formEntityTypes}
                onChange={setFormEntityTypes}
                required
              />

              <MultiSelect
                label="AI tools"
                options={AI_TOOLS}
                selected={formAiTools}
                onChange={setFormAiTools}
                required
              />

              <MultiSelect
                label="User roles"
                options={USER_ROLES}
                selected={formUserRoles}
                onChange={setFormUserRoles}
                optional
              />

              <div>
                <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
                  Action <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
                    <label
                      key={a}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        formAction === a
                          ? 'border-iron-600 bg-iron-50 dark:bg-iron-900/20'
                          : 'border-[#d2d2d7] dark:border-[#38383a] hover:border-iron-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="action"
                        value={a}
                        checked={formAction === a}
                        onChange={() => setFormAction(a)}
                        className="accent-iron-600"
                      />
                      <span className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{ACTION_LABELS[a]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {formAction === 'block' && (
                <div>
                  <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                    Custom block message (optional)
                  </label>
                  <textarea
                    value={formBlockMessage}
                    onChange={(e) => setFormBlockMessage(e.target.value)}
                    rows={2}
                    placeholder="Shown to users when this rule blocks their prompt."
                    className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366] resize-none"
                  />
                </div>
              )}

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
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving...
                    </span>
                  ) : editingRule ? (
                    'Save Changes'
                  ) : (
                    'Create Rule'
                  )}
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
