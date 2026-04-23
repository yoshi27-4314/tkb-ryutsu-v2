-- 動作確認カラム追加
ALTER TABLE items ADD COLUMN IF NOT EXISTS operation_status TEXT DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS operation_note TEXT DEFAULT '';
