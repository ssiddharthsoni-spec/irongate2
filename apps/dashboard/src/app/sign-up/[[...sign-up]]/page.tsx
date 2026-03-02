'use client';

import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f7] dark:bg-[#141414] px-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-iron-600 rounded-xl flex items-center justify-center">
          <span className="text-white font-bold text-sm">IG</span>
        </div>
        <span className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Iron Gate</span>
      </div>

      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6 text-center">
        Create your account to get started with a 15-day Pro trial.
      </p>

      <SignUp
        forceRedirectUrl="/onboarding"
        appearance={{
          elements: {
            rootBox: 'w-full max-w-md',
            card: 'bg-white dark:bg-[#1c1c1e] shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-2xl',
            headerTitle: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
            headerSubtitle: 'text-[#6e6e73] dark:text-[#86868b]',
            socialButtonsBlockButton: 'border border-[#d2d2d7] dark:border-[#38383a] rounded-xl min-h-[44px] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors',
            socialButtonsBlockButtonText: 'text-sm font-medium',
            dividerLine: 'bg-[#d2d2d7] dark:bg-[#38383a]',
            dividerText: 'text-[#86868b] dark:text-[#636366]',
            formFieldLabel: 'text-sm font-medium text-[#424245] dark:text-[#a1a1a6]',
            formFieldInput: 'border border-[#d2d2d7] dark:border-[#38383a] rounded-xl text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-iron-500',
            formButtonPrimary: 'bg-iron-600 hover:bg-iron-700 rounded-xl text-sm font-semibold min-h-[44px]',
            footerActionLink: 'text-iron-600 hover:text-iron-700 dark:text-iron-400 font-medium',
            footerActionText: 'text-[#6e6e73] dark:text-[#86868b]',
          },
        }}
      />
    </div>
  );
}
