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
 * - Maximum line count: 10,000 lines per document
 */

// Security limits to prevent excessive memory/CPU usage in LCS
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LINE_COUNT = 10000; // 10k lines

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

	// Security: Validate line counts
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

		// If both made changes at the same location
		if (localChange && remoteChange && localChange.baseStart === remoteChange.baseStart) {
			// Check if changes are identical
			if (arraysEqual(localChange.newLines, remoteChange.newLines)) {
				// Same change, accept it
				merged.push(...localChange.newLines);
				localIndex++;
				remoteIndex++;
				baseIndex = Math.max(localChange.baseEnd, baseIndex);
			} else {
				// Different changes at same location = conflict
				conflicts.push({
					base: base.slice(localChange.baseStart, localChange.baseEnd),
					local: localChange.newLines,
					remote: remoteChange.newLines,
					startLine: merged.length,
				});

				localIndex++;
				remoteIndex++;
				baseIndex = Math.max(localChange.baseEnd, baseIndex);
			}
		} else if (localChange && (!remoteChange || localChange.baseStart < remoteChange.baseStart)) {
			// Only local changed at this location
			while (baseIndex < localChange.baseStart) {
				merged.push(base[baseIndex]);
				baseIndex++;
			}
			merged.push(...localChange.newLines);
			baseIndex = localChange.baseEnd;
			localIndex++;
		} else if (remoteChange && (!localChange || remoteChange.baseStart < localChange.baseStart)) {
			// Only remote changed at this location
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

	// If conflicts were detected, return early
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
