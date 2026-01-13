import { Notice, Plugin } from "obsidian";
import { SyncSettingsTab } from "./settings";
import { SyncService, type SyncStatus } from "./sync-service";
import { DEFAULT_SETTINGS, type SyncSettings } from "./types";

export default class SyncWorkersPlugin extends Plugin {
	settings: SyncSettings;
	syncService: SyncService;
	private syncIntervalId: number | null = null;
	private statusBarItem: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar({ status: "idle" });

		// Initialize sync service
		this.syncService = new SyncService(
			this.app,
			this.app.vault,
			this.settings,
			async () => await this.saveSettings(),
			(status) => this.updateStatusBar(status),
		);

		// Add settings tab
		this.addSettingTab(new SyncSettingsTab(this.app, this));

		// Add ribbon icon
		this.addRibbonIcon("sync", "Sync now", async () => {
			await this.syncService.performSync();
		});

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
				this.saveSettings();
				if (this.settings.autoSync) {
					this.startAutoSync();
				} else {
					this.stopAutoSync();
				}
				this.updateStatusBar({ status: "idle" });
			},
		});

		// Start auto sync if enabled
		if (this.settings.autoSync) {
			this.startAutoSync();
		}

		console.log("Obsidian Sync Workers plugin loaded");
	}

	onunload() {
		this.stopAutoSync();
		console.log("Obsidian Sync Workers plugin unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.syncService.updateSettings(this.settings);
	}

	startAutoSync() {
		this.stopAutoSync(); // Clear any existing interval

		const intervalMs = this.settings.syncInterval * 1000;
		this.syncIntervalId = window.setInterval(async () => {
			await this.syncService.performSync();
		}, intervalMs);

		const intervalDisplay =
			this.settings.syncInterval >= 60
				? `${this.settings.syncInterval / 60} minutes`
				: `${this.settings.syncInterval} seconds`;
		console.log(`Auto sync started with interval: ${intervalDisplay}`);
	}

	stopAutoSync() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
			console.log("Auto sync stopped");
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
		message += `\n\nAuto-sync: ${this.settings.autoSync ? "ON" : "OFF"}`;
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
