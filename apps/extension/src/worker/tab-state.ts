/**
 * Per-tab display state — the single source of truth the sidepanel renders.
 *
 * WP4 extraction from worker/index.ts (same pattern as the main-world
 * extractions): the storage area is injected so unit tests can exercise the
 * SHIPPED persistence + restart-rehydration logic against an in-memory
 * chrome.storage mock. The worker passes chrome.storage.session.
 */

export interface TabState {
  tabId: number;
  aiToolId: string;
  aiToolName: string;
  lastScore: number | null;
  lastLevel: string | null;
  lastExplanation: string | null;
  lastEntities: any[];
  lastPromptHash?: string;
  lastPromptLength?: number;
  lastOriginalPrompt?: string;
  lastMaskedPrompt?: string;
  lastPseudonymMappings?: any[];
  detectionCount: number;
  lastDetectionTime: number;
  // ── WP1 turn identity ──
  // Real turn id + phase of the displayed result. updateTabState gates
  // every display write through shouldReplaceDisplay(lastTurn/lastPhase),
  // so this stored state is ALWAYS the best-known truth for the tab and
  // the sidepanel renders it verbatim with zero arbitration of its own.
  lastTurn?: { epoch: number; seq: number } | null;
  lastPhase?: 'preview' | 'authoritative' | 'enrichment' | 'audit';
  // Live-typing feedback — a SEPARATE slot from the turn outcome. Written
  // freely while the user composes, cleared by each authoritative result
  // or PROMPT_CLEARED. Keeping it apart from the display fields is what
  // lets PROMPT_CLEARED work without a suppression window: clearing the
  // composing banner can never wipe the inspector again.
  preview?: { score: number; level: string; entityCount: number; at: number } | null;
  // PROMPT_TURN_INVALIDATED annotation: pseudonymization happened but the
  // request never reached the LLM. Cleared by the next accepted result.
  transportStatus?: 'blocked' | null;
  transportReason?: string | null;
  // WP2: selector death on a dom-presubmit platform — protection degraded.
  // Set by SELECTOR_FAILURE, cleared by the next accepted authoritative
  // result (evidence the interception pipeline works again).
  selectorFailure?: { adapterId: string; phase: string; at: number } | null;
}

export const TAB_STATE_KEY = 'iron_gate_tab_states';

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
}

let _storage: SessionStorageArea | null = null;

/** Worker calls this once at startup with chrome.storage.session. */
export function initTabStateStorage(storage: SessionStorageArea): void {
  _storage = storage;
}
const MAX_PROMPT_STORAGE = 2000; // Truncate prompts to avoid quota issues

export async function loadTabStates(): Promise<Record<number, TabState>> {
  try {
    const result = await _storage!.get(TAB_STATE_KEY);
    return result[TAB_STATE_KEY] || {};
  } catch (err) {
    console.warn('[Iron Gate] loadTabStates storage read failed:', err instanceof Error ? err.message : String(err));
    return {};
  }
}

export async function saveTabStates(states: Record<number, TabState>): Promise<void> {
  try {
    await _storage!.set({ [TAB_STATE_KEY]: states });
  } catch (err) {
    console.warn('[Iron Gate] Failed to save tab states:', err);
  }
}

export async function getTabState(tabId: number): Promise<TabState | null> {
  const states = await loadTabStates();
  return states[tabId] || null;
}

export async function updateTabState(tabId: number, update: Partial<TabState>): Promise<TabState> {
  const states = await loadTabStates();
  const existing = states[tabId] || {
    tabId,
    aiToolId: '',
    aiToolName: '',
    lastScore: null,
    lastLevel: null,
    lastExplanation: null,
    lastEntities: [],
    detectionCount: 0,
    lastDetectionTime: 0,
  };
  // Truncate prompts to stay within storage quota (lastPromptHash is always 64 chars, no truncation needed)
  if (update.lastOriginalPrompt && update.lastOriginalPrompt.length > MAX_PROMPT_STORAGE) {
    update.lastOriginalPrompt = update.lastOriginalPrompt.substring(0, MAX_PROMPT_STORAGE);
  }
  if (update.lastMaskedPrompt && update.lastMaskedPrompt.length > MAX_PROMPT_STORAGE) {
    update.lastMaskedPrompt = update.lastMaskedPrompt.substring(0, MAX_PROMPT_STORAGE);
  }
  states[tabId] = { ...existing, ...update };
  await saveTabStates(states);
  return states[tabId];
}

export async function removeTabState(tabId: number): Promise<void> {
  const states = await loadTabStates();
  delete states[tabId];
  await saveTabStates(states);
}
