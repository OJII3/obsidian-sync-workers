import { Context } from 'hono';
import { Env } from '../types';

/**
 * Simple API key authentication middleware
 * Checks for API key in Authorization header or query parameter
 */
export function requireAuth(c: Context<{ Bindings: Env }>): Response | void {
  const apiKey = c.env.API_KEY;

  // If no API key is configured, allow all requests
  if (!apiKey) {
    return;
  }

  // Check Authorization header
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    if (token === apiKey) {
      return;
    }
  }

  // Check query parameter
  const queryKey = c.req.query('api_key');
  if (queryKey === apiKey) {
    return;
  }

  return c.json({ error: 'Unauthorized' }, 401);
}
