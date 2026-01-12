import { Plugin } from "obsidian";
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

	private updateStatusBar(status: SyncStatus) {
		if (!this.statusBarItem) return;

		const autoSyncIcon = this.settings.autoSync ? "⟳" : "";

		switch (status.status) {
			case "syncing":
				this.statusBarItem.setText(`${autoSyncIcon} Syncing...`);
				break;
			case "success":
				this.statusBarItem.setText(
					`${autoSyncIcon} Synced ${status.duration ? `(${status.duration})` : ""}`.trim(),
				);
				break;
			case "error":
				this.statusBarItem.setText(`${autoSyncIcon} Sync error`);
				this.statusBarItem.setAttribute("title", status.message || "Unknown error");
				break;
			case "idle":
			default:
				if (this.settings.lastSync) {
					const lastSyncDate = new Date(this.settings.lastSync);
					const timeStr = lastSyncDate.toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					});
					this.statusBarItem.setText(`${autoSyncIcon} Last sync: ${timeStr}`.trim());
				} else {
					this.statusBarItem.setText(`${autoSyncIcon} Not synced`.trim());
				}
				break;
		}
	}
}
