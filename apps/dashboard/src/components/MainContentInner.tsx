'use client';

import { usePathname } from 'next/navigation';

export function MainContentInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOnboarding = pathname.startsWith('/onboarding');

  return (
    <main className={isOnboarding ? '' : 'ml-64 p-8'}>
      {children}
    </main>
  );
}
