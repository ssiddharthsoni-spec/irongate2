import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import Sidebar from '@/components/Sidebar';
import { MainContentInner } from '@/components/MainContentInner';
import './globals.css';

// All pages require auth — skip static generation at build time
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Iron Gate — AI Governance Dashboard',
  description: 'Monitor and protect AI tool usage across your organization',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-gray-50">
          <Sidebar />
          <MainContentInner>{children}</MainContentInner>
        </div>
      </body>
    </html>
  );

  // Skip ClerkProvider if publishable key isn't set (e.g. during CI builds)
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return content;
  }

  return <ClerkProvider>{content}</ClerkProvider>;
}
