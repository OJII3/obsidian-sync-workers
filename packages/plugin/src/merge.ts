/**
 * Three-way merge utility for client-side conflict resolution
 *
 * This implements a line-based three-way merge algorithm:
 * - Base: The last synced version (stored in baseContent)
 * - Local: The current local version
 * - Remote: The version from the server
 *
 * Security limits:
 * - Maximum content size: 10MB per document
 * - Maximum line count: 2,000 lines per document
 *   (LCS has O(m*n) complexity; 2000^2 = 4M cells is acceptable)
 */

import type { ConflictRegion } from "./types";

// Security limits to prevent excessive memory/CPU usage in LCS
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
// LCS algorithm uses O(m*n) memory. With 2000 lines max, worst case is 4M cells (~16MB).
// This is acceptable for modern devices while preventing DoS attacks.
const MAX_LINE_COUNT = 2000;

export interface MergeResult {
	success: boolean;
	content?: string;
	conflicts?: ConflictRegion[];
	error?: string;
}

/**
 * Perform a three-way merge on text content
 * @param base - The common ancestor content (last synced version)
 * @param local - The current local content
 * @param remote - The server content
 * @returns MergeResult with success flag and merged content or conflicts
 */
export function threeWayMerge(base: string, local: string, remote: string): MergeResult {
	// Security: Validate content sizes
	if (
		base.length > MAX_CONTENT_SIZE ||
		local.length > MAX_CONTENT_SIZE ||
		remote.length > MAX_CONTENT_SIZE
	) {
		return {
			success: false,
			error: `Content exceeds maximum size limit of ${MAX_CONTENT_SIZE / 1024 / 1024}MB`,
		};
	}

	// Split content into lines
	const baseLines = base.split("\n");
	const localLines = local.split("\n");
	const remoteLines = remote.split("\n");

	// Security: Validate line counts to prevent excessive LCS computation
	if (
		baseLines.length > MAX_LINE_COUNT ||
		localLines.length > MAX_LINE_COUNT ||
		remoteLines.length > MAX_LINE_COUNT
	) {
		return {
			success: false,
			error: `Content exceeds maximum line count of ${MAX_LINE_COUNT} lines`,
		};
	}

	// If local and remote are identical, no conflict
	if (local === remote) {
		return {
			success: true,
			content: local,
		};
	}

	// If local hasn't changed from base, accept remote
	if (local === base) {
		return {
			success: true,
			content: remote,
		};
	}

	// If remote hasn't changed from base, keep local
	if (remote === base) {
		return {
			success: true,
			content: local,
		};
	}

	// Perform line-based merge
	return mergeLines(baseLines, localLines, remoteLines);
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
 * Check if two diff ranges overlap
 */
function rangesOverlap(a: DiffChange, b: DiffChange): boolean {
	// Ranges overlap if one starts before the other ends
	return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd;
}

/**
 * Merge lines using a diff-based algorithm
 */
function mergeLines(base: string[], local: string[], remote: string[]): MergeResult {
	const localDiff = computeDiff(base, local);
	const remoteDiff = computeDiff(base, remote);

	const conflicts: ConflictRegion[] = [];
	const merged: string[] = [];

	let baseIndex = 0;
	let localIndex = 0;
	let remoteIndex = 0;

	while (
		baseIndex < base.length ||
		localIndex < localDiff.changes.length ||
		remoteIndex < remoteDiff.changes.length
	) {
		const localChange = localDiff.changes[localIndex];
		const remoteChange = remoteDiff.changes[remoteIndex];

		// Check if both have changes that overlap (conflict)
		if (localChange && remoteChange && rangesOverlap(localChange, remoteChange)) {
			// Flush base lines before the conflict region
			const conflictStart = Math.min(localChange.baseStart, remoteChange.baseStart);
			while (baseIndex < conflictStart) {
				merged.push(base[baseIndex]);
				baseIndex++;
			}

			// Check if changes are identical (same edit = no conflict)
			if (
				localChange.baseStart === remoteChange.baseStart &&
				localChange.baseEnd === remoteChange.baseEnd &&
				arraysEqual(localChange.newLines, remoteChange.newLines)
			) {
				// Same change, accept it
				merged.push(...localChange.newLines);
				baseIndex = localChange.baseEnd;
				localIndex++;
				remoteIndex++;
			} else {
				// Different overlapping changes = conflict
				const conflictEnd = Math.max(localChange.baseEnd, remoteChange.baseEnd);
				conflicts.push({
					base: base.slice(conflictStart, conflictEnd),
					local: localChange.newLines,
					remote: remoteChange.newLines,
					startLine: merged.length,
				});

				baseIndex = conflictEnd;
				localIndex++;
				remoteIndex++;
			}
		} else if (localChange && (!remoteChange || localChange.baseStart < remoteChange.baseStart)) {
			// Only local changed at this location
			// Flush base lines before the change
			while (baseIndex < localChange.baseStart) {
				merged.push(base[baseIndex]);
				baseIndex++;
			}
			merged.push(...localChange.newLines);
			baseIndex = localChange.baseEnd;
			localIndex++;
		} else if (remoteChange && (!localChange || remoteChange.baseStart < localChange.baseStart)) {
			// Only remote changed at this location
			// Flush base lines before the change
			while (baseIndex < remoteChange.baseStart) {
				merged.push(base[baseIndex]);
				baseIndex++;
			}
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

	// If conflicts were detected, return early without content
	if (conflicts.length > 0) {
		return {
			success: false,
			conflicts,
		};
	}

	// Copy any remaining lines from base
	while (baseIndex < base.length) {
		merged.push(base[baseIndex]);
		baseIndex++;
	}

	return {
		success: true,
		content: merged.join("\n"),
	};
}

/**
 * Compute a simple diff between two arrays of lines
 */
function computeDiff(base: string[], modified: string[]): Diff {
	const changes: DiffChange[] = [];
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
		while (
			modifiedIndex < modified.length &&
			(lcsLine === undefined || modified[modifiedIndex] !== lcsLine)
		) {
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
 * Find longest common subsequence of two arrays.
 * Uses standard DP algorithm with O(m*n) time and space complexity.
 * MAX_LINE_COUNT limits input size to keep memory usage reasonable.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;

	// Create DP table - worst case 2000x2000 = 4M cells = ~16MB
	const dp: number[][] = Array(m + 1)
		.fill(0)
		.map(() => Array(n + 1).fill(0));

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

/**
 * Compute a common base from two texts using their longest common subsequence.
 * This is useful when no saved base content is available - it allows merging
 * non-overlapping changes even without a historical base.
 *
 * @param local - The local content
 * @param remote - The remote content
 * @returns The LCS of local and remote as a string (to use as base for 3-way merge)
 */
export function computeCommonBase(local: string, remote: string): string {
	// Security: Validate content sizes
	if (local.length > MAX_CONTENT_SIZE || remote.length > MAX_CONTENT_SIZE) {
		// Return empty string as fallback - will likely result in conflict
		return "";
	}

	const localLines = local.split("\n");
	const remoteLines = remote.split("\n");

	// Security: Validate line counts
	if (localLines.length > MAX_LINE_COUNT || remoteLines.length > MAX_LINE_COUNT) {
		return "";
	}

	const lcs = longestCommonSubsequence(localLines, remoteLines);
	return lcs.join("\n");
}
