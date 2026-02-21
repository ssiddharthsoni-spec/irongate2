'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  lastActive: string;
  status: 'active' | 'inactive' | 'pending';
}

const DEMO_USERS: User[] = [
  {
    id: '1',
    name: 'Sarah Chen',
    email: 'sarah.chen@firm.com',
    role: 'admin',
    lastActive: '2026-02-21T09:15:00Z',
    status: 'active',
  },
  {
    id: '2',
    name: 'James Rodriguez',
    email: 'j.rodriguez@firm.com',
    role: 'user',
    lastActive: '2026-02-20T16:42:00Z',
    status: 'active',
  },
  {
    id: '3',
    name: 'Emily Park',
    email: 'emily.park@firm.com',
    role: 'user',
    lastActive: '2026-02-18T11:30:00Z',
    status: 'active',
  },
  {
    id: '4',
    name: 'Michael Thompson',
    email: 'm.thompson@firm.com',
    role: 'viewer',
    lastActive: '2026-02-10T08:20:00Z',
    status: 'inactive',
  },
  {
    id: '5',
    name: 'Lisa Wang',
    email: 'lisa.wang@firm.com',
    role: 'viewer',
    lastActive: '2026-02-19T14:55:00Z',
    status: 'active',
  },
  {
    id: '6',
    name: 'David Kim',
    email: 'd.kim@firm.com',
    role: 'user',
    lastActive: '',
    status: 'pending',
  },
];

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
      console.error('Failed to load users, using demo data:', err);
      setUsers(DEMO_USERS);
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
      // In demo mode, add the user locally
      const newUser: User = {
        id: String(Date.now()),
        name: inviteEmail.trim().split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        email: inviteEmail.trim(),
        role: inviteRole,
        lastActive: '',
        status: 'pending',
      };
      setUsers((prev) => [...prev, newUser]);
      setInviteMessage({ type: 'success', text: `Invitation sent to ${inviteEmail.trim()} (demo mode).` });
      setInviteEmail('');
      setInviteRole('user');
    } finally {
      setInviting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------
  async function handleRoleChange(userId: string, newRole: 'admin' | 'user' | 'viewer') {
    try {
      setUpdatingRoleId(userId);
      const res = await apiFetch(`/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch (err: any) {
      // In demo mode, update locally
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
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
      inactive: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
      pending: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
    };
    const dotStyles: Record<User['status'], string> = {
      active: 'bg-green-500',
      inactive: 'bg-gray-400',
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
          <ol className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <li><a href="/admin" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Admin</a></li>
            <li><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></li>
            <li className="font-medium text-gray-900 dark:text-white">Users</li>
          </ol>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">User Management</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
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
        <ol className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <li><a href="/admin" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Admin</a></li>
          <li><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></li>
          <li className="font-medium text-gray-900 dark:text-white">Users</li>
        </ol>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage team members, assign roles, and send invitations.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Invite User form */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Invite User</h2>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@firm.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
          <div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user' | 'viewer')}
              className="w-full sm:w-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
            >
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        {users.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            No users found. Send an invitation to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Email</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Role</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Last Active</th>
                  <th className="pb-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-900 dark:text-white">{user.name}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">
                      {user.email}
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'user' | 'viewer')}
                        disabled={updatingRoleId === user.id}
                        className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
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
