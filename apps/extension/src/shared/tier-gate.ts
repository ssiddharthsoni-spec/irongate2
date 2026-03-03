/**
 * Feature gating based on subscription tier.
 * Reads cached tier from chrome.storage.local with a 6-hour TTL.
 * Falls back to checking trial_start_date for active trials.
 */

import {
  SUBSCRIPTION_TIER,
  SUBSCRIPTION_CACHED_AT,
  TRIAL_START_DATE,
  TRIAL_ENDS_AT,
  type SubscriptionTier,
} from './storage-keys';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Get the current subscription tier. Returns 'basic' if unknown or expired.
 */
export async function checkTier(): Promise<SubscriptionTier> {
  const data = await chrome.storage.local.get([
    SUBSCRIPTION_TIER,
    SUBSCRIPTION_CACHED_AT,
    TRIAL_START_DATE,
    TRIAL_ENDS_AT,
  ]);

  const tier = data[SUBSCRIPTION_TIER] as SubscriptionTier | undefined;
  const cachedAt = data[SUBSCRIPTION_CACHED_AT] as number | undefined;

  // If we have a cached tier and it's still fresh, use it
  if (tier && cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
    // But check if trial has expired
    if (tier === 'pro' && data[TRIAL_ENDS_AT]) {
      const trialEnd = new Date(data[TRIAL_ENDS_AT]).getTime();
      if (Date.now() > trialEnd) {
        // Trial expired — downgrade to basic
        await chrome.storage.local.set({
          [SUBSCRIPTION_TIER]: 'basic',
          [SUBSCRIPTION_CACHED_AT]: Date.now(),
        });
        return 'basic';
      }
    }
    return tier;
  }

  // No cache or stale — check trial dates locally
  if (data[TRIAL_ENDS_AT]) {
    const trialEnd = new Date(data[TRIAL_ENDS_AT]).getTime();
    if (Date.now() < trialEnd) {
      await chrome.storage.local.set({
        [SUBSCRIPTION_TIER]: 'pro',
        [SUBSCRIPTION_CACHED_AT]: Date.now(),
      });
      return 'pro';
    }
  }

  // Default to basic
  if (!tier) {
    await chrome.storage.local.set({
      [SUBSCRIPTION_TIER]: 'basic',
      [SUBSCRIPTION_CACHED_AT]: Date.now(),
    });
  }

  return tier || 'basic';
}

/**
 * Check if the 15-day trial is currently active.
 */
export async function isTrialActive(): Promise<boolean> {
  const data = await chrome.storage.local.get([TRIAL_START_DATE, TRIAL_ENDS_AT]);

  if (!data[TRIAL_ENDS_AT]) return false;

  const trialEnd = new Date(data[TRIAL_ENDS_AT]).getTime();
  return Date.now() < trialEnd;
}

/**
 * Check if user has Pro-level access (pro, team, enterprise, or active trial).
 */
export async function isPro(): Promise<boolean> {
  const tier = await checkTier();
  return tier === 'pro' || tier === 'team' || tier === 'enterprise';
}

/**
 * Get days remaining in trial, or -1 if not in trial.
 */
export async function getTrialDaysRemaining(): Promise<number> {
  const data = await chrome.storage.local.get([TRIAL_ENDS_AT]);

  if (!data[TRIAL_ENDS_AT]) return -1;

  const trialEnd = new Date(data[TRIAL_ENDS_AT]).getTime();
  const msRemaining = trialEnd - Date.now();

  if (msRemaining <= 0) return 0;

  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

/**
 * Get the current trial day number (1-15), or -1 if not in trial.
 */
export async function getTrialDayNumber(): Promise<number> {
  const data = await chrome.storage.local.get([TRIAL_START_DATE]);

  if (!data[TRIAL_START_DATE]) return -1;

  const start = new Date(data[TRIAL_START_DATE]).getTime();
  const elapsed = Date.now() - start;

  if (elapsed < 0) return 1;

  return Math.min(15, Math.floor(elapsed / (24 * 60 * 60 * 1000)) + 1);
}

/**
 * Force refresh tier from the API and update cache.
 * Call this after subscription changes or periodically.
 */
export async function refreshTier(apiBaseUrl: string, apiKey: string): Promise<SubscriptionTier> {
  try {
    const res = await fetch(`${apiBaseUrl}/billing`, {
      headers: { 'X-API-Key': apiKey },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const tier = mapBackendTier(data.subscription?.tier || 'free');

    await chrome.storage.local.set({
      [SUBSCRIPTION_TIER]: tier,
      [SUBSCRIPTION_CACHED_AT]: Date.now(),
    });

    return tier;
  } catch {
    // On failure, return cached or basic
    return checkTier();
  }
}

/**
 * Map backend tier names to display tier names.
 * Backend uses 'free'/'business', we display 'basic'/'team'.
 */
function mapBackendTier(backendTier: string): SubscriptionTier {
  switch (backendTier) {
    case 'free': return 'basic';
    case 'pro': return 'pro';
    case 'business': return 'team';
    case 'enterprise': return 'enterprise';
    default: return 'basic';
  }
}
