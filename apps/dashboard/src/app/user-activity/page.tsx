'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../lib/api';

interface EntityCount {
  type: string;
  count: number;
}

interface UserActivity {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  totalEvents: number;
  avgScore: number;
  highRiskCount: number;
  lastActivity: string;
  actionBreakdown: { blocked: number; warned: number; proxied: number };
  entityBreakdown: EntityCount[];
}

interface UserActivityData {
  users: UserActivity[];
}

function getDemoData(): UserActivityData {
  return {
    users: [
      {
        userId: '1',
        displayName: 'Siddharth Soni',
        email: 'siddharth.soni@irongate.dev',
        role: 'admin',
        totalEvents: 347,
        avgScore: 48.3,
        highRiskCount: 31,
        lastActivity: '2026-02-28T14:32:00.000Z',
        actionBreakdown: { blocked: 8, warned: 15, proxied: 8 },
        entityBreakdown: [
          { type: 'PERSON', count: 89 },
          { type: 'EMAIL', count: 67 },
          { type: 'PRIVILEGE_MARKER', count: 34 },
          { type: 'SSN', count: 18 },
          { type: 'MATTER_NUMBER', count: 14 },
          { type: 'ORGANIZATION', count: 12 },
          { type: 'MONETARY_AMOUNT', count: 9 },
        ],
      },
      {
        userId: '2',
        displayName: 'Emily Dawson',
        email: 'emily.dawson@irongate.dev',
        role: 'user',
        totalEvents: 298,
        avgScore: 35.2,
        highRiskCount: 14,
        lastActivity: '2026-02-28T13:15:00.000Z',
        actionBreakdown: { blocked: 3, warned: 8, proxied: 3 },
        entityBreakdown: [
          { type: 'PERSON', count: 72 },
          { type: 'ORGANIZATION', count: 51 },
          { type: 'EMAIL', count: 43 },
          { type: 'MATTER_NUMBER', count: 22 },
        ],
      },
      {
        userId: '3',
        displayName: 'Marcus Rivera',
        email: 'marcus.rivera@irongate.dev',
        role: 'user',
        totalEvents: 276,
        avgScore: 52.7,
        highRiskCount: 42,
        lastActivity: '2026-02-27T11:48:00.000Z',
        actionBreakdown: { blocked: 12, warned: 21, proxied: 9 },
        entityBreakdown: [
          { type: 'PERSON', count: 95 },
          { type: 'SSN', count: 28 },
          { type: 'CREDIT_CARD', count: 19 },
          { type: 'EMAIL', count: 37 },
          { type: 'ORGANIZATION', count: 24 },
          { type: 'PRIVILEGE_MARKER', count: 11 },
        ],
      },
      {
        userId: '4',
        displayName: 'Jennifer Hartwell',
        email: 'jennifer.hartwell@irongate.dev',
        role: 'user',
        totalEvents: 251,
        avgScore: 29.1,
        highRiskCount: 8,
        lastActivity: '2026-02-27T10:22:00.000Z',
        actionBreakdown: { blocked: 2, warned: 4, proxied: 2 },
        entityBreakdown: [
          { type: 'PERSON', count: 61 },
          { type: 'ORGANIZATION', count: 48 },
          { type: 'EMAIL', count: 29 },
        ],
      },
      {
        userId: '5',
        displayName: 'David Okonkwo',
        email: 'david.okonkwo@irongate.dev',
        role: 'user',
        totalEvents: 189,
        avgScore: 44.6,
        highRiskCount: 22,
        lastActivity: '2026-02-26T08:18:00.000Z',
        actionBreakdown: { blocked: 5, warned: 12, proxied: 5 },
        entityBreakdown: [
          { type: 'PERSON', count: 54 },
          { type: 'MONETARY_AMOUNT', count: 31 },
          { type: 'DEAL_CODENAME', count: 18 },
          { type: 'EMAIL', count: 24 },
          { type: 'ORGANIZATION', count: 17 },
        ],
      },
    ],
  };
}

function getScoreColor(score: number): string {
  if (score > 85) return 'text-risk-critical bg-red-50 dark:bg-red-900/20';
  if (score > 60) return 'text-risk-high bg-orange-50 dark:bg-orange-900/20';
  if (score > 25) return 'text-risk-medium bg-yellow-50 dark:bg-yellow-900/20';
  return 'text-risk-low bg-green-50 dark:bg-green-900/20';
}

function getEntityTypeBadgeClass(type: string): string {
  const typeMap: Record<string, string> = {
    person: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    organization: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    email: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
    phone: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
    ssn: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    credit_card: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    address: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    matter_number: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    privilege_marker: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    monetary_amount: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    deal_codename: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  };
  return typeMap[type?.toLowerCase()] || 'bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]';
}

function formatEntityType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Ssn/g, 'SSN')
    .replace(/Ip /g, 'IP ');
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function UserActivityPage() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<UserActivityData>(getDemoData());
  const [isLive, setIsLive] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(30);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  async function fetchData() {
    try {
      setFetchError(null);
      const response = await apiFetch(`/dashboard/user-activity?days=${timeRange}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
      setIsLive(true);
    } catch {
      setIsLive(false);
      setFetchError('Unable to connect to API. Showing demo data.');
    }
  }

  const totalUsers = data.users.length;
  const totalEvents = data.users.reduce((sum, u) => sum + u.totalEvents, 0);
  const avgScore = totalUsers > 0
    ? Math.round((data.users.reduce((sum, u) => sum + u.avgScore, 0) / totalUsers) * 10) / 10
    : 0;
  const totalHighRisk = data.users.reduce((sum, u) => sum + u.highRiskCount, 0);

  return (
    <div>
      {/* Demo data banner */}
      {!isLive && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3">
          <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
            {fetchError || 'Demo Mode — Showing sample data. Unable to connect to API. Showing demo data.'}
          </p>
          <button
            onClick={fetchData}
            className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">User Activity</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            See what sensitive data your team is sharing with AI tools
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setTimeRange(days)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                timeRange === days
                  ? 'bg-iron-600 text-white'
                  : 'bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e]'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard title="Active Users" value={totalUsers.toString()} />
        <SummaryCard title="Total Events" value={totalEvents.toLocaleString()} />
        <SummaryCard
          title="Avg Sensitivity"
          value={avgScore.toString()}
          color={avgScore > 60 ? 'text-risk-high' : avgScore > 25 ? 'text-risk-medium' : 'text-risk-low'}
        />
        <SummaryCard
          title="High Risk Events"
          value={totalHighRisk.toLocaleString()}
          color={totalHighRisk > 0 ? 'text-risk-high' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}
        />
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f5f5f7] dark:bg-[#1c1c1e]/80 text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Events</th>
              <th className="px-4 py-3">Avg Score</th>
              <th className="px-4 py-3">High Risk</th>
              <th className="px-4 py-3 hidden md:table-cell">Top Entities</th>
              <th className="px-4 py-3 hidden lg:table-cell">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
            {data.users.map((user) => (
              <React.Fragment key={user.userId}>
                <tr
                  onClick={() => setExpandedUserId(expandedUserId === user.userId ? null : user.userId)}
                  className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 cursor-pointer transition-colors"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedUserId(expandedUserId === user.userId ? null : user.userId);
                    }
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-iron-100 dark:bg-iron-900/40 text-iron-700 dark:text-iron-300 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {(user.displayName || user.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                          {user.displayName || user.email}
                        </p>
                        <p className="text-xs text-[#6e6e73] dark:text-[#86868b] truncate">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {user.totalEvents.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold ${getScoreColor(user.avgScore)}`}>
                      {user.avgScore}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-risk-high">
                    {user.highRiskCount}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {user.entityBreakdown.slice(0, 4).map((e) => (
                        <span
                          key={e.type}
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${getEntityTypeBadgeClass(e.type)}`}
                        >
                          {formatEntityType(e.type)} {e.count}
                        </span>
                      ))}
                      {user.entityBreakdown.length > 4 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-[#6e6e73] dark:text-[#86868b] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                          +{user.entityBreakdown.length - 4} more
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-[#6e6e73] dark:text-[#86868b]" suppressHydrationWarning>
                    {relativeTime(user.lastActivity)}
                  </td>
                </tr>

                {/* Expanded detail row */}
                {expandedUserId === user.userId && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 bg-[#fafafa] dark:bg-[#141414]">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Entity breakdown bars */}
                        <div className="lg:col-span-2">
                          <h4 className="text-xs font-semibold text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider mb-3">
                            Entity Types Shared
                          </h4>
                          <div className="space-y-2">
                            {user.entityBreakdown.map((item) => {
                              const maxCount = user.entityBreakdown[0]?.count || 1;
                              const pct = Math.round((item.count / maxCount) * 100);
                              return (
                                <div key={item.type} className="flex items-center gap-3">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded w-28 text-center truncate ${getEntityTypeBadgeClass(item.type)}`}>
                                    {formatEntityType(item.type)}
                                  </span>
                                  <div className="flex-1 h-4 bg-[#e8e8ed] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-iron-500 rounded-full transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-semibold text-[#424245] dark:text-[#a1a1a6] w-10 text-right">
                                    {item.count}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Action breakdown */}
                        <div>
                          <h4 className="text-xs font-semibold text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider mb-3">
                            Actions Taken
                          </h4>
                          <div className="space-y-3">
                            <ActionStat label="Blocked" count={user.actionBreakdown.blocked} total={user.totalEvents} color="bg-red-500" />
                            <ActionStat label="Warned" count={user.actionBreakdown.warned} total={user.totalEvents} color="bg-orange-400" />
                            <ActionStat label="Redacted" count={user.actionBreakdown.proxied} total={user.totalEvents} color="bg-yellow-400" />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}

            {data.users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <svg className="w-12 h-12 mx-auto text-[#d2d2d7] dark:text-[#38383a] mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                  </svg>
                  <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">No user activity found for this period.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, color = 'text-[#1d1d1f] dark:text-[#f5f5f7]' }: { title: string; value: string; color?: string }) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-5 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
      <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function ActionStat({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[#424245] dark:text-[#a1a1a6]">{label}</span>
        <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{count}</span>
      </div>
      <div className="h-2 bg-[#e8e8ed] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-[#86868b] dark:text-[#636366] mt-0.5">{pct}% of events</p>
    </div>
  );
}
