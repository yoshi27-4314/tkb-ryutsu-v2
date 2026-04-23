/**
 * テイクバック流通 v2 - 共通UIコンポーネント
 */

// --- トースト通知 ---
let toastTimeout = null;
export function showToast(message, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity 0.3s;max-width:90%;text-align:center;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

// --- ローディング ---
export function showLoading(container, text = '読み込み中...') {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;color:#888;">
      <div class="spinner" style="width:32px;height:32px;border:3px solid #333;border-top-color:#C5A258;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <p style="margin-top:12px;font-size:13px;">${text}</p>
    </div>
  `;
}

// --- 確認ダイアログ ---
export function showConfirm(message, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#1a1a2e;border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center;">
      <p style="color:#e0e0e0;font-size:15px;margin-bottom:20px;line-height:1.5;">${message}</p>
      <div style="display:flex;gap:12px;">
        <button id="confirmCancel" style="flex:1;padding:12px;border-radius:8px;background:#333;color:#ccc;border:none;font-size:14px;cursor:pointer;">キャンセル</button>
        <button id="confirmOk" style="flex:1;padding:12px;border-radius:8px;background:#C5A258;color:#000;border:none;font-size:14px;font-weight:bold;cursor:pointer;">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmOk').addEventListener('click', () => { overlay.remove(); onConfirm?.(); });
  overlay.querySelector('#confirmCancel').addEventListener('click', () => { overlay.remove(); onCancel?.(); });
}

// --- ステータスバッジ ---
export function statusBadge(status) {
  const colors = {
    '分荷確定': '#2196f3', '撮影待ち': '#2196f3', '受取済み': '#2196f3',
    '出品待ち': '#ff9800', '出品作業中': '#ff9800',
    '出品中': '#4caf50',
    '落札済み': '#9c27b0', '入金待ち': '#9c27b0', '入金確認済み': '#9c27b0',
    '梱包待ち': '#e91e63', '梱包中': '#e91e63', '梱包完了': '#e91e63',
    '発送済み': '#00bcd4',
    '完了': '#4caf50',
    '確認/相談': '#f44336',
  };
  const color = colors[status] || '#888';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;background:${color}22;color:${color};">${status}</span>`;
}

// --- 金額フォーマット ---
export function formatPrice(num) {
  if (num == null || isNaN(num)) return '—';
  return '¥' + Number(num).toLocaleString();
}

// --- 日時フォーマット ---
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

// --- 空状態表示 ---
export function emptyState(icon, message) {
  return `
    <div style="text-align:center;padding:60px 20px;color:#666;">
      <div style="font-size:48px;margin-bottom:12px;">${icon}</div>
      <p style="font-size:14px;">${message}</p>
    </div>
  `;
}

// --- HTMLエスケープ ---
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- スワイプで戻るジェスチャー ---
export function enableSwipeBack(element, onSwipeRight) {
  let startX = 0;
  let startY = 0;
  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  element.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (dx > 80 && dy < 50 && startX < 30) {
      onSwipeRight();
    }
  }, { passive: true });
}

// --- カメラ撮影 ---
export function capturePhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', () => {
      if (input.files[0]) {
        resolve(input.files[0]);
      } else {
        resolve(null);
      }
    });
    input.click();
  });
}

// --- ファイルをBase64に変換 ---
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- 画像リサイズ ---
export function resizeImage(base64, maxWidth = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxWidth) { resolve(base64); return; }
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = base64;
  });
}

// --- リードタイム計算 ---
export function calcLeadTime(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const days = Math.floor((new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}

export function renderLeadTimes(item) {
  const rows = [];
  const lt = (label, from, to) => {
    const days = calcLeadTime(from, to);
    if (days !== null) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;"><span style="color:#888;">${label}</span><span style="color:${days > 7 ? '#f44336' : days > 3 ? '#ff9800' : '#4caf50'};">${days}日</span></div>`);
  };
  lt('分荷→出品', item.judged_at, item.listed_at);
  lt('出品→落札', item.listed_at, item.sold_at);
  lt('落札→梱包', item.sold_at, item.packed_at);
  lt('梱包→発送', item.packed_at, item.shipped_at);

  const total = calcLeadTime(item.judged_at, item.completed_at || item.shipped_at);
  if (total !== null) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-top:1px solid #333;margin-top:4px;padding-top:6px;"><span style="color:#C5A258;font-weight:bold;">トータル</span><span style="color:#C5A258;font-weight:bold;">${total}日</span></div>`);

  if (rows.length === 0) return '';
  return `<div style="background:#1a1a2e;border-radius:8px;padding:10px 12px;margin-top:8px;"><div style="color:#888;font-size:11px;margin-bottom:4px;">リードタイム</div>${rows.join('')}</div>`;
}
