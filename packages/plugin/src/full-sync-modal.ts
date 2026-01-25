import { type App, Modal, Setting } from "obsidian";

export enum FullSyncResolution {
	FullReset = "full_reset",
	ManualResolve = "manual",
	Cancel = "cancel",
}

export class FullSyncRequiredModal extends Modal {
	private result: FullSyncResolution = FullSyncResolution.Cancel;
	private resolve: ((value: FullSyncResolution) => void) | null = null;
	private filePath: string;
	private reason: string;

	constructor(app: App, filePath: string, reason: string) {
		super(app);
		this.filePath = filePath;
		this.reason = reason;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Full sync required" });

		contentEl.createEl("p", {
			text: `The file "${this.filePath}" cannot be synced automatically.`,
		});

		contentEl.createEl("p", {
			text: this.getReasonMessage(),
			cls: "mod-warning",
		});

		contentEl.createEl("p", {
			text: "Choose how to proceed:",
		});

		// Options description
		const optionsContainer = contentEl.createDiv("full-sync-options");

		const fullResetOption = optionsContainer.createDiv("full-sync-option");
		fullResetOption.createEl("h4", { text: "Full reset (recommended)" });
		fullResetOption.createEl("p", {
			text: "Clear local sync cache and re-sync all files from server. Your local files will be preserved and compared with server versions.",
			cls: "setting-item-description",
		});

		const manualOption = optionsContainer.createDiv("full-sync-option");
		manualOption.createEl("h4", { text: "Manual resolve" });
		manualOption.createEl("p", {
			text: "Resolve this conflict manually by choosing local or remote version.",
			cls: "setting-item-description",
		});

		// Buttons
		const buttonContainer = contentEl.createDiv("full-sync-button-container");

		new Setting(buttonContainer)
			.addButton((btn) =>
				btn
					.setButtonText("Full reset")
					.setCta()
					.onClick(() => {
						this.result = FullSyncResolution.FullReset;
						this.close();
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Manual resolve").onClick(() => {
					this.result = FullSyncResolution.ManualResolve;
					this.close();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.result = FullSyncResolution.Cancel;
					this.close();
				}),
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();

		if (this.resolve) {
			this.resolve(this.result);
			this.resolve = null;
		}
	}

	private getReasonMessage(): string {
		switch (this.reason) {
			case "base_revision_not_found":
				return "The base revision for this file has been cleaned up from the server. This typically happens after a long period of offline use.";
			case "content_missing":
				return "Content is missing for the merge operation.";
			default:
				return "An unrecoverable sync conflict occurred.";
		}
	}

	async waitForResult(): Promise<FullSyncResolution> {
		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}
