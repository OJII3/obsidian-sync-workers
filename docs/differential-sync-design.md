# 差分同期 設計ドキュメント

## 概要

ファイル全体を送受信する現在の同期方式から、差分のみを送受信する方式への移行計画。

## 現状分析

### 現在のデータフロー

```
[Push時]
プラグイン: vault.read(file) → 全文content
    ↓
API: POST /api/docs/bulk_docs { content: "全文..." }
    ↓
サーバー: documents.content に全文保存

[Pull時]
API: GET /api/docs/{id}
    ↓
サーバー: documents.content から全文取得
    ↓
プラグイン: vault.modify(file, 全文content)
```

### 変更検出の現状

| 対象 | 検出方法 | 精度 |
|------|----------|------|
| ドキュメント | `file.stat.mtime > metadata.lastModified` | 低（タイムスタンプのみ）|
| アタッチメント | `SHA-256 hash` | 高（コンテンツベース）|

### 問題点

1. **変更検出が粗い**: mtimeだけでは偽陽性が多い
2. **通信量が多い**: 1文字の変更でも全文を送信
3. **リビジョン履歴が肥大**: 全文を毎回保存

---

## Phase 0: 差分同期の土台整備

差分同期を導入する前に、以下の課題を解決する。

### 課題1: contentHashをメタデータに追加

**プラグイン側 (`types.ts`)**

```typescript
// Before
export interface DocMetadata {
  path: string;
  rev: string;
  lastModified: number;
}

// After
export interface DocMetadata {
  path: string;
  rev: string;
  lastModified: number;
  contentHash?: string;  // SHA-256 hash of content
}
```

**サーバー側 (`schema.sql`)**

```sql
-- 既存テーブルにカラム追加
ALTER TABLE documents ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
```

### 課題2: 変更検出のハッシュベース化

**プラグイン側の変更検出ロジック (`sync-service.ts`)**

```typescript
// Before: mtimeのみで判定
if (!metadata || fileModTime > metadata.lastModified) {
  // 変更ありとして処理
}

// After: ハッシュで正確に判定
const content = await this.vault.read(file);
const contentHash = await this.generateTextHash(content);

if (!metadata || contentHash !== metadata.contentHash) {
  // 実際に内容が変わった場合のみ処理
}
```

**ハッシュ生成関数**

```typescript
// 既存のgenerateHash(ArrayBuffer)を参考に、テキスト用を追加
private async generateTextHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

### 課題3: 差分フォーマットの選定

#### 候補比較

| フォーマット | 長所 | 短所 | 3-way merge親和性 |
|-------------|------|------|------------------|
| **行ベース差分** | 現在のmerge.tsと整合 | 行内変更に弱い | ◎ 最高 |
| unified diff | git互換、可読性高い | パース必要 | ○ 良い |
| JSON Patch | RFC標準、構造化 | テキスト向きでない | △ 要変換 |

#### 推奨: 行ベース差分

現在の3-way mergeが行ベース（LCS）で実装されているため、差分も行ベースが最も自然。

**差分データ構造案**

```typescript
interface LineDiff {
  type: "line-diff";
  baseHash: string;       // 差分適用前のハッシュ
  resultHash: string;     // 差分適用後のハッシュ
  changes: DiffChange[];  // 既存のmerge.tsと同じ形式
}

interface DiffChange {
  baseStart: number;  // 変更開始行（0-indexed）
  baseEnd: number;    // 変更終了行（exclusive）
  newLines: string[]; // 新しい内容
}
```

**merge.tsの`computeDiff`関数を再利用可能**

```typescript
// 既にmerge.tsに実装済み
function computeDiff(base: string[], modified: string[]): Diff {
  // LCSベースの差分計算
}
```

---

## Phase 0 実装順序

### Step 1: 型定義の更新（破壊的変更なし）

1. `DocMetadata` に `contentHash?: string` を追加
2. `DocumentInput` に `_content_hash?: string` を追加
3. `DocumentResponse` に `content_hash?: string` を追加

### Step 2: サーバー側スキーマ更新

1. `documents` テーブルに `content_hash` カラム追加
2. 既存ドキュメントは `NULL` のまま（後方互換性）
3. 新規・更新時にハッシュを計算して保存

### Step 3: プラグイン側ハッシュ計算

1. `generateTextHash()` 関数を追加
2. push時にハッシュを計算
3. メタデータキャッシュにハッシュを保存
4. 変更検出ロジックを更新（mtime + hash）

### Step 4: 後方互換性の確保

1. サーバー: `content_hash` がなくても動作
2. プラグイン: 古いメタデータ（hashなし）でも動作
3. 段階的にハッシュ付きデータに移行

---

## 検証項目

### Phase 0 完了条件

- [ ] `contentHash` がメタデータに保存される
- [ ] 変更検出がハッシュベースで動作する
- [ ] 既存の同期機能が壊れていない（リグレッションなし）
- [ ] `computeDiff` が差分計算に使える（merge.tsの検証）

### テストシナリオ

1. **ファイル更新**: 内容変更 → ハッシュ変更 → 同期される
2. **ファイル保存のみ**: mtime変更、内容同じ → ハッシュ同じ → スキップ
3. **新規ファイル**: ハッシュ計算 → 正常に同期
4. **削除**: メタデータからハッシュも削除

---

## Phase 1以降の展望（参考）

Phase 0完了後、以下を段階的に実装:

1. **Phase 1**: Pull時の差分取得
   - サーバーが差分を返すオプション追加
   - プラグインが差分を適用

2. **Phase 2**: Push時の差分送信
   - プラグインが差分のみ送信
   - サーバーが差分を適用して保存

3. **Phase 3**: リビジョン履歴の差分化
   - revisionsテーブルを差分保存に変更
   - ストレージ効率の大幅改善

---

## 参考: 現在のファイル構成

```
packages/
├── server/
│   └── src/
│       ├── db/
│       │   ├── schema.sql      ← content_hash追加
│       │   └── queries.ts      ← ハッシュ保存ロジック
│       ├── utils/
│       │   └── merge.ts        ← computeDiff再利用
│       └── index.ts            ← API更新
└── plugin/
    ├── types.ts                ← DocMetadata更新
    └── sync-service.ts         ← 変更検出ロジック更新
```
