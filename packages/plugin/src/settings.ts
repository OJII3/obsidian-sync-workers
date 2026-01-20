import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncWorkersPlugin from "./main";

function generateApiKeyHex(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export class SyncSettingsTab extends PluginSettingTab {
	plugin: SyncWorkersPlugin;

	constructor(app: App, plugin: SyncWorkersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

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

		// API key
		let apiKeyInput: HTMLInputElement | null = null;
		const apiKeySetting = new Setting(containerEl)
			.setName("API key")
			.setDesc("Required. Must match the API key configured on the server")
			.addText((text) => {
				text.inputEl.type = "password";
				apiKeyInput = text.inputEl;
				return text
					.setPlaceholder("Enter API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						const trimmedValue = value.trim();
						if (!trimmedValue) {
							text.inputEl.addClass("is-invalid");
							apiKeySetting.setDesc("API key is required.");
							return;
						}
						text.inputEl.removeClass("is-invalid");
						apiKeySetting.setDesc("Required. Must match the API key configured on the server");
						this.plugin.settings.apiKey = trimmedValue;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Generate API key")
			.setDesc("Generate a new key and copy it to clipboard")
			.addButton((button) =>
				button
					.setButtonText("Generate")
					.setCta()
					.onClick(async () => {
						const key = generateApiKeyHex();
						this.plugin.settings.apiKey = key;
						await this.plugin.saveSettings();
						if (apiKeyInput) {
							apiKeyInput.value = key;
							apiKeyInput.classList.remove("is-invalid");
						}
						apiKeySetting.setDesc("Required. Must match the API key configured on the server");
						try {
							await navigator.clipboard.writeText(key);
							new Notice("API key generated and copied to clipboard.");
						} catch {
							new Notice("API key generated. Copy it from the settings.");
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

		// Sync on startup
		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Sync once when Obsidian starts")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}),
			);

		// Sync on save
		new Setting(containerEl)
			.setName("Sync on save")
			.setDesc("Sync when files are saved")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
					this.plugin.setSyncOnSave(value);
				}),
			);

		// Sync attachments toggle
		new Setting(containerEl)
			.setName("Sync attachments")
			.setDesc("Sync binary files like images, PDFs, and other attachments (requires R2 storage)")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncAttachments).onChange(async (value) => {
					this.plugin.settings.syncAttachments = value;
					await this.plugin.saveSettings();
				}),
			);

		// Sync interval
		const intervalOptions: Record<string, number> = {
			"5 seconds": 5,
			"10 seconds": 10,
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
			.setDesc("How often to sync automatically (shorter intervals use lightweight status checks)")
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
		new Setting(containerEl).setName("Status").setHeading();

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
