/**
 * Iron Gate Sidepanel Store — single source of truth.
 *
 * All displayed values are derived selectors over detection_results[].
 * No component reads chrome.storage directly. No component computes its
 * own counter from its own source. One flow, one envelope, three views.
 *
 * The store is hydrated from chrome.storage.local on mount and subscribes
 * to chrome.storage.onChanged for live updates. The service worker writes
 * detection_results via appendDetectionResult() — NO other module writes
 * this key.
 */

import { create } from 'zustand';

// ── Types ───────────────────────────────────────────────────────────────────

export interface StoredDetection {
  type: string;
  text?: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
  isSensitive?: boolean;
  contextNote?: string;
}

export interface DetectionResultEntry {
  id: string;
  timestamp: number;
  aiTool: string;
  tabId: number | null;
  score: number;
  level: string;
  verdict?: string;
  rationale?: string;
  entities: StoredDetection[];
  pseudonymMappings?: Array<{ pseudonym: string; type: string; length: number }>;
  maskedPrompt?: string;
  originalPrompt?: string;
  wasIntercepted: boolean;
  degraded: boolean;
  source: string; // 'gemma4' | 'pattern-only' | 'bright-line'
}

export interface ActivityItem {
  id: string;
  aiTool: string;
  score: number;
  level: string;
  entityCount: number;
  verdict: string;
  wasIntercepted: boolean;
  degraded: boolean;
  timestamp: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

interface DetectionStore {
  /** The single source of truth — all detection results. */
  results: DetectionResultEntry[];
  /** Current tool being monitored. */
  currentTool: string | null;
  /** Active tab ID. */
  activeTabId: number | null;

  // Actions
  appendResult: (result: DetectionResultEntry) => void;
  setResults: (results: DetectionResultEntry[]) => void;
  setCurrentTool: (tool: string | null) => void;
  setActiveTabId: (tabId: number | null) => void;
  clearResults: () => void;
}

export const useDetectionStore = create<DetectionStore>((set) => ({
  results: [],
  currentTool: null,
  activeTabId: null,

  appendResult: (result) =>
    set((state) => {
      const next = [...state.results, result].slice(-100); // Cap at 100
      // Persist to storage — single writer
      try {
        chrome.storage.local.set({ detection_results: next.slice(-50) });
      } catch { /* storage may be unavailable in tests */ }
      return { results: next };
    }),

  setResults: (results) => set({ results }),

  setCurrentTool: (tool) => set({ currentTool: tool }),

  setActiveTabId: (tabId) => set({ activeTabId: tabId }),

  clearResults: () => {
    try { chrome.storage.local.remove('detection_results'); } catch {}
    set({ results: [] });
  },
}));

// ── Derived Selectors (computed, not stored) ────────────────────────────────

/** The latest detection result for the current tab. */
export function selectLatest(state: DetectionStore): DetectionResultEntry | null {
  const tabId = state.activeTabId;
  if (tabId == null) return state.results[state.results.length - 1] ?? null;
  // Find last result for this tab
  for (let i = state.results.length - 1; i >= 0; i--) {
    if (state.results[i]!.tabId === tabId) return state.results[i]!;
  }
  return null;
}

/** Recent activity feed — last 20 results, newest first. */
export function selectRecentActivity(state: DetectionStore): ActivityItem[] {
  return state.results
    .slice(-20)
    .reverse()
    .map((r) => ({
      id: r.id,
      aiTool: r.aiTool,
      score: r.score,
      level: r.level,
      entityCount: r.entities.length,
      verdict: r.verdict || (r.score > 85 ? 'block' : r.score > 60 ? 'mask' : r.score > 25 ? 'warn' : 'allow'),
      wasIntercepted: r.wasIntercepted,
      degraded: r.degraded,
      timestamp: new Date(r.timestamp).toISOString(),
    }));
}

/** Total entities detected across all results. */
export function selectTotalEntities(state: DetectionStore): number {
  return state.results.reduce((sum, r) => sum + r.entities.length, 0);
}

/** Entity type breakdown across all results. */
export function selectEntityBreakdown(state: DetectionStore): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of state.results) {
    for (const e of r.entities) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
  }
  return counts;
}

// ── Hydration ───────────────────────────────────────────────────────────────

/** Hydrate the store from chrome.storage.local on mount. */
export function hydrateStore(): void {
  try {
    chrome.storage.local.get('detection_results', (data) => {
      if (chrome.runtime.lastError) return;
      const results = data.detection_results;
      if (Array.isArray(results) && results.length > 0) {
        useDetectionStore.getState().setResults(results);
      }
    });

    // Subscribe to live updates from the service worker
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.detection_results?.newValue) {
        useDetectionStore.getState().setResults(changes.detection_results.newValue);
      }
    });
  } catch {
    // Not in Chrome context (tests)
  }
}
