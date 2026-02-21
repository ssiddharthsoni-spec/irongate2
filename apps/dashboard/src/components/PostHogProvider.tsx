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
      identifyUser(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName,
      });
    }
  }, [isLoaded, user]);

  // Track page views on navigation
  useEffect(() => {
    trackEvent('$pageview', { path: pathname });
  }, [pathname]);

  return <>{children}</>;
}
