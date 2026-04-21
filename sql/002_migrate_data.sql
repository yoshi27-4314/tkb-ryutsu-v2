-- =====================================================
-- データ移行: 旧tkb_items → 新items テーブル
-- 全6,916件を移行。削除は一切しない。
-- Monday.comを正として、Supabaseのデータを補完
-- =====================================================

-- Step 1: 旧テーブルから新テーブルへコピー（重複除去: 最新レコードを優先）
INSERT INTO items (
  mgmt_num, product_name, maker, channel_name,
  estimated_price_min, estimated_price_max,
  condition, location, status,
  listing_title, listing_description, listing_price,
  judged_by, judged_at, listed_at, shipped_at,
  priority_score, listing_seconds,
  locked_by, locked_at, source
)
SELECT DISTINCT ON (mgmt_num)
  mgmt_num,
  COALESCE(product_name, ''),
  COALESCE(maker, ''),
  COALESCE(channel, ''),
  COALESCE(estimated_price_min, 0),
  COALESCE(estimated_price_max, 0),
  COALESCE(condition, ''),
  COALESCE(location, ''),
  COALESCE(status, '分荷確定'),
  COALESCE(listing_title, ''),
  listing_description,
  COALESCE(listing_price, 0),
  COALESCE(staff_name, ''),
  judged_at,
  listed_at,
  shipped_at,
  COALESCE(priority_score, 0),
  work_seconds,
  locked_by,
  locked_at,
  'migration'
FROM tkb_items
WHERE mgmt_num IS NOT NULL AND mgmt_num != ''
ORDER BY mgmt_num, created_at DESC  -- 最新レコードを優先
ON CONFLICT (mgmt_num) DO NOTHING;

-- Step 2: Monday.comにのみ存在する14件を追加
-- （全て「完了」済み。item_nameがMondayのname列にある）
-- これは別途APIスクリプトで実行

-- Step 3: チャンネル名の正規化
-- 旧Slack Bot時代のチャンネル名 → アカウント名
-- ヤフオクまとめはアイロンポット/ブロカント両方ありえるので、
-- 商品カテゴリ(ビンテージ系か現行品系か)で判断
UPDATE items SET channel_name = 'アイロンポット'
WHERE channel_name IN ('ヤフオクビンテージ', 'ヤフオクヴィンテージ');

UPDATE items SET channel_name = 'ブロカント'
WHERE channel_name IN ('ヤフオク現行');

UPDATE items SET channel_name = 'eBay'
WHERE channel_name IN ('eBayシングル', 'eBay(イーベイ)', 'eBayまとめ');

-- ヤフオクまとめ: そのまま残す（アイロンポット/ブロカント両方から出品される）
-- 出品時にスタッフがどちらのアカウントか選ぶ

-- Step 4: ステータスの正規化
UPDATE items SET status = '出品待ち' WHERE status IN ('撮影待ち', '出品');
UPDATE items SET status = '確認/相談' WHERE status IN ('確認／相談', '確認/打合せ', '検討/打合せ');
-- 「不明」はそのまま残す（旧データ。売れたらステータス変更する）

-- Step 5: 管理番号の採番シーケンス初期化
INSERT INTO mgmt_num_seq (prefix, last_num)
SELECT
  SUBSTRING(mgmt_num FROM 1 FOR 4) as prefix,
  MAX(CAST(SUBSTRING(mgmt_num FROM 6) AS INT)) as last_num
FROM items
WHERE mgmt_num ~ '^\d{4}-\d{4}$'
GROUP BY SUBSTRING(mgmt_num FROM 1 FOR 4)
ON CONFLICT (prefix) DO UPDATE SET last_num = GREATEST(mgmt_num_seq.last_num, EXCLUDED.last_num);

-- Step 6: 採番RPC関数
CREATE OR REPLACE FUNCTION next_mgmt_num(p_prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  v_num INT;
BEGIN
  INSERT INTO mgmt_num_seq (prefix, last_num) VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE SET last_num = mgmt_num_seq.last_num + 1
  RETURNING last_num INTO v_num;
  RETURN p_prefix || '-' || LPAD(v_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
