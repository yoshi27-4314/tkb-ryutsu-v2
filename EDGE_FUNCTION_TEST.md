# Edge Function テスト結果レポート

**テスト日時**: 2026-04-22
**対象**: AWAI Supabase Edge Functions (njdnfvlucwasrafoepmu.supabase.co)
**テスト元**: テイクバック流通 v2 アプリ

---

## 1. takeback-judge (step: 'judge') - AI分荷判定

### テスト結果
- **HTTP Status**: 400
- **レスポンス**: `{"error":"image or book context is required"}`
- **判定**: 画像なしではエラー（正常な動作）

### Edge Functionが期待するリクエスト形式（現行app.js準拠）
```json
{
  "image": "base64画像データ",
  "images": ["base64画像データ1", "base64画像データ2"],
  "step": "judge",
  "context": { "rejudgeReason": "理由（再判定時のみ）" }
}
```

### v2 (intake/index.js) が送るリクエスト形式
```json
{
  "image": "base64画像データ",
  "images": ["base64画像データ"],
  "step": "judge",
  "context": {
    "staffName": "スタッフ名",
    "sourceId": "仕入先ID",
    "bookInfo": { "isbn": "ISBN" }
  }
}
```

### レスポンス形式（step=book テストより確認）
```json
{
  "success": true,
  "judgment": {
    "productName": "商品名",
    "maker": "メーカー",
    "modelNumber": "型番",
    "category": "カテゴリ",
    "channel": "チャンネル名",
    "channelNumber": 6,
    "estimatedPrice": { "min": 1000, "max": 2000 },
    "startPrice": 1500,
    "condition": "B",
    "conditionNote": "状態の補足",
    "estimatedSize": "サイズ文字列",
    "shippingSize": 100,
    "needsApproval": false,
    "approvalReason": null,
    "score": 25,
    "productType": "no_check",
    "checkItems": ["確認項目1", "確認項目2"],
    "needsMorePhotos": true,
    "morePhotosReason": "理由",
    "photoGuide": [{ "title": "...", "description": "..." }],
    "listingTitle": "出品タイトル",
    "listingDescription": "出品説明文"
  }
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **v2のレスポンスフィールド名が不一致** | Edge Functionは `estimatedPrice.min`/`.max` を返すが、v2は `r.estimatedPriceMin`/`r.estimatedPriceMax` で参照している | **重大** |
| **v2のDB保存カラム名が2パターン混在** | `handleConfirm()`では `condition`、`handleConsult()`では `condition_rank` と異なるカラム名でDBに保存している | **重大** |
| **v2のDB保存カラム名が2パターン混在(2)** | `handleConfirm()`では `ai_confidence: String(r.confidence)`、`handleConsult()`では `ai_confidence: r.confidence` と型が異なる | 中 |
| **v2のDB保存カラム名が2パターン混在(3)** | `handleConfirm()`では `memo: r.explanation`、`handleConsult()`では `ai_explanation: r.explanation` | 中 |
| **v2のDB保存カラム名が2パターン混在(4)** | `handleConfirm()`では `listing_account: state.sourceType`、`handleConsult()`には source_type/source_category がある | 中 |
| **v2のchannelフィールド名** | Edge Functionは `judgment.channel` を返すが、v2は `handleConfirm()`で `r.channel` → `channel_name` にマッピング。OK | - |

---

## 2. takeback-judge (step: 'book') - ISBN書籍検索

### テスト結果
- **HTTP Status**: 200
- **レスポンス**: 正常。上記のjudgment形式で返却
- **判定**: 正常動作

### Edge Functionが期待するリクエスト形式
```json
{
  "image": null,
  "step": "book",
  "context": { "bookInfo": "書籍名: ...\n著者: ...\n出版社: ...\nISBN: ..." }
}
```

### v2 (intake/index.js) が送るリクエスト形式
```json
{
  "image": "base64画像データ",
  "images": ["base64画像データ"],
  "step": "book",
  "context": {
    "staffName": "...",
    "sourceId": "...",
    "bookInfo": { "isbn": "9784101010014" }
  }
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **bookInfo形式の不一致** | 現行アプリは `context.bookInfo` に書籍情報をテキスト文字列で送る。v2は `{ isbn: "..." }` オブジェクトで送る。Edge Functionがテキストを期待している場合、AIが正確に判定できない可能性あり | **重大** |

---

## 3. takeback-judge (step: 'chat') - AIチャット相談

### テスト結果
- **HTTP Status**: 200
- **レスポンス**: `{"success":true,"raw":"申し訳ございませんが..."}`
- **判定**: 正常動作

### Edge Functionが期待するリクエスト形式（現行app.js準拠）
```json
{
  "image": null,
  "step": "chat",
  "context": { "question": "質問文", "staffName": "名前" }
}
```

### v2 (ops/index.js) が送るリクエスト形式
```json
{
  "message": "質問文",
  "context": {
    "staffName": "名前",
    "department": "テイクバック"
  }
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **stepフィールドが欠落** | v2は `step: 'chat'` を送っていない。`message` フィールドで送信しているが、Edge Functionは `step` フィールドでルーティングしている | **致命的** |
| **questionフィールド名が違う** | 現行は `context.question`、v2は `message`（トップレベル） | **致命的** |
| **レスポンスフィールド名** | Edge Functionは `raw` フィールドで返すが、v2は `data.reply` を参照している | **致命的** |
| テスト確認 | `message` フィールドだけ送った場合 → 400エラー `"image or book context is required"` | **致命的** |

---

## 4. takeback-judge (step: 'receipt') - レシートOCR

### テスト結果
- **HTTP Status**: 400
- **レスポンス**: `{"error":"image or book context is required"}`
- **判定**: 画像なしではエラー（正常な動作）

### Edge Functionが期待するリクエスト形式
```json
{
  "image": "base64画像データ",
  "step": "receipt"
}
```

### v2 (ops/index.js) が送るリクエスト形式
```json
{
  "image": "base64画像データ"
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **stepフィールドが欠落** | v2のレシートOCR（経費精算）は `step` を送っていない。Edge Functionは `step` でルーティングするため、画像だけ送ると商品判定（`step: 'judge'`）として処理される可能性がある | **重大** |
| **レスポンスフィールド名** | v2は `result.date`, `result.store`, `result.amount`, `result.taxRate`, `result.category`, `result.invoiceNumber` を参照。Edge Functionがreceiptモードでこの形式を返すか不明 | **要確認** |

---

## 5. takeback-judge (type: 'transaction') - 取引ナビOCR

### テスト結果
- **HTTP Status**: 400
- **レスポンス**: `{"error":"image or book context is required"}`（画像なし）
- **判定**: 画像必須は正常。ただし `type` フィールドの認識が不明

### Edge Functionが期待するリクエスト形式（現行は直接テストできず）
```
不明 - 現行app.jsにはtransaction OCRのコードなし
```

### v2 (trade/index.js) が送るリクエスト形式
```json
{
  "image": "base64画像データ",
  "type": "transaction"
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **`type`フィールドは非標準** | Edge Functionは `step` フィールドでルーティングしている。`type` フィールドは認識されない可能性が高い | **致命的** |
| **レスポンス形式の期待** | v2は `result.success` + `result.data` 形式を期待（`data.mgmt_num`, `data.sold_price` 等）。Edge Functionが `success` + `judgment` 形式で返す場合、不整合 | **致命的** |

---

## 6. takeback-judge (type: 'tracking') - 送り状OCR

### テスト結果
- **HTTP Status**: 400（画像なしのため想定内）
- **判定**: `step: 'tracking'` は認識されるが画像必須

### Edge Functionが期待するリクエスト形式（現行app.js準拠）
```json
{
  "image": "base64画像データ",
  "step": "tracking",
  "context": { "task": "送り状から追跡番号と運送会社を読み取ってください..." }
}
```

### v2 (trade/index.js) が送るリクエスト形式
```json
{
  "image": "base64画像データ",
  "type": "tracking"
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **`type` vs `step`** | 現行は `step: 'tracking'`。v2は `type: 'tracking'` を使用 | **致命的** |
| **contextが欠落** | 現行はcontextにタスク指示を含める。v2は含めていない | 中 |
| **レスポンス形式** | v2は `result.success` + `result.data.tracking_number` + `result.data.carrier` を期待。現行は `result.success` + `result.judgment` を期待 | **要確認** |

---

## 7. takeback-judge - AI出品タイトル/説明文生成

### v2 (sales/index.js) が送るリクエスト形式
```json
{
  "productName": "商品名",
  "maker": "メーカー",
  "condition": "B",
  "channel": "ヤフオク",
  "photos": []
}
```

### テスト結果
- **HTTP Status**: 400
- **レスポンス**: `{"error":"image or book context is required"}`
- **判定**: `step` フィールドがないため、Edge Functionがリクエストを拒否

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **stepフィールドが欠落** | v2のAI生成リクエストには `step` がない。`image` も `null` でない場合のみ受け付けるため、画像なしでタイトル/説明文だけ生成できない | **致命的** |
| **レスポンスフィールド名** | v2は `data.title` と `data.description` を期待。Edge Functionは `judgment.listingTitle` と `judgment.listingDescription` で返す | **致命的** |

---

## 8. takeback-drive - Google Drive アップロード

### テスト結果
- 空配列: **HTTP 400** `{"error":"managementNumber and images are required"}` -- 正常
- base64画像付き: **HTTP 500** `{"error":"ASN.1 DER message is incomplete..."}` -- サービスアカウント鍵の問題

### Edge Functionが期待するリクエスト形式（現行app.js準拠）
```json
{
  "managementNumber": "2603-0001",
  "images": [
    { "data": "base64データ", "name": "01_商品.jpg", "mimeType": "image/jpeg" }
  ]
}
```

### v2 (intake/index.js) が送るリクエスト形式
```json
{
  "managementNumber": "管理番号",
  "images": ["base64データ（文字列）"]
}
```

### 不整合・要修正点
| 問題箇所 | 詳細 | 重大度 |
|---------|------|-------|
| **images配列の形式が違う** | 現行はオブジェクト配列 `[{data, name, mimeType}]`、v2は文字列配列 `["base64..."]` | **重大** |
| **500エラー** | Google Drive のサービスアカウント鍵に問題あり（ASN.1 DERエラー）。これはEdge Function側の設定問題で、v2の問題ではない | **重大（インフラ）** |

---

## 9. takeback-data - データ取得

### テスト結果
- **HTTP Status**: 200
- **レスポンス**: `{"success":true,"data":{"ok":true,"sheets":[{"name":"商品マスタ","headers":[...],"rows":[...]}]}}`
- **判定**: 正常動作

### v2での利用状況
v2のコードには `takeback-data` の呼び出しが見つからない。v2はSupabase DB（firsteight-group）を直接参照しているため、スプレッドシート経由の `takeback-data` は不要と思われる。

### 備考
| 項目 | 詳細 |
|------|------|
| 利用要否 | v2では不使用。現行app.jsでのみ使用 |

---

## 10. freee-api - freee勤怠連携

### テスト結果
- `action: 'test'`: **HTTP 400** `{"error":"Invalid action. Use: employees, employee_detail, work_record, work_summary"}`
- `action: 'employees'`: **HTTP 401** `{"error":"認証が必要です。管理画面からfreee連携を行ってください。","needsAuth":true}`
- **判定**: Edge Function自体は動作。freee認証トークンが期限切れまたは未設定

### v2での利用状況
v2のコードには `freee-api` の呼び出しが見つからない。

### 備考
| 項目 | 詳細 |
|------|------|
| 利用要否 | v2では現時点で不使用。ただし ops/index.js の勤怠モジュールに `freeeFlag` の表示があるため、将来的にfreee連携を実装する際は必要 |

---

## まとめ: 致命的な不整合一覧

### v2が壊れている箇所（修正必須）

| # | モジュール | 問題 | 影響 |
|---|----------|------|------|
| 1 | **intake** | `estimatedPriceMin`/`Max` の参照。Edge Functionは `estimatedPrice.min`/`.max` で返す | 価格が表示されない |
| 2 | **intake** | `handleConfirm()` と `handleConsult()` で DB カラム名が不統一（condition vs condition_rank等） | DB保存時のカラム不整合 |
| 3 | **intake** | bookInfoをオブジェクトで送信。現行はテキスト文字列 | 書籍判定の精度低下 |
| 4 | **sales** | AI生成リクエストに `step` がなく、`image` もない。400エラーで失敗する | **AI生成が全く動かない** |
| 5 | **sales** | レスポンスの `data.title`/`data.description` を参照しているが、実際は `judgment.listingTitle`/`judgment.listingDescription` | タイトル/説明文が取得できない |
| 6 | **trade** | OCRリクエストで `type` フィールドを使用。Edge Functionは `step` フィールドで分岐 | **OCRが全く動かない** |
| 7 | **trade** | OCRレスポンスの `result.data` を参照。実際は `result.judgment` | データ取得できない |
| 8 | **ops** | AIチャットで `message` フィールドを使用。Edge Functionは `step: 'chat'` + `context.question` を期待 | **AIチャットが全く動かない** |
| 9 | **ops** | AIチャットのレスポンスで `data.reply` を参照。実際は `raw` | 回答が表示されない |
| 10 | **ops** | レシートOCRに `step: 'receipt'` がない | 経費OCRが商品判定として処理される |
| 11 | **intake** | takeback-driveへのimages形式が文字列配列。現行はオブジェクト配列 `[{data, name, mimeType}]` | **Driveアップロードが失敗する可能性** |

---

## 修正方針

### intake/index.js
1. AI判定レスポンスのフィールドマッピングを修正:
   - `r.estimatedPriceMin` → `r.estimatedPrice?.min`
   - `r.estimatedPriceMax` → `r.estimatedPrice?.max`
2. `handleConfirm()` と `handleConsult()` のDBカラム名を統一
3. book判定時の `context.bookInfo` をテキスト文字列に変更
4. Drive アップロードの images 形式をオブジェクト配列に変更

### sales/index.js
1. AI生成リクエストに `step` と `image` を追加（写真がない場合はテキスト情報のみで判定）
2. レスポンスのフィールド参照を修正:
   - `data.title` → `data.judgment?.listingTitle`
   - `data.description` → `data.judgment?.listingDescription`

### trade/index.js
1. OCRリクエストの `type` → `step` に変更
2. `type: 'transaction'` → `step: 'receipt'` に変更（または新しいstep名を確認）
3. `type: 'tracking'` → `step: 'tracking'` に変更
4. レスポンスの `result.data` → `result.judgment` に変更
5. tracking OCRに `context` を追加

### ops/index.js
1. AIチャットのリクエスト形式を修正:
   - `{ message: "...", context: {...} }` → `{ image: null, step: "chat", context: { question: "...", staffName: "..." } }`
2. AIチャットのレスポンス参照を修正:
   - `data.reply` → `data.raw`
3. レシートOCRに `step: 'receipt'` を追加
4. レシートOCRのレスポンスフィールドの整合性を確認

---

## インフラ問題（Edge Function側）

| # | 問題 | 詳細 |
|---|------|------|
| 1 | takeback-drive の500エラー | Google サービスアカウント鍵の ASN.1 DER パースエラー。鍵の再設定が必要 |
| 2 | freee-api の認証切れ | freee OAuthトークンの再取得が必要（管理画面から） |
