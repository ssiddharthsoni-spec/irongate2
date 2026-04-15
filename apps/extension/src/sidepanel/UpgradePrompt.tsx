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

  // Open sign-in with a redirect back to the billing page. The prior link
  // to /settings/billing directly hit a Clerk-gated 404 for signed-out
  // users, and in some browser/DNS states the redirect chain surfaced an
  // AWS S3 "AccessDenied" XML page — a confusing dead-end. /sign-in is
  // a public route that always renders; Clerk's redirect_url param sends
  // the user to billing after auth.
  return (
    <button
      onClick={() => chrome.tabs.create({
        url: 'https://irongate-dashboard.vercel.app/sign-in?redirect_url=%2Fsettings%2Fbilling',
      })}
      className="px-2.5 py-1 text-[10px] font-semibold text-white bg-iron-600 rounded-md hover:bg-iron-700 transition-colors"
    >
      Upgrade to Pro
    </button>
  );
}
