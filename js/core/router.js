/**
 * テイクバック流通 v2 - ルーター（画面遷移管理）
 * ブラウザ戻るボタン対応
 */

const routes = {};
let currentRoute = null;
let routeStack = [];

export function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(name, params = {}) {
  if (!routes[name]) {
    console.error(`Route not found: ${name}`);
    return;
  }

  // 履歴に追加
  routeStack.push({ name, params });
  window.history.pushState({ route: name, params }, '', `#${name}`);

  currentRoute = name;
  routes[name](params);

  // ボトムナビのアクティブ状態更新
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === name);
  });
}

export function goBack() {
  if (routeStack.length > 1) {
    routeStack.pop();
    const prev = routeStack[routeStack.length - 1];
    window.history.back();
    if (routes[prev.name]) {
      currentRoute = prev.name;
      routes[prev.name](prev.params);
    }
  }
}

export function getCurrentRoute() { return currentRoute; }

// ブラウザ戻るボタン対応
window.addEventListener('popstate', (e) => {
  if (e.state?.route && routes[e.state.route]) {
    currentRoute = e.state.route;
    routeStack.pop();
    routes[e.state.route](e.state.params || {});
  }
});
