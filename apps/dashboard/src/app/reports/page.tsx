'use client';

import Link from 'next/link';

const REPORTS = [
  {
    title: 'Exposure Report',
    description: 'Detailed breakdown of sensitive data detected across AI tools',
    href: '/reports/exposure',
    available: true,
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
  {
    title: 'Activity Summary',
    description: 'Weekly summary of AI tool usage and protection events',
    href: '/reports/activity',
    available: false,
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    title: 'Compliance Audit',
    description: 'Audit trail for regulatory compliance (HIPAA, SOC 2, PCI-DSS)',
    href: '/reports/compliance',
    available: true,
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
];

export default function ReportsIndexPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Reports</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
          Generate and export compliance reports for your organization.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((report) => (
          <div
            key={report.title}
            className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 flex flex-col"
          >
            <div className="w-10 h-10 rounded-lg bg-iron-100 dark:bg-iron-900/30 flex items-center justify-center text-iron-600 dark:text-iron-400 mb-4">
              {report.icon}
            </div>

            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              {report.title}
            </h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-6 flex-1">
              {report.description}
            </p>

            {report.available ? (
              <Link
                href={report.href}
                className="inline-flex items-center justify-center w-full min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium bg-iron-600 text-white hover:bg-iron-700 transition-colors"
              >
                View Report
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-full min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#86868b] dark:text-[#636366] cursor-default">
                Coming Soon
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
