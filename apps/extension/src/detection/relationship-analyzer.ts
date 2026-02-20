/**
 * Relationship Analyzer — Context Engine Layer 2
 * Detects co-occurrence of entities and relationships between them.
 * Related entities scored as groups, not individually.
 */

import type { DetectedEntity } from './types';

export interface EntityRelationship {
  entity1: DetectedEntity;
  entity2: DetectedEntity;
  relationshipType: 'person_org' | 'org_org' | 'possessive' | 'proximity';
  strength: number; // 0-1
}

const PROXIMITY_THRESHOLD = 100; // characters

export function analyzeRelationships(
  text: string,
  entities: DetectedEntity[]
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const e1 = entities[i];
      const e2 = entities[j];

      // Check proximity
      const distance = Math.abs(e1.start - e2.end);
      if (distance > PROXIMITY_THRESHOLD * 2) continue;

      const textBetween = text.substring(
        Math.min(e1.end, e2.end),
        Math.max(e1.start, e2.start)
      ).toLowerCase();

      // PERSON + ORGANIZATION ("John Smith at Acme Corp")
      if (
        (e1.type === 'PERSON' && e2.type === 'ORGANIZATION') ||
        (e1.type === 'ORGANIZATION' && e2.type === 'PERSON')
      ) {
        if (/\b(at|of|from|with)\b/.test(textBetween) || distance < 50) {
          relationships.push({
            entity1: e1,
            entity2: e2,
            relationshipType: 'person_org',
            strength: distance < 30 ? 0.9 : 0.7,
          });
        }
      }

      // ORG + ORG ("merger between X and Y")
      if (e1.type === 'ORGANIZATION' && e2.type === 'ORGANIZATION') {
        if (/\b(merger|acquisition|deal|transaction|agreement|between|and)\b/.test(textBetween)) {
          relationships.push({
            entity1: e1,
            entity2: e2,
            relationshipType: 'org_org',
            strength: 0.85,
          });
        }
      }

      // Possessive relationships ("Acme's revenue")
      if (textBetween.includes("'s") || textBetween.includes("' ")) {
        relationships.push({
          entity1: e1,
          entity2: e2,
          relationshipType: 'possessive',
          strength: 0.75,
        });
      }

      // General proximity
      if (distance < PROXIMITY_THRESHOLD && relationships.length === 0) {
        relationships.push({
          entity1: e1,
          entity2: e2,
          relationshipType: 'proximity',
          strength: 1 - distance / PROXIMITY_THRESHOLD,
        });
      }
    }
  }

  return relationships;
}

/**
 * Compute a relationship-based score boost.
 * Groups of related entities are more sensitive than isolated ones.
 */
export function computeRelationshipBoost(relationships: EntityRelationship[]): number {
  if (relationships.length === 0) return 0;

  let boost = 0;

  for (const rel of relationships) {
    switch (rel.relationshipType) {
      case 'person_org':
        boost += 10 * rel.strength;
        break;
      case 'org_org':
        boost += 15 * rel.strength; // Deal-related = high sensitivity
        break;
      case 'possessive':
        boost += 8 * rel.strength;
        break;
      case 'proximity':
        boost += 3 * rel.strength;
        break;
    }
  }

  return Math.min(20, boost); // Cap at 20
}
