/**
 * Three-way merge utility for automatic conflict resolution
 *
 * This implements a line-based three-way merge algorithm:
 * - Base: The common ancestor version
 * - Local: The current server version
 * - Remote: The incoming client version
 *
 * Security limits:
 * - Maximum content size: 10MB per document
 * - Maximum line count: 10,000 lines per document
 * - These limits prevent DoS attacks through excessive memory/CPU usage in LCS
 */

// Security limits to prevent DoS attacks
// LCS algorithm has O(m*n) complexity, so we must limit line counts
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LINE_COUNT = 10000; // 10k lines (prevents 100M element arrays in LCS)

export interface MergeResult {
	success: boolean;
	content?: string;
	conflicts?: ConflictRegion[];
	error?: string;
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
export function threeWayMerge(base: string, local: string, remote: string): MergeResult {
	// Security: Validate content sizes to prevent DoS attacks
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
function mergeLines(base: string[], local: string[], remote: string[]): MergeResult {
	const localDiff = computeDiff(base, local);
	const remoteDiff = computeDiff(base, remote);

	// Try to apply both diffs
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

		// If both made changes at the same location, it's a conflict
		if (localChange && remoteChange && localChange.baseStart === remoteChange.baseStart) {
			// Check if changes are identical
			if (arraysEqual(localChange.newLines, remoteChange.newLines)) {
				// Same change, accept it
				merged.push(...localChange.newLines);
				localIndex++;
				remoteIndex++;
				baseIndex = Math.max(localChange.baseEnd, baseIndex);
			} else {
				// Different changes, record conflict
				// Don't build merged content when conflicts exist
				conflicts.push({
					base: base.slice(localChange.baseStart, localChange.baseEnd),
					local: localChange.newLines,
					remote: remoteChange.newLines,
					startLine: merged.length,
				});

				// Skip ahead in both diffs
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

	// If conflicts were detected, return early
	// Don't waste resources building merged content that won't be used
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
 * Find longest common subsequence of two arrays
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;
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
