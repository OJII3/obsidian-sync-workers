import { type App, MarkdownView, type TFile, type Vault } from "obsidian";

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
 * This should be called after any file write operation to get the
 * accurate mtime for metadata tracking.
 */
export function getFileMtime(vault: Vault, path: string): number {
	const file = vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		return file.stat.mtime;
	}
	// Fallback to current time if file not found (shouldn't happen)
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
