# Server Claudeメモ

Cloudflare Workers + D1 + R2 を使ったサーバー実装の開発メモ。

## 概要

- Obsidian同期サーバー（CouchDB風API）
- D1でメタデータ/変更フィード管理
- R2でアタッチメントを保存

### 主な機能

- ドキュメントCRUD
- リビジョン管理と競合検出
- 変更フィード
- 論理削除
- マルチVault対応
- 3-way mergeによる自動競合解決
- アタッチメント同期（R2）

## アーキテクチャ

```
Obsidian Client
    ↓
Cloudflare Workers (Elysia)
    ↓
D1 Database (SQLite) + R2 (Attachments)
```

## セットアップ

### 前提条件

- Bun (最新版推奨)
- Cloudflareアカウント
- Wrangler CLI

### 依存関係のインストール

```bash
bun install
```

### D1データベースの作成

```bash
wrangler d1 create obsidian-sync
# 出力されたdatabase_idをwrangler.jsoncに設定
```

### スキーマ適用

```bash
# 本番環境
bun run db:init

# ローカル開発環境
bun run db:local
```

### ローカル開発サーバー

```bash
bun run dev
```

サーバーは `http://localhost:8787` で起動します。

### デプロイ

```bash
bun run deploy
```

#### 自動デプロイ（GitHub Actions）

mainブランチへのpushで自動デプロイ。

**必要なGitHubシークレット:**

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### ローカル環境変数

```bash
cp .dev.vars.example .dev.vars
# API_KEY=your-secret-key
```

## API リファレンス

### ドキュメント操作

- `GET /api/docs/:id` - ドキュメントを取得
- `PUT /api/docs/:id` - ドキュメントを作成または更新
- `DELETE /api/docs/:id` - ドキュメントを削除
- `POST /api/docs/bulk_docs` - 一括ドキュメント操作

### 変更フィード

- `GET /api/changes` - 変更リストを取得

### アタッチメント

- `GET /api/attachments/changes` - アタッチメント変更フィード
- `GET /api/attachments/:id` - メタデータ取得
- `GET /api/attachments/:id/content` - コンテンツダウンロード
- `PUT /api/attachments/:path` - アップロード
- `DELETE /api/attachments/:path` - 削除

### デバッグ（ローカル環境専用）

- `GET /api/debug/docs` - すべてのドキュメントを取得

**⚠️ 注意:** 本番環境では無効化すること。

## データベーススキーマ（主要テーブル）

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

リビジョンは `{generation}-{hash}` の形式。

- `generation`は更新ごとにインクリメント
- `hash`はタイムスタンプとランダム値から生成

### 競合検出

ドキュメント更新時に、提供された `_rev` が現在のリビジョンと一致しない場合、409 Conflictを返す。

## セキュリティ

### API認証（必須）

環境変数 `API_KEY` の設定が必須。

```toml
[vars]
API_KEY = "your-secret-api-key"
```

**注意:** APIキーは必ず `Authorization: Bearer ...` ヘッダーで送信し、クエリパラメータでの送信は禁止。

#### APIキー生成フロー

```bash
# 32バイトのランダムキーを生成
openssl rand -hex 32
```

生成したキーを以下に設定：

- ローカル: `packages/server/.dev.vars`
- 本番: `packages/server/wrangler.jsonc` の `vars` または Cloudflare の環境変数
 - プラグイン側で **Generate API key** を使って生成し、同じ値を設定してもOK

#### 認証デバッグのポイント

- `500` の場合: `API_KEY` 未設定（サーバー側の環境変数を確認）
- `401` の場合: `Authorization` ヘッダーが欠落/不一致

```bash
curl -H "Authorization: Bearer <your-api-key>" \
  "http://localhost:8787/api/status?vault_id=default"
```

## 制限事項

- WebSocketによるリアルタイム通知（未実装）
- エンドツーエンド暗号化（未実装）
- CouchDBのview/query機能（未実装）
- 差分同期（ファイル全体同期）

## 開発

### プロジェクト構成

```
obsidian-sync-workers/
├── src/
│   ├── index.ts           # Workerエントリーポイント
│   ├── types.ts           # TypeScript型定義
│   ├── db/
│   │   ├── schema.sql     # D1スキーマ
│   │   └── queries.ts     # データベースクエリ
│   └── utils/
│       ├── revision.ts    # リビジョン管理
│       ├── auth.ts        # 認証ヘルパー
│       └── merge.ts       # 3-way merge
├── wrangler.jsonc         # Cloudflare設定
├── package.json
└── tsconfig.json
```

### テスト（手動）

```bash
bun run dev
curl -X PUT http://localhost:8787/api/docs/test1 \
  -H "Content-Type: application/json" \
  -d '{"_id": "test1", "content": "Test content"}'
curl http://localhost:8787/api/docs/test1
curl http://localhost:8787/api/changes
```

## 参考

- [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Elysia](https://elysiajs.com/)
