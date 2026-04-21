-- =====================================================
-- テイクバック流通 統合スキーマ v2
-- Monday.com 55カラム + 旧Slack Bot + 現行Webアプリ統合
-- =====================================================

-- 商品マスタ（中核テーブル）
CREATE TABLE IF NOT EXISTS items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mgmt_num TEXT NOT NULL UNIQUE,          -- 管理番号 YYMM-NNNN

  -- 基本情報
  product_name TEXT NOT NULL DEFAULT '',
  maker TEXT DEFAULT '',                   -- ブランド/メーカー
  model_number TEXT DEFAULT '',            -- 品番/型式
  category TEXT DEFAULT '',                -- カテゴリ
  condition TEXT DEFAULT '',               -- S/A/B/C/D
  condition_note TEXT DEFAULT '',          -- 状態詳細

  -- 判定結果
  channel_id INT,                          -- 販売チャンネルID (channels参照)
  channel_name TEXT DEFAULT '',            -- 販売チャンネル名
  estimated_price_min INT DEFAULT 0,
  estimated_price_max INT DEFAULT 0,
  start_price INT DEFAULT 0,              -- 開始価格
  target_price INT DEFAULT 0,             -- 目標価格
  priority_score NUMERIC(6,1) DEFAULT 0,  -- 優先度スコア
  ai_confidence TEXT DEFAULT '',           -- AI確信度

  -- サイズ・保管
  product_size TEXT DEFAULT '',            -- 商品サイズ(cm)
  size_category TEXT DEFAULT '',           -- 小型/中型/大型/超大型
  location TEXT DEFAULT '',               -- 保管ロケーション

  -- ステ���タス
  status TEXT NOT NULL DEFAULT '分荷確定',

  -- 出品情報
  listing_title TEXT DEFAULT '',
  listing_description TEXT DEFAULT '',
  listing_price INT DEFAULT 0,
  platform TEXT DEFAULT '',               -- ヤフオク/eBay/Amazon
  listing_account TEXT DEFAULT '',        -- 出品アカウント名
  listing_url TEXT DEFAULT '',            -- ヤフオク出品URL
  staff_mark TEXT DEFAULT '',             -- 担当マーク（〇/▽/☆等）

  -- 売上情報
  sold_price INT,                         -- 落札価格
  bid_count INT,                          -- 入札数
  view_count INT,                         -- アクセス数
  platform_fee INT,                       -- プラットフォーム手数料

  -- 出荷情報
  carrier TEXT DEFAULT '',                -- 運送会社
  tracking_number TEXT DEFAULT '',
  shipping_cost INT DEFAULT 0,
  packing_cost INT DEFAULT 0,            -- 梱包資材コスト

  -- コスト・利益
  acquisition_cost INT DEFAULT 0,         -- 仕入れ原価
  total_cost INT DEFAULT 0,               -- 総コスト
  gross_profit INT,                       -- 粗利
  net_profit INT,                         -- 純利益
  roi NUMERIC(6,2),                       -- ROI%
  profit_margin NUMERIC(6,2),             -- 利益率%

  -- 工程担当・日時
  judged_by TEXT DEFAULT '',              -- 分荷担当
  judged_at TIMESTAMPTZ,
  photo_by TEXT DEFAULT '',               -- 撮影担当
  photo_at TIMESTAMPTZ,
  photo_count INT DEFAULT 0,
  photo_seconds INT DEFAULT 0,           -- 撮影所要時間(秒)
  storage_by TEXT DEFAULT '',             -- 保管担当
  storage_at TIMESTAMPTZ,
  listed_by TEXT DEFAULT '',              -- 出品担当
  listed_at TIMESTAMPTZ,
  listing_seconds INT DEFAULT 0,         -- 出品所要時間(秒)
  sold_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,                   -- 入金確認日時
  packed_by TEXT DEFAULT '',              -- 梱包担当
  packed_at TIMESTAMPTZ,
  packing_seconds INT DEFAULT 0,         -- 梱包所要時間(秒)
  shipped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Google Drive
  drive_url TEXT DEFAULT '',              -- 写真フォルダURL
  main_photo_url TEXT DEFAULT '',         -- メイン写真URL

  -- ロック（出品作業中の排他制御）
  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  -- メタデータ
  source TEXT DEFAULT 'app',              -- データ元: app/monday/slack/import
  monday_id TEXT,                         -- Monday.comのitem ID
  memo TEXT DEFAULT '',

  -- 在庫管理
  inventory_days INT,                     -- 在庫日数
  deadline_date DATE,                     -- 在庫期限
  market_demand INT,                      -- 市場需要レベル(1-3)
  predicted_inventory_period TEXT,        -- 予測在庫期間

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at自動更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_items_mgmt_num ON items(mgmt_num);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_channel ON items(channel_name);
CREATE INDEX IF NOT EXISTS idx_items_judged_at ON items(judged_at);
CREATE INDEX IF NOT EXISTS idx_items_listed_at ON items(listed_at);
CREATE INDEX IF NOT EXISTS idx_items_locked_by ON items(locked_by) WHERE locked_by IS NOT NULL;

-- ステータス変更履歴
CREATE TABLE IF NOT EXISTS item_status_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  mgmt_num TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT DEFAULT '',
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_status_log_item ON item_status_log(item_id);
CREATE INDEX IF NOT EXISTS idx_status_log_mgmt ON item_status_log(mgmt_num);

-- 販売チャンネルマスタ
CREATE TABLE IF NOT EXISTS channels (
  id INT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  platform TEXT,                          -- ヤフオク/eBay/Amazon
  category TEXT,                          -- jisha/itaku/kojin
  target TEXT,                            -- 対象商品
  type TEXT NOT NULL DEFAULT 'tsuhan',    -- tsuhan/non-tsuhan
  is_active BOOLEAN DEFAULT true
);

INSERT INTO channels (id, name, platform, category, target, type) VALUES
  (1, 'アイロンポット', 'ヤフオク', 'jisha', 'ビンテージ単品・まとめ', 'tsuhan'),
  (2, 'ブロカント', 'ヤフオク', 'jisha', '現行品単品・まとめ', 'tsuhan'),
  (3, 'eBay', 'eBay', 'jisha', '単品・まとめ', 'tsuhan'),
  (4, 'Amazon書籍', 'Amazon', 'jisha', '書籍', 'tsuhan'),
  (10, '渡辺質店', 'ヤフオク', 'itaku', '委託品', 'tsuhan'),
  (11, 'ビッグスポーツ', 'ヤフオク', 'itaku', '委託品', 'tsuhan'),
  (20, 'シマチヨ', 'ヤフオク', 'kojin', '浅野さん指定品のみ', 'tsuhan'),
  (90, '社内利用', NULL, NULL, NULL, 'non-tsuhan'),
  (91, 'ロット販売', NULL, NULL, NULL, 'non-tsuhan'),
  (92, 'スクラップ', NULL, NULL, NULL, 'non-tsuhan'),
  (93, '廃棄', NULL, NULL, NULL, 'non-tsuhan')
ON CONFLICT (id) DO NOTHING;

-- スタッフマスタ
CREATE TABLE IF NOT EXISTS staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff',     -- admin/staff
  company TEXT DEFAULT 'テイクバック',     -- テイクバック/クリアメンテ
  work_start TIME DEFAULT '09:00',
  work_end TIME DEFAULT '16:00',
  break_minutes INT DEFAULT 60,
  off_days INT[] DEFAULT '{}',            -- 0=日,1=月...6=土
  pattern TEXT DEFAULT '',                -- 勤務パターン説明
  pin_hash TEXT,                          -- PIN認証ハッシュ
  avatar_url TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO staff (name, role, company, work_start, work_end, break_minutes, off_days, pattern) VALUES
  ('浅野儀頼', 'admin', 'テイクバック', '09:00', '18:00', 60, '{}', '管理者'),
  ('林和人', 'staff', 'テイクバック', '09:00', '16:00', 60, '{}', '週5日'),
  ('横山優', 'staff', 'テイクバック', '10:00', '16:00', 60, '{3}', '水休み'),
  ('桃井侑菜', 'staff', 'テイクバック', '11:00', '15:00', 0, '{2,4}', '月水金のみ'),
  ('伊藤佐和子', 'staff', 'テイクバック', '09:00', '15:00', 60, '{4}', '木休み'),
  ('奥村亜優李', 'staff', 'テイクバック', '10:00', '16:00', 60, '{3}', '水休み'),
  ('平野光雄', 'staff', 'クリアメンテ', '09:00', '16:00', 60, '{3}', '水休み'),
  ('松本豊彦', 'staff', 'クリアメンテ', '09:00', '16:00', 60, '{}', '週5日'),
  ('北瀬孝', 'staff', 'クリアメンテ', '09:00', '16:00', 60, '{3}', '水休み')
ON CONFLICT (name) DO NOTHING;

-- 勤怠記録
CREATE TABLE IF NOT EXISTS attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  work_date DATE NOT NULL,
  clock_in TIME,
  clock_out TIME,
  break_minutes INT DEFAULT 0,
  actual_minutes INT,                     -- 実働時間(分)
  recorded_by TEXT DEFAULT '',            -- 代筆の場合
  note TEXT DEFAULT '',
  synced_to_freee BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_name, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance(staff_name);

-- 休暇・遅刻・早退連絡
CREATE TABLE IF NOT EXISTS leave_notices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  notice_date DATE NOT NULL,
  type TEXT NOT NULL,                     -- 欠勤/遅刻/早退
  time_value TIME,                        -- 遅刻:出勤予定時刻, 早退:退勤時刻
  reason TEXT DEFAULT '',
  notified_at TIMESTAMPTZ DEFAULT NOW()
);

-- 経費精算
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'テイクバック', -- テイクバック/クリアメンテ
  expense_date DATE NOT NULL,
  store_name TEXT DEFAULT '',
  amount INT NOT NULL,
  tax_amount INT DEFAULT 0,
  tax_rate NUMERIC(4,2),                  -- 8% or 10%
  category TEXT DEFAULT '',               -- 勘定科目
  payment_method TEXT DEFAULT '現金',     -- 現金/クレジット/立替
  paid_by TEXT DEFAULT '',                -- 立替者
  invoice_number TEXT DEFAULT '',         -- インボイスT+13桁
  receipt_url TEXT DEFAULT '',            -- レシート画像URL
  memo TEXT DEFAULT '',
  is_settled BOOLEAN DEFAULT false,       -- 精算済み
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_dept ON expenses(department);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(date_trunc('month', expense_date));

-- 売上記録
CREATE TABLE IF NOT EXISTS sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID REFERENCES items(id),
  mgmt_num TEXT,
  sold_price INT NOT NULL,
  platform TEXT DEFAULT '',
  account_name TEXT DEFAULT '',
  sold_at TIMESTAMPTZ DEFAULT NOW(),
  platform_fee INT DEFAULT 0,
  shipping_cost INT DEFAULT 0,
  gross_profit INT,
  recorded_by TEXT DEFAULT '',
  screenshot_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);

-- 作業ログ（工程別の作業記録）
CREATE TABLE IF NOT EXISTS work_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  work_type TEXT NOT NULL,                -- 分荷/撮影/出品/梱包/出荷/取引ナビ等
  mgmt_num TEXT,                          -- 対象商品（あれば）
  duration_seconds INT DEFAULT 0,
  work_date DATE DEFAULT CURRENT_DATE,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(work_date);
CREATE INDEX IF NOT EXISTS idx_work_logs_staff ON work_logs(staff_name);
CREATE INDEX IF NOT EXISTS idx_work_logs_type ON work_logs(work_type);

-- AI相談ログ
CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 知識蓄積（相場・業者・コツのメモDB）
CREATE TABLE IF NOT EXISTS knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,                 -- 相場/業者/コツ/メモ
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 新しい声ポイント
CREATE TABLE IF NOT EXISTS voice_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  content TEXT NOT NULL,                  -- 要望・改善案
  status TEXT DEFAULT '投稿',             -- 投稿/受理/採用/実装/優秀
  points INT DEFAULT 1,
  quarter TEXT,                           -- YYYY-Q1/Q2/Q3/Q4
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 管理番号の採番管理
CREATE TABLE IF NOT EXISTS mgmt_num_seq (
  prefix TEXT PRIMARY KEY,                -- YYMM
  last_num INT NOT NULL DEFAULT 0
);

-- RLS (Row Level Security) - 全テーブルで有効化
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_logs ENABLE ROW LEVEL SECURITY;

-- anon ユーザーに読み書き許可（PIN認証はアプリ側で制御）
CREATE POLICY "items_all" ON items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "status_log_all" ON item_status_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "attendance_all" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "expenses_all" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "sales_all" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "work_logs_all" ON work_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "channels_read" ON channels FOR SELECT USING (true);
CREATE POLICY "staff_read" ON staff FOR SELECT USING (true);
CREATE POLICY "knowledge_all" ON knowledge FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "voice_all" ON voice_points FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "seq_all" ON mgmt_num_seq FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "leave_all" ON leave_notices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ai_chat_all" ON ai_chat_logs FOR ALL USING (true) WITH CHECK (true);
