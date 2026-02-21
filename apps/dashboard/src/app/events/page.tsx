'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../../lib/api';

export default function EventsPage() {
  const { apiFetch } = useApiClient();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [filters, setFilters] = useState({
    minScore: '',
    aiToolId: '',
    limit: 50,
    offset: 0,
  });

  useEffect(() => {
    fetchEvents();
  }, [filters]);

  async function fetchEvents() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.minScore) params.set('minScore', filters.minScore);
      if (filters.aiToolId) params.set('aiToolId', filters.aiToolId);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));

      const response = await apiFetch(`/events?${params}`);

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  }

  function getScoreColor(score: number): string {
    if (score > 85) return 'text-risk-critical bg-red-50 dark:bg-red-900/20';
    if (score > 60) return 'text-risk-high bg-orange-50 dark:bg-orange-900/20';
    if (score > 25) return 'text-risk-medium bg-yellow-50 dark:bg-yellow-900/20';
    return 'text-risk-low bg-green-50 dark:bg-green-900/20';
  }

  function getLevelBadgeClass(level: string): string {
    switch (level?.toLowerCase()) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  function getEntityTypeBadgeClass(type: string): string {
    const typeMap: Record<string, string> = {
      person: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      organization: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      email: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      phone: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
      ssn: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      address: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      financial: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      date: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    };
    return typeMap[type?.toLowerCase()] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedEvent(null);
    }
    if (selectedEvent) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedEvent]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
        <div className="flex gap-3">
          <select
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
            value={filters.aiToolId}
            onChange={(e) => setFilters({ ...filters, aiToolId: e.target.value, offset: 0 })}
            aria-label="Filter by AI tool"
          >
            <option value="">All Tools</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="copilot">Copilot</option>
            <option value="deepseek">DeepSeek</option>
          </select>
          <select
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
            value={filters.minScore}
            onChange={(e) => setFilters({ ...filters, minScore: e.target.value, offset: 0 })}
            aria-label="Filter by minimum score"
          >
            <option value="">All Scores</option>
            <option value="25">Score &gt; 25</option>
            <option value="60">Score &gt; 60</option>
            <option value="85">Score &gt; 85</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden [&_table]:min-w-[700px] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3">AI Tool</th>
              <th className="px-6 py-3">Score</th>
              <th className="px-6 py-3">Level</th>
              <th className="px-6 py-3">Entities</th>
              <th className="px-6 py-3">Action</th>
              <th className="px-6 py-3">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td className="px-6 py-3"><div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-6 w-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">No events found</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Try adjusting your filters or check that the Iron Gate extension is installed.</p>
                  </div>
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} tabIndex={0} role="button" className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-inset" onClick={() => setSelectedEvent(event)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEvent(event); } }}>
                  <td className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap" suppressHydrationWarning>
                    {new Date(event.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white">{event.aiToolId}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${getScoreColor(event.sensitivityScore)}`}>
                      {event.sensitivityScore}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.sensitivityLevel}</td>
                  <td className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {Array.isArray(event.entities) ? event.entities.length : 0}
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.action}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">{event.captureMethod}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <button
            onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}
            disabled={filters.offset === 0}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {events.length > 0
              ? `Showing ${filters.offset + 1}\u2013${filters.offset + events.length}`
              : 'No results'}
          </span>
          <button
            onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
            disabled={events.length < filters.limit}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            Next
          </button>
        </div>
      </div>

      {/* Event Detail Slide-Over Panel */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={() => setSelectedEvent(null)}
          />

          {/* Slide-over panel */}
          <div role="dialog" aria-modal="true" aria-label="Event details" className="relative w-full max-w-full sm:max-w-lg bg-white dark:bg-gray-800 shadow-xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Event Details</h2>
              <button
                onClick={() => setSelectedEvent(null)}
                aria-label="Close event details"
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-iron-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Sensitivity Score & Level */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Sensitivity</h3>
                <div className="flex items-center gap-4">
                  <span className={`inline-flex px-3 py-1.5 rounded-full text-lg font-bold ${getScoreColor(selectedEvent.sensitivityScore)}`}>
                    {selectedEvent.sensitivityScore}
                  </span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium capitalize ${getLevelBadgeClass(selectedEvent.sensitivityLevel)}`}>
                    {selectedEvent.sensitivityLevel}
                  </span>
                </div>
              </div>

              {/* Core Details */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Event Information</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500 dark:text-gray-400">Timestamp</dt>
                    <dd className="text-sm font-medium text-gray-900 dark:text-white" suppressHydrationWarning>{new Date(selectedEvent.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500 dark:text-gray-400">AI Tool</dt>
                    <dd className="text-sm font-medium text-gray-900 dark:text-white">{selectedEvent.aiToolId}</dd>
                  </div>
                  {selectedEvent.userId && (
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500 dark:text-gray-400">User</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">{selectedEvent.userId}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500 dark:text-gray-400">Capture Method</dt>
                    <dd className="text-sm font-medium text-gray-900 dark:text-white capitalize">{selectedEvent.captureMethod}</dd>
                  </div>
                </dl>
              </div>

              {/* Route Decision */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Route Decision</h3>
                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium capitalize ${
                  selectedEvent.action === 'block' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                  selectedEvent.action === 'mask' || selectedEvent.action === 'redact' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                }`}>
                  {selectedEvent.action}
                </span>
              </div>

              {/* Detected Entities */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                  Detected Entities ({Array.isArray(selectedEvent.entities) ? selectedEvent.entities.length : 0})
                </h3>
                {Array.isArray(selectedEvent.entities) && selectedEvent.entities.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedEvent.entities.map((entity: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase ${getEntityTypeBadgeClass(entity.type)}`}>
                          {entity.type}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                          {'*'.repeat(Math.min(entity.length || 8, 16))} <span className="text-xs opacity-60">({entity.length || '?'} chars)</span>
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {Math.round((entity.confidence || 0) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No entities detected</p>
                )}
              </div>

              {/* Audit Chain */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Audit Chain</h3>
                <dl className="space-y-3">
                  {selectedEvent.eventHash && (
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400 mb-1">Event Hash</dt>
                      <dd className="text-xs font-mono bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 break-all">
                        {selectedEvent.eventHash}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.chainPosition != null && (
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Chain Position</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">{selectedEvent.chainPosition}</dd>
                    </div>
                  )}
                  {selectedEvent.previousHash && (
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400 mb-1">Previous Hash</dt>
                      <dd className="text-xs font-mono bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 break-all">
                        {selectedEvent.previousHash}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Event ID */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Event ID: <span className="font-mono">{selectedEvent.id}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
