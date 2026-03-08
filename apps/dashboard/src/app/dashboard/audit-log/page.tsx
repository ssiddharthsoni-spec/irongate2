'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApiClient } from '../../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  userId?: string;
  aiToolId?: string;
  sensitivityScore: number;
  sensitivityLevel?: string;
  action?: string;
  captureMethod?: string;
  entities?: { type: string; length?: number; confidence?: number }[];
  createdAt: string;
  eventHash?: string;
  chainPosition?: number;
  previousHash?: string;
}

type SensitivityFilter = '' | 'low' | 'medium' | 'high' | 'critical';

const PAGE_SIZE = 50;

const LEVEL_BADGES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

const ACTION_BADGES: Record<string, string> = {
  block: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  warn: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  proxy: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
  pass: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
  override: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreToLevel(score: number): string {
  if (score >= 86) return 'critical';
  if (score >= 61) return 'high';
  if (score >= 26) return 'medium';
  return 'low';
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEntityType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Ssn/g, 'SSN')
    .replace(/Ip /g, 'IP ')
    .replace(/Api /g, 'API ')
    .replace(/Mnpi/g, 'MNPI');
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const { apiFetch } = useApiClient();

  // Data
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filters
  const [levelFilter, setLevelFilter] = useState<SensitivityFilter>('');
  const [toolFilter, setToolFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // UI
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce user filter
  const [debouncedUser, setDebouncedUser] = useState('');
  const userTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (userTimerRef.current) clearTimeout(userTimerRef.current);
    userTimerRef.current = setTimeout(() => {
      setDebouncedUser(userFilter);
      setOffset(0);
    }, 300);
    return () => {
      if (userTimerRef.current) clearTimeout(userTimerRef.current);
    };
  }, [userFilter]);

  // ─── Fetch Events ──────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    try {
      setFetchError(null);
      setLoading(true);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      // Score-based filtering for levels
      if (levelFilter === 'critical') params.set('minScore', '86');
      else if (levelFilter === 'high') params.set('minScore', '61');
      else if (levelFilter === 'medium') params.set('minScore', '26');

      if (toolFilter) params.set('aiToolId', toolFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await apiFetch(`/events?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch events (${res.status})`);

      const data = await res.json();
      let eventsList: AuditEvent[] = data.events || [];

      // Client-side filter by level (for exact level matches) and user
      if (levelFilter) {
        eventsList = eventsList.filter((e) => {
          const level = e.sensitivityLevel || scoreToLevel(e.sensitivityScore);
          return level === levelFilter;
        });
      }

      if (debouncedUser) {
        const q = debouncedUser.toLowerCase();
        eventsList = eventsList.filter((e) =>
          (e.userId || '').toLowerCase().includes(q)
        );
      }

      setEvents(eventsList);
      setTotalCount(data.total ?? eventsList.length);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, offset, levelFilter, toolFilter, startDate, endDate, debouncedUser]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Close modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedEvent(null);
    }
    if (selectedEvent) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedEvent]);

  // ─── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    try {
      setExporting(true);
      const params = new URLSearchParams({ limit: '1000', offset: '0' });
      if (toolFilter) params.set('aiToolId', toolFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (levelFilter === 'critical') params.set('minScore', '86');
      else if (levelFilter === 'high') params.set('minScore', '61');
      else if (levelFilter === 'medium') params.set('minScore', '26');

      const res = await apiFetch(`/events?${params.toString()}`);
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const allEvents: AuditEvent[] = data.events || [];

      const rows = [
        ['Timestamp', 'User', 'AI Tool', 'Score', 'Level', 'Action', 'Entities', 'Event Hash'],
        ...allEvents.map((e) => [
          e.createdAt,
          e.userId || '',
          e.aiToolId || '',
          String(e.sensitivityScore),
          e.sensitivityLevel || scoreToLevel(e.sensitivityScore),
          e.action || '',
          Array.isArray(e.entities) ? e.entities.map((en) => en.type).join('; ') : '',
          e.eventHash || '',
        ]),
      ];

      const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setFetchError(err.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const levelCounts = events.reduce(
    (acc, e) => {
      const level = e.sensitivityLevel || scoreToLevel(e.sensitivityScore);
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading && events.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Audit Log</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading events...</p>
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
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
                <div className="h-4 w-28 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-4 w-20 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-6 w-10 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full" />
                <div className="h-4 w-14 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
                <div className="h-4 w-32 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
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
          <button onClick={fetchEvents} className="ml-4 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Audit Log</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            Complete record of AI interactions and data protection events
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-[#424245] border border-[#d2d2d7]/40 hover:bg-[#f5f5f7] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:border-[#38383a]/60 dark:hover:bg-[#2c2c2e] transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Level Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <LevelCard
          label="Critical"
          count={levelCounts.critical || 0}
          color="text-red-600 dark:text-red-400"
          dotColor="bg-red-500"
          active={levelFilter === 'critical'}
          onClick={() => { setLevelFilter(levelFilter === 'critical' ? '' : 'critical'); setOffset(0); }}
        />
        <LevelCard
          label="High"
          count={levelCounts.high || 0}
          color="text-orange-600 dark:text-orange-400"
          dotColor="bg-orange-500"
          active={levelFilter === 'high'}
          onClick={() => { setLevelFilter(levelFilter === 'high' ? '' : 'high'); setOffset(0); }}
        />
        <LevelCard
          label="Medium"
          count={levelCounts.medium || 0}
          color="text-yellow-600 dark:text-yellow-500"
          dotColor="bg-yellow-500"
          active={levelFilter === 'medium'}
          onClick={() => { setLevelFilter(levelFilter === 'medium' ? '' : 'medium'); setOffset(0); }}
        />
        <LevelCard
          label="Low"
          count={levelCounts.low || 0}
          color="text-green-600 dark:text-green-400"
          dotColor="bg-green-500"
          active={levelFilter === 'low'}
          onClick={() => { setLevelFilter(levelFilter === 'low' ? '' : 'low'); setOffset(0); }}
        />
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <input
            type="text"
            placeholder="Filter by user..."
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
          />
        </div>
        <select
          value={toolFilter}
          onChange={(e) => { setToolFilter(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
        >
          <option value="">All Tools</option>
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="copilot">Copilot</option>
          <option value="deepseek">DeepSeek</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
          placeholder="Start date"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#d2d2d7]/40 bg-white dark:bg-[#1c1c1e] dark:border-[#38383a]/60 text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500/40 focus:border-iron-500"
          placeholder="End date"
        />
        {(levelFilter || toolFilter || userFilter || startDate || endDate) && (
          <button
            onClick={() => {
              setLevelFilter('');
              setToolFilter('');
              setUserFilter('');
              setStartDate('');
              setEndDate('');
              setOffset(0);
            }}
            className="px-3 py-2 text-sm rounded-lg text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Events Table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
                <th className="px-6 py-3">Timestamp</th>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">AI Tool</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Level</th>
                <th className="px-6 py-3">Action</th>
                <th className="px-6 py-3">Entities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2d2d7]/30 dark:divide-[#38383a]/60">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-10 h-10 text-[#d2d2d7] dark:text-[#38383a]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] font-medium">No events found</p>
                      <p className="text-xs text-[#86868b] dark:text-[#636366]">
                        {levelFilter || toolFilter || debouncedUser || startDate || endDate
                          ? 'Try adjusting your filters.'
                          : 'Events will appear here once the extension starts scanning prompts.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const level = event.sensitivityLevel || scoreToLevel(event.sensitivityScore);
                  const entityCount = Array.isArray(event.entities) ? event.entities.length : 0;
                  return (
                    <tr
                      key={event.id}
                      tabIndex={0}
                      role="button"
                      className="hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-inset"
                      onClick={() => setSelectedEvent(event)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEvent(event); } }}
                    >
                      <td className="px-6 py-3 text-sm text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap" suppressHydrationWarning>
                        {formatTimestamp(event.createdAt)}
                      </td>
                      <td className="px-6 py-3 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] truncate max-w-[160px]">
                        {event.userId || '--'}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] capitalize">
                        {event.aiToolId || '--'}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${
                          event.sensitivityScore > 85 ? 'text-risk-critical bg-red-50 dark:bg-red-900/20' :
                          event.sensitivityScore > 60 ? 'text-risk-high bg-orange-50 dark:bg-orange-900/20' :
                          event.sensitivityScore > 25 ? 'text-risk-medium bg-yellow-50 dark:bg-yellow-900/20' :
                          'text-risk-low bg-green-50 dark:bg-green-900/20'
                        }`}>
                          {event.sensitivityScore}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${LEVEL_BADGES[level] || LEVEL_BADGES.low}`}>
                          {level}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {event.action ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ACTION_BADGES[event.action] || 'bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]'}`}>
                            {event.action}
                          </span>
                        ) : (
                          <span className="text-xs text-[#86868b]">--</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {entityCount > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {event.entities!.slice(0, 3).map((ent, i) => (
                              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6]">
                                {formatEntityType(ent.type)}
                              </span>
                            ))}
                            {entityCount > 3 && (
                              <span className="text-[10px] text-[#86868b] dark:text-[#636366]">+{entityCount - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[#86868b]">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-[#d2d2d7]/30 dark:border-[#38383a]/60">
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
              Showing {offset + 1}--{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-[#6e6e73] dark:text-[#86868b]">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#424245] dark:text-[#a1a1a6] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Event Detail Slide-Over */}
      {selectedEvent && (
        <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function LevelCard({
  label,
  count,
  color,
  dotColor,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  dotColor: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`bg-white dark:bg-[#1c1c1e] rounded-xl p-4 shadow-sm border transition-colors cursor-pointer hover:border-iron-400 dark:hover:border-iron-500 ${
        active
          ? 'border-iron-500 dark:border-iron-400 ring-1 ring-iron-500/30'
          : 'border-[#d2d2d7]/40 dark:border-[#38383a]/60'
      }`}
      onClick={onClick}
      role="button"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b]">{label}</p>
      </div>
      <p className={`text-xl font-bold ${color}`}>{count}</p>
    </div>
  );
}

function EventDetailPanel({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  const level = event.sensitivityLevel || scoreToLevel(event.sensitivityScore);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Event details" className="relative w-full max-w-full sm:max-w-lg bg-white dark:bg-[#1c1c1e] shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[#1c1c1e] border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Event Details</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Score & Level */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Sensitivity</h3>
            <div className="flex items-center gap-4">
              <span className={`inline-flex px-3 py-1.5 rounded-full text-lg font-bold ${
                event.sensitivityScore > 85 ? 'text-risk-critical bg-red-50 dark:bg-red-900/20' :
                event.sensitivityScore > 60 ? 'text-risk-high bg-orange-50 dark:bg-orange-900/20' :
                event.sensitivityScore > 25 ? 'text-risk-medium bg-yellow-50 dark:bg-yellow-900/20' :
                'text-risk-low bg-green-50 dark:bg-green-900/20'
              }`}>
                {event.sensitivityScore}
              </span>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium capitalize ${LEVEL_BADGES[level] || LEVEL_BADGES.low}`}>
                {level}
              </span>
            </div>
          </div>

          {/* Details */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Event Information</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Timestamp</dt>
                <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]" suppressHydrationWarning>
                  {formatTimestamp(event.createdAt)}
                </dd>
              </div>
              {event.userId && (
                <div className="flex justify-between">
                  <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">User</dt>
                  <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{event.userId}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">AI Tool</dt>
                <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] capitalize">{event.aiToolId || '--'}</dd>
              </div>
              {event.captureMethod && (
                <div className="flex justify-between">
                  <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Capture Method</dt>
                  <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{event.captureMethod}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Action */}
          {event.action && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Action Taken</h3>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium capitalize ${ACTION_BADGES[event.action] || 'bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]'}`}>
                {event.action}
              </span>
            </div>
          )}

          {/* Entities */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">
              Detected Entities ({Array.isArray(event.entities) ? event.entities.length : 0})
            </h3>
            {Array.isArray(event.entities) && event.entities.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {event.entities.map((entity, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2">
                    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">
                      {formatEntityType(entity.type)}
                    </span>
                    {entity.length != null && (
                      <span className="text-xs text-[#86868b] dark:text-[#636366] font-mono">{entity.length} chars</span>
                    )}
                    {entity.confidence != null && (
                      <span className="text-xs text-[#86868b] dark:text-[#636366]">{Math.round(entity.confidence * 100)}%</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#86868b] dark:text-[#636366]">No entities detected</p>
            )}
          </div>

          {/* Audit Chain */}
          {(event.eventHash || event.chainPosition != null) && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Audit Chain</h3>
              <dl className="space-y-3">
                {event.eventHash && (
                  <div>
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-1">Event Hash</dt>
                    <dd className="text-xs font-mono bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2 text-[#424245] dark:text-[#a1a1a6] break-all">
                      {event.eventHash}
                    </dd>
                  </div>
                )}
                {event.chainPosition != null && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Chain Position</dt>
                    <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{event.chainPosition}</dd>
                  </div>
                )}
                {event.previousHash && (
                  <div>
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-1">Previous Hash</dt>
                    <dd className="text-xs font-mono bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2 text-[#424245] dark:text-[#a1a1a6] break-all">
                      {event.previousHash}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Event ID */}
          <div className="pt-4 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <p className="text-xs text-[#86868b] dark:text-[#636366]">
              Event ID: <span className="font-mono">{event.id}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
