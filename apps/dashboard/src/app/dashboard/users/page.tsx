'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FirmUser {
  id: string;
  clerkUserId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  role?: string;
  lastActive?: string;
  lastActiveAt?: string;
  createdAt?: string;
  extensionVersion?: string;
  extensionRegistered?: boolean;
  status?: string;
  // Activity stats (may come from enriched endpoint)
  totalEvents?: number;
  promptsScanned?: number;
  entitiesDetected?: number;
  highRiskCount?: number;
  avgScore?: number;
}

type SortField = 'name' | 'role' | 'lastActive' | 'events';
type SortDir = 'asc' | 'desc';

const ROLE_BADGES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  user: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function UsersPage() {
  const { apiFetch } = useApiClient();

  const [users, setUsers] = useState<FirmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const fetchUsers = useCallback(async () => {
    try {
      setFetchError(null);
      setLoading(true);
      const res = await apiFetch('/admin/users?limit=100');
      if (!res.ok) throw new Error(`Failed to fetch users (${res.status})`);
      const data = await res.json();
      const list: FirmUser[] = Array.isArray(data) ? data : data.users ?? [];
      setUsers(list);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ─── Derived Data ──────────────────────────────────────────────────────────

  const getUserName = (u: FirmUser) => u.displayName || u.name || u.email || 'Unknown';
  const getUserEmail = (u: FirmUser) => u.email || '';
  const getUserRole = (u: FirmUser) => u.role || 'user';
  const getLastActive = (u: FirmUser) => u.lastActive || u.lastActiveAt || u.createdAt || '';
  const isRegistered = (u: FirmUser) => u.extensionRegistered ?? !!u.extensionVersion;

  const filteredUsers = users
    .filter((u) => {
      const name = getUserName(u).toLowerCase();
      const email = getUserEmail(u).toLowerCase();
      const q = searchQuery.toLowerCase();
      if (q && !name.includes(q) && !email.includes(q)) return false;
      if (roleFilter && getUserRole(u) !== roleFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = getUserName(a).localeCompare(getUserName(b));
          break;
        case 'role':
          cmp = getUserRole(a).localeCompare(getUserRole(b));
          break;
        case 'lastActive':
          cmp = (getLastActive(a) || '').localeCompare(getLastActive(b) || '');
          break;
        case 'events':
          cmp = (a.totalEvents ?? a.promptsScanned ?? 0) - (b.totalEvents ?? b.promptsScanned ?? 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const registeredCount = users.filter(isRegistered).length;
  const adminCount = users.filter((u) => getUserRole(u) === 'admin').length;
  const activeCount = users.filter((u) => {
    const la = getLastActive(u);
    if (!la) return false;
    const diff = Date.now() - new Date(la).getTime();
    return diff < 7 * 24 * 60 * 60 * 1000; // active within 7 days
  }).length;

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return (
      <svg className="w-3 h-3 inline ml-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        {sortDir === 'asc' ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        )}
      </svg>
    );
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading && users.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Users</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading team members...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 animate-pulse">
              <div className="h-4 w-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded mb-3" />
              <div className="h-8 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-[#d2d2d7]/40 dark:bg-[#38383a]" />
                <div className="h-4 w-32 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-4 w-40 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-5 w-14 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full" />
                <div className="h-4 w-20 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Error banner */}
      {fetchError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{fetchError}</span>
          <button onClick={fetchUsers} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Users</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            Manage team members and monitor extension usage
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Total Members</p>
          <p className="text-3xl font-bold mt-1 text-[#1d1d1f] dark:text-[#f5f5f7]">{users.length}</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Admins</p>
          <p className="text-3xl font-bold mt-1 text-purple-600 dark:text-purple-400">{adminCount}</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Extension Registered</p>
          <p className="text-3xl font-bold mt-1 text-green-600 dark:text-green-400">{registeredCount}</p>
          <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">{users.length > 0 ? Math.round((registeredCount / users.length) * 100) : 0}% of team</p>
        </div>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">Active (7d)</p>
          <p className="text-3xl font-bold mt-1 text-blue-600 dark:text-blue-400">{activeCount}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
                <th className="px-6 py-3 cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors" onClick={() => handleSort('name')}>
                  User <SortIcon field="name" />
                </th>
                <th className="px-6 py-3 cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors" onClick={() => handleSort('role')}>
                  Role <SortIcon field="role" />
                </th>
                <th className="px-6 py-3">Extension</th>
                <th className="px-6 py-3 cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors" onClick={() => handleSort('lastActive')}>
                  Last Active <SortIcon field="lastActive" />
                </th>
                <th className="px-6 py-3 cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors" onClick={() => handleSort('events')}>
                  Activity <SortIcon field="events" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/60">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#86868b] dark:text-[#636366]">
                    {searchQuery || roleFilter
                      ? 'No users match your filters.'
                      : 'No users found. Invite team members to get started.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-iron-100 dark:bg-iron-900/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-iron-600 dark:text-iron-400">
                            {getUserName(user).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{getUserName(user)}</p>
                          {getUserEmail(user) && (
                            <p className="text-xs text-[#86868b] dark:text-[#636366] truncate">{getUserEmail(user)}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGES[getUserRole(user)] || ROLE_BADGES.user}`}>
                        {getUserRole(user)}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          isRegistered(user)
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-[#86868b] dark:text-[#636366]'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isRegistered(user) ? 'bg-green-500' : 'bg-[#d2d2d7] dark:bg-[#38383a]'}`} />
                          {isRegistered(user) ? 'Registered' : 'Not registered'}
                        </span>
                        {user.extensionVersion && (
                          <span className="text-xs text-[#86868b] dark:text-[#636366] font-mono">v{user.extensionVersion}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-sm text-[#6e6e73] dark:text-[#86868b]" suppressHydrationWarning>
                        {formatDate(getLastActive(user))}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-4">
                        {(user.totalEvents != null || user.promptsScanned != null) ? (
                          <>
                            <div className="text-center">
                              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {(user.promptsScanned ?? user.totalEvents ?? 0).toLocaleString()}
                              </p>
                              <p className="text-[10px] text-[#86868b] dark:text-[#636366]">Scanned</p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {(user.entitiesDetected ?? 0).toLocaleString()}
                              </p>
                              <p className="text-[10px] text-[#86868b] dark:text-[#636366]">Entities</p>
                            </div>
                            {(user.highRiskCount ?? 0) > 0 && (
                              <div className="text-center">
                                <p className="text-sm font-semibold text-risk-high">
                                  {user.highRiskCount}
                                </p>
                                <p className="text-[10px] text-[#86868b] dark:text-[#636366]">High Risk</p>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[#86868b] dark:text-[#636366]">--</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#d2d2d7]/30 dark:border-[#38383a]/60">
          <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
            Showing {filteredUsers.length} of {users.length} members
          </p>
        </div>
      </div>
    </div>
  );
}
