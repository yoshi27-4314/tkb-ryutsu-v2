-- RLS有効化 + ポリシー作成
-- items
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items_all" ON items FOR ALL USING (true) WITH CHECK (true);

-- item_status_log
ALTER TABLE item_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status_log_all" ON item_status_log FOR ALL USING (true) WITH CHECK (true);

-- attendance
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_all" ON attendance FOR ALL USING (true) WITH CHECK (true);

-- expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_all" ON expenses FOR ALL USING (true) WITH CHECK (true);

-- sales
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_all" ON sales FOR ALL USING (true) WITH CHECK (true);

-- work_logs
ALTER TABLE work_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_logs_all" ON work_logs FOR ALL USING (true) WITH CHECK (true);

-- channels
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_read" ON channels FOR SELECT USING (true);

-- staff
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read" ON staff FOR SELECT USING (true);

-- knowledge
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_all" ON knowledge FOR ALL USING (true) WITH CHECK (true);

-- voice_points
ALTER TABLE voice_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_all" ON voice_points FOR ALL USING (true) WITH CHECK (true);

-- mgmt_num_seq
ALTER TABLE mgmt_num_seq ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seq_all" ON mgmt_num_seq FOR ALL USING (true) WITH CHECK (true);

-- leave_notices
ALTER TABLE leave_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_all" ON leave_notices FOR ALL USING (true) WITH CHECK (true);

-- ai_chat_logs
ALTER TABLE ai_chat_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_chat_all" ON ai_chat_logs FOR ALL USING (true) WITH CHECK (true);
