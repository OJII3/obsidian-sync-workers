import { type App, Modal, Setting } from "obsidian";

export enum ConflictResolution {
	UseLocal = "local",
	UseRemote = "remote",
	Cancel = "cancel",
}

export class ConflictResolutionModal extends Modal {
	private result: ConflictResolution = ConflictResolution.Cancel;
	private resolve: ((value: ConflictResolution) => void) | null = null;
	private filePath: string;
	private localContent: string;
	private remoteContent: string;
	private remoteDeleted: boolean;

	constructor(
		app: App,
		filePath: string,
		localContent: string,
		remoteContent: string,
		remoteDeleted: boolean = false,
	) {
		super(app);
		this.filePath = filePath;
		this.localContent = localContent;
		this.remoteContent = remoteContent;
		this.remoteDeleted = remoteDeleted;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Sync conflict detected" });

		contentEl.createEl("p", {
			text: `The file "${this.filePath}" has different changes locally and on the server.`,
		});

		contentEl.createEl("p", {
			text: "Which version would you like to use?",
			cls: "mod-warning",
		});

		// Show content previews
		const previewContainer = contentEl.createDiv("conflict-preview-container");

		// Local version preview
		const localPreview = previewContainer.createDiv("conflict-preview");
		localPreview.createEl("h3", { text: "Local version" });
		const localCode = localPreview.createEl("pre");
		localCode.createEl("code", {
			text: this.truncateContent(this.localContent),
		});

		// Remote version preview
		const remotePreview = previewContainer.createDiv("conflict-preview");
		remotePreview.createEl("h3", {
			text: this.remoteDeleted ? "Remote version (deleted)" : "Remote version (server)",
		});
		const remoteCode = remotePreview.createEl("pre");
		remoteCode.createEl("code", {
			text: this.remoteDeleted ? "(deleted on server)" : this.truncateContent(this.remoteContent),
		});

		// Buttons
		const buttonContainer = contentEl.createDiv("conflict-button-container");

		new Setting(buttonContainer)
			.addButton((btn) =>
				btn
					.setButtonText("Use local")
					.setCta()
					.onClick(() => {
						this.result = ConflictResolution.UseLocal;
						this.close();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Use remote")
					.setWarning()
					.onClick(() => {
						this.result = ConflictResolution.UseRemote;
						this.close();
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.result = ConflictResolution.Cancel;
					this.close();
				}),
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();

		// Always resolve the promise when the modal closes
		// This prevents the sync operation from hanging
		if (this.resolve) {
			this.resolve(this.result);
			this.resolve = null;
		}
	}

	private truncateContent(content: string, maxLines = 20): string {
		const lines = content.split("\n");
		if (lines.length <= maxLines) {
			return content;
		}
		return `${lines.slice(0, maxLines).join("\n")}\n\n... (${lines.length - maxLines} more lines)`;
	}

	async waitForResult(): Promise<ConflictResolution> {
		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}
