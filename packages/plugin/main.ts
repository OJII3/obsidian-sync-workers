import { Notice, Plugin } from "obsidian";
import { SyncSettingsTab } from "./settings";
import { SyncService } from "./sync-service";
import { DEFAULT_SETTINGS, type SyncSettings } from "./types";

export default class SyncWorkersPlugin extends Plugin {
	settings: SyncSettings;
	syncService: SyncService;
	private syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize sync service
		this.syncService = new SyncService(
			this.app,
			this.app.vault,
			this.settings,
			async () => await this.saveSettings(),
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
					new Notice("Auto sync enabled");
				} else {
					this.stopAutoSync();
					new Notice("Auto sync disabled");
				}
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
}
