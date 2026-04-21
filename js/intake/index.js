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
  { id: 'jisha',    label: '自社仕入',       category: 'jisha' },
  { id: 'bigsport', label: 'ビッグスポーツ', category: 'itaku' },
  { id: 'watanabe', label: '渡辺質店',       category: 'itaku' },
  { id: 'shimachiyo', label: 'シマチヨ',     category: 'kojin' },
];

const STORAGE_BASES = [
  { id: 'atsumi', label: '厚見倉庫' },
  { id: 'honjo',  label: '本荘倉庫' },
  { id: 'yanaizu', label: '柳津倉庫' },
];

const STORAGE_AREAS = {
  atsumi: [
    ...Array.from({ length: 28 }, (_, i) => `A${i + 1}`),
    '倉庫奥', '2階',
  ],
  honjo: ['H1', 'H2', 'H3', '倉庫奥'],
  yanaizu: ['Y1', 'Y2', 'Y3'],
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
    judgmentPhoto: null,   // base64
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
  };
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
    containerRef.innerHTML = '<p style="color:#f44;text-align:center;padding:40px;">ログインしてください</p>';
    return;
  }

  switch (state.step) {
    case 'source':   renderSourceSelect();  break;
    case 'capture':  renderCapture();       break;
    case 'result':   renderResult();        break;
    case 'photo':    renderPhotoStep();     break;
    case 'storage':  renderStorageStep();   break;
    case 'done':     renderDone();          break;
    default:         renderSourceSelect();
  }
}

// ── STEP 1: 仕入先選択 ───────────────────────────

function renderSourceSelect() {
  state = resetState();
  state.startTime = Date.now();

  const btns = SOURCE_TYPES.map(s => `
    <button class="intake-source-btn" data-id="${s.id}" data-cat="${s.category}"
      style="background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px 12px;
             text-align:center;color:#e0e0e0;cursor:pointer;transition:all 0.15s;font-size:15px;font-weight:bold;">
      ${escapeHtml(s.label)}
    </button>
  `).join('');

  containerRef.innerHTML = `
    <div style="padding:16px 16px 100px;">
      <h2 style="color:#C5A258;font-size:18px;margin-bottom:4px;">入荷 - 分荷判定</h2>
      <p style="color:#888;font-size:13px;margin-bottom:20px;">仕入先を選択してください</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${btns}
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
}

function renderTodayCount() {
  return `
    <div id="intakeTodayStats" style="margin-top:24px;padding:16px;background:#1a1a2e;border-radius:12px;">
      <p style="color:#888;font-size:12px;margin-bottom:8px;">今日の分荷実績</p>
      <div style="display:flex;align-items:baseline;gap:4px;">
        <span id="intakeCountNum" style="color:#C5A258;font-size:28px;font-weight:bold;">—</span>
        <span style="color:#888;font-size:13px;">/ ${CONFIG.DAILY_KPI.bunka} 個目標</span>
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
          <p style="color:#888;font-size:12px;margin:0;">仕入先: ${escapeHtml(srcLabel)}</p>
        </div>
      </div>

      <!-- 撮影エリア -->
      <div id="captureArea" style="background:#1a1a2e;border:2px dashed #333;border-radius:16px;
           padding:40px 20px;text-align:center;cursor:pointer;margin-bottom:16px;transition:border-color 0.2s;">
        ${state.judgmentPhoto
          ? `<img src="${state.judgmentPhoto}" style="max-width:100%;max-height:300px;border-radius:8px;">`
          : `<div style="font-size:48px;margin-bottom:12px;">📷</div>
             <p style="color:#aaa;font-size:15px;font-weight:bold;">タップして撮影</p>
             <p style="color:#666;font-size:12px;">商品全体が映るように撮ってください</p>`
        }
      </div>

      ${isBook ? `
      <!-- バーコードスキャン（書籍用） -->
      <div style="background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="color:#aaa;font-size:13px;margin-bottom:8px;">📖 書籍の場合: バーコード / ISBN</p>
        <div style="display:flex;gap:8px;">
          <input id="barcodeInput" type="text" inputmode="numeric" placeholder="ISBN / バーコード番号"
            value="${escapeHtml(state.barcode)}"
            style="flex:1;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;
                   padding:10px 12px;font-size:14px;outline:none;">
          <button id="barcodeScan" style="background:#333;border:none;border-radius:8px;color:#C5A258;
                  padding:10px 14px;font-size:18px;cursor:pointer;">📸</button>
        </div>
      </div>
      ` : ''}

      <!-- AI判定ボタン -->
      <button id="judgeBtn" ${!state.judgmentPhoto ? 'disabled' : ''}
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;transition:all 0.2s;
               ${state.judgmentPhoto
                 ? 'background:#C5A258;color:#000;'
                 : 'background:#333;color:#666;cursor:not-allowed;'}">
        AI判定を実行
      </button>
    </div>
  `;

  // イベント
  containerRef.querySelector('#intakeBack').addEventListener('click', () => {
    state.step = 'source';
    render();
  });

  const captureArea = containerRef.querySelector('#captureArea');
  captureArea.addEventListener('click', handleCapturePhoto);
  addTouchFeedback(captureArea);

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
    state.judgmentPhoto = await resizeImage(base64, 1200);
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
    const body = {
      image: state.judgmentPhoto,
      sourceType: state.sourceCategory === 'jisha' ? 'jisha' : 'itaku',
      context: {
        staffName: staff.name,
        sourceId: state.sourceType,
        barcode: state.barcode || null,
      },
    };

    const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/ai-judgment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI判定エラー (${res.status}): ${errText}`);
    }

    state.aiResult = await res.json();
    state.step = 'result';
    render();
  } catch (e) {
    console.error('AI判定失敗:', e);
    containerRef.innerHTML = renderErrorScreen(
      'AI判定に失敗しました',
      e.message,
      [
        { label: '再試行', action: () => { state.step = 'capture'; render(); handleAIJudgment(); } },
        { label: '撮り直す', action: () => { state.step = 'capture'; state.judgmentPhoto = null; render(); } },
      ]
    );
  }
}

// ── STEP 3: AI判定結果表示 ────────────────────────

function renderResult() {
  const r = state.aiResult;
  if (!r) { state.step = 'capture'; render(); return; }

  const confidence = r.confidence ?? 0;
  const confidenceColor = confidence >= 0.8 ? '#4caf50' : confidence >= 0.6 ? '#ff9800' : '#f44336';
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
        ${state.judgmentPhoto ? `<img src="${state.judgmentPhoto}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #333;">` : ''}
        <div style="flex:1;">
          <p style="color:#e0e0e0;font-size:17px;font-weight:bold;margin-bottom:2px;">${escapeHtml(r.productName || '不明')}</p>
          <p style="color:#aaa;font-size:13px;margin:0;">${escapeHtml(r.maker || '')} ${escapeHtml(r.modelNumber || '')}</p>
          <p style="color:#888;font-size:12px;margin:0;">${escapeHtml(r.category || '')}</p>
        </div>
      </div>

      <!-- 信頼度バー -->
      <div style="background:#1a1a2e;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="color:#888;font-size:12px;">AI信頼度</span>
          <span style="color:${confidenceColor};font-size:14px;font-weight:bold;">${confidencePct}%</span>
        </div>
        <div style="background:#222;border-radius:4px;height:6px;overflow:hidden;">
          <div style="background:${confidenceColor};height:100%;width:${confidencePct}%;border-radius:4px;transition:width 0.5s;"></div>
        </div>
      </div>

      <!-- 詳細情報 -->
      <div style="background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:12px;">
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
      <div style="background:#1a1a2e;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#888;font-size:11px;margin-bottom:4px;">AIコメント</p>
        <p style="color:#ccc;font-size:13px;line-height:1.5;margin:0;">${escapeHtml(r.explanation)}</p>
      </div>
      ` : ''}

      <!-- 浅野承認が必要な場合の警告 -->
      ${needsApproval ? `
      <div style="background:#f4433622;border:1px solid #f44336;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
        <p style="color:#f44336;font-size:13px;font-weight:bold;margin-bottom:4px;">⚠ 浅野さんの確認が必要</p>
        <p style="color:#ffcdd2;font-size:12px;margin:0;">${escapeHtml(needsApproval)}</p>
      </div>
      ` : ''}

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
                   border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;">
            再判定
          </button>
        </div>
        <button id="resultReshoot"
          style="width:100%;padding:12px;border-radius:12px;font-size:13px;
                 border:none;background:#222;color:#888;cursor:pointer;">
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
  containerRef.querySelector('#resultOk').addEventListener('click', () => handleConfirm(needsApproval));
  containerRef.querySelector('#resultConsult').addEventListener('click', handleConsult);
  containerRef.querySelector('#resultRetry').addEventListener('click', () => {
    state.aiResult = null;
    handleAIJudgment();
  });
  containerRef.querySelector('#resultReshoot').addEventListener('click', () => {
    state.judgmentPhoto = null;
    state.aiResult = null;
    state.step = 'capture';
    render();
  });

  addTouchFeedback(containerRef.querySelector('#resultOk'));
  addTouchFeedback(containerRef.querySelector('#resultConsult'));
  addTouchFeedback(containerRef.querySelector('#resultRetry'));
}

function resultRow(label, value) {
  return `
    <tr>
      <td style="color:#888;font-size:12px;padding:6px 0;white-space:nowrap;vertical-align:top;width:80px;">${label}</td>
      <td style="color:#e0e0e0;font-size:14px;padding:6px 0;">${value}</td>
    </tr>
  `;
}

function condColor(cond) {
  const map = { S: '#4caf50', A: '#8bc34a', B: '#ff9800', C: '#f44336', D: '#9e9e9e' };
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
  const staff = getCurrentStaff();
  if (!staff) return;
  const r = state.aiResult;

  showLoading(containerRef, '登録中...');

  try {
    // 管理番号を採番
    const mgmtNum = await db.generateMgmtNum();
    if (!mgmtNum) throw new Error('管理番号の採番に失敗しました');
    state.mgmtNum = mgmtNum;

    // 商品レコード作成
    const item = {
      mgmt_num: mgmtNum,
      status: needsApproval ? CONFIG.STATUS.CONSULT : CONFIG.STATUS.JUDGED,
      source_type: state.sourceType,
      source_category: state.sourceCategory,
      product_name: r.productName || '',
      maker: r.maker || '',
      model_number: r.modelNumber || '',
      category: r.category || '',
      condition_rank: r.condition || '',
      channel_name: r.channel || '',
      score: r.score ?? null,
      ai_confidence: r.confidence ?? null,
      estimated_price_min: r.estimatedPriceMin ?? null,
      estimated_price_max: r.estimatedPriceMax ?? null,
      start_price: r.startPrice ?? null,
      target_price: r.targetPrice ?? null,
      ai_explanation: r.explanation || '',
      barcode: state.barcode || null,
      judged_by: staff.name,
      judged_at: new Date().toISOString(),
      consult_reason: needsApproval || null,
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
      work_date: new Date().toISOString().slice(0, 10),
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
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#1a1a2e;border-radius:16px;padding:24px;max-width:360px;width:100%;">
      <h3 style="color:#C5A258;font-size:16px;margin-bottom:12px;">相談メモ</h3>
      <textarea id="consultText" rows="4" placeholder="迷っている点、確認したい内容を記入..."
        style="width:100%;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;
               padding:12px;font-size:14px;resize:none;outline:none;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="consultCancel" style="flex:1;padding:12px;border-radius:8px;background:#333;color:#ccc;border:none;font-size:14px;cursor:pointer;">キャンセル</button>
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
        source_type: state.sourceType,
        source_category: state.sourceCategory,
        product_name: r.productName || '',
        maker: r.maker || '',
        model_number: r.modelNumber || '',
        category: r.category || '',
        condition_rank: r.condition || '',
        channel_name: r.channel || '',
        score: r.score ?? null,
        ai_confidence: r.confidence ?? null,
        estimated_price_min: r.estimatedPriceMin ?? null,
        estimated_price_max: r.estimatedPriceMax ?? null,
        start_price: r.startPrice ?? null,
        target_price: r.targetPrice ?? null,
        ai_explanation: r.explanation || '',
        barcode: state.barcode || null,
        judged_by: staff.name,
        judged_at: new Date().toISOString(),
        consult_reason: reason || '相談依頼',
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
        work_date: new Date().toISOString().slice(0, 10),
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
        style="background:#1a1a2e;border:${hasPhoto ? '2px solid #C5A258' : '1px dashed #444'};
               border-radius:12px;overflow:hidden;cursor:pointer;transition:all 0.15s;aspect-ratio:1;">
        ${hasPhoto
          ? `<img src="${state.photos[slot.key]}" style="width:100%;height:100%;object-fit:cover;">`
          : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:8px;">
               <span style="font-size:24px;color:#555;">📷</span>
               <span style="font-size:11px;color:#666;margin-top:4px;">${escapeHtml(slot.label)}</span>
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
      <div style="background:#1a1a2e;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <p style="color:#C5A258;font-size:20px;font-weight:bold;margin:0;">${escapeHtml(state.mgmtNum)}</p>
            <p style="color:#aaa;font-size:13px;margin:0;">${escapeHtml(r.productName || '')} ${escapeHtml(r.maker || '')}</p>
          </div>
          ${statusBadge(CONFIG.STATUS.JUDGED)}
        </div>
      </div>

      <!-- 写真グリッド -->
      <p style="color:#888;font-size:12px;margin-bottom:8px;">写真（正面は必須）</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;">
        ${photoCards}
      </div>

      <!-- 計測入力 -->
      <div style="background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="color:#888;font-size:12px;margin-bottom:10px;">サイズ計測</p>
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
               border:none;background:#222;color:#888;cursor:pointer;">
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
      <input class="measure-input" data-field="${field}" type="number" inputmode="decimal" step="0.1"
        placeholder="${label}" value="${state.measurements[field] || ''}"
        style="width:100%;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;
               padding:10px 36px 10px 12px;font-size:14px;outline:none;box-sizing:border-box;">
      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#666;font-size:12px;">${unit}</span>
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
      <div style="background:#1a1a2e;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
        <p style="color:#C5A258;font-size:20px;font-weight:bold;margin:0;">${escapeHtml(state.mgmtNum)}</p>
        <p style="color:#aaa;font-size:13px;margin:0;">${escapeHtml(r.productName || '')} ${escapeHtml(r.maker || '')}</p>
      </div>

      <!-- 拠点選択 -->
      <p style="color:#888;font-size:12px;margin-bottom:8px;">拠点</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        ${STORAGE_BASES.map(b => `
          <button class="base-btn" data-id="${b.id}"
            style="padding:14px 8px;border-radius:10px;font-size:13px;font-weight:bold;cursor:pointer;
                   transition:all 0.15s;border:none;
                   ${selectedBase === b.id
                     ? 'background:#C5A258;color:#000;'
                     : 'background:#1a1a2e;color:#e0e0e0;border:1px solid #333;'}">
            ${escapeHtml(b.label)}
          </button>
        `).join('')}
      </div>

      <!-- エリア選択 -->
      ${selectedBase ? `
      <p style="color:#888;font-size:12px;margin-bottom:8px;">エリア</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${areas.map(a => `
          <button class="area-btn" data-area="${a}"
            style="padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;transition:all 0.15s;border:none;
                   ${state.storageArea === a
                     ? 'background:#C5A258;color:#000;font-weight:bold;'
                     : 'background:#1a1a2e;color:#ccc;border:1px solid #333;'}">
            ${escapeHtml(a)}
          </button>
        `).join('')}
      </div>
      ` : ''}

      <!-- フリー入力 -->
      <div style="background:#1a1a2e;border-radius:12px;padding:14px 16px;margin-bottom:20px;">
        <p style="color:#888;font-size:12px;margin-bottom:8px;">補足メモ（棚番号・段など）</p>
        <input id="storageMemo" type="text" placeholder="例: 3段目 右端"
          value="${escapeHtml(state.storageMemo)}"
          style="width:100%;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;
                 padding:10px 12px;font-size:14px;outline:none;box-sizing:border-box;">
      </div>

      <!-- 確定ボタン -->
      <button id="storageConfirm"
        style="width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:bold;
               border:none;cursor:pointer;transition:all 0.15s;
               ${selectedBase && state.storageArea
                 ? 'background:#C5A258;color:#000;'
                 : 'background:#333;color:#666;'}">
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

    // ステータスを撮影待ちに更新（写真が撮れていれば出品待ちに）
    const photoCount = Object.keys(state.photos).length;
    const staff = getCurrentStaff();
    const nextStatus = photoCount >= 1 ? CONFIG.STATUS.PHOTO_WAIT : CONFIG.STATUS.JUDGED;

    await db.updateItemStatus(state.mgmtNum, nextStatus, staff?.name || '');

    showToast('保管場所を登録しました');
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
      <!-- 完了表示 -->
      <div style="text-align:center;padding:24px 0 16px;">
        <div style="font-size:48px;margin-bottom:8px;">${isConsult ? '📋' : '✅'}</div>
        <h2 style="color:#C5A258;font-size:20px;margin-bottom:4px;">
          ${isConsult ? '相談として登録完了' : '分荷判定完了'}
        </h2>
        <p style="color:#888;font-size:13px;">次の商品に進めます</p>
      </div>

      <!-- 登録内容サマリ -->
      <div style="background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:16px;">
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
               border:none;background:#222;color:#888;cursor:pointer;">
        保管場所を設定/変更
      </button>
    </div>
  `;

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

// ── Google Driveアップロード ──────────────────────

async function uploadToDrive(base64Image, mgmtNum, photoIndex) {
  if (!base64Image || !mgmtNum) return null;

  const res = await fetch(`${CONFIG.AWAI_URL}/functions/v1/upload-to-drive`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.AWAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: base64Image,
      mgmtNum,
      photoIndex,
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
             ${i === 0 ? 'background:#C5A258;color:#000;' : 'background:#333;color:#ccc;'}">
      ${escapeHtml(b.label)}
    </button>
  `).join('');

  const html = `
    <div style="padding:16px 16px 100px;">
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
        <h2 style="color:#f44336;font-size:18px;margin-bottom:8px;">${escapeHtml(title)}</h2>
        <p style="color:#888;font-size:13px;line-height:1.5;word-break:break-all;">${escapeHtml(detail || '')}</p>
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
