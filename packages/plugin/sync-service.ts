import { Notice, TFile, Vault } from "obsidian";
import {
  SyncSettings,
  ChangesResponse,
  DocumentResponse,
  DocumentInput,
  BulkDocsResponse,
  DocMetadata,
} from "./types";

export class SyncService {
  private vault: Vault;
  private settings: SyncSettings;
  private syncInProgress = false;
  private metadataCache: Map<string, DocMetadata> = new Map();

  constructor(vault: Vault, settings: SyncSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  updateSettings(settings: SyncSettings) {
    this.settings = settings;
  }

  async performSync(): Promise<void> {
    if (this.syncInProgress) {
      console.log("Sync already in progress, skipping");
      return;
    }

    this.syncInProgress = true;
    const startTime = Date.now();

    try {
      new Notice("Starting sync...");

      // Step 1: Pull changes from server
      await this.pullChanges();

      // Step 2: Push local changes
      await this.pushChanges();

      this.settings.lastSync = Date.now();
      new Notice(
        `Sync completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`
      );
    } catch (error) {
      console.error("Sync error:", error);
      new Notice(`Sync failed: ${error.message}`);
    } finally {
      this.syncInProgress = false;
    }
  }

  private async pullChanges(): Promise<void> {
    const url = `${this.settings.serverUrl}/api/changes?since=${this.settings.lastSeq}&limit=100&vault_id=${this.settings.vaultId}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch changes: ${response.statusText}`);
    }

    const data: ChangesResponse = await response.json();

    console.log(`Received ${data.results.length} changes from server`);

    for (const change of data.results) {
      try {
        if (change.deleted) {
          await this.deleteLocalFile(change.id);
        } else {
          await this.pullDocument(change.id);
        }
      } catch (error) {
        console.error(`Error processing change for ${change.id}:`, error);
      }
    }

    // Update last sequence
    if (data.last_seq > this.settings.lastSeq) {
      this.settings.lastSeq = data.last_seq;
    }
  }

  private async pullDocument(docId: string): Promise<void> {
    const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
      docId
    )}?vault_id=${this.settings.vaultId}`;

    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Document ${docId} not found on server`);
        return;
      }
      throw new Error(`Failed to fetch document: ${response.statusText}`);
    }

    const doc: DocumentResponse = await response.json();

    // Check if local file exists
    const path = this.docIdToPath(doc._id);
    const file = this.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      // Check if we need to update
      const localMeta = this.metadataCache.get(path);
      if (localMeta && localMeta.rev === doc._rev) {
        console.log(`Document ${docId} is up to date`);
        return;
      }

      // Update file
      await this.vault.modify(file, doc.content);
      console.log(`Updated ${path}`);
    } else {
      // Create new file
      await this.vault.create(path, doc.content);
      console.log(`Created ${path}`);
    }

    // Update metadata cache
    this.metadataCache.set(path, {
      path,
      rev: doc._rev,
      lastModified: Date.now(),
    });
  }

  private async deleteLocalFile(docId: string): Promise<void> {
    const path = this.docIdToPath(docId);
    const file = this.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      await this.vault.delete(file);
      this.metadataCache.delete(path);
      console.log(`Deleted ${path}`);
    }
  }

  private async pushChanges(): Promise<void> {
    const files = this.vault.getMarkdownFiles();
    const docsToUpdate: DocumentInput[] = [];

    for (const file of files) {
      const metadata = this.metadataCache.get(file.path);
      const fileModTime = file.stat.mtime;

      // Check if file has been modified since last sync
      if (!metadata || fileModTime > metadata.lastModified) {
        const content = await this.vault.read(file);
        const docId = this.pathToDocId(file.path);

        docsToUpdate.push({
          _id: docId,
          _rev: metadata?.rev,
          content,
        });
      }
    }

    if (docsToUpdate.length === 0) {
      console.log("No local changes to push");
      return;
    }

    console.log(`Pushing ${docsToUpdate.length} documents to server`);

    // Use bulk docs endpoint for efficiency
    const url = `${this.settings.serverUrl}/api/docs/bulk_docs?vault_id=${this.settings.vaultId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        docs: docsToUpdate,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to push changes: ${response.statusText}`);
    }

    const results: BulkDocsResponse[] = await response.json();

    // Update metadata cache with new revisions
    for (const result of results) {
      if (result.ok && result.rev) {
        const path = this.docIdToPath(result.id);
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          this.metadataCache.set(path, {
            path,
            rev: result.rev,
            lastModified: file.stat.mtime,
          });
        }
      } else if (result.error) {
        console.error(`Failed to update ${result.id}: ${result.error}`);
      }
    }
  }

  private pathToDocId(path: string): string {
    // Convert file path to document ID
    // Remove .md extension and use forward slashes
    return path.replace(/\.md$/, "").replace(/\\/g, "/");
  }

  private docIdToPath(docId: string): string {
    // Convert document ID to file path
    // Add .md extension
    return `${docId}.md`;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(this.settings.serverUrl);
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      return data.status === "ok";
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }
}
