# Plugin Claudeメモ

Obsidianプラグイン側の開発メモ。

## 概要

- Obsidianクライアントからサーバーへ同期
- Pull/Pushと変更フィードによる増分同期
- 競合時は自動マージ + モーダルで選択
- アタッチメント同期（R2）に対応

## 開発コマンド

```bash
# 開発モード
bun run dev

# ビルド
bun run build
```

## 設定項目

- **Server URL**: サーバーのURL
- **Vault ID**: Vault識別子（デフォルト: `default`）
- **Auto sync**: 自動同期の有効化
- **Sync interval**: 自動同期の間隔（分）

## 同期フロー（概要）

1. 変更フィードから差分を取得
2. ローカル変更をPush
3. 競合は3-way mergeで自動解決、失敗時はUIで選択
4. メタデータに`baseContent`を保存して次回マージに使用

## 競合解決UI

- **ローカル版を使用**: ローカルの変更を優先して強制プッシュ
- **リモート版を使用**: サーバー版を受け入れてローカルを更新
- **キャンセル**: 同期をスキップ

## アタッチメント同期

- SHA-256ハッシュで重複検出
- 親フォルダを自動作成
- 変更フィードにより差分同期

## 主要ファイル

- `main.ts` - プラグインエントリーポイント
- `sync-service.ts` - 同期ロジック
- `settings.ts` - 設定UI
- `conflict-modal.ts` - 競合解決UI
- `types.ts` - 型定義
