/**
 * Entity Dictionary — Tier 3 Detection (Aho-Corasick)
 *
 * Admin-configured per-firm entity lists matched via Aho-Corasick automaton.
 * Zero false positives (exact match), instant lookup (<1ms for 10k entries).
 *
 * Flow:
 *   1. Admin creates entities via API (name + aliases + category)
 *   2. Extension syncs dictionary via /v1/admin/entity-dictionary/export
 *   3. Automaton is built from all names + aliases
 *   4. On each prompt, search() returns all matches with positions
 */

import type { DetectedEntity } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DictionaryEntry {
  id: string;
  category: string; // 'person' | 'organization' | 'project' | 'client' | 'location' | 'custom'
  name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
}

export interface DictionaryMatch {
  text: string;
  start: number;
  end: number;
  category: string;
  entry: DictionaryEntry;
}

// ── Aho-Corasick Automaton ───────────────────────────────────────────────────

interface TrieNode {
  children: Map<string, TrieNode>;
  fail: TrieNode | null;
  outputs: Array<{ pattern: string; entry: DictionaryEntry }>;
}

function createNode(): TrieNode {
  return { children: new Map(), fail: null, outputs: [] };
}

/**
 * Build an Aho-Corasick automaton from dictionary entries.
 * All patterns are lowercased for case-insensitive matching.
 */
function buildAutomaton(entries: DictionaryEntry[]): TrieNode {
  const root = createNode();
  root.fail = root;

  // Phase 1: Build trie (goto function)
  for (const entry of entries) {
    const patterns = [entry.name, ...entry.aliases].filter(p => p.length >= 2);
    for (const pattern of patterns) {
      let node = root;
      const lower = pattern.toLowerCase();
      for (const ch of lower) {
        if (!node.children.has(ch)) {
          node.children.set(ch, createNode());
        }
        node = node.children.get(ch)!;
      }
      node.outputs.push({ pattern, entry });
    }
  }

  // Phase 2: Build failure links (BFS)
  const queue: TrieNode[] = [];

  // Depth-1 nodes fail to root
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const [ch, child] of current.children) {
      queue.push(child);

      // Follow failure links to find longest proper suffix
      let failNode = current.fail!;
      while (failNode !== root && !failNode.children.has(ch)) {
        failNode = failNode.fail!;
      }
      child.fail = failNode.children.get(ch) || root;
      if (child.fail === child) child.fail = root;

      // Merge outputs from failure chain
      if (child.fail.outputs.length > 0) {
        child.outputs = [...child.outputs, ...child.fail.outputs];
      }
    }
  }

  return root;
}

/**
 * Search text using the Aho-Corasick automaton.
 * Returns all matches with positions. Word-boundary aware.
 */
function searchAutomaton(root: TrieNode, text: string): DictionaryMatch[] {
  const matches: DictionaryMatch[] = [];
  const lower = text.toLowerCase();
  let node = root;

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];

    while (node !== root && !node.children.has(ch)) {
      node = node.fail!;
    }
    node = node.children.get(ch) || root;

    // Check outputs at this position
    for (const output of node.outputs) {
      const patternLen = output.pattern.length;
      const start = i - patternLen + 1;
      const end = i + 1;

      // Word boundary check: ensure we're not matching inside a larger word
      const charBefore = start > 0 ? lower[start - 1] : ' ';
      const charAfter = end < lower.length ? lower[end] : ' ';

      if (isWordBoundary(charBefore) && isWordBoundary(charAfter)) {
        matches.push({
          text: text.substring(start, end), // preserve original casing
          start,
          end,
          category: output.entry.category,
          entry: output.entry,
        });
      }
    }
  }

  return deduplicateMatches(matches);
}

function isWordBoundary(ch: string): boolean {
  // Allow boundaries at: whitespace, punctuation, start/end
  return !/[a-zA-Z0-9]/.test(ch);
}

/**
 * Remove duplicate/overlapping matches. Prefer longer matches.
 */
function deduplicateMatches(matches: DictionaryMatch[]): DictionaryMatch[] {
  if (matches.length <= 1) return matches;

  // Sort by start position, then by length (longer first)
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const result: DictionaryMatch[] = [];
  let lastEnd = -1;

  for (const match of matches) {
    if (match.start >= lastEnd) {
      result.push(match);
      lastEnd = match.end;
    }
    // If overlapping but longer, replace
    else if (match.end > lastEnd && result.length > 0) {
      const prev = result[result.length - 1];
      if ((match.end - match.start) > (prev.end - prev.start)) {
        result[result.length - 1] = match;
        lastEnd = match.end;
      }
    }
  }

  return result;
}

// ── Category → Entity Type Mapping ──────────────────────────────────────────

const CATEGORY_TO_TYPE: Record<string, string> = {
  person: 'PERSON',
  organization: 'ORGANIZATION',
  project: 'PROJECT_NAME',
  client: 'ORGANIZATION',
  location: 'LOCATION',
  custom: 'CUSTOM_ENTITY',
};

// ── Dictionary Matcher Factory ──────────────────────────────────────────────

export interface DictionaryMatcher {
  /** Search text for dictionary matches */
  search(text: string): DictionaryMatch[];
  /** Convert matches to DetectedEntity format */
  toDetectedEntities(matches: DictionaryMatch[]): DetectedEntity[];
  /** Reload automaton with new dictionary entries */
  reload(entries: DictionaryEntry[]): void;
  /** Whether the dictionary has been loaded */
  isLoaded(): boolean;
  /** Number of patterns in the automaton */
  patternCount(): number;
}

export function createDictionaryMatcher(): DictionaryMatcher {
  let automaton: TrieNode | null = null;
  let loaded = false;
  let count = 0;

  return {
    search(text: string): DictionaryMatch[] {
      if (!automaton) return [];
      return searchAutomaton(automaton, text);
    },

    toDetectedEntities(matches: DictionaryMatch[]): DetectedEntity[] {
      return matches.map(m => ({
        type: CATEGORY_TO_TYPE[m.category] || 'CUSTOM_ENTITY',
        text: m.text,
        start: m.start,
        end: m.end,
        confidence: 0.99, // Dictionary matches are near-certain
        source: 'dictionary' as const,
      }));
    },

    reload(entries: DictionaryEntry[]): void {
      // Copy-on-write: build new automaton, then atomically swap reference.
      // Prevents race condition if search() reads during rebuild.
      const newAutomaton = buildAutomaton(entries);
      const newCount = entries.reduce((sum, e) => sum + 1 + e.aliases.length, 0);
      automaton = newAutomaton;
      count = newCount;
      loaded = true;
      console.log(`[Iron Gate] Dictionary loaded: ${entries.length} entries, ${count} patterns`);
    },

    isLoaded(): boolean {
      return loaded;
    },

    patternCount(): number {
      return count;
    },
  };
}
