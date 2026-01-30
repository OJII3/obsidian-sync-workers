# Obsidian Sync Workers

Cloudflare だけで完結する Obsidian 同期システム - Workers + D1 + R2 のサーバーと、Obsidian プラグインのモノレポ

## 概要

Cloudflare のサービスだけで動作する Obsidian 同期サーバーです。CouchDB などの外部データベースは不要で、Cloudflare の無料枠内で運用できます。

このプロジェクトは 2 つのパッケージで構成されています：

1. **Server (`packages/server`)** - Cloudflare WorkersとD1データベースを使った同期サーバー
2. **Plugin (`packages/plugin`)** - Obsidianプラグイン（クライアント側）

### 主な機能

- ドキュメントのCRUD操作
- リビジョン管理と競合検出
- 変更フィード（増分同期）
- 論理削除
- マルチVault対応
- 自動同期 / 手動同期
- 競合解決UI（自動マージ + 手動選択）
- アタッチメント同期（R2）

## アーキテクチャ

```
Obsidian Plugin (Client)
    ↓
Cloudflare Workers (Elysia Framework)
    ↓
D1 Database (SQLite) + R2 (Attachments)
```

## セットアップ

### 前提条件

- Bun (最新版推奨)
- Cloudflareアカウント（サーバーデプロイ用）
- Wrangler CLI（`bunx wrangler` で実行可能）

### 1. リポジトリのクローンと依存関係のインストール

```bash
git clone https://github.com/OJII3/obsidian-sync-workers.git
cd obsidian-sync-workers

bun install
```

## サーバーのセットアップ

### 0. APIキーの生成と設定（必須）

```bash
openssl rand -hex 32
```

生成したキーを以下のように設定します：

- **ローカル開発**: `packages/server/.dev.vars` に `API_KEY=生成したキー` を記載
- **本番環境**: `wrangler secret put API_KEY` コマンドで設定

サーバーとプラグインで同じAPIキーを使用してください。

### 1. D1データベースの作成

```bash
cd packages/server

bunx wrangler d1 create obsidian-sync
```

出力された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定してください。

### 2. データベーススキーマの適用

```bash
# 本番環境
bun run db:init

# ローカル開発環境
bun run db:local
```

### 3. R2バケットの作成（アタッチメント同期用）

```bash
bunx wrangler r2 bucket create obsidian-attachments
```

`wrangler.jsonc` に既にR2バインディングが設定済みです。

### 4. ローカル開発サーバーの起動

```bash
# packages/server ディレクトリから
bun run dev

# またはルートディレクトリから
bun run dev:server
```

サーバーは `http://localhost:8787` で起動します。

### 5. デプロイ

#### 方法 1: GitHub Actions（推奨）

フォークして GitHub Actions でデプロイする方法です。

1. このリポジトリをフォーク

2. Cloudflare ダッシュボードで準備：
   - D1 データベースを作成（`obsidian-sync`）
   - R2 バケットを作成（`obsidian-attachments`）
   - API トークンを作成（Workers の編集権限が必要）

3. フォークしたリポジトリの Settings → Secrets and variables → Actions で以下を設定：
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API トークン
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare アカウント ID

4. `packages/server/wrangler.jsonc` の `database_id` を実際の値に更新してコミット

5. Actions タブから "Deploy Server" ワークフローを手動実行（Run workflow）

6. デプロイ後、Cloudflare ダッシュボードまたは CLI で API キーを設定：
   ```bash
   bunx wrangler secret put API_KEY
   ```

#### 方法 2: 手動デプロイ

```bash
# 本番環境用のAPIキーを設定
cd packages/server
bunx wrangler secret put API_KEY
# プロンプトでAPIキーを入力

# デプロイ
bun run deploy

# またはルートディレクトリから
bun run build:server
```

## プラグインのセットアップ

### 開発モード

```bash
# packages/plugin ディレクトリから
bun run dev

# またはルートディレクトリから
bun run dev:plugin
```

### ビルド

```bash
# packages/plugin ディレクトリから
bun run build

# またはルートディレクトリから
bun run build:plugin
```

### Obsidianへのインストール

1. `packages/plugin` ディレクトリ全体を Obsidianのプラグインフォルダにコピー：
   ```bash
   # Linux/Mac
   cp -r packages/plugin /path/to/your/vault/.obsidian/plugins/obsidian-sync-workers

   # Windows
   xcopy packages\plugin C:\path\to\your\vault\.obsidian\plugins\obsidian-sync-workers /E /I
   ```

2. Obsidianを再起動
3. Settings → Community plugins → Obsidian Sync Workers を有効化

### プラグインの設定

1. Settings → Obsidian Sync Workers を開く
2. **Server URL** を設定（例：`https://your-worker.workers.dev` または `http://localhost:8787`）
3. **API key** にサーバーと同じAPIキーを入力
4. **Vault ID** を設定（デフォルト：`default`）
5. **Auto sync** を有効化（オプション）
6. **Sync interval** を設定（5秒〜60分から選択）
7. **Sync attachments** を有効化（画像等のバイナリファイルを同期する場合）
8. **Test** ボタンでサーバー接続をテスト
9. **Sync now** で手動同期を実行

## 使い方

### 手動同期

- リボンアイコンの同期ボタンをクリック
- コマンドパレット（Ctrl/Cmd+P）から "Sync now" を実行

### 自動同期

設定で **Auto sync** を有効化すると、指定した間隔で自動的に同期されます。

### コマンド

- `Sync now` - 即座に同期を実行
- `Toggle auto sync` - 自動同期のオン/オフを切り替え

## トラブルシューティング

### サーバーに接続できない

1. サーバーが起動しているか確認
2. Server URLが正しいか確認
3. APIキーが設定されているか確認（プラグインに保存済みか）
4. CORSエラーの場合、サーバー側のCORS設定を確認

### 同期が動作しない

1. Test connection で接続をテスト
2. ブラウザのコンソールログを確認
3. サーバーのログを確認

### プラグインが表示されない

1. プラグインフォルダに正しくコピーされているか確認
2. `main.js` がビルドされているか確認
3. Obsidianを再起動

## 仕様・開発メモ

仕様や内部実装の詳細は `CLAUDE.md`、各パッケージの開発メモは以下を参照してください。

- `CLAUDE.md`
- `packages/server/CLAUDE.md`
- `packages/plugin/CLAUDE.md`

## ライセンス

MIT
