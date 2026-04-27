/**
 * テイクバック流通 v2 - 入荷モジュール
 * 分荷判定 → 撮影 → 保管
 */
import { CONFIG } from '../core/config.js';
import * as db from '../core/db.js';
import { getCurrentStaff } from '../core/auth.js';
import { showToast, showLoading, capturePhoto, fileToBase64, resizeImage, escapeHtml, statusBadge, formatPrice } from '../core/ui.js';

// ── 定数 ──────────────────────────────────────────

const SOURCE_TYPES = [
  { id: 'jisha',    label: '自社仕入',       category: 'jisha', mgmtPrefix: '' },
  { id: 'bigsport', label: 'ビッグスポーツ', category: 'itaku', mgmtPrefix: 'B' },
  { id: 'watanabe', label: '渡辺質店',       category: 'itaku', mgmtPrefix: 'W' },
  { id: 'shimachiyo', label: 'シマチヨ',     category: 'kojin', mgmtPrefix: 'S' },
];


function getMgmtPrefix() {
  const src = SOURCE_TYPES.find(s => s.id === state.sourceType);
  return src?.mgmtPrefix || '';
}

// 発送コスト計算
function calcShippingCost(shippingSize) {
  const costs = CONFIG.COSTS.size_shipping;
  if (!shippingSize) return 0;
  const sizes = Object.keys(costs).map(Number).sort((a, b) => a - b);
  for (const s of sizes) {
    if (shippingSize <= s) return costs[s];
  }
  return costs[sizes[sizes.length - 1]] || 0;
}

// 識別子生成: 管理番号/発送方法/目標価格/期待値
function generateItemIdentifier(mgmtNum, shippingSize, targetPrice, marketDemand) {
  // 発送方法
  let shipping = 'S60';
  if (shippingSize >= 170) {
    shipping = 'YR'; // アートセッティング（大型家財）
  } else if (shippingSize > 0) {
    shipping = 'S' + shippingSize;
  }

  // 目標価格
  let priceCode = '';
  if (targetPrice >= 10000) {
    priceCode = Math.round(targetPrice / 10000) + 'M';
  } else if (targetPrice > 0) {
    priceCode = Math.round(targetPrice / 100) + 'H';
  }

  // 期待値
  const demand = marketDemand || 2;

  return `${mgmtNum} /${shipping} /${priceCode} /${demand}`;
}

const STORAGE_BASES = [
  { id: 'atsumi', label: '厚見倉庫' },
  { id: 'honjo',  label: '本荘倉庫' },
  { id: 'yanaizu', label: '柳津倉庫' },
];

const STORAGE_AREAS = {
  atsumi: [
    ...Array.from({ length: 28 }, (_, i) => `A${i + 1}`),
    'A1横', 'A1前', 'A1階奥', '倉庫奥', '倉庫入口', '2階',
  ],
  honjo: [
    ...Array.from({ length: 10 }, (_, i) => `H${i + 1}`),
  ],
  yanaizu: [
    ...Array.from({ length: 5 }, (_, i) => `Y${i + 1}`),
  ],
};

const PHOTO_SLOTS = [
  { key: 'front',  label: '正面' },
  { key: 'back',   label: '背面' },
  { key: 'detail', label: '状態(傷・汚れ)' },
  { key: 'tag',    label: 'タグ / ラベル' },
  { key: 'extra1', label: '追加1' },
  { key: 'extra2', label: '追加2' },
];

// ── モジュール状態 ────────────────────────────────

let state = resetState();

function resetState() {
  return {
    step: 'source',       // source → capture → result → photo → storage → done
    sourceType: null,
    sourceCategory: null,
    judgmentPhoto: null,   // base64 (最初の1枚、互換用)
    capturePhotos: [],     // 複数撮影用 base64配列
    aiResult: null,
    mgmtNum: null,
    itemId: null,
    photos: {},           // { front: base64, back: base64, ... }
    measurements: { width: '', height: '', depth: '', weight: '' },
    barcode: '',
    storageBase: null,
    storageArea: null,
    storageMemo: '',
    startTime: null,
    consultReason: '',
    commissionRate: null,
    bulkItems: [],
    bulkPhoto: null,
    bulkRegisterResult: null,
    operationStatus: '',
    operationNote: '',
    listingMemo: '',
  };
}

/** sourceType id → 表示名 */
function getSourceLabel(id) {
  const src = SOURCE_TYPES.find(s => s.id === id);
  return src ? src.label : id || '';
}

/** sourceType id が委託先かどうか */
function isConsignmentSource(id) {
  const label = getSourceLabel(id);
  return ['ビッグスポーツ', '渡辺質店', 'シマチヨ'].includes(label);
}

let containerRef = null;
let unsubscribe = null;

// ── メインエントリ ────────────────────────────────

export function renderIntake(container, params = {}) {
  containerRef = container;

  // パラメータから途中復帰
  if (params.step) state.step = params.step;
  if (params.mgmtNum) state.mgmtNum = params.mgmtNum;

  // リアルタイム購読（他端末更新時にリフレッシュ）
  if (unsubscribe) unsubscribe();
  unsubscribe = db.subscribe((table) => {
    if (table === 'items' && state.step === 'done') render();
  });

  render();
}

// ── レンダリング分岐 ──────────────────────────────

function render() {
  if (!containerRef) return;
  const staff = getCurrentStaff();
  if (!staff) {
    containerRef.innerHTML = '<p style="color:#CE2029;text-align:center;padding:40px;">ログインしてください</p>';
    return;
  }

  switch (state.step) {
    case 'source':      renderSourceSelect();  break;
    case 'capture':     renderCapture();       break;
    case 'result':      renderResult();        break;
    case 'photo':       renderPhotoStep();     break;
    case 'storage':     renderStorageStep();   break;
    case 'done':        renderDone();          break;
    case 'bulk_import':     renderBulkImport();    break;
    case 'done_bulk':       renderDoneBulk();      break;
    case 'bulk_photo_link': renderBulkPhotoLink(); break;
    default:                renderSourceSelect();
  }
}

// ── STEP 1: 仕入先選択 ───────────────────────────

function renderSourceSelect() {
  state = resetState();
  state.startTime = Date.now();

  const btns = SOURCE_TYPES.map(s => `
    <button class="intake-source-btn" data-id="${s.id}" data-cat="${s.category}"
      style="background:#ffffff;border:1px solid #dde0e6;border-radius:12px;padding:20px 12px;
             text-align:center;color:#1C2541;cursor:pointer;transition:all 0.15s;font-size:15px;font-weight:bold;">
      ${escapeHtml(s.label)}
    </button>
  `).join('');

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <h2 style="color:#C5A258;font-size:18px;margin-bottom:4px;">入荷 - 分荷判定</h2>
      <p style="color:#5a6272;font-size:13px;margin-bottom:20px;">仕入先を選択してください</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${btns}
      </div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #dde0e6;">
        <button id="btnBulkWatanabe" style="width:100%;padding:14px;border-radius:12px;border:1px solid #C5A258;background:transparent;color:#C5A258;font-size:14px;cursor:pointer;">
          📋 渡辺質店 一括登録（シート読み取り）
        </button>
      </div>
      ${renderTodayCount()}
    </div>
  `;

  containerRef.querySelectorAll('.intake-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sourceType = btn.dataset.id;
      state.sourceCategory = btn.dataset.cat;
      state.step = 'capture';
      render();
    });
    addTouchFeedback(btn);
  });

  const bulkBtn = containerRef.querySelector('#btnBulkWatanabe');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', () => {
      state.sourceType = 'watanabe';
      state.sourceCategory = 'itaku';
      state.step = 'bulk_import';
      render();
    });
    addTouchFeedback(bulkBtn);
  }
}

function renderTodayCount() {
  return `
    <div id="intakeTodayStats" style="margin-top:24px;padding:16px;background:#ffffff;border-radius:12px;">
      <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">今日の分荷実績</p>
      <div style="display:flex;align-items:baseline;gap:4px;">
        <span id="intakeCountNum" style="color:#C5A258;font-size:28px;font-weight:bold;">—</span>
        <span style="color:#5a6272;font-size:13px;">/ ${CONFIG.DAILY_KPI.bunka} 個目標</span>
      </div>
    </div>
  `;
}

// 今日の実績を非同期で取得して表示
async function loadTodayCount() {
  const el = document.getElementById('intakeCountNum');
  if (!el) return;
  const stats = await db.getTodayStats();
  el.textContent = stats.judged;
}

// ── STEP 2: 撮影（AI判定用） ─────────────────────

function renderCapture() {
  const srcLabel = SOURCE_TYPES.find(s => s.id === state.sourceType)?.label || '';
  const isBook = state.sourceType === 'jisha'; // 書籍はバーコードスキャンオプション

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="intakeBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <div>
          <h2 style="color:#C5A258;font-size:18px;margin:0;">分荷判定 撮影</h2>
          <p style="color:#5a6272;font-size:12px;margin:0;">仕入先: ${escapeHtml(srcLabel)}</p>
        </div>
      </div>

      <!-- 撮影エリア -->
      <div id="captureArea" style="background:#ffffff;border:2px dashed #dde0e6;border-radius:16px;
           padding:${state.capturePhotos.length > 0 ? '16px' : '40px'} 20px;text-align:center;cursor:pointer;margin-bottom:12px;transition:border-color 0.2s;">
        ${state.capturePhotos.length > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:8px;">
               ${state.capturePhotos.map((p, i) => `
                 <div style="position:relative;flex-shrink:0;">
                   <img src="${p}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;">
                   <div style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.6);color:#C5A258;font-size:9px;padding:1px 4px;border-radius:4px;">${i + 1}</div>
                   <button class="photo-del" data-idx="${i}" style="position:absolute;top:2px;right:2px;background:#CE2029;color:white;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:20px;padding:0;">✕</button>
                 </div>
               `).join('')}
               <div style="width:90px;height:90px;border:2px dashed #C5A258;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                 <span style="font-size:24px;color:#C5A258;">+</span>
                 <span style="font-size:10px;color:#C5A258;">追加</span>
               </div>
             </div>
             <p style="color:#5a6272;font-size:12px;">${state.capturePhotos.length}枚撮影済み（タップで追加）</p>`
          : `<div style="font-size:48px;margin-bottom:12px;">📷</div>
             <p style="color:#5a6272;font-size:15px;font-weight:bold;">タップして撮影</p>
             <p style="color:#8a8a8a;font-size:12px;">商品全体が映るように撮ってください</p>
             <p style="color:#C5A258;font-size:12px;margin-top:4px;">複数枚撮影OK（ラベル・傷・背面など）</p>`
        }
      </div>

      ${isBook ? `
      <!-- バーコードスキャン（書籍用） -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="color:#5a6272;font-size:13px;margin-bottom:8px;">📖 書籍の場合: バーコード / ISBN</p>
        <div style="display:flex;gap:8px;">
          <input id="barcodeInput" type="text" inputmode="numeric" placeholder="ISBN / バーコード番号"
            value="${escapeHtml(state.barcode)}"
            style="flex:1;background:#f5f5f5;border:1px solid #dde0e6;border-radius:8px;color:#1C2541;
                   padding:10px 12px;font-size:14px;outline:none;">
          <button id="barcodeScan" style="background:#dde0e6;border:none;border-radius:8px;color:#C5A258;
                  padding:10px 14px;font-size:18px;cursor:pointer;">📸</button>
        </div>
      </div>
      ` : ''}

      <!-- AI判定ボタン -->
      <button id="judgeBtn" ${state.capturePhotos.length === 0 ? 'disabled' : ''}
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;transition:all 0.2s;
               ${state.capturePhotos.length > 0
                 ? 'background:#C5A258;color:#000;'
                 : 'background:#dde0e6;color:#8a8a8a;cursor:not-allowed;'}">
        AI判定を実行${state.capturePhotos.length > 1 ? `（${state.capturePhotos.length}枚）` : ''}
      </button>
    </div>
  `;

  // イベント
  containerRef.querySelector('#intakeBack').addEventListener('click', () => {
    state.step = 'source';
    render();
  });

  const captureArea = containerRef.querySelector('#captureArea');
  captureArea.addEventListener('click', (e) => {
    // 削除ボタンクリック時は撮影しない
    if (e.target.closest('.photo-del')) return;
    handleCapturePhoto();
  });
  addTouchFeedback(captureArea);

  // 写真個別削除
  containerRef.querySelectorAll('.photo-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      state.capturePhotos.splice(idx, 1);
      if (state.capturePhotos.length > 0) {
        state.judgmentPhoto = state.capturePhotos[0];
      } else {
        state.judgmentPhoto = null;
      }
      showToast('写真を削除しました');
      render();
    });
  });

  const judgeBtn = containerRef.querySelector('#judgeBtn');
  judgeBtn.addEventListener('click', handleAIJudgment);

  if (isBook) {
    containerRef.querySelector('#barcodeInput')?.addEventListener('input', (e) => {
      state.barcode = e.target.value.trim();
    });
    containerRef.querySelector('#barcodeScan')?.addEventListener('click', handleBarcodeScan);
  }
}

async function handleCapturePhoto() {
  try {
    const file = await capturePhoto();
    if (!file) return;
    showToast('画像を処理中...');
    const base64 = await fileToBase64(file);
    const resized = await resizeImage(base64, 1200);
    state.capturePhotos.push(resized);
    state.judgmentPhoto = state.capturePhotos[0]; // 互換用: 最初の1枚
    render();
  } catch (e) {
    console.error('撮影エラー:', e);
    showToast('撮影に失敗しました');
  }
}

async function handleBarcodeScan() {
  try {
    const file = await capturePhoto();
    if (!file) return;
    showToast('バーコードを読み取り中...');
    // バーコード読み取り（BarcodeDetector API）
    if ('BarcodeDetector' in window) {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'] });
      const barcodes = await detector.detect(bitmap);
      if (barcodes.length > 0) {
        state.barcode = barcodes[0].rawValue;
        showToast(`読み取り成功: ${state.barcode}`);
        render();
        return;
      }
    }
    showToast('バーコードを認識できませんでした。手入力してください');
  } catch (e) {
    console.error('バーコードスキャンエラー:', e);
    showToast('スキャンに失敗しました。手入力してください');
  }
}

// ── AI判定実行 ───────────────────────────────────

async function handleAIJudgment() {
  if (!state.judgmentPhoto) return;
  const staff = getCurrentStaff();
  if (!staff) return;

  showLoading(containerRef, 'AI判定中... 商品を分析しています');

  try {
    const allPhotos = state.capturePhotos.length > 0 ? state.capturePhotos : (state.judgmentPhoto ? [state.judgmentPhoto] : []);
    const body = {
      image: allPhotos[0] || null,
      images: allPhotos,
      step: state.barcode ? 'book' : 'judge',
      context: {
        staffName: staff.name,
        sourceId: state.sourceType,
        bookInfo: state.barcode ? { isbn: state.barcode } : undefined,
        hint: 'メーカー名・ブランド名・型番を可能な限り特定してください。ロゴや刻印、ラベルから読み取れる情報を全て活用してください。',
      },
    };

    const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        'Content-Type': 'application/json',
        'apikey': CONFIG.AWAI_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI判定エラー (${res.status}): ${errText}`);
    }

    const result = await res.json();
    // 現行Edge Functionのレスポンス形式をv2の内部形式に変換
    const j = result.success ? result.judgment : result;
    state.aiResult = {
      productName: j.productName || '',
      maker: j.maker || '',
      modelNumber: j.modelNumber || '',
      category: j.category || '',
      condition: j.condition || '',
      conditionNote: j.conditionNote || '',
      channel: j.channel || '',
      estimatedPriceMin: (j.estimatedPrice && j.estimatedPrice.min) || j.estimatedPriceMin || 0,
      estimatedPriceMax: (j.estimatedPrice && j.estimatedPrice.max) || j.estimatedPriceMax || 0,
      startPrice: j.startPrice || (j.estimatedPrice && j.estimatedPrice.min) || 0,
      targetPrice: j.targetPrice || j.mokuhyoKakaku || Math.round(((j.estimatedPrice && j.estimatedPrice.max) || j.startPrice || 0) * 1.3) || 0,
      score: j.score || 0,
      confidence: j.confidence || (j.needsApproval ? 0.5 : 0.8),
      explanation: j.explanation || '',
      estimatedSize: j.estimatedSize || '',
      needsApproval: j.needsApproval || false,
      approvalReason: j.approvalReason || '',
      listingTitle: j.listingTitle || '',
      listingDescription: j.listingDescription || '',
      shippingSize: j.shippingSize || 0,
      marketDemand: j.marketDemand || 2,
    };
    state.step = 'result';
    render();
  } catch (e) {
    console.error('AI判定失敗:', e);
    renderErrorScreen(
      'AI判定に失敗しました',
      e.message,
      [
        { label: '再試行', action: () => { state.step = 'capture'; render(); handleAIJudgment(); } },
        { label: '撮り直す', action: () => { state.step = 'capture'; state.judgmentPhoto = null; state.capturePhotos = []; render(); } },
      ]
    );
  }
}

// ── STEP 3: AI判定結果表示 ────────────────────────

function renderResult() {
  const r = state.aiResult;
  if (!r) { state.step = 'capture'; render(); return; }

  const confidence = r.confidence || 0;
  const confidenceColor = confidence >= 0.8 ? '#006B3F' : confidence >= 0.6 ? '#C5A258' : '#CE2029';
  const confidencePct = Math.round(confidence * 100);

  const needsApproval = checkNeedsApproval(r);
  const channelInfo = findChannelInfo(r.channel);
  const condLabel = CONFIG.CONDITIONS[r.condition] || r.condition || '—';

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="resultBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">AI判定結果</h2>
      </div>

      <!-- 判定写真サムネイル -->
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        ${state.judgmentPhoto ? `<img src="${state.judgmentPhoto}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;">` : ''}
        <div style="flex:1;">
          <input type="text" id="editProductName" value="${escapeHtml(r.productName || '')}" placeholder="商品名"
            style="background:#ffffff;border:1px solid #dde0e6;border-radius:6px;color:#1C2541;padding:6px 8px;font-size:15px;font-weight:bold;width:100%;outline:none;box-sizing:border-box;">
          <input type="text" id="editMaker" value="${escapeHtml(r.maker || '')}" placeholder="メーカー名"
            style="background:#ffffff;border:1px solid #dde0e6;border-radius:6px;color:#5a6272;padding:4px 8px;font-size:13px;width:100%;outline:none;margin-top:4px;box-sizing:border-box;">
          <input type="text" id="editModelNumber" value="${escapeHtml(r.modelNumber || '')}" placeholder="品番・型式"
            style="background:#ffffff;border:1px solid #dde0e6;border-radius:6px;color:#5a6272;padding:4px 8px;font-size:13px;width:100%;outline:none;margin-top:4px;box-sizing:border-box;">
          <p style="color:#5a6272;font-size:12px;margin:4px 0 0;">${escapeHtml(r.category || '')}</p>
        </div>
      </div>

      <!-- 信頼度バー -->
      <div style="background:#ffffff;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="color:#5a6272;font-size:12px;">AI信頼度</span>
          <span style="color:${confidenceColor};font-size:14px;font-weight:bold;">${confidencePct}%</span>
        </div>
        <div style="background:#e8e5dd;border-radius:4px;height:6px;overflow:hidden;">
          <div style="background:${confidenceColor};height:100%;width:${confidencePct}%;border-radius:4px;transition:width 0.5s;"></div>
        </div>
      </div>

      <!-- 詳細情報 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;">
          ${resultRow('状態', `<span style="color:${condColor(r.condition)};font-weight:bold;">${escapeHtml(r.condition || '—')}</span> ${escapeHtml(condLabel)}`)}
          ${resultRow('販路', escapeHtml(channelInfo?.name || r.channel || '—'))}
          ${resultRow('スコア', r.score != null ? `${r.score} 点` : '—')}
          ${resultRow('想定価格', `${formatPrice(r.estimatedPriceMin)} 〜 ${formatPrice(r.estimatedPriceMax)}`)}
          ${resultRow('開始価格', formatPrice(r.startPrice))}
          ${resultRow('目標価格', formatPrice(r.targetPrice))}
        </table>
      </div>

      <!-- AI説明 -->
      ${r.explanation ? `
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:11px;margin-bottom:4px;">AIコメント</p>
        <p style="color:#4a4a5a;font-size:13px;line-height:1.5;margin:0;">${escapeHtml(r.explanation)}</p>
      </div>
      ` : ''}

      <!-- 動作確認 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:11px;margin-bottom:8px;">動作確認（該当する場合のみ）</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;" id="operationBtns">
          ${CONFIG.OPERATION_STATUS.map(s => `
            <button class="op-btn" data-op="${s.id}"
              style="padding:8px 12px;border-radius:8px;font-size:13px;cursor:pointer;
              border:1px solid ${state.operationStatus === s.id ? '#C5A258' : '#dde0e6'};
              background:${state.operationStatus === s.id ? '#C5A258' : 'transparent'};
              color:${state.operationStatus === s.id ? '#000' : '#1C2541'};">
              ${s.icon} ${s.label}
            </button>
          `).join('')}
        </div>
        ${state.operationStatus === 'defective' ? `
          <input type="text" id="operationNote" placeholder="不良内容を入力" value="${escapeHtml(state.operationNote)}"
            style="width:100%;margin-top:8px;padding:10px 12px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:14px;outline:none;box-sizing:border-box;">
        ` : ''}
      </div>

      <!-- 委託販売: 手数料率 -->
      ${getSourceLabel(state.sourceType) === '渡辺質店' ? `
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:11px;margin-bottom:8px;">手数料率（テイクバック取り分）</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${[20,30,40,50].map(r => `<button class="commission-btn" data-rate="${r}" style="padding:8px 16px;border-radius:8px;border:1px solid ${state.commissionRate === r ? '#C5A258' : '#dde0e6'};background:${state.commissionRate === r ? '#C5A258' : 'transparent'};color:${state.commissionRate === r ? '#000' : '#1C2541'};font-size:14px;cursor:pointer;">${r}%</button>`).join('')}
        </div>
      </div>
      ` : ''}
      ${getSourceLabel(state.sourceType) === 'ビッグスポーツ' ? `
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:11px;">手数料率</p>
        <p style="color:#C5A258;font-size:16px;font-weight:bold;">50:50（固定）</p>
      </div>
      ` : ''}

      <!-- 浅野承認が必要な場合の警告 -->
      ${needsApproval ? `
      <div style="background:#CE202922;border:1px solid #CE2029;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#CE2029;font-size:13px;font-weight:bold;margin-bottom:4px;">⚠ 浅野さんの確認が必要</p>
        <p style="color:#CE2029;font-size:12px;margin:0;">${escapeHtml(needsApproval)}</p>
      </div>
      ` : ''}

      <!-- 出品メモ（出品担当への引き継ぎ） -->
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:11px;margin-bottom:6px;">出品担当への引き継ぎメモ</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          ${['箱なし','付属品なし','傷あり','汚れあり','ラベルに型番あり','セット欠品あり','匂いあり'].map(tag => `
            <button class="memo-tag" data-tag="${tag}"
              style="padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;
              border:1px solid #dde0e6;background:#ffffff;color:#5a6272;">
              ${tag}
            </button>
          `).join('')}
        </div>
        <input type="text" id="listingMemo" placeholder="自由記入（例: 底に刻印あり）" value="${escapeHtml(state.listingMemo || '')}"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #dde0e6;background:#f5f5f5;color:#1C2541;font-size:13px;outline:none;">
      </div>

      <!-- アクションボタン -->
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px;">
        <button id="resultOk"
          style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
                 border:none;cursor:pointer;background:#C5A258;color:#000;transition:all 0.15s;">
          ${needsApproval ? '相談して確定' : 'OK - 確定して次へ'}
        </button>
        <div style="display:flex;gap:10px;">
          <button id="resultConsult"
            style="flex:1;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;
                   border:1px solid #C5A258;background:transparent;color:#C5A258;cursor:pointer;">
            相談する
          </button>
          <button id="resultRetry"
            style="flex:1;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;
                   border:1px solid #ccc;background:transparent;color:#5a6272;cursor:pointer;">
            再判定
          </button>
        </div>
        <button id="resultReshoot"
          style="width:100%;padding:12px;border-radius:12px;font-size:13px;
                 border:none;background:#e8e5dd;color:#5a6272;cursor:pointer;">
          撮り直す
        </button>
      </div>
    </div>
  `;

  // イベント
  containerRef.querySelector('#resultBack').addEventListener('click', () => {
    state.step = 'capture';
    render();
  });
  // 出品メモのタグボタン
  containerRef.querySelectorAll('.memo-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const input = containerRef.querySelector('#listingMemo');
      const current = input.value.trim();
      if (current.includes(tag)) return; // 重複防止
      input.value = current ? `${current} / ${tag}` : tag;
      state.listingMemo = input.value;
      btn.style.background = '#C5A258';
      btn.style.color = '#000';
      btn.style.borderColor = '#C5A258';
    });
  });
  containerRef.querySelector('#listingMemo')?.addEventListener('input', (e) => {
    state.listingMemo = e.target.value;
  });

  containerRef.querySelector('#resultOk').addEventListener('click', () => handleConfirm(needsApproval));
  containerRef.querySelector('#resultConsult').addEventListener('click', handleConsult);
  containerRef.querySelector('#resultRetry').addEventListener('click', () => {
    state.aiResult = null;
    handleAIJudgment();
  });
  containerRef.querySelector('#resultReshoot').addEventListener('click', () => {
    state.judgmentPhoto = null;
    state.capturePhotos = [];
    state.aiResult = null;
    state.step = 'capture';
    render();
  });

  // 委託手数料率ボタン
  containerRef.querySelectorAll('.commission-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.commissionRate = parseInt(btn.dataset.rate);
      // ボタン表示更新
      containerRef.querySelectorAll('.commission-btn').forEach(b => {
        const isActive = parseInt(b.dataset.rate) === state.commissionRate;
        b.style.borderColor = isActive ? '#C5A258' : '#dde0e6';
        b.style.background = isActive ? '#C5A258' : 'transparent';
        b.style.color = isActive ? '#000' : '#1C2541';
      });
    });
    addTouchFeedback(btn);
  });

  // 動作確認ボタン
  containerRef.querySelectorAll('.op-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const op = btn.dataset.op;
      state.operationStatus = state.operationStatus === op ? '' : op;
      render();
    });
  });

  const opNoteInput = containerRef.querySelector('#operationNote');
  if (opNoteInput) {
    opNoteInput.addEventListener('input', (e) => {
      state.operationNote = e.target.value;
    });
  }

  // 商品名・メーカー・型番の編集
  containerRef.querySelector('#editProductName')?.addEventListener('input', (e) => { state.aiResult.productName = e.target.value; });
  containerRef.querySelector('#editMaker')?.addEventListener('input', (e) => { state.aiResult.maker = e.target.value; });
  containerRef.querySelector('#editModelNumber')?.addEventListener('input', (e) => { state.aiResult.modelNumber = e.target.value; });

  addTouchFeedback(containerRef.querySelector('#resultOk'));
  addTouchFeedback(containerRef.querySelector('#resultConsult'));
  addTouchFeedback(containerRef.querySelector('#resultRetry'));
}

function resultRow(label, value) {
  return `
    <tr>
      <td style="color:#5a6272;font-size:12px;padding:6px 0;white-space:nowrap;vertical-align:top;width:80px;">${label}</td>
      <td style="color:#1C2541;font-size:14px;padding:6px 0;">${value}</td>
    </tr>
  `;
}

function condColor(cond) {
  const map = { S: '#006B3F', A: '#8bc34a', B: '#C5A258', C: '#CE2029', D: '#9e9e9e' };
  return map[cond] || '#888';
}

function findChannelInfo(channelName) {
  if (!channelName) return null;
  return CONFIG.CHANNELS.find(c => c.name === channelName) || null;
}

function checkNeedsApproval(result) {
  const reasons = [];
  if (result.confidence != null && result.confidence < 0.7) {
    reasons.push('AI信頼度が低い');
  }
  if (result.estimatedPriceMax >= CONFIG.APPROVAL_RULES.high_value_threshold) {
    reasons.push(`想定価格 ${formatPrice(result.estimatedPriceMax)} (${formatPrice(CONFIG.APPROVAL_RULES.high_value_threshold)}以上)`);
  }
  if (result.score != null && result.score >= 80) {
    reasons.push('高スコア品');
  }
  return reasons.length > 0 ? reasons.join(' / ') : null;
}

// ── 確定処理 ─────────────────────────────────────

async function handleConfirm(needsApproval) {
  // 重複登録防止: 既に管理番号が採番済みなら次のステップへ
  if (state.mgmtNum) {
    state.step = 'photo';
    render();
    return;
  }

  const staff = getCurrentStaff();
  if (!staff) return;
  const r = state.aiResult;

  // 手入力フィールドの値で上書き（ユーザーが修正した場合）
  const editedName = containerRef.querySelector('#editProductName')?.value?.trim();
  const editedMaker = containerRef.querySelector('#editMaker')?.value?.trim();
  const editedModel = containerRef.querySelector('#editModelNumber')?.value?.trim();
  if (editedName) r.productName = editedName;
  if (editedMaker) r.maker = editedMaker;
  if (editedModel) r.modelNumber = editedModel;

  showLoading(containerRef, '登録中...');

  try {
    // 管理番号を採番
    const mgmtNum = await db.generateMgmtNum(getMgmtPrefix());
    if (!mgmtNum) throw new Error('管理番号の採番に失敗しました');
    state.mgmtNum = mgmtNum;

    // 商品レコード作成（itemsテーブルのカラム名に合わせる）
    const item = {
      mgmt_num: mgmtNum,
      status: needsApproval ? CONFIG.STATUS.CONSULT : CONFIG.STATUS.JUDGED,
      product_name: r.productName || '',
      maker: r.maker || '',
      model_number: r.modelNumber || '',
      category: r.category || '',
      condition: r.condition || '',
      channel_name: r.channel || '',
      priority_score: r.score || 0,
      ai_confidence: r.confidence != null ? String(r.confidence) : '',
      estimated_price_min: r.estimatedPriceMin || 0,
      estimated_price_max: r.estimatedPriceMax || 0,
      start_price: r.startPrice || 0,
      target_price: r.targetPrice || 0,
      listing_account: state.sourceType || '',
      product_size: r.estimatedSize || '',
      shipping_cost: calcShippingCost(r.shippingSize),
      market_demand: r.marketDemand || 2,
      memo: r.explanation || '',
      judged_by: staff.name,
      judged_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      staff_mark: CONFIG.STAFF_MARKS[staff.name] || '',
      source: 'app',
      commission_rate: getSourceLabel(state.sourceType) === 'ビッグスポーツ' ? 50 : (state.commissionRate || null),
      commission_type: getSourceLabel(state.sourceType) === 'ビッグスポーツ' ? 'fixed' : (state.commissionRate ? 'variable' : ''),
      consignment_partner: isConsignmentSource(state.sourceType) ? getSourceLabel(state.sourceType) : '',
      operation_status: state.operationStatus || '',
      operation_note: state.operationNote || '',
      listing_memo: state.listingMemo || '',
    };

    const created = await db.createItem(item);
    if (!created) throw new Error('商品の登録に失敗しました');
    state.itemId = created.id;

    // 判定写真をDriveにアップロード（非同期、失敗しても続行）
    uploadToDrive(state.judgmentPhoto, mgmtNum, 0).catch(e =>
      console.warn('Drive判定写真アップロード失敗:', e)
    );

    // 作業ログ
    const elapsed = Math.round((Date.now() - (state.startTime || Date.now())) / 1000);
    await db.logWork({
      staff_name: staff.name,
      work_type: '分荷',
      work_date: new Date(new Date().getTime() + (9*60 - new Date().getTimezoneOffset())*60000).toISOString().slice(0,10),
      mgmt_num: mgmtNum,
      duration_seconds: elapsed,
    });

    showToast(`${mgmtNum} を登録しました`);

    if (needsApproval) {
      // 相談フラグ付きの場合はトップに戻る
      state.step = 'done';
    } else {
      // 撮影ステップへ
      state.step = 'photo';
    }
    render();
  } catch (e) {
    console.error('確定処理エラー:', e);
    showToast(e.message || '登録に失敗しました');
    state.step = 'result';
    render();
  }
}

// ── 相談する ─────────────────────────────────────

function handleConsult() {
  // 相談理由入力モーダル
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,37,65,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#ffffff;border-radius:16px;padding:24px;max-width:360px;width:100%;">
      <h3 style="color:#C5A258;font-size:16px;margin-bottom:12px;">相談メモ</h3>
      <textarea id="consultText" rows="4" placeholder="迷っている点、確認したい内容を記入..."
        style="width:100%;background:#f5f5f5;border:1px solid #dde0e6;border-radius:8px;color:#1C2541;
               padding:12px;font-size:14px;resize:none;outline:none;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="consultCancel" style="flex:1;padding:12px;border-radius:8px;background:#dde0e6;color:#4a4a5a;border:none;font-size:14px;cursor:pointer;">キャンセル</button>
        <button id="consultSubmit" style="flex:1;padding:12px;border-radius:8px;background:#C5A258;color:#000;border:none;font-size:14px;font-weight:bold;cursor:pointer;">相談として登録</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#consultCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#consultSubmit').addEventListener('click', async () => {
    const reason = overlay.querySelector('#consultText').value.trim();
    state.consultReason = reason;
    overlay.remove();

    // 相談フラグ付きで確定
    const staff = getCurrentStaff();
    if (!staff) return;
    const r = state.aiResult;

    showLoading(containerRef, '相談として登録中...');

    try {
      const mgmtNum = await db.generateMgmtNum();
      if (!mgmtNum) throw new Error('管理番号の採番に失敗しました');
      state.mgmtNum = mgmtNum;

      const item = {
        mgmt_num: mgmtNum,
        status: CONFIG.STATUS.CONSULT,
        product_name: r.productName || '',
        maker: r.maker || '',
        model_number: r.modelNumber || '',
        category: r.category || '',
        condition: r.condition || '',
        channel_name: r.channel || '',
        priority_score: r.score || 0,
        ai_confidence: r.confidence != null ? String(r.confidence) : '',
        estimated_price_min: r.estimatedPriceMin || 0,
        estimated_price_max: r.estimatedPriceMax || 0,
        start_price: r.startPrice || 0,
        target_price: r.targetPrice || 0,
        listing_account: state.sourceType || '',
        memo: (reason || '相談依頼') + (r.explanation ? '\n' + r.explanation : ''),
        judged_by: staff.name,
        judged_at: new Date().toISOString(),
        staff_mark: CONFIG.STAFF_MARKS[staff.name] || '',
        source: 'app',
        commission_rate: getSourceLabel(state.sourceType) === 'ビッグスポーツ' ? 50 : (state.commissionRate || null),
        commission_type: getSourceLabel(state.sourceType) === 'ビッグスポーツ' ? 'fixed' : (state.commissionRate ? 'variable' : ''),
        consignment_partner: isConsignmentSource(state.sourceType) ? getSourceLabel(state.sourceType) : '',
        operation_status: state.operationStatus || '',
        operation_note: state.operationNote || '',
        listing_memo: state.listingMemo || '',
      };

      const created = await db.createItem(item);
      if (!created) throw new Error('登録に失敗しました');
      state.itemId = created.id;

      uploadToDrive(state.judgmentPhoto, mgmtNum, 0).catch(e =>
        console.warn('Drive判定写真アップロード失敗:', e)
      );

      const elapsed = Math.round((Date.now() - (state.startTime || Date.now())) / 1000);
      await db.logWork({
        staff_name: staff.name,
        work_type: '分荷',
        work_date: new Date(new Date().getTime() + (9*60 - new Date().getTimezoneOffset())*60000).toISOString().slice(0,10),
        mgmt_num: mgmtNum,
        duration_seconds: elapsed,
      });

      showToast(`${mgmtNum} を相談として登録しました`);
      state.step = 'done';
      render();
    } catch (e) {
      console.error('相談登録エラー:', e);
      showToast(e.message || '登録に失敗しました');
      state.step = 'result';
      render();
    }
  });
}

// ── STEP 4: 追加撮影 ─────────────────────────────

function renderPhotoStep() {
  const r = state.aiResult || {};

  const photoCards = PHOTO_SLOTS.map(slot => {
    const hasPhoto = !!state.photos[slot.key];
    return `
      <div class="photo-slot" data-key="${slot.key}"
        style="background:#ffffff;border:${hasPhoto ? '2px solid #C5A258' : '1px dashed #444'};
               border-radius:12px;overflow:hidden;cursor:pointer;transition:all 0.15s;aspect-ratio:1;">
        ${hasPhoto
          ? `<img src="${state.photos[slot.key]}" style="width:100%;height:100%;object-fit:cover;">`
          : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:8px;">
               <span style="font-size:24px;color:#8a8a8a;">📷</span>
               <span style="font-size:11px;color:#8a8a8a;margin-top:4px;">${escapeHtml(slot.label)}</span>
             </div>`
        }
      </div>
    `;
  }).join('');

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <button id="photoBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">追加撮影</h2>
      </div>

      <!-- 管理番号 & 商品名 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <p style="color:#C5A258;font-size:20px;font-weight:bold;margin:0;">${escapeHtml(state.mgmtNum)}</p>
            <p style="color:#5a6272;font-size:13px;margin:0;">${escapeHtml(r.productName || '')} ${escapeHtml(r.maker || '')}</p>
          </div>
          ${statusBadge(CONFIG.STATUS.JUDGED)}
        </div>
      </div>

      <!-- 写真グリッド -->
      <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">写真（正面は必須）</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;">
        ${photoCards}
      </div>

      <!-- 計測入力 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="color:#5a6272;font-size:12px;margin-bottom:10px;">サイズ計測</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${measureInput('width', '横幅', 'cm')}
          ${measureInput('height', '高さ', 'cm')}
          ${measureInput('depth', '奥行', 'cm')}
          ${measureInput('weight', '重さ', 'kg')}
        </div>
      </div>

      <!-- 次へボタン -->
      <button id="photoNext"
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;background:#C5A258;color:#000;transition:all 0.15s;">
        保管場所を設定 →
      </button>
      <button id="photoSkipStorage"
        style="width:100%;padding:12px;border-radius:12px;font-size:13px;margin-top:8px;
               border:none;background:#e8e5dd;color:#5a6272;cursor:pointer;">
        保管場所はあとで設定
      </button>
    </div>
  `;

  // 写真スロットのイベント
  containerRef.querySelectorAll('.photo-slot').forEach(slot => {
    slot.addEventListener('click', async () => {
      const key = slot.dataset.key;
      try {
        const file = await capturePhoto();
        if (!file) return;
        showToast('処理中...');
        const base64 = await fileToBase64(file);
        state.photos[key] = await resizeImage(base64, 1600);

        // Driveにアップロード（非同期）
        const idx = PHOTO_SLOTS.findIndex(s => s.key === key) + 1;
        uploadToDrive(state.photos[key], state.mgmtNum, idx).catch(e =>
          console.warn(`Drive写真${idx}アップロード失敗:`, e)
        );

        render();
      } catch (e) {
        console.error('写真撮影エラー:', e);
        showToast('撮影に失敗しました');
      }
    });
    addTouchFeedback(slot);
  });

  // 計測入力のイベント
  containerRef.querySelectorAll('.measure-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      state.measurements[field] = e.target.value;
    });
  });

  // 戻るボタン
  containerRef.querySelector('#photoBack').addEventListener('click', () => {
    state.step = 'result';
    render();
  });

  // 次へ
  containerRef.querySelector('#photoNext').addEventListener('click', async () => {
    await saveMeasurementsAndPhotos();
    state.step = 'storage';
    render();
  });

  // スキップ
  containerRef.querySelector('#photoSkipStorage').addEventListener('click', async () => {
    await saveMeasurementsAndPhotos();
    state.step = 'done';
    render();
  });

  addTouchFeedback(containerRef.querySelector('#photoNext'));
}

function measureInput(field, label, unit) {
  return `
    <div style="position:relative;">
      <label style="font-size:11px;color:#5a6272;display:block;margin-bottom:3px;">${label}</label>
      <input class="measure-input" data-field="${field}" type="number" inputmode="decimal" step="0.1"
        placeholder="0" value="${state.measurements[field] || ''}"
        style="width:100%;background:#f5f5f5;border:1px solid #dde0e6;border-radius:8px;color:#1C2541;
               padding:10px 40px 10px 12px;font-size:14px;outline:none;box-sizing:border-box;">
      <span style="position:absolute;right:10px;bottom:10px;color:#C5A258;font-size:13px;font-weight:bold;">${unit}</span>
    </div>
  `;
}

async function saveMeasurementsAndPhotos() {
  if (!state.mgmtNum) return;
  const updates = {};

  // 計測値
  const m = state.measurements;
  if (m.width)  updates.size_width  = parseFloat(m.width);
  if (m.height) updates.size_height = parseFloat(m.height);
  if (m.depth)  updates.size_depth  = parseFloat(m.depth);
  if (m.weight) updates.weight_kg   = parseFloat(m.weight);

  // 写真枚数
  const photoCount = Object.keys(state.photos).length;
  if (photoCount > 0) updates.photo_count = photoCount;

  // サイズカテゴリを計算
  if (m.width && m.height && m.depth) {
    const sum = parseFloat(m.width) + parseFloat(m.height) + parseFloat(m.depth);
    if (sum <= 60) updates.size_category = 'small';
    else if (sum <= 100) updates.size_category = 'medium';
    else if (sum <= 160) updates.size_category = 'large';
    else updates.size_category = 'xlarge';
  }

  if (Object.keys(updates).length > 0) {
    await db.updateItem(state.mgmtNum, updates);
  }
}

// ── STEP 5: 保管場所 ─────────────────────────────

function renderStorageStep() {
  const r = state.aiResult || {};
  const selectedBase = state.storageBase;
  const areas = selectedBase ? (STORAGE_AREAS[selectedBase] || []) : [];

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <button id="storageBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">保管場所</h2>
      </div>

      <!-- 管理番号 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
        <p style="color:#C5A258;font-size:20px;font-weight:bold;margin:0;">${escapeHtml(state.mgmtNum)}</p>
        <p style="color:#5a6272;font-size:13px;margin:0;">${escapeHtml(r.productName || '')} ${escapeHtml(r.maker || '')}</p>
      </div>

      <!-- 拠点選択 -->
      <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">拠点</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        ${STORAGE_BASES.map(b => `
          <button class="base-btn" data-id="${b.id}"
            style="padding:14px 8px;border-radius:10px;font-size:13px;font-weight:bold;cursor:pointer;
                   transition:all 0.15s;border:none;
                   ${selectedBase === b.id
                     ? 'background:#C5A258;color:#000;'
                     : 'background:#ffffff;color:#1C2541;border:1px solid #dde0e6;'}">
            ${escapeHtml(b.label)}
          </button>
        `).join('')}
      </div>

      <!-- エリア選択 -->
      ${selectedBase ? `
      <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">エリア</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${areas.map(a => `
          <button class="area-btn" data-area="${a}"
            style="padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;transition:all 0.15s;border:none;
                   ${state.storageArea === a
                     ? 'background:#C5A258;color:#000;font-weight:bold;'
                     : 'background:#ffffff;color:#4a4a5a;border:1px solid #dde0e6;'}">
            ${escapeHtml(a)}
          </button>
        `).join('')}
      </div>
      ` : ''}

      <!-- フリー入力 -->
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;margin-bottom:20px;">
        <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">補足メモ（棚番号・段など）</p>
        <input id="storageMemo" type="text" placeholder="例: 3段目 右端"
          value="${escapeHtml(state.storageMemo)}"
          style="width:100%;background:#f5f5f5;border:1px solid #dde0e6;border-radius:8px;color:#1C2541;
                 padding:10px 12px;font-size:14px;outline:none;box-sizing:border-box;">
      </div>

      <!-- 確定ボタン -->
      <button id="storageConfirm"
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;transition:all 0.15s;
               ${selectedBase && state.storageArea
                 ? 'background:#C5A258;color:#000;'
                 : 'background:#dde0e6;color:#8a8a8a;'}">
        保管場所を確定
      </button>
    </div>
  `;

  // 拠点ボタン
  containerRef.querySelectorAll('.base-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.storageBase = btn.dataset.id;
      state.storageArea = null;
      render();
    });
    addTouchFeedback(btn);
  });

  // エリアボタン
  containerRef.querySelectorAll('.area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.storageArea = btn.dataset.area;
      render();
    });
    addTouchFeedback(btn);
  });

  // メモ入力
  containerRef.querySelector('#storageMemo')?.addEventListener('input', (e) => {
    state.storageMemo = e.target.value;
  });

  // 戻る
  containerRef.querySelector('#storageBack').addEventListener('click', () => {
    state.step = 'photo';
    render();
  });

  // 確定
  containerRef.querySelector('#storageConfirm').addEventListener('click', handleStorageConfirm);
  addTouchFeedback(containerRef.querySelector('#storageConfirm'));
}

async function handleStorageConfirm() {
  if (!state.storageBase || !state.storageArea || !state.mgmtNum) {
    showToast('拠点とエリアを選択してください');
    return;
  }

  showLoading(containerRef, '保管場所を登録中...');

  try {
    const baseLabel = STORAGE_BASES.find(b => b.id === state.storageBase)?.label || state.storageBase;
    const location = `${baseLabel} ${state.storageArea}${state.storageMemo ? ' ' + state.storageMemo : ''}`;

    await db.updateItem(state.mgmtNum, {
      storage_location: location,
      storage_base: state.storageBase,
      storage_area: state.storageArea,
      storage_memo: state.storageMemo || null,
    });

    // 保管完了 → 写真あり: 出品待ち / 写真なし: 撮影待ち
    const photoCount = Object.keys(state.photos).length;
    const staff = getCurrentStaff();
    const nextStatus = photoCount >= 1 ? CONFIG.STATUS.LIST_WAIT : CONFIG.STATUS.PHOTO_WAIT;

    await db.updateItemStatus(state.mgmtNum, nextStatus, staff?.name || '');

    showToast('保管場所を登録しました');

    // バックグラウンドでAI出品文を自動生成（スタッフは待たない）
    (async () => {
      try {
        const item = await db.getItem(state.mgmtNum);
        if (!item || item.listing_description) return; // already has description

        // Use the first captured photo for AI context
        const photo = state.capturePhotos?.[0] || state.judgmentPhoto;
        if (!photo) return;

        const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
            'apikey': CONFIG.AWAI_KEY,
          },
          body: JSON.stringify({
            image: photo,
            images: state.capturePhotos || [photo],
            step: 'listing',
            context: {
              task: 'listing',
              productName: item.product_name || '',
              maker: item.maker || '',
              condition: item.condition || '',
              channel: item.channel_name || '',
              operationStatus: item.operation_status || '',
              operationNote: item.operation_note || '',
              size: item.product_size || '',
            },
          }),
        });

        if (!res.ok) return;
        const result = await res.json();
        const j = result.judgment || result;

        const updates = {};
        if (j.listingTitle) updates.listing_title = j.listingTitle.slice(0, 65);
        if (j.listingDescription) {
          // 識別子を説明文の先頭に追加
          const shippingSize = (state.aiResult && state.aiResult.shippingSize) || 60;
          const identifier = generateItemIdentifier(
            state.mgmtNum,
            item.shipping_cost ? shippingSize : 60,
            item.target_price || 0,
            item.market_demand || (j.marketDemand) || 2
          );
          // テンプレート自動挿入（状態・発送・取引詳細）
          const shippingTemplate = shippingSize >= 170
            ? CONFIG.LISTING_TEMPLATES.shippingArt('C', 1)
            : CONFIG.LISTING_TEMPLATES.shippingSagawa(shippingSize);

          updates.listing_description = identifier + '\n\n【商品説明】\n' + j.listingDescription
            + '\n\n' + CONFIG.LISTING_TEMPLATES.conditionNotes
            + '\n\n' + shippingTemplate
            + '\n\n' + CONFIG.LISTING_TEMPLATES.tradingNotes;
        }
        if (j.marketDemand) updates.market_demand = j.marketDemand;

        if (Object.keys(updates).length > 0) {
          await db.updateItem(state.mgmtNum, updates);
          console.log(`[自動生成] ${state.mgmtNum} の出品文を生成しました`);
        }
      } catch (e) {
        console.warn('[自動生成] 出品文の自動生成に失敗（後で手動生成可能）:', e);
      }
    })();

    state.step = 'done';
    render();
  } catch (e) {
    console.error('保管場所登録エラー:', e);
    showToast('保管場所の登録に失敗しました');
    render();
  }
}

// ── STEP 6: 完了 / 次の商品 ──────────────────────

function renderDone() {
  const r = state.aiResult || {};
  const isConsult = r && state.consultReason;
  const baseLabel = state.storageBase ? (STORAGE_BASES.find(b => b.id === state.storageBase)?.label || '') : '';
  const locationStr = state.storageArea ? `${baseLabel} ${state.storageArea}${state.storageMemo ? ' ' + state.storageMemo : ''}` : '未設定';

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <!-- 戻るボタン + 完了ヘッダ -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="doneBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">登録完了</h2>
      </div>

      <!-- 完了表示 -->
      <div style="text-align:center;padding:24px 0 16px;">
        <div style="font-size:48px;margin-bottom:8px;">${isConsult ? '📋' : '✅'}</div>
        <h2 style="color:#C5A258;font-size:20px;margin-bottom:4px;">
          ${isConsult ? '相談として登録完了' : '分荷判定完了'}
        </h2>
        <p style="color:#5a6272;font-size:13px;">次の商品に進めます</p>
      </div>

      <!-- 登録内容サマリ -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <p style="color:#C5A258;font-size:22px;font-weight:bold;margin:0;">${escapeHtml(state.mgmtNum || '—')}</p>
          ${isConsult ? statusBadge(CONFIG.STATUS.CONSULT) : statusBadge(CONFIG.STATUS.JUDGED)}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${resultRow('商品名', escapeHtml(r.productName || '—'))}
          ${resultRow('メーカー', escapeHtml(r.maker || '—'))}
          ${resultRow('販路', escapeHtml(r.channel || '—'))}
          ${resultRow('想定価格', `${formatPrice(r.estimatedPriceMin)} 〜 ${formatPrice(r.estimatedPriceMax)}`)}
          ${resultRow('写真', `${Object.keys(state.photos).length} 枚`)}
          ${resultRow('保管場所', escapeHtml(locationStr))}
          ${isConsult ? resultRow('相談理由', escapeHtml(state.consultReason || '—')) : ''}
        </table>
      </div>

      <!-- アクションボタン -->
      <button id="doneNext"
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;background:#C5A258;color:#000;transition:all 0.15s;margin-bottom:10px;">
        次の商品を判定
      </button>
      <button id="doneAddPhoto"
        style="width:100%;padding:14px;border-radius:12px;font-size:14px;
               border:1px solid #C5A258;background:transparent;color:#C5A258;cursor:pointer;margin-bottom:10px;">
        この商品の写真を追加
      </button>
      <button id="doneSetStorage"
        style="width:100%;padding:12px;border-radius:12px;font-size:13px;
               border:none;background:#e8e5dd;color:#5a6272;cursor:pointer;">
        保管場所を設定/変更
      </button>
    </div>
  `;

  // 戻る（ソース選択画面に戻る）
  containerRef.querySelector('#doneBack')?.addEventListener('click', () => {
    state = resetState();
    render();
  });

  // 次の商品
  containerRef.querySelector('#doneNext').addEventListener('click', () => {
    state = resetState();
    state.startTime = Date.now();
    render();
  });

  // 写真追加（現在の管理番号で写真ステップに戻る）
  containerRef.querySelector('#doneAddPhoto').addEventListener('click', () => {
    state.step = 'photo';
    render();
  });

  // 保管場所設定
  containerRef.querySelector('#doneSetStorage').addEventListener('click', () => {
    state.step = 'storage';
    render();
  });

  addTouchFeedback(containerRef.querySelector('#doneNext'));
  addTouchFeedback(containerRef.querySelector('#doneAddPhoto'));

  // 今日の実績を非同期更新
  loadTodayCount();
}

// ── 渡辺質店 一括登録 ────────────────────────────

function renderBulkImport() {
  const items = state.bulkItems;
  const hasItems = items.length > 0;
  const includedCount = items.filter(i => i.included).length;

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="bulkBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
        <div>
          <h2 style="color:#C5A258;font-size:18px;margin:0;">渡辺質店 一括登録</h2>
          <p style="color:#5a6272;font-size:12px;margin:0;">手書きシートから一括読み取り</p>
        </div>
      </div>

      ${!hasItems ? `
      <!-- 撮影前 -->
      <div id="bulkCaptureArea" style="background:#ffffff;border:2px dashed #C5A258;border-radius:16px;
           padding:48px 20px;text-align:center;cursor:pointer;margin-bottom:16px;">
        ${state.bulkPhoto
          ? `<img src="${state.bulkPhoto}" style="max-width:100%;max-height:300px;border-radius:8px;margin-bottom:12px;">
             <p style="color:#5a6272;font-size:13px;">タップして撮り直し</p>`
          : `<div style="font-size:48px;margin-bottom:12px;">📋</div>
             <p style="color:#C5A258;font-size:16px;font-weight:bold;">手書きシートを撮影</p>
             <p style="color:#8a8a8a;font-size:13px;">渡辺質店の商品リストシートを<br>全体が映るように撮ってください</p>`
        }
      </div>
      ${state.bulkPhoto ? `
      <button id="bulkOcrBtn" style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
             border:none;cursor:pointer;background:#C5A258;color:#000;margin-bottom:8px;">
        シートを解析する
      </button>
      ` : ''}
      <button id="bulkManualAdd" style="width:100%;padding:14px;border-radius:12px;font-size:14px;
             border:1px solid #ccc;background:transparent;color:#5a6272;cursor:pointer;">
        ✏️ 手動で商品を追加
      </button>
      ` : `
      <!-- 解析結果テーブル -->
      ${state.bulkPhoto ? `
      <div style="margin-bottom:12px;">
        <img src="${state.bulkPhoto}" style="width:80px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #dde0e6;">
      </div>
      ` : ''}
      <div style="background:#ffffff;border-radius:12px;padding:12px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:12px;margin-bottom:4px;">読み取り結果</p>
        <p style="color:#C5A258;font-size:16px;font-weight:bold;margin:0;">${items.length}件 検出（${includedCount}件 選択中）</p>
      </div>

      <div style="overflow-x:auto;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;min-width:500px;">
          <thead>
            <tr style="border-bottom:1px solid #333;">
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:center;width:36px;">✓</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:left;">品番</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:left;">商品名</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:left;width:100px;">備考</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:right;width:80px;">希望価格</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:center;width:60px;">手数料</th>
              <th style="color:#5a6272;font-size:11px;padding:8px 4px;text-align:center;width:30px;"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, i) => `
            <tr data-idx="${i}" style="border-bottom:1px solid #222;${!item.included ? 'opacity:0.4;' : ''}">
              <td style="padding:8px 4px;text-align:center;">
                <input type="checkbox" class="bulk-check" data-idx="${i}" ${item.included ? 'checked' : ''}
                  style="width:18px;height:18px;accent-color:#C5A258;">
              </td>
              <td style="padding:8px 4px;color:#5a6272;font-size:13px;">${escapeHtml(item.number)}</td>
              <td style="padding:8px 4px;">
                <input type="text" class="bulk-name" data-idx="${i}" value="${escapeHtml(item.name + (item.detail ? ' ' + item.detail : ''))}"
                  style="background:#f5f5f5;border:1px solid #dde0e6;border-radius:6px;color:#1C2541;
                         padding:6px 8px;font-size:13px;width:100%;box-sizing:border-box;outline:none;">
              </td>
              <td style="padding:8px 4px;">
                <input type="text" class="bulk-remarks" data-idx="${i}" value="${escapeHtml(item.remarks || '')}"
                  style="background:#f5f5f5;border:1px solid #dde0e6;border-radius:6px;color:#5a6272;
                         padding:6px 8px;font-size:12px;width:100%;box-sizing:border-box;outline:none;"
                  placeholder="備考">
              </td>
              <td style="padding:8px 4px;">
                <input type="number" class="bulk-price" data-idx="${i}" value="${item.price}"
                  style="background:#f5f5f5;border:1px solid #dde0e6;border-radius:6px;color:#1C2541;
                         padding:6px 8px;font-size:13px;width:70px;text-align:right;outline:none;">
              </td>
              <td style="padding:8px 4px;text-align:center;">
                <select class="bulk-rate" data-idx="${i}"
                  style="background:#f5f5f5;border:1px solid #dde0e6;border-radius:6px;color:#1C2541;
                         padding:6px 4px;font-size:12px;outline:none;">
                  ${[20,30,40,50].map(r => `<option value="${r}" ${item.commissionRate === r ? 'selected' : ''}>${r}%</option>`).join('')}
                </select>
              </td>
              <td style="padding:8px 4px;text-align:center;">
                <button class="bulk-del" data-idx="${i}" style="background:none;border:none;color:#CE2029;font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
              </td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button id="bulkAddMore" style="flex:1;padding:10px;border-radius:12px;font-size:12px;
               border:1px solid #C5A258;background:transparent;color:#C5A258;cursor:pointer;">
          📷 追加撮影
        </button>
        <button id="bulkManualAdd" style="flex:1;padding:10px;border-radius:12px;font-size:12px;
               border:1px solid #ccc;background:transparent;color:#5a6272;cursor:pointer;">
          ✏️ 手動追加
        </button>
        <button id="bulkRescan" style="flex:1;padding:10px;border-radius:12px;font-size:12px;
               border:1px solid #ccc;background:transparent;color:#5a6272;cursor:pointer;">
          🔄 最初から
        </button>
      </div>
      <button id="bulkRegister" style="width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:bold;
             border:none;cursor:pointer;background:#C5A258;color:#000;margin-bottom:12px;">
        全${includedCount}件を登録
      </button>
      `}
    </div>
  `;

  // Events
  containerRef.querySelector('#bulkBack')?.addEventListener('click', () => {
    state.step = 'source';
    state.bulkItems = [];
    state.bulkPhoto = null;
    render();
  });

  const captureArea = containerRef.querySelector('#bulkCaptureArea');
  if (captureArea) {
    captureArea.addEventListener('click', async () => {
      try {
        const file = await capturePhoto();
        if (!file) return;
        showToast('画像を処理中...');
        const base64 = await fileToBase64(file);
        state.bulkPhoto = await resizeImage(base64, 1600);
        render();
      } catch (e) {
        console.error('撮影エラー:', e);
        showToast('撮影に失敗しました');
      }
    });
    addTouchFeedback(captureArea);
  }

  containerRef.querySelector('#bulkOcrBtn')?.addEventListener('click', handleBulkOcr);

  // Table events
  containerRef.querySelectorAll('.bulk-check').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems[idx].included = e.target.checked;
      render();
    });
  });
  containerRef.querySelectorAll('.bulk-name').forEach(el => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems[idx].name = e.target.value;
    });
  });
  containerRef.querySelectorAll('.bulk-remarks').forEach(el => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems[idx].remarks = e.target.value;
    });
  });
  containerRef.querySelectorAll('.bulk-price').forEach(el => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems[idx].price = parseInt(e.target.value) || 0;
    });
  });
  containerRef.querySelectorAll('.bulk-rate').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems[idx].commissionRate = parseInt(e.target.value);
    });
  });
  containerRef.querySelectorAll('.bulk-del').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      state.bulkItems.splice(idx, 1);
      render();
    });
  });

  containerRef.querySelector('#bulkRescan')?.addEventListener('click', () => {
    state.bulkItems = [];
    state.bulkPhoto = null;
    render();
  });

  // 手動追加
  containerRef.querySelector('#bulkManualAdd')?.addEventListener('click', () => {
    const nextNum = state.bulkItems.length > 0
      ? String(Math.max(...state.bulkItems.map(i => parseInt(i.number) || 0)) + 1)
      : '';
    state.bulkItems.push({
      included: true,
      number: nextNum,
      name: '',
      condition: '',
      price: 0,
      commissionRate: 30,
    });
    render();
    // 最後の行の商品名にフォーカス
    setTimeout(() => {
      const inputs = containerRef.querySelectorAll('.bulk-name');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 100);
  });

  // 追加撮影（続きを読み取り）- 既存リストに追加、重複は品番で除外
  containerRef.querySelector('#bulkAddMore')?.addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;
      showToast('追加シートを解析中...');
      const base64 = await fileToBase64(file);
      state.bulkPhoto = await resizeImage(base64, 1600);
      await handleBulkOcr();
    } catch (e) {
      showToast('追加読み取りに失敗しました');
    }
  });

  containerRef.querySelector('#bulkRegister')?.addEventListener('click', handleBulkRegister);
  addTouchFeedback(containerRef.querySelector('#bulkRegister'));
}

async function handleBulkOcr() {
  if (!state.bulkPhoto) return;

  showLoading(containerRef, '手書きシートを解析中...');

  try {
    const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        'apikey': CONFIG.AWAI_KEY,
      },
      body: JSON.stringify({
        image: state.bulkPhoto,
        step: 'receipt',
        context: {
          task: 'この手書きの商品リストの写真です。表の全ての列・全ての行から情報を漏れなく読み取ってください。結果はJSON配列のみで返してください（説明文不要）。形式: [{"number":"品番(3桁の数字)","name":"商品名（型番・詳細・括弧内の補足情報も全て含める）","detail":"商品詳細欄の補足情報（括弧内の記述等）","price":希望販売価格の数値,"remarks":"備考欄の内容（写真枚数・箱付き・付属品・コマ数等の記載を全て）"}] 。価格が読み取れない場合はprice:0。備考や詳細が空でも空文字で入れてください。表の右端の列（備考・通番等）も必ず読み取ること。手書き文字が不鮮明でも推測して全行読み取ってください。',
        },
      }),
    });

    // Edge Functionが500を返す場合もレスポンスからデータ抽出を試みる
    let result;
    const resText = await res.text();
    try {
      result = JSON.parse(resText);
    } catch {
      // JSONパース失敗 → テキストからJSON配列を抽出
      const arrMatch = resText.match(/\[[\s\S]*?\]/);
      if (arrMatch) {
        try { result = { items: JSON.parse(arrMatch[0]) }; } catch { /* ignore */ }
      }
      if (!result) {
        throw new Error(`解析エラー (${res.status}): ${resText.slice(0, 100)}`);
      }
    }

    let items = [];
    const data = result.judgment || result.raw || result;
    if (typeof data === 'string') {
      // AIの応答テキストからJSON配列を探す
      const match = data.match(/\[[\s\S]*?\]/);
      if (match) {
        try { items = JSON.parse(match[0]); } catch {
          // JSONが不完全な場合、行ごとにパース
          const lines = match[0].replace(/[\[\]]/g, '').split(/\},?\s*\{/);
          for (const line of lines) {
            try {
              const obj = JSON.parse('{' + line.replace(/^\{/, '').replace(/\}$/, '') + '}');
              items.push(obj);
            } catch { /* skip malformed */ }
          }
        }
      }
    } else if (Array.isArray(data)) {
      items = data;
    } else if (data.items) {
      items = data.items;
    } else if (typeof data === 'object' && data.number) {
      items = [data]; // 単一商品
    }

    if (items.length === 0) {
      showToast('商品を読み取れませんでした。撮り直してください');
      render();
      return;
    }

    // 既存の品番と重複チェック（複数回撮影対応）
    const existingNumbers = new Set(state.bulkItems.map(i => i.number));
    const newItems = items.map((item, i) => ({
      included: true,
      number: item.number || item.品番 || `W${i + 1}`,
      name: item.name || item.商品名 || '',
      detail: item.detail || item.商品詳細 || '',
      condition: item.condition || item.状態 || '',
      price: parseInt(item.price || item.希望価格 || 0),
      remarks: item.remarks || item.備考 || '',
      commissionRate: 30,
    }));

    let added = 0;
    let skipped = 0;
    for (const item of newItems) {
      if (existingNumbers.has(item.number)) {
        skipped++;
      } else {
        state.bulkItems.push(item);
        existingNumbers.add(item.number);
        added++;
      }
    }

    showToast(`${added}件追加${skipped > 0 ? `（${skipped}件は重複のためスキップ）` : ''}。合計${state.bulkItems.length}件`);
    render();
  } catch (e) {
    console.error('一括OCRエラー:', e);
    showToast(e.message || 'シートの解析に失敗しました');
    render();
  }
}

async function handleBulkRegister() {
  const staff = getCurrentStaff();
  if (!staff) return;
  const items = state.bulkItems.filter(i => i.included);
  if (items.length === 0) {
    showToast('登録する商品がありません');
    return;
  }

  showLoading(containerRef, `${items.length}件を登録中...`);

  let success = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const mgmtNum = await db.generateMgmtNum('W');
      await db.createItem({
        mgmt_num: mgmtNum,
        product_name: item.name,
        condition: item.condition,
        channel_name: '渡辺質店',
        start_price: item.price,
        target_price: item.price,
        estimated_price_max: item.price,
        status: CONFIG.STATUS.PHOTO_WAIT,
        judged_by: staff.name,
        judged_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        staff_mark: CONFIG.STAFF_MARKS[staff.name] || '',
        commission_rate: item.commissionRate,
        commission_type: 'per_item',
        consignment_partner: '渡辺質店',
        partner_item_number: item.number,
        condition_note: item.remarks || '',
        memo: `渡辺品番: ${item.number}${item.remarks ? ' / 備考: ' + item.remarks : ''}`,
        source: 'bulk_import',
      });
      success++;
    } catch (e) {
      console.error(`Bulk register error for ${item.number}:`, e);
      errors++;
    }
  }

  state.bulkRegisterResult = { success, errors, total: items.length };
  showToast(`${success}件登録完了${errors > 0 ? `（${errors}件エラー）` : ''}`);
  state.step = 'done_bulk';
  render();
}

function renderDoneBulk() {
  const result = state.bulkRegisterResult || { success: 0, errors: 0, total: 0 };

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <div style="text-align:center;padding:32px 0 24px;">
        <div style="font-size:48px;margin-bottom:12px;">${result.errors > 0 ? '⚠️' : '✅'}</div>
        <h2 style="color:#C5A258;font-size:20px;margin-bottom:8px;">一括登録完了</h2>
        <p style="color:#1C2541;font-size:18px;font-weight:bold;margin-bottom:4px;">
          ${result.success} / ${result.total} 件 登録成功
        </p>
        ${result.errors > 0 ? `
        <p style="color:#CE2029;font-size:14px;">${result.errors}件 エラーあり</p>
        ` : ''}
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:20px;">
        <table style="width:100%;border-collapse:collapse;">
          ${resultRow('仕入先', '渡辺質店')}
          ${resultRow('登録方法', '一括登録（シート読み取り）')}
          ${resultRow('成功', `${result.success}件`)}
          ${result.errors > 0 ? resultRow('エラー', `${result.errors}件`) : ''}
        </table>
      </div>

      <button id="doneBulkHome"
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;background:#C5A258;color:#000;margin-bottom:10px;">
        ホームに戻る
      </button>
      <button id="doneBulkPhotoLink"
        style="width:100%;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;
               border:none;cursor:pointer;background:#2e7d32;color:#fff;margin-bottom:10px;">
        📷 写真を紐付ける
      </button>
      <button id="doneBulkContinue"
        style="width:100%;padding:14px;border-radius:12px;font-size:14px;
               border:1px solid #C5A258;background:transparent;color:#C5A258;cursor:pointer;">
        続けて一括登録
      </button>
    </div>
  `;

  containerRef.querySelector('#doneBulkHome').addEventListener('click', () => {
    state = resetState();
    render();
  });
  containerRef.querySelector('#doneBulkPhotoLink').addEventListener('click', () => {
    state.step = 'bulk_photo_link';
    render();
  });
  containerRef.querySelector('#doneBulkContinue').addEventListener('click', () => {
    state.bulkItems = [];
    state.bulkPhoto = null;
    state.bulkRegisterResult = null;
    state.step = 'bulk_import';
    render();
  });

  addTouchFeedback(containerRef.querySelector('#doneBulkHome'));
  addTouchFeedback(containerRef.querySelector('#doneBulkPhotoLink'));
  addTouchFeedback(containerRef.querySelector('#doneBulkContinue'));

  loadTodayCount();
}

// ── 写真紐付け ────────────────────────────────────

async function renderBulkPhotoLink() {
  // Get all bulk-imported Watanabe items
  const items = await db.getItems({
    channel: '渡辺質店',
    orderBy: 'partner_item_number',
    ascending: true,
    limit: 200,
  });

  const watanabeItems = items.filter(i => i.consignment_partner === '渡辺質店');
  const withPhoto = watanabeItems.filter(i => i.main_photo_url || i.drive_url);
  const withoutPhoto = watanabeItems.filter(i => !i.main_photo_url && !i.drive_url);

  containerRef.innerHTML = `
    <div style="padding:16px 16px 120px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <button id="photoLinkBack" style="background:none;border:none;color:#C5A258;font-size:22px;cursor:pointer;">←</button>
        <h2 style="color:#C5A258;font-size:18px;margin:0;">写真紐付け</h2>
        <span style="color:#5a6272;font-size:13px;margin-left:auto;">写真済み ${withPhoto.length}/${watanabeItems.length}件</span>
      </div>

      <!-- 品番で検索 -->
      <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;">
        <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">品番で商品を探す</p>
        <div style="display:flex;gap:8px;">
          <input id="photoLinkSearch" type="text" inputmode="numeric" placeholder="品番を入力（例: 821）"
            style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid #dde0e6;background:#ffffff;color:#1C2541;font-size:15px;outline:none;">
          <button id="photoLinkSearchBtn" style="padding:10px 16px;border-radius:8px;background:#C5A258;color:#000;border:none;font-weight:bold;cursor:pointer;">検索</button>
        </div>
        <button id="photoLinkOcrBtn" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:1px solid #ccc;background:transparent;color:#5a6272;font-size:13px;cursor:pointer;">
          📷 品番タグを撮影して検索
        </button>
      </div>

      <!-- 検索結果/撮影エリア (initially hidden) -->
      <div id="photoLinkResult" style="display:none;"></div>

      <!-- 未紐付けリスト -->
      <div style="margin-top:16px;">
        <p style="color:#5a6272;font-size:12px;margin-bottom:8px;">写真未登録（${withoutPhoto.length}件）</p>
        <div id="photoLinkList">
          ${withoutPhoto.map(item => `
            <div class="photo-link-item" data-num="${escapeHtml(item.partner_item_number || '')}" data-mgmt="${escapeHtml(item.mgmt_num)}"
              style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#ffffff;border-radius:8px;margin-bottom:6px;cursor:pointer;border:1px solid #222;">
              <span style="color:#CE2029;font-size:16px;">❌</span>
              <div style="flex:1;">
                <span style="color:#C5A258;font-size:12px;">${escapeHtml(item.partner_item_number || item.mgmt_num)}</span>
                <div style="font-size:13px;color:#1C2541;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.product_name)}</div>
              </div>
              <span style="color:#5a6272;font-size:12px;">${item.start_price ? '\u00a5' + item.start_price.toLocaleString() : ''}</span>
            </div>
          `).join('')}
          ${withPhoto.length > 0 ? `
            <p style="color:#8a8a8a;font-size:11px;margin-top:12px;">写真登録済み（${withPhoto.length}件）</p>
            ${withPhoto.slice(0, 5).map(item => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#ffffff;border-radius:8px;margin-bottom:4px;opacity:0.5;">
                <span style="color:#006B3F;font-size:16px;">✅</span>
                <span style="font-size:12px;color:#5a6272;">${escapeHtml(item.partner_item_number || item.mgmt_num)} ${escapeHtml(item.product_name).slice(0,20)}</span>
              </div>
            `).join('')}
            ${withPhoto.length > 5 ? `<p style="color:#8a8a8a;font-size:11px;text-align:center;">他 ${withPhoto.length - 5}件</p>` : ''}
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Events
  containerRef.querySelector('#photoLinkBack').addEventListener('click', () => {
    state.step = 'source';
    render();
  });

  // Search by number
  const searchInput = containerRef.querySelector('#photoLinkSearch');
  containerRef.querySelector('#photoLinkSearchBtn').addEventListener('click', () => {
    const num = searchInput.value.trim();
    if (num) showPhotoLinkItem(num, watanabeItems);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const num = searchInput.value.trim();
      if (num) showPhotoLinkItem(num, watanabeItems);
    }
  });

  // OCR search
  containerRef.querySelector('#photoLinkOcrBtn').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;
      showToast('品番を読み取り中...');
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 800);

      const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
          'apikey': CONFIG.AWAI_KEY,
        },
        body: JSON.stringify({
          image: resized,
          step: 'receipt',
          context: { task: 'この画像から品番（数字）を読み取ってください。品番の数字だけをJSON形式で返してください: {"number":"品番"}' },
        }),
      });

      const result = await res.json();
      const data = result.judgment || result.raw || result;
      let num = '';
      if (typeof data === 'string') {
        const match = data.match(/\d{2,}/);
        if (match) num = match[0];
      } else if (data.number) {
        num = data.number;
      }

      if (num) {
        searchInput.value = num;
        showPhotoLinkItem(num, watanabeItems);
      } else {
        showToast('品番を読み取れませんでした');
      }
    } catch (e) {
      console.error('品番OCRエラー:', e);
      showToast('読み取りに失敗しました');
    }
  });

  // Tap item in list to search
  containerRef.querySelectorAll('.photo-link-item').forEach(el => {
    el.addEventListener('click', () => {
      const num = el.dataset.num || el.dataset.mgmt;
      searchInput.value = num;
      showPhotoLinkItem(num, watanabeItems);
    });
  });
}

function showPhotoLinkItem(searchNum, allItems) {
  // Find by partner_item_number or mgmt_num
  const item = allItems.find(i =>
    i.partner_item_number === searchNum ||
    i.mgmt_num === searchNum ||
    (i.partner_item_number && i.partner_item_number.includes(searchNum))
  );

  const resultDiv = containerRef.querySelector('#photoLinkResult');
  if (!item) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<div style="background:#2a0a0a;border-radius:8px;padding:12px;color:#f88;font-size:13px;margin-bottom:12px;">品番「${escapeHtml(searchNum)}」の商品が見つかりません</div>`;
    return;
  }

  const hasPhoto = item.main_photo_url || item.drive_url;
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div style="background:#ffffff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #C5A258;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#C5A258;font-weight:bold;">品番: ${escapeHtml(item.partner_item_number || searchNum)}</span>
        <span style="color:#5a6272;font-size:12px;">${escapeHtml(item.mgmt_num)}</span>
      </div>
      <div style="font-size:15px;color:#1C2541;font-weight:bold;margin-bottom:4px;">${escapeHtml(item.product_name)}</div>
      <div style="font-size:13px;color:#5a6272;margin-bottom:12px;">希望価格: \u00a5${(item.start_price || 0).toLocaleString()}</div>

      ${hasPhoto ? '<div style="color:#006B3F;font-size:13px;margin-bottom:8px;">✅ 写真登録済み</div>' : ''}

      <div id="photoLinkPreview" style="margin-bottom:12px;"></div>

      <button id="photoLinkCapture" style="width:100%;padding:14px;border-radius:12px;font-size:15px;font-weight:bold;
             border:none;cursor:pointer;background:#C5A258;color:#000;">
        📷 商品を撮影${hasPhoto ? '（差し替え）' : ''}
      </button>
    </div>
  `;

  resultDiv.querySelector('#photoLinkCapture').addEventListener('click', async () => {
    try {
      const file = await capturePhoto();
      if (!file) return;
      showToast('写真を処理中...');
      const base64 = await fileToBase64(file);
      const resized = await resizeImage(base64, 1200);

      // Show preview
      const preview = resultDiv.querySelector('#photoLinkPreview');
      preview.innerHTML = `
        <img src="${resized}" style="width:100%;border-radius:8px;margin-bottom:8px;">
        <button id="photoLinkSave" style="width:100%;padding:12px;border-radius:8px;background:#006B3F;color:#fff;border:none;font-size:14px;font-weight:bold;cursor:pointer;">
          ✓ この写真で保存
        </button>
      `;

      preview.querySelector('#photoLinkSave').addEventListener('click', async () => {
        showToast('保存中...');

        // Upload to Drive
        try {
          await uploadToDrive(resized, item.mgmt_num, 0);
        } catch (e) {
          console.warn('Drive upload failed:', e);
        }

        // Update item with photo info
        await db.updateItem(item.mgmt_num, {
          main_photo_url: 'drive_uploaded',
          photo_count: 1,
        });

        showToast(`${item.partner_item_number || item.mgmt_num} の写真を保存しました`);

        // Refresh the list
        renderBulkPhotoLink();
      });
    } catch (e) {
      console.error('写真撮影エラー:', e);
      showToast('撮影に失敗しました');
    }
  });

  // Scroll to result
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Google Driveアップロード ──────────────────────

async function uploadToDrive(base64Image, mgmtNum, photoIndex) {
  if (!base64Image || !mgmtNum) return null;

  const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/takeback-drive`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
      'Content-Type': 'application/json',
      'apikey': CONFIG.AWAI_KEY,
    },
    body: JSON.stringify({
      managementNumber: mgmtNum,
      images: [base64Image],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Driveアップロード失敗 (${res.status}): ${errText}`);
  }

  return await res.json();
}

// ── エラー画面 ───────────────────────────────────

function renderErrorScreen(title, detail, buttons) {
  const btnHtml = buttons.map((b, i) => `
    <button class="error-btn" data-idx="${i}"
      style="flex:1;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;
             border:none;cursor:pointer;transition:all 0.15s;
             ${i === 0 ? 'background:#C5A258;color:#000;' : 'background:#dde0e6;color:#4a4a5a;'}">
      ${escapeHtml(b.label)}
    </button>
  `).join('');

  const html = `
    <div style="padding:16px 16px 100px;">
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
        <h2 style="color:#CE2029;font-size:18px;margin-bottom:8px;">${escapeHtml(title)}</h2>
        <p style="color:#5a6272;font-size:13px;line-height:1.5;word-break:break-all;">${escapeHtml(detail || '')}</p>
      </div>
      <div style="display:flex;gap:10px;">
        ${btnHtml}
      </div>
    </div>
  `;

  containerRef.innerHTML = html;

  containerRef.querySelectorAll('.error-btn').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      buttons[idx]?.action?.();
    });
  });

  return html;
}

// ── ユーティリティ ───────────────────────────────

function addTouchFeedback(el) {
  if (!el) return;
  el.addEventListener('touchstart', () => { el.style.transform = 'scale(0.97)'; el.style.opacity = '0.8'; }, { passive: true });
  el.addEventListener('touchend', () => { el.style.transform = ''; el.style.opacity = ''; }, { passive: true });
  el.addEventListener('touchcancel', () => { el.style.transform = ''; el.style.opacity = ''; }, { passive: true });
}
