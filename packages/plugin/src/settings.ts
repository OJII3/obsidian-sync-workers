import { type App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncWorkersPlugin from "./main";
import { CopySetupURIModal } from "./setup-uri-modal";

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
		const apiKeySetting = new Setting(containerEl)
			.setName("API key")
			.setDesc("Required. Generate with: openssl rand -hex 32")
			.addText((text) => {
				text.inputEl.type = "password";
				return text
					.setPlaceholder("Enter API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						const trimmedValue = value.trim();
						if (!trimmedValue) {
							text.inputEl.addClass("is-invalid");
							apiKeySetting.setDesc("API key is required.");
							this.plugin.settings.apiKey = "";
							await this.plugin.saveSettings();
							return;
						}
						text.inputEl.removeClass("is-invalid");
						apiKeySetting.setDesc("Required. Generate with: openssl rand -hex 32");
						this.plugin.settings.apiKey = trimmedValue;
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button.setButtonText("Copy").onClick(async () => {
					const apiKey = this.plugin.settings.apiKey;
					if (!apiKey) {
						new Notice("No API key to copy.");
						return;
					}
					try {
						await navigator.clipboard.writeText(apiKey);
						button.setButtonText("Copied!");
						setTimeout(() => button.setButtonText("Copy"), 1500);
					} catch {
						new Notice("Failed to copy to clipboard.");
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

		// Setup URI section
		new Setting(containerEl).setName("Setup URI").setHeading();

		new Setting(containerEl)
			.setName("Copy setup URI")
			.setDesc("Generate an encrypted URI to set up another device")
			.addButton((button) =>
				button.setButtonText("Copy").onClick(() => {
					new CopySetupURIModal(
						this.app,
						this.plugin.settings.serverUrl,
						this.plugin.settings.apiKey,
						this.plugin.settings.vaultId,
					).open();
				}),
			);

		new Setting(containerEl)
			.setName("Import setup URI")
			.setDesc("Import settings from another device using a setup URI")
			.addButton((button) =>
				button.setButtonText("Import").onClick(() => {
					this.plugin.openImportModal();
				}),
			);

		// Maintenance section
		new Setting(containerEl).setName("Maintenance").setHeading();

		new Setting(containerEl)
			.setName("Full reset")
			.setDesc("Clear local sync cache and re-sync all files from server. Use if sync is broken.")
			.addButton((button) =>
				button
					.setButtonText("Full reset")
					.setWarning()
					.onClick(async () => {
						// Confirmation dialog
						const confirmed = await this.confirmFullReset();
						if (!confirmed) {
							return;
						}

						button.setDisabled(true);
						button.setButtonText("Resetting...");

						try {
							await this.plugin.syncService.performFullReset();
							new Notice("Full reset complete. Syncing...");
							// Trigger a sync after reset
							await this.plugin.syncService.performSync();
							new Notice("Sync complete.");
						} catch (error) {
							const message = error instanceof Error ? error.message : "Unknown error";
							new Notice(`Full reset failed: ${message}`);
						} finally {
							button.setDisabled(false);
							button.setButtonText("Full reset");
						}
					}),
			);

		new Setting(containerEl)
			.setName("Clear metadata cache")
			.setDesc(
				"Clear local sync metadata without re-syncing. Next sync will treat all files as new.",
			)
			.addButton((button) =>
				button.setButtonText("Clear cache").onClick(async () => {
					// Confirmation dialog
					const confirmed = await this.confirmClearCache();
					if (!confirmed) {
						return;
					}

					this.plugin.settings.metadataCache = {};
					this.plugin.settings.attachmentCache = {};
					this.plugin.settings.lastSeq = 0;
					this.plugin.settings.lastAttachmentSeq = 0;
					await this.plugin.saveSettings();
					new Notice("Metadata cache cleared. Next sync will treat all files as new.");
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

	private async confirmFullReset(): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(
				this.app,
				"Full reset",
				"This will clear all local sync metadata and re-sync from the server. Your local files will be preserved and compared with server versions. Continue?",
				() => resolve(true),
				() => resolve(false),
			);
			modal.open();
		});
	}

	private async confirmClearCache(): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(
				this.app,
				"Clear cache",
				"This will clear all local sync metadata. The next sync will treat all files as new, which may result in conflicts. Continue?",
				() => resolve(true),
				() => resolve(false),
			);
			modal.open();
		});
	}
}

class ConfirmModal extends Modal {
	private title: string;
	private message: string;
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: () => void,
		onCancel: () => void,
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					this.onCancel();
				}),
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
