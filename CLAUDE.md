# Claude開発メモ

このファイルには、プロジェクトの開発に関する重要な情報と今後の課題をまとめています。

## プロジェクト概要

Obsidian同期システム（Cloudflare Workers + D1 + Obsidianプラグイン）のモノレポ。

### 技術スタック

- **ランタイム**: Bun (latest)
- **パッケージマネージャー**: Bun workspaces
- **サーバー**: Cloudflare Workers + D1 (SQLite)
- **フレームワーク**: Elysia
- **プラグイン**: TypeScript + Obsidian API
- **CI/CD**: GitHub Actions

### モノレポ構造

```
packages/
├── server/          # Cloudflare Workersバックエンド
│   ├── src/
│   │   ├── index.ts         # Elysiaアプリ
│   │   ├── db/              # D1クエリ
│   │   └── utils/           # リビジョン管理
│   └── .dev.vars.example    # 環境変数テンプレート
└── plugin/          # Obsidianプラグイン
    ├── main.ts              # エントリーポイント
    ├── sync-service.ts      # 同期ロジック
    └── settings.ts          # 設定UI
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
   - `packages/server/wrangler.toml`のコメントアウトされたD1設定を有効化
   - `database_id`を実際の値に置き換え

3. **テーブルの作成**
   ```bash
   wrangler d1 execute obsidian-sync --file=./schema.sql
   ```

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

- APIキーは**必ずAuthorizationヘッダー**で送信
- クエリパラメータでの送信は禁止（ログに残る）
- `.dev.vars`ファイルは`.gitignore`に含まれている

## 実装済み機能

### サーバー (packages/server)

- ✅ ドキュメントCRUD操作
- ✅ リビジョン管理と競合検出
- ✅ 変更フィード（増分同期）
- ✅ 論理削除
- ✅ 一括ドキュメント操作
- ✅ マルチVault対応

### プラグイン (packages/plugin)

- ✅ 同期サービス（Pull/Push）
- ✅ メタデータキャッシュの永続化
- ✅ ローカル削除の同期
- ✅ フォルダ作成処理
- ✅ 自動同期（設定可能な間隔）
- ✅ 設定UI（URL検証付き）
- ✅ エラーハンドリング

## 未実装機能・制限事項

以下の機能は現在実装されていません：

1. **アタッチメント/バイナリファイル対応**
   - 画像、PDF等のファイル同期
   - 大きな課題：D1のストレージ制限

2. **WebSocketによるリアルタイム通知**
   - 現在はポーリングベースの同期
   - Cloudflare Durableオブジェクトの検討が必要

3. **エンドツーエンド暗号化**
   - サーバー側でコンテンツが平文
   - クライアント側での暗号化/復号化が必要

4. **CouchDBのview/query機能**
   - 複雑な検索・フィルタリング

5. **競合解決UI**
   - 現在はサーバー側で最初の更新が優先
   - プラグイン側でのマージUI実装が望ましい

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
   - オプショナルなAPIキー認証のみ
   - OAuth等の本格的な認証は未実装

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

2. **競合解決UIの実装**
   - ファイル競合時のマージ支援

3. **監視・ログ機能**
   - Cloudflare Analyticsとの連携
   - エラーログの集約

### 優先度: 低

1. **アタッチメント対応**
   - Cloudflare R2との連携を検討

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

## 最終更新

2026-01-11: 初版作成（モノレポ構築、PRレビュー対応、GitHub Actions追加、Bun移行完了）
