/**
 * Three-way merge utility for automatic conflict resolution
 *
 * This implements a line-based three-way merge algorithm:
 * - Base: The common ancestor version
 * - Local: The current server version
 * - Remote: The incoming client version
 */

export interface MergeResult {
  success: boolean;
  content?: string;
  conflicts?: ConflictRegion[];
}

export interface ConflictRegion {
  base: string[];
  local: string[];
  remote: string[];
  startLine: number;
}

/**
 * Perform a three-way merge on text content
 * @param base - The common ancestor content
 * @param local - The current server content
 * @param remote - The incoming client content
 * @returns MergeResult with success flag and merged content or conflicts
 */
export function threeWayMerge(
  base: string,
  local: string,
  remote: string
): MergeResult {
  // Split content into lines
  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  // If local and remote are identical, no conflict
  if (local === remote) {
    return {
      success: true,
      content: local,
    };
  }

  // If local hasn't changed, accept remote
  if (local === base) {
    return {
      success: true,
      content: remote,
    };
  }

  // If remote hasn't changed, keep local
  if (remote === base) {
    return {
      success: true,
      content: local,
    };
  }

  // Perform line-based merge
  const result = mergeLines(baseLines, localLines, remoteLines);

  return result;
}

/**
 * Merge lines using a simple diff-based algorithm
 */
function mergeLines(
  base: string[],
  local: string[],
  remote: string[]
): MergeResult {
  const localDiff = computeDiff(base, local);
  const remoteDiff = computeDiff(base, remote);

  // Try to apply both diffs
  const conflicts: ConflictRegion[] = [];
  const merged: string[] = [];

  let baseIndex = 0;
  let localIndex = 0;
  let remoteIndex = 0;

  while (baseIndex < base.length || localIndex < localDiff.changes.length || remoteIndex < remoteDiff.changes.length) {
    const localChange = localDiff.changes[localIndex];
    const remoteChange = remoteDiff.changes[remoteIndex];

    // If both made changes at the same location, it's a conflict
    if (localChange && remoteChange &&
        localChange.baseStart === remoteChange.baseStart) {

      // Check if changes are identical
      if (arraysEqual(localChange.newLines, remoteChange.newLines)) {
        // Same change, accept it
        merged.push(...localChange.newLines);
        localIndex++;
        remoteIndex++;
        baseIndex = Math.max(localChange.baseEnd, baseIndex);
      } else {
        // Different changes, record conflict
        conflicts.push({
          base: base.slice(localChange.baseStart, localChange.baseEnd),
          local: localChange.newLines,
          remote: remoteChange.newLines,
          startLine: merged.length,
        });

        // For now, prefer local in automatic merge
        merged.push(...localChange.newLines);
        localIndex++;
        remoteIndex++;
        baseIndex = Math.max(localChange.baseEnd, baseIndex);
      }
    } else if (localChange && (!remoteChange || localChange.baseStart < remoteChange.baseStart)) {
      // Only local changed
      // Copy unchanged lines before the change
      while (baseIndex < localChange.baseStart) {
        merged.push(base[baseIndex]);
        baseIndex++;
      }
      // Apply local change
      merged.push(...localChange.newLines);
      baseIndex = localChange.baseEnd;
      localIndex++;
    } else if (remoteChange && (!localChange || remoteChange.baseStart < localChange.baseStart)) {
      // Only remote changed
      // Copy unchanged lines before the change
      while (baseIndex < remoteChange.baseStart) {
        merged.push(base[baseIndex]);
        baseIndex++;
      }
      // Apply remote change
      merged.push(...remoteChange.newLines);
      baseIndex = remoteChange.baseEnd;
      remoteIndex++;
    } else {
      // No more changes, copy remaining base
      if (baseIndex < base.length) {
        merged.push(base[baseIndex]);
        baseIndex++;
      } else {
        break;
      }
    }
  }

  // Copy any remaining lines from base
  while (baseIndex < base.length) {
    merged.push(base[baseIndex]);
    baseIndex++;
  }

  if (conflicts.length > 0) {
    return {
      success: false,
      conflicts,
    };
  }

  return {
    success: true,
    content: merged.join('\n'),
  };
}

interface DiffChange {
  baseStart: number;
  baseEnd: number;
  newLines: string[];
}

interface Diff {
  changes: DiffChange[];
}

/**
 * Compute a simple diff between two arrays of lines
 */
function computeDiff(base: string[], modified: string[]): Diff {
  const changes: DiffChange[] = [];

  // Use a simple longest common subsequence approach
  const lcs = longestCommonSubsequence(base, modified);

  let baseIndex = 0;
  let modifiedIndex = 0;
  let lcsIndex = 0;

  while (baseIndex < base.length || modifiedIndex < modified.length) {
    const lcsLine = lcs[lcsIndex];

    // Skip to next common line
    const baseStart = baseIndex;
    while (baseIndex < base.length && (lcsLine === undefined || base[baseIndex] !== lcsLine)) {
      baseIndex++;
    }

    const newLines: string[] = [];
    while (modifiedIndex < modified.length && (lcsLine === undefined || modified[modifiedIndex] !== lcsLine)) {
      newLines.push(modified[modifiedIndex]);
      modifiedIndex++;
    }

    if (baseIndex > baseStart || newLines.length > 0) {
      changes.push({
        baseStart,
        baseEnd: baseIndex,
        newLines,
      });
    }

    if (lcsLine !== undefined) {
      baseIndex++;
      modifiedIndex++;
      lcsIndex++;
    }
  }

  return { changes };
}

/**
 * Find longest common subsequence of two arrays
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  // Build LCS table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}
