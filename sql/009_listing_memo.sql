-- 出品メモ（分荷者→出品担当への引き継ぎ）
ALTER TABLE items ADD COLUMN IF NOT EXISTS listing_memo TEXT DEFAULT '';
