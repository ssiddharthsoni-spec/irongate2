'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../lib/api';

function getDemoEvents(): any[] {
  return [
    {
      id: 'demo-evt-001',
      aiToolId: 'chatgpt',
      sensitivityScore: 94,
      sensitivityLevel: 'critical',
      action: 'block',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-20T14:32:00.000Z',
      entities: [
        { type: 'SSN', length: 11, confidence: 0.98 },
        { type: 'PRIVILEGE_MARKER', length: 24, confidence: 0.91 },
        { type: 'PERSON', length: 14, confidence: 0.95 },
      ],
      eventHash: 'a3f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8',
      chainPosition: 1,
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      userId: 'siddharth.soni@irongate.dev',
    },
    {
      id: 'demo-evt-002',
      aiToolId: 'claude',
      sensitivityScore: 87,
      sensitivityLevel: 'critical',
      action: 'proxy',
      captureMethod: 'dom_intercept',
      createdAt: '2026-02-20T13:15:00.000Z',
      entities: [
        { type: 'MATTER_NUMBER', length: 12, confidence: 0.94 },
        { type: 'PERSON', length: 18, confidence: 0.97 },
        { type: 'EMAIL', length: 26, confidence: 0.99 },
      ],
      eventHash: 'b4e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9',
      chainPosition: 2,
      previousHash: 'a3f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8c1d4e5b6a7f8',
      userId: 'emily.dawson@irongate.dev',
    },
    {
      id: 'demo-evt-003',
      aiToolId: 'gemini',
      sensitivityScore: 72,
      sensitivityLevel: 'high',
      action: 'warn',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-20T11:48:00.000Z',
      entities: [
        { type: 'ORGANIZATION', length: 22, confidence: 0.88 },
        { type: 'CREDIT_CARD', length: 16, confidence: 0.96 },
      ],
      eventHash: 'c5f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0',
      chainPosition: 3,
      previousHash: 'b4e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9d2c5f6a7b8e9',
      userId: 'marcus.rivera@irongate.dev',
    },
    {
      id: 'demo-evt-004',
      aiToolId: 'copilot',
      sensitivityScore: 45,
      sensitivityLevel: 'medium',
      action: 'warn',
      captureMethod: 'dom_intercept',
      createdAt: '2026-02-20T10:22:00.000Z',
      entities: [
        { type: 'PERSON', length: 16, confidence: 0.92 },
        { type: 'ORGANIZATION', length: 19, confidence: 0.85 },
      ],
      eventHash: 'd6a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1',
      chainPosition: 4,
      previousHash: 'c5f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0e3d6a7b8c9f0',
      userId: 'jennifer.hartwell@irongate.dev',
    },
    {
      id: 'demo-evt-005',
      aiToolId: 'chatgpt',
      sensitivityScore: 91,
      sensitivityLevel: 'critical',
      action: 'block',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-20T09:05:00.000Z',
      entities: [
        { type: 'SSN', length: 11, confidence: 0.99 },
        { type: 'PERSON', length: 21, confidence: 0.96 },
        { type: 'EMAIL', length: 30, confidence: 0.98 },
        { type: 'PRIVILEGE_MARKER', length: 38, confidence: 0.87 },
      ],
      eventHash: 'e7b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2',
      chainPosition: 5,
      previousHash: 'd6a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1f4e7b8c9d0a1',
      userId: 'david.okonkwo@irongate.dev',
    },
    {
      id: 'demo-evt-006',
      aiToolId: 'claude',
      sensitivityScore: 33,
      sensitivityLevel: 'medium',
      action: 'pass',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-19T17:40:00.000Z',
      entities: [
        { type: 'PERSON', length: 12, confidence: 0.89 },
      ],
      eventHash: 'f8c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3',
      chainPosition: 6,
      previousHash: 'e7b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2a5f8c9d0e1b2',
      userId: 'siddharth.soni@irongate.dev',
    },
    {
      id: 'demo-evt-007',
      aiToolId: 'gemini',
      sensitivityScore: 68,
      sensitivityLevel: 'high',
      action: 'proxy',
      captureMethod: 'dom_intercept',
      createdAt: '2026-02-19T15:12:00.000Z',
      entities: [
        { type: 'MATTER_NUMBER', length: 10, confidence: 0.93 },
        { type: 'ORGANIZATION', length: 28, confidence: 0.91 },
        { type: 'PERSON', length: 15, confidence: 0.94 },
      ],
      eventHash: 'a9d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4',
      chainPosition: 7,
      previousHash: 'f8c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3b6a9d0e1f2c3',
      userId: 'emily.dawson@irongate.dev',
    },
    {
      id: 'demo-evt-008',
      aiToolId: 'chatgpt',
      sensitivityScore: 15,
      sensitivityLevel: 'low',
      action: 'pass',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-19T12:55:00.000Z',
      entities: [],
      eventHash: 'b0e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5',
      chainPosition: 8,
      previousHash: 'a9d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4c7b0e1f2a3d4',
      userId: 'marcus.rivera@irongate.dev',
    },
    {
      id: 'demo-evt-009',
      aiToolId: 'copilot',
      sensitivityScore: 78,
      sensitivityLevel: 'high',
      action: 'warn',
      captureMethod: 'dom_intercept',
      createdAt: '2026-02-19T10:30:00.000Z',
      entities: [
        { type: 'CREDIT_CARD', length: 16, confidence: 0.97 },
        { type: 'PERSON', length: 20, confidence: 0.93 },
      ],
      eventHash: 'c1f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6',
      chainPosition: 9,
      previousHash: 'b0e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5d8c1f2a3b4e5',
      userId: 'jennifer.hartwell@irongate.dev',
    },
    {
      id: 'demo-evt-010',
      aiToolId: 'claude',
      sensitivityScore: 55,
      sensitivityLevel: 'medium',
      action: 'warn',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-19T08:18:00.000Z',
      entities: [
        { type: 'EMAIL', length: 24, confidence: 0.99 },
        { type: 'ORGANIZATION', length: 17, confidence: 0.86 },
      ],
      eventHash: 'd2a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7',
      chainPosition: 10,
      previousHash: 'c1f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6e9d2a3b4c5f6',
      userId: 'david.okonkwo@irongate.dev',
    },
    {
      id: 'demo-evt-011',
      aiToolId: 'chatgpt',
      sensitivityScore: 82,
      sensitivityLevel: 'high',
      action: 'proxy',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-18T16:45:00.000Z',
      entities: [
        { type: 'PRIVILEGE_MARKER', length: 31, confidence: 0.90 },
        { type: 'MATTER_NUMBER', length: 10, confidence: 0.95 },
        { type: 'PERSON', length: 13, confidence: 0.92 },
      ],
      eventHash: 'e3b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8',
      chainPosition: 11,
      previousHash: 'd2a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7f0e3b4c5d6a7',
      userId: 'siddharth.soni@irongate.dev',
    },
    {
      id: 'demo-evt-012',
      aiToolId: 'gemini',
      sensitivityScore: 21,
      sensitivityLevel: 'low',
      action: 'pass',
      captureMethod: 'dom_intercept',
      createdAt: '2026-02-18T14:10:00.000Z',
      entities: [
        { type: 'PERSON', length: 9, confidence: 0.78 },
      ],
      eventHash: 'f4c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9',
      chainPosition: 12,
      previousHash: 'e3b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8a1f4c5d6e7b8',
      userId: 'emily.dawson@irongate.dev',
    },
    {
      id: 'demo-evt-013',
      aiToolId: 'claude',
      sensitivityScore: 95,
      sensitivityLevel: 'critical',
      action: 'block',
      captureMethod: 'fetch_intercept',
      createdAt: '2026-02-18T11:33:00.000Z',
      entities: [
        { type: 'SSN', length: 11, confidence: 0.99 },
        { type: 'CREDIT_CARD', length: 16, confidence: 0.97 },
        { type: 'PERSON', length: 17, confidence: 0.96 },
        { type: 'EMAIL', length: 29, confidence: 0.98 },
      ],
      eventHash: 'a5d0c3b6e7f8a9d0c3b6e7f8a9d0c3b6e7f8a9d0c3b6e7f8a9d0c3b6e7f8a9d0',
      chainPosition: 13,
      previousHash: 'f4c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9b2a5d6e7f8c9',
      userId: 'marcus.rivera@irongate.dev',
    },
  ];
}

export default function EventsPage() {
  const { apiFetch } = useApiClient();
  const [events, setEvents] = useState<any[]>(getDemoEvents());
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
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
      setFetchError(null);
      const params = new URLSearchParams();
      if (filters.minScore) params.set('minScore', filters.minScore);
      if (filters.aiToolId) params.set('aiToolId', filters.aiToolId);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));

      const response = await apiFetch(`/events?${params}`);

      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setEvents(data.events || []);
      setIsLive(true);
    } catch (err) {
      console.error('Failed to fetch events:', err);
      setIsLive(false);
      setFetchError('Unable to connect to API. Showing demo data.');
      // Keep demo data — do not clear events
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
      default: return 'bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]';
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
    return typeMap[type?.toLowerCase()] || 'bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]';
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
      {/* Demo data banner */}
      {!isLive && !loading && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3">
          <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
            <span className="font-medium">Demo Mode</span> — Showing sample data. {fetchError || 'Connect your API to see live events.'}
          </p>
          <button
            onClick={fetchEvents}
            className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Events</h1>
        <div className="flex gap-3">
          <select
            className="px-3 py-2 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-lg text-sm dark:bg-[#1c1c1e] dark:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
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
            className="px-3 py-2 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-lg text-sm dark:bg-[#1c1c1e] dark:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
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

      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden [&_table]:min-w-[700px] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f5f5f7] dark:bg-[#1c1c1e]/80 text-left text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider">
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3">AI Tool</th>
              <th className="px-6 py-3">Score</th>
              <th className="px-6 py-3">Level</th>
              <th className="px-6 py-3">Entities</th>
              <th className="px-6 py-3">Action</th>
              <th className="px-6 py-3">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td className="px-6 py-3"><div className="h-4 w-28 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-6 w-10 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-14 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-8 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-12 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                  <td className="px-6 py-3"><div className="h-4 w-16 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" /></td>
                </tr>
              ))
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-10 h-10 text-[#d2d2d7] dark:text-[#38383a]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b] font-medium">No events found</p>
                    <p className="text-xs text-[#86868b] dark:text-[#636366]">Try adjusting your filters or check that the Iron Gate extension is installed.</p>
                  </div>
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} tabIndex={0} role="button" className="hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] cursor-pointer focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-inset" onClick={() => setSelectedEvent(event)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEvent(event); } }}>
                  <td className="px-6 py-3 text-sm text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap" suppressHydrationWarning>
                    {new Date(event.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{event.aiToolId}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${getScoreColor(event.sensitivityScore)}`}>
                      {event.sensitivityScore}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.sensitivityLevel}</td>
                  <td className="px-6 py-3 text-sm text-[#6e6e73] dark:text-[#86868b]">
                    {Array.isArray(event.entities) ? event.entities.length : 0}
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.action}</td>
                  <td className="px-6 py-3 text-sm text-[#6e6e73] dark:text-[#86868b]">{event.captureMethod}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60 flex items-center justify-between">
          <button
            onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}
            disabled={filters.offset === 0}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 dark:text-[#a1a1a6] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            Previous
          </button>
          <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">
            {events.length > 0
              ? `Showing ${filters.offset + 1}\u2013${filters.offset + events.length}`
              : 'No results'}
          </span>
          <button
            onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
            disabled={events.length < filters.limit}
            className="min-h-[44px] px-4 py-2.5 text-sm rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 dark:text-[#a1a1a6] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
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
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedEvent(null)}
          />

          {/* Slide-over panel */}
          <div role="dialog" aria-modal="true" aria-label="Event details" className="relative w-full max-w-full sm:max-w-lg bg-white dark:bg-[#1c1c1e] shadow-xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-[#1c1c1e] border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Event Details</h2>
              <button
                onClick={() => setSelectedEvent(null)}
                aria-label="Close event details"
                className="p-2 rounded-lg hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Sensitivity Score & Level */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Sensitivity</h3>
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
                <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Event Information</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Timestamp</dt>
                    <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]" suppressHydrationWarning>{new Date(selectedEvent.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">AI Tool</dt>
                    <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{selectedEvent.aiToolId}</dd>
                  </div>
                  {selectedEvent.userId && (
                    <div className="flex justify-between">
                      <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">User</dt>
                      <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{selectedEvent.userId}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Capture Method</dt>
                    <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] capitalize">{selectedEvent.captureMethod}</dd>
                  </div>
                </dl>
              </div>

              {/* Route Decision */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Route Decision</h3>
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
                <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">
                  Detected Entities ({Array.isArray(selectedEvent.entities) ? selectedEvent.entities.length : 0})
                </h3>
                {Array.isArray(selectedEvent.entities) && selectedEvent.entities.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedEvent.entities.map((entity: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase ${getEntityTypeBadgeClass(entity.type)}`}>
                          {entity.type}
                        </span>
                        <span className="text-sm text-[#6e6e73] dark:text-[#86868b] font-mono">
                          {'*'.repeat(Math.min(entity.length || 8, 16))} <span className="text-xs opacity-60">({entity.length || '?'} chars)</span>
                        </span>
                        <span className="text-xs text-[#86868b] dark:text-[#636366]">
                          {Math.round((entity.confidence || 0) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#86868b] dark:text-[#636366]">No entities detected</p>
                )}
              </div>

              {/* Audit Chain */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b] mb-3">Audit Chain</h3>
                <dl className="space-y-3">
                  {selectedEvent.eventHash && (
                    <div>
                      <dt className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-1">Event Hash</dt>
                      <dd className="text-xs font-mono bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2 text-[#424245] dark:text-[#a1a1a6] break-all">
                        {selectedEvent.eventHash}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.chainPosition != null && (
                    <div className="flex justify-between">
                      <dt className="text-sm text-[#6e6e73] dark:text-[#86868b]">Chain Position</dt>
                      <dd className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{selectedEvent.chainPosition}</dd>
                    </div>
                  )}
                  {selectedEvent.previousHash && (
                    <div>
                      <dt className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-1">Previous Hash</dt>
                      <dd className="text-xs font-mono bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg px-3 py-2 text-[#424245] dark:text-[#a1a1a6] break-all">
                        {selectedEvent.previousHash}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Event ID */}
              <div className="pt-4 border-t border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                <div className="text-xs text-[#86868b] dark:text-[#636366]">
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
