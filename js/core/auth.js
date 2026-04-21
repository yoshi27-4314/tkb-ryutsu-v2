/**
 * テイクバック流通 v2 - 認証（PIN + スタッフ選択）
 */
import { CONFIG } from './config.js';

const STORAGE_KEY = 'tkb_v2_current_staff';

let currentStaff = null;

export function getCurrentStaff() {
  if (currentStaff) return currentStaff;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { currentStaff = JSON.parse(saved); return currentStaff; } catch {}
  }
  return null;
}

export function setCurrentStaff(staff) {
  currentStaff = staff;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
}

export function logout() {
  currentStaff = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function isAdmin() {
  return getCurrentStaff()?.role === 'admin';
}

export function getStaffList() {
  return CONFIG.CHANNELS ? [] : []; // DBから取得に切り替え予定
}

// PIN認証のハッシュ（簡易版 - SHA-256）
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + '_tkb_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ログイン画面を表示
export function showLoginScreen(container, onLogin) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;padding:20px;">
      <div style="text-align:center;margin-bottom:40px;">
        <div style="font-size:48px;margin-bottom:8px;">📦</div>
        <h1 style="color:#C5A258;font-size:22px;margin-bottom:4px;">テイクバック流通</h1>
        <p style="color:#666;font-size:13px;">スタッフを選択してください</p>
      </div>
      <div id="staffGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:320px;width:100%;"></div>
    </div>
  `;

  const grid = container.querySelector('#staffGrid');
  const staffConfig = [
    { name: '浅野儀頼', role: 'admin', avatar: '👤' },
    { name: '林和人', role: 'staff', avatar: '👤' },
    { name: '横山優', role: 'staff', avatar: '👤' },
    { name: '桃井侑菜', role: 'staff', avatar: '👤' },
    { name: '伊藤佐和子', role: 'staff', avatar: '👤' },
    { name: '奥村亜優李', role: 'staff', avatar: '👤' },
    { name: '平野光雄', role: 'staff', avatar: '👤', company: 'クリアメンテ' },
    { name: '松本豊彦', role: 'staff', avatar: '���', company: 'クリアメンテ' },
    { name: '北瀬孝', role: 'staff', avatar: '👤', company: 'クリアメンテ' },
  ];

  for (const staff of staffConfig) {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:16px 8px;text-align:center;color:#e0e0e0;cursor:pointer;transition:all 0.2s;';
    btn.innerHTML = `
      <div style="font-size:28px;margin-bottom:4px;">${staff.avatar}</div>
      <div style="font-size:14px;font-weight:bold;">${staff.name.split(/(?=[a-z])/)[0]}</div>
      <div style="font-size:10px;color:#888;">${staff.company || 'テイクバック'}</div>
    `;
    btn.addEventListener('click', () => {
      setCurrentStaff(staff);
      onLogin(staff);
    });
    btn.addEventListener('touchstart', () => { btn.style.transform = 'scale(0.95)'; });
    btn.addEventListener('touchend', () => { btn.style.transform = ''; });
    grid.appendChild(btn);
  }
}
