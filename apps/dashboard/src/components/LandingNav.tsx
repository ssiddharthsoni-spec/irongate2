'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';

function ShieldCheckIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

export default function LandingNav() {
  const { isSignedIn, user, isLoaded } = useUser();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-[#d2d2d7]/30 dark:border-[#38383a]/40">
      <div className="flex items-center justify-between px-6 md:px-12 py-3 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
            <ShieldCheckIcon className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight">Iron Gate</span>
        </Link>
        <div className="flex items-center gap-6">
          <a href="#features" className="hidden md:block text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Features</a>
          <a href="#how-it-works" className="hidden md:block text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">How It Works</a>
          <a href="#security" className="hidden md:block text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Security</a>
          <a href="#pricing" className="hidden md:block text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Pricing</a>

          {isLoaded && isSignedIn ? (
            <>
              <Link
                href="/dashboard"
                className="px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Go to Dashboard
              </Link>
              <div className="w-8 h-8 rounded-full bg-iron-100 dark:bg-iron-900/40 flex items-center justify-center overflow-hidden">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-iron-600 dark:text-iron-400">
                    {(user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0] || 'U').toUpperCase()}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
                Admin Sign In
              </Link>
              <Link href="/sign-up" className="px-4 py-2 bg-[#1d1d1f] dark:bg-[#f5f5f7] hover:bg-[#424245] dark:hover:bg-[#d2d2d7] text-white dark:text-[#1d1d1f] text-sm font-semibold rounded-lg transition-colors">
                Set Up Org
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
