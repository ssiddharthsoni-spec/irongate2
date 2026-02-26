'use client';

import { usePathname } from 'next/navigation';

export function MainContentInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isDemo = pathname === '/demo';
  const isOnboarding = pathname.startsWith('/onboarding');
  const isPrivacy = pathname === '/privacy';
  const isTerms = pathname === '/terms';
  const isFullWidth = isLanding || isDemo || isOnboarding || isPrivacy || isTerms;

  return (
    <main className={isFullWidth ? '' : 'md:ml-64 ml-0 p-8 animate-fadeIn'}>
      {children}
    </main>
  );
}
