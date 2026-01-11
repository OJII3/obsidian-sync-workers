# Obsidian Sync Workers

シンプルなObsidian同期システム - Cloudflare WorkersとD1を使用したサーバーと、Obsidianプラグインのモノレポ

## 概要

このプロジェクトは、[obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync)のシンプル版として、2つのパッケージで構成されています：

1. **Server (`packages/server`)** - Cloudflare WorkersとD1データベースを使った同期サーバー
2. **Plugin (`packages/plugin`)** - Obsidianプラグイン（クライアント側）

### 主な機能

- ✅ ドキュメントのCRUD操作
- ✅ リビジョン管理と競合検出
- ✅ 変更フィード（増分同期）
- ✅ 論理削除
- ✅ 一括ドキュメント操作
- ✅ マルチVault対応
- ✅ 自動同期
- ✅ 手動同期トリガー

## アーキテクチャ

```
Obsidian Plugin (Client)
    ↓
Cloudflare Workers (Elysia Framework)
    ↓
D1 Database (SQLite)
```

## セットアップ

### 前提条件

- Bun (最新版推奨)
- Cloudflareアカウント（サーバーデプロイ用）
- Wrangler CLI

### 1. リポジトリのクローンと依存関係のインストール

```bash
git clone https://github.com/OJII3/obsidian-sync-workers.git
cd obsidian-sync-workers

# Bunを使用してインストール
bun install
```

## サーバーのセットアップ

### 1. D1データベースの作成

```bash
cd packages/server

# D1データベースを作成
wrangler d1 create obsidian-sync

# 出力されたdatabase_idをwrangler.tomlに設定
# [[d1_databases]]セクションのdatabase_idを更新してください
```

### 2. データベーススキーマの適用

```bash
# 本番環境
bun run db:init

# ローカル開発環境
bun run db:local
```

### 3. ローカル開発サーバーの起動

```bash
# packages/server ディレクトリから
bun run dev

# またはルートディレクトリから
bun run dev:server
```

サーバーは `http://localhost:8787` で起動します。

### 4. デプロイ

#### 手動デプロイ

```bash
# packages/server ディレクトリから
bun run deploy

# またはルートディレクトリから
bun run build:server
```

#### 自動デプロイ

mainブランチにpushすると、GitHub Actionsが自動的にCloudflare Workersにデプロイします。

詳細な設定方法は `packages/server/README.md` を参照してください。

## プラグインのセットアップ

### 開発モード

```bash
# packages/plugin ディレクトリから
bun run dev

# またはルートディレクトリから
bun run dev:plugin
```

開発モードでは、ファイルの変更を監視して自動的に再ビルドします。

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
3. **Vault ID** を設定（デフォルト：`default`）
4. **Auto sync** を有効化（オプション）
5. **Sync interval** を設定（分単位）
6. **Test** ボタンでサーバー接続をテスト
7. **Sync now** で手動同期を実行

## 使い方

### 手動同期

- リボンアイコンの同期ボタンをクリック
- コマンドパレット（Ctrl/Cmd+P）から "Sync now" を実行

### 自動同期

設定で **Auto sync** を有効化すると、指定した間隔で自動的に同期されます。

### コマンド

- `Sync now` - 即座に同期を実行
- `Toggle auto sync` - 自動同期のオン/オフを切り替え

## API リファレンス

### サーバーAPI

詳細は `packages/server/README.md` を参照してください。

#### ドキュメント操作

- `GET /api/docs/:id` - ドキュメントを取得
- `PUT /api/docs/:id` - ドキュメントを作成または更新
- `DELETE /api/docs/:id` - ドキュメントを削除
- `POST /api/docs/bulk_docs` - 一括ドキュメント操作

#### 変更フィード

- `GET /api/changes` - 変更リストを取得

#### デバッグ

- `GET /api/debug/docs` - すべてのドキュメントを取得

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

## プロジェクト構成

```
obsidian-sync-workers/
├── packages/
│   ├── server/              # Cloudflare Workersサーバー
│   │   ├── src/
│   │   │   ├── index.ts     # Workerエントリーポイント
│   │   │   ├── types.ts     # TypeScript型定義
│   │   │   ├── db/
│   │   │   │   ├── schema.sql   # D1スキーマ
│   │   │   │   └── queries.ts   # データベースクエリ
│   │   │   └── utils/
│   │   │       ├── revision.ts  # リビジョン管理
│   │   │       └── auth.ts      # 認証ヘルパー
│   │   ├── wrangler.toml    # Cloudflare設定
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── plugin/              # Obsidianプラグイン
│       ├── main.ts          # プラグインエントリーポイント
│       ├── sync-service.ts  # 同期サービス
│       ├── settings.ts      # 設定タブ
│       ├── types.ts         # TypeScript型定義
│       ├── manifest.json    # プラグインマニフェスト
│       ├── package.json
│       └── tsconfig.json
├── package.json             # ルートpackage.json
├── pnpm-workspace.yaml      # pnpmワークスペース設定
└── README.md
```

## トラブルシューティング

### サーバーに接続できない

1. サーバーが起動しているか確認
2. Server URLが正しいか確認
3. CORSエラーの場合、サーバー側のCORS設定を確認

### 同期が動作しない

1. Test connection で接続をテスト
2. ブラウザのコンソールログを確認
3. サーバーのログを確認

### プラグインが表示されない

1. プラグインフォルダに正しくコピーされているか確認
2. `main.js` がビルドされているか確認
3. Obsidianを再起動

## セキュリティ

### API認証（オプション）

環境変数 `API_KEY` を設定することで、API認証を有効化できます。詳細は `packages/server/README.md` を参照してください。

## 制限事項

現在のバージョンでは以下の機能は実装されていません：

- アタッチメント/バイナリファイル対応
- WebSocketによるリアルタイム通知
- エンドツーエンド暗号化
- CouchDBのview/query機能
- 競合解決UI（サーバー側で最初の更新が優先されます）

## 開発

### 両方のパッケージを同時に開発

```bash
# ターミナル1: サーバー
bun run dev:server

# ターミナル2: プラグイン
bun run dev:plugin
```

### テスト

```bash
# サーバーのテスト
cd packages/server
bun run dev

# 別のターミナルで
curl http://localhost:8787/
curl -X PUT http://localhost:8787/api/docs/test1 \
  -H "Content-Type: application/json" \
  -d '{"_id": "test1", "content": "Test content"}'
curl http://localhost:8787/api/docs/test1
curl http://localhost:8787/api/changes
```

## ライセンス

MIT

## 参考

- [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) - オリジナルプロジェクト
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Elysia](https://elysiajs.com/)
- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/)
