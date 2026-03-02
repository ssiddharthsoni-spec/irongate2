import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import Sidebar from '@/components/Sidebar';
import { MainContentInner } from '@/components/MainContentInner';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PostHogProvider } from '@/components/PostHogProvider';
import './globals.css';

// All pages require auth — skip static generation at build time
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Iron Gate — Use AI Safely',
  description: 'Let your team use AI productively — Iron Gate protects sensitive data in every prompt, invisibly.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <ThemeProvider>
            <PostHogProvider>
              <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#111113] transition-colors">
                <Sidebar />
                <MainContentInner>{children}</MainContentInner>
              </div>
            </PostHogProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
