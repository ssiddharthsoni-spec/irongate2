'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../../../lib/api';

export default function KillSwitchPage() {
  const { apiFetch } = useApiClient();

  // Status state
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [lastActivated, setLastActivated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [adminKey1, setAdminKey1] = useState('');
  const [adminKey2, setAdminKey2] = useState('');
  const [scope, setScope] = useState<'global' | 'firm'>('firm');

  // Confirmation dialog state
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [toggling, setToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---------------------------------------------------------------------------
  // 1. Fetch current kill switch status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async () => {
    try {
      const response = await apiFetch('/security/posture');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      setKillSwitchActive(!!data.kill_switch);
      if (data.kill_switch_activated_at) {
        setLastActivated(data.kill_switch_activated_at);
      }
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch kill switch status:', err);
      setError('Unable to fetch kill switch status. The API may be unavailable.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // 2. Toggle kill switch
  // ---------------------------------------------------------------------------
  function handleToggleClick() {
    setToggleMessage(null);

    if (!adminKey1.trim() || !adminKey2.trim()) {
      setToggleMessage({ type: 'error', text: 'Both admin keys are required.' });
      return;
    }

    setShowConfirm(true);
    setConfirmText('');
  }

  async function handleConfirmToggle() {
    if (confirmText !== 'CONFIRM') return;

    try {
      setToggling(true);
      setToggleMessage(null);

      const response = await apiFetch('/kill-switch', {
        method: 'POST',
        headers: {
          'X-Admin-Key-1': adminKey1.trim(),
          'X-Admin-Key-2': adminKey2.trim(),
        },
        body: JSON.stringify({
          active: !killSwitchActive,
          scope,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server responded with ${response.status}`);
      }

      setKillSwitchActive(!killSwitchActive);
      if (!killSwitchActive) {
        setLastActivated(new Date().toISOString());
      }
      setToggleMessage({
        type: 'success',
        text: `Kill switch ${!killSwitchActive ? 'activated' : 'deactivated'} successfully.`,
      });
      setShowConfirm(false);
      setConfirmText('');
    } catch (err: any) {
      setToggleMessage({
        type: 'error',
        text: err.message || 'Failed to toggle kill switch. Verify your admin keys and try again.',
      });
    } finally {
      setToggling(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Kill Switch</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading kill switch status...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Kill Switch</h1>

      {/* Warning Banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6">
        <div className="flex gap-3">
          <span className="text-amber-600 dark:text-amber-400 text-lg flex-shrink-0">!</span>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Activating the kill switch will immediately disable all AI monitoring across all employee extensions. Use only in emergencies.
          </p>
        </div>
      </div>

      {/* API Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Current Status Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Current Status</h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`w-4 h-4 rounded-full ${
                killSwitchActive
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                  : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
              }`}
            />
            <div>
              <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {killSwitchActive ? 'ACTIVE — Monitoring Disabled' : 'Standby — Monitoring Active'}
              </p>
              {lastActivated && (
                <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                  Last activated: {new Date(lastActivated).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
              killSwitchActive
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            }`}
          >
            {killSwitchActive ? 'Active' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Admin Keys Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Admin Authorization</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Two separate admin keys are required to toggle the kill switch. This ensures dual-authorization control.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="adminKey1" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              Admin Key 1
            </label>
            <input
              id="adminKey1"
              type="password"
              value={adminKey1}
              onChange={(e) => setAdminKey1(e.target.value)}
              placeholder="Enter first admin key"
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label htmlFor="adminKey2" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              Admin Key 2
            </label>
            <input
              id="adminKey2"
              type="password"
              value={adminKey2}
              onChange={(e) => setAdminKey2(e.target.value)}
              placeholder="Enter second admin key"
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Scope & Toggle Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Scope</h2>
        <div className="flex gap-3 mb-6">
          <button
            type="button"
            onClick={() => setScope('firm')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              scope === 'firm'
                ? 'bg-iron-600 text-white'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a]'
            }`}
          >
            This Firm
          </button>
          <button
            type="button"
            onClick={() => setScope('global')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              scope === 'global'
                ? 'bg-iron-600 text-white'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a]'
            }`}
          >
            Global (All Firms)
          </button>
        </div>

        {/* Toggle Button */}
        <button
          type="button"
          onClick={handleToggleClick}
          disabled={toggling}
          className={`w-full min-h-[56px] rounded-xl text-base font-semibold text-white transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
            killSwitchActive
              ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
              : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
          } ${toggling ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {toggling ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </span>
          ) : killSwitchActive ? (
            'Deactivate Kill Switch'
          ) : (
            'Activate Kill Switch'
          )}
        </button>
      </div>

      {/* Toggle feedback message */}
      {toggleMessage && (
        <div
          className={`mb-6 p-3 rounded-lg text-sm font-medium ${
            toggleMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          }`}
        >
          {toggleMessage.text}
        </div>
      )}

      {/* Confirmation Dialog (modal overlay) */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-6 shadow-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
              {killSwitchActive ? 'Deactivate Kill Switch?' : 'Activate Kill Switch?'}
            </h3>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
              {killSwitchActive
                ? 'This will re-enable AI monitoring for all extensions. Normal data governance policies will resume.'
                : 'This will immediately disable all AI monitoring. All employee extensions will stop capturing data until the kill switch is deactivated.'}
            </p>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-1">
              Scope: <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{scope === 'global' ? 'Global (All Firms)' : 'This Firm'}</span>
            </p>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
              Type <span className="font-mono font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">CONFIRM</span> to proceed.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type CONFIRM"
              autoFocus
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors mb-4 font-mono"
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText('');
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmToggle}
                disabled={confirmText !== 'CONFIRM' || toggling}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                  confirmText !== 'CONFIRM' || toggling
                    ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                    : killSwitchActive
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {toggling ? 'Processing...' : killSwitchActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
