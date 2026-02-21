import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import Sidebar from '@/components/Sidebar';
import { MainContentInner } from '@/components/MainContentInner';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

// All pages require auth — skip static generation at build time
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Iron Gate — AI Governance Dashboard',
  description: 'Monitor and protect AI tool usage across your organization',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <ThemeProvider>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
              <Sidebar />
              <MainContentInner>{children}</MainContentInner>
            </div>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
