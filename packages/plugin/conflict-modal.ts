import { App, Modal, Setting } from "obsidian";

export enum ConflictResolution {
  UseLocal = "local",
  UseRemote = "remote",
  Cancel = "cancel",
}

export class ConflictResolutionModal extends Modal {
  private result: ConflictResolution = ConflictResolution.Cancel;
  private resolve: (value: ConflictResolution) => void;
  private filePath: string;
  private localContent: string;
  private remoteContent: string;

  constructor(
    app: App,
    filePath: string,
    localContent: string,
    remoteContent: string
  ) {
    super(app);
    this.filePath = filePath;
    this.localContent = localContent;
    this.remoteContent = remoteContent;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "同期の競合を検出しました" });

    contentEl.createEl("p", {
      text: `ファイル「${this.filePath}」にローカルとリモートで異なる変更があります。`,
    });

    contentEl.createEl("p", {
      text: "どちらのバージョンを使用しますか？",
      cls: "mod-warning",
    });

    // Show content previews
    const previewContainer = contentEl.createDiv("conflict-preview-container");

    // Local version preview
    const localPreview = previewContainer.createDiv("conflict-preview");
    localPreview.createEl("h3", { text: "ローカル版" });
    const localCode = localPreview.createEl("pre");
    localCode.createEl("code", { text: this.truncateContent(this.localContent) });

    // Remote version preview
    const remotePreview = previewContainer.createDiv("conflict-preview");
    remotePreview.createEl("h3", { text: "リモート版 (サーバー)" });
    const remoteCode = remotePreview.createEl("pre");
    remoteCode.createEl("code", {
      text: this.truncateContent(this.remoteContent),
    });

    // Buttons
    const buttonContainer = contentEl.createDiv("conflict-button-container");

    new Setting(buttonContainer)
      .addButton((btn) =>
        btn
          .setButtonText("ローカル版を使用")
          .setCta()
          .onClick(() => {
            this.result = ConflictResolution.UseLocal;
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("リモート版を使用")
          .setWarning()
          .onClick(() => {
            this.result = ConflictResolution.UseRemote;
            this.close();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("キャンセル").onClick(() => {
          this.result = ConflictResolution.Cancel;
          this.close();
        })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.resolve) {
      this.resolve(this.result);
    }
  }

  private truncateContent(content: string, maxLines: number = 20): string {
    const lines = content.split("\n");
    if (lines.length <= maxLines) {
      return content;
    }
    return (
      lines.slice(0, maxLines).join("\n") +
      `\n\n... (残り ${lines.length - maxLines} 行)`
    );
  }

  async waitForResult(): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}
