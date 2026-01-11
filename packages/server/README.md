# Obsidian Sync Workers

シンプルなObsidian同期サーバー実装 - Cloudflare WorkersとD1を使用

## 概要

このプロジェクトは、[obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync)のシンプル版として、Cloudflare WorkersとD1データベースを使って実装されたObsidian同期サーバーです。

### 主な機能

- ✅ ドキュメントのCRUD操作
- ✅ リビジョン管理と競合検出
- ✅ 変更フィード（増分同期）
- ✅ 論理削除
- ✅ 一括ドキュメント操作
- ✅ マルチVault対応

## アーキテクチャ

```
Obsidian Client
    ↓
Cloudflare Workers (Elysia Framework)
    ↓
D1 Database (SQLite)
```

## セットアップ

### 前提条件

- Node.js 24 (LTS) 以上
- Cloudflareアカウント
- Wrangler CLI

### 1. 依存関係のインストール

```bash
npm install
```

### 2. D1データベースの作成

```bash
# D1データベースを作成
wrangler d1 create obsidian-sync

# 出力されたdatabase_idをwrangler.tomlに設定
# [[d1_databases]]セクションのdatabase_idを更新してください
```

### 3. データベーススキーマの適用

```bash
# 本番環境
npm run db:init

# ローカル開発環境
npm run db:local
```

### 4. ローカル開発サーバーの起動

```bash
npm run dev
```

サーバーは `http://localhost:8787` で起動します。

### 5. デプロイ

#### 手動デプロイ

```bash
npm run deploy
```

#### 自動デプロイ（GitHub Actions）

mainブランチにpushすると自動的にCloudflare Workersにデプロイされます。

**必要なGitHubシークレットの設定:**

1. GitHubリポジトリの Settings → Secrets and variables → Actions を開く
2. 以下のシークレットを追加:

| シークレット名 | 説明 | 取得方法 |
|--------------|------|---------|
| `CLOUDFLARE_API_TOKEN` | CloudflareのAPIトークン | [Cloudflareダッシュボード](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Edit Cloudflare Workers テンプレートを使用 |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID | [Cloudflareダッシュボード](https://dash.cloudflare.com/) → 右サイドバーに表示されているAccount ID |

**ローカル開発環境の設定:**

```bash
# .dev.vars.exampleをコピー
cp .dev.vars.example .dev.vars

# .dev.varsを編集して環境変数を設定
# API_KEY=your-secret-key
```

## API リファレンス

### ドキュメント操作

#### GET /api/docs/:id

ドキュメントを取得

```bash
curl http://localhost:8787/api/docs/my-note?vault_id=default
```

レスポンス:
```json
{
  "_id": "my-note",
  "_rev": "1-abc123",
  "content": "# My Note\nContent here",
  "_deleted": false
}
```

#### PUT /api/docs/:id

ドキュメントを作成または更新

```bash
curl -X PUT http://localhost:8787/api/docs/my-note \
  -H "Content-Type: application/json" \
  -d '{
    "_id": "my-note",
    "content": "# Updated Note\nNew content",
    "_rev": "1-abc123"
  }'
```

レスポンス:
```json
{
  "ok": true,
  "id": "my-note",
  "rev": "2-def456"
}
```

#### DELETE /api/docs/:id

ドキュメントを削除（論理削除）

```bash
curl -X DELETE "http://localhost:8787/api/docs/my-note?rev=2-def456&vault_id=default"
```

#### POST /api/docs/bulk_docs

一括ドキュメント操作

```bash
curl -X POST http://localhost:8787/api/docs/bulk_docs \
  -H "Content-Type: application/json" \
  -d '{
    "docs": [
      {
        "_id": "note1",
        "content": "Content 1"
      },
      {
        "_id": "note2",
        "content": "Content 2"
      }
    ]
  }'
```

### 変更フィード

#### GET /api/changes

変更リストを取得（同期用）

```bash
curl "http://localhost:8787/api/changes?since=0&limit=100&vault_id=default"
```

レスポンス:
```json
{
  "results": [
    {
      "seq": 1,
      "id": "note1",
      "changes": [{"rev": "1-abc123"}]
    },
    {
      "seq": 2,
      "id": "note2",
      "changes": [{"rev": "1-def456"}],
      "deleted": true
    }
  ],
  "last_seq": 2
}
```

### デバッグ（ローカル環境専用）

#### GET /api/debug/docs

すべてのドキュメントを取得するデバッグ用エンドポイントです。

**⚠️ 重要: このエンドポイントは本番環境では有効にしないでください。**

- 認証なしでアクセス可能な状態で公開すると、第三者が特定の `vault_id` の全ノートを取得・列挙できてしまいます。
- 本番で利用する場合は、強力な認証/認可の背後に置くか、ワーカー自体を内部ネットワーク/ローカル環境のみに限定してください。
- Cloudflare Workers をパブリック URL にデプロイする際は、この `/api/debug/docs` ルートを無効化するか、アクセス制御を必ず設定してください。

以下の例は「ローカル開発環境でのみ」利用することを想定しています。

```bash
curl "http://localhost:8787/api/debug/docs?vault_id=default&limit=10"
```

## データベーススキーマ

### documents テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT | ドキュメントID（プライマリキー） |
| vault_id | TEXT | Vault識別子 |
| content | TEXT | ドキュメント内容 |
| rev | TEXT | リビジョン番号 |
| deleted | INTEGER | 削除フラグ（0 or 1） |
| created_at | INTEGER | 作成タイムスタンプ |
| updated_at | INTEGER | 更新タイムスタンプ |

### revisions テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | INTEGER | 自動採番ID |
| doc_id | TEXT | ドキュメントID |
| rev | TEXT | リビジョン番号 |
| content | TEXT | その時点のドキュメント内容 |
| deleted | INTEGER | 削除フラグ |
| created_at | INTEGER | 作成タイムスタンプ |

### changes テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| seq | INTEGER | シーケンス番号（自動採番） |
| doc_id | TEXT | ドキュメントID |
| rev | TEXT | リビジョン番号 |
| deleted | INTEGER | 削除フラグ |
| vault_id | TEXT | Vault識別子 |
| created_at | INTEGER | 作成タイムスタンプ |

## リビジョン管理

リビジョンは `{generation}-{hash}` の形式です：

- 例: `1-abc123`, `2-def456`, `3-xyz789`
- `generation`は更新ごとにインクリメント
- `hash`はタイムスタンプとランダム値から生成

### 競合検出

ドキュメント更新時に、提供された `_rev` が現在のリビジョンと一致しない場合、409 Conflictエラーを返します。

## セキュリティ

### API認証（オプション）

環境変数 `API_KEY` を設定することで、API認証を有効化できます：

1. `wrangler.toml` の `[vars]` セクションに設定、または
2. Cloudflareダッシュボードで環境変数を設定

```toml
[vars]
API_KEY = "your-secret-api-key"
```

認証ヘッダー:
```bash
curl -H "Authorization: Bearer your-secret-api-key" \
  http://localhost:8787/api/docs/my-note
```

**⚠️ セキュリティ上の重要な注意:**
- APIキーなどの認証情報は、必ず `Authorization: Bearer ...` ヘッダーで送信してください。
- クエリパラメータ（例: `?api_key=...`）での送信は**絶対に避けてください**。
- クエリパラメータに含めると、サーバーやプロキシのアクセスログ、ブラウザの履歴、リファラーヘッダーなどにAPIキーが残り、セキュリティリスクとなります。

`src/index.ts` の認証ミドルウェアのコメントを解除して有効化してください。

## 制限事項

現在のバージョンでは以下の機能は実装されていません：

- アタッチメント/バイナリファイル対応
- WebSocketによるリアルタイム通知
- エンドツーエンド暗号化
- CouchDBのview/query機能

## 開発

### プロジェクト構成

```
obsidian-sync-workers/
├── src/
│   ├── index.ts           # Workerエントリーポイント
│   ├── types.ts           # TypeScript型定義
│   ├── routes/
│   │   ├── documents.ts   # ドキュメントAPI
│   │   └── changes.ts     # 変更フィードAPI
│   ├── db/
│   │   ├── schema.sql     # D1スキーマ
│   │   └── queries.ts     # データベースクエリ
│   └── utils/
│       ├── revision.ts    # リビジョン管理
│       └── auth.ts        # 認証ヘルパー
├── wrangler.toml          # Cloudflare設定
├── package.json
└── tsconfig.json
```

### テスト

基本的な動作確認:

```bash
# サーバー起動
npm run dev

# ドキュメント作成
curl -X PUT http://localhost:8787/api/docs/test1 \
  -H "Content-Type: application/json" \
  -d '{"_id": "test1", "content": "Test content"}'

# ドキュメント取得
curl http://localhost:8787/api/docs/test1

# 変更フィード確認
curl http://localhost:8787/api/changes

# すべてのドキュメント確認
curl http://localhost:8787/api/debug/docs
```

## ライセンス

MIT

## 参考

- [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) - オリジナルプロジェクト
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Elysia](https://elysiajs.com/)
