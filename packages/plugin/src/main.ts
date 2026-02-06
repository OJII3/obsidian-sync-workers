import { type EventRef, Notice, Plugin, TFile } from "obsidian";
import { SyncSettingsTab } from "./settings";
import { CopySetupURIModal, ImportSetupURIModal } from "./setup-uri-modal";
import { SyncService, type SyncStatus } from "./sync-service";
import { DEFAULT_SETTINGS, type SyncSettings } from "./types";

export default class SyncWorkersPlugin extends Plugin {
	settings: SyncSettings;
	syncService: SyncService;
	private syncIntervalId: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private syncDebounceId: number | null = null;
	private readonly syncDebounceMs = 1000;
	private syncOnSaveEventRef: EventRef | null = null;
	private layoutReady = false;

	async onload() {
		await this.loadSettings();

		// Initialize sync service
		this.syncService = new SyncService(
			this.app,
			this.app.vault,
			this.settings,
			async () => await this.saveSettings(),
			(status) => this.updateStatusBar(status),
		);

		// Add command palette commands
		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: async () => {
				await this.syncService.performSync();
			},
		});

		this.addCommand({
			id: "toggle-auto-sync",
			name: "Toggle auto sync",
			callback: () => {
				this.settings.autoSync = !this.settings.autoSync;
				void this.saveSettings();
				if (this.settings.autoSync) {
					this.startAutoSync();
				} else {
					this.stopAutoSync();
				}
				this.updateStatusBar({ status: "idle" });
			},
		});

		this.addCommand({
			id: "copy-setup-uri",
			name: "Copy setup URL",
			callback: () => {
				new CopySetupURIModal(
					this.app,
					this.settings.serverUrl,
					this.settings.apiKey,
					this.settings.vaultId,
				).open();
			},
		});

		this.addCommand({
			id: "import-setup-uri",
			name: "Import setup URL",
			callback: () => {
				void this.openImportModal();
			},
		});

		// Register protocol handler for obsidian://setup-sync-workers?data=...
		this.registerObsidianProtocolHandler("setup-sync-workers", async (params) => {
			if (!params.data) return;
			const uri = `obsidian://setup-sync-workers?data=${params.data}`;
			await this.openImportModalWithURI(uri);
		});

		this.app.workspace.onLayoutReady(() => {
			this.layoutReady = true;

			// Add settings tab
			this.addSettingTab(new SyncSettingsTab(this.app, this));

			// Add status bar item
			this.statusBarItem = this.addStatusBarItem();
			this.updateStatusBar(this.lastStatus);

			// Add ribbon icon
			this.addRibbonIcon("sync", "Sync now", async () => {
				await this.syncService.performSync();
			});

			// Start auto sync if enabled
			if (this.settings.autoSync) {
				this.startAutoSync();
			}

			if (this.settings.syncOnStartup) {
				this.scheduleSync("startup");
			}

			this.updateSyncOnSaveRegistration();
		});
	}

	onunload() {
		this.stopAutoSync();
		this.clearScheduledSync();
		this.unregisterSyncOnSave();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SyncSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.syncService.updateSettings(this.settings);
	}

	startAutoSync() {
		this.stopAutoSync(); // Clear any existing interval

		const intervalMs = this.settings.syncInterval * 1000;
		this.syncIntervalId = window.setInterval(() => {
			void this.syncService.performSync();
		}, intervalMs);
	}

	stopAutoSync() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	setSyncOnSave(enabled: boolean) {
		this.settings.syncOnSave = enabled;
		void this.saveSettings();
		this.updateSyncOnSaveRegistration();
	}

	private updateSyncOnSaveRegistration() {
		if (!this.layoutReady) return;
		if (this.settings.syncOnSave) {
			this.registerSyncOnSave();
		} else {
			this.unregisterSyncOnSave();
		}
	}

	private registerSyncOnSave() {
		if (this.syncOnSaveEventRef) return;
		this.syncOnSaveEventRef = this.app.vault.on("modify", (file) => {
			if (!this.settings.syncOnSave) return;
			if (!(file instanceof TFile)) return;
			this.scheduleSync("save");
		});
		this.registerEvent(this.syncOnSaveEventRef);
	}

	private unregisterSyncOnSave() {
		if (!this.syncOnSaveEventRef) return;
		this.app.vault.offref(this.syncOnSaveEventRef);
		this.syncOnSaveEventRef = null;
	}

	private clearScheduledSync() {
		if (this.syncDebounceId !== null) {
			window.clearTimeout(this.syncDebounceId);
			this.syncDebounceId = null;
		}
	}

	private scheduleSync(reason: "startup" | "save") {
		if (this.lastStatus.status === "syncing") return;

		this.clearScheduledSync();
		const delayMs = reason === "startup" ? 0 : this.syncDebounceMs;
		this.syncDebounceId = window.setTimeout(() => {
			this.syncDebounceId = null;
			void this.syncService.performSync();
		}, delayMs);
	}

	async openImportModal() {
		const modal = new ImportSetupURIModal(this.app);
		modal.open();
		const data = await modal.waitForResult();
		if (data) {
			await this.applySetupData(data);
		}
	}

	async openImportModalWithURI(uri: string) {
		const modal = new ImportSetupURIModal(this.app, uri);
		modal.open();
		const data = await modal.waitForResult();
		if (data) {
			await this.applySetupData(data);
		}
	}

	private async applySetupData(data: { serverUrl: string; apiKey: string; vaultId: string }) {
		this.settings.serverUrl = data.serverUrl;
		this.settings.apiKey = data.apiKey;
		this.settings.vaultId = data.vaultId;

		// Reset sync state to avoid stale cache from a previously synced vault
		this.settings.lastSeq = 0;
		this.settings.lastAttachmentSeq = 0;
		this.settings.lastSync = 0;
		this.settings.metadataCache = {};
		this.settings.attachmentCache = {};
		await this.saveSettings();

		// Test connection and trigger initial sync
		new Notice("Testing connection...");
		const ok = await this.syncService.testConnection();
		if (ok) {
			new Notice("Connected. Starting initial sync...");
			await this.syncService.performSync();
		} else {
			new Notice("Connection failed. Check settings.");
		}
	}

	private lastStatus: SyncStatus = { status: "idle" };

	private updateStatusBar(status: SyncStatus) {
		if (!this.statusBarItem) return;
		this.lastStatus = status;

		// Clear existing content
		this.statusBarItem.empty();

		// Create status container with CSS classes
		const container = this.statusBarItem.createDiv({
			cls: `sync-status sync-status--${status.status}`,
		});

		// Icon element
		const iconEl = container.createSpan({ cls: "sync-status-icon" });

		// Text element
		const textEl = container.createSpan({ cls: "sync-status-text" });

		// Set icon and text based on status
		switch (status.status) {
			case "syncing": {
				iconEl.setText("⟳");
				if (status.progress) {
					const { phase, current, total } = status.progress;
					const phaseText = phase === "pull" ? "↓" : "↑";
					textEl.setText(`${phaseText} ${current}/${total}`);
				} else {
					textEl.setText("Syncing...");
				}
				break;
			}
			case "success": {
				iconEl.setText("✓");
				const statsText = this.formatStats(status.stats);
				textEl.setText(statsText || `Synced${status.duration ? ` (${status.duration})` : ""}`);
				break;
			}
			case "error": {
				iconEl.setText("✗");
				textEl.setText("Error");
				this.statusBarItem.setAttribute("title", status.message || "Unknown error");
				break;
			}
			case "paused": {
				iconEl.setText("⏸");
				textEl.setText("Paused");
				break;
			}
			default: {
				if (this.settings.autoSync) {
					iconEl.setText("◉");
				} else {
					iconEl.setText("○");
				}
				if (this.settings.lastSync) {
					const lastSyncDate = new Date(this.settings.lastSync);
					const timeStr = lastSyncDate.toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					});
					textEl.setText(timeStr);
				} else {
					textEl.setText("Not synced");
				}
				break;
			}
		}

		// Add click handler to show details
		container.addEventListener("click", () => this.showSyncDetails());
	}

	private formatStats(stats?: SyncStatus["stats"]): string {
		if (!stats) return "";

		const parts: string[] = [];
		if (stats.pulled > 0) parts.push(`↓${stats.pulled}`);
		if (stats.pushed > 0) parts.push(`↑${stats.pushed}`);
		if (stats.conflicts > 0) parts.push(`⚠${stats.conflicts}`);
		if (stats.errors > 0) parts.push(`✗${stats.errors}`);

		return parts.join(" ");
	}

	private showSyncDetails() {
		const status = this.lastStatus;
		const stats = status.stats;

		let message = "";

		// Status line
		switch (status.status) {
			case "syncing":
				message = "Sync in progress...\n";
				if (status.progress) {
					message += `${status.progress.phase === "pull" ? "Pulling" : "Pushing"}: ${status.progress.current}/${status.progress.total}\n`;
				}
				break;
			case "success":
				message = `Last sync: ${status.duration || "just now"}\n`;
				break;
			case "error":
				message = `Error: ${status.message || "Unknown error"}\n`;
				break;
			case "idle":
				if (this.settings.lastSync) {
					const date = new Date(this.settings.lastSync);
					message = `Last sync: ${date.toLocaleString()}\n`;
				} else {
					message = "Never synced\n";
				}
				break;
		}

		// Stats
		if (stats) {
			message += `\nPulled: ${stats.pulled} | Pushed: ${stats.pushed}`;
			if (stats.conflicts > 0) message += ` | Conflicts: ${stats.conflicts}`;
			if (stats.errors > 0) message += ` | Errors: ${stats.errors}`;
		}

		// Auto-sync status
		message += `\n\nAuto-sync: ${this.settings.autoSync ? "On" : "Off"}`;
		if (this.settings.autoSync) {
			const interval =
				this.settings.syncInterval >= 60
					? `${this.settings.syncInterval / 60}m`
					: `${this.settings.syncInterval}s`;
			message += ` (${interval})`;
		}

		new Notice(message, 5000);
	}
}
