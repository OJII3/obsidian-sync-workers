import { type App, MarkdownView, TFile, type Vault } from "obsidian";

export async function updateFileContent(
	app: App,
	vault: Vault,
	file: TFile,
	content: string,
): Promise<void> {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView?.file?.path === file.path) {
		activeView.editor.setValue(content);
		return;
	}

	await vault.process(file, () => content);
}

/**
 * Get the actual file modification time.
 * Returns the maximum of disk mtime and in-memory TFile.stat.mtime to handle:
 * - Normal writes via vault.process(): both values are in sync
 * - Editor writes via editor.setValue(): TFile.stat is updated immediately,
 *   but disk may not be flushed yet (adapter.stat returns stale value)
 *
 * This should be called after any file write operation to get the
 * accurate mtime for metadata tracking.
 */
export async function getFileMtime(vault: Vault, path: string): Promise<number> {
	let diskMtime = 0;
	let memoryMtime = 0;

	// Get disk mtime via adapter.stat
	try {
		const stat = await vault.adapter.stat(path);
		if (stat) {
			diskMtime = stat.mtime;
		}
	} catch {
		// Ignore errors, will use memory mtime
	}

	// Get in-memory mtime from TFile (may be newer for unsaved editor changes)
	const file = vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		memoryMtime = file.stat.mtime;
	}

	// Return the maximum to handle editor writes that haven't flushed to disk
	if (diskMtime > 0 || memoryMtime > 0) {
		return Math.max(diskMtime, memoryMtime);
	}

	// Last resort fallback to current time (shouldn't happen)
	return Date.now();
}

export function pathToDocId(path: string): string {
	// Convert file path to document ID
	// Remove .md extension and use forward slashes
	return path.replace(/\.md$/, "").replace(/\\/g, "/");
}

export function docIdToPath(docId: string): string {
	// Convert document ID to file path
	// Add .md extension
	return `${docId}.md`;
}
