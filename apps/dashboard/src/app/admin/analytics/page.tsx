'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useApiClient } from '../../../lib/api';

const SignupTrendChart = dynamic(() => import('./SignupTrendChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[200px] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse" />
  ),
});

/* ── Types ──────────────────────────────────────────────────────────────── */

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  lastActive: string | null;
  interactions: number;
  status: 'online' | 'offline';
  createdAt: string;
}

interface AnalyticsData {
  summary: {
    totalUsers: number;
    activeNow: number;
    activeToday: number;
    totalInteractions: number;
  };
  users: UserRow[];
  signupTrend: { date: string; count: number }[];
}

/* ── Demo fallback ──────────────────────────────────────────────────────── */

const DEMO_DATA: AnalyticsData = {
  summary: { totalUsers: 24, activeNow: 7, activeToday: 16, totalInteractions: 2847 },
  users: [
    { id: '1', name: 'Sarah Chen', email: 'sarah.chen@firm.com', role: 'admin', lastActive: new Date(Date.now() - 2 * 60_000).toISOString(), interactions: 347, status: 'online', createdAt: '2026-01-15T00:00:00Z' },
    { id: '2', name: 'James Rodriguez', email: 'j.rodriguez@firm.com', role: 'user', lastActive: new Date(Date.now() - 3 * 60_000).toISOString(), interactions: 298, status: 'online', createdAt: '2026-01-20T00:00:00Z' },
    { id: '3', name: 'Priya Sharma', email: 'p.sharma@firm.com', role: 'user', lastActive: new Date(Date.now() - 45 * 60_000).toISOString(), interactions: 215, status: 'offline', createdAt: '2026-01-22T00:00:00Z' },
    { id: '4', name: "Michael O'Brien", email: 'm.obrien@firm.com', role: 'admin', lastActive: new Date(Date.now() - 1 * 60_000).toISOString(), interactions: 189, status: 'online', createdAt: '2026-02-01T00:00:00Z' },
    { id: '5', name: 'Emily Watson', email: 'e.watson@firm.com', role: 'user', lastActive: new Date(Date.now() - 2 * 3600_000).toISOString(), interactions: 156, status: 'offline', createdAt: '2026-02-03T00:00:00Z' },
    { id: '6', name: 'David Kim', email: 'd.kim@firm.com', role: 'viewer', lastActive: new Date(Date.now() - 24 * 3600_000).toISOString(), interactions: 42, status: 'offline', createdAt: '2026-02-10T00:00:00Z' },
    { id: '7', name: 'Lisa Park', email: 'l.park@firm.com', role: 'user', lastActive: new Date(Date.now() - 4 * 60_000).toISOString(), interactions: 201, status: 'online', createdAt: '2026-02-12T00:00:00Z' },
  ],
  signupTrend: [
    { date: '2026-01-15', count: 2 }, { date: '2026-01-20', count: 1 }, { date: '2026-01-22', count: 1 },
    { date: '2026-02-01', count: 3 }, { date: '2026-02-03', count: 2 }, { date: '2026-02-10', count: 4 },
    { date: '2026-02-12', count: 3 }, { date: '2026-02-15', count: 1 }, { date: '2026-02-20', count: 5 },
    { date: '2026-02-25', count: 2 },
  ],
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }: { status: 'online' | 'offline' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
      status === 'online'
        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'online' ? 'bg-green-500' : 'bg-[#86868b]'
      }`} />
      {status === 'online' ? 'Online' : 'Offline'}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    admin: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
    user: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
    viewer: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${styles[role] || styles.viewer}`}>
      {role}
    </span>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AdminAnalyticsPage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch('/admin/analytics');
        if (!res.ok) throw new Error('API error');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) {
          setError('Could not load analytics — showing demo data');
          setData(DEMO_DATA);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [apiFetch]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="h-8 w-48 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl animate-pulse" />
      </div>
    );
  }

  const { summary, users, signupTrend } = data!;

  const statCards = [
    { label: 'Total Users', value: summary.totalUsers.toLocaleString(), color: 'text-[#1d1d1f] dark:text-[#f5f5f7]' },
    { label: 'Active Now', value: summary.activeNow.toLocaleString(), color: 'text-green-600 dark:text-green-400' },
    { label: 'Active Today', value: summary.activeToday.toLocaleString(), color: 'text-blue-600 dark:text-blue-400' },
    { label: 'Total Interactions', value: summary.totalInteractions.toLocaleString(), color: 'text-[#1d1d1f] dark:text-[#f5f5f7]' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[#86868b] mb-6">
        <Link href="/admin" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Admin</Link>
        <span>/</span>
        <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Analytics</span>
      </nav>

      <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">User Analytics</h1>
      <p className="text-[#6e6e73] dark:text-[#86868b] text-sm mb-8">
        Monitor user activity, logins, and engagement across your organization.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40 text-sm text-yellow-700 dark:text-yellow-400">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60"
          >
            <p className="text-[12px] font-medium text-[#86868b] uppercase tracking-wider mb-2">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-8">
        <div className="px-6 py-4 border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">All Users</h2>
          <p className="text-[12px] text-[#86868b] mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''} in your organization</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] font-medium text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Last Active</th>
                <th className="px-6 py-3 text-right">Interactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                  <td className="px-6 py-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{u.name}</td>
                  <td className="px-6 py-3 text-[#6e6e73] dark:text-[#86868b]">{u.email}</td>
                  <td className="px-6 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-6 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-6 py-3 text-[#6e6e73] dark:text-[#86868b]">{relativeTime(u.lastActive)}</td>
                  <td className="px-6 py-3 text-right text-[#1d1d1f] dark:text-[#f5f5f7] font-medium tabular-nums">{u.interactions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Signup trend */}
      {signupTrend.length > 0 && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">New Signups</h2>
          <p className="text-[12px] text-[#86868b] mb-4">Daily new user registrations over the last 30 days</p>
          <SignupTrendChart data={signupTrend} />
        </div>
      )}
    </div>
  );
}
