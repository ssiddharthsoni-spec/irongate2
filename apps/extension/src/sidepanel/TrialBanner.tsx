import React, { useState, useEffect } from 'react';
import {
  TRIAL_ENDS_AT,
  TRIAL_START_DATE,
  SUBSCRIPTION_TIER,
  TOTAL_ENTITIES_DETECTED,
} from '../shared/storage-keys';

export function TrialBanner() {
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [dayNumber, setDayNumber] = useState<number>(0);
  const [tier, setTier] = useState<string>('basic');
  const [entitiesDetected, setEntitiesDetected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // We can't say "trial ended" unless a trial actually started. Without this
  // flag, a fresh install with a stale/default TRIAL_ENDS_AT in the past
  // flashes the scary red "Trial ended" banner on a user who never had one.
  const [trialStarted, setTrialStarted] = useState(false);

  useEffect(() => {
    async function load() {
      const data = await chrome.storage.local.get([
        TRIAL_ENDS_AT,
        TRIAL_START_DATE,
        SUBSCRIPTION_TIER,
        TOTAL_ENTITIES_DETECTED,
      ]);

      setTier(data[SUBSCRIPTION_TIER] || 'basic');
      setEntitiesDetected(data[TOTAL_ENTITIES_DETECTED] || 0);

      if (data[TRIAL_ENDS_AT]) {
        const endMs = new Date(data[TRIAL_ENDS_AT]).getTime();
        if (!Number.isNaN(endMs)) {
          const remaining = Math.ceil((endMs - Date.now()) / (1000 * 60 * 60 * 24));
          setDaysRemaining(remaining);
        }
      }

      if (data[TRIAL_START_DATE]) {
        const startMs = new Date(data[TRIAL_START_DATE]).getTime();
        if (!Number.isNaN(startMs)) {
          const elapsed = Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24)) + 1;
          setDayNumber(Math.max(1, Math.min(15, elapsed)));
          setTrialStarted(true);
        }
      }
    }

    load();

    // Listen for storage changes
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[TOTAL_ENTITIES_DETECTED]) {
        setEntitiesDetected(changes[TOTAL_ENTITIES_DETECTED].newValue || 0);
      }
      if (changes[SUBSCRIPTION_TIER]) {
        setTier(changes[SUBSCRIPTION_TIER].newValue || 'basic');
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (dismissed) return null;

  // Don't show banner for paid users (team, enterprise)
  if (tier === 'team' || tier === 'enterprise') return null;

  // Trial expired — but ONLY if a trial actually started. A fresh install
  // that never enrolled must not see this scary red banner.
  if (trialStarted && daysRemaining !== null && daysRemaining <= 0) {
    return (
      <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-red-800">Trial ended</span>
          <button onClick={() => setDismissed(true)} className="text-red-400 hover:text-red-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-red-700 mb-2">
          You're on Basic &mdash; ML detection and proxy mode are disabled.
        </p>
        <button
          onClick={() => chrome.tabs.create({ url: 'https://irongate-dashboard.vercel.app/sign-in?redirect_url=%2Fsettings%2Fbilling' })}
          className="w-full py-1.5 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
        >
          Upgrade to Pro
        </button>
      </div>
    );
  }

  // Day 13-14: Red urgent
  if (daysRemaining !== null && daysRemaining <= 2) {
    return (
      <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-red-800">
            Trial ends {daysRemaining === 1 ? 'tomorrow' : 'today'}
          </span>
          <span className="text-[10px] font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
            Pro
          </span>
        </div>
        <p className="text-[10px] text-red-700 mb-2">
          {entitiesDetected} entities detected &mdash; Upgrade to keep ML-powered detection.
        </p>
        <button
          onClick={() => chrome.tabs.create({ url: 'https://irongate-dashboard.vercel.app/sign-in?redirect_url=%2Fsettings%2Fbilling' })}
          className="w-full py-1.5 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
        >
          Upgrade Now
        </button>
      </div>
    );
  }

  // Day 10-12: Amber warning
  if (daysRemaining !== null && daysRemaining <= 5) {
    return (
      <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-amber-800">
            {daysRemaining} days left in trial
          </span>
          <span className="text-[10px] font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
            Pro
          </span>
        </div>
        <p className="text-[10px] text-amber-700">
          {entitiesDetected} entities detected &mdash; Upgrade to keep all Pro features.
        </p>
      </div>
    );
  }

  // Day 1-9: Blue info banner
  if (daysRemaining !== null && daysRemaining > 0 && tier === 'pro') {
    return (
      <div className="mx-4 mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-blue-800">
            Day {dayNumber} of 15 &mdash; {entitiesDetected} entities detected
          </span>
          <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
            Pro
          </span>
        </div>
      </div>
    );
  }

  // Basic tier (post-trial or no trial) — show subtle upgrade prompt
  if (tier === 'basic') {
    return (
      <div className="mx-4 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">Basic plan &mdash; regex detection only</span>
          <button
            onClick={() => chrome.tabs.create({ url: 'https://irongate-dashboard.vercel.app/sign-in?redirect_url=%2Fsettings%2Fbilling' })}
            className="text-[10px] font-semibold text-iron-600 hover:text-iron-700"
          >
            Upgrade
          </button>
        </div>
      </div>
    );
  }

  return null;
}
