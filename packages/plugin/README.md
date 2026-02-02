# Obsidian Sync Workers - プラグイン

Cloudflare Workers と連携して Obsidian ノートを同期するプラグインです。

## 目次

- [インストール方法](#インストール方法)
  - [方法1: GitHub Releases からインストール（推奨）](#方法1-github-releases-からインストール推奨)
  - [方法2: 手動ビルドしてインストール](#方法2-手動ビルドしてインストール)
- [初期設定](#初期設定)
- [使い方](#使い方)
- [トラブルシューティング](#トラブルシューティング)

## インストール方法

### 方法1: GitHub Releases からインストール（推奨）

1. [Releases ページ](https://github.com/OJII3/obsidian-sync-workers/releases)から最新のリリースをダウンロード
   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Obsidian の Vault 内にプラグインフォルダを作成
   ```
   your-vault/.obsidian/plugins/obsidian-sync-workers/
   ```

3. ダウンロードした3つのファイルをプラグインフォルダに配置
   ```
   your-vault/.obsidian/plugins/obsidian-sync-workers/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. Obsidian を再起動（または「設定 → コミュニティプラグイン」でリロード）

5. 「設定 → コミュニティプラグイン」から **Obsidian Sync Workers** を有効化

### 方法2: 手動ビルドしてインストール

開発者向けの方法です。

```bash
# リポジトリをクローン
git clone https://github.com/OJII3/obsidian-sync-workers.git
cd obsidian-sync-workers

# 依存関係をインストール
bun install

# プラグインをビルド
cd packages/plugin
bun run build
```

ビルド後、`packages/plugin` フォルダごと Obsidian のプラグインフォルダにコピーします。

```bash
# Linux / macOS
cp -r packages/plugin /path/to/your/vault/.obsidian/plugins/obsidian-sync-workers

# Windows
xcopy packages\plugin C:\path\to\your\vault\.obsidian\plugins\obsidian-sync-workers /E /I
```

## 初期設定

プラグインを有効化したら、以下の手順で設定を行います。

### 1. 設定画面を開く

Obsidian の「設定」→「Obsidian Sync Workers」を開きます。

### 2. サーバー接続の設定

| 設定項目 | 説明 | 例 |
|----------|------|-----|
| **Server URL** | サーバーのURL | `https://obsidian-sync-workers.your-account.workers.dev` または `http://localhost:8787`（ローカル開発時） |
| **API key** | サーバーと同じAPIキー | `your-generated-api-key` |
| **Vault ID** | Vault の識別子（複数Vault を使い分ける場合に変更） | `default` |

### 3. 接続テスト

「**Test connection**」ボタンをクリックして、サーバーに接続できることを確認します。

- 成功: 「Connection successful!」と表示
- 失敗: エラーメッセージを確認して設定を見直してください

### 4. 同期設定（オプション）

| 設定項目 | 説明 | 推奨値 |
|----------|------|--------|
| **Auto sync** | 自動同期を有効にする | お好みで |
| **Sync interval** | 自動同期の間隔 | 1分〜5分 |
| **Sync attachments** | 画像やPDF等のアタッチメントを同期する | 有効推奨 |

### 5. 初回同期

設定が完了したら「**Sync now**」ボタンをクリックして初回同期を実行します。

## 使い方

### 手動同期

以下のいずれかの方法で同期を実行できます：

- **リボンアイコン**: サイドバーの同期アイコンをクリック
- **コマンドパレット**: `Ctrl/Cmd + P` → 「Sync now」を選択

### 自動同期

設定で「Auto sync」を有効にすると、指定した間隔で自動的に同期が実行されます。

### 競合の解決

同じファイルが複数の端末で編集された場合、競合が発生することがあります。

1. **自動マージ**: 編集箇所が異なる場合は自動的にマージされます
2. **手動選択**: 同じ箇所が編集された場合はモーダルが表示されます
   - **Use local**: ローカルの変更を優先
   - **Use remote**: サーバーの変更を優先
   - **Cancel**: 同期をスキップ

### コマンド一覧

| コマンド | 説明 |
|----------|------|
| `Sync now` | 即座に同期を実行 |
| `Toggle auto sync` | 自動同期のオン/オフを切り替え |

## トラブルシューティング

### 接続できない

1. **Server URL を確認**: `https://` または `http://` から始まる完全なURLか確認
2. **API key を確認**: サーバーと同じキーが設定されているか確認
3. **サーバーが起動しているか確認**: ブラウザでServer URLにアクセスして確認

### 同期が動作しない

1. 「Test connection」で接続をテスト
2. Obsidian の開発者コンソール（`Ctrl/Cmd + Shift + I`）でエラーログを確認
3. 一度プラグインを無効化→有効化してみる

### プラグインが表示されない

1. プラグインフォルダに `main.js` が存在するか確認
2. Obsidian を完全に再起動
3. 「コミュニティプラグイン」の「インストール済みプラグイン」に表示されるか確認

### フルリセット

同期状態がおかしくなった場合は、設定画面の「**Full reset**」ボタンでローカルキャッシュをクリアできます。

## 前提条件

このプラグインを使用するには、先に[サーバーのセットアップ](../server/README.md)が必要です。
