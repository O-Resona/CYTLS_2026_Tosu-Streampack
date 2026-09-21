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
const TITLE = 'Qualifiers Showcase';

// 第二行副标题
const SUBTITLE = 'starting soon';

// 倒计时归零的目标时间（ISO 8601，带时区）
const TARGET_TIME_ISO = '2026-09-21T21:46:00+08:00';

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

let transitionTriggered = false;
let hasSeenNonZero = false;       // ← 新增：是否曾经有过剩余时间

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

  // 记录「曾经有过剩余时间」
  if (diff > 0) {
    hasSeenNonZero = true;
  }

  // 只有「曾经有过时间，现在归零」才触发转场
  if (diff === 0 && hasSeenNonZero && !transitionTriggered) {
    transitionTriggered = true;
    stop();
    playFinalTransition();
  }
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

/* =========================================
   最终转场：Countdown → Showcase
   ========================================= */

function playFinalTransition() {
  const finalBg   = document.getElementById('finalBg');
  const finalFore = document.getElementById('finalFore');
  if (!finalBg || !finalFore) return;

  // 重置
  finalBg.hidden = false;
  finalFore.hidden = false;
  finalBg.classList.remove('is-bg3-out');
  finalFore.classList.remove('is-text-in', 'is-text2-in', 'is-cuts-in', 'is-text-out');
  void finalBg.offsetWidth;

  // 让当前 page 也淡出（和 bg3 同步，3s）
  const currentPage = document.querySelector('.page.active');
  if (currentPage) currentPage.classList.add('is-fading-out');

  // t=0      bg3 + page 一起淡出（3s）
  finalBg.classList.add('is-bg3-out');

  // t=3000   text.png 淡入（1s）
  setTimeout(() => finalFore.classList.add('is-text-in'), 3000);

  // t=4000   text2.png 淡入（1s）
  setTimeout(() => finalFore.classList.add('is-text2-in'), 4000);

  // t=7000   （text2 完成后停留 2s）cut 从两侧滑入（1s）
  setTimeout(() => finalFore.classList.add('is-cuts-in'), 7000);

  // t=8000   cut 对齐 → 切页 + text/text2 消失
  setTimeout(() => {
    window.app?.router?.show('showcase');
    finalBg.hidden = true;
    finalFore.classList.add('is-text-out');      // ← text/text2 消失
  }, 8000);

  // t=9000   cut 停留结束 → 倒退滑出（1s）
  setTimeout(() => {
    finalFore.classList.remove('is-cuts-in');
  }, 9000);

  // t=10000  清理
  setTimeout(() => {
    finalFore.hidden = true;
    finalBg.hidden = true;
    finalBg.classList.remove('is-bg3-out');
    finalFore.classList.remove('is-text-in', 'is-text2-in', 'is-cuts-in', 'is-text-out');

    document.querySelectorAll('.page.is-fading-out').forEach(p => {
      p.classList.remove('is-fading-out');
    });
  }, 10000);
}