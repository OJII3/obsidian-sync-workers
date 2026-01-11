import { Elysia } from 'elysia';
import { env } from 'cloudflare:workers';
import { Env, ChangesResponse } from './types';
import { Database } from './db/queries';
import { generateRevision } from './utils/revision';
import type { DocumentInput, BulkDocsRequest } from './types';

const app = new Elysia({ aot: false })
  // CORS middleware
  .onRequest(({ set }) => {
    set.headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
  })
  // Handle OPTIONS requests for CORS preflight
  .options('/*', () => {
    return new Response(null, { status: 204 });
  })
  // Health check endpoint
  .get('/', () => ({
    name: 'Obsidian Sync Workers',
    version: '0.1.0',
    status: 'ok',
  }))
  // Changes feed routes
  .group('/api/changes', (app) =>
    app
      .get('/', async ({ query }) => {
        const since = parseInt(query.since || '0', 10);
        const limit = parseInt(query.limit || '100', 10);
        const vaultId = query.vault_id || 'default';

        // Validate parameters
        if (isNaN(since) || since < 0) {
          return {
            error: 'Invalid since parameter',
            status: 400,
          };
        }

        if (isNaN(limit) || limit < 1 || limit > 1000) {
          return {
            error: 'Invalid limit parameter (1-1000)',
            status: 400,
          };
        }

        const db = new Database(env.DB);
        const { changes: changesList, lastSeq } = await db.getChanges(
          vaultId,
          since,
          limit
        );

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

        return response;
      })
      .get('/continuous', () => ({
        error: 'Not implemented',
        message: 'Continuous changes feed requires WebSocket support',
        status: 501,
      }))
  )
  // Document routes
  .group('/api/docs', (app) =>
    app
      // Get a single document
      .get('/:id', async ({ params, query, set }) => {
        const id = params.id;
        const vaultId = query.vault_id || 'default';

        const db = new Database(env.DB);
        const doc = await db.getDocument(id, vaultId);

        if (!doc) {
          set.status = 404;
          return { error: 'Document not found' };
        }

        // Return in CouchDB-like format
        return {
          _id: doc.id,
          _rev: doc.rev,
          content: doc.content,
          _deleted: doc.deleted === 1,
        };
      })
      // Create or update a document
      .put('/:id', async ({ params, query, body, set }) => {
        const id = params.id;
        const vaultId = query.vault_id || 'default';
        const input = body as DocumentInput;

        const db = new Database(env.DB);
        const existing = await db.getDocument(id, vaultId);

        // Generate new revision
        let newRev: string;

        if (existing) {
          // Check for conflicts
          if (input._rev && input._rev !== existing.rev) {
            set.status = 409;
            return {
              error: 'Document update conflict',
              reason: 'Revision mismatch',
              current_rev: existing.rev,
              provided_rev: input._rev,
            };
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

        return {
          ok: true,
          id,
          rev: newRev,
        };
      })
      // Delete a document
      .delete('/:id', async ({ params, query, set }) => {
        const id = params.id;
        const vaultId = query.vault_id || 'default';
        const rev = query.rev;

        if (!rev) {
          set.status = 400;
          return { error: 'Revision required for deletion' };
        }

        const db = new Database(env.DB);
        const existing = await db.getDocument(id, vaultId);

        if (!existing) {
          set.status = 404;
          return { error: 'Document not found' };
        }

        if (existing.rev !== rev) {
          set.status = 409;
          return {
            error: 'Document deletion conflict',
            reason: 'Revision mismatch',
          };
        }

        const newRev = generateRevision(existing.rev);
        await db.deleteDocument(id, vaultId, newRev);

        return {
          ok: true,
          id,
          rev: newRev,
        };
      })
      // Bulk document operations
      .post('/bulk_docs', async ({ query, body }) => {
        const vaultId = query.vault_id || 'default';
        const request = body as BulkDocsRequest;

        if (!request.docs || !Array.isArray(request.docs)) {
          return { error: 'Invalid request: docs array required', status: 400 };
        }

        const db = new Database(env.DB);
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

        return results;
      })
  )
  // Alternative bulk docs path
  .post('/api/_bulk_docs', async ({ query, body }) => {
    const vaultId = query.vault_id || 'default';
    const request = body as BulkDocsRequest;

    if (!request.docs || !Array.isArray(request.docs)) {
      return { error: 'Invalid request: docs array required', status: 400 };
    }

    const db = new Database(env.DB);
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

    return results;
  })
  // Debug endpoint: list all documents
  .get('/api/debug/docs', async ({ query }) => {
    const vaultId = query.vault_id || 'default';
    const limit = parseInt(query.limit || '100', 10);

    const db = new Database(env.DB);
    const docs = await db.getAllDocuments(vaultId, limit);

    return {
      vault_id: vaultId,
      count: docs.length,
      documents: docs,
    };
  })
  // 404 handler
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }

    console.error('Error:', error);
    set.status = 500;
    return {
      error: 'Internal server error',
      message: error.message,
    };
  })
  .compile();

export default app;
