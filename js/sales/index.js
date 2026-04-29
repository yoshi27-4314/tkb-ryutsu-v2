/**
 * テイクバック流通 v2 - 販売モジュール
 * 出品作業・価格管理・チャンネル変更・再出品
 */
import { CONFIG } from '../core/config.js';
import * as db from '../core/db.js';
import { getCurrentStaff } from '../core/auth.js';
import { showToast, showLoading, showConfirm, capturePhoto, fileToBase64, resizeImage, escapeHtml, statusBadge, formatPrice, formatDuration, emptyState } from '../core/ui.js';
import { navigate, registerBeforeLeave } from '../core/router.js';

// salesモジュールから離脱時のクリーンアップ登録
registerBeforeLeave('sales', () => { cleanupWorkingItem(); });

// ============================================================
//  内部状態
// ============================================================
let currentTab = 'list_wait';   // list_wait | listing | all
let searchQuery = '';
let itemsCache = [];
let timerInterval = null;
let timerStart = null;
let timerElapsed = 0;           // 秒
let workingItem = null;         // 出品作業中の商品
let generatedTitle = '';
let generatedDesc = '';
let unsubscribe = null;         // リアルタイム購読解除
let sessionPhotos = [];         // セッション中に追加した写真（base64）

// タブ → ステータスフィルタ
const TAB_FILTERS = {
  list_wait: [CONFIG.STATUS.LIST_WAIT, CONFIG.STATUS.JUDGED, CONFIG.STATUS.PHOTO_WAIT],
  listing:   [CONFIG.STATUS.LISTING_WORK, CONFIG.STATUS.LISTING],
  all:       null,
};

// タイトル禁止文字（ヤフオク基準）
const FORBIDDEN_CHARS = /[<>{}|\\^~`\[\]]/g;
const TITLE_MAX_LEN = 65;

// ============================================================
//  メインエントリ
// ============================================================
export function renderSales(container, params = {}) {
  // 前回の作業中アイテムのクリーンアップ（他画面から戻ってきた場合）
  cleanupWorkingItem();

  // リアルタイム購読
  if (unsubscribe) unsubscribe();
  unsubscribe = db.subscribe((table) => {
    if (table === 'items' && !workingItem) {
      if (currentTab !== '_flow') loadItems(container);
    }
  });

  // 古いロック掃除 + 出品作業中で放置された商品を出品待ちに戻す
  db.cleanStaleLocks();
  cleanStaleListingWork();

  // パラメータで作業画面を直接開く場合
  if (params.mgmtNum) {
    openListingWork(container, params.mgmtNum);
    return;
  }

  // パラメータで一覧を明示的に要求した場合
  if (params.showList) {
    renderListView(container);
    return;
  }

  // デフォルト: 一覧表示（フローモードはボタンから開始）
  renderListView(container);
}

// ============================================================
//  フローモード: 次の出品待ち商品を自動で開く
// ============================================================
async function openNextItem(container) {
  currentTab = '_flow';
  showLoading(container, '次の商品を探しています...');

  const filters = {
    status: [CONFIG.STATUS.LIST_WAIT, CONFIG.STATUS.JUDGED, CONFIG.STATUS.PHOTO_WAIT],
    orderBy: 'priority_score',
    ascending: false,
    limit: 1,
  };
  const items = await db.getItems(filters);

  if (items.length === 0) {
    // 出品待ちがない → 一覧表示に切り替え
    container.innerHTML = `
      <div style="padding:40px 20px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">✅</div>
        <h2 style="color:#C5A258;font-size:18px;margin-bottom:8px;">出品待ちなし</h2>
        <p style="color:#5a6272;font-size:13px;margin-bottom:20px;">出品待ちの商品はありません</p>
        <button id="flowToList" style="padding:12px 24px;border-radius:10px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:14px;cursor:pointer;">
          出品中の一覧を見る
        </button>
      </div>
    `;
    container.querySelector('#flowToList')?.addEventListener('click', () => {
      currentTab = 'listing';
      renderListView(container);
    });
    return;
  }

  const item = items[0];

  // 写真チェック: 写真がなければ撮影を促す
  if (!item.photo_urls || item.photo_urls.length === 0) {
    renderPhotoRequired(container, item);
    return;
  }

  openListingWork(container, item.mgmt_num);
}

// 写真なし → 撮影誘導画面
function renderPhotoRequired(container, item) {
  container.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="photoReqBack" style="background:none;border:none;color:#C5A258;font-size:14px;cursor:pointer;">← 一覧</button>
      </div>
      <div style="text-align:center;padding:20px;">
        <div style="font-size:48px;margin-bottom:12px;">📷</div>
        <h2 style="color:#C5A258;font-size:18px;margin-bottom:8px;">写真が必要です</h2>
        <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:16px;border:1px solid #dde0e6;text-align:left;">
          <span style="font-size:13px;color:#C5A258;font-weight:bold;">${escapeHtml(item.mgmt_num)}</span>
          <div style="font-size:15px;color:#1C2541;font-weight:bold;margin-top:4px;">${escapeHtml(item.product_name || '')}</div>
          <div style="font-size:12px;color:#5a6272;margin-top:2px;">${escapeHtml(item.maker || '')} ${escapeHtml(item.model_number || '')}</div>
        </div>
        <p style="color:#5a6272;font-size:13px;margin-bottom:20px;">出品するには商品写真が必要です。<br>先に写真を撮影してください。</p>
        <button id="photoReqShoot" style="width:100%;padding:16px;border-radius:12px;border:none;background:#C5A258;color:#000;font-size:16px;font-weight:bold;cursor:pointer;margin-bottom:10px;">
          📷 写真を撮影する
        </button>
        <button id="photoReqSkip" style="width:100%;padding:12px;border-radius:12px;border:1px solid #dde0e6;background:transparent;color:#5a6272;font-size:13px;cursor:pointer;">
          スキップして次の商品へ
        </button>
      </div>
    </div>
  `;

  container.querySelector('#photoReqBack')?.addEventListener('click', () => {
    currentTab = 'list_wait';
    renderListView(container);
  });
  container.querySelector('#photoReqShoot')?.addEventListener('click', () => {
    navigate('intake', { step: 'photo', mgmtNum: item.mgmt_num });
  });
  container.querySelector('#photoReqSkip')?.addEventListener('click', () => {
    openNextItem(container);
  });
}

// ============================================================
//  一覧画面
// ============================================================
function renderListView(container) {
  workingItem = null;
  sessionPhotos = [];
  stopTimer();

  container.innerHTML = `
    <div style="padding:12px 16px 0;display:flex;align-items:center;gap:8px;">
      <button id="salesBackHome" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
      <h2 style="color:#C5A258;font-size:18px;margin:0;">出品管理</h2>
    </div>
    <div style="padding:12px 12px 0;">
      <!-- 検索バー -->
      <div style="position:relative;margin-bottom:12px;">
        <input id="salesSearch" type="search" placeholder="管理番号・商品名で検索"
          value="${escapeHtml(searchQuery)}"
          style="width:100%;box-sizing:border-box;padding:10px 12px 10px 36px;border-radius:10px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:14px;outline:none;"
        />
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#8a8a8a;font-size:16px;">🔍</span>
      </div>

      <!-- 流し作業ボタン -->
      <button id="startFlowBtn"
        style="width:100%;padding:14px;border-radius:12px;border:none;background:#C5A258;color:#000;font-size:15px;font-weight:bold;cursor:pointer;margin-bottom:12px;">
        ▶ 流し作業を開始
      </button>

      <!-- タブ -->
      <div id="salesTabs" style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;">
        ${renderTab('list_wait', '出品待ち')}
        ${renderTab('listing', '出品中')}
        ${renderTab('all', '全件')}
      </div>
    </div>

    <!-- 商品リスト -->
    <div id="salesList" style="padding:0 12px 100px;"></div>
  `;

  // ホームへ戻る
  container.querySelector('#salesBackHome')?.addEventListener('click', () => {
    navigate('home');
  });

  // 流し作業ボタン
  container.querySelector('#startFlowBtn')?.addEventListener('click', () => {
    openNextItem(container);
  });

  // イベント
  container.querySelector('#salesSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    loadItems(container);
  });

  container.querySelectorAll('.sales-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      container.querySelectorAll('.sales-tab').forEach(t => {
        t.style.background = t.dataset.tab === currentTab ? '#C5A258' : '#ffffff';
        t.style.color = t.dataset.tab === currentTab ? '#fff' : '#5a6272';
      });
      loadItems(container);
    });
  });

  loadItems(container);
}

function renderTab(key, label) {
  const active = key === currentTab;
  return `<button class="sales-tab" data-tab="${key}"
    style="padding:8px 16px;border-radius:20px;border:none;font-size:13px;font-weight:bold;white-space:nowrap;cursor:pointer;
    background:${active ? '#C5A258' : '#ffffff'};color:${active ? '#fff' : '#5a6272'};transition:all 0.2s;">
    ${label}
  </button>`;
}

// ============================================================
//  商品読み込み
// ============================================================
async function loadItems(container) {
  const listEl = container.querySelector('#salesList');
  if (!listEl) return;

  showLoading(listEl, '商品を読み込み中...');

  const filters = { search: searchQuery || undefined };
  const statuses = TAB_FILTERS[currentTab];
  if (statuses) filters.status = statuses;

  // 出品待ちタブはpriority_score降順、それ以外はupdated_at降順
  if (currentTab === 'list_wait') {
    filters.orderBy = 'priority_score';
    filters.ascending = false;
  } else {
    filters.orderBy = 'updated_at';
    filters.ascending = false;
  }

  filters.limit = 100;
  itemsCache = await db.getItems(filters);

  if (itemsCache.length === 0) {
    listEl.innerHTML = emptyState('📦', currentTab === 'list_wait' ? '出品待ちの商品はありません' : '該当する商品はありません');
    return;
  }

  listEl.innerHTML = itemsCache.map(item => renderItemCard(item)).join('');

  // カードタップイベント
  listEl.querySelectorAll('.sales-card').forEach(card => {
    card.addEventListener('click', () => {
      const mgmtNum = card.dataset.mgmt;
      if (!mgmtNum) return;
      const item = itemsCache.find(i => i.mgmt_num === mgmtNum);
      if (!item) return;

      if (item.status === CONFIG.STATUS.LIST_WAIT || item.status === CONFIG.STATUS.LISTING_WORK || item.status === CONFIG.STATUS.JUDGED || item.status === CONFIG.STATUS.PHOTO_WAIT) {
        openListingWork(container, mgmtNum);
      } else if (item.status === CONFIG.STATUS.LISTING) {
        openListingDetail(container, item);
      }
    });
  });
}

// ============================================================
//  商品カード
// ============================================================
function renderItemCard(item) {
  const channel = CONFIG.CHANNELS.find(c => c.name === item.channel_name);
  const channelLabel = channel ? `${channel.name}（${channel.platform || '—'}）` : (item.channel_name || '未設定');
  const priceRange = item.start_price || item.target_price
    ? `${formatPrice(item.start_price)} 〜 ${formatPrice(item.target_price)}`
    : '未設定';
  const lockedBadge = item.locked_by
    ? `<span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:10px;background:#f4433622;color:#CE2029;margin-left:4px;">🔒 ${escapeHtml(item.locked_by)}</span>`
    : '';
  const priorityBadge = item.priority_score != null
    ? `<span style="font-size:10px;color:#C5A258;margin-left:4px;">★${item.priority_score}</span>`
    : '';
  const markBadge = item.staff_mark
    ? `<span style="font-size:12px;color:#C5A258;margin-right:4px;">${escapeHtml(item.staff_mark)}</span>`
    : '';

  // 写真サムネイル（1枚目）
  const thumbUrl = item.photo_urls?.[0] || '';
  const thumbHtml = thumbUrl
    ? `<img src="${escapeHtml(thumbUrl)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;flex-shrink:0;">`
    : `<div style="width:56px;height:56px;border-radius:8px;background:#f0ede6;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;color:#ccc;">📷</div>`;

  // 分荷者メモ
  const judgedInfo = item.judged_by ? `${escapeHtml(item.judged_by)}` : '';
  const memoSnippet = item.listing_memo || item.memo || '';

  return `
    <div class="sales-card" data-mgmt="${escapeHtml(item.mgmt_num)}"
      style="background:#ffffff;border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;
      border:1px solid #dde0e6;transition:transform 0.15s;">
      <div style="display:flex;gap:10px;">
        ${thumbHtml}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;">
            <span style="font-size:12px;color:#C5A258;font-weight:bold;">${markBadge}${escapeHtml(item.mgmt_num)}</span>
            <div style="flex-shrink:0;">${statusBadge(item.status)}${lockedBadge}</div>
          </div>
          <div style="font-size:13px;color:#1C2541;font-weight:bold;margin-bottom:3px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(item.product_name || '（商品名なし）')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#5a6272;">
            <span>${escapeHtml(channelLabel)}</span>
            <span>${priceRange}${priorityBadge}</span>
          </div>
          ${memoSnippet ? `<div style="font-size:10px;color:#8a8a8a;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${judgedInfo ? judgedInfo + ': ' : ''}${escapeHtml(memoSnippet).slice(0, 40)}</div>` : (judgedInfo ? `<div style="font-size:10px;color:#8a8a8a;margin-top:2px;">分荷: ${judgedInfo}</div>` : '')}
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//  出品作業画面
// ============================================================
async function openListingWork(container, mgmtNum) {
  showLoading(container, '商品情報を読み込み中...');

  const staff = getCurrentStaff();
  if (!staff) {
    showToast('スタッフ情報が取得できません');
    renderListView(container);
    return;
  }

  // ロック取得
  const locked = await db.lockItem(mgmtNum, staff.name);
  if (!locked) {
    // 既にロック済みか確認
    const item = await db.getItem(mgmtNum);
    if (item?.locked_by === staff.name) {
      // 自分がロック済み→続行
    } else {
      showToast(`${item?.locked_by || '他のスタッフ'}が作業中です`);
      renderListView(container);
      return;
    }
  }

  // ステータスを出品作業中に更新（既に出品中以降のステータスなら変更しない）
  const currentItem = await db.getItem(mgmtNum);
  const listingIdx = CONFIG.STATUS_FLOW.indexOf(CONFIG.STATUS.LISTING);
  const currentIdx = CONFIG.STATUS_FLOW.indexOf(currentItem?.status);
  if (currentIdx < listingIdx) {
    await db.updateItemStatus(mgmtNum, CONFIG.STATUS.LISTING_WORK, staff.name);
  }

  const item = await db.getItem(mgmtNum);
  if (!item) {
    showToast('商品が見つかりません');
    renderListView(container);
    return;
  }

  workingItem = item;
  generatedTitle = item.listing_title || '';
  generatedDesc = item.listing_description || '';

  // スタッフマーク
  const staffMark = CONFIG.STAFF_MARKS[staff.name] || '';

  // チャンネル情報
  const channel = CONFIG.CHANNELS.find(c => c.name === item.channel_name);

  // 写真URL配列（Drive保存済みの場合）
  const photos = item.photo_urls || [];

  // タイマー開始
  startTimer();

  container.innerHTML = `
    <div style="padding:0 0 120px;">
      <!-- スティッキーヘッダー（管理番号常時表示） -->
      <div style="position:sticky;top:0;z-index:100;background:#F8F5EE;padding:8px 12px;border-bottom:1px solid #dde0e6;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="salesBackBtn" style="background:none;border:none;color:#C5A258;font-size:14px;cursor:pointer;padding:4px 0;">←</button>
            <span style="font-size:16px;color:#C5A258;font-weight:bold;">${escapeHtml(item.mgmt_num)}</span>
            ${statusBadge(item.status)}
          </div>
          <div id="salesTimer" style="font-size:16px;color:#C5A258;font-weight:bold;font-variant-numeric:tabular-nums;">
            00:00
          </div>
        </div>
        <div style="font-size:12px;color:#5a6272;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:28px;">
          ${escapeHtml(item.product_name || '')} | ${escapeHtml(item.maker || '')}
        </div>
      </div>

      <div style="padding:12px 12px 0;">
      <!-- 商品情報（編集可能） -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #dde0e6;">
        ${item.partner_item_number ? `<div style="font-size:12px;color:#C5A258;font-weight:bold;margin-bottom:4px;">委託番号: ${escapeHtml(item.partner_item_number)}</div>` : ''}
        <div style="font-size:12px;color:#5a6272;margin-bottom:6px;">
          ${escapeHtml(channel?.name || item.channel_name || '未設定')} | 状態: ${escapeHtml(item.condition_rank || '—')}
          | サイズ: ${escapeHtml(item.product_size || item.shipping_size ? item.shipping_size + 'サイズ' : '—')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
          <div>
            <label style="font-size:10px;color:#8a8a8a;">商品名</label>
            <input id="editProductName" type="text" value="${escapeHtml(item.product_name || '')}"
              style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:12px;outline:none;">
          </div>
          <div>
            <label style="font-size:10px;color:#8a8a8a;">型番</label>
            <input id="editModelNumber" type="text" value="${escapeHtml(item.model_number || '')}"
              style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:12px;outline:none;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px;">
          <div>
            <label style="font-size:10px;color:#8a8a8a;">発送サイズ</label>
            <select id="editShippingSize"
              style="width:100%;box-sizing:border-box;padding:6px 4px;border-radius:6px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:12px;outline:none;">
              <option value="">未設定</option>
              ${[60,80,100,140,160,170,180,200,220,240,260].map(s => `<option value="${s}" ${item.shipping_size == s ? 'selected' : ''}>${s}サイズ</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:#8a8a8a;">状態ランク</label>
            <select id="editConditionRank"
              style="width:100%;box-sizing:border-box;padding:6px 4px;border-radius:6px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:12px;outline:none;">
              <option value="">未設定</option>
              ${Object.entries(CONFIG.CONDITIONS).map(([k,v]) => `<option value="${k}" ${item.condition_rank === k ? 'selected' : ''}>${k}: ${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:#8a8a8a;">市場需要</label>
            <select id="editMarketDemand"
              style="width:100%;box-sizing:border-box;padding:6px 4px;border-radius:6px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:12px;outline:none;">
              <option value="1" ${item.market_demand == 1 ? 'selected' : ''}>1:買い手有利</option>
              <option value="2" ${item.market_demand == 2 || !item.market_demand ? 'selected' : ''}>2:拮抗</option>
              <option value="3" ${item.market_demand == 3 ? 'selected' : ''}>3:売り手有利</option>
            </select>
          </div>
        </div>
        ${item.listing_memo ? `<div style="font-size:11px;color:#C5A258;margin-top:4px;">📝 ${escapeHtml(item.listing_memo)}</div>` : ''}
        ${item.memo ? `<div style="font-size:11px;color:#8a8a8a;margin-top:4px;line-height:1.4;">${escapeHtml(item.memo).slice(0, 100)}</div>` : ''}
      </div>

      <!-- 写真管理 -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h3 style="color:#1C2541;font-size:13px;margin:0;">📷 商品写真</h3>
          <div style="display:flex;gap:6px;">
            ${item.drive_url ? `<a href="${escapeHtml(item.drive_url)}" target="_blank" rel="noopener" style="padding:4px 10px;border-radius:6px;border:1px solid #dde0e6;background:transparent;color:#5a6272;font-size:11px;text-decoration:none;">Driveフォルダ</a>` : ''}
            <button id="addPhotoBtn" style="padding:4px 10px;border-radius:6px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:11px;cursor:pointer;">+ 写真追加</button>
          </div>
        </div>
        <div id="photoGallery" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;flex-wrap:wrap;">
          ${photos.length > 0
            ? photos.map((url, i) => `
              <div style="position:relative;flex-shrink:0;" data-photo-idx="${i}" data-photo-type="existing">
                <img src="${escapeHtml(url)}" alt="写真${i + 1}"
                  style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;" />
                <div style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.6);color:#5a6272;font-size:9px;padding:1px 4px;border-radius:4px;">${i + 1}</div>
              </div>
            `).join('')
            : ''
          }
        </div>
        <div id="sessionPhotoGallery" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;flex-wrap:wrap;margin-top:4px;"></div>
        ${photos.length === 0 && sessionPhotos.length === 0 ? '<div id="noPhotoMsg" style="padding:10px;color:#8a8a8a;font-size:13px;text-align:center;">写真がありません。「+ 写真追加」で撮影してください</div>' : ''}
      </div>

      <!-- AI生成タイトル -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h3 style="color:#1C2541;font-size:13px;margin:0;">📝 出品タイトル</h3>
          <div style="display:flex;gap:6px;">
            <button id="aiTitleBtn" style="padding:4px 10px;border-radius:6px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:11px;cursor:pointer;">
              AI生成
            </button>
            <button id="copyTitleBtn" style="padding:4px 10px;border-radius:6px;border:none;background:#dde0e6;color:#4a4a5a;font-size:11px;cursor:pointer;">
              コピー
            </button>
          </div>
        </div>
        <div style="position:relative;">
          <div style="font-size:11px;color:#5a6272;margin-bottom:4px;">
            スタッフマーク: <span style="color:#C5A258;font-weight:bold;">${staffMark}</span>　自動付与
          </div>
          <input id="listingTitle" type="text" maxlength="${TITLE_MAX_LEN}"
            value="${escapeHtml(generatedTitle)}"
            placeholder="出品タイトルを入力（最大${TITLE_MAX_LEN}文字）"
            style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:14px;outline:none;" />
          <div id="titleCounter" style="text-align:right;font-size:11px;color:#8a8a8a;margin-top:2px;">
            ${generatedTitle.length}/${TITLE_MAX_LEN}
          </div>
          <div id="titleError" style="font-size:11px;color:#CE2029;margin-top:2px;display:none;"></div>
        </div>
      </div>

      <!-- AI生成説明文 -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h3 style="color:#1C2541;font-size:13px;margin:0;">📄 出品説明文</h3>
          <div style="display:flex;gap:6px;">
            <button id="aiDescBtn" style="padding:4px 10px;border-radius:6px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:11px;cursor:pointer;">
              AI生成
            </button>
            <button id="copyDescBtn" style="padding:4px 10px;border-radius:6px;border:none;background:#dde0e6;color:#4a4a5a;font-size:11px;cursor:pointer;">
              コピー
            </button>
          </div>
        </div>
        <textarea id="listingDesc" rows="6"
          placeholder="出品説明文を入力"
          style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:13px;outline:none;resize:vertical;line-height:1.6;"
        >${escapeHtml(generatedDesc)}</textarea>
      </div>

      <!-- 価格 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:16px;border:1px solid #dde0e6;">
        <h3 style="color:#1C2541;font-size:13px;margin:0 0 10px;">💰 価格設定</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:11px;color:#5a6272;display:block;margin-bottom:4px;">開始価格</label>
            <input id="startPrice" type="number" inputmode="numeric"
              value="${item.start_price || ''}"
              placeholder="¥0"
              style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:15px;font-weight:bold;outline:none;" />
          </div>
          <div>
            <label style="font-size:11px;color:#5a6272;display:block;margin-bottom:4px;">目標価格</label>
            <input id="targetPrice" type="number" inputmode="numeric"
              value="${item.target_price || ''}"
              placeholder="¥0"
              style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:15px;font-weight:bold;outline:none;" />
          </div>
        </div>
        ${item.min_listing_price ? `
          <div style="margin-top:8px;font-size:11px;color:#5a6272;">
            最低出品価格: <span style="color:#C5A258;font-weight:bold;">${formatPrice(item.min_listing_price)}</span>
          </div>
        ` : ''}
      </div>

      <!-- チャンネル変更 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:16px;border:1px solid #dde0e6;">
        <h3 style="color:#1C2541;font-size:13px;margin:0 0 10px;">📢 販売チャンネル</h3>
        <select id="channelSelect"
          style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:14px;outline:none;">
          ${CONFIG.CHANNELS.filter(c => c.type === 'tsuhan').map(c => `
            <option value="${escapeHtml(c.name)}" ${c.name === item.channel_name ? 'selected' : ''}>
              ${escapeHtml(c.name)}（${escapeHtml(c.platform || '—')}）
            </option>
          `).join('')}
        </select>
      </div>

      <!-- アクションボタン -->
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <button id="completeListingBtn"
          style="width:100%;padding:16px;border-radius:12px;border:none;background:#C5A258;color:#000;font-size:16px;font-weight:bold;cursor:pointer;transition:opacity 0.2s;">
          📋 出品情報を保存
        </button>
        <div style="display:flex;gap:10px;">
          <button id="saveProgressBtn"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:13px;cursor:pointer;">
            💾 途中保存
          </button>
          <button id="cancelWorkBtn"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid #CE202944;background:transparent;color:#CE2029;font-size:13px;cursor:pointer;">
            ✖ 作業キャンセル
          </button>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px;">
          <button id="skipToNextBtn"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid #dde0e6;background:#ffffff;color:#5a6272;font-size:13px;cursor:pointer;">
            ⏭ スキップ（次の商品）
          </button>
          <button id="goToListBtn"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid #dde0e6;background:#ffffff;color:#5a6272;font-size:13px;cursor:pointer;">
            📋 一覧から探す
          </button>
        </div>
      </div>
    </div>
    </div>
  `;

  // --- イベントリスナー ---

  // 戻る
  container.querySelector('#salesBackBtn').addEventListener('click', () => {
    showConfirm('作業を途中保存して一覧に戻りますか？', async () => {
      await saveProgress(container, item.mgmt_num);
      renderListView(container);
    }, () => {});
  });

  // タイトル入力 → バリデーション
  const titleInput = container.querySelector('#listingTitle');
  const titleCounter = container.querySelector('#titleCounter');
  const titleError = container.querySelector('#titleError');

  titleInput.addEventListener('input', () => {
    const val = titleInput.value;
    titleCounter.textContent = `${val.length}/${TITLE_MAX_LEN}`;
    titleCounter.style.color = val.length > TITLE_MAX_LEN - 5 ? '#f44336' : '#666';

    // 禁止文字チェック
    const forbidden = val.match(FORBIDDEN_CHARS);
    if (forbidden) {
      titleError.textContent = `禁止文字が含まれています: ${[...new Set(forbidden)].join(' ')}`;
      titleError.style.display = 'block';
    } else {
      titleError.style.display = 'none';
    }
  });

  // 写真追加
  container.querySelector('#addPhotoBtn').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;
      showToast('写真を処理中...');
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 1200);
      sessionPhotos.push(resized);
      refreshSessionPhotos(container);

      // Driveにアップロード試行
      try {
        const photoIndex = photos.length + sessionPhotos.length;
        const resp = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-drive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
            'apikey': CONFIG.AWAI_KEY,
          },
          body: JSON.stringify({
            managementNumber: item.mgmt_num,
            images: [{
              data: resized,
              name: `photo_${photoIndex}.jpg`,
              mimeType: 'image/jpeg',
            }],
          }),
        });
        if (resp.ok) {
          const driveResult = await resp.json().catch(() => null);
          // Drive URLが返ってきたらDBのphoto_urlsに追加
          if (driveResult?.files?.length > 0) {
            const fileId = driveResult.files[0].id;
            const driveUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
            const currentItem = await db.getItem(item.mgmt_num);
            const currentPhotos = currentItem?.photo_urls || [];
            currentPhotos.push(driveUrl);
            await db.updateItem(item.mgmt_num, { photo_urls: currentPhotos });
          }
          showToast('写真を追加しました（Drive保存済み）');
        } else {
          const errText = await resp.text().catch(() => '');
          console.error('Drive upload failed:', resp.status, errText);
          showToast('写真を追加しました（ローカルのみ）');
        }
      } catch (driveErr) {
        console.error('Drive upload error:', driveErr);
        showToast('写真を追加しました（ローカルのみ）');
      }
    } catch (err) {
      console.error('Photo capture error:', err);
      showToast('写真の追加に失敗しました');
    }
  });

  // セッション写真の描画
  function refreshSessionPhotos(container) {
    const gallery = container.querySelector('#sessionPhotoGallery');
    if (!gallery) return;
    const noMsg = container.querySelector('#noPhotoMsg');
    if (noMsg) noMsg.remove();
    gallery.innerHTML = sessionPhotos.map((b64, i) => `
      <div style="position:relative;flex-shrink:0;" data-session-idx="${i}">
        <img src="${b64}" alt="追加写真${i + 1}"
          style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid #C5A258;" />
        <button data-del-session="${i}" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border-radius:50%;background:rgba(244,67,54,0.9);color:#fff;border:none;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">x</button>
        <div style="position:absolute;top:2px;left:2px;background:rgba(197,162,88,0.8);color:#000;font-size:9px;padding:1px 4px;border-radius:4px;font-weight:bold;">新${i + 1}</div>
      </div>
    `).join('');

    gallery.querySelectorAll('[data-del-session]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.delSession);
        sessionPhotos.splice(idx, 1);
        refreshSessionPhotos(container);
        showToast('写真を削除しました');
      });
    });
  }

  // 初期描画
  if (sessionPhotos.length > 0) {
    refreshSessionPhotos(container);
  }

  // AI生成タイトル
  container.querySelector('#aiTitleBtn').addEventListener('click', async () => {
    await generateAIListing(container, item, 'title');
  });

  // AI生成説明文
  container.querySelector('#aiDescBtn').addEventListener('click', async () => {
    await generateAIListing(container, item, 'description');
  });

  // コピーボタン
  container.querySelector('#copyTitleBtn').addEventListener('click', () => {
    const title = container.querySelector('#listingTitle').value;
    copyToClipboard(title);
    showToast('タイトルをコピーしました');
  });

  container.querySelector('#copyDescBtn').addEventListener('click', () => {
    const desc = container.querySelector('#listingDesc').value;
    copyToClipboard(desc);
    showToast('説明文をコピーしました');
  });

  // 出品完了
  container.querySelector('#completeListingBtn').addEventListener('click', () => {
    completeListing(container, item.mgmt_num);
  });

  // 途中保存（ロック維持 + データ保存）
  container.querySelector('#saveProgressBtn').addEventListener('click', async () => {
    await saveProgress(container, item.mgmt_num);
    showToast('保存しました（ロック中 — 他の人は編集できません）');
  });

  // 作業キャンセル
  container.querySelector('#cancelWorkBtn').addEventListener('click', () => {
    showConfirm('作業をキャンセルしてロックを解除しますか？\n入力内容は破棄されます。', async () => {
      stopTimer();
      await db.unlockItem(item.mgmt_num);
      await db.updateItemStatus(item.mgmt_num, CONFIG.STATUS.LIST_WAIT, staff.name);
      showToast('作業をキャンセルしました');
      renderListView(container);
    });
  });

  // スキップ（次の商品へ）
  container.querySelector('#skipToNextBtn')?.addEventListener('click', () => {
    showConfirm('この商品をスキップして次へ進みますか？', async () => {
      stopTimer();
      await db.unlockItem(item.mgmt_num);
      // ステータスが出品作業中なら出品待ちに戻す
      const current = await db.getItem(item.mgmt_num);
      if (current?.status === CONFIG.STATUS.LISTING_WORK) {
        await db.updateItemStatus(item.mgmt_num, CONFIG.STATUS.LIST_WAIT, staff.name);
      }
      workingItem = null;
      openNextItem(container);
    });
  });

  // 一覧から探す
  container.querySelector('#goToListBtn')?.addEventListener('click', () => {
    showConfirm('作業を途中保存して一覧に切り替えますか？', async () => {
      await saveProgress(container, item.mgmt_num);
      stopTimer();
      await db.unlockItem(item.mgmt_num);
      workingItem = null;
      currentTab = 'list_wait';
      renderListView(container);
    }, () => {});
  });
}

// ============================================================
//  AI生成（タイトル/説明文）
// ============================================================
async function generateAIListing(container, item, type) {
  const btn = type === 'title'
    ? container.querySelector('#aiTitleBtn')
    : container.querySelector('#aiDescBtn');

  const originalText = btn.textContent;
  btn.textContent = '生成中...';
  btn.disabled = true;

  try {
    const photos = item.photo_urls || [];
    // セッション中に追加した写真も含める
    const allPhotos = [...photos, ...sessionPhotos];
    const photoData = allPhotos.slice(0, 3);

    // 写真も商品名もない場合は警告
    if (photoData.length === 0 && !item.product_name) {
      showToast('写真または商品名が必要です');
      return;
    }

    const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        'apikey': CONFIG.AWAI_KEY,
      },
      body: JSON.stringify({
        image: photoData[0] || null,
        images: photoData.length > 0 ? photoData : null,
        step: 'listing',
        context: {
          task: 'listing',
          generateType: type,
          productName: container.querySelector('#editProductName')?.value || item.product_name || '',
          maker: item.maker || '',
          model: container.querySelector('#editModelNumber')?.value || item.model_number || '',
          condition: item.condition || '',
          conditionRank: container.querySelector('#editConditionRank')?.value || item.condition_rank || '',
          channel: item.channel_name || '',
          partnerItemNumber: item.partner_item_number || '',
          operationStatus: item.operation_status || '',
          operationNote: item.operation_note || '',
          category: item.category || '',
          mgmtNum: item.mgmt_num || '',
          shippingSize: parseInt(container.querySelector('#editShippingSize')?.value) || item.shipping_size || null,
          targetPrice: parseInt(container.querySelector('#targetPrice')?.value) || item.target_price || null,
          marketDemand: parseInt(container.querySelector('#editMarketDemand')?.value) || item.market_demand || 2,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const result = await res.json();
    const j = result.success ? result.judgment : result;
    const data = {
      title: j.listingTitle || j.productName || '',
      description: j.listingDescription || '',
    };

    if (type === 'title' && data.title) {
      // スタッフマーク自動付与
      const staff = getCurrentStaff();
      const mark = CONFIG.STAFF_MARKS[staff?.name] || '';
      const titleWithMark = mark ? `${mark}${data.title}` : data.title;

      // 文字数制限カット
      const trimmed = titleWithMark.slice(0, TITLE_MAX_LEN);
      const titleInput = container.querySelector('#listingTitle');
      titleInput.value = trimmed;
      titleInput.dispatchEvent(new Event('input'));
      generatedTitle = trimmed;
      showToast('タイトルを生成しました');
    }

    if (type === 'description' && data.description) {
      const descInput = container.querySelector('#listingDesc');
      // 画面上の最新値を使用
      const editedShippingSize = parseInt(container.querySelector('#editShippingSize')?.value) || item.shipping_size || 60;
      const editedTargetPrice = parseInt(container.querySelector('#targetPrice')?.value) || item.target_price || 0;
      const editedMarketDemand = parseInt(container.querySelector('#editMarketDemand')?.value) || item.market_demand || 2;
      // テンプレート自動挿入（状態・発送・取引詳細）
      const shippingTemplate = editedShippingSize >= 170
        ? CONFIG.LISTING_TEMPLATES.shippingArt('C', 1)
        : CONFIG.LISTING_TEMPLATES.shippingSagawa(editedShippingSize);
      // 管理番号ヘッダー: 管理番号/S発送サイズ/出品回数/需要レベル
      const sizeCode = editedShippingSize >= 170 ? 'YR' : 'S' + editedShippingSize;
      let priceCode = '';
      if (editedTargetPrice >= 10000) priceCode = Math.round(editedTargetPrice / 10000) + 'M';
      else if (editedTargetPrice > 0) priceCode = Math.round(editedTargetPrice / 100) + 'H';
      const itemHeader = `${item.mgmt_num}/${sizeCode}/${priceCode || '-'}/${editedMarketDemand}`;
      const fullDesc = itemHeader + '\n\n【商品説明】\n' + data.description
        + '\n\n' + CONFIG.LISTING_TEMPLATES.conditionNotes
        + '\n\n' + shippingTemplate
        + '\n\n' + CONFIG.LISTING_TEMPLATES.tradingNotes;
      descInput.value = fullDesc;
      generatedDesc = fullDesc;
      showToast('説明文を生成しました');
    }

    // 両方同時に生成された場合、もう片方もセット
    if (type === 'title' && data.description && !generatedDesc) {
      const descInput = container.querySelector('#listingDesc');
      if (descInput && !descInput.value) {
        const editedShippingSize = parseInt(container.querySelector('#editShippingSize')?.value) || item.shipping_size || 60;
        const editedTargetPrice = parseInt(container.querySelector('#targetPrice')?.value) || item.target_price || 0;
        const editedMarketDemand = parseInt(container.querySelector('#editMarketDemand')?.value) || item.market_demand || 2;
        const shippingTemplate = editedShippingSize >= 170
          ? CONFIG.LISTING_TEMPLATES.shippingArt('C', 1)
          : CONFIG.LISTING_TEMPLATES.shippingSagawa(editedShippingSize);
        const sizeCode = editedShippingSize >= 170 ? 'YR' : 'S' + editedShippingSize;
        let priceCode = '';
        if (editedTargetPrice >= 10000) priceCode = Math.round(editedTargetPrice / 10000) + 'M';
        else if (editedTargetPrice > 0) priceCode = Math.round(editedTargetPrice / 100) + 'H';
        const itemHeader = `${item.mgmt_num}/${sizeCode}/${priceCode || '-'}/${editedMarketDemand}`;
        const fullDesc = itemHeader + '\n\n【商品説明】\n' + data.description
          + '\n\n' + CONFIG.LISTING_TEMPLATES.conditionNotes
          + '\n\n' + shippingTemplate
          + '\n\n' + CONFIG.LISTING_TEMPLATES.tradingNotes;
        descInput.value = fullDesc;
        generatedDesc = fullDesc;
      }
    }
    if (type === 'description' && data.title && !generatedTitle) {
      const staff = getCurrentStaff();
      const mark = CONFIG.STAFF_MARKS[staff?.name] || '';
      const titleWithMark = mark ? `${mark}${data.title}` : data.title;
      const trimmed = titleWithMark.slice(0, TITLE_MAX_LEN);
      const titleInput = container.querySelector('#listingTitle');
      if (titleInput && !titleInput.value) {
        titleInput.value = trimmed;
        titleInput.dispatchEvent(new Event('input'));
        generatedTitle = trimmed;
      }
    }

  } catch (err) {
    console.error('AI生成エラー:', err);
    showToast('AI生成に失敗しました。手動で入力してください');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ============================================================
//  出品完了
// ============================================================
async function completeListing(container, mgmtNum) {
  const titleInput = container.querySelector('#listingTitle');
  const descInput = container.querySelector('#listingDesc');
  const startPriceInput = container.querySelector('#startPrice');
  const targetPriceInput = container.querySelector('#targetPrice');
  const channelSelect = container.querySelector('#channelSelect');

  const title = titleInput?.value?.trim() || '';
  const description = descInput?.value?.trim() || '';
  const startPrice = parseInt(startPriceInput?.value) || null;
  const targetPrice = parseInt(targetPriceInput?.value) || null;
  const channelName = channelSelect?.value || '';

  // バリデーション
  if (!title) {
    showToast('タイトルを入力してください');
    titleInput?.focus();
    return;
  }

  if (title.length > TITLE_MAX_LEN) {
    showToast(`タイトルは${TITLE_MAX_LEN}文字以内にしてください`);
    titleInput?.focus();
    return;
  }

  const forbidden = title.match(FORBIDDEN_CHARS);
  if (forbidden) {
    showToast(`タイトルに禁止文字があります: ${[...new Set(forbidden)].join(' ')}`);
    titleInput?.focus();
    return;
  }

  if (!startPrice || startPrice <= 0) {
    showToast('開始価格を入力してください');
    startPriceInput?.focus();
    return;
  }

  // 最低出品価格チェック
  const item = await db.getItem(mgmtNum);
  if (item?.min_listing_price && startPrice < item.min_listing_price) {
    showConfirm(
      `開始価格 ${formatPrice(startPrice)} は最低出品価格 ${formatPrice(item.min_listing_price)} を下回っています。\nこのまま出品しますか？`,
      () => doCompleteListing(container, mgmtNum, { title, description, startPrice, targetPrice, channelName }),
      () => {}
    );
    return;
  }

  // 説明文の先頭に管理番号ヘッダーがなければ自動付与
  let finalDescription = description;
  if (description && !description.startsWith(mgmtNum)) {
    const editedShippingSize = parseInt(container.querySelector('#editShippingSize')?.value) || 60;
    const editedMarketDemand = parseInt(container.querySelector('#editMarketDemand')?.value) || 2;
    const sizeCode = editedShippingSize >= 170 ? 'YR' : 'S' + editedShippingSize;
    let priceCode = '';
    if (targetPrice >= 10000) priceCode = Math.round(targetPrice / 10000) + 'M';
    else if (targetPrice > 0) priceCode = Math.round(targetPrice / 100) + 'H';
    const itemHeader = `${mgmtNum}/${sizeCode}/${priceCode || '-'}/${editedMarketDemand}`;
    finalDescription = itemHeader + '\n\n' + description;
  }

  // 編集フィールドの値も取得
  const shippingSize = parseInt(container.querySelector('#editShippingSize')?.value) || null;
  const conditionRank = container.querySelector('#editConditionRank')?.value || null;
  const marketDemand = parseInt(container.querySelector('#editMarketDemand')?.value) || 2;
  const productName = container.querySelector('#editProductName')?.value?.trim() || null;
  const modelNumber = container.querySelector('#editModelNumber')?.value?.trim() || null;

  doCompleteListing(container, mgmtNum, {
    title, description: finalDescription, startPrice, targetPrice, channelName,
    shippingSize, conditionRank, marketDemand, productName, modelNumber,
  });
}

async function doCompleteListing(container, mgmtNum, { title, description, startPrice, targetPrice, channelName, shippingSize, conditionRank, marketDemand, productName, modelNumber }) {
  const staff = getCurrentStaff();
  const elapsed = stopTimer();

  showLoading(container, '保存中...');

  try {
    // 商品情報更新
    const staffMark = CONFIG.STAFF_MARKS[staff?.name] || '';
    const updates = {
      listing_title: title,
      listing_description: description,
      start_price: startPrice,
      target_price: targetPrice,
      listed_by: staff?.name || '',
      listed_at: new Date().toISOString(),
      listing_seconds: elapsed,
      staff_mark: staffMark,
    };

    // 編集フィールド
    if (shippingSize) updates.shipping_size = shippingSize;
    if (conditionRank) updates.condition_rank = conditionRank;
    if (marketDemand) updates.market_demand = marketDemand;
    if (productName) updates.product_name = productName;
    if (modelNumber) updates.model_number = modelNumber;

    // チャンネル変更
    if (channelName) {
      updates.channel_name = channelName;
    }

    // まず商品情報を先に保存（ステータス変更と分離）
    const saveResult = await db.updateItem(mgmtNum, updates);
    if (!saveResult) {
      console.error('出品完了: 商品情報保存失敗', mgmtNum, updates);
      showToast('商品情報の保存に失敗しました');
      openListingWork(container, mgmtNum);
      return;
    }

    // ステータス更新（別のDB呼び出しで）
    const result = await db.updateItemStatus(mgmtNum, CONFIG.STATUS.LISTING, staff?.name || '');
    if (!result) {
      console.error('出品完了: ステータス更新失敗', mgmtNum);
      showToast('ステータスの更新に失敗しました。商品情報は保存済みです。もう一度お試しください');
      openListingWork(container, mgmtNum);
      return;
    }
    await db.unlockItem(mgmtNum);

    // 作業ログ記録
    await db.logWork({
      staff_name: staff?.name || '',
      work_type: '出品',
      mgmt_num: mgmtNum,
      work_date: new Date(new Date().getTime() + (9*60 - new Date().getTimezoneOffset())*60000).toISOString().slice(0,10),
      duration_seconds: elapsed,
      detail: `タイトル: ${title.slice(0, 30)}...`,
    });

    workingItem = null;
    sessionPhotos = [];
    showToast('出品情報を保存しました。ヤフオクへの出品はブラウザから行ってください');

    // 完了後は一覧に戻る
    currentTab = 'list_wait';
    renderListView(container);

  } catch (err) {
    console.error('出品完了エラー:', err);
    showToast('保存に失敗しました: ' + (err.message || ''));
    // 画面を復元
    openListingWork(container, mgmtNum);
  }
}

// ============================================================
//  途中保存
// ============================================================
async function saveProgress(container, mgmtNum) {
  const titleInput = container.querySelector('#listingTitle');
  const descInput = container.querySelector('#listingDesc');
  const startPriceInput = container.querySelector('#startPrice');
  const targetPriceInput = container.querySelector('#targetPrice');
  const channelSelect = container.querySelector('#channelSelect');

  const editName = container.querySelector('#editProductName');
  const editModel = container.querySelector('#editModelNumber');
  const editShippingSize = container.querySelector('#editShippingSize');
  const editConditionRank = container.querySelector('#editConditionRank');
  const editMarketDemand = container.querySelector('#editMarketDemand');

  const updates = {};
  if (editName?.value) updates.product_name = editName.value.trim();
  if (editModel?.value) updates.model_number = editModel.value.trim();
  if (editShippingSize?.value) updates.shipping_size = parseInt(editShippingSize.value) || null;
  if (editConditionRank?.value) updates.condition_rank = editConditionRank.value;
  if (editMarketDemand?.value) updates.market_demand = parseInt(editMarketDemand.value) || 2;
  if (titleInput?.value) updates.listing_title = titleInput.value.trim();
  if (descInput?.value) updates.listing_description = descInput.value.trim();
  if (startPriceInput?.value) updates.start_price = parseInt(startPriceInput.value) || null;
  if (targetPriceInput?.value) updates.target_price = parseInt(targetPriceInput.value) || null;
  if (channelSelect?.value) updates.channel_name = channelSelect.value;

  if (Object.keys(updates).length > 0) {
    await db.updateItem(mgmtNum, updates);
  }
}

// ============================================================
//  出品中 詳細画面（価格変更・再出品・チャンネル変更）
// ============================================================
function openListingDetail(container, item) {
  const channel = CONFIG.CHANNELS.find(c => c.name === item.channel_name);

  container.innerHTML = `
    <div style="padding:12px 12px 120px;">
      <!-- ヘッダー -->
      <div style="margin-bottom:16px;">
        <button id="detailBackBtn" style="background:none;border:none;color:#C5A258;font-size:14px;cursor:pointer;padding:4px 0;">
          ← 一覧に戻る
        </button>
      </div>

      <!-- 商品情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:13px;color:#C5A258;font-weight:bold;">${escapeHtml(item.mgmt_num)}</span>
          ${statusBadge(item.status)}
        </div>
        <div style="font-size:15px;color:#1C2541;font-weight:bold;margin-bottom:4px;">${escapeHtml(item.product_name || '')}</div>
        <div style="font-size:12px;color:#5a6272;margin-bottom:6px;">
          ${escapeHtml(item.maker || '')} | ${escapeHtml(channel?.name || item.channel_name || '未設定')}
        </div>
        ${item.listing_title ? `
          <div style="font-size:12px;color:#5a6272;padding:8px;background:#F8F5EE;border-radius:6px;margin-top:6px;word-break:break-all;">
            ${escapeHtml(item.listing_title)}
          </div>
        ` : ''}
        ${item.listed_at ? `
          <div style="font-size:11px;color:#8a8a8a;margin-top:6px;">
            出品日: ${new Date(item.listed_at).toLocaleDateString('ja-JP')}
            ${item.listed_by ? ` / ${escapeHtml(item.listed_by)}` : ''}
            ${item.listing_seconds ? ` / 作業時間: ${formatDuration(item.listing_seconds)}` : ''}
          </div>
        ` : ''}
      </div>

      <!-- 価格管理 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #dde0e6;">
        <h3 style="color:#1C2541;font-size:13px;margin:0 0 10px;">💰 価格管理</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label style="font-size:11px;color:#5a6272;display:block;margin-bottom:4px;">開始価格</label>
            <input id="detailStartPrice" type="number" inputmode="numeric"
              value="${item.start_price || ''}"
              style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:15px;font-weight:bold;outline:none;" />
          </div>
          <div>
            <label style="font-size:11px;color:#5a6272;display:block;margin-bottom:4px;">目標価格</label>
            <input id="detailTargetPrice" type="number" inputmode="numeric"
              value="${item.target_price || ''}"
              style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:15px;font-weight:bold;outline:none;" />
          </div>
        </div>
        <button id="updatePriceBtn"
          style="width:100%;padding:10px;border-radius:8px;border:none;background:#dde0e6;color:#1C2541;font-size:13px;cursor:pointer;">
          価格を更新
        </button>
      </div>

      <!-- チャンネル変更 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #dde0e6;">
        <h3 style="color:#1C2541;font-size:13px;margin:0 0 10px;">📢 チャンネル変更</h3>
        <select id="detailChannelSelect"
          style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:14px;outline:none;margin-bottom:10px;">
          ${CONFIG.CHANNELS.filter(c => c.type === 'tsuhan').map(c => `
            <option value="${escapeHtml(c.name)}" ${c.name === item.channel_name ? 'selected' : ''}>
              ${escapeHtml(c.name)}（${escapeHtml(c.platform || '—')}）
            </option>
          `).join('')}
        </select>
        <button id="changeChannelBtn"
          style="width:100%;padding:10px;border-radius:8px;border:none;background:#dde0e6;color:#1C2541;font-size:13px;cursor:pointer;">
          チャンネルを変更
        </button>
      </div>

      <!-- 再出品 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:16px;border:1px solid #dde0e6;">
        <h3 style="color:#1C2541;font-size:13px;margin:0 0 10px;">🔄 再出品</h3>
        <p style="font-size:12px;color:#5a6272;margin-bottom:10px;">出品中の商品を一度取り下げて再出品します。タイトル・説明文を編集できます。</p>
        <button id="relistBtn"
          style="width:100%;padding:12px;border-radius:8px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:14px;font-weight:bold;cursor:pointer;">
          再出品する
        </button>
      </div>

      <!-- コピーボタン群 -->
      ${item.listing_title ? `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button id="copyDetailTitle" style="flex:1;padding:10px;border-radius:8px;border:none;background:#dde0e6;color:#4a4a5a;font-size:12px;cursor:pointer;">
            📋 タイトルコピー
          </button>
          <button id="copyDetailDesc" style="flex:1;padding:10px;border-radius:8px;border:none;background:#dde0e6;color:#4a4a5a;font-size:12px;cursor:pointer;">
            📋 説明文コピー
          </button>
        </div>
      ` : ''}

      <!-- 管理操作 -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #333;">
        <p style="color:#8a8a8a;font-size:11px;margin-bottom:8px;">管理操作</p>
        <div style="display:flex;gap:8px;">
          <button id="btnRevertStatus" style="flex:1;padding:10px;border-radius:8px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:13px;cursor:pointer;">
            ↩ ステータスを戻す
          </button>
          <button id="btnDeleteItem" style="flex:1;padding:10px;border-radius:8px;border:1px solid #f44336;background:transparent;color:#CE2029;font-size:13px;cursor:pointer;">
            🗑 削除
          </button>
        </div>
      </div>
    </div>
  `;

  // イベント
  container.querySelector('#detailBackBtn').addEventListener('click', () => {
    renderListView(container);
  });

  // 価格更新
  container.querySelector('#updatePriceBtn').addEventListener('click', async () => {
    const startPrice = parseInt(container.querySelector('#detailStartPrice').value) || null;
    const targetPrice = parseInt(container.querySelector('#detailTargetPrice').value) || null;
    await db.updateItem(item.mgmt_num, { start_price: startPrice, target_price: targetPrice });
    showToast('価格を更新しました');
  });

  // チャンネル変更
  container.querySelector('#changeChannelBtn').addEventListener('click', () => {
    const newChannel = container.querySelector('#detailChannelSelect').value;
    if (newChannel === item.channel_name) {
      showToast('同じチャンネルです');
      return;
    }
    showConfirm(
      `チャンネルを「${newChannel}」に変更しますか？`,
      async () => {
        const staff = getCurrentStaff();
        await db.updateItem(item.mgmt_num, { channel_name: newChannel });
        showToast(`チャンネルを「${newChannel}」に変更しました`);
        // 画面リフレッシュ
        const updated = await db.getItem(item.mgmt_num);
        if (updated) openListingDetail(container, updated);
      }
    );
  });

  // 再出品
  container.querySelector('#relistBtn').addEventListener('click', () => {
    showConfirm(
      '再出品しますか？\n出品作業画面で内容を編集できます。',
      async () => {
        const staff = getCurrentStaff();
        await db.updateItemStatus(item.mgmt_num, CONFIG.STATUS.LIST_WAIT, staff?.name || '');
        showToast('出品待ちに戻しました。出品作業を開始します。');
        openListingWork(container, item.mgmt_num);
      }
    );
  });

  // コピー
  const copyTitleBtn = container.querySelector('#copyDetailTitle');
  if (copyTitleBtn) {
    copyTitleBtn.addEventListener('click', () => {
      copyToClipboard(item.listing_title || '');
      showToast('タイトルをコピーしました');
    });
  }

  const copyDescBtn = container.querySelector('#copyDetailDesc');
  if (copyDescBtn) {
    copyDescBtn.addEventListener('click', () => {
      copyToClipboard(item.listing_description || '');
      showToast('説明文をコピーしました');
    });
  }

  // ステータスを戻す
  container.querySelector('#btnRevertStatus').addEventListener('click', () => {
    const revertOptions = ['分荷確定', '撮影待ち', '出品待ち'];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,37,65,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#ffffff;border-radius:16px;padding:24px;max-width:320px;width:100%;">
        <h3 style="color:#C5A258;font-size:16px;margin:0 0 16px;">↩ ステータスを戻す</h3>
        <p style="color:#5a6272;font-size:12px;margin-bottom:12px;">現在: ${escapeHtml(item.status)}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${revertOptions.map(s => `
            <button data-revert-to="${escapeHtml(s)}" style="padding:12px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;cursor:pointer;text-align:left;">
              → ${escapeHtml(s)}
            </button>
          `).join('')}
        </div>
        <button id="revertCancel" style="width:100%;padding:10px;border-radius:8px;background:#dde0e6;color:#4a4a5a;border:none;font-size:14px;cursor:pointer;">キャンセル</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#revertCancel').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('[data-revert-to]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newStatus = btn.dataset.revertTo;
        overlay.remove();
        showConfirm(`ステータスを「${newStatus}」に戻しますか？`, async () => {
          const staff = getCurrentStaff();
          const updated = await db.updateItemStatus(item.mgmt_num, newStatus, staff?.name || '');
          if (updated) {
            showToast(`ステータスを「${newStatus}」に戻しました`);
            openListingDetail(container, updated);
          } else {
            showToast('更新に失敗しました');
          }
        });
      });
    });
  });

  // 商品を削除
  container.querySelector('#btnDeleteItem').addEventListener('click', () => {
    showConfirm(`「${item.mgmt_num}」を削除しますか？\nこの操作は取り消せません。`, async () => {
      const dbClient = db.getDB();
      if (!dbClient) { showToast('DB接続エラー'); return; }
      const { error } = await dbClient.from('items').delete().eq('mgmt_num', item.mgmt_num);
      if (error) {
        console.error('Delete error:', error);
        showToast('削除に失敗しました');
      } else {
        showToast('商品を削除しました');
        renderListView(container);
      }
    });
  });
}

// ============================================================
//  タイマー
// ============================================================
function startTimer() {
  stopTimer();
  timerStart = Date.now();
  timerElapsed = 0;

  timerInterval = setInterval(() => {
    timerElapsed = Math.floor((Date.now() - timerStart) / 1000);
    const timerEl = document.getElementById('salesTimer');
    if (timerEl) {
      const min = Math.floor(timerElapsed / 60);
      const sec = timerElapsed % 60;
      timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

      // 10分超えたら警告色
      if (timerElapsed > 600) {
        timerEl.style.color = '#f44336';
      } else if (timerElapsed > 300) {
        timerEl.style.color = '#ff9800';
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const elapsed = timerElapsed;
  timerElapsed = 0;
  timerStart = null;
  return elapsed;
}

// ============================================================
//  ユーティリティ
// ============================================================
function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

// ============================================================
//  作業中アイテムのクリーンアップ（画面離脱時）
// ============================================================
async function cleanupWorkingItem() {
  if (workingItem) {
    const staff = getCurrentStaff();
    try {
      // ロック解除
      await db.unlockItem(workingItem.mgmt_num);
      // 出品作業中→出品待ちに戻す（出品完了していない場合のみ）
      const item = await db.getItem(workingItem.mgmt_num);
      if (item && item.status === CONFIG.STATUS.LISTING_WORK) {
        await db.updateItemStatus(workingItem.mgmt_num, CONFIG.STATUS.LIST_WAIT, staff?.name || '');
      }
    } catch (e) {
      console.error('クリーンアップエラー:', e);
    }
    workingItem = null;
    stopTimer();
  }
}

// 出品作業中のままロック解除済みの商品を出品待ちに戻す
async function cleanStaleListingWork() {
  const dbClient = db.getDB();
  if (!dbClient) return;
  const { data } = await dbClient.from('items')
    .select('mgmt_num')
    .eq('status', CONFIG.STATUS.LISTING_WORK)
    .is('locked_by', null)
    .limit(50);
  if (data && data.length > 0) {
    for (const item of data) {
      await db.updateItemStatus(item.mgmt_num, CONFIG.STATUS.LIST_WAIT, 'system');
    }
    console.log(`${data.length}件の放置「出品作業中」を出品待ちに戻しました`);
  }
}

// 他モジュールからのナビゲーション時に呼ばれる
export { cleanupWorkingItem };

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;top:-9999px;';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(textarea);
}
