-- =====================================================
-- 修正スクリプト: 既存staffテーブルにcompanyカラム追加 + 残りのテーブル作成
-- =====================================================

-- 既存staffテーブルに不足カラムを追加
ALTER TABLE staff ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'テイクバック';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS work_start TIME DEFAULT '09:00';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS work_end TIME DEFAULT '16:00';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS break_minutes INT DEFAULT 60;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS off_days INT[] DEFAULT '{}';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pattern TEXT DEFAULT '';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- スタッフデータ投入（既存があればスキップ）
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
ON CONFLICT (name) DO UPDATE SET
  company = EXCLUDED.company,
  work_start = EXCLUDED.work_start,
  work_end = EXCLUDED.work_end,
  break_minutes = EXCLUDED.break_minutes,
  off_days = EXCLUDED.off_days,
  pattern = EXCLUDED.pattern;

-- 勤怠記録
CREATE TABLE IF NOT EXISTS attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  work_date DATE NOT NULL,
  clock_in TIME,
  clock_out TIME,
  break_minutes INT DEFAULT 0,
  actual_minutes INT,
  recorded_by TEXT DEFAULT '',
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
  type TEXT NOT NULL,
  time_value TIME,
  reason TEXT DEFAULT '',
  notified_at TIMESTAMPTZ DEFAULT NOW()
);

-- 経費精算
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'テイクバック',
  expense_date DATE NOT NULL,
  store_name TEXT DEFAULT '',
  amount INT NOT NULL,
  tax_amount INT DEFAULT 0,
  tax_rate NUMERIC(4,2),
  category TEXT DEFAULT '',
  payment_method TEXT DEFAULT '現金',
  paid_by TEXT DEFAULT '',
  invoice_number TEXT DEFAULT '',
  receipt_url TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  is_settled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_dept ON expenses(department);

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

-- 作業ログ
CREATE TABLE IF NOT EXISTS work_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  work_type TEXT NOT NULL,
  mgmt_num TEXT,
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

-- 知識蓄積
CREATE TABLE IF NOT EXISTS knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
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
  content TEXT NOT NULL,
  status TEXT DEFAULT '投稿',
  points INT DEFAULT 1,
  quarter TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 管理番号の採番管理
CREATE TABLE IF NOT EXISTS mgmt_num_seq (
  prefix TEXT PRIMARY KEY,
  last_num INT NOT NULL DEFAULT 0
);

-- 採番RPC関数
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

-- RLS有効化
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_logs ENABLE ROW LEVEL SECURITY;

-- RLSポリシー（まだないテーブルのみ）
DO $$
BEGIN
  -- attendance
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance' AND policyname = 'attendance_all') THEN
    EXECUTE 'CREATE POLICY "attendance_all" ON attendance FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- expenses
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'expenses_all') THEN
    EXECUTE 'CREATE POLICY "expenses_all" ON expenses FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- sales
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales' AND policyname = 'sales_all') THEN
    EXECUTE 'CREATE POLICY "sales_all" ON sales FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- work_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'work_logs' AND policyname = 'work_logs_all') THEN
    EXECUTE 'CREATE POLICY "work_logs_all" ON work_logs FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- knowledge
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge' AND policyname = 'knowledge_all') THEN
    EXECUTE 'CREATE POLICY "knowledge_all" ON knowledge FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- voice_points
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'voice_points' AND policyname = 'voice_all') THEN
    EXECUTE 'CREATE POLICY "voice_all" ON voice_points FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- mgmt_num_seq
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mgmt_num_seq' AND policyname = 'seq_all') THEN
    EXECUTE 'CREATE POLICY "seq_all" ON mgmt_num_seq FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- leave_notices
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leave_notices' AND policyname = 'leave_all') THEN
    EXECUTE 'CREATE POLICY "leave_all" ON leave_notices FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  -- ai_chat_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_chat_logs' AND policyname = 'ai_chat_all') THEN
    EXECUTE 'CREATE POLICY "ai_chat_all" ON ai_chat_logs FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;
