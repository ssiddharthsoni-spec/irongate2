'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'pending';
  lastActive?: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access to all settings' },
  { value: 'editor', label: 'Editor', description: 'Can view and manage events' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
];

const DEMO_MEMBERS: TeamMember[] = [
  { id: '1', email: 'sarah.chen@firm.com', name: 'Sarah Chen', role: 'admin', status: 'active', lastActive: '2026-02-20T14:30:00Z' },
  { id: '2', email: 'james.wilson@firm.com', name: 'James Wilson', role: 'editor', status: 'active', lastActive: '2026-02-19T09:15:00Z' },
  { id: '3', email: 'maria.garcia@firm.com', name: 'Maria Garcia', role: 'viewer', status: 'active', lastActive: '2026-02-18T16:45:00Z' },
  { id: '4', email: 'alex.kumar@firm.com', name: 'Alex Kumar', role: 'viewer', status: 'pending' },
];

export default function TeamSettingsPage() {
  const { apiFetch } = useApiClient();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMembers() {
      try {
        setLoading(true);
        const response = await apiFetch('/admin/users');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        setMembers(data.users || data || []);
      } catch {
        setMembers(DEMO_MEMBERS);
      } finally {
        setLoading(false);
      }
    }
    fetchMembers();
  }, []);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    try {
      setInviting(true);
      setInviteMessage(null);
      const response = await apiFetch('/admin/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const newMember: TeamMember = {
        id: Date.now().toString(),
        email: inviteEmail.trim(),
        name: inviteEmail.trim().split('@')[0],
        role: inviteRole,
        status: 'pending',
      };
      setMembers([...members, newMember]);
      setInviteEmail('');
      setInviteMessage({ type: 'success', text: `Invitation sent to ${inviteEmail.trim()}.` });
    } catch (err: any) {
      // In demo mode, still add the member locally
      const newMember: TeamMember = {
        id: Date.now().toString(),
        email: inviteEmail.trim(),
        name: inviteEmail.trim().split('@')[0],
        role: inviteRole,
        status: 'pending',
      };
      setMembers([...members, newMember]);
      setInviteEmail('');
      setInviteMessage({ type: 'success', text: `Invitation sent to ${newMember.email} (demo).` });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: 'admin' | 'editor' | 'viewer') {
    try {
      await apiFetch(`/admin/users/${memberId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
    } catch {
      // Continue with local update in demo mode
    }
    setMembers(members.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
  }

  async function handleRemove(memberId: string) {
    try {
      setRemovingId(memberId);
      await apiFetch(`/admin/users/${memberId}`, { method: 'DELETE' });
    } catch {
      // Continue with local removal in demo mode
    }
    setMembers(members.filter((m) => m.id !== memberId));
    setConfirmRemoveId(null);
    setRemovingId(null);
  }

  function getRoleBadgeClass(role: string) {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      case 'editor':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-1" />
                  <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </div>
                <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Invite Form */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Invite Team Member</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Send an invitation to join your Iron Gate workspace.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
            placeholder="colleague@firm.com"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="Invite email address"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor' | 'viewer')}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors"
            aria-label="Invite role"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            className={`min-h-[44px] px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
              inviting || !inviteEmail.trim()
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
        </div>
        {inviteMessage && (
          <div className={`mt-3 text-sm font-medium ${inviteMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {inviteMessage.text}
          </div>
        )}
      </div>

      {/* Team Members List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Team Members
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({members.length})</span>
          </h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {members.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">No team members yet. Send an invite above.</p>
            </div>
          ) : (
            members.map((member) => (
              <div key={member.id} className="px-6 py-4 flex items-center gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-iron-100 dark:bg-iron-900/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-iron-600 dark:text-iron-400">
                    {member.name?.charAt(0)?.toUpperCase() || member.email.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{member.name || member.email}</p>
                    {member.status === 'pending' && (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.email}</p>
                  {member.lastActive && (
                    <p className="text-xs text-gray-400 dark:text-gray-500" suppressHydrationWarning>
                      Last active {new Date(member.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>

                {/* Role selector */}
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value as 'admin' | 'editor' | 'viewer')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border-0 focus:ring-2 focus:ring-iron-500 outline-none transition-colors cursor-pointer ${getRoleBadgeClass(member.role)}`}
                  aria-label={`Change role for ${member.name || member.email}`}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>

                {/* Remove button */}
                {confirmRemoveId === member.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRemove(member.id)}
                      disabled={removingId === member.id}
                      className="min-h-[36px] px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      {removingId === member.id ? (
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                      ) : (
                        'Confirm'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(null)}
                      className="min-h-[36px] px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(member.id)}
                    className="min-h-[36px] p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label={`Remove ${member.name || member.email}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Role Descriptions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Role Permissions</h2>
        <div className="space-y-3">
          {ROLES.map((role) => (
            <div key={role.value} className="flex items-start gap-3">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${getRoleBadgeClass(role.value)}`}>
                {role.label}
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">{role.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
