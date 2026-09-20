/**
 * Showcase Countdown 子页面
 *
 * 三行内容：
 *   1. 主标题（文本）
 *   2. 副标题（文本）
 *   3. 倒计时 mm:ss
 *
 * 全部在文件顶部的常量里手动配置，不依赖 tournament.json。
 *
 * 另外：把主标题写入 localStorage，供其它页面（如 Showcase）读取，
 * 用于匹配当前轮次。
 */

/* =========================================
   ▼▼▼ 手动配置区 ▼▼▼
   ========================================= */

// 第一行主标题（同时会广播到 localStorage，供其它页面匹配轮次）
const TITLE = 'Qualifier Showcase';

// 第二行副标题
const SUBTITLE = 'starting soon';

// 倒计时归零的目标时间（ISO 8601，带时区）
const TARGET_TIME_ISO = '2026-09-20T15:20:00+08:00';

/* =========================================
   ▲▲▲ 手动配置区结束 ▲▲▲
   ========================================= */


/* localStorage 键名：其它页面从这里读取当前标题 */
const TITLE_STORAGE_KEY = 'cyt2026.showcaseCountdown.title';


export function initShowcaseCountdown() {
  const pageEl = document.querySelector('[data-page="showcase-countdown"]');
  if (!pageEl) return;

  const elTitle    = pageEl.querySelector('#scTitle');
  const elSubtitle = pageEl.querySelector('#scSubtitle');
  const elTimer    = pageEl.querySelector('#scTimer');

  const targetTime = new Date(TARGET_TIME_ISO).getTime();

  let intervalId = null;

  /* ---------- 静态文字 ---------- */

  function renderStatic() {
    if (elTitle)    elTitle.textContent    = TITLE;
    if (elSubtitle) elSubtitle.textContent = SUBTITLE;
  }

  /* ---------- 广播标题（供其它页面读取） ---------- */

  function broadcastTitle() {
    try {
      localStorage.setItem(TITLE_STORAGE_KEY, TITLE);
    } catch (e) {
      console.warn('[ShowcaseCountdown] 写入 localStorage 失败:', e);
    }
  }

  /* ---------- 倒计时 ---------- */

function tick() {
  if (!elTimer) return;

  let diff = targetTime - Date.now();
  if (!Number.isFinite(diff) || diff < 0) diff = 0;

  const totalSec = Math.floor(diff / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  elTimer.innerHTML =
    `<span class="sc-digit">${mm[0]}</span>` +
    `<span class="sc-digit">${mm[1]}</span>` +
    `<span class="sc-colon">:</span>` +
    `<span class="sc-digit">${ss[0]}</span>` +
    `<span class="sc-digit">${ss[1]}</span>`;
  }

  /* ---------- 生命周期 ---------- */

  function start() {
    stop();
    renderStatic();
    broadcastTitle();
    tick();
    intervalId = setInterval(tick, 1000);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // 首次启动：立即广播一次标题 + 开始倒计时
  start();

  pageEl.addEventListener('page:activated', start);
  pageEl.addEventListener('page:deactivated', stop);
}