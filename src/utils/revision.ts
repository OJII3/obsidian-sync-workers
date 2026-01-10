/**
 * Generate a new revision string
 * Format: {generation}-{hash}
 * e.g., "1-abc123", "2-def456"
 */
export function generateRevision(previousRev?: string): string {
  const generation = previousRev ? parseInt(previousRev.split('-')[0]) + 1 : 1;
  const hash = generateHash();
  return `${generation}-${hash}`;
}

/**
 * Generate a simple hash for revision
 */
function generateHash(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return timestamp + random;
}

/**
 * Compare two revisions to determine which is newer
 * Returns true if rev1 is newer than rev2
 */
export function isNewerRevision(rev1: string, rev2: string): boolean {
  const gen1 = parseInt(rev1.split('-')[0]);
  const gen2 = parseInt(rev2.split('-')[0]);
  return gen1 > gen2;
}

/**
 * Validate revision format
 */
export function isValidRevision(rev: string): boolean {
  return /^\d+-[a-z0-9]+$/.test(rev);
}
