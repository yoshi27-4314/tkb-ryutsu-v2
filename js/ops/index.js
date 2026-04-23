/**
 * テイクバック流通 v2 - 業務モジュール
 * 経費精算 / 勤怠管理 / チャット / KPI / マイページ
 */
import { CONFIG } from '../core/config.js';
import * as db from '../core/db.js';
import { getCurrentStaff, isAdmin, logout } from '../core/auth.js';
import { showToast, showLoading, showConfirm, capturePhoto, fileToBase64, resizeImage, escapeHtml, formatPrice, formatDate, formatDateTime, emptyState } from '../core/ui.js';
import { navigate } from '../core/router.js';

// ============================================================
// 共通スタイル定数
// ============================================================
const GOLD = '#C5A258';
const BG = '#0a0a0a';
const CARD_BG = '#1a1a2e';
const BORDER = '#2a2a3e';
const TEXT_PRIMARY = '#e0e0e0';
const TEXT_SECONDARY = '#888';
const TEXT_MUTED = '#666';

const ACCOUNTING_CATEGORIES = [
  '消耗品費', '交通費', '通信費', '修繕費', '水道光熱費',
  '荷造運賃', '広告宣伝費', '接待交際費', '福利厚生費',
  '事務用品費', '地代家賃', '租税公課', '雑費',
];

const PAYMENT_METHODS = ['現金', 'クレジット', '立替'];

const DEPARTMENTS = ['テイクバック', 'クリアメンテ', 'テイクバック再生'];

const GOOGLE_CHAT_ROOMS = [
  { name: '通販業務', url: 'https://chat.google.com/room/通販業務', icon: '📦' },
  { name: '分荷判定', url: 'https://chat.google.com/room/分荷判定', icon: '⚖️' },
  { name: '勤怠連絡', url: 'https://chat.google.com/room/勤怠連絡', icon: '🕐' },
  { name: '社内連絡', url: 'https://chat.google.com/room/社内連絡', icon: '📢' },
  { name: '売上明細', url: 'https://chat.google.com/room/売上明細', icon: '💰' },
];

const AI_QUICK_TEMPLATES = [
  'この商品の相場は？',
  '出品文を作って',
  '梱包方法を教えて',
  'クレーム対応の文例',
  '送料の目安は？',
  '値下げ交渉の返答例',
];

// ============================================================
// 共通ユーティリティ
// ============================================================
function card(inner, extra = '') {
  return `<div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:12px;padding:16px;margin-bottom:12px;${extra}">${inner}</div>`;
}

function sectionTitle(text) {
  return `<h3 style="color:${GOLD};font-size:15px;font-weight:bold;margin:0 0 12px 0;">${text}</h3>`;
}

function btn(text, id, style = 'primary') {
  const styles = {
    primary: `background:${GOLD};color:#000;font-weight:bold;`,
    secondary: `background:#333;color:${TEXT_PRIMARY};`,
    danger: `background:#c0392b;color:#fff;font-weight:bold;`,
    ghost: `background:transparent;color:${GOLD};border:1px solid ${GOLD};`,
  };
  return `<button id="${id}" style="${styles[style] || styles.primary}padding:10px 16px;border-radius:8px;border:none;font-size:14px;cursor:pointer;transition:opacity 0.2s;width:100%;" ontouchstart="this.style.opacity='0.7'" ontouchend="this.style.opacity='1'">${text}</button>`;
}

function selectBox(id, options, selected = '', placeholder = '') {
  let html = `<select id="${id}" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;appearance:none;-webkit-appearance:none;">`;
  if (placeholder) html += `<option value="">${placeholder}</option>`;
  for (const opt of options) {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    html += `<option value="${escapeHtml(val)}" ${val === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }
  html += '</select>';
  return html;
}

function inputField(id, type = 'text', placeholder = '', value = '', extra = '') {
  return `<input id="${id}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(String(value || ''))}" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;box-sizing:border-box;${extra}" />`;
}

function label(text) {
  return `<label style="display:block;color:${TEXT_SECONDARY};font-size:12px;margin-bottom:4px;margin-top:12px;">${text}</label>`;
}

function tabBar(tabs, activeTab, onClickAttr = 'data-subtab') {
  return `<div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:12px;-webkit-overflow-scrolling:touch;">
    ${tabs.map(t => `<button ${onClickAttr}="${t.id}" style="flex-shrink:0;padding:8px 14px;border-radius:20px;border:none;font-size:13px;cursor:pointer;white-space:nowrap;transition:all 0.2s;${t.id === activeTab ? `background:${GOLD};color:#000;font-weight:bold;` : `background:#222;color:${TEXT_SECONDARY};`}">${t.label}</button>`).join('')}
  </div>`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getDayOfWeek() {
  return new Date().getDay() || 7; // 月=1 ... 日=7, getDay: 日=0
}

function padTime(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ============================================================
// メインエントリーポイント
// ============================================================
export function renderOps(container, params = {}) {
  const staff = getCurrentStaff();
  if (!staff) {
    container.innerHTML = emptyState('🔒', 'ログインしてください');
    return;
  }

  const tab = params.tab || 'expense';

  const tabs = [
    { id: 'expense', label: '💰 経費' },
    { id: 'attendance', label: '🕐 勤怠' },
    { id: 'chat', label: '💬 チャット' },
    { id: 'calendar', label: '📅 カレンダー' },
    { id: 'kpi', label: '📊 KPI' },
    { id: 'consignment', label: '🤝 委託' },
    { id: 'voice', label: '🗣 声' },
    { id: 'knowledge', label: '📚 知識' },
    { id: 'mypage', label: '👤 マイページ' },
  ];

  container.innerHTML = `
    <div style="padding:12px 12px 0 12px;">
      ${tabBar(tabs, tab)}
    </div>
    <div id="opsContent" style="padding:0 12px 100px 12px;"></div>
  `;

  // タブ切り替えイベント
  container.querySelectorAll('[data-subtab]').forEach(el => {
    el.addEventListener('click', () => {
      renderOps(container, { ...params, tab: el.dataset.subtab });
    });
  });

  const content = container.querySelector('#opsContent');

  switch (tab) {
    case 'expense': renderExpense(content, params, staff); break;
    case 'attendance': renderAttendance(content, params, staff); break;
    case 'chat': renderChat(content, params, staff); break;
    case 'calendar': renderCalendar(content, params, staff); break;
    case 'kpi': renderKPI(content, params, staff); break;
    case 'consignment': renderConsignmentReport(content, params, staff); break;
    case 'voice': renderVoice(content, params, staff); break;
    case 'knowledge': renderKnowledge(content, params, staff); break;
    case 'mypage': renderMyPage(content, params, staff); break;
    default: renderExpense(content, params, staff);
  }
}

// ============================================================
// 経費精算モジュール
// ============================================================
function renderExpense(container, params, staff) {
  const subTab = params.expenseTab || 'register';
  const month = params.expenseMonth || getCurrentMonth();
  const department = params.department || (staff.company || 'テイクバック');

  container.innerHTML = `
    ${tabBar([
      { id: 'register', label: '📝 登録' },
      { id: 'list', label: '📋 一覧' },
      { id: 'summary', label: '📊 集計' },
      { id: 'balance', label: '💵 残高' },
    ], subTab, 'data-exptab')}
    <div id="expenseBody"></div>
  `;

  container.querySelectorAll('[data-exptab]').forEach(el => {
    el.addEventListener('click', () => {
      renderExpense(container, { ...params, expenseTab: el.dataset.exptab }, staff);
    });
  });

  const body = container.querySelector('#expenseBody');

  switch (subTab) {
    case 'register': renderExpenseRegister(body, month, department, staff); break;
    case 'list': renderExpenseList(body, month, department, staff); break;
    case 'summary': renderExpenseSummary(body, month, department, staff); break;
    case 'balance': renderPettyCashBalance(body, month, department, staff); break;
  }
}

function renderExpenseRegister(container, month, department, staff) {
  container.innerHTML = card(`
    ${sectionTitle('経費登録')}

    ${label('部門')}
    ${selectBox('expDept', DEPARTMENTS, department)}

    <div style="margin-top:16px;text-align:center;">
      ${btn('📷 レシート撮影（OCR）', 'btnOcr', 'ghost')}
    </div>

    <div id="ocrResult" style="display:none;margin-top:12px;padding:12px;background:#111;border-radius:8px;border:1px solid ${GOLD}33;">
      <p style="color:${GOLD};font-size:12px;margin-bottom:8px;">OCR結果（自動入力）</p>
      <div id="ocrFields"></div>
    </div>

    ${label('日付')}
    ${inputField('expDate', 'date', '', getTodayStr())}

    ${label('店名')}
    ${inputField('expStore', 'text', '購入先')}

    ${label('金額（税込）')}
    ${inputField('expAmount', 'number', '0')}

    ${label('税率')}
    ${selectBox('expTaxRate', [
      { value: '10', label: '10%' },
      { value: '8', label: '8%（軽減税率）' },
      { value: '0', label: '非課税' },
    ], '10')}

    ${label('勘定科目')}
    ${selectBox('expCategory', ACCOUNTING_CATEGORIES, '', '選択してください')}

    ${label('支払方法')}
    ${selectBox('expPayment', PAYMENT_METHODS, '現金')}

    <div id="paidByRow" style="display:none;">
      ${label('立替者（誰が立て替えた？）')}
      ${inputField('expPaidBy', 'text', '立替者の名前', staff.name)}
    </div>

    ${label('インボイス番号（T+13桁）')}
    ${inputField('expInvoice', 'text', 'T0000000000000')}

    ${label('備考')}
    <textarea id="expMemo" rows="2" placeholder="メモ" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>

    <div style="margin-top:20px;">
      ${btn('登録する', 'btnSaveExpense')}
    </div>
  `);

  // 立替者フィールド表示制御
  const paymentSelect = container.querySelector('#expPayment');
  const paidByRow = container.querySelector('#paidByRow');
  paymentSelect.addEventListener('change', () => {
    paidByRow.style.display = paymentSelect.value === '立替' ? '' : 'none';
  });
  // 初期表示
  if (paymentSelect.value === '立替') paidByRow.style.display = '';

  // レシートOCR
  container.querySelector('#btnOcr').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;

      showToast('レシートを解析中...');
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 1200);

      const resp = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        },
        body: JSON.stringify({
          image: resized,
          step: 'receipt',
          context: {
            task: 'このレシート/領収書から以下の情報をJSON形式で読み取ってください: {"date":"YYYY-MM-DD","shop":"店舗名","amount":金額数値,"tax":"10%or8%orなし","category":"勘定科目推定","memo":"品目"}',
          },
        }),
      });

      if (!resp.ok) throw new Error(`OCR失敗: ${resp.status}`);

      const result = await resp.json();
      const ocrData = result.success ? result.judgment : result;
      applyOcrResult(container, ocrData);
      showToast('OCR完了');
    } catch (e) {
      console.error('OCR error:', e);
      showToast('OCR処理に失敗しました');
    }
  });

  // 保存
  container.querySelector('#btnSaveExpense').addEventListener('click', async () => {
    const dept = container.querySelector('#expDept').value;
    const date = container.querySelector('#expDate').value;
    const store = container.querySelector('#expStore').value.trim();
    const amount = parseInt(container.querySelector('#expAmount').value) || 0;
    const taxRate = parseInt(container.querySelector('#expTaxRate').value);
    const category = container.querySelector('#expCategory').value;
    const payment = container.querySelector('#expPayment').value;
    const paidBy = container.querySelector('#expPaidBy').value.trim();
    const invoice = container.querySelector('#expInvoice').value.trim();
    const memo = container.querySelector('#expMemo').value.trim();

    if (!date || !store || !amount || !category) {
      showToast('日付・店名・金額・科目は必須です');
      return;
    }

    // インボイス番号バリデーション
    if (invoice && !/^T\d{13}$/.test(invoice)) {
      showToast('インボイス番号はT+13桁の数字です');
      return;
    }

    const taxAmount = Math.round(amount * taxRate / (100 + taxRate));

    const expense = {
      department: dept,
      staff_name: staff.name,
      expense_date: date,
      store_name: store,
      amount,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      category,
      payment_method: payment,
      paid_by: payment === '立替' ? (paidBy || staff.name) : null,
      is_settled: false,
      invoice_number: invoice || null,
      memo: memo || null,
    };

    const saved = await db.createExpense(expense);
    if (saved) {
      showToast('経費を登録しました');
      // フォームリセット
      container.querySelector('#expStore').value = '';
      container.querySelector('#expAmount').value = '';
      container.querySelector('#expInvoice').value = '';
      container.querySelector('#expMemo').value = '';
      container.querySelector('#expCategory').value = '';
    } else {
      showToast('登録に失敗しました');
    }
  });
}

function applyOcrResult(container, result) {
  const ocrBox = container.querySelector('#ocrResult');
  ocrBox.style.display = 'block';

  const fields = [];
  if (result.date) {
    container.querySelector('#expDate').value = result.date;
    fields.push(`日付: ${result.date}`);
  }
  if (result.store) {
    container.querySelector('#expStore').value = result.store;
    fields.push(`店名: ${result.store}`);
  }
  if (result.amount) {
    container.querySelector('#expAmount').value = result.amount;
    fields.push(`金額: ${formatPrice(result.amount)}`);
  }
  if (result.taxRate != null) {
    container.querySelector('#expTaxRate').value = String(result.taxRate);
    fields.push(`税率: ${result.taxRate}%`);
  }
  if (result.category) {
    const cat = ACCOUNTING_CATEGORIES.find(c => c === result.category);
    if (cat) {
      container.querySelector('#expCategory').value = cat;
      fields.push(`科目: ${cat}`);
    }
  }
  if (result.invoiceNumber) {
    container.querySelector('#expInvoice').value = result.invoiceNumber;
    fields.push(`インボイス: ${result.invoiceNumber}`);
  }

  container.querySelector('#ocrFields').innerHTML = fields.map(f =>
    `<p style="color:${TEXT_PRIMARY};font-size:13px;margin:2px 0;">${escapeHtml(f)}</p>`
  ).join('');
}

async function renderExpenseList(container, month, department, staff) {
  showLoading(container);

  const expenses = await db.getExpenses({ department, month });

  if (!expenses.length) {
    container.innerHTML = emptyState('📭', 'この月の経費データはありません');
    return;
  }

  const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div>
        <span style="color:${TEXT_SECONDARY};font-size:12px;">月選択</span>
        <input type="month" id="expListMonth" value="${month}" style="background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};border-radius:8px;padding:6px 10px;font-size:13px;margin-left:4px;" />
      </div>
      <div style="text-align:right;">
        <span style="color:${TEXT_SECONDARY};font-size:12px;">合計</span>
        <span style="color:${GOLD};font-size:18px;font-weight:bold;margin-left:4px;">${formatPrice(total)}</span>
      </div>
    </div>

    <div id="expenseItems">
      ${expenses.map(e => card(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;cursor:pointer;" data-edit-expense="${e.id}">
            <div style="color:${TEXT_PRIMARY};font-size:14px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.store_name || '')}</div>
            <div style="color:${TEXT_SECONDARY};font-size:12px;margin-top:2px;">${escapeHtml(e.category || '')} ・ ${escapeHtml(e.payment_method || '')}${e.payment_method === '立替' && e.paid_by ? ` ・ 立替: ${escapeHtml(e.paid_by)}` : ''}</div>
            <div style="color:${TEXT_MUTED};font-size:11px;margin-top:2px;">
              ${formatDate(e.expense_date)} ・ ${escapeHtml(e.staff_name || '')}
              ${e.invoice_number ? ` ・ ${escapeHtml(e.invoice_number)}` : ''}
            </div>
            ${e.payment_method === '立替' ? `
              <div style="margin-top:6px;">
                <button data-settle-id="${e.id}" style="padding:4px 12px;border-radius:12px;border:none;font-size:11px;cursor:pointer;${e.is_settled ? 'background:#4caf5033;color:#4caf50;' : 'background:#ff980033;color:#ff9800;'}">${e.is_settled ? '✓ 精算済み' : '未精算 → 精算済みにする'}</button>
              </div>
            ` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-left:12px;gap:6px;">
            <div style="text-align:right;">
              <div style="color:${GOLD};font-size:16px;font-weight:bold;">${formatPrice(e.amount)}</div>
              <div style="color:${TEXT_MUTED};font-size:11px;">(税${formatPrice(e.tax_amount)})</div>
            </div>
            <button data-del-expense="${e.id}" style="padding:4px 8px;border-radius:6px;border:1px solid #f4433666;background:transparent;color:#f44336;font-size:11px;cursor:pointer;">🗑</button>
          </div>
        </div>
      `)).join('')}
    </div>
  `;

  container.querySelector('#expListMonth').addEventListener('change', (e) => {
    renderExpenseList(container, e.target.value, department, staff);
  });

  // 精算トグルボタン
  container.querySelectorAll('[data-settle-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.settleId;
      const dbClient = db.getDB();
      if (!dbClient) { showToast('DB接続エラー'); return; }

      const expense = expenses.find(e => String(e.id) === String(id));
      if (!expense) return;

      const newSettled = !expense.is_settled;
      const { error } = await dbClient.from('expenses')
        .update({ is_settled: newSettled })
        .eq('id', id);

      if (error) {
        console.error('Settlement update error:', error);
        showToast('更新に失敗しました');
        return;
      }

      showToast(newSettled ? '精算済みにしました' : '未精算に戻しました');
      renderExpenseList(container, month, department, staff);
    });
  });

  // 経費削除ボタン
  container.querySelectorAll('[data-del-expense]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.delExpense;
      const expense = expenses.find(ex => String(ex.id) === String(id));
      if (!expense) return;
      showConfirm(`「${expense.store_name || ''}」の経費（${formatPrice(expense.amount)}）を削除しますか？`, async () => {
        const dbClient = db.getDB();
        if (!dbClient) { showToast('DB接続エラー'); return; }
        const { error } = await dbClient.from('expenses').delete().eq('id', id);
        if (error) {
          console.error('Expense delete error:', error);
          showToast('削除に失敗しました');
        } else {
          showToast('経費を削除しました');
          renderExpenseList(container, month, department, staff);
        }
      });
    });
  });

  // 経費編集（タップで編集フォーム）
  container.querySelectorAll('[data-edit-expense]').forEach(el => {
    el.addEventListener('click', (e) => {
      // 精算ボタンクリック時は編集しない
      if (e.target.closest('[data-settle-id]')) return;
      const id = el.dataset.editExpense;
      const expense = expenses.find(ex => String(ex.id) === String(id));
      if (!expense) return;
      renderExpenseEditForm(container, expense, month, department, staff);
    });
  });
}

function renderExpenseEditForm(container, expense, month, department, staff) {
  container.innerHTML = card(`
    ${sectionTitle('経費編集')}

    ${label('部門')}
    ${selectBox('editExpDept', DEPARTMENTS, expense.department || department)}

    ${label('日付')}
    ${inputField('editExpDate', 'date', '', expense.expense_date || '')}

    ${label('店名')}
    ${inputField('editExpStore', 'text', '購入先', expense.store_name || '')}

    ${label('金額（税込）')}
    ${inputField('editExpAmount', 'number', '0', expense.amount || 0)}

    ${label('税率')}
    ${selectBox('editExpTaxRate', [
      { value: '10', label: '10%' },
      { value: '8', label: '8%（軽減税率）' },
      { value: '0', label: '非課税' },
    ], String(expense.tax_rate || 10))}

    ${label('勘定科目')}
    ${selectBox('editExpCategory', ACCOUNTING_CATEGORIES, expense.category || '', '選択してください')}

    ${label('支払方法')}
    ${selectBox('editExpPayment', PAYMENT_METHODS, expense.payment_method || '現金')}

    ${label('インボイス番号（T+13桁）')}
    ${inputField('editExpInvoice', 'text', 'T0000000000000', expense.invoice_number || '')}

    ${label('備考')}
    <textarea id="editExpMemo" rows="2" placeholder="メモ" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;">${escapeHtml(expense.memo || '')}</textarea>

    <div style="display:flex;gap:8px;margin-top:20px;">
      <div style="flex:1;">${btn('キャンセル', 'btnCancelEdit', 'secondary')}</div>
      <div style="flex:1;">${btn('更新する', 'btnUpdateExpense')}</div>
    </div>
  `);

  container.querySelector('#btnCancelEdit').addEventListener('click', () => {
    renderExpenseList(container, month, department, staff);
  });

  container.querySelector('#btnUpdateExpense').addEventListener('click', async () => {
    const dept = container.querySelector('#editExpDept').value;
    const date = container.querySelector('#editExpDate').value;
    const store = container.querySelector('#editExpStore').value.trim();
    const amount = parseInt(container.querySelector('#editExpAmount').value) || 0;
    const taxRate = parseInt(container.querySelector('#editExpTaxRate').value);
    const category = container.querySelector('#editExpCategory').value;
    const payment = container.querySelector('#editExpPayment').value;
    const invoice = container.querySelector('#editExpInvoice').value.trim();
    const memo = container.querySelector('#editExpMemo').value.trim();

    if (!date || !store || !amount || !category) {
      showToast('日付・店名・金額・科目は必須です');
      return;
    }

    if (invoice && !/^T\d{13}$/.test(invoice)) {
      showToast('インボイス番号はT+13桁の数字です');
      return;
    }

    const taxAmount = Math.round(amount * taxRate / (100 + taxRate));

    const updates = {
      department: dept,
      expense_date: date,
      store_name: store,
      amount,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      category,
      payment_method: payment,
      invoice_number: invoice || null,
      memo: memo || null,
    };

    const dbClient = db.getDB();
    if (!dbClient) { showToast('DB接続エラー'); return; }
    const { error } = await dbClient.from('expenses').update(updates).eq('id', expense.id);
    if (error) {
      console.error('Expense update error:', error);
      showToast('更新に失敗しました');
    } else {
      showToast('経費を更新しました');
      renderExpenseList(container, month, department, staff);
    }
  });
}

async function renderExpenseSummary(container, month, department, staff) {
  showLoading(container);

  const expenses = await db.getExpenses({ department, month });

  // 科目別集計
  const byCat = {};
  let total = 0;
  for (const e of expenses) {
    const cat = e.category || '未分類';
    byCat[cat] = (byCat[cat] || 0) + (e.amount || 0);
    total += (e.amount || 0);
  }

  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxAmount = sorted.length ? sorted[0][1] : 1;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <input type="month" id="summaryMonth" value="${month}" style="background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};border-radius:8px;padding:6px 10px;font-size:13px;" />
      <div style="text-align:right;">
        <span style="color:${TEXT_SECONDARY};font-size:12px;">月間合計</span>
        <div style="color:${GOLD};font-size:22px;font-weight:bold;">${formatPrice(total)}</div>
      </div>
    </div>

    ${sorted.length === 0 ? emptyState('📊', 'データがありません') : `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${sorted.map(([cat, amount]) => {
          const pct = Math.round(amount / total * 100);
          const barWidth = Math.round(amount / maxAmount * 100);
          return card(`
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="color:${TEXT_PRIMARY};font-size:14px;">${escapeHtml(cat)}</span>
              <span style="color:${GOLD};font-size:14px;font-weight:bold;">${formatPrice(amount)} <span style="color:${TEXT_MUTED};font-size:11px;">(${pct}%)</span></span>
            </div>
            <div style="height:6px;background:#222;border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${barWidth}%;background:${GOLD};border-radius:3px;transition:width 0.5s;"></div>
            </div>
          `, 'padding:12px;');
        }).join('')}
      </div>
    `}

    <!-- 未精算セクション -->
    ${(() => {
      const unsettled = expenses.filter(e => e.payment_method === '立替' && !e.is_settled);
      if (unsettled.length === 0) return '';
      const byPerson = {};
      for (const e of unsettled) {
        const person = e.paid_by || e.staff_name || '不明';
        byPerson[person] = (byPerson[person] || 0) + (e.amount || 0);
      }
      const unsettledTotal = unsettled.reduce((sum, e) => sum + (e.amount || 0), 0);
      const sortedPersons = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);
      return `
        <div style="margin-top:20px;">
          <h3 style="color:#ff9800;font-size:15px;font-weight:bold;margin:0 0 12px 0;">⚠️ 未精算の立替（${unsettled.length}件）</h3>
          <div style="background:#ff980011;border:1px solid #ff980033;border-radius:12px;padding:16px;margin-bottom:12px;">
            <div style="text-align:center;margin-bottom:12px;">
              <div style="color:#888;font-size:12px;">未精算合計</div>
              <div style="color:#ff9800;font-size:24px;font-weight:bold;">${formatPrice(unsettledTotal)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${sortedPersons.map(([person, amt]) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#111;border-radius:8px;">
                  <span style="color:${TEXT_PRIMARY};font-size:14px;">👤 ${escapeHtml(person)}</span>
                  <span style="color:#ff9800;font-size:14px;font-weight:bold;">${formatPrice(amt)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    })()}

    <div style="margin-top:16px;color:${TEXT_MUTED};font-size:12px;text-align:center;">
      ${expenses.length}件の経費 ・ ${escapeHtml(department)}
    </div>
  `;

  container.querySelector('#summaryMonth').addEventListener('change', (e) => {
    renderExpenseSummary(container, e.target.value, department, staff);
  });
}

// 小口現金残高
async function renderPettyCashBalance(container, month, department, staff) {
  showLoading(container);

  const dbClient = db.getDB();
  let allExpenses = [];

  if (dbClient) {
    // Get ALL cash expenses and petty cash deposits (no month filter for balance)
    const { data } = await dbClient.from('expenses')
      .select('*')
      .eq('department', department)
      .or('payment_method.eq.現金,category.eq.小口現金入金')
      .order('expense_date', { ascending: false });
    allExpenses = data || [];
  }

  // Calculate balance: deposits (小口現金入金) - cash expenses
  let totalDeposits = 0;
  let totalCashOut = 0;
  const transactions = [];

  for (const e of allExpenses) {
    if (e.category === '小口現金入金') {
      const amt = Math.abs(e.amount || 0);
      totalDeposits += amt;
      transactions.push({ ...e, type: 'in', displayAmount: amt });
    } else if (e.payment_method === '現金') {
      totalCashOut += (e.amount || 0);
      transactions.push({ ...e, type: 'out', displayAmount: e.amount || 0 });
    }
  }

  const balance = totalDeposits - totalCashOut;

  // Running balance for recent transactions (last 20)
  const recent = transactions.slice(0, 20);
  let runningBalance = balance;
  const recentWithBalance = [];
  for (const t of recent) {
    recentWithBalance.push({ ...t, runningBalance });
    if (t.type === 'in') runningBalance -= t.displayAmount;
    else runningBalance += t.displayAmount;
  }

  container.innerHTML = `
    <!-- 残高表示 -->
    ${card(`
      <div style="text-align:center;padding:20px 0;">
        <div style="color:${TEXT_SECONDARY};font-size:13px;margin-bottom:8px;">小口現金 残高</div>
        <div style="color:${balance >= 0 ? GOLD : '#e74c3c'};font-size:40px;font-weight:bold;">${formatPrice(balance)}</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:16px;">
          <div>
            <div style="color:${TEXT_MUTED};font-size:11px;">入金合計</div>
            <div style="color:#4caf50;font-size:14px;font-weight:bold;">+${formatPrice(totalDeposits)}</div>
          </div>
          <div>
            <div style="color:${TEXT_MUTED};font-size:11px;">出金合計</div>
            <div style="color:#e74c3c;font-size:14px;font-weight:bold;">-${formatPrice(totalCashOut)}</div>
          </div>
        </div>
      </div>
    `)}

    <!-- 入金ボタン -->
    ${card(`
      ${sectionTitle('入金登録')}
      ${label('入金額')}
      ${inputField('pettyCashAmount', 'number', '0')}
      ${label('メモ')}
      ${inputField('pettyCashMemo', 'text', '例: ATM引き出し')}
      <div style="margin-top:12px;">
        ${btn('💵 入金する', 'btnAddPettyCash')}
      </div>
    `)}

    <!-- 最近の取引 -->
    ${sectionTitle('最近の取引')}
    <div id="pettyCashTransactions">
      ${recentWithBalance.length === 0 ? emptyState('💵', '現金取引がありません') : recentWithBalance.map(t => card(`
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="flex:1;min-width:0;">
            <div style="color:${TEXT_PRIMARY};font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${t.type === 'in' ? '💵 入金' : '📤 ' + escapeHtml(t.store_name || t.category || '')}
            </div>
            <div style="color:${TEXT_MUTED};font-size:11px;">${formatDate(t.expense_date)} ・ ${escapeHtml(t.staff_name || '')}</div>
            ${t.memo ? `<div style="color:${TEXT_MUTED};font-size:10px;">${escapeHtml(t.memo)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px;">
            <div style="color:${t.type === 'in' ? '#4caf50' : '#e74c3c'};font-size:14px;font-weight:bold;">${t.type === 'in' ? '+' : '-'}${formatPrice(t.displayAmount)}</div>
            <div style="color:${TEXT_MUTED};font-size:10px;">残高 ${formatPrice(t.runningBalance)}</div>
          </div>
        </div>
      `, 'padding:10px 12px;')).join('')}
    </div>
  `;

  // 入金ボタン
  container.querySelector('#btnAddPettyCash').addEventListener('click', async () => {
    const amount = parseInt(container.querySelector('#pettyCashAmount').value) || 0;
    const memo = container.querySelector('#pettyCashMemo').value.trim();

    if (!amount || amount <= 0) {
      showToast('入金額を入力してください');
      return;
    }

    const expense = {
      department,
      staff_name: staff.name,
      expense_date: getTodayStr(),
      store_name: '小口現金',
      amount: amount,
      tax_amount: 0,
      tax_rate: 0,
      category: '小口現金入金',
      payment_method: '現金',
      invoice_number: null,
      memo: memo || '小口現金入金',
    };

    const saved = await db.createExpense(expense);
    if (saved) {
      showToast('入金を記録しました');
      renderPettyCashBalance(container, month, department, staff);
    } else {
      showToast('記録に失敗しました');
    }
  });
}

// ============================================================
// 勤怠管理モジュール
// ============================================================
function renderAttendance(container, params, staff) {
  const subTab = params.attendanceTab || 'clock';
  const month = params.attendanceMonth || getCurrentMonth();

  container.innerHTML = `
    ${tabBar([
      { id: 'clock', label: '⏰ 打刻' },
      { id: 'calendar', label: '📅 カレンダー' },
      { id: 'leave', label: '📝 届出' },
    ], subTab, 'data-atttab')}
    <div id="attendanceBody"></div>
  `;

  container.querySelectorAll('[data-atttab]').forEach(el => {
    el.addEventListener('click', () => {
      renderAttendance(container, { ...params, attendanceTab: el.dataset.atttab }, staff);
    });
  });

  const body = container.querySelector('#attendanceBody');

  switch (subTab) {
    case 'clock': renderClock(body, staff, params); break;
    case 'calendar': renderAttendanceCalendar(body, month, staff, params); break;
    case 'leave': renderLeaveNotice(body, staff); break;
  }
}

function renderClock(container, staff, params) {
  const isProxy = params.proxyMode || false;
  const proxyStaff = params.proxyStaff || '';
  const noBreak = params.noBreak || false;

  // デフォルト値
  const now = new Date();
  const defaultStart = padTime(now.getHours() < 12 ? 9 : now.getHours(), 0);
  const defaultEnd = padTime(18, 0);
  const defaultBreak = 60;

  container.innerHTML = card(`
    ${sectionTitle('勤怠打刻')}

    ${isAdmin() ? `
      <div style="margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;color:${TEXT_SECONDARY};font-size:13px;cursor:pointer;">
          <input type="checkbox" id="proxyToggle" ${isProxy ? 'checked' : ''} style="accent-color:${GOLD};width:18px;height:18px;" />
          代筆モード
        </label>
        <div id="proxySelect" style="margin-top:8px;${isProxy ? '' : 'display:none;'}">
          ${selectBox('proxyStaffSelect', Object.keys(CONFIG.STAFF_MARKS), proxyStaff, 'スタッフを選択')}
        </div>
      </div>
    ` : ''}

    ${label('日付')}
    ${inputField('attDate', 'date', '', getTodayStr())}

    ${label('出勤時間')}
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="flex:1;" id="startTimeWrap">
        ${inputField('attStart', 'time', '', defaultStart)}
      </div>
      <div id="startClockBtn" style="width:48px;height:48px;border-radius:50%;background:${CARD_BG};border:2px solid ${GOLD};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;flex-shrink:0;">🕐</div>
    </div>

    ${label('退勤時間')}
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="flex:1;">
        ${inputField('attEnd', 'time', '', defaultEnd)}
      </div>
      <div id="endClockBtn" style="width:48px;height:48px;border-radius:50%;background:${CARD_BG};border:2px solid ${GOLD};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;flex-shrink:0;">🕐</div>
    </div>

    ${label('休憩時間（分）')}
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="flex:1;">
        ${inputField('attBreak', 'number', '60', noBreak ? 0 : defaultBreak)}
      </div>
      <label style="display:flex;align-items:center;gap:4px;color:${TEXT_SECONDARY};font-size:12px;white-space:nowrap;cursor:pointer;">
        <input type="checkbox" id="noBreakToggle" ${noBreak ? 'checked' : ''} style="accent-color:${GOLD};" />
        休憩なし
      </label>
    </div>

    <div id="workSummary" style="margin-top:16px;padding:12px;background:#111;border-radius:8px;text-align:center;">
      <span style="color:${TEXT_SECONDARY};font-size:12px;">実労働時間</span>
      <div style="color:${GOLD};font-size:24px;font-weight:bold;" id="actualWork">—</div>
    </div>

    <div id="freeeStatus" style="margin-top:8px;text-align:center;font-size:11px;color:${TEXT_MUTED};">
      freee同期: <span id="freeeFlag">未確認</span>
    </div>

    <div style="margin-top:20px;">
      ${btn('打刻する', 'btnSaveAttendance')}
    </div>
  `);

  const startInput = container.querySelector('#attStart');
  const endInput = container.querySelector('#attEnd');
  const breakInput = container.querySelector('#attBreak');
  const noBreakToggle = container.querySelector('#noBreakToggle');
  const actualWorkEl = container.querySelector('#actualWork');

  // 実労働時間を計算
  function calcWork() {
    const start = startInput.value;
    const end = endInput.value;
    const breakMin = noBreakToggle.checked ? 0 : (parseInt(breakInput.value) || 0);

    if (!start || !end) { actualWorkEl.textContent = '—'; return 0; }

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let totalMin = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
    if (totalMin < 0) totalMin = 0;

    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    actualWorkEl.textContent = `${hours}時間${mins > 0 ? `${mins}分` : ''}`;
    return totalMin;
  }

  startInput.addEventListener('change', calcWork);
  endInput.addEventListener('change', calcWork);
  breakInput.addEventListener('input', calcWork);

  noBreakToggle.addEventListener('change', () => {
    breakInput.disabled = noBreakToggle.checked;
    if (noBreakToggle.checked) breakInput.value = '0';
    else breakInput.value = '60';
    calcWork();
  });

  calcWork();

  // 代筆トグル
  if (isAdmin()) {
    const proxyToggle = container.querySelector('#proxyToggle');
    const proxySelect = container.querySelector('#proxySelect');
    proxyToggle.addEventListener('change', () => {
      proxySelect.style.display = proxyToggle.checked ? '' : 'none';
    });
  }

  // アナログ時計ピッカー
  container.querySelector('#startClockBtn').addEventListener('click', () => {
    openClockPicker(startInput.value, (time) => {
      startInput.value = time;
      calcWork();
    });
  });

  container.querySelector('#endClockBtn').addEventListener('click', () => {
    openClockPicker(endInput.value, (time) => {
      endInput.value = time;
      calcWork();
    });
  });

  // freeeステータス確認
  (async () => {
    const date = container.querySelector('#attDate').value;
    const targetStaff = isProxy ? proxyStaff : staff.name;
    if (!targetStaff) return;
    const records = await db.getAttendance(targetStaff, date.slice(0, 7));
    const todayRecord = records.find(r => r.work_date === date);
    const flag = container.querySelector('#freeeFlag');
    if (todayRecord?.synced_to_freee) {
      flag.textContent = '同期済み ✓';
      flag.style.color = '#4caf50';
    } else if (todayRecord) {
      flag.textContent = '未同期';
      flag.style.color = '#ff9800';
    } else {
      flag.textContent = '記録なし';
    }
  })();

  // 保存
  container.querySelector('#btnSaveAttendance').addEventListener('click', async () => {
    const date = container.querySelector('#attDate').value;
    const start = startInput.value;
    const end = endInput.value;
    const breakMin = noBreakToggle.checked ? 0 : (parseInt(breakInput.value) || 0);
    const actualMin = calcWork();

    if (!date || !start || !end) {
      showToast('日付・出勤・退勤を入力してください');
      return;
    }

    let targetName = staff.name;
    if (isAdmin() && container.querySelector('#proxyToggle')?.checked) {
      targetName = container.querySelector('#proxyStaffSelect')?.value;
      if (!targetName) {
        showToast('代筆先のスタッフを選択してください');
        return;
      }
    }

    const record = {
      staff_name: targetName,
      work_date: date,
      clock_in: start,
      clock_out: end,
      break_minutes: breakMin,
      actual_minutes: actualMin,
      recorded_by: staff.name,
      is_proxy: targetName !== staff.name,
    };

    const saved = await db.saveAttendance(record);
    if (saved) {
      showToast(`${targetName}の勤怠を記録しました`);
    } else {
      showToast('記録に失敗しました');
    }
  });
}

// アナログ時計ピッカー
function openClockPicker(currentValue, onSelect) {
  const [initH, initM] = currentValue ? currentValue.split(':').map(Number) : [9, 0];
  let selectedHour = initH;
  let selectedMinute = initM;
  let mode = 'hour'; // 'hour' or 'minute'

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;`;

  function render() {
    overlay.innerHTML = `
      <div style="background:${CARD_BG};border-radius:20px;padding:24px;max-width:320px;width:100%;">
        <div style="text-align:center;margin-bottom:16px;">
          <span id="cpHour" style="font-size:32px;font-weight:bold;cursor:pointer;${mode === 'hour' ? `color:${GOLD};` : `color:${TEXT_SECONDARY};`}">${String(selectedHour).padStart(2, '0')}</span>
          <span style="font-size:32px;color:${TEXT_MUTED};">:</span>
          <span id="cpMinute" style="font-size:32px;font-weight:bold;cursor:pointer;${mode === 'minute' ? `color:${GOLD};` : `color:${TEXT_SECONDARY};`}">${String(selectedMinute).padStart(2, '0')}</span>
        </div>

        <div style="position:relative;width:240px;height:240px;margin:0 auto;border-radius:50%;background:#111;border:2px solid ${BORDER};">
          <div style="position:absolute;inset:0;" id="clockFace"></div>
          <div style="position:absolute;top:50%;left:50%;width:6px;height:6px;background:${GOLD};border-radius:50%;transform:translate(-50%,-50%);z-index:2;"></div>
          <div id="clockHand" style="position:absolute;top:50%;left:50%;transform-origin:bottom center;z-index:1;"></div>
        </div>

        <div style="display:flex;gap:12px;margin-top:20px;">
          <button id="cpCancel" style="flex:1;padding:12px;border-radius:8px;background:#333;color:${TEXT_PRIMARY};border:none;font-size:14px;cursor:pointer;">キャンセル</button>
          <button id="cpOk" style="flex:1;padding:12px;border-radius:8px;background:${GOLD};color:#000;border:none;font-size:14px;font-weight:bold;cursor:pointer;">OK</button>
        </div>
      </div>
    `;

    const face = overlay.querySelector('#clockFace');
    const hand = overlay.querySelector('#clockHand');
    const radius = 100;
    const centerX = 120;
    const centerY = 120;

    if (mode === 'hour') {
      // 0〜23時
      for (let h = 0; h < 24; h++) {
        const isInner = h >= 12;
        const r = isInner ? 65 : radius;
        const angle = ((h % 12) * 30 - 90) * Math.PI / 180;
        const x = centerX + r * Math.cos(angle) - 12;
        const y = centerY + r * Math.sin(angle) - 10;
        const isSelected = h === selectedHour;
        face.innerHTML += `<div data-h="${h}" style="position:absolute;left:${x}px;top:${y}px;width:24px;height:20px;text-align:center;font-size:${isInner ? '11' : '13'}px;color:${isSelected ? GOLD : TEXT_PRIMARY};font-weight:${isSelected ? 'bold' : 'normal'};cursor:pointer;line-height:20px;border-radius:10px;${isSelected ? `background:${GOLD}33;` : ''}">${h}</div>`;
      }

      // 針
      const isInner = selectedHour >= 12;
      const handLen = isInner ? 50 : 85;
      const handAngle = ((selectedHour % 12) * 30);
      hand.style.cssText = `position:absolute;top:50%;left:50%;width:2px;height:${handLen}px;background:${GOLD};transform-origin:bottom center;transform:translate(-50%,-100%) rotate(${handAngle - 180}deg);z-index:1;border-radius:1px;`;
    } else {
      // 分（5分刻み表示、全分タッチ可）
      for (let m = 0; m < 60; m += 5) {
        const angle = (m * 6 - 90) * Math.PI / 180;
        const x = centerX + radius * Math.cos(angle) - 12;
        const y = centerY + radius * Math.sin(angle) - 10;
        const isSelected = m === selectedMinute;
        face.innerHTML += `<div data-m="${m}" style="position:absolute;left:${x}px;top:${y}px;width:24px;height:20px;text-align:center;font-size:13px;color:${isSelected ? GOLD : TEXT_PRIMARY};font-weight:${isSelected ? 'bold' : 'normal'};cursor:pointer;line-height:20px;border-radius:10px;${isSelected ? `background:${GOLD}33;` : ''}">${String(m).padStart(2, '0')}</div>`;
      }

      const handAngle = selectedMinute * 6;
      hand.style.cssText = `position:absolute;top:50%;left:50%;width:2px;height:85px;background:${GOLD};transform-origin:bottom center;transform:translate(-50%,-100%) rotate(${handAngle - 180}deg);z-index:1;border-radius:1px;`;
    }

    // イベント
    face.querySelectorAll('[data-h]').forEach(el => {
      el.addEventListener('click', () => {
        selectedHour = parseInt(el.dataset.h);
        mode = 'minute';
        render();
      });
    });

    face.querySelectorAll('[data-m]').forEach(el => {
      el.addEventListener('click', () => {
        selectedMinute = parseInt(el.dataset.m);
        render();
      });
    });

    overlay.querySelector('#cpHour').addEventListener('click', () => { mode = 'hour'; render(); });
    overlay.querySelector('#cpMinute').addEventListener('click', () => { mode = 'minute'; render(); });
    overlay.querySelector('#cpCancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cpOk').addEventListener('click', () => {
      onSelect(padTime(selectedHour, selectedMinute));
      overlay.remove();
    });
  }

  render();
  document.body.appendChild(overlay);
}

// 勤怠カレンダー
async function renderAttendanceCalendar(container, month, staff, params) {
  showLoading(container);

  const records = await db.getAttendance(staff.name, month);
  const recordMap = {};
  for (const r of records) {
    recordMap[r.work_date] = r;
  }

  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, mon, 0).getDate();
  const todayStr = getTodayStr();

  // 月間集計
  let totalMinutes = 0;
  let workDays = 0;
  for (const r of records) {
    if (r.actual_minutes) {
      totalMinutes += r.actual_minutes;
      workDays++;
    }
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <button id="calPrev" style="background:none;border:none;color:${GOLD};font-size:20px;cursor:pointer;padding:8px;">◀</button>
      <input type="month" id="calMonth" value="${month}" style="background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};border-radius:8px;padding:6px 10px;font-size:14px;" />
      <button id="calNext" style="background:none;border:none;color:${GOLD};font-size:20px;cursor:pointer;padding:8px;">▶</button>
    </div>

    ${card(`
      <div style="display:flex;justify-content:space-around;text-align:center;">
        <div>
          <div style="color:${TEXT_SECONDARY};font-size:11px;">出勤日数</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${workDays}</div>
        </div>
        <div>
          <div style="color:${TEXT_SECONDARY};font-size:11px;">総労働時間</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 > 0 ? `${totalMinutes % 60}m` : ''}</div>
        </div>
        <div>
          <div style="color:${TEXT_SECONDARY};font-size:11px;">平均/日</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${workDays ? `${(totalMinutes / workDays / 60).toFixed(1)}h` : '—'}</div>
        </div>
      </div>
    `)}

    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">
      ${['日', '月', '火', '水', '木', '金', '土'].map((d, i) =>
        `<div style="color:${i === 0 ? '#c0392b' : i === 6 ? '#3498db' : TEXT_SECONDARY};font-size:11px;padding:4px;">${d}</div>`
      ).join('')}

      ${Array(firstDay).fill('<div></div>').join('')}

      ${Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${month}-${String(day).padStart(2, '0')}`;
        const rec = recordMap[dateStr];
        const isToday = dateStr === todayStr;
        const dow = new Date(year, mon - 1, day).getDay();
        const isSunday = dow === 0;
        const isSaturday = dow === 6;

        let cellColor = TEXT_PRIMARY;
        if (isSunday) cellColor = '#c0392b';
        else if (isSaturday) cellColor = '#3498db';

        let hours = '';
        let bgColor = 'transparent';
        let synced = '';
        if (rec && rec.actual_minutes) {
          const h = (rec.actual_minutes / 60).toFixed(1);
          hours = `<div style="font-size:10px;color:${GOLD};margin-top:1px;">${h}h</div>`;
          bgColor = `${GOLD}15`;
        }
        if (rec?.synced_to_freee) {
          synced = `<div style="font-size:8px;color:#4caf50;">✓</div>`;
        }

        return `<div data-cal-date="${dateStr}" style="padding:4px 2px;border-radius:8px;background:${bgColor};${isToday ? `border:1px solid ${GOLD};` : ''}min-height:44px;cursor:${rec ? 'pointer' : 'default'};">
          <div style="color:${cellColor};font-size:13px;font-weight:${isToday ? 'bold' : 'normal'};">${day}</div>
          ${hours}${synced}
          ${rec ? `<button data-del-att="${rec.id}" data-del-date="${dateStr}" style="display:block;margin:2px auto 0;padding:1px 4px;border:none;background:#f4433633;color:#f44336;font-size:8px;border-radius:4px;cursor:pointer;">削除</button>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;

  function navMonth(offset) {
    const d = new Date(year, mon - 1 + offset, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renderAttendanceCalendar(container, newMonth, staff, params);
  }

  container.querySelector('#calPrev').addEventListener('click', () => navMonth(-1));
  container.querySelector('#calNext').addEventListener('click', () => navMonth(1));
  container.querySelector('#calMonth').addEventListener('change', (e) => {
    renderAttendanceCalendar(container, e.target.value, staff, params);
  });

  // 勤怠日セルタップ → 編集
  container.querySelectorAll('[data-cal-date]').forEach(cell => {
    cell.addEventListener('click', (e) => {
      // 削除ボタンクリック時はスキップ
      if (e.target.closest('[data-del-att]')) return;
      const dateStr = cell.dataset.calDate;
      const rec = recordMap[dateStr];
      if (!rec) return;
      renderAttendanceEdit(container, rec, month, staff, params);
    });
  });

  // 勤怠削除ボタン
  container.querySelectorAll('[data-del-att]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.delAtt;
      const dateStr = el.dataset.delDate;
      showConfirm(`${dateStr} の勤怠記録を削除しますか？`, async () => {
        const dbClient = db.getDB();
        if (!dbClient) { showToast('DB接続エラー'); return; }
        const { error } = await dbClient.from('attendance').delete().eq('id', id);
        if (error) {
          console.error('Attendance delete error:', error);
          showToast('削除に失敗しました');
        } else {
          showToast('勤怠記録を削除しました');
          renderAttendanceCalendar(container, month, staff, params);
        }
      });
    });
  });
}

function renderAttendanceEdit(container, record, month, staff, params) {
  container.innerHTML = card(`
    ${sectionTitle('勤怠修正')}
    <p style="color:${TEXT_SECONDARY};font-size:12px;margin-bottom:12px;">${escapeHtml(record.work_date)} ・ ${escapeHtml(record.staff_name || '')}</p>

    ${label('出勤時間')}
    ${inputField('editAttStart', 'time', '', record.clock_in || '')}

    ${label('退勤時間')}
    ${inputField('editAttEnd', 'time', '', record.clock_out || '')}

    ${label('休憩時間（分）')}
    ${inputField('editAttBreak', 'number', '60', record.break_minutes || 0)}

    <div style="display:flex;gap:8px;margin-top:20px;">
      <div style="flex:1;">${btn('キャンセル', 'btnCancelAttEdit', 'secondary')}</div>
      <div style="flex:1;">${btn('修正する', 'btnUpdateAtt')}</div>
    </div>
  `);

  container.querySelector('#btnCancelAttEdit').addEventListener('click', () => {
    renderAttendanceCalendar(container, month, staff, params);
  });

  container.querySelector('#btnUpdateAtt').addEventListener('click', async () => {
    const start = container.querySelector('#editAttStart').value;
    const end = container.querySelector('#editAttEnd').value;
    const breakMin = parseInt(container.querySelector('#editAttBreak').value) || 0;

    if (!start || !end) {
      showToast('出勤・退勤を入力してください');
      return;
    }

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let actualMin = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
    if (actualMin < 0) actualMin = 0;

    const updatedRecord = {
      staff_name: record.staff_name,
      work_date: record.work_date,
      clock_in: start,
      clock_out: end,
      break_minutes: breakMin,
      actual_minutes: actualMin,
      recorded_by: staff.name,
    };

    const saved = await db.saveAttendance(updatedRecord);
    if (saved) {
      showToast('勤怠を修正しました');
      renderAttendanceCalendar(container, month, staff, params);
    } else {
      showToast('修正に失敗しました');
    }
  });
}

// 届出フォーム
function renderLeaveNotice(container, staff) {
  const types = [
    { value: '欠勤', label: '欠勤' },
    { value: '遅刻', label: '遅刻' },
    { value: '早退', label: '早退' },
    { value: '有給休暇', label: '有給休暇' },
    { value: 'その他', label: 'その他' },
  ];

  container.innerHTML = card(`
    ${sectionTitle('欠勤・遅刻・早退 届出')}

    ${label('届出種類')}
    ${selectBox('leaveType', types, '欠勤')}

    ${label('日付')}
    ${inputField('leaveDate', 'date', '', getTodayStr())}

    <div id="leaveTimeRow">
      ${label('時間（遅刻・早退の場合）')}
      ${inputField('leaveTime', 'time', '')}
    </div>

    ${label('理由')}
    <textarea id="leaveReason" rows="3" placeholder="理由を入力" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>

    <div style="margin-top:20px;">
      ${btn('届出を送信', 'btnSubmitLeave')}
    </div>
  `);

  const typeSelect = container.querySelector('#leaveType');
  const timeRow = container.querySelector('#leaveTimeRow');

  typeSelect.addEventListener('change', () => {
    const val = typeSelect.value;
    timeRow.style.display = (val === '遅刻' || val === '早退') ? '' : 'none';
  });

  // 初期状態で欠勤の場合は時間欄を非表示
  timeRow.style.display = 'none';

  container.querySelector('#btnSubmitLeave').addEventListener('click', async () => {
    const type = typeSelect.value;
    const date = container.querySelector('#leaveDate').value;
    const time = container.querySelector('#leaveTime').value;
    const reason = container.querySelector('#leaveReason').value.trim();

    if (!date) {
      showToast('日付を入力してください');
      return;
    }
    if (!reason) {
      showToast('理由を入力してください');
      return;
    }

    const notice = {
      staff_name: staff.name,
      notice_type: type,
      notice_date: date,
      notice_time: time || null,
      reason,
    };

    const saved = await db.createLeaveNotice(notice);
    if (saved) {
      showToast('届出を送信しました');
      container.querySelector('#leaveReason').value = '';
    } else {
      showToast('送信に失敗しました');
    }
  });
}

// ============================================================
// チャットモジュール
// ============================================================
function renderChat(container, params, staff) {
  const subTab = params.chatTab || 'rooms';

  container.innerHTML = `
    ${tabBar([
      { id: 'rooms', label: '💬 チャットルーム' },
      { id: 'ai', label: '🤖 AI相談' },
    ], subTab, 'data-chattab')}
    <div id="chatBody"></div>
  `;

  container.querySelectorAll('[data-chattab]').forEach(el => {
    el.addEventListener('click', () => {
      renderChat(container, { ...params, chatTab: el.dataset.chattab }, staff);
    });
  });

  const body = container.querySelector('#chatBody');

  switch (subTab) {
    case 'rooms': renderChatRooms(body); break;
    case 'ai': renderAIChat(body, staff); break;
  }
}

function renderChatRooms(container) {
  container.innerHTML = `
    ${sectionTitle('Google Chat ルーム')}
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${GOOGLE_CHAT_ROOMS.map(room => card(`
        <a href="${room.url}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;text-decoration:none;">
          <div style="width:44px;height:44px;border-radius:12px;background:#111;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${room.icon}</div>
          <div style="flex:1;">
            <div style="color:${TEXT_PRIMARY};font-size:15px;font-weight:bold;">${escapeHtml(room.name)}</div>
            <div style="color:${TEXT_MUTED};font-size:11px;">タップで開く</div>
          </div>
          <div style="color:${GOLD};font-size:18px;">→</div>
        </a>
      `, 'cursor:pointer;')).join('')}
    </div>
  `;
}

function renderAIChat(container, staff) {
  // チャット履歴をセッション内で保持
  if (!renderAIChat._history) renderAIChat._history = [];
  const history = renderAIChat._history;

  container.innerHTML = `
    ${sectionTitle('AI業務相談')}

    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
      ${AI_QUICK_TEMPLATES.map((t, i) => `<button data-tpl="${i}" style="padding:6px 12px;border-radius:16px;background:#222;color:${TEXT_SECONDARY};border:1px solid ${BORDER};font-size:12px;cursor:pointer;white-space:nowrap;">${escapeHtml(t)}</button>`).join('')}
    </div>

    <div id="aiMessages" style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;padding:4px;">
      ${history.length === 0 ? `<div style="text-align:center;padding:40px 0;color:${TEXT_MUTED};font-size:13px;">質問を入力するか、テンプレートをタップしてください</div>` : ''}
      ${history.map(msg => chatBubble(msg.role, msg.content)).join('')}
    </div>

    <div style="display:flex;gap:8px;">
      <textarea id="aiInput" rows="1" placeholder="質問を入力..." style="flex:1;padding:10px 12px;border-radius:12px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:none;min-height:42px;max-height:120px;box-sizing:border-box;"></textarea>
      <button id="aiSend" style="width:42px;height:42px;border-radius:50%;background:${GOLD};border:none;color:#000;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">▶</button>
    </div>
  `;

  const messagesEl = container.querySelector('#aiMessages');
  const input = container.querySelector('#aiInput');

  // 自動スクロール
  if (history.length > 0) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // テキストエリア自動リサイズ
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // テンプレートクリック
  container.querySelectorAll('[data-tpl]').forEach(el => {
    el.addEventListener('click', () => {
      input.value = AI_QUICK_TEMPLATES[parseInt(el.dataset.tpl)];
      sendAIMessage();
    });
  });

  // 送信
  container.querySelector('#aiSend').addEventListener('click', sendAIMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIMessage();
    }
  });

  async function sendAIMessage() {
    const message = input.value.trim();
    if (!message) return;

    // ユーザーメッセージ追加
    history.push({ role: 'user', content: message });
    input.value = '';
    input.style.height = 'auto';

    // 再描画
    renderAIChatMessages(messagesEl, history);

    // ローディング表示
    const loadingEl = document.createElement('div');
    loadingEl.innerHTML = chatBubble('ai', '考え中...');
    loadingEl.style.opacity = '0.5';
    messagesEl.appendChild(loadingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const resp = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        },
        body: JSON.stringify({
          image: null,
          step: 'chat',
          context: {
            question: message,
            staffName: staff.name,
          },
        }),
      });

      loadingEl.remove();

      if (!resp.ok) throw new Error(`AI応答失敗: ${resp.status}`);

      const data = await resp.json();
      const reply = data.raw || data.reply || (data.success && data.judgment) || '応答を取得できませんでした。';

      history.push({ role: 'ai', content: reply });
    } catch (e) {
      loadingEl.remove();
      console.error('AI chat error:', e);
      history.push({ role: 'ai', content: '通信エラーが発生しました。もう一度お試しください。' });
    }

    renderAIChatMessages(messagesEl, history);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderAIChatMessages(el, history) {
  if (history.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:40px 0;color:${TEXT_MUTED};font-size:13px;">質問を入力するか、テンプレートをタップしてください</div>`;
  } else {
    el.innerHTML = history.map(msg => chatBubble(msg.role, msg.content)).join('');
  }
}

function chatBubble(role, content) {
  const isUser = role === 'user';
  return `<div style="display:flex;${isUser ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
    <div style="max-width:85%;padding:10px 14px;border-radius:${isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};background:${isUser ? GOLD + '33' : '#222'};color:${isUser ? GOLD : TEXT_PRIMARY};font-size:14px;line-height:1.6;word-break:break-word;white-space:pre-wrap;">
      ${isUser ? '' : '<div style="font-size:10px;color:' + TEXT_MUTED + ';margin-bottom:4px;">AI</div>'}${escapeHtml(content)}
    </div>
  </div>`;
}

// ============================================================
// チームカレンダーモジュール
// ============================================================
async function renderCalendar(container, params, staff) {
  const month = params.calendarMonth || getCurrentMonth();
  const selectedDay = params.calendarDay || null;

  showLoading(container);

  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1).getDay();
  const daysInMonth = new Date(year, mon, 0).getDate();
  const todayStr = getTodayStr();

  // work_logs from DB for the month
  const dbClient = db.getDB();
  let workLogs = [];
  if (dbClient) {
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    const { data } = await dbClient.from('work_logs')
      .select('*')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('work_date', { ascending: true });
    workLogs = data || [];
  }

  // Aggregate by day
  const dayStats = {};
  for (const log of workLogs) {
    const d = log.work_date;
    if (!dayStats[d]) dayStats[d] = { bunka: 0, shuppin: 0, konpo: 0, shukka: 0, total: 0 };
    const type = (log.work_type || '').toLowerCase();
    if (type.includes('分荷') || type.includes('判定')) dayStats[d].bunka++;
    else if (type.includes('出品') || type.includes('リスト')) dayStats[d].shuppin++;
    else if (type.includes('梱包') || type.includes('パック')) dayStats[d].konpo++;
    else if (type.includes('出荷') || type.includes('発送')) dayStats[d].shukka++;
    dayStats[d].total++;
  }

  // Determine workload color per day
  function getWorkloadColor(dateStr) {
    const s = dayStats[dateStr];
    if (!s) return 'transparent';
    if (s.total >= 20) return '#e74c3c33'; // red bottleneck
    if (s.total >= 10) return '#ff980033'; // yellow heavy
    return '#4caf5033'; // green normal
  }

  function getDayIndicators(dateStr) {
    const s = dayStats[dateStr];
    if (!s) return '';
    let icons = '';
    if (s.shukka > 0) icons += '🚚';
    if (s.bunka > 0) icons += '📷';
    return icons ? `<div style="font-size:9px;line-height:1;margin-top:1px;">${icons}</div>` : '';
  }

  // Selected day detail
  let dayDetail = '';
  if (selectedDay) {
    const s = dayStats[selectedDay] || { bunka: 0, shuppin: 0, konpo: 0, shukka: 0, total: 0 };
    dayDetail = card(`
      ${sectionTitle('📋 ' + selectedDay + ' の活動')}
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:11px;">分荷</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${s.bunka}<span style="font-size:12px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:11px;">出品</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${s.shuppin}<span style="font-size:12px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:11px;">梱包</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${s.konpo}<span style="font-size:12px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:11px;">出荷</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${s.shukka}<span style="font-size:12px;color:${TEXT_MUTED};">件</span></div>
        </div>
      </div>
      <div style="text-align:center;margin-top:8px;color:${TEXT_MUTED};font-size:12px;">合計 ${s.total} 件の作業</div>
    `);
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <button id="teamCalPrev" style="background:none;border:none;color:${GOLD};font-size:18px;cursor:pointer;padding:8px;">← 前月</button>
      <div style="color:${TEXT_PRIMARY};font-size:16px;font-weight:bold;">${year}年${String(mon).padStart(2, '0')}月</div>
      <button id="teamCalNext" style="background:none;border:none;color:${GOLD};font-size:18px;cursor:pointer;padding:8px;">次月 →</button>
    </div>

    <!-- 凡例 -->
    ${card(`
      <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;border-radius:3px;background:#4caf5033;border:1px solid #4caf50;"></div><span style="color:${TEXT_SECONDARY};font-size:11px;">通常</span></div>
        <div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;border-radius:3px;background:#ff980033;border:1px solid #ff9800;"></div><span style="color:${TEXT_SECONDARY};font-size:11px;">多忙</span></div>
        <div style="display:flex;align-items:center;gap:4px;"><div style="width:12px;height:12px;border-radius:3px;background:#e74c3c33;border:1px solid #e74c3c;"></div><span style="color:${TEXT_SECONDARY};font-size:11px;">ボトルネック</span></div>
        <div style="display:flex;align-items:center;gap:4px;"><span style="font-size:11px;">🚚出荷</span><span style="font-size:11px;">📷分荷</span></div>
      </div>
    `, 'padding:10px;')}

    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">
      ${['日', '月', '火', '水', '木', '金', '土'].map((d, i) =>
        `<div style="color:${i === 0 ? '#c0392b' : i === 6 ? '#3498db' : TEXT_SECONDARY};font-size:11px;padding:4px;">${d}</div>`
      ).join('')}

      ${Array(firstDay).fill('<div></div>').join('')}

      ${Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${month}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedDay;
        const dow = new Date(year, mon - 1, day).getDay();
        const isSunday = dow === 0;
        const isSaturday = dow === 6;

        let cellColor = TEXT_PRIMARY;
        if (isSunday) cellColor = '#c0392b';
        else if (isSaturday) cellColor = '#3498db';

        const bgColor = getWorkloadColor(dateStr);
        const indicators = getDayIndicators(dateStr);

        return `<div data-calday="${dateStr}" style="padding:4px 2px;border-radius:8px;background:${bgColor};${isToday ? `border:2px solid ${GOLD};` : isSelected ? `border:2px solid #2196f3;` : ''}min-height:48px;cursor:pointer;transition:opacity 0.2s;" ontouchstart="this.style.opacity='0.7'" ontouchend="this.style.opacity='1'">
          <div style="color:${cellColor};font-size:13px;font-weight:${isToday ? 'bold' : 'normal'};">${day}</div>
          ${dayStats[dateStr] ? `<div style="font-size:9px;color:${TEXT_MUTED};">${dayStats[dateStr].total}件</div>` : ''}
          ${indicators}
        </div>`;
      }).join('')}
    </div>

    <div id="calendarDayDetail" style="margin-top:16px;">
      ${dayDetail}
    </div>
  `;

  // Month navigation
  function navMonth(offset) {
    const d = new Date(year, mon - 1 + offset, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renderCalendar(container, { ...params, calendarMonth: newMonth, calendarDay: null }, staff);
  }

  container.querySelector('#teamCalPrev').addEventListener('click', () => navMonth(-1));
  container.querySelector('#teamCalNext').addEventListener('click', () => navMonth(1));

  // Day click
  container.querySelectorAll('[data-calday]').forEach(el => {
    el.addEventListener('click', () => {
      renderCalendar(container, { ...params, calendarMonth: month, calendarDay: el.dataset.calday }, staff);
    });
  });
}

// ============================================================
// 委託販売レポート
// ============================================================

async function renderConsignmentReport(container, params, staff) {
  const selectedPartner = params.consignPartner || 'ビッグスポーツ';
  const selectedMonth = params.consignMonth || getCurrentMonth();
  const partners = ['ビッグスポーツ', '渡辺質店'];

  // 月セレクター用: 直近6ヶ月
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  container.innerHTML = `
    ${sectionTitle('委託販売レポート')}
    ${card(`
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        ${partners.map(p => `<button class="consign-partner-btn" data-partner="${escapeHtml(p)}" style="flex:1;padding:10px;border-radius:8px;border:none;font-size:13px;font-weight:bold;cursor:pointer;${p === selectedPartner ? `background:${GOLD};color:#000;` : `background:#222;color:${TEXT_SECONDARY};`}">${escapeHtml(p)}</button>`).join('')}
      </div>
      <div style="margin-bottom:8px;">
        ${label('対象月')}
        ${selectBox('consignMonthSelect', months.map(m => ({ value: m, label: m })), selectedMonth)}
      </div>
    `)}
    <div id="consignReportBody"></div>
  `;

  // パートナー切替
  container.querySelectorAll('.consign-partner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderConsignmentReport(container, { ...params, consignPartner: btn.dataset.partner, tab: 'consignment' }, staff);
    });
  });

  // 月切替
  container.querySelector('#consignMonthSelect')?.addEventListener('change', (e) => {
    renderConsignmentReport(container, { ...params, consignMonth: e.target.value, tab: 'consignment' }, staff);
  });

  const reportBody = container.querySelector('#consignReportBody');
  showLoading(reportBody);

  // データ取得: consignment_partner が一致 & sold_at が対象月内
  try {
    const allItems = await db.getItems({
      orderBy: 'sold_at',
      ascending: false,
    });

    // フィルタ: 委託先一致 & 対象月に売れたもの
    const monthStart = selectedMonth + '-01';
    const nextMonth = (() => {
      const d = new Date(monthStart + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();

    const items = allItems.filter(item => {
      if (item.consignment_partner !== selectedPartner) return false;
      if (!item.sold_at) return false;
      const soldDate = item.sold_at.slice(0, 10);
      return soldDate >= monthStart && soldDate < nextMonth;
    });

    // 返却中の商品も取得
    const returnItems = allItems.filter(item => {
      return item.consignment_partner === selectedPartner && item.return_status && item.return_status !== '';
    });

    if (items.length === 0 && returnItems.length === 0) {
      reportBody.innerHTML = `<div style="text-align:center;color:${TEXT_MUTED};padding:40px;font-size:14px;">該当データなし</div>`;
      return;
    }

    // 集計
    let totalSold = 0;
    let totalFee = 0;
    let totalTkbShare = 0;
    let totalPartnerShare = 0;

    const partnerConfig = CONFIG.CONSIGNMENT[selectedPartner];

    const rows = items.map(item => {
      const sold = item.sold_price || 0;
      const fee = item.platform_fee || 0;
      const rate = item.commission_rate || (partnerConfig?.rate) || 0;
      const tkbShare = Math.round(sold * rate / 100);
      const tkbAfterFee = tkbShare - fee;
      const partnerPay = sold - tkbShare;

      totalSold += sold;
      totalFee += fee;
      totalTkbShare += tkbAfterFee;
      totalPartnerShare += partnerPay;

      return `<tr style="border-bottom:1px solid #222;">
        <td style="padding:8px 4px;color:${GOLD};font-size:12px;white-space:nowrap;">${escapeHtml(item.mgmt_num)}</td>
        <td style="padding:8px 4px;color:${TEXT_PRIMARY};font-size:12px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.product_name || '')}</td>
        <td style="padding:8px 4px;color:${TEXT_PRIMARY};font-size:12px;text-align:right;">${formatPrice(sold)}</td>
        <td style="padding:8px 4px;color:#f44336;font-size:12px;text-align:right;">${formatPrice(fee)}</td>
        <td style="padding:8px 4px;color:#4caf50;font-size:12px;text-align:right;">${formatPrice(tkbAfterFee)}</td>
        <td style="padding:8px 4px;color:${TEXT_PRIMARY};font-size:12px;text-align:right;">${formatPrice(partnerPay)}</td>
      </tr>`;
    }).join('');

    reportBody.innerHTML = `
      ${items.length > 0 ? `
        ${sectionTitle(`売上明細 (${items.length}件)`)}
        ${card(`
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <table style="width:100%;border-collapse:collapse;min-width:500px;">
              <thead>
                <tr style="border-bottom:2px solid #333;">
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:left;">管理番号</th>
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:left;">商品名</th>
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:right;">落札価格</th>
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:right;">手数料</th>
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:right;">TKB利益</th>
                  <th style="padding:8px 4px;color:${TEXT_SECONDARY};font-size:11px;text-align:right;">委託元払い</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr style="border-top:2px solid ${GOLD};">
                  <td colspan="2" style="padding:10px 4px;color:${GOLD};font-size:13px;font-weight:bold;">合計</td>
                  <td style="padding:10px 4px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;text-align:right;">${formatPrice(totalSold)}</td>
                  <td style="padding:10px 4px;color:#f44336;font-size:13px;font-weight:bold;text-align:right;">${formatPrice(totalFee)}</td>
                  <td style="padding:10px 4px;color:#4caf50;font-size:13px;font-weight:bold;text-align:right;">${formatPrice(totalTkbShare)}</td>
                  <td style="padding:10px 4px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;text-align:right;">${formatPrice(totalPartnerShare)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `)}
      ` : ''}

      ${returnItems.length > 0 ? `
        ${sectionTitle(`返却予定 (${returnItems.length}件)`)}
        ${card(`
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${returnItems.map(item => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #222;">
                <div>
                  <div style="color:${GOLD};font-size:12px;">${escapeHtml(item.mgmt_num)}</div>
                  <div style="color:${TEXT_PRIMARY};font-size:13px;">${escapeHtml(item.product_name || '')}</div>
                </div>
                <div style="text-align:right;">
                  <div style="color:#ff9800;font-size:12px;font-weight:bold;">${escapeHtml(item.return_status)}</div>
                  <div style="color:${TEXT_MUTED};font-size:11px;">${escapeHtml(item.return_reason || '')}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `)}
      ` : ''}

      ${items.length > 0 ? `
        <div style="margin-top:12px;">
          ${btn('CSVダウンロード', 'btnConsignCsv', 'ghost')}
        </div>
      ` : ''}
    `;

    // CSVダウンロード
    const csvBtn = reportBody.querySelector('#btnConsignCsv');
    if (csvBtn) {
      csvBtn.addEventListener('click', () => {
        const csvHeaders = ['管理番号', '商品名', '落札価格', 'ヤフオク手数料', 'テイクバック利益', '委託元支払い', '落札日'];
        const csvRows = items.map(item => {
          const sold = item.sold_price || 0;
          const fee = item.platform_fee || 0;
          const rate = item.commission_rate || (partnerConfig?.rate) || 0;
          const tkbShare = Math.round(sold * rate / 100) - fee;
          const partnerPay = sold - Math.round(sold * rate / 100);
          return [
            item.mgmt_num,
            item.product_name || '',
            sold,
            fee,
            tkbShare,
            partnerPay,
            item.sold_at ? item.sold_at.slice(0, 10) : '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });

        const csvContent = '\uFEFF' + csvHeaders.map(h => `"${h}"`).join(',') + '\n' + csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `委託レポート_${selectedPartner}_${selectedMonth}.csv`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('CSVをダウンロードしました');
      });
    }
  } catch (e) {
    console.error('委託レポート取得エラー:', e);
    reportBody.innerHTML = `<div style="text-align:center;color:#f44336;padding:20px;">データの取得に失敗しました</div>`;
  }
}

// ============================================================
// KPI & ダッシュボード
// ============================================================
async function renderKPI(container, params, staff) {
  showLoading(container);

  const [todayStats, statusCounts] = await Promise.all([
    db.getTodayStats(),
    db.getStatusCounts(),
  ]);

  const targets = CONFIG.DAILY_KPI;
  const dow = getDayOfWeek();
  const todayDuty = CONFIG.DUTY_ROTATION[dow] || {};

  // ボトルネック検出
  const bottlenecks = [];
  const thresholds = { '撮影待ち': 30, '出品待ち': 50, '梱包待ち': 20, '入金待ち': 15 };
  for (const [status, limit] of Object.entries(thresholds)) {
    const count = statusCounts[status] || 0;
    if (count >= limit) {
      bottlenecks.push({ status, count, limit });
    }
  }

  container.innerHTML = `
    ${sectionTitle('今日の実績')}

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
      ${kpiCard('分荷', todayStats.judged, targets.bunka, '⚖️')}
      ${kpiCard('出品', todayStats.listed, targets.shuppin, '📝')}
      ${kpiCard('梱包', todayStats.packed, targets.konpo, '📦')}
      ${kpiCard('出荷', todayStats.shipped, null, '🚚')}
    </div>

    ${bottlenecks.length > 0 ? `
      ${sectionTitle('⚠️ ボトルネック警告')}
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${bottlenecks.map(b => card(`
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="font-size:24px;">🚨</div>
            <div style="flex:1;">
              <div style="color:#e74c3c;font-size:14px;font-weight:bold;">${escapeHtml(b.status)}: ${b.count}件</div>
              <div style="color:${TEXT_MUTED};font-size:12px;">基準値 ${b.limit}件を超過しています</div>
            </div>
          </div>
        `, `border-left:3px solid #e74c3c;`)).join('')}
      </div>
    ` : ''}

    ${sectionTitle('ステータス分布')}
    ${card(renderStatusDistribution(statusCounts))}

    ${sectionTitle('今日の当番')}
    ${card(renderDutyTable(todayDuty, dow))}

    ${sectionTitle('スタッフタイムライン')}
    <div id="staffTimeline"></div>
  `;

  // スタッフタイムライン（非同期で取得）
  renderStaffTimeline(container.querySelector('#staffTimeline'));
}

function kpiCard(label, actual, target, icon) {
  const pct = target ? Math.min(Math.round(actual / target * 100), 100) : null;
  const color = pct !== null ? (pct >= 100 ? '#4caf50' : pct >= 50 ? '#ff9800' : '#e74c3c') : GOLD;

  return card(`
    <div style="text-align:center;">
      <div style="font-size:20px;margin-bottom:4px;">${icon}</div>
      <div style="color:${TEXT_SECONDARY};font-size:11px;">${label}</div>
      <div style="color:${color};font-size:24px;font-weight:bold;">${actual}</div>
      ${target ? `
        <div style="color:${TEXT_MUTED};font-size:11px;">目標: ${target}</div>
        <div style="height:4px;background:#222;border-radius:2px;margin-top:6px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width 0.5s;"></div>
        </div>
        <div style="color:${color};font-size:11px;margin-top:2px;font-weight:bold;">${pct}%</div>
      ` : ''}
    </div>
  `, 'padding:12px;');
}

function renderStatusDistribution(counts) {
  const flow = CONFIG.STATUS_FLOW;
  const total = counts._total || 1;
  const rows = flow.filter(s => counts[s]).map(s => {
    const count = counts[s] || 0;
    const pct = Math.round(count / total * 100);
    const barW = Math.max(pct, 2);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="width:80px;font-size:11px;color:${TEXT_SECONDARY};text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s}</div>
      <div style="flex:1;height:14px;background:#222;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${barW}%;background:${GOLD};border-radius:3px;min-width:2px;"></div>
      </div>
      <div style="width:50px;font-size:12px;color:${TEXT_PRIMARY};text-align:right;flex-shrink:0;">${count}<span style="color:${TEXT_MUTED};font-size:10px;margin-left:2px;">(${pct}%)</span></div>
    </div>`;
  });

  if (rows.length === 0) return `<div style="color:${TEXT_MUTED};font-size:13px;text-align:center;padding:12px;">データなし</div>`;
  return rows.join('');
}

function renderDutyTable(duty, dow) {
  const dayNames = { 1: '月', 2: '火', 3: '水', 4: '木', 5: '金', 6: '土', 7: '日' };
  const dayName = dayNames[dow] || '—';

  if (!duty || Object.keys(duty).length === 0) {
    return `<div style="color:${TEXT_MUTED};font-size:13px;text-align:center;padding:12px;">今日(${dayName})の当番データなし</div>`;
  }

  let html = `<div style="color:${TEXT_SECONDARY};font-size:12px;margin-bottom:8px;">今日（${dayName}曜日）</div>`;
  html += '<div style="display:flex;flex-direction:column;gap:6px;">';

  for (const [task, assignees] of Object.entries(duty)) {
    let names = '';
    if (Array.isArray(assignees)) {
      names = assignees.join(', ');
    } else if (assignees) {
      names = assignees;
    } else {
      names = '—（休み）';
    }

    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid ${BORDER}22;">
      <span style="color:${TEXT_SECONDARY};font-size:13px;">${escapeHtml(task)}</span>
      <span style="color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;">${escapeHtml(names)}</span>
    </div>`;
  }

  html += '</div>';
  return html;
}

async function renderStaffTimeline(container) {
  const today = getTodayStr();
  const month = getCurrentMonth();

  // 全スタッフの今日の勤怠を取得
  const staffNames = Object.keys(CONFIG.STAFF_MARKS);
  const timelines = [];

  for (const name of staffNames) {
    const records = await db.getAttendance(name, month);
    const todayRecord = records.find(r => r.work_date === today);
    timelines.push({ name, record: todayRecord });
  }

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;">
    ${timelines.map(t => {
      const mark = CONFIG.STAFF_MARKS[t.name] || '';
      const isWorking = t.record && t.record.clock_in && !t.record.clock_out;
      const hasRecord = !!t.record;

      let statusText = '未打刻';
      let statusColor = TEXT_MUTED;
      if (t.record?.clock_in && t.record?.clock_out) {
        statusText = `${t.record.clock_in} - ${t.record.clock_out}`;
        statusColor = '#4caf50';
      } else if (t.record?.clock_in) {
        statusText = `${t.record.clock_in} - 勤務中`;
        statusColor = GOLD;
      }

      return card(`
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:28px;height:28px;border-radius:50%;background:${hasRecord ? GOLD + '33' : '#222'};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">${mark}</div>
          <div style="flex:1;min-width:0;">
            <div style="color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;">${escapeHtml(t.name)}</div>
          </div>
          <div style="color:${statusColor};font-size:12px;flex-shrink:0;">${statusText}</div>
        </div>
      `, 'padding:10px 12px;');
    }).join('')}
  </div>`;
}

// ============================================================
// 声ポイント制度モジュール
// ============================================================
const VOICE_STATUS_LABELS = {
  '投稿': { color: '#2196f3', bg: '#2196f322' },
  '受理': { color: '#ff9800', bg: '#ff980022' },
  '採用': { color: '#4caf50', bg: '#4caf5022' },
  '実装': { color: '#9c27b0', bg: '#9c27b022' },
  '優秀': { color: '#C5A258', bg: '#C5A25822' },
};

const VOICE_POINTS = { '投稿': 1, '受理': 2, '採用': 5, '実装': 10, '優秀': 20 };

async function renderVoice(container, params, staff) {
  showLoading(container);

  const dbClient = db.getDB();
  let voiceItems = [];
  let totalPoints = 0;

  if (dbClient) {
    const { data } = await dbClient.from('voice_points')
      .select('*')
      .eq('staff_name', staff.name)
      .order('created_at', { ascending: false })
      .limit(50);
    voiceItems = data || [];
    totalPoints = voiceItems.reduce((sum, v) => sum + (VOICE_POINTS[v.status] || 0), 0);
  }

  container.innerHTML = `
    <!-- ポイント合計 -->
    ${card(`
      <div style="text-align:center;">
        <div style="color:${TEXT_SECONDARY};font-size:12px;">あなたの声ポイント</div>
        <div style="color:${GOLD};font-size:36px;font-weight:bold;margin:8px 0;">${totalPoints}<span style="font-size:14px;color:${TEXT_SECONDARY};margin-left:4px;">pt</span></div>
        <div style="color:${TEXT_MUTED};font-size:11px;">${voiceItems.length}件の提案</div>
      </div>
    `)}

    <!-- 新規提案フォーム -->
    ${card(`
      ${sectionTitle('新しい提案を投稿')}
      <textarea id="voiceContent" rows="3" placeholder="改善提案、気づいたこと、アイデアなどを自由に書いてください" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
      <div style="margin-top:12px;">
        ${btn('提案を投稿する', 'btnSubmitVoice')}
      </div>
    `)}

    <!-- 過去の提案リスト -->
    ${sectionTitle('投稿履歴')}
    <div id="voiceList">
      ${voiceItems.length === 0
        ? emptyState('🗣', 'まだ提案がありません。最初の声を上げましょう！')
        : voiceItems.map(v => {
          const st = VOICE_STATUS_LABELS[v.status] || { color: TEXT_MUTED, bg: '#33333333' };
          const pts = VOICE_POINTS[v.status] || 0;
          return card(`
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1;min-width:0;">
                <div style="color:${TEXT_PRIMARY};font-size:14px;line-height:1.5;word-break:break-word;">${escapeHtml(v.content || '')}</div>
                <div style="color:${TEXT_MUTED};font-size:11px;margin-top:6px;">${formatDateTime(v.created_at)}</div>
              </div>
              <div style="text-align:right;margin-left:12px;flex-shrink:0;">
                <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;background:${st.bg};color:${st.color};">${escapeHtml(v.status || '投稿')}</span>
                <div style="color:${GOLD};font-size:12px;font-weight:bold;margin-top:4px;">+${pts}pt</div>
              </div>
            </div>
          `);
        }).join('')
      }
    </div>
  `;

  // 投稿ボタン
  container.querySelector('#btnSubmitVoice').addEventListener('click', async () => {
    const content = container.querySelector('#voiceContent').value.trim();
    if (!content) {
      showToast('提案内容を入力してください');
      return;
    }

    if (!dbClient) {
      showToast('データベースに接続できません');
      return;
    }

    const { data, error } = await dbClient.from('voice_points').insert({
      staff_name: staff.name,
      content,
      status: '投稿',
    }).select().single();

    if (error) {
      console.error('Voice submit error:', error);
      showToast('投稿に失敗しました');
      return;
    }

    showToast('提案を投稿しました！ +1pt');
    renderVoice(container, params, staff);
  });
}

// ============================================================
// 知識蓄積モジュール
// ============================================================
const KNOWLEDGE_CATEGORIES = ['相場', '業者', 'コツ', 'メモ'];

async function renderKnowledge(container, params, staff) {
  showLoading(container);

  const dbClient = db.getDB();
  let knowledgeItems = [];
  const selectedCategory = params.knowledgeCategory || '';
  const searchQuery = params.knowledgeSearch || '';

  if (dbClient) {
    let query = dbClient.from('knowledge')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (selectedCategory) {
      query = query.eq('category', selectedCategory);
    }
    if (searchQuery) {
      query = query.or(`title.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%`);
    }

    const { data } = await query;
    knowledgeItems = data || [];
  }

  const categoryColors = { '相場': '#2196f3', '業者': '#ff9800', 'コツ': '#4caf50', 'メモ': '#9c27b0' };

  container.innerHTML = `
    <!-- 検索バー -->
    <div style="position:relative;margin-bottom:12px;">
      <input id="knowledgeSearch" type="search" placeholder="知識を検索..."
        value="${escapeHtml(searchQuery)}"
        style="width:100%;box-sizing:border-box;padding:10px 12px 10px 36px;border-radius:10px;border:1px solid #333;background:#111;color:#e0e0e0;font-size:14px;outline:none;" />
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#666;font-size:16px;">🔍</span>
    </div>

    <!-- カテゴリフィルタ -->
    <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;">
      <button data-kcat="" style="padding:6px 14px;border-radius:20px;border:none;font-size:12px;cursor:pointer;white-space:nowrap;${!selectedCategory ? `background:${GOLD};color:#000;font-weight:bold;` : 'background:#222;color:#888;'}">全て</button>
      ${KNOWLEDGE_CATEGORIES.map(cat => `
        <button data-kcat="${cat}" style="padding:6px 14px;border-radius:20px;border:none;font-size:12px;cursor:pointer;white-space:nowrap;${selectedCategory === cat ? `background:${categoryColors[cat] || GOLD};color:#000;font-weight:bold;` : `background:#222;color:${categoryColors[cat] || '#888'};`}">${cat}</button>
      `).join('')}
    </div>

    <!-- 新規登録フォーム -->
    <details id="knowledgeForm" style="margin-bottom:16px;">
      <summary style="color:${GOLD};font-size:14px;font-weight:bold;cursor:pointer;padding:8px 0;">+ 新しい知識を追加</summary>
      ${card(`
        ${label('カテゴリ')}
        ${selectBox('kNewCategory', KNOWLEDGE_CATEGORIES, '', '選択してください')}

        ${label('タイトル')}
        ${inputField('kNewTitle', 'text', '例: ルイヴィトン モノグラム 相場目安')}

        ${label('内容')}
        <textarea id="kNewContent" rows="4" placeholder="具体的な内容を記載" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>

        <div style="margin-top:12px;">
          ${btn('保存する', 'btnSaveKnowledge')}
        </div>
      `)}
    </details>

    <!-- 知識リスト -->
    ${sectionTitle(`知識ベース（${knowledgeItems.length}件）`)}
    <div id="knowledgeList">
      ${knowledgeItems.length === 0
        ? emptyState('📚', selectedCategory || searchQuery ? 'この条件に一致する知識はありません' : 'まだ知識が登録されていません。チームの知恵を蓄積しましょう！')
        : knowledgeItems.map(k => {
          const catColor = categoryColors[k.category] || TEXT_MUTED;
          return card(`
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;background:${catColor}22;color:${catColor};">${escapeHtml(k.category || 'メモ')}</span>
                <span style="color:${TEXT_MUTED};font-size:11px;">${formatDate(k.created_at)} ${escapeHtml(k.created_by || '')}</span>
              </div>
              <div style="color:${TEXT_PRIMARY};font-size:15px;font-weight:bold;margin-bottom:4px;">${escapeHtml(k.title || '')}</div>
              <div style="color:${TEXT_SECONDARY};font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(k.content || '')}</div>
            </div>
          `);
        }).join('')
      }
    </div>
  `;

  // カテゴリフィルタ
  container.querySelectorAll('[data-kcat]').forEach(btn => {
    btn.addEventListener('click', () => {
      renderKnowledge(container, { ...params, knowledgeCategory: btn.dataset.kcat, knowledgeSearch: searchQuery }, staff);
    });
  });

  // 検索
  let searchDebounce = null;
  container.querySelector('#knowledgeSearch').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      renderKnowledge(container, { ...params, knowledgeSearch: e.target.value.trim(), knowledgeCategory: selectedCategory }, staff);
    }, 400);
  });

  // 保存
  container.querySelector('#btnSaveKnowledge').addEventListener('click', async () => {
    const category = container.querySelector('#kNewCategory').value;
    const title = container.querySelector('#kNewTitle').value.trim();
    const content = container.querySelector('#kNewContent').value.trim();

    if (!category) { showToast('カテゴリを選択してください'); return; }
    if (!title) { showToast('タイトルを入力してください'); return; }
    if (!content) { showToast('内容を入力してください'); return; }

    if (!dbClient) {
      showToast('データベースに接続できません');
      return;
    }

    const { data, error } = await dbClient.from('knowledge').insert({
      category,
      title,
      content,
      created_by: staff.name,
    }).select().single();

    if (error) {
      console.error('Knowledge save error:', error);
      showToast('保存に失敗しました');
      return;
    }

    showToast('知識を保存しました');
    renderKnowledge(container, { ...params, knowledgeCategory: selectedCategory, knowledgeSearch: searchQuery }, staff);
  });
}

// ============================================================
// マイページ
// ============================================================
async function renderMyPage(container, params, staff) {
  const savedTheme = localStorage.getItem('tkb_v2_theme') || 'dark';
  const savedAvatar = localStorage.getItem('tkb_v2_avatar') || '👤';
  const savedBg = localStorage.getItem('tkb_v2_bg') || '';
  const mark = CONFIG.STAFF_MARKS[staff.name] || '';

  const avatars = ['👤', '😊', '🦊', '🐱', '🐶', '🦁', '🐻', '🐼', '🐨', '🐸', '🎃', '🤖', '👾', '🎩', '💎', '⭐'];

  const changeLog = [
    { version: '2.0.0', date: '2026-04-21', changes: 'v2全面リニューアル。入荷・販売・取引・業務の4モジュール構成に刷新。' },
    { version: '1.x', date: '〜2026-04', changes: '初期バージョン（Monday.com連携）' },
  ];

  const featureGuide = [
    { icon: '📦', title: '入荷モジュール', desc: '荷受け → 分荷判定 → 撮影までの工程を管理' },
    { icon: '🏷️', title: '販売モジュール', desc: '出品作業・在庫管理・価格設定' },
    { icon: '🤝', title: '取引モジュール', desc: '落札後〜発送完了までの取引フロー' },
    { icon: '⚙️', title: '業務モジュール', desc: '経費・勤怠・チャット・KPI・マイページ' },
  ];

  // 個人実績データを取得
  const dbClient = db.getDB();
  let myMonthStats = { bunka: 0, shuppin: 0, konpo: 0, shukka: 0 };
  let dailyCounts = []; // past 7 days
  let totalWorkMinutes = 0;
  let totalTasks = 0;

  if (dbClient) {
    const currentMonth = getCurrentMonth();
    const startOfMonth = `${currentMonth}-01`;
    const today = getTodayStr();

    // This month's work logs for this staff
    const { data: monthLogs } = await dbClient.from('work_logs')
      .select('*')
      .eq('staff_name', staff.name)
      .gte('work_date', startOfMonth)
      .lte('work_date', today)
      .order('work_date', { ascending: true });

    const logs = monthLogs || [];

    for (const log of logs) {
      const type = (log.work_type || '').toLowerCase();
      if (type.includes('分荷') || type.includes('判定')) myMonthStats.bunka++;
      else if (type.includes('出品') || type.includes('リスト')) myMonthStats.shuppin++;
      else if (type.includes('梱包') || type.includes('パック')) myMonthStats.konpo++;
      else if (type.includes('出荷') || type.includes('発送')) myMonthStats.shukka++;
      totalTasks++;
      if (log.duration_minutes) totalWorkMinutes += log.duration_minutes;
    }

    // Past 7 days daily counts
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const count = logs.filter(l => l.work_date === dateStr).length;
      dailyCounts.push({ date: dayLabel, count });
    }
  }

  const maxDaily = Math.max(...dailyCounts.map(d => d.count), 1);
  const avgMinPerTask = totalTasks > 0 ? Math.round(totalWorkMinutes / totalTasks) : 0;

  container.innerHTML = `
    ${card(`
      <div style="display:flex;align-items:center;gap:16px;">
        <div id="myAvatar" style="width:64px;height:64px;border-radius:50%;background:${GOLD}22;border:2px solid ${GOLD};display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;flex-shrink:0;${savedBg ? `background-image:url(${savedBg});background-size:cover;` : ''}">${savedAvatar}</div>
        <div>
          <div style="color:${TEXT_PRIMARY};font-size:18px;font-weight:bold;">${escapeHtml(staff.name)} ${mark}</div>
          <div style="color:${TEXT_SECONDARY};font-size:13px;">${escapeHtml(staff.company || 'テイクバック')} ・ ${staff.role === 'admin' ? '管理者' : 'スタッフ'}</div>
        </div>
      </div>
    `)}

    <!-- 今月の個人実績 -->
    ${sectionTitle('📊 今月の個人実績')}
    ${card(`
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:10px;">分荷</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${myMonthStats.bunka}<span style="font-size:10px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:10px;">出品</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${myMonthStats.shuppin}<span style="font-size:10px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:10px;">梱包</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${myMonthStats.konpo}<span style="font-size:10px;color:${TEXT_MUTED};">件</span></div>
        </div>
        <div style="text-align:center;padding:8px;background:#111;border-radius:8px;">
          <div style="color:${TEXT_SECONDARY};font-size:10px;">出荷</div>
          <div style="color:${GOLD};font-size:20px;font-weight:bold;">${myMonthStats.shukka}<span style="font-size:10px;color:${TEXT_MUTED};">件</span></div>
        </div>
      </div>

      <div style="color:${TEXT_SECONDARY};font-size:12px;margin-bottom:8px;">過去7日間の作業数</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:80px;margin-bottom:4px;">
        ${dailyCounts.map(d => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
            <div style="width:100%;background:${GOLD};border-radius:3px 3px 0 0;min-height:2px;height:${Math.round(d.count / maxDaily * 60)}px;transition:height 0.3s;"></div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:4px;">
        ${dailyCounts.map(d => `
          <div style="flex:1;text-align:center;">
            <div style="color:${TEXT_MUTED};font-size:9px;">${d.date}</div>
            <div style="color:${TEXT_PRIMARY};font-size:10px;font-weight:bold;">${d.count}</div>
          </div>
        `).join('')}
      </div>

      ${avgMinPerTask > 0 ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid ${BORDER};text-align:center;">
          <span style="color:${TEXT_SECONDARY};font-size:12px;">平均作業時間/件: </span>
          <span style="color:${GOLD};font-size:14px;font-weight:bold;">${avgMinPerTask}分</span>
        </div>
      ` : ''}
    `)}

    ${sectionTitle('アバター')}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${avatars.map(a => `<button data-avatar="${a}" style="width:40px;height:40px;border-radius:50%;background:${a === savedAvatar ? GOLD + '33' : '#222'};border:${a === savedAvatar ? `2px solid ${GOLD}` : `1px solid ${BORDER}`};font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;">${a}</button>`).join('')}
    </div>

    ${sectionTitle('背景カスタマイズ')}
    ${card(`
      <div style="display:flex;gap:8px;">
        ${btn('📷 写真を選択', 'btnBgPhoto', 'ghost')}
        ${btn('リセット', 'btnBgReset', 'secondary')}
      </div>
    `)}

    ${sectionTitle('テーマ')}
    ${card(`
      <div style="display:flex;gap:12px;">
        <label style="display:flex;align-items:center;gap:6px;color:${TEXT_PRIMARY};font-size:14px;cursor:pointer;">
          <input type="radio" name="theme" value="dark" ${savedTheme === 'dark' ? 'checked' : ''} style="accent-color:${GOLD};" /> ダーク
        </label>
        <label style="display:flex;align-items:center;gap:6px;color:${TEXT_PRIMARY};font-size:14px;cursor:pointer;">
          <input type="radio" name="theme" value="light" ${savedTheme === 'light' ? 'checked' : ''} style="accent-color:${GOLD};" /> ライト
        </label>
      </div>
      <p style="color:${TEXT_MUTED};font-size:11px;margin-top:8px;">※ ライトテーマは今後対応予定です</p>
    `)}

    ${sectionTitle('機能ガイド')}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
      ${featureGuide.map(f => card(`
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:24px;flex-shrink:0;">${f.icon}</div>
          <div>
            <div style="color:${TEXT_PRIMARY};font-size:14px;font-weight:bold;">${escapeHtml(f.title)}</div>
            <div style="color:${TEXT_SECONDARY};font-size:12px;">${escapeHtml(f.desc)}</div>
          </div>
        </div>
      `)).join('')}
    </div>

    ${sectionTitle('更新履歴')}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
      ${changeLog.map(c => card(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;">
            <div style="color:${GOLD};font-size:14px;font-weight:bold;">v${escapeHtml(c.version)}</div>
            <div style="color:${TEXT_SECONDARY};font-size:12px;margin-top:4px;">${escapeHtml(c.changes)}</div>
          </div>
          <div style="color:${TEXT_MUTED};font-size:11px;flex-shrink:0;margin-left:8px;">${escapeHtml(c.date)}</div>
        </div>
      `)).join('')}
    </div>

    <div style="padding:12px 0;">
      <div style="text-align:center;color:${TEXT_MUTED};font-size:11px;margin-bottom:12px;">v${CONFIG.APP_VERSION}</div>
      ${btn('ログアウト', 'btnLogout', 'danger')}
    </div>
  `;

  // アバター選択
  container.querySelectorAll('[data-avatar]').forEach(el => {
    el.addEventListener('click', () => {
      const avatar = el.dataset.avatar;
      localStorage.setItem('tkb_v2_avatar', avatar);
      container.querySelector('#myAvatar').textContent = avatar;
      // 選択状態を更新
      container.querySelectorAll('[data-avatar]').forEach(b => {
        b.style.background = b.dataset.avatar === avatar ? GOLD + '33' : '#222';
        b.style.border = b.dataset.avatar === avatar ? `2px solid ${GOLD}` : `1px solid ${BORDER}`;
      });
      showToast('アバターを変更しました');
    });
  });

  // 背景写真
  container.querySelector('#btnBgPhoto').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 200);
      localStorage.setItem('tkb_v2_bg', resized);
      const avatarEl = container.querySelector('#myAvatar');
      avatarEl.style.backgroundImage = `url(${resized})`;
      avatarEl.style.backgroundSize = 'cover';
      showToast('背景を変更しました');
    } catch (e) {
      console.error('Background change error:', e);
      showToast('画像の設定に失敗しました');
    }
  });

  container.querySelector('#btnBgReset').addEventListener('click', () => {
    localStorage.removeItem('tkb_v2_bg');
    const avatarEl = container.querySelector('#myAvatar');
    avatarEl.style.backgroundImage = '';
    avatarEl.style.background = GOLD + '22';
    showToast('背景をリセットしました');
  });

  // テーマ切り替え
  container.querySelectorAll('input[name="theme"]').forEach(el => {
    el.addEventListener('change', () => {
      localStorage.setItem('tkb_v2_theme', el.value);
      showToast(`テーマを${el.value === 'dark' ? 'ダーク' : 'ライト'}に変更しました`);
    });
  });

  // ログアウト
  container.querySelector('#btnLogout').addEventListener('click', () => {
    logout();
    showToast('ログアウトしました');
    navigate('login');
  });
}
