/**
 * Conversation Tracker — Context Engine Layer 4
 * Tracks prompts within a session to detect escalation patterns
 * and maintain sensitivity context across conversation turns.
 */

import type { DetectedEntity } from './types';

interface ConversationTurn {
  text: string;
  entities: DetectedEntity[];
  score: number;
  timestamp: number;
}

export class ConversationTracker {
  private turns: ConversationTurn[] = [];
  private sessionId: string;
  private lastActivity: number;
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(sessionId?: string) {
    this.sessionId = sessionId || crypto.randomUUID();
    this.lastActivity = Date.now();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  addTurn(text: string, entities: DetectedEntity[], score: number): void {
    // Check session expiry
    if (Date.now() - this.lastActivity > this.SESSION_TIMEOUT) {
      this.reset();
    }

    this.turns.push({
      text,
      entities,
      score,
      timestamp: Date.now(),
    });

    this.lastActivity = Date.now();

    // Keep last 20 turns max
    if (this.turns.length > 20) {
      this.turns = this.turns.slice(-20);
    }
  }

  /**
   * Detect escalation patterns:
   * generic question -> specific question -> pasted document
   */
  detectEscalation(): number {
    if (this.turns.length < 2) return 0;

    const recent = this.turns.slice(-5);
    let escalation = 0;

    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];

      // Score increasing = escalation
      if (curr.score > prev.score + 10) {
        escalation += 5;
      }

      // Text length increasing dramatically = pasting documents
      if (curr.text.length > prev.text.length * 3 && curr.text.length > 500) {
        escalation += 10;
      }

      // New entity types appearing that weren't in previous turns
      const prevTypes = new Set(prev.entities.map((e) => e.type));
      const newTypes = curr.entities.filter((e) => !prevTypes.has(e.type));
      if (newTypes.length > 0) {
        escalation += newTypes.length * 2;
      }
    }

    return Math.min(15, escalation); // Cap at 15
  }

  /**
   * Get cumulative entity tracking.
   * Same entity appearing across 3+ prompts = elevated concern.
   */
  getCumulativeEntityBoost(): number {
    const entityOccurrences = new Map<string, number>();

    for (const turn of this.turns) {
      const seenInTurn = new Set<string>();
      for (const entity of turn.entities) {
        const key = `${entity.type}:${entity.text.toLowerCase()}`;
        if (!seenInTurn.has(key)) {
          seenInTurn.add(key);
          entityOccurrences.set(key, (entityOccurrences.get(key) || 0) + 1);
        }
      }
    }

    let boost = 0;
    for (const [, count] of entityOccurrences) {
      if (count >= 3) boost += 5;
      else if (count >= 2) boost += 2;
    }

    return Math.min(10, boost); // Cap at 10
  }

  /**
   * Context carryover: references to previous context
   * ("summarize section 4" inherits sensitivity from prior pasted contract)
   */
  getContextCarryover(): number {
    if (this.turns.length < 2) return 0;

    const currentTurn = this.turns[this.turns.length - 1];
    const lowerText = currentTurn.text.toLowerCase();

    // Short follow-up prompts that reference previous context
    const referencePatterns = [
      /\b(summarize|explain|expand|elaborate|continue|rewrite|rephrase)\b/,
      /\b(section|paragraph|part|above|previous|that|this)\b/,
      /\b(the document|the contract|the memo|the email|the agreement)\b/,
    ];

    const hasReference = referencePatterns.some((p) => p.test(lowerText));

    if (hasReference && currentTurn.text.length < 200) {
      // Short follow-up referencing previous context
      // Inherit the max score from recent turns
      const maxRecentScore = Math.max(...this.turns.slice(-5).map((t) => t.score));
      if (maxRecentScore > 40) {
        return Math.min(15, maxRecentScore * 0.3);
      }
    }

    return 0;
  }

  getTurnCount(): number {
    return this.turns.length;
  }

  reset(): void {
    this.turns = [];
    this.sessionId = crypto.randomUUID();
    this.lastActivity = Date.now();
  }
}
