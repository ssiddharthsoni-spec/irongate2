/**
 * Provenance Graph Routes
 *
 * GET /v1/provenance/:entityHash        — full provenance graph for an entity
 * GET /v1/provenance/:entityHash/lineage — simplified lineage summary
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { buildProvenanceGraph, getEntityLineage } from '../services/provenance-graph';
import type { AppEnv } from '../types';
import { logger } from '../lib/logger';

export const provenanceRoutes = new Hono<AppEnv>();

// Validate entityHash is a 64-char hex string (SHA-256)
const entityHashSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'entityHash must be a valid SHA-256 hex string');

// GET /v1/provenance/:entityHash — full provenance graph
provenanceRoutes.get('/:entityHash', async (c) => {
  const entityHash = c.req.param('entityHash');
  const firmId = c.get('firmId');

  const parsed = entityHashSchema.safeParse(entityHash);
  if (!parsed.success) {
    return c.json({ error: 'Invalid entityHash — must be a 64-character hex string' }, 400);
  }

  try {
    const graph = await buildProvenanceGraph(parsed.data, firmId);
    return c.json(graph);
  } catch (err) {
    logger.error('Failed to build provenance graph', {
      entityHash,
      firmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Failed to build provenance graph' }, 500);
  }
});

// GET /v1/provenance/:entityHash/lineage — simplified lineage summary
provenanceRoutes.get('/:entityHash/lineage', async (c) => {
  const entityHash = c.req.param('entityHash');
  const firmId = c.get('firmId');

  const parsed = entityHashSchema.safeParse(entityHash);
  if (!parsed.success) {
    return c.json({ error: 'Invalid entityHash — must be a 64-character hex string' }, 400);
  }

  try {
    const lineage = await getEntityLineage(parsed.data, firmId);

    if (lineage.occurrences === 0) {
      return c.json({ error: 'Entity not found in any events' }, 404);
    }

    return c.json(lineage);
  } catch (err) {
    logger.error('Failed to get entity lineage', {
      entityHash,
      firmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Failed to get entity lineage' }, 500);
  }
});
