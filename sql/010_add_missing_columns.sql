-- 不足カラムの追加（2026-04-28）
-- 出品完了時にDB更新が失敗していた根本原因

-- 発送サイズ（数値: 60/80/100/140/160/170/180/200/220/240/260）
ALTER TABLE items ADD COLUMN IF NOT EXISTS shipping_size INT;

-- 状態ランク（S/A/B/C/D）— conditionとは別に明示的なランク
ALTER TABLE items ADD COLUMN IF NOT EXISTS condition_rank TEXT DEFAULT '';

-- 写真URL配列（Google Drive保存後のURL）
ALTER TABLE items ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}';

-- 出品作業時間（秒）— listing_secondsと重複するが既存コードとの互換性のため
ALTER TABLE items ADD COLUMN IF NOT EXISTS listing_duration_seconds INT DEFAULT 0;

-- 分荷担当マーク
ALTER TABLE items ADD COLUMN IF NOT EXISTS staff_mark TEXT DEFAULT '';

-- 委託品番号
ALTER TABLE items ADD COLUMN IF NOT EXISTS partner_item_number TEXT DEFAULT '';

-- 出品メモ
-- listing_memoは009で追加済み

-- 市場需要レベル（1-3）— スキーマにあるが念のため
-- market_demandはスキーマに存在するので追加不要
