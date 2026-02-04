# Obsidian Sync Workers - サーバー

Cloudflare Workers + D1 + R2 を使った Obsidian 同期サーバーです。

## 目次

- [必要なもの](#必要なもの)
- [セットアップ手順](#セットアップ手順)
  - [1. APIキーの生成](#1-apiキーの生成)
  - [2. D1データベースの作成](#2-d1データベースの作成)
  - [3. R2バケットの作成](#3-r2バケットの作成)
  - [4. 環境変数の設定](#4-環境変数の設定)
  - [5. デプロイ](#5-デプロイ)
- [ローカル開発](#ローカル開発)
- [トラブルシューティング](#トラブルシューティング)

## 必要なもの

- [Bun](https://bun.sh/) （最新版推奨）
- [Cloudflareアカウント](https://dash.cloudflare.com/sign-up)（無料プランで動作可能）
- Wrangler CLI（`bunx wrangler` で実行可能）

## セットアップ手順

### 1. APIキーの生成

まず、サーバーとプラグイン間の認証に使用するAPIキーを生成します。

```bash
openssl rand -hex 32
```

生成されたキーは後で使うので控えておいてください。サーバーとプラグインの両方で同じキーを使用します。

### 2. D1データベースの作成

Cloudflare D1 データベースを作成します。

```bash
cd packages/server

# D1データベースを作成
bunx wrangler d1 create obsidian-sync
```

出力例：
```
✅ Successfully created DB 'obsidian-sync'

[[d1_databases]]
binding = "DB"
database_name = "obsidian-sync"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**重要:** 出力された `database_id` の値を `wrangler.jsonc` の `d1_databases[0].database_id` に設定してください。

```jsonc
// wrangler.jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "obsidian-sync",
      "database_id": "ここに出力されたdatabase_idを設定"
    }
  ]
}
```

次に、データベーススキーマを適用します。

```bash
# 本番環境
bun run db:init

# ローカル開発環境の場合
bun run db:local
```

### 3. R2バケットの作成

アタッチメント（画像やPDF等）を保存するためのR2バケットを作成します。

```bash
bunx wrangler r2 bucket create obsidian-attachments
```

R2のバインディングは `wrangler.jsonc` に既に設定されています。

### 4. 環境変数の設定

#### 本番環境

Cloudflare Workers のシークレットとしてAPIキーを設定します。

```bash
bunx wrangler secret put API_KEY
# プロンプトが表示されたら、手順1で生成したAPIキーを入力
```

#### ローカル開発環境

`.dev.vars` ファイルを作成してAPIキーを設定します。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` を編集：
```
API_KEY=your-generated-api-key-here
```

### 5. デプロイ

#### 方法1: GitHub Actions（推奨）

リポジトリをフォークして GitHub Actions でデプロイする方法です。

1. **リポジトリをフォーク**

2. **Cloudflareダッシュボードで準備**
   - D1データベース作成済み（手順2）
   - R2バケット作成済み（手順3）
   - APIトークンを作成（Workers編集権限が必要）

3. **GitHubシークレットを設定**

   フォークしたリポジトリの Settings → Secrets and variables → Actions で以下を設定：
   - `CLOUDFLARE_API_TOKEN`: Cloudflare APIトークン
   - `CLOUDFLARE_ACCOUNT_ID`: CloudflareアカウントID

4. **database_id を更新してコミット**

   `packages/server/wrangler.jsonc` の `database_id` を実際の値に更新してプッシュ

5. **デプロイを実行**

   Actions タブから "Deploy Server" ワークフローを手動実行（Run workflow）

6. **APIキーを設定**

   デプロイ後、Cloudflare ダッシュボードまたは CLI で API キーを設定：
   ```bash
   bunx wrangler secret put API_KEY
   ```

#### 方法2: 手動デプロイ

```bash
cd packages/server

# APIキーを設定（初回のみ）
bunx wrangler secret put API_KEY

# デプロイ
bun run deploy
```

デプロイ成功後、Workers の URL（例: `https://obsidian-sync-workers.your-account.workers.dev`）が表示されます。この URL をプラグインの設定で使用します。

## ローカル開発

```bash
cd packages/server

# 開発サーバーを起動
bun run dev
```

サーバーは `http://localhost:8787` で起動します。

### 動作確認

```bash
# ヘルスチェック
curl http://localhost:8787/

# ステータス確認（認証必要）
curl -H "Authorization: Bearer your-api-key" \
  "http://localhost:8787/api/status?vault_id=default"

# ドキュメント作成テスト
curl -X PUT http://localhost:8787/api/docs/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"_id": "test", "content": "Hello, World!"}'
```

## トラブルシューティング

### 500 Internal Server Error

- `API_KEY` 環境変数が設定されていない可能性があります
- ローカル: `.dev.vars` ファイルを確認
- 本番: `wrangler secret put API_KEY` で設定

### 401 Unauthorized

- APIキーが一致していません
- `Authorization: Bearer <key>` ヘッダーが正しく送信されているか確認
- サーバーとプラグインで同じAPIキーを使用しているか確認

### D1データベースエラー

- `database_id` が正しく設定されているか確認
- スキーマが適用されているか確認（`bun run db:init`）

### CORSエラー

- プラグインからのアクセスでCORSエラーが発生する場合、通常は設定不要です
- 特定のオリジンに制限したい場合は `wrangler.jsonc` の `vars.CORS_ORIGIN` を設定

## 次のステップ

サーバーのセットアップが完了したら、[プラグインのセットアップ](../plugin/README.md)に進んでください。
