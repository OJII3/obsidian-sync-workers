import { type App, Modal, Notice, Setting } from "obsidian";
import { decryptSetupURI, encryptSetupData, isSetupURI, type SetupData } from "./setup-uri";

export class CopySetupURIModal extends Modal {
	private serverUrl: string;
	private apiKey: string;
	private vaultId: string;

	constructor(app: App, serverUrl: string, apiKey: string, vaultId: string) {
		super(app);
		this.serverUrl = serverUrl;
		this.apiKey = apiKey;
		this.vaultId = vaultId;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Copy setup URL" });

		contentEl.createEl("p", {
			text: "Generate an encrypted URL to set up another device. Share the URL and passphrase separately.",
		});

		if (!this.serverUrl || !this.apiKey) {
			contentEl.createEl("p", {
				text: "Server URL and API key must be configured first.",
				cls: "sync-workers-warning",
			});
			return;
		}

		let passphrase = "";
		let passphraseConfirm = "";

		new Setting(contentEl).setName("Passphrase").addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("Enter a passphrase");
			text.onChange((value) => {
				passphrase = value;
			});
		});

		new Setting(contentEl).setName("Confirm passphrase").addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("Re-enter the passphrase");
			text.onChange((value) => {
				passphraseConfirm = value;
			});
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Generate and copy")
				.setCta()
				.onClick(() => {
					if (!passphrase) {
						new Notice("Please enter a passphrase.");
						return;
					}
					if (passphrase !== passphraseConfirm) {
						new Notice("Passphrases do not match.");
						return;
					}

					btn.setDisabled(true);
					btn.setButtonText("Generating...");

					const data: SetupData = {
						serverUrl: this.serverUrl,
						apiKey: this.apiKey,
						vaultId: this.vaultId,
						version: 1,
					};
					encryptSetupData(data, passphrase)
						.then((uri) => navigator.clipboard.writeText(uri))
						.then(
							() => {
								new Notice("Setup URL copied to clipboard.");
								this.close();
							},
							(e) => {
								new Notice(
									`Failed to generate setup URL: ${e instanceof Error ? e.message : String(e)}`,
								);
								btn.setDisabled(false);
								btn.setButtonText("Generate and copy");
							},
						);
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class ImportSetupURIModal extends Modal {
	private resolve: ((data: SetupData | null) => void) | null = null;
	private result: SetupData | null = null;
	private prefilledURI: string;

	constructor(app: App, prefilledURI = "") {
		super(app);
		this.prefilledURI = prefilledURI;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Import setup URL" });

		contentEl.createEl("p", {
			text: "Paste a setup URL from another device and enter the passphrase to import settings.",
		});

		let uriInput = this.prefilledURI;
		let passphrase = "";

		new Setting(contentEl).setName("Setup URL").addTextArea((text) => {
			text.setPlaceholder("Paste the setup URL");
			text.inputEl.rows = 3;
			text.inputEl.addClass("sync-workers-uri-input");
			if (this.prefilledURI) {
				text.setValue(this.prefilledURI);
			}
			text.onChange((value) => {
				uriInput = value.trim();
			});
		});

		new Setting(contentEl).setName("Passphrase").addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("Enter the passphrase");
			text.onChange((value) => {
				passphrase = value;
			});
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						if (!uriInput) {
							new Notice("Please paste the setup URL.");
							return;
						}
						if (!isSetupURI(uriInput)) {
							new Notice("Invalid setup URL format.");
							return;
						}
						if (!passphrase) {
							new Notice("Please enter the passphrase.");
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText("Decrypting...");

						decryptSetupURI(uriInput, passphrase).then(
							(result) => {
								this.result = result;
								new Notice(`Settings imported: ${result.serverUrl} (vault: ${result.vaultId})`);
								this.close();
							},
							(e) => {
								new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
								btn.setDisabled(false);
								btn.setButtonText("Import");
							},
						);
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
	}

	onClose() {
		this.contentEl.empty();
		if (this.resolve) {
			this.resolve(this.result);
			this.resolve = null;
		}
	}

	async waitForResult(): Promise<SetupData | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}
