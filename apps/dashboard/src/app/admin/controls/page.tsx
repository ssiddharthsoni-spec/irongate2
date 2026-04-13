'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';
import { useToast } from '@/components/toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SensitivityLevel = 'relaxed' | 'balanced' | 'strict';
type UpdatePolicy = 'immediate' | 'within_7_days' | 'within_30_days';

interface KillSwitchHistoryItem {
  id?: string;
  timestamp: string;
  actor?: string;
  duration?: string;
  reason?: string;
  action?: 'enabled' | 'disabled';
}

interface ControlsConfig {
  killSwitchEnabled: boolean;
  killSwitchHistory: KillSwitchHistoryItem[];
  sensitivity: SensitivityLevel;
  updatePolicy: UpdatePolicy;
  userCount?: number;
  flaggedPercent?: Record<SensitivityLevel, number>;
}

const SENSITIVITY_INFO: Record<SensitivityLevel, { label: string; desc: string; thresholds: string }> = {
  relaxed: {
    label: 'Relaxed',
    desc: 'More prompts pass through. Good for consulting, content agencies.',
    thresholds: 'Amber threshold: 40, Red threshold: 75',
  },
  balanced: {
    label: 'Balanced (default)',
    desc: 'Default thresholds. Good for most firms.',
    thresholds: 'Amber: 26, Red: 61',
  },
  strict: {
    label: 'Strict',
    desc: 'More prompts flagged. Good for law, healthcare, finance.',
    thresholds: 'Amber: 15, Red: 50',
  },
};

const UPDATE_POLICY_LABELS: Record<UpdatePolicy, string> = {
  immediate: 'Immediately on release',
  within_7_days: 'Within 7 days',
  within_30_days: 'Within 30 days (Enterprise)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ControlsPage() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();

  const [config, setConfig] = useState<ControlsConfig>({
    killSwitchEnabled: false,
    killSwitchHistory: [],
    sensitivity: 'balanced',
    updatePolicy: 'immediate',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState(false);

  // Sensitivity local state (for save button)
  const [selectedSensitivity, setSelectedSensitivity] = useState<SensitivityLevel>('balanced');
  const [savingSensitivity, setSavingSensitivity] = useState(false);

  // Update policy state
  const [selectedUpdatePolicy, setSelectedUpdatePolicy] = useState<UpdatePolicy>('immediate');
  const [savingUpdatePolicy, setSavingUpdatePolicy] = useState(false);

  // Kill switch confirm modal
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killReason, setKillReason] = useState('');
  const [togglingKillSwitch, setTogglingKillSwitch] = useState(false);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchControls = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setComingSoon(false);
      const res = await apiFetch('/admin/controls');
      if (res.status === 404) {
        setComingSoon(true);
        return;
      }
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      const normalized: ControlsConfig = {
        killSwitchEnabled: !!data.killSwitchEnabled,
        killSwitchHistory: Array.isArray(data.killSwitchHistory) ? data.killSwitchHistory : [],
        sensitivity: (data.sensitivity as SensitivityLevel) || 'balanced',
        updatePolicy: (data.updatePolicy as UpdatePolicy) || 'immediate',
        userCount: data.userCount,
        flaggedPercent: data.flaggedPercent,
      };
      setConfig(normalized);
      setSelectedSensitivity(normalized.sensitivity);
      setSelectedUpdatePolicy(normalized.updatePolicy);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        setComingSoon(true);
      } else {
        setError(err.message || 'Failed to load controls.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchControls();
  }, [fetchControls]);

  // Escape closes modal
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && showKillConfirm) closeKillConfirm();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showKillConfirm]);

  function closeKillConfirm() {
    setShowKillConfirm(false);
    setKillReason('');
  }

  // ---------------------------------------------------------------------------
  // Kill switch
  // ---------------------------------------------------------------------------
  function handleKillSwitchClick() {
    if (config.killSwitchEnabled) {
      // Turning off — no confirmation needed
      toggleKillSwitch(false);
    } else {
      setShowKillConfirm(true);
    }
  }

  async function toggleKillSwitch(enabled: boolean, reason?: string) {
    try {
      setTogglingKillSwitch(true);
      const res = await apiFetch('/admin/controls/kill-switch', {
        method: 'POST',
        body: JSON.stringify({ enabled, reason }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({
        type: enabled ? 'warning' : 'success',
        message: enabled ? 'Kill switch ACTIVATED. AI tools blocked org-wide.' : 'Kill switch deactivated.',
      });
      closeKillConfirm();
      await fetchControls();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to toggle kill switch.' });
    } finally {
      setTogglingKillSwitch(false);
    }
  }

  async function handleConfirmKillSwitch() {
    if (!killReason.trim()) {
      addToast({ type: 'error', message: 'Reason is required.' });
      return;
    }
    await toggleKillSwitch(true, killReason.trim());
  }

  // ---------------------------------------------------------------------------
  // Sensitivity
  // ---------------------------------------------------------------------------
  async function handleSaveSensitivity() {
    try {
      setSavingSensitivity(true);
      const res = await apiFetch('/admin/controls/sensitivity', {
        method: 'PUT',
        body: JSON.stringify({ level: selectedSensitivity }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({ type: 'success', message: 'Sensitivity updated.' });
      await fetchControls();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to save sensitivity.' });
    } finally {
      setSavingSensitivity(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Update policy
  // ---------------------------------------------------------------------------
  async function handleSaveUpdatePolicy() {
    try {
      setSavingUpdatePolicy(true);
      const res = await apiFetch('/admin/controls/update-policy', {
        method: 'PUT',
        body: JSON.stringify({ policy: selectedUpdatePolicy }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      addToast({ type: 'success', message: 'Auto-update policy updated.' });
      await fetchControls();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Failed to save update policy.' });
    } finally {
      setSavingUpdatePolicy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-4xl">
        <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
          <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">Admin</a>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Controls</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Controls</h1>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
          <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading controls...</span>
        </div>
      </div>
    );
  }

  const userCount = config.userCount ?? 47;
  const flaggedPercent =
    config.flaggedPercent?.[selectedSensitivity] ??
    (selectedSensitivity === 'relaxed' ? 8 : selectedSensitivity === 'balanced' ? 18 : 32);

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
          Admin
        </a>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Controls</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Sensitivity &amp; Kill Switch Controls</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
          Runtime admin controls for your IronGate deployment.
        </p>
      </div>

      {comingSoon && (
        <div className="mb-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">This feature is coming soon</p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Unified controls are in beta. Below is a preview of the configuration options.
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

      {/* ---------------------------------------------------------------- */}
      {/* Section A: Kill Switch                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Kill Switch</h2>

        {config.killSwitchEnabled && (
          <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 text-sm font-semibold">
            AI tools BLOCKED org-wide
          </div>
        )}

        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Emergency Kill Switch</h3>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                {config.killSwitchEnabled
                  ? `All AI traffic is currently blocked for your ${userCount} users.`
                  : 'All AI tool traffic is allowed per your policies.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.killSwitchEnabled}
              onClick={handleKillSwitchClick}
              disabled={togglingKillSwitch || comingSoon}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                config.killSwitchEnabled ? 'bg-red-600' : 'bg-[#d2d2d7] dark:bg-[#38383a]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  config.killSwitchEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Recent history */}
          {config.killSwitchHistory.length > 0 && (
            <div className="mt-6 pt-5 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
              <h4 className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wide mb-3">
                Recent Activations
              </h4>
              <ul className="space-y-2">
                {config.killSwitchHistory.slice(0, 5).map((h, idx) => (
                  <li
                    key={h.id || idx}
                    className="flex items-start gap-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {h.actor || 'Admin'}
                        </span>
                        <span className="text-[#86868b]">•</span>
                        <span className="text-[#6e6e73] dark:text-[#86868b]">
                          {new Date(h.timestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        {h.duration && (
                          <>
                            <span className="text-[#86868b]">•</span>
                            <span className="text-[#6e6e73] dark:text-[#86868b]">{h.duration}</span>
                          </>
                        )}
                      </div>
                      {h.reason && (
                        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1 truncate">
                          {h.reason}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section B: Sensitivity Controls                                    */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Sensitivity Controls</h2>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <div className="space-y-3">
            {(Object.keys(SENSITIVITY_INFO) as SensitivityLevel[]).map((level) => {
              const info = SENSITIVITY_INFO[level];
              const active = selectedSensitivity === level;
              return (
                <label
                  key={level}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    active
                      ? 'border-iron-600 bg-iron-50 dark:bg-iron-900/20'
                      : 'border-[#d2d2d7] dark:border-[#38383a] hover:border-iron-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="sensitivity"
                    value={level}
                    checked={active}
                    onChange={() => setSelectedSensitivity(level)}
                    className="mt-0.5 accent-iron-600"
                    disabled={comingSoon}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {info.label}
                    </p>
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-0.5">{info.desc}</p>
                    <p className="text-xs text-[#86868b] mt-1 font-mono">{info.thresholds}</p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between pt-4 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              With these settings, ~<span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{flaggedPercent}%</span> of your historical prompts would be flagged.
            </p>
            <button
              type="button"
              onClick={handleSaveSensitivity}
              disabled={savingSensitivity || comingSoon || selectedSensitivity === config.sensitivity}
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
                savingSensitivity || selectedSensitivity === config.sensitivity
                  ? 'bg-iron-400 cursor-not-allowed'
                  : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {savingSensitivity ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section C: Auto-Update Policy                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Auto-Update Policy</h2>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
            How should extensions auto-update?
          </label>
          <select
            value={selectedUpdatePolicy}
            onChange={(e) => setSelectedUpdatePolicy(e.target.value as UpdatePolicy)}
            disabled={comingSoon}
            className="w-full max-w-md px-3 py-2 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 disabled:opacity-50"
          >
            {(Object.keys(UPDATE_POLICY_LABELS) as UpdatePolicy[]).map((p) => (
              <option key={p} value={p}>
                {UPDATE_POLICY_LABELS[p]}
              </option>
            ))}
          </select>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleSaveUpdatePolicy}
              disabled={savingUpdatePolicy || comingSoon || selectedUpdatePolicy === config.updatePolicy}
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
                savingUpdatePolicy || selectedUpdatePolicy === config.updatePolicy
                  ? 'bg-iron-400 cursor-not-allowed'
                  : 'bg-iron-600 hover:bg-iron-700'
              }`}
            >
              {savingUpdatePolicy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      {/* Kill switch confirm modal */}
      {showKillConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeKillConfirm} />
          <div className="relative bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 w-full max-w-md">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  Activate Kill Switch?
                </h2>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  This will block ALL AI traffic for your {userCount} users immediately.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
                Reason for kill switch <span className="text-red-500">*</span>
              </label>
              <textarea
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                rows={3}
                placeholder="e.g. Suspected credential leak, investigating incident #1234"
                className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 placeholder-[#86868b] resize-none"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <button
                type="button"
                onClick={handleConfirmKillSwitch}
                disabled={togglingKillSwitch || !killReason.trim()}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                  togglingKillSwitch || !killReason.trim()
                    ? 'bg-red-400 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {togglingKillSwitch ? 'Activating...' : 'Activate Kill Switch'}
              </button>
              <button
                type="button"
                onClick={closeKillConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7] dark:border-[#38383a] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
