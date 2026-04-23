-- =====================================================
-- テイクバック流通 v2 - 委託販売対応
-- 委託先管理・手数料率・返却フロー
-- =====================================================

-- 商品テーブルに委託販売関連カラムを追加
ALTER TABLE items ADD COLUMN IF NOT EXISTS commission_rate INT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS commission_type TEXT DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS return_status TEXT DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS return_reason TEXT DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS return_date TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS consignment_partner TEXT DEFAULT '';

-- 委託レポート用インデックス
CREATE INDEX IF NOT EXISTS idx_items_consignment_partner ON items(consignment_partner) WHERE consignment_partner != '';
CREATE INDEX IF NOT EXISTS idx_items_return_status ON items(return_status) WHERE return_status != '';
