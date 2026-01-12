import { type App, PluginSettingTab, Setting } from "obsidian";
import type SyncWorkersPlugin from "./main";

export class SyncSettingsTab extends PluginSettingTab {
	plugin: SyncWorkersPlugin;

	constructor(app: App, plugin: SyncWorkersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Obsidian Sync Workers Settings" });

		// Server URL
		const serverUrlSetting = new Setting(containerEl)
			.setName("Server URL")
			.setDesc("The URL of your Cloudflare Workers sync server")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:8787")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						const trimmedValue = value.trim();

						// Validate URL format
						if (trimmedValue && !trimmedValue.match(/^https?:\/\/.+/)) {
							text.inputEl.addClass("is-invalid");
							serverUrlSetting.setDesc("Invalid URL format. Must start with http:// or https://");
						} else {
							text.inputEl.removeClass("is-invalid");
							serverUrlSetting.setDesc("The URL of your Cloudflare Workers sync server");
							this.plugin.settings.serverUrl = trimmedValue;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Vault ID
		new Setting(containerEl)
			.setName("Vault ID")
			.setDesc("Unique identifier for this vault")
			.addText((text) =>
				text
					.setPlaceholder("default")
					.setValue(this.plugin.settings.vaultId)
					.onChange(async (value) => {
						this.plugin.settings.vaultId = value.trim() || "default";
						await this.plugin.saveSettings();
					}),
			);

		// Auto sync toggle
		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc("Automatically sync at regular intervals")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.startAutoSync();
					} else {
						this.plugin.stopAutoSync();
					}
				}),
			);

		// Sync interval
		const intervalOptions: Record<string, number> = {
			"15 seconds": 15,
			"30 seconds": 30,
			"1 minute": 60,
			"5 minutes": 300,
			"15 minutes": 900,
			"30 minutes": 1800,
			"60 minutes": 3600,
		};
		new Setting(containerEl)
			.setName("Sync interval")
			.setDesc("How often to sync automatically")
			.addDropdown((dropdown) => {
				for (const [label, value] of Object.entries(intervalOptions)) {
					dropdown.addOption(value.toString(), label);
				}
				dropdown.setValue(this.plugin.settings.syncInterval.toString());
				dropdown.onChange(async (value) => {
					this.plugin.settings.syncInterval = Number.parseInt(value, 10);
					await this.plugin.saveSettings();
					if (this.plugin.settings.autoSync) {
						this.plugin.startAutoSync();
					}
				});
			});

		// Test connection button
		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Test the connection to your sync server")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						button.setButtonText("Testing...");
						button.setDisabled(true);

						const success = await this.plugin.syncService.testConnection();

						if (success) {
							button.setButtonText("✓ Connected");
							setTimeout(() => {
								button.setButtonText("Test");
								button.setDisabled(false);
							}, 2000);
						} else {
							button.setButtonText("✗ Failed");
							setTimeout(() => {
								button.setButtonText("Test");
								button.setDisabled(false);
							}, 2000);
						}
					}),
			);

		// Manual sync button
		new Setting(containerEl)
			.setName("Manual sync")
			.setDesc("Trigger a sync immediately")
			.addButton((button) =>
				button
					.setButtonText("Sync now")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.syncService.performSync();
						button.setDisabled(false);
					}),
			);

		// Status information
		containerEl.createEl("h3", { text: "Status" });

		const statusDiv = containerEl.createDiv();
		statusDiv.createEl("p", {
			text: `Last sync: ${
				this.plugin.settings.lastSync
					? new Date(this.plugin.settings.lastSync).toLocaleString()
					: "Never"
			}`,
		});
		statusDiv.createEl("p", {
			text: `Last sequence: ${this.plugin.settings.lastSeq}`,
		});
	}
}
