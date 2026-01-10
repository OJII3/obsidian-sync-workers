import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { requireAuth } from './utils/auth';
import documents from './routes/documents';
import changes from './routes/changes';
import { Database } from './db/queries';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Optional authentication middleware
// Uncomment to enable API key authentication
// app.use('/api/*', async (c, next) => {
//   const authResult = requireAuth(c);
//   if (authResult) return authResult;
//   await next();
// });

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Obsidian Sync Workers',
    version: '0.1.0',
    status: 'ok',
  });
});

// API routes
app.route('/api/docs', documents);
app.route('/api/changes', changes);

// Bulk docs endpoint (alternative path)
app.post('/api/_bulk_docs', async (c) => {
  // Redirect to the bulk_docs route in documents
  return documents.fetch(
    new Request(c.req.url.replace('/_bulk_docs', '/bulk_docs'), {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    }),
    c.env
  );
});

// Debug endpoint: list all documents
app.get('/api/debug/docs', async (c) => {
  const vaultId = c.req.query('vault_id') || 'default';
  const limit = parseInt(c.req.query('limit') || '100', 10);

  const db = new Database(c.env.DB);
  const docs = await db.getAllDocuments(vaultId, limit);

  return c.json({
    vault_id: vaultId,
    count: docs.length,
    documents: docs,
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json(
    {
      error: 'Internal server error',
      message: err.message,
    },
    500
  );
});

export default app;
