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
			.setDesc("The URL of your sync server")
			.addText((text) =>
				text
					.setPlaceholder("Enter your server URL")
					.setValue(this.plugin.settings.serverUrl)
					.onChange((value) => {
						const trimmedValue = value.trim();

						// Validate URL format
						if (trimmedValue && !trimmedValue.match(/^https?:\/\/.+/)) {
							text.inputEl.addClass("is-invalid");
							serverUrlSetting.setDesc("Please enter a valid URL");
						} else {
							text.inputEl.removeClass("is-invalid");
							serverUrlSetting.setDesc("The URL of your sync server");
							this.plugin.settings.serverUrl = trimmedValue;
							void this.plugin.saveSettings();
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
					.onChange((value) => {
						const trimmedValue = value.trim();
						if (!trimmedValue) {
							text.inputEl.addClass("is-invalid");
							apiKeySetting.setDesc("API key is required.");
							this.plugin.settings.apiKey = "";
							void this.plugin.saveSettings();
							return;
						}
						text.inputEl.removeClass("is-invalid");
						apiKeySetting.setDesc("Required. Generate with: openssl rand -hex 32");
						this.plugin.settings.apiKey = trimmedValue;
						void this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button.setButtonText("Copy").onClick(() => {
					const apiKey = this.plugin.settings.apiKey;
					if (!apiKey) {
						new Notice("No API key to copy.");
						return;
					}
					void navigator.clipboard.writeText(apiKey).then(
						() => {
							button.setButtonText("Copied!");
							setTimeout(() => {
								button.setButtonText("Copy");
							}, 1500);
						},
						() => {
							new Notice("Failed to copy to clipboard.");
						},
					);
				}),
			);

		// Vault ID
		new Setting(containerEl)
			.setName("Vault ID")
			.setDesc("Unique identifier for this vault")
			.addText((text) =>
				text
					.setPlaceholder("Default")
					.setValue(this.plugin.settings.vaultId)
					.onChange((value) => {
						this.plugin.settings.vaultId = value.trim() || "default";
						void this.plugin.saveSettings();
					}),
			);

		// Auto sync toggle
		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc("Automatically sync at regular intervals")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSync).onChange((value) => {
					this.plugin.settings.autoSync = value;
					void this.plugin.saveSettings();
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
				toggle.setValue(this.plugin.settings.syncOnStartup).onChange((value) => {
					this.plugin.settings.syncOnStartup = value;
					void this.plugin.saveSettings();
				}),
			);

		// Sync on save
		new Setting(containerEl)
			.setName("Sync on save")
			.setDesc("Sync when files are saved")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnSave).onChange((value) => {
					this.plugin.setSyncOnSave(value);
				}),
			);

		// Sync attachments toggle
		new Setting(containerEl)
			.setName("Sync attachments")
			.setDesc("Sync binary files like images, PDFs, and other attachments (requires R2 storage)")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncAttachments).onChange((value) => {
					this.plugin.settings.syncAttachments = value;
					void this.plugin.saveSettings();
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
				dropdown.onChange((value) => {
					this.plugin.settings.syncInterval = Number.parseInt(value, 10);
					void this.plugin.saveSettings();
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
					.onClick(() => {
						button.setButtonText("Testing...");
						button.setDisabled(true);

						this.plugin.syncService.testConnection().then(
							(success) => {
								if (success) {
									button.setButtonText("✓ connected");
									setTimeout(() => {
										button.setButtonText("Test");
										button.setDisabled(false);
									}, 2000);
								} else {
									button.setButtonText("✗ failed");
									setTimeout(() => {
										button.setButtonText("Test");
										button.setDisabled(false);
									}, 2000);
								}
							},
							() => {
								button.setButtonText("✗ failed");
								setTimeout(() => {
									button.setButtonText("Test");
									button.setDisabled(false);
								}, 2000);
							},
						);
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
					.onClick(() => {
						button.setDisabled(true);
						void this.plugin.syncService.performSync().finally(() => {
							button.setDisabled(false);
						});
					}),
			);

		// Setup URL section
		new Setting(containerEl).setName("Setup URL").setHeading();

		new Setting(containerEl)
			.setName("Copy setup URL")
			.setDesc("Generate an encrypted URL to set up another device")
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
			.setName("Import setup URL")
			.setDesc("Import settings from another device using a setup URL")
			.addButton((button) =>
				button.setButtonText("Import").onClick(() => {
					void this.plugin.openImportModal();
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
					.onClick(() => {
						void (async () => {
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
						})();
					}),
			);

		new Setting(containerEl)
			.setName("Clear metadata cache")
			.setDesc(
				"Clear local sync metadata without re-syncing. Next sync will treat all files as new.",
			)
			.addButton((button) =>
				button.setButtonText("Clear cache").onClick(() => {
					void (async () => {
						// Confirmation dialog
						const confirmed = await this.confirmClearCache();
						if (!confirmed) {
							return;
						}

						button.setDisabled(true);
						button.setButtonText("Clearing...");

						try {
							// Reuse the sync service's full reset logic to ensure both
							// in-memory and persisted metadata caches are cleared.
							await this.plugin.syncService.performFullReset();
							new Notice("Metadata cache cleared. Next sync will treat all files as new.");
						} catch (error) {
							const message = error instanceof Error ? error.message : "Unknown error";
							new Notice(`Failed to clear metadata cache: ${message}`);
						} finally {
							button.setDisabled(false);
							button.setButtonText("Clear cache");
						}
					})();
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
