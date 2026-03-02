'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';

const ENTITY_TYPES = [
  { key: 'person', label: 'Person Names', description: 'Full names, partial names, aliases' },
  { key: 'organization', label: 'Organizations', description: 'Company names, firm names, institutions' },
  { key: 'email', label: 'Email Addresses', description: 'Personal and professional email addresses' },
  { key: 'phone', label: 'Phone Numbers', description: 'Mobile, landline, and fax numbers' },
  { key: 'ssn', label: 'SSN / National IDs', description: 'Social security and government-issued IDs' },
  { key: 'address', label: 'Physical Addresses', description: 'Street addresses, cities, postal codes' },
  { key: 'financial', label: 'Financial Data', description: 'Account numbers, routing numbers, credit cards' },
  { key: 'date', label: 'Dates of Birth', description: 'Birth dates and other sensitive dates' },
  { key: 'medical', label: 'Medical Records', description: 'Patient data, diagnoses, medications' },
  { key: 'legal', label: 'Legal Identifiers', description: 'Case numbers, docket IDs, matter numbers' },
];

const DEMO_CONFIG = {
  entityToggles: Object.fromEntries(ENTITY_TYPES.map((e) => [e.key, true])),
  allowlist: ['Acme Corp', 'internal-project-alpha'],
  blocklist: ['confidential-client-x', 'Project Nightfall'],
};

export default function ProtectionSettingsPage() {
  const { apiFetch } = useApiClient();

  const [entityToggles, setEntityToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(ENTITY_TYPES.map((e) => [e.key, true]))
  );
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [newAllowItem, setNewAllowItem] = useState('');
  const [newBlockItem, setNewBlockItem] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        setLoading(true);
        const response = await apiFetch('/admin/firm');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.config?.entityToggles) setEntityToggles(data.config.entityToggles);
        if (data.config?.allowlist) setAllowlist(data.config.allowlist);
        if (data.config?.blocklist) setBlocklist(data.config.blocklist);
      } catch {
        setEntityToggles(DEMO_CONFIG.entityToggles);
        setAllowlist(DEMO_CONFIG.allowlist);
        setBlocklist(DEMO_CONFIG.blocklist);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  function toggleEntity(key: string) {
    setEntityToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addAllowItem() {
    const trimmed = newAllowItem.trim();
    if (trimmed && !allowlist.includes(trimmed)) {
      setAllowlist([...allowlist, trimmed]);
      setNewAllowItem('');
    }
  }

  function removeAllowItem(item: string) {
    setAllowlist(allowlist.filter((i) => i !== item));
  }

  function addBlockItem() {
    const trimmed = newBlockItem.trim();
    if (trimmed && !blocklist.includes(trimmed)) {
      setBlocklist([...blocklist, trimmed]);
      setNewBlockItem('');
    }
  }

  function removeBlockItem(item: string) {
    setBlocklist(blocklist.filter((i) => i !== item));
  }

  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage(null);
      const response = await apiFetch('/admin/firm', {
        method: 'PUT',
        body: JSON.stringify({
          config: {
            entityToggles,
            allowlist,
            blocklist,
          },
        }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      setSaveMessage({ type: 'success', text: 'Protection settings saved.' });
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save protection settings.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <div className="h-5 w-40 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-8 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
              <div className="h-8 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
              <div className="h-8 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Entity Type Toggles */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Entity Detection</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5">
          Enable or disable detection for specific entity types.
        </p>
        <div className="space-y-3">
          {ENTITY_TYPES.map((entity) => (
            <div key={entity.key} className="flex items-center justify-between py-2 border-b border-[#d2d2d7]/20 dark:border-[#38383a]/40 last:border-0">
              <div className="min-w-0 flex-1 mr-4">
                <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{entity.label}</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">{entity.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={entityToggles[entity.key] ?? true}
                aria-label={`Toggle ${entity.label} detection`}
                onClick={() => toggleEntity(entity.key)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
                  entityToggles[entity.key] ? 'bg-iron-600' : 'bg-[#d2d2d7] dark:bg-[#48484a]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition-transform ${
                    entityToggles[entity.key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Allowlist */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Allowlist</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Terms in the allowlist will never be flagged as sensitive.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newAllowItem}
            onChange={(e) => setNewAllowItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAllowItem(); }}
            placeholder="Add term..."
            className="flex-1 px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="New allowlist term"
          />
          <button
            type="button"
            onClick={addAllowItem}
            className="min-h-[44px] px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e]"
          >
            Add
          </button>
        </div>
        {allowlist.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {allowlist.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full text-sm border border-green-200 dark:border-green-800"
              >
                {item}
                <button
                  type="button"
                  onClick={() => removeAllowItem(item)}
                  aria-label={`Remove ${item} from allowlist`}
                  className="p-0.5 hover:bg-green-200 dark:hover:bg-green-800 rounded-full transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#86868b] dark:text-[#636366]">No items in the allowlist.</p>
        )}
      </div>

      {/* Blocklist */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Blocklist</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Terms in the blocklist will always be flagged and blocked.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newBlockItem}
            onChange={(e) => setNewBlockItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBlockItem(); }}
            placeholder="Add term..."
            className="flex-1 px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="New blocklist term"
          />
          <button
            type="button"
            onClick={addBlockItem}
            className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e]"
          >
            Add
          </button>
        </div>
        {blocklist.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {blocklist.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-full text-sm border border-red-200 dark:border-red-800"
              >
                {item}
                <button
                  type="button"
                  onClick={() => removeBlockItem(item)}
                  aria-label={`Remove ${item} from blocklist`}
                  className="p-0.5 hover:bg-red-200 dark:hover:bg-red-800 rounded-full transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#86868b] dark:text-[#636366]">No items in the blocklist.</p>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] ${
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
            'Save Protection Settings'
          )}
        </button>
        {saveMessage && (
          <span className={`text-sm font-medium ${saveMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {saveMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}
