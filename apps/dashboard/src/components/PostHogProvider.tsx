'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { initPostHog, identifyUser, trackEvent } from '@/lib/posthog';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();

  // Initialize PostHog on mount
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify user when auth loads
  useEffect(() => {
    if (isLoaded && user) {
      // Only send non-PII properties to PostHog — no email or name
      identifyUser(user.id, {
        org: user.organizationMemberships?.[0]?.organization?.slug,
      });
    }
  }, [isLoaded, user]);

  // Track page views on navigation
  useEffect(() => {
    trackEvent('$pageview', { path: pathname });
  }, [pathname]);

  return <>{children}</>;
}
