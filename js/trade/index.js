/**
 * テイクバック流通 v2 - 取引モジュール
 * 落札・入金管理 / 梱包 / 出荷 / トラブル対応
 */
import { CONFIG } from '../core/config.js';
import * as db from '../core/db.js';
import { getCurrentStaff } from '../core/auth.js';
import {
  showToast, showLoading, showConfirm, capturePhoto,
  fileToBase64, resizeImage, escapeHtml, statusBadge,
  formatPrice, formatDate, formatDuration, emptyState,
  renderLeadTimes,
} from '../core/ui.js';
import { navigate } from '../core/router.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 取引モジュールが扱うステータス一覧 */
const TRADE_STATUSES = [
  '落札済み', '連絡待ち', '送料連絡済み', '入金待ち', '入金確認済み',
  '梱包待ち', '梱包中', '梱包完了', '発送済み', '受取確認', '完了',
];

/** トラブル系ステータス */
const TROUBLE_STATUSES = [
  '商品問題連絡', '運送会社相談中', '商品回収中', '返送中',
  '商品確認中', 'キャンセル処理', '返金処理',
  '運送会社請求中', '運送会社入金確認', 'キャンセル',
];

/** タブ定義 */
const TABS = [
  { key: 'sold',   label: '落札済み',   statuses: ['落札済み', '連絡待ち', '送料連絡済み', '入金待ち', '入金確認済み'] },
  { key: 'pack',   label: '梱包待ち',   statuses: ['梱包待ち', '梱包中', '梱包完了'] },
  { key: 'ship',   label: '発送準備',   statuses: ['梱包完了', '発送済み'] },
  { key: 'all',    label: '全件',       statuses: [...TRADE_STATUSES, ...TROUBLE_STATUSES] },
];

/** 通常フローの次ステータスマップ */
const NEXT_STATUS = {
  '落札済み':     '連絡待ち',
  '連絡待ち':     '送料連絡済み',
  '送料連絡済み': '入金待ち',
  '入金待ち':     '入金確認済み',
  '入金確認済み': '梱包待ち',
  '梱包待ち':     '梱包中',
  '梱包中':       '梱包完了',
  '梱包完了':     '発送済み',
  '発送済み':     '受取確認',
  '受取確認':     '完了',
};

/** トラブルフローステップ */
const TROUBLE_FLOW = [
  '商品問題連絡', '運送会社相談中', '商品回収中', '返送中',
  '商品確認中', 'キャンセル処理', '返金処理',
];

// ---------------------------------------------------------------------------
// モジュール状態
// ---------------------------------------------------------------------------
let _container = null;
let _activeTab = 'sold';
let _items = [];
let _searchQuery = '';
let _unsubscribe = null;

// 梱包タイマー
let _packingItem = null;
let _packingStart = null;
let _packingTimerId = null;

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

/**
 * 取引モジュールを描画
 * @param {HTMLElement} container - 描画先
 * @param {object} params - ルーターから渡されるパラメータ
 */
export async function renderTrade(container, params = {}) {
  _container = container;

  // パラメータからタブ指定があれば適用
  if (params.tab && TABS.some(t => t.key === params.tab)) {
    _activeTab = params.tab;
  }
  // 特定商品の詳細へ直接遷移
  if (params.mgmtNum && params.view === 'detail') {
    showLoading(container);
    const item = await db.getItem(params.mgmtNum);
    if (item) { renderDetail(item); return; }
    showToast('商品が見つかりません');
  }
  // 梱包画面への直接遷移
  if (params.mgmtNum && params.view === 'packing') {
    showLoading(container);
    const item = await db.getItem(params.mgmtNum);
    if (item) { renderPackingScreen(item); return; }
    showToast('商品が見つかりません');
  }

  // リアルタイム購読
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = db.subscribe((table) => {
    if (table === 'items') loadAndRender();
  });

  showLoading(container);
  await loadAndRender();
}

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

async function loadItems() {
  const tab = TABS.find(t => t.key === _activeTab);
  const filters = { status: tab.statuses };
  if (_searchQuery) filters.search = _searchQuery;
  filters.orderBy = 'updated_at';
  filters.ascending = false;
  _items = await db.getItems(filters);
}

async function loadAndRender() {
  await loadItems();
  renderList();
}

// ---------------------------------------------------------------------------
// リスト画面
// ---------------------------------------------------------------------------

function renderList() {
  const staff = getCurrentStaff();
  const tab = TABS.find(t => t.key === _activeTab);

  // タブごとの件数集計用ヘッダー
  const tabsHtml = TABS.map(t => {
    const active = t.key === _activeTab;
    return `
      <button data-tab="${t.key}"
        style="flex:1;padding:10px 4px;border:none;border-bottom:2px solid ${active ? '#C5A258' : 'transparent'};
        background:none;color:${active ? '#C5A258' : '#5a6272'};font-size:13px;font-weight:${active ? 'bold' : 'normal'};cursor:pointer;white-space:nowrap;">
        ${t.label}
      </button>`;
  }).join('');

  // 検索バー
  const searchHtml = `
    <div style="padding:8px 12px;">
      <input id="tradeSearch" type="text" placeholder="管理番号・商品名で検索"
        value="${escapeHtml(_searchQuery)}"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;box-sizing:border-box;">
    </div>`;

  // アクションバー
  const actionHtml = `
    <div style="padding:0 12px 8px;display:flex;gap:8px;">
      <button id="btnSalesImport" style="flex:1;padding:10px;border-radius:8px;background:#C5A258;color:#000;border:none;font-size:13px;font-weight:bold;cursor:pointer;">
        📸 売上取込
      </button>
      <button id="btnOcrTransaction" style="flex:1;padding:10px;border-radius:8px;background:#f0ede5;color:#C5A258;border:1px solid #C5A258;font-size:13px;font-weight:bold;cursor:pointer;">
        📋 取引ナビOCR
      </button>
      ${_activeTab === 'ship' ? `
        <button id="btnEhidenCsv" style="flex:1;padding:10px;border-radius:8px;background:#f0ede5;color:#C5A258;border:1px solid #C5A258;font-size:13px;font-weight:bold;cursor:pointer;">
          📄 E飛伝CSV
        </button>` : ''}
    </div>`;

  // 商品カード
  let cardsHtml = '';
  if (_items.length === 0) {
    cardsHtml = emptyState('📦', `${tab.label}の商品はありません`);
  } else {
    cardsHtml = _items.map(item => renderItemCard(item)).join('');
  }

  _container.innerHTML = `
    <div style="padding:12px 16px 0;display:flex;align-items:center;gap:8px;">
      <button id="tradeBackHome" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
      <h2 style="color:#C5A258;font-size:18px;margin:0;">取引管理</h2>
    </div>
    <div style="display:flex;border-bottom:1px solid #dde0e6;background:#ffffff;position:sticky;top:0;z-index:10;">
      ${tabsHtml}
    </div>
    ${searchHtml}
    ${actionHtml}
    <div id="tradeCards" style="padding:0 12px 80px;display:flex;flex-direction:column;gap:10px;">
      ${cardsHtml}
    </div>`;

  // ホームへ戻る
  _container.querySelector('#tradeBackHome')?.addEventListener('click', () => {
    navigate('home');
  });

  // イベントリスナー
  _container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      showLoading(_container);
      loadAndRender();
    });
  });

  const searchInput = _container.querySelector('#tradeSearch');
  if (searchInput) {
    let debounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        _searchQuery = searchInput.value.trim();
        loadAndRender();
      }, 400);
    });
  }

  const btnSalesImport = _container.querySelector('#btnSalesImport');
  if (btnSalesImport) btnSalesImport.addEventListener('click', handleSalesImport);

  const btnOcr = _container.querySelector('#btnOcrTransaction');
  if (btnOcr) btnOcr.addEventListener('click', handleTransactionOcr);

  const btnCsv = _container.querySelector('#btnEhidenCsv');
  if (btnCsv) btnCsv.addEventListener('click', handleEhidenCsvExport);

  // カードのクリックイベント
  _container.querySelectorAll('[data-mgmt]').forEach(card => {
    card.addEventListener('click', async () => {
      const mgmtNum = card.dataset.mgmt;
      const item = _items.find(i => i.mgmt_num === mgmtNum);
      if (item) renderDetail(item);
    });
  });
}

// ---------------------------------------------------------------------------
// 商品カード
// ---------------------------------------------------------------------------

function renderItemCard(item) {
  const profit = item.gross_profit != null ? formatPrice(item.gross_profit) : '';
  const profitColor = item.gross_profit > 0 ? '#006B3F' : item.gross_profit < 0 ? '#CE2029' : '#5a6272';

  const carrierLabel = item.carrier || '';
  const trackingLabel = item.tracking_number ? `${item.tracking_number}` : '';

  return `
    <div data-mgmt="${escapeHtml(item.mgmt_num)}"
      style="background:#ffffff;border-radius:12px;padding:14px;border:1px solid #dde0e6;cursor:pointer;transition:transform 0.15s;"
      ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform=''">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="color:#C5A258;font-size:12px;font-weight:bold;">${escapeHtml(item.mgmt_num)}</span>
        ${statusBadge(item.status)}
      </div>
      <div style="color:#1C2541;font-size:14px;font-weight:bold;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${escapeHtml(item.product_name)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#5a6272;">
        <span>${escapeHtml(item.channel_name || '')}${item.listing_account ? ' / ' + escapeHtml(item.listing_account) : ''}</span>
        <span style="color:#1C2541;font-weight:bold;">${item.sold_price ? formatPrice(item.sold_price) : ''}</span>
      </div>
      ${carrierLabel || trackingLabel ? `
        <div style="margin-top:4px;font-size:11px;color:#5a6272;">
          ${carrierLabel ? '🚚 ' + escapeHtml(carrierLabel) : ''}
          ${trackingLabel ? ' ' + escapeHtml(trackingLabel) : ''}
        </div>` : ''}
      ${profit ? `
        <div style="margin-top:4px;font-size:11px;color:${profitColor};text-align:right;">
          粗利: ${profit}
        </div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// 詳細画面
// ---------------------------------------------------------------------------

function renderDetail(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';
  const next = NEXT_STATUS[item.status];
  const isTrouble = TROUBLE_STATUSES.includes(item.status);

  // 利益計算表示
  const soldPrice = item.sold_price || 0;
  const platformFee = item.platform_fee || 0;
  const shippingCost = item.shipping_cost || 0;
  const packingCost = item.packing_cost || 0;
  const acquisitionCost = item.acquisition_cost || 0;
  const grossProfit = soldPrice - platformFee - shippingCost - packingCost - acquisitionCost;

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <!-- ヘッダー -->
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBack" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;">
          <span style="color:#C5A258;font-size:13px;font-weight:bold;">${escapeHtml(item.mgmt_num)}</span>
        </div>
        <div style="width:40px;"></div>
      </div>

      <!-- ステータス -->
      <div style="text-align:center;margin-bottom:16px;">
        ${statusBadge(item.status)}
        ${isTrouble ? '<div style="color:#CE2029;font-size:11px;margin-top:4px;">⚠ トラブル対応中</div>' : ''}
      </div>

      <!-- 商品情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#1C2541;font-size:16px;font-weight:bold;margin-bottom:8px;">${escapeHtml(item.product_name)}</div>
        ${item.main_photo_url ? `<img src="${escapeHtml(item.main_photo_url)}" style="width:100%;border-radius:8px;margin-bottom:8px;max-height:200px;object-fit:cover;">` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">
          ${detailRow('チャンネル', item.channel_name)}
          ${detailRow('アカウント', item.listing_account)}
          ${detailRow('メーカー', item.maker)}
          ${detailRow('状態', item.condition ? CONFIG.CONDITIONS[item.condition] || item.condition : '')}
          ${item.operation_status ? detailRow('動作', CONFIG.OPERATION_STATUS.find(s => s.id === item.operation_status)?.label || item.operation_status) : ''}
          ${detailRow('サイズ区分', item.size_category)}
          ${detailRow('保管場所', item.location)}
        </div>
      </div>

      <!-- 売上・コスト -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">💰 売上・コスト</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">
          ${detailRow('落札価格', formatPrice(soldPrice))}
          ${detailRow('手数料', formatPrice(platformFee))}
          ${detailRow('送料', formatPrice(shippingCost))}
          ${detailRow('梱包費', formatPrice(packingCost))}
          ${detailRow('仕入原価', formatPrice(acquisitionCost))}
        </div>
        <div style="border-top:1px solid #dde0e6;margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;">
          <span style="color:#5a6272;font-size:13px;">粗利</span>
          <span style="color:${grossProfit > 0 ? '#006B3F' : grossProfit < 0 ? '#CE2029' : '#5a6272'};font-size:16px;font-weight:bold;">${formatPrice(grossProfit)}</span>
        </div>
      </div>

      <!-- 委託販売情報 -->
      ${item.consignment_partner ? (() => {
        const cRate = item.commission_rate || 0;
        const cPartner = item.consignment_partner;
        const isFixed = cPartner === 'ビッグスポーツ';
        const tkbShare = soldPrice > 0 ? Math.round(soldPrice * cRate / 100) : 0;
        const partnerShare = soldPrice > 0 ? soldPrice - tkbShare : 0;
        const tkbAfterFee = tkbShare - platformFee;
        return `
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #C5A25833;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">🤝 委託販売情報</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">
          ${detailRow('委託先', cPartner)}
          ${detailRow('手数料率', isFixed ? '50:50（固定）' : cRate + '%（テイクバック取り分）')}
          ${detailRow('返却状態', item.return_status || '—')}
          ${item.return_reason ? detailRow('返却理由', item.return_reason) : ''}
        </div>
        ${soldPrice > 0 ? `
        <div style="border-top:1px solid #dde0e6;margin-top:10px;padding-top:10px;">
          <div style="color:#C5A258;font-size:12px;font-weight:bold;margin-bottom:8px;">利益分配</div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
            <div style="display:flex;justify-content:space-between;"><span style="color:#5a6272;">落札価格</span><span style="color:#1C2541;">${formatPrice(soldPrice)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#5a6272;">テイクバック取り分 (${cRate}%)</span><span style="color:#1C2541;">${formatPrice(tkbShare)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#5a6272;">ヤフオク手数料</span><span style="color:#CE2029;">-${formatPrice(platformFee)}</span></div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid #dde0e6;padding-top:4px;margin-top:4px;"><span style="color:#5a6272;font-weight:bold;">テイクバック実利益</span><span style="color:${tkbAfterFee > 0 ? '#006B3F' : '#CE2029'};font-weight:bold;">${formatPrice(tkbAfterFee)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#5a6272;font-weight:bold;">委託元支払い</span><span style="color:#1C2541;font-weight:bold;">${formatPrice(partnerShare)}</span></div>
          </div>
        </div>
        ` : ''}
      </div>`;
      })() : ''}

      <!-- 出荷情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">🚚 出荷情報</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">
          ${detailRow('運送会社', item.carrier)}
          ${detailRow('追跡番号', item.tracking_number)}
          ${detailRow('梱包担当', item.packed_by)}
          ${detailRow('梱包時間', item.packing_seconds ? formatDuration(item.packing_seconds) : '')}
          ${detailRow('発送日', formatDate(item.shipped_at))}
          ${detailRow('完了日', formatDate(item.completed_at))}
        </div>
      </div>

      <!-- リードタイム -->
      ${renderLeadTimes(item)}

      <!-- 工程履歴 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">📋 工程履歴</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">
          ${detailRow('分荷', `${item.judged_by || ''} ${formatDate(item.judged_at)}`)}
          ${detailRow('撮影', `${item.photo_by || ''} ${formatDate(item.photo_at)}`)}
          ${detailRow('出品', `${item.listed_by || ''} ${formatDate(item.listed_at)}`)}
          ${detailRow('落札', formatDate(item.sold_at))}
          ${detailRow('入金', formatDate(item.paid_at))}
        </div>
      </div>

      ${item.memo ? `
        <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
          <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:6px;">📝 メモ</div>
          <div style="color:#4a4a5a;font-size:13px;white-space:pre-wrap;">${escapeHtml(item.memo)}</div>
        </div>` : ''}

      <!-- アクションボタン -->
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${next ? `<button id="btnNextStatus" style="padding:14px;border-radius:10px;background:#C5A258;color:#000;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
          ▶ ${next}に進める
        </button>` : ''}

        ${item.status === '梱包待ち' || item.status === '梱包中' ? `
          <button id="btnPacking" style="padding:14px;border-radius:10px;background:#c4356a;color:#fff;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
            📦 梱包作業を開始
          </button>` : ''}

        ${item.status === '梱包完了' ? `
          <button id="btnShipping" style="padding:14px;border-radius:10px;background:#00bcd4;color:#000;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
            🚚 出荷手続き
          </button>` : ''}

        ${item.status === '落札済み' || item.status === '連絡待ち' ? `
          <button id="btnOcrSales" style="padding:12px;border-radius:10px;background:#f0ede5;color:#C5A258;border:1px solid #C5A258;font-size:14px;font-weight:bold;cursor:pointer;">
            📸 取引ナビOCRで売上登録
          </button>` : ''}

        <button id="btnEditSales" style="padding:12px;border-radius:10px;background:#f0ede5;color:#1C2541;border:1px solid #dde0e6;font-size:14px;cursor:pointer;">
          ✏️ 売上情報を編集
        </button>

        ${item.consignment_partner && !item.return_status ? `
          <button id="btnReturn" style="padding:12px;border-radius:10px;background:#f0ede5;color:#C5A258;border:1px solid #C5A258;font-size:14px;cursor:pointer;">
            ↩ 委託元へ返却
          </button>` : ''}

        ${!isTrouble ? `
          <button id="btnTrouble" style="padding:12px;border-radius:10px;background:#f0ede5;color:#CE2029;border:1px solid #CE2029;font-size:14px;cursor:pointer;">
            ⚠ トラブル報告
          </button>` : `
          <button id="btnTroubleNext" style="padding:12px;border-radius:10px;background:#CE2029;color:#fff;border:none;font-size:14px;font-weight:bold;cursor:pointer;">
            ▶ トラブル: 次のステップへ
          </button>`}
      </div>

      <!-- 管理操作 -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #dde0e6;">
        <p style="color:#8a8a8a;font-size:11px;margin-bottom:8px;">管理操作</p>
        <div style="display:flex;gap:8px;">
          <button id="btnRevertStatus" style="flex:1;padding:10px;border-radius:8px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:13px;cursor:pointer;">
            ↩ ステータスを戻す
          </button>
          <button id="btnDeleteItem" style="flex:1;padding:10px;border-radius:8px;border:1px solid #CE2029;background:transparent;color:#CE2029;font-size:13px;cursor:pointer;">
            🗑 削除
          </button>
        </div>
      </div>
    </div>`;

  // イベント
  _container.querySelector('#btnBack').addEventListener('click', () => {
    showLoading(_container);
    loadAndRender();
  });

  const btnNext = _container.querySelector('#btnNextStatus');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      showConfirm(
        `「${item.product_name}」を\n「${next}」に進めますか？`,
        async () => {
          const extra = {};
          if (next === '入金確認済み') extra.paid_at = new Date().toISOString();
          if (next === '完了') extra.completed_at = new Date().toISOString();
          const updated = await db.updateItemStatus(item.mgmt_num, next, staffName, extra);
          if (updated) {
            showToast(`${next}に更新しました`);
            renderDetail(updated);
          } else {
            showToast('更新に失敗しました');
          }
        }
      );
    });
  }

  const btnPacking = _container.querySelector('#btnPacking');
  if (btnPacking) btnPacking.addEventListener('click', () => renderPackingScreen(item));

  const btnShipping = _container.querySelector('#btnShipping');
  if (btnShipping) btnShipping.addEventListener('click', () => renderShippingScreen(item));

  const btnOcrSales = _container.querySelector('#btnOcrSales');
  if (btnOcrSales) btnOcrSales.addEventListener('click', () => handleSalesOcr(item));

  const btnEditSales = _container.querySelector('#btnEditSales');
  if (btnEditSales) btnEditSales.addEventListener('click', () => renderSalesEditForm(item));

  const btnReturn = _container.querySelector('#btnReturn');
  if (btnReturn) btnReturn.addEventListener('click', () => renderReturnDialog(item));

  const btnTrouble = _container.querySelector('#btnTrouble');
  if (btnTrouble) btnTrouble.addEventListener('click', () => renderTroubleScreen(item));

  const btnTroubleNext = _container.querySelector('#btnTroubleNext');
  if (btnTroubleNext) btnTroubleNext.addEventListener('click', () => handleTroubleNext(item));

  // ステータスを戻す
  _container.querySelector('#btnRevertStatus').addEventListener('click', () => {
    const revertOptions = {
      '出品中':     ['出品待ち'],
      '落札済み':   ['出品中'],
      '連絡待ち':   ['落札済み'],
      '送料連絡済み': ['連絡待ち'],
      '入金待ち':   ['落札済み'],
      '入金確認済み': ['入金待ち'],
      '梱包待ち':   ['入金確認済み'],
      '梱包中':     ['梱包待ち'],
      '梱包完了':   ['梱包中', '梱包待ち'],
      '発送済み':   ['梱包完了'],
      '受取確認':   ['発送済み'],
      '完了':       ['発送済み'],
    };
    const options = revertOptions[item.status] || [];
    if (options.length === 0) {
      showToast('このステータスから戻せる先がありません');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,37,65,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#ffffff;border-radius:16px;padding:24px;max-width:320px;width:100%;">
        <h3 style="color:#C5A258;font-size:16px;margin:0 0 16px;">↩ ステータスを戻す</h3>
        <p style="color:#5a6272;font-size:12px;margin-bottom:12px;">現在: ${escapeHtml(item.status)}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${options.map(s => `
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
        showConfirm(
          `ステータスを「${newStatus}」に戻しますか？`,
          async () => {
            const updated = await db.updateItemStatus(item.mgmt_num, newStatus, staffName);
            if (updated) {
              showToast(`ステータスを「${newStatus}」に戻しました`);
              renderDetail(updated);
            } else {
              showToast('更新に失敗しました');
            }
          }
        );
      });
    });
  });

  // 商品を削除
  _container.querySelector('#btnDeleteItem').addEventListener('click', () => {
    showConfirm(`「${item.mgmt_num}」を削除しますか？\nこの操作は取り消せません。`, async () => {
      const dbClient = db.getDB();
      if (!dbClient) { showToast('DB接続エラー'); return; }
      const { error } = await dbClient.from('items').delete().eq('mgmt_num', item.mgmt_num);
      if (error) {
        console.error('Delete error:', error);
        showToast('削除に失敗しました');
      } else {
        showToast('商品を削除しました');
        showLoading(_container);
        loadAndRender();
      }
    });
  });
}

function detailRow(label, value) {
  return `
    <div style="color:#5a6272;">${label}</div>
    <div style="color:#1C2541;">${escapeHtml(String(value || '—'))}</div>`;
}

// ---------------------------------------------------------------------------
// 取引ナビ OCR（スクリーンショットから取引情報を取得）
// ---------------------------------------------------------------------------

async function handleTransactionOcr() {
  try {
    const file = await capturePhoto();
    if (!file) return;

    showLoading(_container, 'OCR解析中...');
    const base64 = await fileToBase64(file);
    const resized = await resizeImage(base64, 1600);

    const response = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
      },
      body: JSON.stringify({
        image: resized,
        step: 'receipt',
        context: {
          task: 'この取引画面のスクリーンショットから情報をJSON形式で読み取ってください: {"itemName":"商品名","price":落札価格数値,"fee":手数料数値,"shipping":送料数値,"buyer":"落札者ID","mgmtNum":"管理番号（あれば）"}',
        },
      }),
    });

    if (!response.ok) throw new Error(`OCR API error: ${response.status}`);
    const result = await response.json();

    if (!result.success) {
      showToast(result.error || 'OCR解析に失敗しました');
      await loadAndRender();
      return;
    }

    renderOcrResult(result.judgment || result.data);
  } catch (err) {
    console.error('Transaction OCR error:', err);
    showToast('OCR処理中にエラーが発生しました');
    await loadAndRender();
  }
}

function renderOcrResult(data) {
  const staffName = getCurrentStaff()?.name || '';

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBackOcr" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;color:#C5A258;font-size:15px;font-weight:bold;">OCR解析結果</div>
        <div style="width:40px;"></div>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">📋 取引情報</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${ocrField('管理番号', 'ocrMgmtNum', data.mgmt_num || '')}
          ${ocrField('商品名', 'ocrProductName', data.product_name || '')}
          ${ocrField('落札価格', 'ocrSoldPrice', data.sold_price || '')}
          ${ocrField('落札者', 'ocrBuyerName', data.buyer_name || '')}
          ${ocrField('落札者住所', 'ocrBuyerAddr', data.buyer_address || '')}
          ${ocrField('落札者TEL', 'ocrBuyerTel', data.buyer_tel || '')}
          ${ocrField('ステータス', 'ocrStatus', data.status || '落札済み')}
          ${ocrField('手数料', 'ocrFee', data.platform_fee || '')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="btnApplyOcr" style="padding:14px;border-radius:10px;background:#C5A258;color:#000;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
          ✅ この内容で登録・更新
        </button>
        <button id="btnRetakeOcr" style="padding:12px;border-radius:10px;background:#f0ede5;color:#1C2541;border:1px solid #dde0e6;font-size:14px;cursor:pointer;">
          📸 撮り直し
        </button>
      </div>
    </div>`;

  _container.querySelector('#btnBackOcr').addEventListener('click', () => {
    showLoading(_container);
    loadAndRender();
  });

  _container.querySelector('#btnRetakeOcr').addEventListener('click', handleTransactionOcr);

  _container.querySelector('#btnApplyOcr').addEventListener('click', async () => {
    const mgmtNum = _container.querySelector('#ocrMgmtNum').value.trim();
    if (!mgmtNum) { showToast('管理番号を入力してください'); return; }

    const soldPrice = parseInt(_container.querySelector('#ocrSoldPrice').value) || 0;
    const fee = parseInt(_container.querySelector('#ocrFee').value) || 0;
    const statusVal = _container.querySelector('#ocrStatus').value.trim() || '落札済み';

    showLoading(_container, '更新中...');

    const existing = await db.getItem(mgmtNum);
    if (!existing) {
      showToast(`管理番号 ${mgmtNum} が見つかりません`);
      await loadAndRender();
      return;
    }

    const updates = {
      sold_price: soldPrice || existing.sold_price,
      platform_fee: fee || existing.platform_fee,
      sold_at: existing.sold_at || new Date().toISOString(),
    };

    // ステータス更新
    if (statusVal && TRADE_STATUSES.includes(statusVal) && statusVal !== existing.status) {
      await db.updateItemStatus(mgmtNum, statusVal, staffName, updates);
    } else {
      await db.updateItem(mgmtNum, updates);
    }

    // 売上レコード作成
    if (soldPrice > 0 && !existing.sold_price) {
      await db.createSale({
        item_id: existing.id,
        mgmt_num: mgmtNum,
        sold_price: soldPrice,
        platform: existing.platform || '',
        account_name: existing.listing_account || '',
        platform_fee: fee,
        gross_profit: soldPrice - fee - (existing.shipping_cost || 0) - (existing.packing_cost || 0) - (existing.acquisition_cost || 0),
        recorded_by: staffName,
      });
    }

    showToast('取引情報を更新しました');
    await loadAndRender();
  });
}

function ocrField(label, id, value) {
  return `
    <div>
      <label style="color:#5a6272;font-size:11px;display:block;margin-bottom:2px;">${label}</label>
      <input id="${id}" type="text" value="${escapeHtml(String(value))}"
        style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;box-sizing:border-box;">
    </div>`;
}

// ---------------------------------------------------------------------------
// 売上情報OCR（詳細画面から）
// ---------------------------------------------------------------------------

async function handleSalesOcr(item) {
  try {
    const file = await capturePhoto();
    if (!file) return;

    showLoading(_container, 'OCR解析中...');
    const base64 = await fileToBase64(file);
    const resized = await resizeImage(base64, 1600);

    const response = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
      },
      body: JSON.stringify({
        image: resized,
        step: 'receipt',
        context: {
          task: 'この取引画面のスクリーンショットから情報をJSON形式で読み取ってください: {"itemName":"商品名","price":落札価格数値,"fee":手数料数値,"shipping":送料数値,"buyer":"落札者ID","mgmtNum":"管理番号（あれば）"}',
        },
      }),
    });

    if (!response.ok) throw new Error(`OCR API error: ${response.status}`);
    const result = await response.json();

    if (!result.success) {
      showToast(result.error || 'OCR解析に失敗しました');
      renderDetail(item);
      return;
    }

    // OCR結果を売上編集フォームに反映
    const ocrData = result.judgment || result.data;
    renderSalesEditForm(item, {
      sold_price: ocrData.sold_price || item.sold_price,
      platform_fee: ocrData.platform_fee || item.platform_fee,
    });
  } catch (err) {
    console.error('Sales OCR error:', err);
    showToast('OCR処理中にエラーが発生しました');
    renderDetail(item);
  }
}

// ---------------------------------------------------------------------------
// 売上情報編集フォーム
// ---------------------------------------------------------------------------

function renderSalesEditForm(item, prefill = {}) {
  const staffName = getCurrentStaff()?.name || '';
  const soldPrice = prefill.sold_price || item.sold_price || 0;
  const platformFee = prefill.platform_fee || item.platform_fee || 0;
  const shippingCost = item.shipping_cost || 0;
  const packingCost = item.packing_cost || 0;
  const acquisitionCost = item.acquisition_cost || 0;

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBackEdit" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;color:#C5A258;font-size:15px;font-weight:bold;">売上情報編集</div>
        <div style="width:40px;"></div>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#1C2541;font-size:14px;font-weight:bold;margin-bottom:4px;">${escapeHtml(item.mgmt_num)} ${escapeHtml(item.product_name)}</div>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">落札価格</label>
            <input id="editSoldPrice" type="number" inputmode="numeric" value="${soldPrice}"
              style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">手数料</label>
            <input id="editPlatformFee" type="number" inputmode="numeric" value="${platformFee}"
              style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">送料</label>
            <input id="editShippingCost" type="number" inputmode="numeric" value="${shippingCost}"
              style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">梱包費</label>
            <input id="editPackingCost" type="number" inputmode="numeric" value="${packingCost}"
              style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">仕入原価</label>
            <input id="editAcqCost" type="number" inputmode="numeric" value="${acquisitionCost}"
              style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
          </div>

          <div style="border-top:1px solid #dde0e6;padding-top:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#5a6272;font-size:13px;">粗利（自動計算）</span>
              <span id="editGrossProfit" style="color:#006B3F;font-size:18px;font-weight:bold;">—</span>
            </div>
          </div>
        </div>
      </div>

      <button id="btnSaveSales" style="width:100%;padding:14px;border-radius:10px;background:#C5A258;color:#000;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
        💾 保存
      </button>
    </div>`;

  // 粗利自動計算
  const inputs = ['editSoldPrice', 'editPlatformFee', 'editShippingCost', 'editPackingCost', 'editAcqCost'];
  const calcProfit = () => {
    const sp = parseInt(_container.querySelector('#editSoldPrice').value) || 0;
    const pf = parseInt(_container.querySelector('#editPlatformFee').value) || 0;
    const sc = parseInt(_container.querySelector('#editShippingCost').value) || 0;
    const pc = parseInt(_container.querySelector('#editPackingCost').value) || 0;
    const ac = parseInt(_container.querySelector('#editAcqCost').value) || 0;
    const gp = sp - pf - sc - pc - ac;
    const el = _container.querySelector('#editGrossProfit');
    if (el) {
      el.textContent = formatPrice(gp);
      el.style.color = gp > 0 ? '#006B3F' : gp < 0 ? '#CE2029' : '#5a6272';
    }
  };
  inputs.forEach(id => {
    const el = _container.querySelector(`#${id}`);
    if (el) el.addEventListener('input', calcProfit);
  });
  calcProfit();

  _container.querySelector('#btnBackEdit').addEventListener('click', () => renderDetail(item));

  _container.querySelector('#btnSaveSales').addEventListener('click', async () => {
    const sp = parseInt(_container.querySelector('#editSoldPrice').value) || 0;
    const pf = parseInt(_container.querySelector('#editPlatformFee').value) || 0;
    const sc = parseInt(_container.querySelector('#editShippingCost').value) || 0;
    const pc = parseInt(_container.querySelector('#editPackingCost').value) || 0;
    const ac = parseInt(_container.querySelector('#editAcqCost').value) || 0;
    const gp = sp - pf - sc - pc - ac;

    showLoading(_container, '保存中...');

    const updates = {
      sold_price: sp,
      platform_fee: pf,
      shipping_cost: sc,
      packing_cost: pc,
      acquisition_cost: ac,
      gross_profit: gp,
    };

    if (sp > 0 && !item.sold_at) {
      updates.sold_at = new Date().toISOString();
    }

    const updated = await db.updateItem(item.mgmt_num, updates);
    if (updated) {
      // 売上レコードも更新/作成
      if (sp > 0) {
        const existingSales = await db.getSales({ month: new Date().toISOString().slice(0, 7) });
        const existing = existingSales.find(s => s.mgmt_num === item.mgmt_num);
        if (!existing) {
          await db.createSale({
            item_id: item.id,
            mgmt_num: item.mgmt_num,
            sold_price: sp,
            platform: item.platform || '',
            account_name: item.listing_account || '',
            platform_fee: pf,
            shipping_cost: sc,
            gross_profit: gp,
            recorded_by: staffName,
          });
        }
      }
      showToast('売上情報を保存しました');
      renderDetail(updated);
    } else {
      showToast('保存に失敗しました');
      renderDetail(item);
    }
  });
}

// ---------------------------------------------------------------------------
// 梱包画面（タイマー付き）
// ---------------------------------------------------------------------------

function renderPackingScreen(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';

  // 梱包中でなければステータスを更新
  if (item.status === '梱包待ち') {
    db.updateItemStatus(item.mgmt_num, '梱包中', staffName).then(updated => {
      if (updated) item.status = '梱包中';
    });
  }

  _packingItem = item;
  _packingStart = Date.now();

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBackPack" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;color:#C5A258;font-size:15px;font-weight:bold;">梱包作業</div>
        <div style="width:40px;"></div>
      </div>

      <!-- 商品情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:12px;font-weight:bold;">${escapeHtml(item.mgmt_num)}</div>
        <div style="color:#1C2541;font-size:16px;font-weight:bold;margin-top:4px;">${escapeHtml(item.product_name)}</div>
        <div style="color:#5a6272;font-size:12px;margin-top:4px;">
          ${escapeHtml(item.size_category || '')} ${item.product_size ? '(' + escapeHtml(item.product_size) + ')' : ''}
          | ${escapeHtml(item.location || '')}
        </div>
      </div>

      <!-- タイマー -->
      <div style="background:#ffffff;border-radius:16px;padding:24px;margin-bottom:16px;text-align:center;border:2px solid #c4356a;">
        <div style="color:#c4356a;font-size:13px;font-weight:bold;margin-bottom:8px;">⏱ 梱包タイマー</div>
        <div id="packTimer" style="color:#1C2541;font-size:48px;font-weight:bold;font-family:monospace;">00:00</div>
        <div style="color:#5a6272;font-size:12px;margin-top:8px;">担当: ${escapeHtml(staffName)}</div>
      </div>

      <!-- 運送会社選択 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">🚚 運送会社</div>
        <div id="carrierGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          ${CONFIG.CARRIERS.map(c => `
            <button data-carrier="${escapeHtml(c.name)}"
              style="padding:10px 4px;border-radius:8px;border:1px solid #dde0e6;background:${item.carrier === c.name ? '#C5A258' : '#ffffff'};
              color:${item.carrier === c.name ? '#000' : '#e0e0e0'};font-size:12px;cursor:pointer;text-align:center;">
              ${escapeHtml(c.name)}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 梱包メモ -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">梱包メモ</label>
        <textarea id="packMemo" rows="3" placeholder="梱包の注意点、使用資材など"
          style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
      </div>

      <!-- 完了ボタン -->
      <button id="btnPackComplete" style="width:100%;padding:16px;border-radius:12px;background:#006B3F;color:#fff;border:none;font-size:16px;font-weight:bold;cursor:pointer;">
        ✅ 梱包完了
      </button>
    </div>`;

  // タイマー開始
  let selectedCarrier = item.carrier || '';
  const timerEl = _container.querySelector('#packTimer');
  if (_packingTimerId) clearInterval(_packingTimerId);
  _packingTimerId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _packingStart) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);

  // 運送会社選択
  _container.querySelectorAll('[data-carrier]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCarrier = btn.dataset.carrier;
      _container.querySelectorAll('[data-carrier]').forEach(b => {
        const isActive = b.dataset.carrier === selectedCarrier;
        b.style.background = isActive ? '#C5A258' : '#ffffff';
        b.style.color = isActive ? '#000' : '#e0e0e0';
      });
    });
  });

  // 戻るボタン
  _container.querySelector('#btnBackPack').addEventListener('click', () => {
    showConfirm('梱包作業を中断しますか？\nタイマーはリセットされます。', () => {
      if (_packingTimerId) { clearInterval(_packingTimerId); _packingTimerId = null; }
      renderDetail(item);
    });
  });

  // 完了ボタン
  _container.querySelector('#btnPackComplete').addEventListener('click', async () => {
    if (!selectedCarrier) {
      showToast('運送会社を選択してください');
      return;
    }

    if (_packingTimerId) { clearInterval(_packingTimerId); _packingTimerId = null; }
    const elapsed = Math.floor((Date.now() - _packingStart) / 1000);
    const memo = _container.querySelector('#packMemo')?.value.trim() || '';

    showLoading(_container, '梱包完了処理中...');

    const updates = {
      carrier: selectedCarrier,
      packed_by: staffName,
      packed_at: new Date().toISOString(),
      packing_seconds: elapsed,
    };
    if (memo) updates.memo = (item.memo ? item.memo + '\n' : '') + `[梱包] ${memo}`;

    const updated = await db.updateItemStatus(item.mgmt_num, '梱包完了', staffName, updates);

    // 作業ログ
    await db.logWork({
      staff_name: staffName,
      work_type: '梱包',
      mgmt_num: item.mgmt_num,
      duration_seconds: elapsed,
      note: `${selectedCarrier} ${memo}`,
    });

    if (updated) {
      showToast(`梱包完了 (${formatDuration(elapsed)})`);
      renderDetail(updated);
    } else {
      showToast('更新に失敗しました');
      await loadAndRender();
    }
  });
}

// ---------------------------------------------------------------------------
// 出荷画面（運送会社・追跡番号・E飛伝CSV）
// ---------------------------------------------------------------------------

function renderShippingScreen(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBackShip" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;color:#C5A258;font-size:15px;font-weight:bold;">出荷手続き</div>
        <div style="width:40px;"></div>
      </div>

      <!-- 商品情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="color:#C5A258;font-size:12px;font-weight:bold;">${escapeHtml(item.mgmt_num)}</div>
            <div style="color:#1C2541;font-size:14px;font-weight:bold;margin-top:2px;">${escapeHtml(item.product_name)}</div>
          </div>
          ${statusBadge(item.status)}
        </div>
      </div>

      <!-- 運送会社 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">🚚 運送会社</div>
        <div id="shipCarrierGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          ${CONFIG.CARRIERS.map(c => `
            <button data-carrier="${escapeHtml(c.name)}"
              style="padding:10px 4px;border-radius:8px;border:1px solid #dde0e6;background:${item.carrier === c.name ? '#C5A258' : '#ffffff'};
              color:${item.carrier === c.name ? '#000' : '#e0e0e0'};font-size:12px;cursor:pointer;text-align:center;">
              ${escapeHtml(c.name)}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 追跡番号 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#C5A258;font-size:13px;font-weight:bold;margin-bottom:10px;">📄 追跡番号</div>
        <input id="shipTracking" type="text" inputmode="numeric" placeholder="追跡番号を入力"
          value="${escapeHtml(item.tracking_number || '')}"
          style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;margin-bottom:8px;">
        <button id="btnOcrTracking" style="width:100%;padding:10px;border-radius:8px;background:#f0ede5;color:#C5A258;border:1px solid #C5A258;font-size:13px;font-weight:bold;cursor:pointer;">
          📸 送り状を撮影してOCR
        </button>
      </div>

      <!-- 配送先 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">配送先地域</label>
        <select id="shipRegion" style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:15px;box-sizing:border-box;margin-bottom:8px;">
          <option value="">選択してください</option>
          <option value="北海道">北海道</option>
          <option value="北東北">北東北（青森・秋田・岩手）</option>
          <option value="南東北">南東北（宮城・山形・福島）</option>
          <option value="関東">関東（茨城〜神奈川・山梨）</option>
          <option value="信越">信越（長野・新潟）</option>
          <option value="東海">東海（静岡・愛知・岐阜・三重）</option>
          <option value="北陸">北陸（富山・石川・福井）</option>
          <option value="関西">関西（京都〜兵庫・和歌山）</option>
          <option value="中国">中国（岡山〜島根）</option>
          <option value="四国">四国</option>
          <option value="北九州">北九州（福岡〜大分）</option>
          <option value="南九州">南九州（熊本・宮崎・鹿児島）</option>
          <option value="沖縄">沖縄・離島</option>
          <option value="直接引取">直接引取</option>
        </select>
        <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">送料</label>
        <input id="shipCost" type="number" inputmode="numeric" placeholder="送料"
          value="${item.shipping_cost || ''}"
          style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:16px;box-sizing:border-box;">
      </div>

      <!-- 出荷完了 -->
      <button id="btnShipComplete" style="width:100%;padding:16px;border-radius:12px;background:#00bcd4;color:#000;border:none;font-size:16px;font-weight:bold;cursor:pointer;">
        🚀 発送完了
      </button>
    </div>`;

  let selectedCarrier = item.carrier || '';

  // 運送会社選択
  _container.querySelectorAll('#shipCarrierGrid [data-carrier]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCarrier = btn.dataset.carrier;
      _container.querySelectorAll('#shipCarrierGrid [data-carrier]').forEach(b => {
        const isActive = b.dataset.carrier === selectedCarrier;
        b.style.background = isActive ? '#C5A258' : '#ffffff';
        b.style.color = isActive ? '#000' : '#e0e0e0';
      });
    });
  });

  // 戻る
  _container.querySelector('#btnBackShip').addEventListener('click', () => renderDetail(item));

  // 追跡番号OCR
  _container.querySelector('#btnOcrTracking').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;

      showToast('OCR解析中...');
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 1600);

      const response = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        },
        body: JSON.stringify({
          image: resized,
          step: 'receipt',
          context: {
            task: 'この送り状の写真から追跡番号と運送会社を読み取ってJSON形式で返してください: {"tracking_number":"追跡番号","carrier":"運送会社名"}',
          },
        }),
      });

      if (!response.ok) throw new Error(`OCR error: ${response.status}`);
      const result = await response.json();
      const ocrData = result.judgment || result.data || {};

      if (result.success && ocrData.tracking_number) {
        const trackingInput = _container.querySelector('#shipTracking');
        if (trackingInput) trackingInput.value = ocrData.tracking_number;
        if (ocrData.carrier) {
          selectedCarrier = result.data.carrier;
          _container.querySelectorAll('#shipCarrierGrid [data-carrier]').forEach(b => {
            const isActive = b.dataset.carrier === selectedCarrier;
            b.style.background = isActive ? '#C5A258' : '#ffffff';
            b.style.color = isActive ? '#000' : '#e0e0e0';
          });
        }
        showToast('追跡番号を取得しました');
      } else {
        showToast('追跡番号を読み取れませんでした');
      }
    } catch (err) {
      console.error('Tracking OCR error:', err);
      showToast('OCR処理中にエラーが発生しました');
    }
  });

  // 地域選択で送料を自動計算
  _container.querySelector('#shipRegion').addEventListener('change', (e) => {
    const region = e.target.value;
    if (!region || region === '直接引取') return;
    const regionIndex = CONFIG.SAGAWA_RATES.regions.indexOf(region);
    if (regionIndex === -1) return;
    // itemのサイズから送料を算出（shippingSizeがなければ60）
    const size = parseInt(item.product_size) || 60;
    const sizes = CONFIG.SAGAWA_RATES.sizes;
    let matchSize = sizes[0];
    for (const s of sizes) {
      if (size <= s) { matchSize = s; break; }
      matchSize = s;
    }
    const rate = CONFIG.SAGAWA_RATES.rates[matchSize];
    if (rate && rate[regionIndex] != null) {
      _container.querySelector('#shipCost').value = rate[regionIndex];
    }
  });

  // 出荷完了
  _container.querySelector('#btnShipComplete').addEventListener('click', async () => {
    const tracking = _container.querySelector('#shipTracking').value.trim();
    const cost = parseInt(_container.querySelector('#shipCost').value) || 0;
    const region = _container.querySelector('#shipRegion').value;

    if (!selectedCarrier) { showToast('運送会社を選択してください'); return; }
    if (selectedCarrier !== '直接引き取り' && selectedCarrier !== '後日発送' && !tracking) {
      showToast('追跡番号を入力してください');
      return;
    }

    showConfirm(`${escapeHtml(selectedCarrier)}で発送完了にしますか？`, async () => {
      showLoading(_container, '出荷処理中...');

      const updates = {
        carrier: selectedCarrier,
        tracking_number: tracking,
        shipping_cost: cost,
        shipping_region: region,
        shipped_at: new Date().toISOString(),
      };

      // 粗利再計算
      const sp = item.sold_price || 0;
      const pf = item.platform_fee || 0;
      const pc = item.packing_cost || 0;
      const ac = item.acquisition_cost || 0;
      updates.gross_profit = sp - pf - cost - pc - ac;

      const updated = await db.updateItemStatus(item.mgmt_num, '発送済み', staffName, updates);

      // 作業ログ
      await db.logWork({
        staff_name: staffName,
        work_type: '出荷',
        mgmt_num: item.mgmt_num,
        duration_seconds: 0,
        note: `${selectedCarrier} ${tracking}`,
      });

      if (updated) {
        showToast('発送完了しました');
        renderDetail(updated);
      } else {
        showToast('更新に失敗しました');
        await loadAndRender();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// E飛伝CSV エクスポート（佐川急便）
// ---------------------------------------------------------------------------

async function handleEhidenCsvExport() {
  // 梱包完了＋佐川急便の商品を抽出
  const items = await db.getItems({ status: '梱包完了' });
  const sagawaItems = items.filter(i => i.carrier === '佐川急便');

  if (sagawaItems.length === 0) {
    showToast('佐川急便で梱包完了の商品がありません');
    return;
  }

  showConfirm(`佐川急便 ${sagawaItems.length}件のE飛伝CSVをダウンロードしますか？`, () => {
    const csv = generateEhidenCsv(sagawaItems);
    downloadCsv(csv, `ehiden_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`${sagawaItems.length}件のCSVをダウンロードしました`);
  });
}

function generateEhidenCsv(items) {
  const S = CONFIG.SENDER;

  // E飛伝II CSV フォーマット
  // ヘッダー行
  const headers = [
    'お届け先電話番号', 'お届け先郵便番号', 'お届け先住所1', 'お届け先住所2',
    'お届け先名前1', 'お届け先名前2',
    'ご依頼主電話番号', 'ご依頼主郵便番号', 'ご依頼主住所1', 'ご依頼主住所2',
    'ご依頼主名前1', 'ご依頼主名前2',
    '品名1', '品名2', '品名3', '品名4', '品名5',
    '出荷個数', '便種（元着区分）', '便種（指定無1:時間帯2:日時）',
    '配達日', '配達時間帯',
    '荷送人コード', '指定なし',
    '元着区分', '保険金額', '保険金額印字', '指定なし2',
    '才数', '品名備考', '備考'
  ];

  const rows = items.map(item => {
    // お届け先情報は取引情報から（DBにない場合は空欄）
    // 実運用ではOCRで取得した buyer 情報がmemo等に保存される想定
    const cols = [
      '', // お届け先電話番号
      '', // お届け先郵便番号
      '', // お届け先住所1
      '', // お届け先住所2
      '', // お届け先名前1
      '', // お届け先名前2
      S.tel,           // ご依頼主電話番号
      S.zip,           // ご依頼主郵便番号
      S.addr1,         // ご依頼主住所1
      S.addr2,         // ご依頼主住所2
      S.name1,         // ご依頼主名前1
      '',              // ご依頼主名前2
      item.product_name ? item.product_name.substring(0, 20) : '', // 品名1
      item.mgmt_num || '', // 品名2（管理番号を入れる）
      '', // 品名3
      '', // 品名4
      '', // 品名5
      '1',  // 出荷個数
      '1',  // 便種（1:元払い）
      '1',  // 便種（1:指定なし）
      '',   // 配達日
      '',   // 配達時間帯
      '',   // 荷送人コード
      '',   // 指定なし
      '1',  // 元着区分（1:元払い）
      '',   // 保険金額
      '',   // 保険金額印字
      '',   // 指定なし2
      '',   // 才数
      '',   // 品名備考
      escapeForCsv(item.memo || ''),  // 備考
    ];
    return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
  });

  return '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n' + rows.join('\n');
}

function escapeForCsv(str) {
  return String(str).replace(/\r?\n/g, ' ').replace(/"/g, '""');
}

function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 委託返却フロー
// ---------------------------------------------------------------------------

function renderReturnDialog(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';
  const reasons = CONFIG.RETURN_REASONS || [
    { id: 'unsold', label: '売れ残り' },
    { id: 'fake', label: '偽物・返品' },
    { id: 'cant_list', label: '出品不可' },
    { id: 'partner_request', label: '委託元依頼' },
  ];

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,37,65,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#ffffff;border-radius:16px;padding:24px;max-width:380px;width:100%;">
      <h3 style="color:#C5A258;font-size:16px;margin-bottom:4px;">↩ 委託元へ返却</h3>
      <p style="color:#5a6272;font-size:12px;margin-bottom:16px;">${escapeHtml(item.mgmt_num)} - ${escapeHtml(item.product_name)}</p>
      <p style="color:#5a6272;font-size:13px;margin-bottom:12px;">返却理由を選択してください</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${reasons.map((r, i) => `
          <button class="return-reason-btn" data-reason="${escapeHtml(r.label)}"
            style="padding:12px 16px;border-radius:8px;border:1px solid ${i === 0 ? '#ff9800' : '#dde0e6'};
            background:${i === 0 ? '#ff980022' : '#ffffff'};color:#1C2541;text-align:left;cursor:pointer;font-size:14px;">
            ${escapeHtml(r.label)}
          </button>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;">
        <button id="returnCancel" style="flex:1;padding:12px;border-radius:8px;background:#dde0e6;color:#4a4a5a;border:none;font-size:14px;cursor:pointer;">キャンセル</button>
        <button id="returnConfirm" style="flex:1;padding:12px;border-radius:8px;background:#ff9800;color:#000;border:none;font-size:14px;font-weight:bold;cursor:pointer;">返却確定</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedReason = reasons[0].label;

  overlay.querySelectorAll('.return-reason-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedReason = btn.dataset.reason;
      overlay.querySelectorAll('.return-reason-btn').forEach(b => {
        const isActive = b.dataset.reason === selectedReason;
        b.style.borderColor = isActive ? '#ff9800' : '#dde0e6';
        b.style.background = isActive ? '#ff980022' : '#ffffff';
      });
    });
  });

  overlay.querySelector('#returnCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#returnConfirm').addEventListener('click', async () => {
    overlay.remove();
    showLoading(_container, '返却処理中...');

    try {
      const updates = {
        return_status: '返却予定',
        return_reason: selectedReason,
        return_date: new Date().toISOString(),
        memo: (item.memo ? item.memo + '\n' : '') + `[返却 ${new Date().toLocaleString('ja-JP')}] ${selectedReason} - ${item.consignment_partner}`,
      };

      const updated = await db.updateItem(item.mgmt_num, updates);

      // ステータスログにも記録
      await db.logWork({
        staff_name: staffName,
        work_type: '委託返却',
        mgmt_num: item.mgmt_num,
        duration_seconds: 0,
        note: `${item.consignment_partner} - ${selectedReason}`,
      });

      if (updated) {
        showToast(`返却予定に設定しました: ${selectedReason}`);
        renderDetail(updated);
      } else {
        showToast('更新に失敗しました');
        renderDetail(item);
      }
    } catch (e) {
      console.error('返却処理エラー:', e);
      showToast('返却処理に失敗しました');
      renderDetail(item);
    }
  });
}

// ---------------------------------------------------------------------------
// トラブルフロー
// ---------------------------------------------------------------------------

function renderTroubleScreen(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';

  _container.innerHTML = `
    <div style="padding:12px;padding-bottom:100px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <button id="btnBackTrouble" style="background:none;border:none;color:#C5A258;font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
        <div style="flex:1;text-align:center;color:#CE2029;font-size:15px;font-weight:bold;">トラブル報告</div>
        <div style="width:40px;"></div>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #CE202944;">
        <div style="color:#C5A258;font-size:12px;font-weight:bold;">${escapeHtml(item.mgmt_num)}</div>
        <div style="color:#1C2541;font-size:14px;font-weight:bold;margin-top:4px;">${escapeHtml(item.product_name)}</div>
        <div style="margin-top:6px;">${statusBadge(item.status)}</div>
      </div>

      <!-- トラブル種別 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="color:#CE2029;font-size:13px;font-weight:bold;margin-bottom:10px;">⚠ トラブル種別</div>
        <div id="troubleTypes" style="display:flex;flex-direction:column;gap:8px;">
          ${troubleOption('商品問題連絡', '商品の破損・不良・相違', item)}
          ${troubleOption('運送会社相談中', '配送中の事故・遅延', item)}
          ${troubleOption('キャンセル処理', '落札者からのキャンセル', item)}
          ${troubleOption('返金処理', '返金対応が必要', item)}
        </div>
      </div>

      <!-- 詳細メモ -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #dde0e6;">
        <label style="color:#5a6272;font-size:12px;display:block;margin-bottom:4px;">トラブル内容（詳細）</label>
        <textarea id="troubleMemo" rows="4" placeholder="何が起きたか、経緯を記録してください"
          style="width:100%;padding:10px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
      </div>

      <button id="btnSubmitTrouble" style="width:100%;padding:14px;border-radius:10px;background:#CE2029;color:#fff;border:none;font-size:15px;font-weight:bold;cursor:pointer;">
        ⚠ トラブルとして記録
      </button>
    </div>`;

  let selectedTrouble = '商品問題連絡';

  _container.querySelectorAll('[data-trouble]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTrouble = btn.dataset.trouble;
      _container.querySelectorAll('[data-trouble]').forEach(b => {
        const isActive = b.dataset.trouble === selectedTrouble;
        b.style.borderColor = isActive ? '#CE2029' : '#dde0e6';
        b.style.background = isActive ? '#CE202922' : '#ffffff';
      });
    });
  });

  _container.querySelector('#btnBackTrouble').addEventListener('click', () => renderDetail(item));

  _container.querySelector('#btnSubmitTrouble').addEventListener('click', async () => {
    const memo = _container.querySelector('#troubleMemo')?.value.trim() || '';
    if (!memo) { showToast('トラブル内容を入力してください'); return; }

    showConfirm(`「${selectedTrouble}」として記録しますか？\n\n※ 浅野さんへの報告が必要です`, async () => {
      showLoading(_container, '記録中...');

      const memoText = (item.memo ? item.memo + '\n' : '') + `[トラブル ${new Date().toLocaleString('ja-JP')}] ${selectedTrouble}: ${memo}`;
      const updated = await db.updateItemStatus(item.mgmt_num, selectedTrouble, staffName, { memo: memoText });

      if (updated) {
        showToast('トラブルを記録しました');
        renderDetail(updated);
      } else {
        showToast('記録に失敗しました');
        renderDetail(item);
      }
    });
  });
}

function troubleOption(status, description, item) {
  const isFirst = status === '商品問題連絡';
  return `
    <button data-trouble="${status}"
      style="padding:12px;border-radius:8px;border:1px solid ${isFirst ? '#CE2029' : '#dde0e6'};
      background:${isFirst ? '#CE202922' : '#ffffff'};color:#1C2541;text-align:left;cursor:pointer;">
      <div style="font-size:14px;font-weight:bold;">${status}</div>
      <div style="font-size:11px;color:#5a6272;margin-top:2px;">${description}</div>
    </button>`;
}

async function handleTroubleNext(item) {
  const staff = getCurrentStaff();
  const staffName = staff?.name || '';
  const currentIdx = TROUBLE_FLOW.indexOf(item.status);

  if (currentIdx === -1 || currentIdx >= TROUBLE_FLOW.length - 1) {
    // トラブル最終ステップ or フロー外 → キャンセルで完了
    showConfirm('トラブル処理を完了してキャンセルにしますか？', async () => {
      showLoading(_container, '処理中...');
      const updated = await db.updateItemStatus(item.mgmt_num, 'キャンセル', staffName, {
        completed_at: new Date().toISOString(),
      });
      if (updated) {
        showToast('キャンセル処理が完了しました');
        renderDetail(updated);
      } else {
        showToast('更新に失敗しました');
        renderDetail(item);
      }
    });
    return;
  }

  const nextStatus = TROUBLE_FLOW[currentIdx + 1];
  showConfirm(`トラブル対応を「${nextStatus}」に進めますか？`, async () => {
    showLoading(_container, '更新中...');
    const updated = await db.updateItemStatus(item.mgmt_num, nextStatus, staffName);
    if (updated) {
      showToast(`${nextStatus}に更新しました`);
      renderDetail(updated);
    } else {
      showToast('更新に失敗しました');
      renderDetail(item);
    }
  });
}

// ---------------------------------------------------------------------------
// クリーンアップ
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 売上取込（スクショからAI読み取り → 一括ステータス更新）
// ---------------------------------------------------------------------------

async function handleSalesImport() {
  // スクショ撮影/選択
  let file;
  try {
    file = await capturePhoto();
    if (!file) return;
  } catch { return; }

  showLoading(_container, '📸 スクショを解析中...');

  try {
    const base64 = await fileToBase64(file);
    const resized = await resizeImage(base64, 1600);

    // Edge Functionでスクショ解析
    const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        'apikey': CONFIG.AWAI_KEY,
      },
      body: JSON.stringify({
        image: resized,
        step: 'sales_import',
        context: { task: 'sales_import' },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('売上取込 HTTP error:', res.status, errBody);
      throw new Error(`HTTP ${res.status}`);
    }
    const result = await res.json();

    // エラーレスポンスチェック
    if (result.error) {
      console.error('売上取込 API error:', result.error, result.detail);
      showToast(`読み取りエラー: ${result.error.slice(0, 50)}`);
      renderList();
      return;
    }

    // rawレスポンス（JSON抽出失敗）の場合
    if (!result.judgment && result.raw) {
      console.error('売上取込: JSON抽出失敗, raw:', result.raw?.slice(0, 200));
      showToast('スクショからデータを抽出できませんでした。別の画面を試してください');
      renderList();
      return;
    }

    const items = result.success && result.judgment
      ? (Array.isArray(result.judgment) ? result.judgment : [result.judgment])
      : [];

    // undefinedやnullを除外
    const validItems = items.filter(i => i && i.title);

    if (validItems.length === 0) {
      showToast('商品情報を読み取れませんでした。画面全体が写っているか確認してください');
      renderList();
      return;
    }

    renderSalesImportResult(validItems, resized);
  } catch (err) {
    console.error('売上取込エラー:', err);
    showToast('スクショの解析に失敗しました');
    renderList();
  }
}

/** 売上取込の解析結果画面 */
async function renderSalesImportResult(ocrItems, screenshotBase64) {
  const staff = getCurrentStaff();

  // ヤフオクステータス → アプリステータスのマッピング
  const YAHOO_STATUS_MAP = {
    '受取連絡がされました': '受取確認',
    '発送完了しました': '発送済み',
    '発送をしてください': '入金確認済み',
    '落札者からの入金待ちです': '入金待ち',
    '落札者からの連絡待ちです': '連絡待ち',
    '決済を確認してください': '入金確認済み',
    '送料を連絡してください': '落札済み',
    '取引メッセージがあります': null, // 個別判断
  };

  // 既に落札済み以降のステータス（重複チェック用）
  const ALREADY_SOLD_STATUSES = ['落札済み', '入金待ち', '連絡待ち', '入金確認済み', '発送済み', '受取確認', '完了'];

  // DBから商品名で照合
  for (const item of ocrItems) {
    item.matched = false;
    item.dbItem = null;
    item.newStatus = null;
    item.alreadyImported = false; // 重複フラグ

    // ヤフオクステータスからアプリステータスを決定
    if (item.yahooStatus) {
      item.newStatus = YAHOO_STATUS_MAP[item.yahooStatus] || '落札済み';
    } else {
      item.newStatus = '落札済み';
    }

    // 商品タイトルでDB検索（複数戦略で照合）
    if (item.title) {
      // スタッフマーク・記号を除去してキーワード抽出
      const cleanTitle = item.title.replace(/[〇◇▽☆◎□♦◆●■★◈△▲▼♢♠♣♥♤♧♡♩♪♫♬]/g, '')
        .replace(/[｜|／/◇]/g, ' ')
        .replace(/【[^】]*】/g, ' ')
        .trim();

      // 戦略1: listing_title完全一致（最も確実）
      const dbClient = db.getDB();
      if (dbClient) {
        const { data } = await dbClient.from('items')
          .select('*')
          .eq('listing_title', item.title)
          .limit(1);
        if (data && data.length > 0) {
          item.matched = true;
          item.dbItem = data[0];
        }
      }

      // 戦略2: listing_title部分一致
      if (!item.matched && dbClient) {
        const { data } = await dbClient.from('items')
          .select('*')
          .ilike('listing_title', `%${cleanTitle.slice(0, 20)}%`)
          .limit(10);
        if (data && data.length > 0) {
          // 価格で絞り込み
          if (data.length > 1 && item.price) {
            const priceMatch = data.find(c =>
              c.start_price === parseInt(item.price) ||
              c.sold_price === parseInt(item.price)
            );
            if (priceMatch) {
              item.matched = true;
              item.dbItem = priceMatch;
            }
          }
          if (!item.matched) {
            item.matched = true;
            item.dbItem = data[0];
          }
        }
      }

      // 戦略3: 商品名で全文検索
      if (!item.matched) {
        const searchTerms = cleanTitle.slice(0, 20);
        let candidates = await db.getItems({ search: searchTerms, limit: 10 });

        if (candidates.length === 0) {
          const words = cleanTitle.split(/[\s　,、。・]+/).filter(w => w.length >= 2).slice(0, 3);
          for (const word of words) {
            candidates = await db.getItems({ search: word, limit: 10 });
            if (candidates.length > 0) break;
          }
        }

        if (candidates.length > 1 && item.price) {
          const priceMatch = candidates.find(c =>
            c.start_price === parseInt(item.price) ||
            c.sold_price === parseInt(item.price)
          );
          if (priceMatch) {
            item.matched = true;
            item.dbItem = priceMatch;
          }
        }

        if (!item.matched && candidates.length > 0) {
          item.matched = true;
          item.dbItem = candidates[0];
        }
      }
    }

    // 商品IDでも検索（listing_urlに含まれている可能性）
    if (!item.matched && item.productId) {
      const dbClient = db.getDB();
      if (dbClient) {
        const { data } = await dbClient.from('items')
          .select('*')
          .ilike('listing_url', `%${item.productId}%`)
          .limit(3);
        if (data && data.length > 0) {
          item.matched = true;
          item.dbItem = data[0];
        }
      }
      if (!item.matched) {
        const candidates = await db.getItems({ search: item.productId, limit: 3 });
        if (candidates.length > 0) {
          item.matched = true;
          item.dbItem = candidates[0];
        }
      }
    }

    // 重複チェック: 既に落札済み以降のステータスなら取込済み
    if (item.matched && item.dbItem) {
      if (ALREADY_SOLD_STATUSES.includes(item.dbItem.status)) {
        item.alreadyImported = true;
      }
    }
  }

  const matchedItems = ocrItems.filter(i => i.matched && !i.alreadyImported);
  const alreadyItems = ocrItems.filter(i => i.matched && i.alreadyImported);
  const unmatchedItems = ocrItems.filter(i => !i.matched);

  _container.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="siBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">売上取込</h2>
      </div>

      <!-- スクショプレビュー -->
      <div style="margin-bottom:12px;">
        <img src="${screenshotBase64}" style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;">
      </div>

      <!-- 読取結果サマリー -->
      <div style="background:#ffffff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #dde0e6;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#5a6272;font-size:13px;">読取結果</span>
          <span style="color:#C5A258;font-size:18px;font-weight:bold;">${ocrItems.length}件</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;flex-wrap:wrap;">
          <span style="color:#006B3F;">✅ 新規: ${matchedItems.length}件</span>
          ${alreadyItems.length > 0 ? `<span style="color:#8a8a8a;">🔄 取込済み: ${alreadyItems.length}件</span>` : ''}
          <span style="color:#CE2029;">❌ 不一致: ${unmatchedItems.length}件</span>
        </div>
      </div>

      <!-- 一致した商品リスト -->
      ${matchedItems.length > 0 ? `
        <h3 style="color:#1C2541;font-size:14px;margin-bottom:8px;">更新する商品</h3>
        ${matchedItems.map((item, i) => `
          <div class="si-item" data-idx="${i}" style="background:#ffffff;border-radius:10px;padding:12px;margin-bottom:8px;border:1px solid #dde0e6;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
              <span style="color:#C5A258;font-size:12px;font-weight:bold;">${escapeHtml(item.dbItem.mgmt_num)}</span>
              <div style="display:flex;gap:4px;">
                ${statusBadge(item.dbItem.status)}
                <span style="font-size:11px;color:#5a6272;">→</span>
                ${statusBadge(item.newStatus)}
              </div>
            </div>
            <div style="font-size:13px;color:#1C2541;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(item.dbItem.product_name)}
            </div>
            ${item.price ? `<div style="font-size:13px;color:#006B3F;font-weight:bold;margin-top:2px;">¥${Number(item.price).toLocaleString()}</div>` : ''}
          </div>
        `).join('')}
      ` : ''}

      <!-- 取込済み（重複）リスト -->
      ${alreadyItems.length > 0 ? `
        <details style="margin-top:12px;margin-bottom:8px;">
          <summary style="color:#8a8a8a;font-size:13px;cursor:pointer;">🔄 取込済み（${alreadyItems.length}件）— スキップします</summary>
          <div style="margin-top:6px;">
          ${alreadyItems.map(item => `
            <div style="background:#f0f0f0;border-radius:10px;padding:10px;margin-bottom:6px;border:1px solid #dde0e6;opacity:0.7;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                <span style="color:#8a8a8a;font-size:11px;">${escapeHtml(item.dbItem.mgmt_num)}</span>
                ${statusBadge(item.dbItem.status)}
              </div>
              <div style="font-size:12px;color:#5a6272;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.dbItem.product_name || item.title)}</div>
              ${item.price ? `<div style="font-size:11px;color:#8a8a8a;">¥${Number(item.price).toLocaleString()}</div>` : ''}
            </div>
          `).join('')}
          </div>
        </details>
      ` : ''}

      <!-- 不一致リスト -->
      ${unmatchedItems.length > 0 ? `
        <details style="margin-top:8px;margin-bottom:8px;" ${matchedItems.length === 0 ? 'open' : ''}>
          <summary style="color:#CE2029;font-size:13px;cursor:pointer;">❌ DBに見つからなかった商品（${unmatchedItems.length}件）</summary>
          <div style="margin-top:6px;">
          ${unmatchedItems.map(item => `
            <div style="background:#f8f5ee;border-radius:10px;padding:10px;margin-bottom:6px;border:1px solid #e8e5dd;">
              <div style="font-size:12px;color:#5a6272;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.title || '(読取不可)')}</div>
              ${item.price ? `<div style="font-size:12px;color:#5a6272;">¥${Number(item.price).toLocaleString()}</div>` : ''}
            </div>
          `).join('')}
          </div>
        </details>
      ` : ''}

      <!-- 一括更新ボタン -->
      ${matchedItems.length > 0 ? `
        <button id="siApplyAll"
          style="width:100%;padding:16px;border-radius:12px;border:none;background:#C5A258;color:#000;font-size:16px;font-weight:bold;cursor:pointer;margin-top:16px;">
          ✅ ${matchedItems.length}件を一括更新
        </button>
      ` : ''}

      <button id="siRetake"
        style="width:100%;padding:12px;border-radius:12px;border:1px solid #dde0e6;background:transparent;color:#5a6272;font-size:13px;cursor:pointer;margin-top:8px;">
        📷 別のスクショを取り込む
      </button>
    </div>
  `;

  // イベント
  _container.querySelector('#siBack')?.addEventListener('click', () => renderList());

  _container.querySelector('#siRetake')?.addEventListener('click', () => handleSalesImport());

  _container.querySelector('#siApplyAll')?.addEventListener('click', async () => {
    const btn = _container.querySelector('#siApplyAll');
    btn.textContent = '更新中...';
    btn.disabled = true;

    let updated = 0;
    for (const item of matchedItems) {
      try {
        const updates = {};
        if (item.price) updates.sold_price = parseInt(item.price) || null;
        if (item.newStatus === '受取確認' || item.newStatus === '完了') {
          updates.completed_at = new Date().toISOString();
        }
        await db.updateItemStatus(
          item.dbItem.mgmt_num,
          item.newStatus,
          staff?.name || '',
          updates
        );
        updated++;
      } catch (e) {
        console.error(`更新失敗: ${item.dbItem.mgmt_num}`, e);
      }
    }

    showToast(`${updated}件のステータスを更新しました`);
    _activeTab = 'sold';
    await loadAndRender();
  });
}

// ---------------------------------------------------------------------------
// クリーンアップ
// ---------------------------------------------------------------------------

export function destroyTrade() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_packingTimerId) { clearInterval(_packingTimerId); _packingTimerId = null; }
  _packingItem = null;
  _packingStart = null;
  _items = [];
  _container = null;
}
