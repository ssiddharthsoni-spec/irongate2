'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  {
    href: '/dashboard',
    label: 'Home',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    href: '/dashboard/entity-dictionary',
    label: 'Entity Dictionary',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: '/dashboard/users',
    label: 'Users',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/audit-log',
    label: 'Audit Log',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
      </svg>
    ),
  },
  {
    href: '/events',
    label: 'Events',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
    ),
  },
  {
    href: '/reports/exposure',
    label: 'Reports',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    href: '/user-activity',
    label: 'Team',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
  },
  {
    href: '/admin',
    label: 'Admin',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isLoaded: isUserLoaded } = useUser();
  const { signOut } = useClerk();

  // Hide sidebar on public pages (landing, demo, onboarding, install, legal, auth)
  const isLanding = pathname === '/';
  const isDemo = pathname === '/demo';
  const isOnboarding = pathname.startsWith('/onboarding');
  const isLegal = pathname === '/privacy' || pathname === '/terms';
  const isInstall = pathname === '/install';
  const isAuth = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
  const isUninstallSurvey = pathname === '/uninstall-survey';
  if (isLanding || isDemo || isOnboarding || isLegal || isInstall || isAuth || isUninstallSurvey) return null;

  const displayName = isUserLoaded && user
    ? user.fullName || user.firstName || user.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'User'
    : 'Loading...';
  const displayEmail = isUserLoaded && user
    ? user.primaryEmailAddress?.emailAddress || ''
    : '';

  return (
    <>
      {/* Hamburger button — visible only on mobile */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-white dark:bg-[#1c1c1e] shadow-sm border border-[#d2d2d7]/60 dark:border-[#38383a]"
        aria-label="Open menu"
      >
        <svg className="w-5 h-5 text-[#1d1d1f] dark:text-[#f5f5f7]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
      </button>

      {/* Dark overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <nav
        className={`fixed left-0 top-0 bottom-0 w-[240px] bg-white dark:bg-[#1c1c1e] border-r border-[#d2d2d7]/40 dark:border-[#38383a]/60 px-3 py-4 flex flex-col z-50 transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 mb-8">
          <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">IG</span>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-tight">Iron Gate</p>
            <p className="text-[11px] text-[#86868b]">AI Governance</p>
          </div>
        </div>

        {/* Navigation */}
        <ul className="space-y-0.5 flex-1">
          {navItems.map((item) => {
            let isActive: boolean;
            if (item.href === '/dashboard') {
              isActive = pathname === '/dashboard';
            } else if (item.href.startsWith('/dashboard/')) {
              isActive = pathname === item.href;
            } else if (item.href === '/settings') {
              isActive = pathname.startsWith('/settings') || pathname.startsWith('/legal');
            } else if (item.href === '/admin') {
              isActive = pathname.startsWith('/admin');
            } else {
              isActive = pathname.startsWith(item.href);
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-iron-600 dark:text-iron-300'
                      : 'text-[#6e6e73] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  <span className={isActive ? 'text-iron-600 dark:text-iron-400' : 'text-[#aeaeb2] dark:text-[#636366]'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Bottom section */}
        <div className="space-y-2">
          {/* User profile */}
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] cursor-pointer transition-colors">
            <div className="w-7 h-7 rounded-full bg-iron-100 dark:bg-iron-900/40 flex items-center justify-center overflow-hidden flex-shrink-0">
              {isUserLoaded && user?.imageUrl ? (
                <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-3.5 h-3.5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{displayName}</p>
              <p className="text-[11px] text-[#86868b] truncate">{displayEmail}</p>
            </div>
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: '/sign-in' })}
              className="p-1.5 rounded-md text-[#aeaeb2] hover:text-red-500 dark:text-[#636366] dark:hover:text-red-400 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
              </svg>
            </button>
          </div>

          {/* Admin sub-pages */}
          {pathname.startsWith('/admin') && (
            <div className="px-3 py-2 space-y-0.5">
              <p className="text-[10px] font-semibold text-[#aeaeb2] dark:text-[#636366] uppercase tracking-wider mb-1">Admin</p>
              {[
                { href: '/admin', label: 'Settings' },
                { href: '/admin/users', label: 'Users' },
                { href: '/admin/departments', label: 'Departments' },
                { href: '/admin/webhooks', label: 'Webhooks' },
                { href: '/admin/incidents', label: 'Incidents' },
                { href: '/admin/feature-flags', label: 'Feature Flags' },
                { href: '/admin/data-deletion', label: 'Data Deletion' },
                { href: '/admin/kill-switch', label: 'Kill Switch' },
                { href: '/admin/deployment', label: 'Deployment Health' },
                { href: '/admin/analytics', label: 'Analytics' },
                { href: '/admin/roi', label: 'ROI' },
                { href: '/admin/integrations', label: 'Integrations' },
                { href: '/admin/sso', label: 'SSO' },
              ].map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={`block text-[12px] px-2 py-1 rounded-md ${
                    pathname === sub.href
                      ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-iron-600 dark:text-iron-300 font-medium'
                      : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                  }`}
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}

          {/* Settings sub-pages */}
          {(pathname.startsWith('/settings') || pathname.startsWith('/legal')) && (
            <div className="px-3 py-2 space-y-0.5">
              <p className="text-[10px] font-semibold text-[#aeaeb2] dark:text-[#636366] uppercase tracking-wider mb-1">Settings</p>
              {[
                { href: '/settings', label: 'General' },
                { href: '/settings/team', label: 'Team' },
                { href: '/settings/api-keys', label: 'API Keys' },
                { href: '/settings/billing', label: 'Billing' },
                { href: '/settings/protection', label: 'Protection' },
                { href: '/settings/notifications', label: 'Notifications' },
                { href: '/legal/tos', label: 'Terms of Service' },
                { href: '/legal/dpa', label: 'DPA' },
                { href: '/legal/baa', label: 'BAA' },
                { href: '/legal/gdpr', label: 'GDPR Deletion' },
              ].map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={`block text-[12px] px-2 py-1 rounded-md ${
                    pathname === sub.href
                      ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-iron-600 dark:text-iron-300 font-medium'
                      : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                  }`}
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}

          {/* Theme toggle + Version */}
          <div className="flex items-center justify-between px-3 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg">
            <div>
              <p className="text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">Iron Gate</p>
              <p className="text-[10px] text-[#aeaeb2] dark:text-[#636366]">v{process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'}</p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </nav>
    </>
  );
}
