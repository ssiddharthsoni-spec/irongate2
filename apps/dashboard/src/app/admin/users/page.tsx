'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  lastActive: string;
  status: 'active' | 'inactive' | 'pending';
}

export default function UsersPage() {
  const { apiFetch } = useApiClient();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user' | 'viewer'>('user');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Role change state
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch users
  // ---------------------------------------------------------------------------
  async function fetchUsers() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/users');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : data.users ?? []);
    } catch (err: any) {
      console.error('Failed to load users:', err);
      setError(err.message || 'Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  // ---------------------------------------------------------------------------
  // Invite user
  // ---------------------------------------------------------------------------
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      setInviting(true);
      setInviteMessage(null);
      const res = await apiFetch('/admin/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      setInviteMessage({ type: 'success', text: `Invitation sent to ${inviteEmail.trim()}.` });
      setInviteEmail('');
      setInviteRole('user');
      await fetchUsers();
    } catch (err: any) {
      // Show the actual error — never silently pretend it worked
      const message = err?.message?.includes('Server responded')
        ? 'Failed to send invitation. Please check your connection and try again.'
        : 'Failed to send invitation. Please try again.';
      setInviteMessage({ type: 'error', text: message });
    } finally {
      setInviting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------
  async function handleRoleChange(userId: string, newRole: 'admin' | 'user' | 'viewer') {
    // Store previous role so we can revert on failure
    const previousUser = users.find((u) => u.id === userId);
    try {
      setUpdatingRoleId(userId);
      // Optimistic update
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      const res = await apiFetch(`/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    } catch {
      // REVERT optimistic update — never silently pretend it worked
      if (previousUser) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: previousUser.role } : u)));
      }
      setError(`Failed to update role for ${previousUser?.name || 'user'}. Please try again.`);
      // Auto-clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    } finally {
      setUpdatingRoleId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------
  function statusBadge(status: User['status']) {
    const styles: Record<User['status'], string> = {
      active: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
      inactive: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]',
      pending: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
    };
    const dotStyles: Record<User['status'], string> = {
      active: 'bg-green-500',
      inactive: 'bg-[#86868b]',
      pending: 'bg-yellow-500',
    };
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[status]}`} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
            <li><a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">Admin</a></li>
            <li><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></li>
            <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Users</li>
          </ol>
        </nav>
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">User Management</h1>
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 w-28 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-4 w-40 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-6 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-4 w-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-5 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li><a href="/admin" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">Admin</a></li>
          <li><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Users</li>
        </ol>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">User Management</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
          Manage team members, assign roles, and send invitations.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchUsers} className="shrink-0 ml-3 text-red-700 dark:text-red-400 underline hover:opacity-80 font-semibold">Retry</button>
        </div>
      )}

      {/* Invite User form */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Invite User</h2>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@firm.com"
              className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-[#86868b] dark:placeholder-[#636366]"
            />
          </div>
          <div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user' | 'viewer')}
              className="w-full sm:w-auto rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
            >
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
              inviting
                ? 'bg-iron-400 dark:bg-iron-800 cursor-not-allowed'
                : 'bg-iron-600 hover:bg-iron-700'
            }`}
          >
            {inviting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              'Send Invite'
            )}
          </button>
        </form>

        {inviteMessage && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm font-medium ${
              inviteMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}
          >
            {inviteMessage.text}
          </div>
        )}
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        {users.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-12 h-12 text-[#d2d2d7] dark:text-[#38383a]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            }
            title="No users found"
            description="Send an invitation to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-left">
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Name</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Email</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Role</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Last Active</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{user.name}</p>
                    </td>
                    <td className="py-3 pr-4 text-[#6e6e73] dark:text-[#a1a1a6]">
                      {user.email}
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'user' | 'viewer')}
                        disabled={updatingRoleId === user.id}
                        className="rounded-lg border border-[#d2d2d7] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                      {user.lastActive
                        ? new Date(user.lastActive).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </td>
                    <td className="py-3">
                      {statusBadge(user.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
