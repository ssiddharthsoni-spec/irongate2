'use client';

import { usePathname } from 'next/navigation';

export function MainContentInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOnboarding = pathname.startsWith('/onboarding');

  return (
    <main className={isOnboarding ? '' : 'md:ml-64 ml-0 p-8'}>
      {children}
    </main>
  );
}
