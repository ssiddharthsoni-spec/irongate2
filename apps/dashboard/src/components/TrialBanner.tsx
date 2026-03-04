'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApiClient } from '../lib/api';

export default function TrialBanner() {
  const { apiFetch } = useApiClient();
  const pathname = usePathname();
  const [status, setStatus] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('free');
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Don't show on public/billing pages
  const isPublic = ['/', '/sign-in', '/sign-up', '/onboarding', '/demo', '/privacy', '/terms', '/install', '/uninstall-survey'].includes(pathname);
  const isBillingPage = pathname === '/settings/billing';

  useEffect(() => {
    if (isPublic) return;

    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 3000;

    async function check() {
      try {
        const res = await apiFetch('/billing');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.subscription) {
          setStatus(data.subscription.status);
          setTier(data.subscription.tier || 'free');
          setPeriodEnd(data.subscription.currentPeriodEnd || null);
        }
      } catch {
        // Retry on network failure so the banner shows after transient errors
        if (!cancelled && retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(check, RETRY_DELAY);
        }
      }
    }
    check();
    return () => { cancelled = true; };
  }, [apiFetch, isPublic]);

  if (isPublic || isBillingPage || dismissed) return null;
  if (status !== 'trialing' && status !== 'canceled') return null;

  const daysLeft = periodEnd
    ? Math.max(0, Math.ceil((new Date(periodEnd).getTime() - Date.now()) / 86400_000))
    : 0;

  const isExpired = status === 'canceled' || (status === 'trialing' && daysLeft === 0);

  return (
    <div className={`mx-4 mt-4 px-4 py-3 rounded-xl flex items-center justify-between ${
      isExpired
        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40'
        : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isExpired
            ? 'bg-red-100 dark:bg-red-900/30'
            : 'bg-yellow-100 dark:bg-yellow-900/30'
        }`}>
          <svg className={`w-3.5 h-3.5 ${isExpired ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <p className={`text-sm font-medium truncate ${
          isExpired
            ? 'text-red-800 dark:text-red-300'
            : 'text-yellow-800 dark:text-yellow-300'
        }`}>
          {isExpired
            ? `Your ${tier === 'free' ? '' : (tier === 'business' ? 'Team' : tier.charAt(0).toUpperCase() + tier.slice(1)) + ' '}trial has ended. Upgrade to continue.`
            : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your ${tier === 'business' ? 'Team' : tier.charAt(0).toUpperCase() + tier.slice(1)} free trial`}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href="/settings/billing"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors ${
            isExpired
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-yellow-600 hover:bg-yellow-700'
          }`}
        >
          {isExpired ? 'Upgrade Now' : 'View Plans'}
        </Link>
        {!isExpired && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 rounded text-yellow-600/50 dark:text-yellow-400/50 hover:text-yellow-800 dark:hover:text-yellow-300 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
