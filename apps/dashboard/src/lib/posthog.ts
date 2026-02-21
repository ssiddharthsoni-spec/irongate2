// PostHog Analytics Provider for Iron Gate Dashboard
// Initializes PostHog client-side analytics if NEXT_PUBLIC_POSTHOG_KEY is set.

import posthog from 'posthog-js';

let initialized = false;

export function initPostHog() {
  if (initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === 'undefined') return;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // We'll track specific events
    persistence: 'localStorage',
    loaded: () => {
      if (process.env.NODE_ENV === 'development') {
        posthog.debug();
      }
    },
  });

  initialized = true;
}

export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.identify(userId, properties);
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

// Pre-defined event helpers
export const analytics = {
  pageView: (page: string) => trackEvent('$pageview', { page }),
  onboardingStarted: () => trackEvent('onboarding_started'),
  onboardingCompleted: (firmName: string) => trackEvent('onboarding_completed', { firmName }),
  extensionInstalled: () => trackEvent('extension_installed'),
  promptScanned: (tool: string, score: number) => trackEvent('prompt_scanned', { tool, score }),
  settingsUpdated: (section: string) => trackEvent('settings_updated', { section }),
  reportGenerated: (type: string) => trackEvent('report_generated', { type }),
  inviteSent: () => trackEvent('invite_sent'),
  planUpgraded: (plan: string) => trackEvent('plan_upgraded', { plan }),
  killSwitchActivated: () => trackEvent('kill_switch_activated'),
  documentScanned: (type: string) => trackEvent('document_scanned', { type }),
};
