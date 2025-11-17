// script.js — full rewritten, robust Telegram WebApp client with Socket.io, toasts, and Persian date/time
// Features:
// - Safe Telegram.WebApp initialization
// - Reliable retrieval of Telegram user data
// - Socket.io client connection and user_join emit
// - Display of real-time toast notifications from server
// - UI updates, live clock, Persian date conversion
// - Graceful fallbacks when not running inside Telegram

/* global io */

// ---------- Global state ----------
let currentUser = null;
let telegramApp = null;
let isTelegramEnvironment = false;
let socket = null;

// ---------- Helpers ----------
function safeLog(...args) { try { console.log(...args); } catch (e) {} }
function $(id) { return document.getElementById(id); }

// ---------- Telegram detection & init ----------
function checkTelegramEnvironment() {
  safeLog('🔍 Checking Telegram environment...');

  // Standard WebApp
  if (window.Telegram && window.Telegram.WebApp) {
    telegramApp = window.Telegram.WebApp;
    safeLog('✅ Telegram.WebApp detected (standard)');
    return true;
  }

  // Legacy
  if (window.TelegramWebApp) {
    telegramApp = window.TelegramWebApp;
    safeLog('✅ TelegramWebApp detected (legacy)');
    return true;
  }

  // URL params fallback (rare)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('tgWebAppData') || urlParams.has('tgWebAppVersion') || urlParams.has('tgUser')) {
    safeLog('⚠️ Telegram-like URL params detected (best-effort)');
    return true; // treat as telegram-like but telegramApp may be undefined
  }

  safeLog('❌ Not running inside Telegram WebApp');
  return false;
}

function initializeTelegramApp() {
  if (!telegramApp) {
    safeLog('❌ telegramApp object not available for initialization');
    return false;
  }

  try {
    telegramApp.ready?.();
    // Expand only if available
    telegramApp.expand?.();

    // Safe MainButton usage
    if (telegramApp.MainButton) {
      try {
        telegramApp.MainButton.setText('بازگشت به تلگرام');
        telegramApp.MainButton.show();
        telegramApp.MainButton.onClick(() => telegramApp.close?.());
      } catch (e) {
        safeLog('⚠️ MainButton methods not fully supported:', e);
      }
    }

    // UI colors — call only if available
    try { telegramApp.setHeaderColor?.('#667eea'); } catch (e) { /* ignore */ }
    try { telegramApp.setBackgroundColor?.('#0b1220'); } catch (e) { /* ignore */ }

    safeLog('✅ Telegram WebApp initialized');
    return true;
  } catch (err) {
    safeLog('❌ Error initializing Telegram WebApp:', err);
    return false;
  }
}

function getTelegramUserData() {
  if (!telegramApp) {
    safeLog('telegramApp unavailable — cannot read user data');
    return null;
  }

  // Prefer initDataUnsafe if available
  const unsafe = telegramApp.initDataUnsafe;
  if (unsafe && unsafe.user) {
    const u = unsafe.user;
    return {
      telegram_id: u.id,
      full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || (u.username || 'کاربر'),
      username: u.username || 'ندارد',
      language_code: u.language_code || 'fa',
      is_bot: !!u.is_bot,
      raw: u
    };
  }

  // Last resort: try to parse initData (signed) — not implemented here for security
  safeLog('⚠️ initDataUnsafe.user not found');
  return null;
}

// ---------- Socket.IO (real-time) ----------
function initSocketConnection(serverUrl) {
  try {
    // If socket already exists, disconnect first
    if (socket && socket.connected) {
      safeLog('Socket already connected');
      return socket;
    }

    // Load socket.io client global 'io' must be included in index.html
    if (typeof io === 'undefined') {
      safeLog('❌ socket.io client (io) is not loaded. Please include /socket.io/socket.io.js or CDN.');
      return null;
    }

    socket = io(serverUrl || '/');

    socket.on('connect', () => {
      safeLog('🔌 Connected to realtime server (socket.id=' + socket.id + ')');

      // Emit user_join when we have currentUser
      if (currentUser && currentUser.telegram_id) {
        socket.emit('user_join', {
          userId: String(currentUser.telegram_id),
          fullname: currentUser.full_name || currentUser.username || 'کاربر'
        });
      }
    });

    socket.on('disconnect', (reason) => {
      safeLog('🔌 Socket disconnected:', reason);
    });

    // Server-initiated toast
    socket.on('toast', (payload) => {
      safeLog('🔔 toast received:', payload);
      if (payload && payload.message) {
        showToast(payload.message);
      }
    });

    // Generic event log
    socket.on('message', (m) => safeLog('socket message:', m));

    return socket;
  } catch (err) {
    safeLog('❌ initSocketConnection error:', err);
    return null;
  }
}

// ---------- Toasts & Notifications ----------
function showNotification(message, type = 'info', duration = 4000) {
  // Use top-level notification area if exists
  const notif = $('notification');
  const text = $('notificationText');
  if (!notif || !text) {
    // fallback to toast
    showToast(message, { duration });
    return;
  }

  // color mapping
  const bg = {
    success: 'linear-gradient(135deg,#28a745,#20c997)',
    error: 'linear-gradient(135deg,#dc3545,#e83e8c)',
    warning: 'linear-gradient(135deg,#ffc107,#fd7e14)',
    info: 'linear-gradient(135deg,#17a2b8,#6f42c1)'
  }[type] || 'linear-gradient(135deg,#6f42c1,#17a2b8)';

  notif.style.background = bg;
  text.textContent = message;
  notif.classList.remove('hidden');
  notif.classList.add('show');

  setTimeout(() => { hideNotification(); }, duration);
}
function hideNotification() {
  const notif = $('notification');
  if (!notif) return;
  notif.classList.remove('show');
  setTimeout(() => notif.classList.add('hidden'), 300);
}

// Toast stack (bottom-right)
function showToast(message, opts = {}) {
  const containerId = 'toastContainer';
  let container = $(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.style.position = 'fixed';
    container.style.bottom = '22px';
    container.style.right = '22px';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.style.minWidth = '260px';
  toast.style.maxWidth = '420px';
  toast.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))';
  toast.style.border = '1px solid rgba(255,255,255,0.04)';
  toast.style.backdropFilter = 'blur(6px)';
  toast.style.padding = '12px 14px';
  toast.style.borderRadius = '12px';
  toast.style.color = '#eaf2ff';
  toast.style.boxShadow = '0 10px 30px rgba(2,6,23,0.6)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(12px)';
  toast.style.transition = 'transform .24s ease, opacity .24s ease';

  const txt = document.createElement('div');
  txt.textContent = message;
  txt.style.fontWeight = '600';
  txt.style.fontSize = '14px';
  toast.appendChild(txt);

  container.appendChild(toast);

  // show animation
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  const duration = opts.duration || 4500;
  const timeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => { toast.remove(); }, 260);
  }, duration);

  // click to dismiss
  toast.addEventListener('click', () => {
    clearTimeout(timeout);
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => { toast.remove(); }, 240);
  });
}

// ---------- Persian Date Utilities ----------
function pad(n){ return String(n).padStart(2, '0'); }
function gregorian_to_jalali(gy, gm, gd){
  var g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
  var jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  var gy2 = (gm > 2) ? (gy + 1) : gy;
  var days = (365 * gy) + (parseInt((gy2 + 3) / 4)) - (parseInt((gy2 + 99) / 100))
    + (parseInt((gy2 + 399) / 400)) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * (parseInt(days / 12053));
  days %= 12053;
  jy += 4 * (parseInt(days / 1461));
  days %= 1461;
  jy += parseInt((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  var jm = (days < 186) ? 1 + parseInt(days / 31) : 7 + parseInt((days - 186) / 30);
  var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}
function toPersianDate(gDate){
  const d = (gDate instanceof Date) ? gDate : new Date(gDate);
  const [jy,jm,jd] = gregorian_to_jalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  const months = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  return { year: jy, month: jm, day: jd, monthName: months[jm-1], formatted: `${jd} ${months[jm-1]} ${jy}` };
}

// ---------- Live clock ----------
function updateLiveClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('fa-IR');
  if ($('currentTime')) $('currentTime').textContent = t;
  if ($('persianDate')) $('persianDate').textContent = toPersianDate(now).formatted;
}

// ---------- Server API helpers ----------
async function apiPost(url, body){
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) { safeLog('apiPost error', url, err); return null; }
}
async function apiGet(url){
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) { safeLog('apiGet error', url, err); return null; }
}

// ---------- Load & sync user ----------
async function syncUserWithServerSafe(userData){
  const r = await apiPost('/api/user', userData);
  return r; // server should return saved user object
}

async function fetchUserFromServer(telegramId){
  return await apiGet(`/api/user/${telegramId}`);
}

async function getUserDataFlow(){
  safeLog('👤 getUserDataFlow start');
  isTelegramEnvironment = checkTelegramEnvironment();

  if (isTelegramEnvironment) {
    initializeTelegramApp();
    const tgUser = getTelegramUserData();
    if (tgUser) {
      safeLog('✅ Telegram user:', tgUser);
      // attempt to sync with server
      const synced = await syncUserWithServerSafe(tgUser);
      if (synced) return synced;
      // fallback to telegram data enriched
      return {
        ...tgUser,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        game_score: 0,
        is_active: true
      };
    }
  }

  // Not telegram or failed — try query param
  const params = new URLSearchParams(window.location.search);
  const tid = params.get('tgid') || params.get('id') || params.get('tgUserId');
  if (tid) {
    const serverUser = await fetchUserFromServer(tid);
    if (serverUser) return serverUser;
  }

  // Final fallback: test user
  return {
    telegram_id: 123456789,
    full_name: 'کاربر تست',
    username: 'test_user',
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    game_score: Math.floor(Math.random()*1000),
    is_active: false
  };
}

// ---------- UI update ----------
function updateUserInterface(user){
  if (!user) return;
  if ($('userId')) $('userId').textContent = user.telegram_id || '';
  if ($('fullName')) $('fullName').textContent = user.full_name || '';
  if ($('username')) $('username').textContent = user.username || '';
  if ($('gameScore')) $('gameScore').textContent = user.game_score ?? 0;
  if ($('userName')) $('userName').textContent = user.full_name || user.username || '';

  // modal fields
  if ($('modalUserId')) $('modalUserId').textContent = user.telegram_id || '';
  if ($('modalFullName')) $('modalFullName').textContent = user.full_name || '';
  if ($('modalUsername')) $('modalUsername').textContent = user.username || '';
  if ($('modalGameScore')) $('modalGameScore').textContent = user.game_score ?? 0;

  if (user.first_seen && $('firstSeen')) $('firstSeen').textContent = toPersianDate(user.first_seen).formatted;
  if (user.last_seen && $('lastSeen')) $('lastSeen').textContent = toPersianDate(user.last_seen).formatted;
}

// ---------- Public actions ----------
async function loadUserData() {
  safeLog('👤 Loading user data...');
  try {
    const u = await getUserDataFlow();
    currentUser = u;
    updateUserInterface(u);

    // Connect to realtime server (same origin default)
    initSocketConnection();

    // If connected and server wants join broadcast, emit user_join
    if (socket && socket.connected && currentUser && currentUser.telegram_id) {
      socket.emit('user_join', { userId: String(currentUser.telegram_id), fullname: currentUser.full_name });
    }

    // friendly welcome
    if (u && u.telegram_id !== 123456789) showNotification(`خوش آمدی ${u.full_name}! 🎉`, 'success', 3000);
    else showNotification('در حال کار با دادهٔ تست (خارج از تلگرام)', 'info', 4000);
  } catch (err) {
    safeLog('loadUserData error', err);
    showNotification('خطا در بارگذاری اطلاعات کاربر', 'error');
  }
}

// ---------- Misc features (score simulate, stats) ----------
async function simulateGame() {
  if (!currentUser) { showNotification('کاربر موجود نیست لطفاً صبر کنید', 'warning'); return; }
  const newScore = Math.floor(Math.random()*1000) + 10;
  const res = await apiPost(`/api/user/${currentUser.telegram_id}/score`, { score: newScore });
  if (res && res.new_score !== undefined) {
    currentUser.game_score = res.new_score;
    if ($('gameScore')) $('gameScore').textContent = res.new_score;
    if ($('modalGameScore')) $('modalGameScore').textContent = res.new_score;
    showNotification(`🎯 امتیاز شما ${res.new_score} شد`, 'success');
  } else {
    showNotification('خطا در ثبت امتیاز', 'error');
  }
}

async function loadStats() {
  const s = await apiGet('/api/stats');
  if (!s) return;
  if ($('totalUsers')) $('totalUsers').textContent = s.total_users ?? '-';
  if ($('onlineUsers')) $('onlineUsers').textContent = s.online_users ?? '-';
}

// ---------- Modal helpers ----------
function showUserModal() { const m = $('userModal'); if (m) m.style.display = 'block'; }
function closeUserModal() { const m = $('userModal'); if (m) m.style.display = 'none'; }
function showTimeModal() { const m = $('timeModal'); if (!m) return; const now = new Date(); if ($('modalPersianDate')) $('modalPersianDate').textContent = toPersianDate(now).formatted; if ($('modalCurrentTime')) $('modalCurrentTime').textContent = new Date().toLocaleString('fa-IR'); m.style.display = 'block'; }
function closeTimeModal() { const m = $('timeModal'); if (m) m.style.display = 'none'; }

// Close modals by clicking outside
window.addEventListener('click', function(e){
  const userModal = $('userModal'); const timeModal = $('timeModal');
  if (e.target === userModal) closeUserModal(); if (e.target === timeModal) closeTimeModal();
});

// ---------- Init on DOMContentLoaded ----------
document.addEventListener('DOMContentLoaded', async () => {
  safeLog('🚀 App initializing...');

  // Live clock
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // Load user data + socket connect
  await loadUserData();

  // Stats loader
  await loadStats();
  setInterval(loadStats, 30000);

  safeLog('✅ App initialized');
});

// Keyboard shortcuts
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeUserModal(); closeTimeModal(); } });

// Expose some functions for debugging in console
window.__app = { getUserDataFlow, loadUserData, showToast, showNotification, simulateGame, initSocketConnection };
