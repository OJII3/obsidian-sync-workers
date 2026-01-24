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
 * Get the actual file modification time from the file system.
 * Uses vault.adapter.stat() for on-disk accuracy instead of in-memory TFile.stat.
 * This should be called after any file write operation to get the
 * accurate mtime for metadata tracking.
 */
export async function getFileMtime(vault: Vault, path: string): Promise<number> {
	try {
		const stat = await vault.adapter.stat(path);
		if (stat) {
			return stat.mtime;
		}
	} catch {
		// Fall through to fallback
	}
	// Fallback to in-memory stat if adapter.stat fails
	const file = vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		return file.stat.mtime;
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
