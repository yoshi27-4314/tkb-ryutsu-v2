/**
 * テイクバック流通 v2 - データベース層
 * Supabaseの接続・CRUD・リアルタイム同期
 */
import { CONFIG } from './config.js';

/** 日本時間で今日の日付文字列を返す（YYYY-MM-DD） */
export function todayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  return jst.toISOString().slice(0, 10);
}

/** 日本時間でISO文字列を返す */
export function nowJST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T') + '+09:00';
}

let db = null;
let realtimeChannel = null;
let listeners = new Set();

// --- 初期化 ---
export function initDB() {
  if (!window.supabase) {
    console.error('Supabase JS未読み込み');
    return false;
  }
  db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

  // リアルタイム購読
  realtimeChannel = db.channel('items_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, (payload) => {
      notifyListeners('items', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, (payload) => {
      notifyListeners('attendance', payload);
    })
    .subscribe();

  return true;
}

export function getDB() { return db; }

// --- リアルタイムリスナー ---
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners(table, payload) {
  for (const cb of listeners) {
    try { cb(table, payload); } catch (e) { console.error('Listener error:', e); }
  }
}

// --- 商品 CRUD ---
export async function getItems(filters = {}) {
  if (!db) return [];
  let query = db.from('items').select('*');

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  }
  if (filters.channel) query = query.eq('channel_name', filters.channel);
  if (filters.search) {
    query = query.or(`product_name.ilike.%${filters.search}%,mgmt_num.ilike.%${filters.search}%,maker.ilike.%${filters.search}%,listing_title.ilike.%${filters.search}%`);
  }
  if (filters.staffName) query = query.eq('judged_by', filters.staffName);

  // ソート
  const orderBy = filters.orderBy || 'priority_score';
  const ascending = filters.ascending !== undefined ? filters.ascending : false;
  query = query.order(orderBy, { ascending, nullsFirst: false });

  if (filters.limit) query = query.limit(filters.limit);
  if (filters.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);

  const { data, error } = await query;
  if (error) {
    console.error('getItems error:', error);
    return [];
  }
  return data || [];
}

export async function getItem(mgmtNum) {
  if (!db) return null;
  const { data, error } = await db.from('items').select('*').eq('mgmt_num', mgmtNum).single();
  if (error) { console.error('getItem error:', error); return null; }
  return data;
}

export async function createItem(item) {
  if (!db) return null;
  const { data, error } = await db.from('items').insert(item).select().single();
  if (error) { console.error('createItem error:', error); return null; }
  // ステータスログ
  await logStatusChange(data.id, item.mgmt_num, null, item.status || '分荷確定', item.judged_by || '');
  return data;
}

export async function updateItem(mgmtNum, updates) {
  if (!db) return null;
  const { data, error } = await db.from('items').update(updates).eq('mgmt_num', mgmtNum).select().single();
  if (error) { console.error('updateItem error:', error); return null; }
  return data;
}

export async function updateItemStatus(mgmtNum, newStatus, changedBy = '', extra = {}) {
  if (!db) { console.error('updateItemStatus: DB未初期化'); return null; }
  // 現在のステータスを取得
  const current = await getItem(mgmtNum);
  if (!current) { console.error('updateItemStatus: 商品が見つからない', mgmtNum); return null; }

  const updates = { status: newStatus, ...extra };
  const { data, error } = await db.from('items').update(updates).eq('mgmt_num', mgmtNum).select().single();
  if (error) { console.error('updateItemStatus error:', mgmtNum, newStatus, error.message, error.details, error.hint); return null; }

  // ステータスログ
  await logStatusChange(current.id, mgmtNum, current.status, newStatus, changedBy);
  return data;
}

// --- ロック（出品作業の排他制御） ---
export async function lockItem(mgmtNum, staffName) {
  if (!db) return false;
  const { data, error } = await db.from('items')
    .update({ locked_by: staffName, locked_at: new Date().toISOString() })
    .is('locked_by', null)
    .eq('mgmt_num', mgmtNum)
    .select();
  return !error && data && data.length > 0;
}

export async function unlockItem(mgmtNum, extra = {}) {
  if (!db) return false;
  const { error } = await db.from('items')
    .update({ locked_by: null, locked_at: null, ...extra })
    .eq('mgmt_num', mgmtNum);
  return !error;
}

// 30分超過ロックを自動解除
export async function cleanStaleLocks() {
  if (!db) return;
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await db.from('items')
    .update({ locked_by: null, locked_at: null })
    .not('locked_by', 'is', null)
    .lt('locked_at', thirtyMinAgo);
}

// --- 管理番号の採番 ---
export async function generateMgmtNum(sourcePrefix = '') {
  if (!db) return null;
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const datePart = String(jst.getFullYear()).slice(2) + String(jst.getMonth() + 1).padStart(2, '0');
  const prefix = sourcePrefix ? sourcePrefix + datePart : datePart;

  // アトミックにインクリメント
  const { data, error } = await db.rpc('next_mgmt_num', { p_prefix: prefix });
  if (error) {
    // フォールバック: テーブルから最大値を取得
    console.warn('RPC失敗、フォールバック採番:', error);
    const { data: items } = await db.from('items')
      .select('mgmt_num')
      .like('mgmt_num', `${prefix}-%`)
      .order('mgmt_num', { ascending: false })
      .limit(1);
    const lastNum = items?.[0] ? parseInt(items[0].mgmt_num.split('-')[1]) : 0;
    return `${prefix}-${String(lastNum + 1).padStart(4, '0')}`;
  }
  return data;
}

// --- ステータスログ ---
async function logStatusChange(itemId, mgmtNum, oldStatus, newStatus, changedBy) {
  if (!db) return;
  await db.from('item_status_log').insert({
    item_id: itemId,
    mgmt_num: mgmtNum,
    old_status: oldStatus,
    new_status: newStatus,
    changed_by: changedBy,
  });
}

// --- 勤怠 ---
export async function saveAttendance(record) {
  if (!db) return null;
  const { data, error } = await db.from('attendance').upsert(record, { onConflict: 'staff_name,work_date' }).select().single();
  if (error) { console.error('saveAttendance error:', error); return null; }
  return data;
}

export async function getAttendance(staffName, month) {
  if (!db) return [];
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;
  const { data, error } = await db.from('attendance')
    .select('*')
    .eq('staff_name', staffName)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date');
  if (error) { console.error('getAttendance error:', error); return []; }
  return data || [];
}

// --- 経費 ---
export async function createExpense(expense) {
  if (!db) return null;
  const { data, error } = await db.from('expenses').insert(expense).select().single();
  if (error) { console.error('createExpense error:', error); return null; }
  return data;
}

export async function getExpenses(filters = {}) {
  if (!db) return [];
  let query = db.from('expenses').select('*');
  if (filters.department) query = query.eq('department', filters.department);
  if (filters.month) {
    query = query.gte('expense_date', `${filters.month}-01`).lte('expense_date', `${filters.month}-31`);
  }
  if (filters.staffName) query = query.eq('staff_name', filters.staffName);
  query = query.order('expense_date', { ascending: false });
  const { data, error } = await query;
  if (error) { console.error('getExpenses error:', error); return []; }
  return data || [];
}

// --- 売上 ---
export async function createSale(sale) {
  if (!db) return null;
  const { data, error } = await db.from('sales').insert(sale).select().single();
  if (error) { console.error('createSale error:', error); return null; }
  return data;
}

export async function getSales(filters = {}) {
  if (!db) return [];
  let query = db.from('sales').select('*');
  if (filters.month) {
    query = query.gte('sold_at', `${filters.month}-01T00:00:00`).lt('sold_at', `${filters.month}-32T00:00:00`);
  }
  query = query.order('sold_at', { ascending: false });
  const { data, error } = await query;
  if (error) { console.error('getSales error:', error); return []; }
  return data || [];
}

// --- 作業ログ ---
export async function logWork(log) {
  if (!db) return null;
  const { data, error } = await db.from('work_logs').insert(log).select().single();
  if (error) { console.error('logWork error:', error); return null; }
  return data;
}

export async function getWorkLogs(filters = {}) {
  if (!db) return [];
  let query = db.from('work_logs').select('*');
  if (filters.date) query = query.eq('work_date', filters.date);
  if (filters.staffName) query = query.eq('staff_name', filters.staffName);
  if (filters.workType) query = query.eq('work_type', filters.workType);
  query = query.order('created_at', { ascending: false });
  if (filters.limit) query = query.limit(filters.limit);
  const { data, error } = await query;
  if (error) { console.error('getWorkLogs error:', error); return []; }
  return data || [];
}

// --- 休暇連絡 ---
export async function createLeaveNotice(notice) {
  if (!db) return null;
  const { data, error } = await db.from('leave_notices').insert(notice).select().single();
  if (error) { console.error('createLeaveNotice error:', error); return null; }
  return data;
}

// --- ステータス集計（全件取得） ---
export async function getStatusCounts() {
  if (!db) return {};
  const counts = {};
  let total = 0;
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await db.from('items').select('status').range(offset, offset + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const item of data) {
      counts[item.status] = (counts[item.status] || 0) + 1;
      total++;
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  counts._total = total;
  return counts;
}

// --- 滞留商品取得 ---
export async function getStaleItems() {
  if (!db) return [];
  const now = new Date();
  const { data } = await db.from('items')
    .select('mgmt_num,product_name,status,judged_at,listed_at,sold_at,packed_at,created_at')
    .in('status', ['出品待ち', '出品中', '梱包待ち', '梱包完了', '入金待ち'])
    .order('judged_at', { ascending: true })
    .limit(200);

  if (!data) return [];

  const stale = [];
  for (const item of data) {
    const refDate = item.listed_at || item.judged_at || item.created_at;
    if (!refDate) continue;
    const days = Math.floor((now - new Date(refDate)) / (1000 * 60 * 60 * 24));

    let threshold = 999;
    if (item.status === '出品待ち') threshold = 7;
    else if (item.status === '出品中') threshold = 30;
    else if (item.status === '梱包待ち' || item.status === '梱包完了') threshold = 3;
    else if (item.status === '入金待ち') threshold = 5;

    if (days >= threshold) {
      stale.push({ ...item, staleDays: days, threshold });
    }
  }
  return stale.sort((a, b) => b.staleDays - a.staleDays).slice(0, 20);
}

// --- 今日の実績 ---
export async function getTodayStats() {
  if (!db) return { listed: 0, judged: 0, shipped: 0, packed: 0 };
  const today = todayJST();
  const { data } = await db.from('work_logs')
    .select('work_type, duration_seconds')
    .eq('work_date', today);
  const stats = { listed: 0, judged: 0, shipped: 0, packed: 0, totalSeconds: 0 };
  for (const log of (data || [])) {
    if (log.work_type === '出品') stats.listed++;
    else if (log.work_type === '分荷') stats.judged++;
    else if (log.work_type === '出荷') stats.shipped++;
    else if (log.work_type === '梱包') stats.packed++;
    stats.totalSeconds += log.duration_seconds || 0;
  }
  return stats;
}
