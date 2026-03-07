/**
 * Data Provenance Graph Service
 *
 * Builds a provenance graph tracking how sensitive data flows through
 * the system: clipboard source -> AI tools -> actions taken.
 *
 * Queries the events table's JSONB `entities` column to find all events
 * containing a given entity hash, then constructs a directed graph of
 * nodes (entities, AI tools, actions, sources) and edges (relationships).
 */

import { db } from '../db/client';
import { events } from '../db/schema';
import { sql, eq, and, desc } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvenanceNode {
  id: string;
  type: 'entity' | 'ai_tool' | 'action' | 'source';
  label: string;
  metadata: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
}

export interface ProvenanceEdge {
  source: string;  // node id
  target: string;  // node id
  relationship: 'detected_in' | 'sent_to' | 'blocked_by' | 'pseudonymized_by' | 'captured_from';
  weight: number;  // how many times this edge appeared
  firstSeen: string;
  lastSeen: string;
}

export interface ProvenanceGraph {
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
  entityHash: string;
  firmId: string;
  generatedAt: string;
}

export interface EntityLineage {
  sources: string[];
  tools: string[];
  actions: string[];
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic node id from type + label */
function nodeId(type: ProvenanceNode['type'], label: string): string {
  return `${type}::${label}`;
}

function upsertNode(
  nodeMap: Map<string, ProvenanceNode>,
  type: ProvenanceNode['type'],
  label: string,
  metadata: Record<string, unknown>,
  timestamp: string,
): string {
  const id = nodeId(type, label);
  const existing = nodeMap.get(id);
  if (existing) {
    if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
    if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
    // Merge metadata (keep latest values)
    Object.assign(existing.metadata, metadata);
  } else {
    nodeMap.set(id, {
      id,
      type,
      label,
      metadata,
      firstSeen: timestamp,
      lastSeen: timestamp,
    });
  }
  return id;
}

function upsertEdge(
  edgeMap: Map<string, ProvenanceEdge>,
  source: string,
  target: string,
  relationship: ProvenanceEdge['relationship'],
  timestamp: string,
): void {
  const key = `${source}->${target}::${relationship}`;
  const existing = edgeMap.get(key);
  if (existing) {
    existing.weight++;
    if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
    if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
  } else {
    edgeMap.set(key, {
      source,
      target,
      relationship,
      weight: 1,
      firstSeen: timestamp,
      lastSeen: timestamp,
    });
  }
}

// ---------------------------------------------------------------------------
// Entity type for the JSONB structure stored in events.entities
// ---------------------------------------------------------------------------

interface StoredEntity {
  type: string;
  textHash: string;
  length: number;
  start: number;
  end: number;
  confidence: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Core query — find all events containing a specific entity hash
// ---------------------------------------------------------------------------

async function queryEventsForEntity(entityHash: string, firmId: string) {
  // Use JSONB containment: check if any element in the entities array
  // has a matching textHash. The @> operator checks array containment.
  const rows = await db
    .select({
      id: events.id,
      aiToolId: events.aiToolId,
      aiToolUrl: events.aiToolUrl,
      action: events.action,
      captureMethod: events.captureMethod,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      entities: events.entities,
      metadata: events.metadata,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(
      and(
        eq(events.firmId, firmId),
        sql`${events.entities}::jsonb @> ${JSON.stringify([{ textHash: entityHash }])}::jsonb`,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(1000); // safety cap

  return rows;
}

// ---------------------------------------------------------------------------
// buildProvenanceGraph
// ---------------------------------------------------------------------------

export async function buildProvenanceGraph(
  entityHash: string,
  firmId: string,
): Promise<ProvenanceGraph> {
  const rows = await queryEventsForEntity(entityHash, firmId);

  const nodeMap = new Map<string, ProvenanceNode>();
  const edgeMap = new Map<string, ProvenanceEdge>();

  // Create the primary entity node
  const entityNodeId = upsertNode(
    nodeMap,
    'entity',
    entityHash,
    { occurrences: rows.length },
    rows.length > 0
      ? rows[rows.length - 1].createdAt.toISOString()
      : new Date().toISOString(),
  );

  for (const row of rows) {
    const ts = row.createdAt.toISOString();

    // -- Source node (capture method) --
    const sourceId = upsertNode(nodeMap, 'source', row.captureMethod, {}, ts);
    upsertEdge(edgeMap, sourceId, entityNodeId, 'captured_from', ts);

    // -- AI tool node --
    const toolId = upsertNode(nodeMap, 'ai_tool', row.aiToolId, {
      url: row.aiToolUrl,
    }, ts);
    upsertEdge(edgeMap, entityNodeId, toolId, 'sent_to', ts);

    // -- Action node --
    const actionId = upsertNode(nodeMap, 'action', row.action, {}, ts);

    // Map action type to the appropriate edge relationship
    const actionRelationship: ProvenanceEdge['relationship'] =
      row.action === 'block' ? 'blocked_by' :
      row.action === 'proxy' ? 'pseudonymized_by' :
      'detected_in';

    upsertEdge(edgeMap, toolId, actionId, actionRelationship, ts);

    // -- Co-occurring entities in the same event --
    const entitiesArray = (row.entities as StoredEntity[]) || [];
    for (const ent of entitiesArray) {
      if (ent.textHash === entityHash) continue; // skip self
      const coEntityId = upsertNode(nodeMap, 'entity', ent.textHash, {
        entityType: ent.type,
        confidence: ent.confidence,
      }, ts);
      // Bidirectional co-occurrence — attach to the same tool
      upsertEdge(edgeMap, coEntityId, toolId, 'detected_in', ts);
    }
  }

  // Update the primary entity node occurrence count
  const primaryNode = nodeMap.get(entityNodeId);
  if (primaryNode) {
    primaryNode.metadata.occurrences = rows.length;
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    entityHash,
    firmId,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getEntityLineage — simplified lineage summary
// ---------------------------------------------------------------------------

export async function getEntityLineage(
  entityHash: string,
  firmId: string,
): Promise<EntityLineage> {
  const rows = await queryEventsForEntity(entityHash, firmId);

  if (rows.length === 0) {
    return {
      sources: [],
      tools: [],
      actions: [],
      firstSeen: '',
      lastSeen: '',
      occurrences: 0,
    };
  }

  const sources = new Set<string>();
  const tools = new Set<string>();
  const actions = new Set<string>();
  let firstSeen = rows[0].createdAt.toISOString();
  let lastSeen = rows[0].createdAt.toISOString();

  for (const row of rows) {
    const ts = row.createdAt.toISOString();
    sources.add(row.captureMethod);
    tools.add(row.aiToolId);
    actions.add(row.action);
    if (ts < firstSeen) firstSeen = ts;
    if (ts > lastSeen) lastSeen = ts;
  }

  return {
    sources: Array.from(sources),
    tools: Array.from(tools),
    actions: Array.from(actions),
    firstSeen,
    lastSeen,
    occurrences: rows.length,
  };
}
