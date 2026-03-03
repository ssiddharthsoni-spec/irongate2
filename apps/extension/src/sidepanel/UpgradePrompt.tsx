import React, { useState, useEffect } from 'react';
import { SUBSCRIPTION_TIER } from '../shared/storage-keys';

/**
 * Persistent upgrade button shown in the side panel header for Basic tier users.
 */
export function UpgradePrompt() {
  const [tier, setTier] = useState<string>('');

  useEffect(() => {
    chrome.storage.local.get([SUBSCRIPTION_TIER], (result) => {
      setTier(result[SUBSCRIPTION_TIER] || 'basic');
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[SUBSCRIPTION_TIER]) {
        setTier(changes[SUBSCRIPTION_TIER].newValue || 'basic');
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (tier !== 'basic') return null;

  return (
    <button
      onClick={() => chrome.tabs.create({ url: 'https://irongate-dashboard.vercel.app/settings/billing' })}
      className="px-2.5 py-1 text-[10px] font-semibold text-white bg-iron-600 rounded-md hover:bg-iron-700 transition-colors"
    >
      Upgrade to Pro
    </button>
  );
}
