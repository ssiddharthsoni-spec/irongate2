/**
 * Shadow AI Tracker
 *
 * Tracks AI tool usage on personal/unknown accounts ("shadow AI").
 * When a user is NOT on a corporate SSO account, full enforcement is relaxed
 * to warning-only. This module logs those shadow AI events for compliance
 * reporting and admin visibility.
 *
 * Events are stored in chrome.storage.local with a rolling window cap
 * to prevent unbounded growth.
 */

export interface ShadowAIEvent {
  aiToolId: string;
  accountType: 'personal' | 'unknown';
  emailDomain?: string;
  timestamp: string; // ISO 8601
  action: 'warning_shown';
}

const STORAGE_KEY = '__ig_shadow_ai_events';
const MAX_EVENTS = 500;

/**
 * Record a shadow AI event.
 * Called when a user on a personal/unknown account interacts with an AI tool
 * and a warning banner is shown instead of full enforcement.
 */
export async function trackShadowAI(event: ShadowAIEvent): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let events: ShadowAIEvent[] = Array.isArray(result[STORAGE_KEY])
      ? result[STORAGE_KEY]
      : [];

    events.push(event);

    // Rolling window: keep only the most recent MAX_EVENTS
    if (events.length > MAX_EVENTS) {
      events = events.slice(events.length - MAX_EVENTS);
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: events });
  } catch {
    // Non-critical — don't let tracking break the main flow
  }
}

/**
 * Get aggregated shadow AI usage statistics.
 * Returns total event count and a breakdown by AI tool.
 */
export async function getShadowAIStats(): Promise<{
  total: number;
  byTool: Record<string, number>;
  byAccountType: Record<string, number>;
  recentEvents: ShadowAIEvent[];
}> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const events: ShadowAIEvent[] = Array.isArray(result[STORAGE_KEY])
      ? result[STORAGE_KEY]
      : [];

    const byTool: Record<string, number> = {};
    const byAccountType: Record<string, number> = {};

    for (const event of events) {
      byTool[event.aiToolId] = (byTool[event.aiToolId] || 0) + 1;
      byAccountType[event.accountType] = (byAccountType[event.accountType] || 0) + 1;
    }

    // Return only the 20 most recent events for the sidepanel display
    const recentEvents = events.slice(-20);

    return {
      total: events.length,
      byTool,
      byAccountType,
      recentEvents,
    };
  } catch {
    return { total: 0, byTool: {}, byAccountType: {}, recentEvents: [] };
  }
}

/**
 * Clear all shadow AI event data.
 */
export async function clearShadowAIEvents(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
