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
  thresholds: { warn: 30, block: 70, proxy: 50 },
  entityToggles: Object.fromEntries(ENTITY_TYPES.map((e) => [e.key, true])),
  allowlist: ['Acme Corp', 'internal-project-alpha'],
  blocklist: ['confidential-client-x', 'Project Nightfall'],
};

export default function ProtectionSettingsPage() {
  const { apiFetch } = useApiClient();

  const [thresholds, setThresholds] = useState({ warn: 30, block: 70, proxy: 50 });
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
        if (data.config?.thresholds) {
          const t = data.config.thresholds;
          setThresholds({
            warn: t.warn ?? t.passthrough ?? 30,
            block: t.block ?? t.cloudMasked ?? 70,
            proxy: t.proxy ?? 50,
          });
        }
        if (data.config?.entityToggles) setEntityToggles(data.config.entityToggles);
        if (data.config?.allowlist) setAllowlist(data.config.allowlist);
        if (data.config?.blocklist) setBlocklist(data.config.blocklist);
      } catch {
        setThresholds(DEMO_CONFIG.thresholds);
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
            thresholds: {
              passthrough: thresholds.warn,
              cloudMasked: thresholds.block,
              warn: thresholds.warn,
              block: thresholds.block,
              proxy: thresholds.proxy,
            },
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
          <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-8 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-8 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-8 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Sensitivity Thresholds */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Sensitivity Thresholds</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Configure risk score thresholds that trigger each protection action.
        </p>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Warn Threshold</label>
              <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 tabular-nums">{thresholds.warn}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={thresholds.warn}
              onChange={(e) => setThresholds({ ...thresholds, warn: parseInt(e.target.value) })}
              className="w-full accent-yellow-500"
              aria-label="Warn threshold"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Events above this score will trigger a warning.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Block Threshold</label>
              <span className="text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">{thresholds.block}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={thresholds.block}
              onChange={(e) => setThresholds({ ...thresholds, block: parseInt(e.target.value) })}
              className="w-full accent-red-500"
              aria-label="Block threshold"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Events above this score will be blocked entirely.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proxy Threshold</label>
              <span className="text-sm font-semibold text-iron-600 dark:text-iron-400 tabular-nums">{thresholds.proxy}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={thresholds.proxy}
              onChange={(e) => setThresholds({ ...thresholds, proxy: parseInt(e.target.value) })}
              className="w-full accent-iron-500"
              aria-label="Proxy threshold"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Events above this score will be routed through the protection proxy.</p>
          </div>
        </div>
      </div>

      {/* Entity Type Toggles */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Entity Detection</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Enable or disable detection for specific entity types.
        </p>
        <div className="space-y-3">
          {ENTITY_TYPES.map((entity) => (
            <div key={entity.key} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div className="min-w-0 flex-1 mr-4">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{entity.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{entity.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={entityToggles[entity.key] ?? true}
                aria-label={`Toggle ${entity.label} detection`}
                onClick={() => toggleEntity(entity.key)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                  entityToggles[entity.key] ? 'bg-iron-600' : 'bg-gray-300 dark:bg-gray-600'
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Allowlist</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Terms in the allowlist will never be flagged as sensitive.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newAllowItem}
            onChange={(e) => setNewAllowItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAllowItem(); }}
            placeholder="Add term..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="New allowlist term"
          />
          <button
            type="button"
            onClick={addAllowItem}
            className="min-h-[44px] px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
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
          <p className="text-sm text-gray-400 dark:text-gray-500">No items in the allowlist.</p>
        )}
      </div>

      {/* Blocklist */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Blocklist</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Terms in the blocklist will always be flagged and blocked.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newBlockItem}
            onChange={(e) => setNewBlockItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBlockItem(); }}
            placeholder="Add term..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="New blocklist term"
          />
          <button
            type="button"
            onClick={addBlockItem}
            className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
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
          <p className="text-sm text-gray-400 dark:text-gray-500">No items in the blocklist.</p>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
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
