# Claude開発メモ

このファイルには、プロジェクトの開発に関する重要な情報と今後の課題をまとめています。

## プロジェクト概要

Obsidian同期システム（Cloudflare Workers + D1 + Obsidianプラグイン）のモノレポ。

### 技術スタック

- **ランタイム**: Bun (latest)
- **パッケージマネージャー**: Bun workspaces
- **サーバー**: Cloudflare Workers + D1 (SQLite) + R2 (Object Storage)
- **フレームワーク**: Elysia
- **プラグイン**: TypeScript + Obsidian API
- **CI/CD**: GitHub Actions

### モノレポ構造

```
packages/
├── server/          # Cloudflare Workersバックエンド
│   ├── src/
│   │   ├── index.ts         # Elysiaアプリ
│   │   ├── types.ts         # TypeScript型定義
│   │   ├── db/
│   │   │   ├── schema.sql   # D1スキーマ
│   │   │   └── queries.ts   # データベースクエリ
│   │   └── utils/
│   │       ├── revision.ts  # リビジョン管理
│   │       ├── auth.ts      # 認証ヘルパー
│   │       └── merge.ts     # 3-way mergeアルゴリズム
│   └── .dev.vars.example    # 環境変数テンプレート
└── plugin/          # Obsidianプラグイン
    └── src/
        ├── main.ts              # エントリーポイント
        ├── sync-service.ts      # 同期ロジック
        ├── document-sync.ts     # ドキュメント同期
        ├── attachment-sync.ts   # アタッチメント同期
        ├── settings.ts          # 設定UI
        ├── conflict-modal.ts    # 競合解決UI
        └── types.ts             # TypeScript型定義
```

## 開発フロー

### セットアップ

```bash
bun install
cd packages/server
bun run db:local
bun run dev
```

### ワークスペースコマンド

```bash
bun run dev:server        # サーバー開発
bun run dev:plugin        # プラグイン開発
bun run build:server      # サーバーデプロイ
bun run build:plugin      # プラグインビルド
```

### デプロイ

#### 初回デプロイ前の準備

⚠️ **重要**: 初回デプロイ前に、以下の手順でD1データベースをセットアップしてください：

1. **D1データベースの作成**
   ```bash
   cd packages/server
   wrangler d1 create obsidian-sync
   ```

2. **database_idの設定**
   - 上記コマンドの出力からdatabase_idをコピー
   - `packages/server/wrangler.jsonc`のコメントアウトされたD1設定を有効化
   - `database_id`を実際の値に置き換え

3. **テーブルの作成**
   ```bash
   wrangler d1 execute obsidian-sync --file=./src/db/schema.sql
   ```

4. **R2バケットの作成（アタッチメント同期用）**
   ```bash
   wrangler r2 bucket create obsidian-attachments
   ```
   - `packages/server/wrangler.jsonc`にR2バインディングが設定済み

#### デプロイ方法

- **自動**: mainブランチへのpushで自動デプロイ（GitHub Actions）
- **手動**: `bun run deploy` (packages/server)

#### 必要なGitHub Secrets

- `CLOUDFLARE_API_TOKEN`: Workers編集権限を持つAPIトークン
- `CLOUDFLARE_ACCOUNT_ID`: CloudflareのアカウントID

## セキュリティ上の重要事項

### デバッグエンドポイント

⚠️ `/api/debug/docs` は**本番環境では無効化すること**

- 認証なしで全ドキュメントにアクセス可能
- ローカル開発のみで使用
- 本番デプロイ前に削除または認証を追加

### API認証

- APIキーは必須（`/api/auth/new` で初回発行）
- APIキーは**必ずAuthorizationヘッダー**で送信
- クエリパラメータでの送信は禁止（ログに残る）
- `.dev.vars`ファイルは`.gitignore`に含まれている
- APIキーはプラグイン設定の **Generate API key** で取得する

## 実装済み機能

### サーバー (packages/server)

- ✅ ドキュメントCRUD操作
- ✅ リビジョン管理と競合検出
- ✅ **3-way merge による自動競合解決**
- ✅ 変更フィード（増分同期）
- ✅ 論理削除
- ✅ 一括ドキュメント操作
- ✅ マルチVault対応
- ✅ **R2によるアタッチメント（画像・バイナリファイル）保存**
- ✅ **アタッチメント変更フィード**

### プラグイン (packages/plugin)

- ✅ 同期サービス（Pull/Push）
- ✅ **競合解決UI（local/remote選択）**
- ✅ **自動マージと手動解決の組み合わせ**
- ✅ メタデータキャッシュの永続化（baseContent含む）
- ✅ ローカル削除の同期
- ✅ フォルダ作成処理
- ✅ 自動同期（設定可能な間隔）
- ✅ 設定UI（URL検証付き）
- ✅ エラーハンドリング
- ✅ **アタッチメント同期（画像、PDF、音声、動画等）**
- ✅ **SHA-256ハッシュによる重複検出**

## 未実装機能・制限事項

以下の機能は現在実装されていません：

1. **~~アタッチメント/バイナリファイル対応~~** ✅ 実装済み
   - ✅ 画像、PDF等のファイル同期（R2使用）
   - ✅ SHA-256ハッシュによる重複防止

2. **WebSocketによるリアルタイム通知**
   - 現在はポーリングベースの同期
   - Cloudflare Durableオブジェクトの検討が必要

3. **エンドツーエンド暗号化**
   - サーバー側でコンテンツが平文
   - クライアント側での暗号化/復号化が必要

4. **CouchDBのview/query機能**
   - 複雑な検索・フィルタリング

5. **~~競合解決UI~~** ✅ 実装済み
   - ~~現在はサーバー側で最初の更新が優先~~
   - ✅ 3-way mergeによる自動マージ
   - ✅ マージ失敗時のユーザー選択UI
   - ✅ local/remote版の選択可能

6. **差分同期**
   - 現在はファイル全体を同期
   - 大きなファイルの効率的な同期のために必要

## 既知の課題

### プラグイン

1. **メタデータキャッシュのサイズ**
   - 大量のファイルでパフォーマンスに影響の可能性
   - 定期的なクリーンアップ機構が必要かも

2. **同期の粒度**
   - ファイル単位でしか同期できない
   - セクション単位の同期は未対応

3. **ネットワークエラーのリトライ**
   - 現在は単純にエラーを表示
   - 指数バックオフでのリトライ実装を検討

### サーバー

1. **D1のクエリ制限**
   - 1クエリあたり最大1000行
   - 大規模Vaultでの動作に注意

2. **レート制限**
   - 現在未実装
   - 悪意あるリクエストへの対策が必要

3. **認証機構**
   - APIキー認証は必須
   - OAuth等の本格的な認証は未実装

4. **3-way mergeの制限**
   - 行ベースのマージのため、同じ行内の競合は検出できない
   - 大きなファイルではパフォーマンスに影響の可能性

## 今後の開発方針

### 優先度: 高

1. **認証機構の強化**
   - 本番環境での利用を考慮
   - ユーザー単位のアクセス制御

2. **エラーハンドリングの改善**
   - ネットワークエラーのリトライ
   - より詳細なエラーメッセージ

3. **テストの追加**
   - サーバー側のユニットテスト
   - プラグインの統合テスト

### 優先度: 中

1. **パフォーマンス最適化**
   - 差分同期の実装
   - バッチ処理の最適化

2. **~~競合解決UIの実装~~** ✅ 実装済み
   - ✅ ファイル競合時のマージ支援

3. **監視・ログ機能**
   - Cloudflare Analyticsとの連携
   - エラーログの集約

### 優先度: 低

1. **~~アタッチメント対応~~** ✅ 実装済み
   - ✅ Cloudflare R2との連携

2. **WebSocketサポート**
   - リアルタイム同期

3. **E2E暗号化**
   - プライバシー保護の強化

## 開発時の注意点

### Bun Workspaces

- `--filter`フラグでワークスペースを指定
- `workspace:*`プロトコルでワークスペース間の依存を参照
- pnpm-workspace.yamlは不要（package.jsonのworkspacesを使用）

### GitHub Actions

- 最新バージョンを使用:
  - actions/checkout@v6
  - oven-sh/setup-bun@v2
  - cloudflare/wrangler-action@v3

### コミットメッセージ

- 変更の種類を明確に（feat, fix, docs, refactor等）
- セキュリティ関連は必ず明記

## 参考リンク

- [Bun Documentation](https://bun.sh/docs)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Elysia Documentation](https://elysiajs.com/)
- [Obsidian Plugin Development](https://docs.obsidian.md/)

## 競合解決機能の詳細

### 3-way Merge アルゴリズム

サーバー側で実装された3-way mergeは、以下の3つのバージョンを比較します：

1. **Base**: 最後に同期した共通の祖先バージョン
2. **Local**: サーバー側の現在のバージョン
3. **Remote**: クライアントから送信された新しいバージョン

#### マージの動作

- **両方が同じ変更**: 自動的に受け入れる
- **片方だけが変更**: 変更を自動的に適用
- **異なる変更（競合）**: ユーザーに選択を促す

### 競合解決UI

競合が検出された場合、プラグインはモーダルを表示して以下の選択肢を提供します：

1. **ローカル版を使用**: ローカルの変更を優先してサーバーに強制プッシュ
2. **リモート版を使用**: サーバーの変更を受け入れてローカルを更新
3. **キャンセル**: 同期をスキップして、次回の同期まで保留

### 技術的な実装詳細

- `packages/server/src/utils/merge.ts`: 3-way mergeアルゴリズム
- `packages/plugin/src/conflict-modal.ts`: 競合解決UI
- `packages/plugin/src/sync-service.ts`: 競合ハンドリングロジック
- メタデータに`baseContent`を保存して、次回の同期でマージに使用

## アタッチメント同期機能の詳細

### R2ストレージ構成

アタッチメント（画像、PDF等のバイナリファイル）はCloudflare R2に保存されます：

- **バケット名**: `obsidian-attachments`
- **R2キー形式**: `{vaultId}/{sha256hash}/{filepath}`
- **メタデータ**: D1のattachmentsテーブルに保存

#### 重複排除の動作

R2キーにはファイルパスが含まれているため、**同じコンテンツ（同じSHA-256ハッシュ）でも異なるパスの場合は別々のR2オブジェクトとして保存されます**。これには以下の特徴があります：

- **利点**:
  - ファイルパスとコンテンツの完全な対応関係を維持
  - ファイルを移動/リネームした際の履歴追跡が可能
  - 特定のファイルパスに対する削除操作が明確

- **トレードオフ**:
  - 同じコンテンツを異なるパスで保存すると、ストレージ容量を消費
  - 完全なコンテンツベースの重複排除が必要な場合は、R2キー形式の変更を検討

重複排除は同一パス内でのみ機能し、異なるパスには適用されません。これは組織的な目的を優先した設計判断です。

### 対応ファイル形式

- **画像**: PNG, JPG, JPEG, GIF, BMP, SVG, WebP, ICO, AVIF
- **ドキュメント**: PDF
- **音声**: MP3, WAV, OGG, M4A, FLAC
- **動画**: MP4, WebM, MOV, AVI
- **フォント**: TTF, OTF, WOFF, WOFF2
- **アーカイブ**: ZIP, TAR, GZ, 7Z

### 同期の仕組み

1. **アップロード時**
   - ファイルのSHA-256ハッシュを計算
   - 同じハッシュが既に存在する場合はスキップ（重複防止）
   - R2にアップロード後、メタデータをD1に保存

2. **ダウンロード時**
   - attachment_changesフィードから変更を取得
   - ローカルのハッシュと比較して差分のみダウンロード
   - 親フォルダを自動作成

3. **削除時**
   - 論理削除（R2オブジェクトは保持）
   - 復元可能性を考慮

### APIエンドポイント

- `GET /api/attachments/changes` - アタッチメント変更フィード
- `GET /api/attachments/:id` - メタデータ取得
- `GET /api/attachments/:id/content` - コンテンツダウンロード
- `PUT /api/attachments/:path` - アップロード
- `DELETE /api/attachments/:path` - 削除

### 技術的な実装詳細

- `packages/server/src/db/schema.sql`: attachments, attachment_changesテーブル
- `packages/server/src/db/queries.ts`: アタッチメント用クエリメソッド
- `packages/server/src/index.ts`: R2連携APIエンドポイント
- `packages/plugin/src/sync-service.ts`: アタッチメント同期ロジック
- `packages/plugin/src/types.ts`: アタッチメント関連の型定義

## API リファレンス（サーバー）

### ドキュメント操作

- `GET /api/docs/:id` - ドキュメントを取得
- `PUT /api/docs/:id` - ドキュメントを作成または更新
- `DELETE /api/docs/:id` - ドキュメントを削除
- `POST /api/docs/bulk_docs` - 一括ドキュメント操作

### 変更フィード

- `GET /api/changes` - 変更リストを取得

### デバッグ（ローカル環境専用）

- `GET /api/debug/docs` - すべてのドキュメントを取得

### アタッチメント

- `GET /api/attachments/changes` - アタッチメント変更フィード
- `GET /api/attachments/:id` - メタデータ取得
- `GET /api/attachments/:id/content` - コンテンツダウンロード
- `PUT /api/attachments/:path` - アップロード
- `DELETE /api/attachments/:path` - 削除

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

リビジョンは `{generation}-{hash}` の形式です：

- 例: `1-abc123`, `2-def456`, `3-xyz789`
- `generation`は更新ごとにインクリメント
- `hash`はタイムスタンプとランダム値から生成

### 競合検出

ドキュメント更新時に、提供された `_rev` が現在のリビジョンと一致しない場合、409 Conflictエラーを返します。

## プラグイン開発ガイドライン

Obsidianのプラグインガイドラインに合わせ、以下を遵守します。

- UIテキストはSentence case（先頭のみ大文字、固有名詞は例外）
- 設定画面の見出しは複数セクション時のみ使用し、`setHeading` を使う
- 既定ではコンソールにエラー以外のログを出さない
- アクティブノートの更新はEditor APIを優先し、背景更新は `Vault.process` を使用

## テスト（手動）

```bash
# サーバー起動
bun run dev

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

## 最終更新

2026-01-12: R2によるアタッチメント（画像・バイナリファイル）同期機能を実装
2026-01-12: 3-way merge機能と競合解決UIを実装
2026-01-11: 初版作成（モノレポ構築、PRレビュー対応、GitHub Actions追加、Bun移行完了）
