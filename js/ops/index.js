/**
 * テイクバック流通 v2 - 業務モジュール
 * 経費精算 / 勤怠管理 / チャット / KPI / マイページ
 */
import { CONFIG } from '../core/config.js';
import * as db from '../core/db.js';
import { getCurrentStaff, isAdmin, logout } from '../core/auth.js';
import { showToast, showLoading, capturePhoto, fileToBase64, resizeImage, escapeHtml, formatPrice, formatDate, formatDateTime, emptyState } from '../core/ui.js';
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
    { id: 'kpi', label: '📊 KPI' },
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
    case 'kpi': renderKPI(content, params, staff); break;
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

    ${label('インボイス番号（T+13桁）')}
    ${inputField('expInvoice', 'text', 'T0000000000000')}

    ${label('備考')}
    <textarea id="expMemo" rows="2" placeholder="メモ" style="width:100%;padding:10px 12px;border-radius:8px;background:#111;color:${TEXT_PRIMARY};border:1px solid ${BORDER};font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>

    <div style="margin-top:20px;">
      ${btn('登録する', 'btnSaveExpense')}
    </div>
  `);

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
        body: JSON.stringify({ image: resized }),
      });

      if (!resp.ok) throw new Error(`OCR失敗: ${resp.status}`);

      const result = await resp.json();
      applyOcrResult(container, result);
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
          <div style="flex:1;min-width:0;">
            <div style="color:${TEXT_PRIMARY};font-size:14px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.store_name || '')}</div>
            <div style="color:${TEXT_SECONDARY};font-size:12px;margin-top:2px;">${escapeHtml(e.category || '')} ・ ${escapeHtml(e.payment_method || '')}</div>
            <div style="color:${TEXT_MUTED};font-size:11px;margin-top:2px;">
              ${formatDate(e.expense_date)} ・ ${escapeHtml(e.staff_name || '')}
              ${e.invoice_number ? ` ・ ${escapeHtml(e.invoice_number)}` : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px;">
            <div style="color:${GOLD};font-size:16px;font-weight:bold;">${formatPrice(e.amount)}</div>
            <div style="color:${TEXT_MUTED};font-size:11px;">(税${formatPrice(e.tax_amount)})</div>
          </div>
        </div>
      `)).join('')}
    </div>
  `;

  container.querySelector('#expListMonth').addEventListener('change', (e) => {
    renderExpenseList(container, e.target.value, department, staff);
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

    <div style="margin-top:16px;color:${TEXT_MUTED};font-size:12px;text-align:center;">
      ${expenses.length}件の経費 ・ ${escapeHtml(department)}
    </div>
  `;

  container.querySelector('#summaryMonth').addEventListener('change', (e) => {
    renderExpenseSummary(container, e.target.value, department, staff);
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

        return `<div style="padding:4px 2px;border-radius:8px;background:${bgColor};${isToday ? `border:1px solid ${GOLD};` : ''}min-height:44px;">
          <div style="color:${cellColor};font-size:13px;font-weight:${isToday ? 'bold' : 'normal'};">${day}</div>
          ${hours}${synced}
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
          message,
          context: {
            staffName: staff.name,
            department: staff.company || 'テイクバック',
          },
        }),
      });

      loadingEl.remove();

      if (!resp.ok) throw new Error(`AI応答失敗: ${resp.status}`);

      const data = await resp.json();
      const reply = data.reply || '応答を取得できませんでした。';

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
// マイページ
// ============================================================
function renderMyPage(container, params, staff) {
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
