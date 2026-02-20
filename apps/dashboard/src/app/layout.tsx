import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Iron Gate — AI Governance Dashboard',
  description: 'Monitor and protect AI tool usage across your organization',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-gray-50">
          {/* Sidebar */}
          <nav className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-iron-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">IG</span>
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Iron Gate</h1>
                <p className="text-xs text-gray-500">AI Governance</p>
              </div>
            </div>

            <ul className="space-y-1">
              <li>
                <a href="/" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <span>Overview</span>
                </a>
              </li>
              <li>
                <a href="/events" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <span>Events</span>
                </a>
              </li>
              <li>
                <a href="/reports" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <span>Reports</span>
                </a>
              </li>
              <li>
                <a href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <span>Admin</span>
                </a>
              </li>
            </ul>

            <div className="absolute bottom-4 left-4 right-4">
              <div className="px-3 py-2 bg-iron-50 rounded-lg">
                <p className="text-xs font-medium text-iron-700">Phase 1: Shadow AI Auditor</p>
                <p className="text-xs text-iron-500">v0.1.0</p>
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="ml-64 p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
