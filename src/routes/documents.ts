import { Hono } from 'hono';
import { Env, DocumentInput, BulkDocsRequest } from '../types';
import { Database } from '../db/queries';
import { generateRevision, isNewerRevision } from '../utils/revision';

const documents = new Hono<{ Bindings: Env }>();

/**
 * GET /api/docs/:id
 * Get a single document by ID
 */
documents.get('/:id', async (c) => {
  const id = c.req.param('id');
  const vaultId = c.req.query('vault_id') || 'default';

  const db = new Database(c.env.DB);
  const doc = await db.getDocument(id, vaultId);

  if (!doc) {
    return c.json({ error: 'Document not found' }, 404);
  }

  // Return in CouchDB-like format
  return c.json({
    _id: doc.id,
    _rev: doc.rev,
    content: doc.content,
    _deleted: doc.deleted === 1,
  });
});

/**
 * PUT /api/docs/:id
 * Create or update a document
 */
documents.put('/:id', async (c) => {
  const id = c.req.param('id');
  const vaultId = c.req.query('vault_id') || 'default';

  let input: DocumentInput;
  try {
    input = await c.req.json<DocumentInput>();
  } catch (e) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const db = new Database(c.env.DB);
  const existing = await db.getDocument(id, vaultId);

  // Generate new revision
  let newRev: string;

  if (existing) {
    // Check for conflicts
    if (input._rev && input._rev !== existing.rev) {
      return c.json(
        {
          error: 'Document update conflict',
          reason: 'Revision mismatch',
          current_rev: existing.rev,
          provided_rev: input._rev,
        },
        409
      );
    }

    newRev = generateRevision(existing.rev);
  } else {
    newRev = generateRevision();
  }

  // Upsert document
  await db.upsertDocument({
    id,
    vaultId,
    content: input.content || null,
    rev: newRev,
    deleted: input._deleted ? 1 : 0,
  });

  return c.json({
    ok: true,
    id,
    rev: newRev,
  });
});

/**
 * DELETE /api/docs/:id
 * Delete a document (soft delete)
 */
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const vaultId = c.req.query('vault_id') || 'default';
  const rev = c.req.query('rev');

  if (!rev) {
    return c.json({ error: 'Revision required for deletion' }, 400);
  }

  const db = new Database(c.env.DB);
  const existing = await db.getDocument(id, vaultId);

  if (!existing) {
    return c.json({ error: 'Document not found' }, 404);
  }

  if (existing.rev !== rev) {
    return c.json(
      {
        error: 'Document deletion conflict',
        reason: 'Revision mismatch',
      },
      409
    );
  }

  const newRev = generateRevision(existing.rev);
  await db.deleteDocument(id, vaultId, newRev);

  return c.json({
    ok: true,
    id,
    rev: newRev,
  });
});

/**
 * POST /api/bulk_docs
 * Bulk document operations
 */
documents.post('/bulk_docs', async (c) => {
  const vaultId = c.req.query('vault_id') || 'default';

  let request: BulkDocsRequest;
  try {
    request = await c.req.json<BulkDocsRequest>();
  } catch (e) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!request.docs || !Array.isArray(request.docs)) {
    return c.json({ error: 'Invalid request: docs array required' }, 400);
  }

  const db = new Database(c.env.DB);
  const results = [];

  for (const doc of request.docs) {
    try {
      const existing = await db.getDocument(doc._id, vaultId);
      let newRev: string;

      if (existing) {
        // Check revision if provided
        if (doc._rev && doc._rev !== existing.rev) {
          results.push({
            id: doc._id,
            error: 'conflict',
            reason: 'Document update conflict',
          });
          continue;
        }
        newRev = generateRevision(existing.rev);
      } else {
        newRev = generateRevision();
      }

      await db.upsertDocument({
        id: doc._id,
        vaultId,
        content: doc.content || null,
        rev: newRev,
        deleted: doc._deleted ? 1 : 0,
      });

      results.push({
        ok: true,
        id: doc._id,
        rev: newRev,
      });
    } catch (e) {
      results.push({
        id: doc._id,
        error: 'internal_error',
        reason: (e as Error).message,
      });
    }
  }

  return c.json(results);
});

export default documents;
