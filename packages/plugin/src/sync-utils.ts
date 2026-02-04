import { type App, MarkdownView, TFile, type Vault } from "obsidian";

export async function updateFileContent(
	app: App,
	vault: Vault,
	file: TFile,
	content: string,
): Promise<void> {
	// Defensive check: ensure content is a string
	if (content === null || content === undefined) {
		const valueType = content === null ? "null" : "undefined";
		throw new Error(`Cannot update file ${file.path}: content is ${valueType}`);
	}

	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView?.file?.path === file.path) {
		activeView.editor.setValue(content);
		return;
	}

	await vault.process(file, () => content);
}

/**
 * Get the file modification time from Obsidian's in-memory metadata.
 *
 * Note: Avoids direct adapter access to follow Obsidian plugin guidelines.
 */
export function getFileMtime(vault: Vault, path: string): number {
	const file = vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		return file.stat.mtime;
	}

	// Fallback to current time (shouldn't happen)
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
