/**
 * テイクバック流通 v2 - メインエントリポイント
 * モジュール構成:
 *   入荷(intake) / 販売(sales) / 取引(trade) / 業務(ops)
 */
import { CONFIG } from './core/config.js';
import { initDB, getDB, subscribe, getStatusCounts, getTodayStats, getItems, cleanStaleLocks, getStaleItems } from './core/db.js';
import { getCurrentStaff, showLoginScreen } from './core/auth.js';
import { registerRoute, navigate } from './core/router.js';
import { showToast, showLoading, statusBadge, formatPrice, emptyState, escapeHtml } from './core/ui.js';
import { renderIntake } from './intake/index.js';
import { renderSales } from './sales/index.js';
import { renderTrade } from './trade/index.js';
import { renderOps } from './ops/index.js';

const app = document.getElementById('app');

// --- ルート登録 ---
registerRoute('home', renderHome);
registerRoute('intake', (p) => renderIntake(getContentEl(), p));
registerRoute('sales', (p) => renderSales(getContentEl(), p));
registerRoute('trade', (p) => renderTrade(getContentEl(), p));
registerRoute('ops', (p) => renderOps(getContentEl(), p));
registerRoute('item', renderItemPage);

function getContentEl() {
  return document.getElementById('mainContent') || app;
}

// --- アプリ起動 ---
async function boot() {
  const staff = getCurrentStaff();
  if (!staff) {
    showLoginScreen(app, (s) => {
      boot(); // 再起動
    });
    return;
  }

  // DB初期化
  if (!initDB()) {
    app.innerHTML = `<div style="padding:40px;text-align:center;color:#CE2029;">
      <p>データベースに接続できません</p>
      <p style="font-size:12px;color:#5a6272;margin-top:8px;">ページを再読み込みしてください</p>
    </div>`;
    return;
  }

  // テーマ適用
  const savedTheme = localStorage.getItem('tkb_theme');
  if (savedTheme === 'pink') {
    document.documentElement.setAttribute('data-theme', 'pink');
  }

  // 古いロック解除
  await cleanStaleLocks();

  // メインUI描画
  renderShell();
  navigate('home');

  // ディープリンク対応 (#item/管理番号)
  const hash = window.location.hash;
  if (hash.startsWith('#item/')) {
    const mgmtNum = hash.replace('#item/', '');
    navigate('item', { mgmtNum });
  } else if (hash && hash !== '#home') {
    const route = hash.replace('#', '');
    if (route && route !== 'home') navigate(route);
  }

  // リアルタイム更新
  subscribe((table, payload) => {
    if (table === 'items') {
      updateNavBadges();
    }
  });
}

// --- シェル（ヘッダー + ボトムナビ + コンテンツ領域） ---
function renderShell() {
  const staff = getCurrentStaff();
  app.innerHTML = `
    <div class="header">
      <div>
        <div class="header-title">テイクバック流通</div>
        <div class="header-subtitle">${escapeHtml(staff.name)} | v${CONFIG.APP_VERSION}</div>
      </div>
      <button class="header-action" id="headerMypage">👤</button>
    </div>
    <div class="main-content" id="mainContent"></div>
    <nav class="bottom-nav">
      <button class="nav-item active" data-route="home">
        <span class="nav-icon">🏠</span>
        <span>ホーム</span>
      </button>
      <button class="nav-item" data-route="intake">
        <span class="nav-icon" style="position:relative;">📷<span class="nav-badge" id="badgeIntake" style="display:none;"></span></span>
        <span>分荷判定</span>
      </button>
      <button class="nav-item" data-route="sales">
        <span class="nav-icon" style="position:relative;">🏷️<span class="nav-badge" id="badgeSales" style="display:none;"></span></span>
        <span>出品</span>
      </button>
      <button class="nav-item" data-route="trade">
        <span class="nav-icon" style="position:relative;">📦<span class="nav-badge" id="badgeTrade" style="display:none;"></span></span>
        <span>取引ナビ</span>
      </button>
      <button class="nav-item" data-route="ops">
        <span class="nav-icon">⚙️</span>
        <span>業務</span>
      </button>
    </nav>
  `;

  // ナビクリック
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  // マイページ
  document.getElementById('headerMypage')?.addEventListener('click', () => {
    navigate('ops', { tab: 'mypage' });
  });

  updateNavBadges();
}

// --- ナビバッジ更新 ---
async function updateNavBadges() {
  const counts = await getStatusCounts();

  const intakeCount = (counts['分荷確定'] || 0) + (counts['撮影待ち'] || 0);
  const salesCount = (counts['出品待ち'] || 0);
  const tradeCount = (counts['落札済み'] || 0) + (counts['梱包待ち'] || 0) + (counts['梱包完了'] || 0) + (counts['入金確認済み'] || 0);

  setBadge('badgeIntake', intakeCount);
  setBadge('badgeSales', salesCount);
  setBadge('badgeTrade', tradeCount);
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : count;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

// --- ホーム画面 ---
async function renderHome() {
  const content = getContentEl();
  showLoading(content, 'データを読み込み中...');

  const [counts, todayStats, staleItems] = await Promise.all([
    getStatusCounts(),
    getTodayStats(),
    getStaleItems(),
  ]);

  const staff = getCurrentStaff();
  const today = new Date();
  const dayOfWeek = today.getDay();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const duty = CONFIG.DUTY_FIXED || {};

  // ボトルネック検出
  const bottlenecks = [];
  if ((counts['出品待ち'] || 0) > 100) bottlenecks.push({ msg: `出品待ち ${counts['出品待ち']}件 — 在庫が滞留中`, level: 'danger' });
  if ((counts['梱包待ち'] || 0) > 10) bottlenecks.push({ msg: `梱包待ち ${counts['梱包待ち']}件`, level: 'warning' });
  if ((counts['確認/相談'] || 0) > 5) bottlenecks.push({ msg: `確認/相談 ${counts['確認/相談']}件 — 浅野さんの判断待ち`, level: 'warning' });

  content.innerHTML = `
    <div class="fade-in">
      <!-- 挨拶 -->
      <div style="padding:20px 16px 8px;">
        <div style="font-size:20px;font-weight:700;">おはようございます、${escapeHtml(staff.name.split(/[　 ]/)[0])}さん</div>
        <div style="color:var(--text-secondary);font-size:13px;">${today.getMonth()+1}月${today.getDate()}日（${dayNames[dayOfWeek]}）</div>
      </div>

      <!-- ボトルネック警告 -->
      ${bottlenecks.length > 0 ? `
        <div style="padding:0 16px;">
          ${bottlenecks.map(b => `
            <div style="background:${b.level === 'danger' ? '#fde8e8' : '#fef6e0'};border-left:3px solid ${b.level === 'danger' ? 'var(--danger)' : 'var(--warning)'};padding:10px 12px;margin:4px 0;border-radius:0 8px 8px 0;font-size:13px;color:${b.level === 'danger' ? '#CE2029' : '#8a6d20'};">
              ${b.level === 'danger' ? '🚨' : '⚠️'} ${b.msg}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- 滞留アラート -->
      ${staleItems.length > 0 ? `
        <div class="section-title" style="color:var(--danger);">滞留アラート（${staleItems.length}件）</div>
        <div style="padding:0 16px;">
          ${staleItems.slice(0, 5).map(item => `
            <div class="stale-card" data-mgmt="${escapeHtml(item.mgmt_num)}" style="background:#ffffff;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;border:1px solid #dde0e6;box-shadow:0 1px 4px rgba(28,37,65,0.06);cursor:pointer;">
              <div>
                <span style="color:#C5A258;font-size:12px;">${item.mgmt_num}</span>
                <div style="font-size:13px;color:#1C2541;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${item.product_name}</div>
              </div>
              <div style="text-align:right;">
                <div style="color:#CE2029;font-size:16px;font-weight:bold;">${item.staleDays}日</div>
                <div style="font-size:10px;color:#5a6272;">${item.status}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- 今日のチーム実績 -->
      <div class="section-title">今日のチーム実績</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num" style="color:var(--info);">${todayStats.judged}</div>
          <div class="stat-label">分荷判定</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, todayStats.judged / CONFIG.DAILY_KPI.bunka * 100)}%;background:var(--info);"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--gold);">${todayStats.listed}</div>
          <div class="stat-label">出品</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, todayStats.listed / CONFIG.DAILY_KPI.shuppin * 100)}%;background:var(--gold);"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--success);">${todayStats.packed}</div>
          <div class="stat-label">梱包</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, todayStats.packed / CONFIG.DAILY_KPI.konpo * 100)}%;background:var(--success);"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--purple);">${todayStats.shipped}</div>
          <div class="stat-label">出荷</div>
        </div>
      </div>

      <!-- 在庫ステータス -->
      <div class="section-title">在庫ステータス（${counts._total || 0}件）</div>
      <div class="stats-grid">
        <div class="stat-card" onclick="window.__nav('intake')">
          <div class="stat-num" style="color:var(--info);">${(counts['分荷確定'] || 0) + (counts['撮影待ち'] || 0)}</div>
          <div class="stat-label">撮影待ち</div>
        </div>
        <div class="stat-card" onclick="window.__nav('sales')">
          <div class="stat-num" style="color:var(--warning);">${counts['出品待ち'] || 0}</div>
          <div class="stat-label">出品待ち</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--success);">${counts['出品中'] || 0}</div>
          <div class="stat-label">出品中</div>
        </div>
        <div class="stat-card" onclick="window.__nav('trade')">
          <div class="stat-num" style="color:var(--purple);">${(counts['落札済み'] || 0) + (counts['入金待ち'] || 0) + (counts['入金確認済み'] || 0)}</div>
          <div class="stat-label">取引中</div>
        </div>
      </div>

      <!-- 今日の当番 -->
      ${(() => {
        const dutyEntries = Object.entries(duty).filter(([,p]) => p);
        // 掃除ローテーション（日付ベースで決定）
        const cleaningPool = CONFIG.CLEANING_ROTATION || [];
        const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
        const toiletPerson = cleaningPool.length > 0 ? cleaningPool[dayOfYear % cleaningPool.length] : '';
        const breakRoomPerson = cleaningPool.length > 1 ? cleaningPool[(dayOfYear + 1) % cleaningPool.length] : '';
        return dutyEntries.length > 0 || toiletPerson ? `
          <div class="section-title">今日の当番</div>
          <div class="card">
            ${dutyEntries.map(([task, person]) => {
              const names = Array.isArray(person) ? person.join(', ') : person;
              return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--text-secondary);">${task}</span><span>${names}</span></div>`;
            }).join('')}
            ${toiletPerson ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-top:1px solid #f0ede6;margin-top:4px;padding-top:8px;"><span style="color:var(--text-secondary);">🧹 トイレ掃除</span><span>${toiletPerson}</span></div>` : ''}
            ${breakRoomPerson ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--text-secondary);">🧹 休憩場所掃除</span><span>${breakRoomPerson}</span></div>` : ''}
          </div>
        ` : '';
      })()}

      <!-- 確認/相談 待ちリスト（管理者のみ・折り畳み） -->
      ${staff.role === 'admin' && (counts['確認/相談'] || 0) > 0 ? `
        <div class="section-title" style="color:var(--danger);cursor:pointer;" id="consultToggle">
          確認/相談 待ち（${counts['確認/相談']}件）<span id="consultArrow" style="font-size:12px;margin-left:4px;">▶</span>
        </div>
        <div id="consultList" style="padding:0 16px;display:none;">読み込み中...</div>
      ` : ''}

      <!-- 今日の出勤メンバー -->
      <div class="section-title">今日の出勤メンバー</div>
      <div id="todayAttendance" class="card" style="padding:12px 16px;">
        <div style="color:var(--text-secondary);font-size:13px;">読み込み中...</div>
      </div>

      <div style="height:40px;"></div>
    </div>
  `;

  // グローバルナビ関数
  window.__nav = (route, params) => navigate(route, params || {});

  // 相談待ちリスト（管理者・折り畳み）
  if (staff.role === 'admin' && (counts['確認/相談'] || 0) > 0) {
    let consultLoaded = false;
    const toggleEl = document.getElementById('consultToggle');
    const listEl = document.getElementById('consultList');
    const arrowEl = document.getElementById('consultArrow');
    if (toggleEl && listEl) {
      toggleEl.addEventListener('click', async () => {
        const isOpen = listEl.style.display !== 'none';
        listEl.style.display = isOpen ? 'none' : 'block';
        arrowEl.textContent = isOpen ? '▶' : '▼';
        if (!consultLoaded) {
          consultLoaded = true;
          const consultItems = await getItems({ status: ['確認/相談', '確認／相談', '確認/打合せ'] });
          listEl.innerHTML = consultItems.map(item => `
            <div class="consult-card" data-mgmt="${escapeHtml(item.mgmt_num)}" style="margin:4px 0;cursor:pointer;background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #dde0e6;">
              <div style="display:flex;justify-content:space-between;">
                <div>
                  <div style="font-weight:700;font-size:14px;">${escapeHtml(item.product_name)}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">${item.mgmt_num} | ${escapeHtml(item.channel_name || item.channel || '')} | ${formatPrice(item.estimated_price_max)}</div>
                </div>
                ${statusBadge(item.status)}
              </div>
            </div>
          `).join('') || '<p style="color:#5a6272;font-size:13px;">なし</p>';
          // 相談カードのタップイベント
          listEl.querySelectorAll('.consult-card').forEach(card => {
            card.addEventListener('click', () => {
              const mgmt = card.dataset.mgmt;
              const statusModule = CONFIG.STATUS_MODULE[card.querySelector('[data-status]')?.dataset.status] || 'sales';
              navigate('sales', { mgmtNum: mgmt });
            });
          });
        }
      });
    }
  }

  // 今日の出勤メンバー（デフォルト予定+実際の出退勤+休み連絡）
  const attendanceEl = document.getElementById('todayAttendance');
  if (attendanceEl) {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const dow = today.getDay();

      // DB出退勤データ取得
      const dbClient = getDB();
      const { data: dbAttendance } = dbClient
        ? await dbClient.from('attendance').select('staff_name, clock_in, clock_out, note').eq('work_date', todayStr).order('clock_in')
        : { data: [] };
      const attendMap = {};
      (dbAttendance || []).forEach(a => { attendMap[a.staff_name] = a; });

      // スタッフごとに表示
      const members = [];
      (CONFIG.STAFF || []).forEach(s => {
        if (s.showTimeline === false) return;
        if (dow === 0 || dow === 6) return; // 土日
        const isOff = s.offDays && s.offDays.includes(dow);
        const dbRecord = attendMap[s.name];

        // 休み連絡チェック（noteに「欠勤」「休み」が含まれる場合）
        const isAbsent = dbRecord?.note && /欠勤|休み|お休み/.test(dbRecord.note);

        if (isOff && !dbRecord) return; // 定休日で出勤記録もなければ非表示

        const clockIn = dbRecord?.clock_in ? new Date(dbRecord.clock_in).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : null;
        const clockOut = dbRecord?.clock_out ? new Date(dbRecord.clock_out).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : null;

        let timeText = '';
        let statusText = '';
        let statusColor = '#5a6272';

        if (isAbsent || isOff) {
          timeText = isOff ? '定休日' : '欠勤';
          statusText = '休み';
          statusColor = '#8a8a8a';
        } else if (clockIn) {
          timeText = clockIn + (clockOut ? ' - ' + clockOut : '');
          statusText = clockOut ? '退勤済' : '出勤中';
          statusColor = clockOut ? '#8a8a8a' : '#006B3F';
        } else {
          // 予定時間
          timeText = `${s.start || '?'} - ${s.end || '?'}`;
          statusText = '予定';
          statusColor = '#C5A258';
        }

        members.push({ name: s.name, timeText, statusText, statusColor });
      });

      if (members.length > 0) {
        attendanceEl.innerHTML = members.map(m => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;border-bottom:1px solid #f0ede6;">
            <span>${escapeHtml(m.name.split(/[　 ]/)[0])}</span>
            <span style="color:${m.statusColor};">${m.timeText} <span style="font-size:11px;opacity:0.8;">${m.statusText}</span></span>
          </div>
        `).join('');
      } else {
        attendanceEl.innerHTML = '<div style="color:#8a8a8a;font-size:13px;">今日は休業日です</div>';
      }
    } catch (e) {
      console.error('出勤メンバー表示エラー:', e);
      attendanceEl.innerHTML = '<div style="color:#8a8a8a;font-size:13px;">取得できませんでした</div>';
    }
  }

  // 滞留アラートのタップイベント
  content.querySelectorAll('.stale-card').forEach(card => {
    card.addEventListener('click', () => {
      const mgmt = card.dataset.mgmt;
      navigate('sales', { mgmtNum: mgmt });
    });
  });
}

// --- 商品ディープリンク (#item/管理番号) ---
async function renderItemPage(params) {
  const content = getContentEl();
  const mgmtNum = params.mgmtNum || '';
  if (!mgmtNum) { navigate('home'); return; }

  showLoading(content, '商品情報を読み込み中...');
  const item = await getItems({ search: mgmtNum, limit: 1 });

  if (!item || item.length === 0) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#5a6272;">
      <p>商品 ${escapeHtml(mgmtNum)} が見つかりません</p>
      <button onclick="window.__nav('home')" class="btn btn-secondary" style="margin-top:16px;">ホームに戻る</button>
    </div>`;
    return;
  }

  const found = item[0];
  const statusModule = CONFIG.STATUS_MODULE[found.status] || 'sales';

  switch(statusModule) {
    case 'intake': navigate('intake', { mgmtNum: found.mgmt_num }); break;
    case 'sales': navigate('sales', { mgmtNum: found.mgmt_num }); break;
    case 'trade': navigate('trade', { mgmtNum: found.mgmt_num }); break;
    default: navigate('sales', { mgmtNum: found.mgmt_num });
  }
}

// --- 起動 ---
boot();
