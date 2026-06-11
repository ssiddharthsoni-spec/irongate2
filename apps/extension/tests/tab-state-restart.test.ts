/**
 * WP4: MV3 worker-restart rehydration tests against the SHIPPED tab-state
 * module (worker/tab-state.ts) with an in-memory chrome.storage.session
 * mock. The audit found this path completely untested — the worker dies and
 * restarts constantly, and per-tab display truth must survive it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initTabStateStorage,
  loadTabStates,
  getTabState,
  updateTabState,
  removeTabState,
  TAB_STATE_KEY,
  type SessionStorageArea,
} from '../src/worker/tab-state';

// In-memory chrome.storage.session: survives "worker restarts" (module
// re-init) the same way the real one does — data persists, in-memory
// module state does not.
function makeSessionStorage(): SessionStorageArea & { dump(): Record<string, any> } {
  let data: Record<string, any> = {};
  return {
    async get(key: string) { return { [key]: structuredClone(data[key]) }; },
    async set(items: Record<string, any>) { Object.assign(data, structuredClone(items)); },
    dump: () => data,
  };
}

describe('tab-state restart rehydration (shipped module)', () => {
  let storage: ReturnType<typeof makeSessionStorage>;
  beforeEach(() => {
    storage = makeSessionStorage();
    initTabStateStorage(storage);
  });

  it('state written before a worker restart is readable after it', async () => {
    await updateTabState(7, {
      lastScore: 80, lastLevel: 'high',
      lastTurn: { epoch: 123, seq: 4 }, lastPhase: 'authoritative',
    });
    // Simulate MV3 worker restart: new module wiring, SAME storage.session.
    initTabStateStorage(storage);
    const restored = await getTabState(7);
    expect(restored?.lastScore).toBe(80);
    expect(restored?.lastTurn).toEqual({ epoch: 123, seq: 4 });
    expect(restored?.lastPhase).toBe('authoritative');
  });

  it('partial updates merge with persisted state across restarts', async () => {
    await updateTabState(7, { lastScore: 80, lastLevel: 'high', lastEntities: [{ type: 'SSN' }] });
    initTabStateStorage(storage); // restart
    await updateTabState(7, { preview: { score: 10, level: 'low', entityCount: 0, at: 99 } });
    const s = await getTabState(7);
    expect(s?.lastScore).toBe(80);          // earlier turn data intact
    expect(s?.preview?.score).toBe(10);      // new preview merged
  });

  it('per-tab isolation: updates to one tab never touch another', async () => {
    await updateTabState(1, { lastScore: 90 });
    await updateTabState(2, { lastScore: 5 });
    expect((await getTabState(1))?.lastScore).toBe(90);
    expect((await getTabState(2))?.lastScore).toBe(5);
  });

  it('removeTabState clears only the closed tab', async () => {
    await updateTabState(1, { lastScore: 90 });
    await updateTabState(2, { lastScore: 5 });
    await removeTabState(1);
    expect(await getTabState(1)).toBeNull();
    expect((await getTabState(2))?.lastScore).toBe(5);
  });

  it('prompts are truncated to the storage quota guard (2000 chars)', async () => {
    await updateTabState(3, { lastOriginalPrompt: 'x'.repeat(5000), lastMaskedPrompt: 'y'.repeat(5000) });
    const s = await getTabState(3);
    expect(s?.lastOriginalPrompt?.length).toBe(2000);
    expect(s?.lastMaskedPrompt?.length).toBe(2000);
  });

  it('unknown tab reads as null, never throws', async () => {
    expect(await getTabState(999)).toBeNull();
    expect(await loadTabStates()).toEqual({});
  });

  it('the storage key is the one the sidepanel listens for', () => {
    expect(TAB_STATE_KEY).toBe('iron_gate_tab_states');
  });
});
