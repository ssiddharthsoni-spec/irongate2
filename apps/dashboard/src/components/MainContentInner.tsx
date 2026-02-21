'use client';

import { usePathname } from 'next/navigation';

export function MainContentInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isOnboarding = pathname.startsWith('/onboarding');

  return (
    <main className={isLanding || isOnboarding ? '' : 'md:ml-64 ml-0 p-8'}>
      {children}
    </main>
  );
}
