'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LiveEvent {
  id: string;
  createdAt: string;
  aiToolId: string;
  sensitivityScore: number;
  sensitivityLevel?: string;
  entities?: Array<{ type: string; length?: number; confidence?: number }>;
  action?: string;
  captureMethod?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL_MS = 5000;
const MAX_EVENTS = 50;

const DEMO_EVENTS: LiveEvent[] = [
  {
    id: 'demo-1',
    createdAt: new Date(Date.now() - 2_000).toISOString(),
    aiToolId: 'chatgpt',
    sensitivityScore: 92,
    sensitivityLevel: 'critical',
    entities: [{ type: 'SSN' }, { type: 'PERSON' }, { type: 'EMAIL' }],
    action: 'block',
    captureMethod: 'network',
  },
  {
    id: 'demo-2',
    createdAt: new Date(Date.now() - 18_000).toISOString(),
    aiToolId: 'claude',
    sensitivityScore: 67,
    sensitivityLevel: 'high',
    entities: [{ type: 'ORGANIZATION' }, { type: 'MONETARY' }],
    action: 'mask',
    captureMethod: 'dom',
  },
  {
    id: 'demo-3',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    aiToolId: 'gemini',
    sensitivityScore: 34,
    sensitivityLevel: 'medium',
    entities: [{ type: 'EMAIL' }],
    action: 'allow',
    captureMethod: 'network',
  },
  {
    id: 'demo-4',
    createdAt: new Date(Date.now() - 180_000).toISOString(),
    aiToolId: 'copilot',
    sensitivityScore: 12,
    sensitivityLevel: 'low',
    entities: [],
    action: 'allow',
    captureMethod: 'network',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 3) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function sensitivityBadge(score: number): { label: string; cls: string } {
  if (score > 85) return { label: 'Critical', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
  if (score > 60) return { label: 'High', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' };
  if (score > 25) return { label: 'Medium', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' };
  return { label: 'Low', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };
}

function toolIcon(toolId: string): string {
  const map: Record<string, string> = {
    chatgpt: '\u{1F7E2}',      // green circle
    claude: '\u{1F7E0}',       // orange circle
    gemini: '\u{1F535}',       // blue circle
    copilot: '\u{26AA}',       // white circle
    perplexity: '\u{1F7E3}',   // purple circle
    deepseek: '\u{1F534}',     // red circle
    poe: '\u{1F7E1}',          // yellow circle
    groq: '\u{26AB}',          // black circle
    huggingface: '\u{1F7E1}',  // yellow circle
    you: '\u{1F535}',          // blue circle
  };
  return map[toolId?.toLowerCase()] || '\u{26AB}';
}

function formatToolName(toolId: string): string {
  if (!toolId) return 'Unknown';
  const map: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    copilot: 'Copilot',
    perplexity: 'Perplexity',
    deepseek: 'DeepSeek',
    poe: 'Poe',
    groq: 'Groq',
    huggingface: 'HuggingFace',
    you: 'You.com',
  };
  return map[toolId.toLowerCase()] || toolId;
}

type FilterMode = 'all' | 'red' | 'amber' | 'tool';

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function LiveActivityPage() {
  const { apiFetch } = useApiClient();

  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [connectionState, setConnectionState] = useState<'live' | 'paused' | 'disconnected'>('live');
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null); // null = unknown
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [toolFilter, setToolFilter] = useState<string>('');
  const [, setTick] = useState(0); // forces rerender for relative timestamps

  // Track seen IDs (ref for mutation without triggering rerender)
  const seenIdsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const userScrolledDownRef = useRef(false);

  /* -------------------------- tick every second for relative time -- */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /* -------------------------- scroll detection ----------------------- */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      userScrolledDownRef.current = el.scrollTop > 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [apiAvailable]);

  /* -------------------------- fetch loop ---------------------------- */
  const fetchEvents = useCallback(async () => {
    try {
      const response = await apiFetch(`/events?limit=${MAX_EVENTS}`);
      if (response.status === 404) {
        setApiAvailable(false);
        setConnectionState('disconnected');
        return;
      }
      if (!response.ok) {
        setConnectionState('disconnected');
        return;
      }
      const data = await response.json();
      const incoming: LiveEvent[] = Array.isArray(data?.events) ? data.events : [];

      if (apiAvailable !== true) setApiAvailable(true);

      // Merge without duplicates; newest at top
      setEvents((prev) => {
        const seen = seenIdsRef.current;
        const newlyAdded: LiveEvent[] = [];
        for (const evt of incoming) {
          if (evt?.id && !seen.has(evt.id)) {
            seen.add(evt.id);
            newlyAdded.push(evt);
          }
        }

        if (newlyAdded.length === 0 && prev.length > 0) return prev;

        // Sort all events by createdAt desc
        const merged = [...newlyAdded, ...prev]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, MAX_EVENTS);

        // Prune seen set for pruned events
        const keep = new Set(merged.map((e) => e.id));
        for (const id of Array.from(seen)) {
          if (!keep.has(id)) seen.delete(id);
        }

        // If user has scrolled down and new events arrived after initial load, show banner
        if (initialLoadComplete && newlyAdded.length > 0 && userScrolledDownRef.current) {
          setPendingNewCount((c) => c + newlyAdded.length);
        }

        return merged;
      });

      setConnectionState(paused ? 'paused' : 'live');
      if (!initialLoadComplete) setInitialLoadComplete(true);
    } catch {
      setConnectionState('disconnected');
    }
  }, [apiFetch, apiAvailable, initialLoadComplete, paused]);

  useEffect(() => {
    // Initial fetch
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) {
      setConnectionState('paused');
      return;
    }
    if (apiAvailable === false) return;
    const id = setInterval(() => fetchEvents(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused, apiAvailable, fetchEvents]);

  /* -------------------------- available tools ------------------------ */
  const availableTools = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.aiToolId) set.add(e.aiToolId);
    return Array.from(set).sort();
  }, [events]);

  /* -------------------------- filtered events ------------------------ */
  const visibleEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterMode === 'red') return e.sensitivityScore > 85;
      if (filterMode === 'amber') return e.sensitivityScore > 60;
      if (filterMode === 'tool' && toolFilter) return e.aiToolId === toolFilter;
      return true;
    });
  }, [events, filterMode, toolFilter]);

  /* -------------------------- status dot ----------------------------- */
  function StatusDot() {
    if (connectionState === 'live') {
      return (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live
        </span>
      );
    }
    if (connectionState === 'paused') {
      return (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-[#6e6e73] dark:text-[#86868b]">
          <span className="inline-flex h-2.5 w-2.5 rounded-full border-2 border-[#86868b]" />
          Paused
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        Disconnected
      </span>
    );
  }

  /* -------------------------- scroll to top -------------------------- */
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    userScrolledDownRef.current = false;
    setPendingNewCount(0);
  }, []);

  /* -------------------------- render --------------------------------- */

  const isDemoMode = apiAvailable === false;
  const eventsToRender = isDemoMode ? DEMO_EVENTS : visibleEvents;

  return (
    <div className="max-w-5xl mx-auto">
      {/* ---- Breadcrumb ---- */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <ol className="flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
          <li>
            <Link href="/dashboard" className="hover:text-[#424245] dark:hover:text-[#d2d2d7] transition-colors">
              Dashboard
            </Link>
          </li>
          <li>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </li>
          <li className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Live Activity</li>
        </ol>
      </nav>

      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Live Activity</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Real-time view of AI protection events across your firm.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusDot />
          <button
            onClick={() => setPaused((p) => !p)}
            disabled={isDemoMode}
            className="px-4 py-2 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-lg text-sm text-[#424245] dark:text-[#a1a1a6] bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {paused ? 'Resume stream' : 'Pause stream'}
          </button>
        </div>
      </div>

      {/* ---- Demo banner if API unavailable ---- */}
      {isDemoMode && (
        <div className="mb-4 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            <span className="font-medium">Live stream not available in this environment</span> &mdash; feature coming
            soon. Showing a static demo view below.
          </p>
        </div>
      )}

      {/* ---- Filter pills ---- */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterPill active={filterMode === 'all'} onClick={() => { setFilterMode('all'); setToolFilter(''); }}>
          All
        </FilterPill>
        <FilterPill active={filterMode === 'red'} onClick={() => { setFilterMode('red'); setToolFilter(''); }}>
          Red only
        </FilterPill>
        <FilterPill active={filterMode === 'amber'} onClick={() => { setFilterMode('amber'); setToolFilter(''); }}>
          Amber+
        </FilterPill>
        <div className="flex items-center gap-1">
          <FilterPill
            active={filterMode === 'tool'}
            onClick={() => setFilterMode('tool')}
          >
            By tool
          </FilterPill>
          {filterMode === 'tool' && (
            <select
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="ml-1 px-3 py-1.5 border border-[#d2d2d7]/40 dark:border-[#38383a]/60 rounded-full text-sm bg-white dark:bg-[#1c1c1e] dark:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-iron-500"
              aria-label="Filter by tool"
            >
              <option value="">Select tool...</option>
              {availableTools.map((t) => (
                <option key={t} value={t}>
                  {formatToolName(t)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ---- Pending-new banner ---- */}
      {pendingNewCount > 0 && !isDemoMode && (
        <button
          onClick={scrollToTop}
          className="w-full mb-3 py-2 rounded-lg bg-iron-600 hover:bg-iron-700 text-white text-sm font-medium transition-colors"
        >
          {pendingNewCount} new event{pendingNewCount === 1 ? '' : 's'} &mdash; click to view
        </button>
      )}

      {/* ---- Event stream ---- */}
      <div
        ref={listRef}
        className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-y-auto"
        style={{ maxHeight: '70vh' }}
      >
        {!isDemoMode && !initialLoadComplete ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : eventsToRender.length === 0 ? (
          <div className="p-12 text-center">
            <svg
              className="w-12 h-12 text-[#d2d2d7] dark:text-[#38383a] mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7Z"
              />
            </svg>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] font-medium mb-1">
              Waiting for events...
            </p>
            <p className="text-xs text-[#86868b] dark:text-[#636366]">
              Install the extension and submit a prompt to see activity here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
            {eventsToRender.map((event) => {
              const badge = sensitivityBadge(event.sensitivityScore);
              const entityTypes = Array.isArray(event.entities)
                ? Array.from(new Set(event.entities.map((e) => e.type).filter(Boolean)))
                : [];
              return (
                <li
                  key={event.id}
                  className="px-5 py-3 flex items-center gap-4 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors animate-[fadeInDown_0.3s_ease-out]"
                >
                  <div className="flex-shrink-0 w-20 text-xs text-[#86868b] dark:text-[#636366] tabular-nums" suppressHydrationWarning>
                    {relativeTime(event.createdAt)}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2 w-32">
                    <span aria-hidden="true" className="text-base leading-none">{toolIcon(event.aiToolId)}</span>
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {formatToolName(event.aiToolId)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                    {entityTypes.length === 0 ? (
                      <span className="text-xs text-[#86868b] dark:text-[#636366]">No entities</span>
                    ) : (
                      entityTypes.slice(0, 4).map((t, i) => (
                        <span
                          key={i}
                          className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-[#f5f5f7] text-[#424245] dark:bg-[#2c2c2e] dark:text-[#a1a1a6]"
                        >
                          {t}
                        </span>
                      ))
                    )}
                    {entityTypes.length > 4 && (
                      <span className="text-[10px] text-[#86868b] dark:text-[#636366] self-center">
                        +{entityTypes.length - 4}
                      </span>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                      {badge.label} {event.sensitivityScore}
                    </span>
                  </div>
                  <div className="flex-shrink-0 w-16 text-right">
                    <span className="text-xs capitalize text-[#6e6e73] dark:text-[#86868b]">
                      {event.action || 'allow'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* keyframes via inline style tag for animate-[fadeInDown_...] */}
      <style jsx global>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FilterPill                                                         */
/* ------------------------------------------------------------------ */

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
        active
          ? 'bg-iron-600 border-iron-600 text-white'
          : 'bg-white dark:bg-[#1c1c1e] border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
      }`}
    >
      {children}
    </button>
  );
}
