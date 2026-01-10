import { Hono } from 'hono';
import { Env, ChangesResponse } from '../types';
import { Database } from '../db/queries';

const changes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/changes
 * Get changes feed for synchronization
 * Query parameters:
 * - since: Start from this sequence number (default: 0)
 * - limit: Maximum number of changes to return (default: 100)
 * - vault_id: Vault identifier (default: 'default')
 */
changes.get('/', async (c) => {
  const since = parseInt(c.req.query('since') || '0', 10);
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const vaultId = c.req.query('vault_id') || 'default';

  // Validate parameters
  if (isNaN(since) || since < 0) {
    return c.json({ error: 'Invalid since parameter' }, 400);
  }

  if (isNaN(limit) || limit < 1 || limit > 1000) {
    return c.json({ error: 'Invalid limit parameter (1-1000)' }, 400);
  }

  const db = new Database(c.env.DB);
  const { changes: changesList, lastSeq } = await db.getChanges(vaultId, since, limit);

  // Format response in CouchDB-like format
  const response: ChangesResponse = {
    results: changesList.map((change) => ({
      seq: change.seq,
      id: change.doc_id,
      changes: [{ rev: change.rev }],
      deleted: change.deleted === 1 ? true : undefined,
    })),
    last_seq: lastSeq,
  };

  return c.json(response);
});

/**
 * GET /api/changes/continuous
 * Placeholder for continuous changes feed (WebSocket in future)
 */
changes.get('/continuous', async (c) => {
  return c.json(
    {
      error: 'Not implemented',
      message: 'Continuous changes feed requires WebSocket support',
    },
    501
  );
});

export default changes;
