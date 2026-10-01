/**
 * Showcase Countdown 子页面
 *
 * 从 tournament.json 自动判断当前该展示哪个阶段的 showcase：
 *   1. 从 Swiss Phase I 开始
 *   2. 若该阶段所有比赛都没开始（队伍空白或无比分）→ 显示该阶段
 *   3. 否则继续往后遍历
 *   4. 所有阶段都开始了 → 显示最后一个阶段（Bracket Stage）
 *
 * 标题格式：`{阶段名} Showcase`
 * 目标时间：读 mappools[mappoolId].time
 */

const TITLE_STORAGE_KEY = 'cyt2026.showcaseCountdown.title';

/* 阶段定义 */
const PHASES = [
  {
    label:    'Swiss Phase I',
    mappoolId: 'swiss-1',
    roundIds: ['swiss-round-1', 'swiss-round-2'],
  },
  {
    label:    'Swiss Phase II',
    mappoolId: 'swiss-2',
    roundIds: ['swiss-round-3', 'swiss-round-4', 'swiss-round-5'],
  },
  {
    label:    'Bracket Stage',
    mappoolId: 'bracket',
    roundIds: ['semifinals', 'finals', 'grand-finals'],
  },
];

const SUBTITLE = 'starting soon';

export function initShowcaseCountdown({ tournamentData } = {}) {
  const pageEl = document.querySelector('[data-page="showcase-countdown"]');
  if (!pageEl) return;

  const elTitle    = pageEl.querySelector('#scTitle');
  const elSubtitle = pageEl.querySelector('#scSubtitle');
  const elTimer    = pageEl.querySelector('#scTimer');

  let intervalId = null;
  let targetTime = 0;
  let transitionTriggered = false;
  let hasSeenNonZero = false;

  /* =========================================
     判断 / 计算
     ========================================= */

  function isMatchNotStarted(m) {
    return !m.team1Acronym
        || !m.team2Acronym
        || m.team1Score == null
        || m.team2Score == null;
  }

  function isPhaseNotStarted(phase) {
    if (!tournamentData) return true;
    const matches = tournamentData.getMatches()
      .filter(m => phase.roundIds.includes(m.roundId));
    if (!matches.length) return true;
    return matches.every(isMatchNotStarted);
  }

  function pickCurrentPhase() {
    if (!tournamentData) return null;

    for (const phase of PHASES) {
      if (isPhaseNotStarted(phase)) {
        const pool = tournamentData.getMappool(phase.mappoolId);
        return { label: phase.label, mappoolId: phase.mappoolId, time: pool?.time || '' };
      }
    }

    const last = PHASES[PHASES.length - 1];
    const pool = tournamentData.getMappool(last.mappoolId);
    return { label: last.label, mappoolId: last.mappoolId, time: pool?.time || '' };
  }

  /* =========================================
     静态渲染
     ========================================= */

  function renderStatic() {
    const info = pickCurrentPhase();
    if (!info) return;

    const isSwiss1 = info.mappoolId === 'swiss-1';
    const titleHTML = isSwiss1
      ? 'Qual Results &amp;<br>Swiss Phase I Showcase'
      : `${info.label} Showcase`;

    const titlePlain = isSwiss1
      ? 'Qual Results & Swiss Phase I Showcase'
      : `${info.label} Showcase`;

    if (elTitle)    elTitle.innerHTML = titleHTML;
    if (elSubtitle) elSubtitle.textContent = SUBTITLE;

    try { localStorage.setItem(TITLE_STORAGE_KEY, titlePlain); } catch (e) {
      console.warn('[ShowcaseCountdown] 写入 localStorage 失败:', e);
    }

    if (info.time) {
      const t = new Date(info.time).getTime();
      targetTime = Number.isFinite(t) ? t : 0;
    } else {
      targetTime = 0;
    }
  }

  /* =========================================
     倒计时 tick
     ========================================= */

  function tick() {
    if (!elTimer) return;

    if (!targetTime) {
      elTimer.innerHTML =
        `<span class="sc-digit">0</span>` +
        `<span class="sc-digit">0</span>` +
        `<span class="sc-colon">:</span>` +
        `<span class="sc-digit">0</span>` +
        `<span class="sc-digit">0</span>`;
      return;
    }

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

    if (diff > 0) hasSeenNonZero = true;

    if (diff === 0 && hasSeenNonZero && !transitionTriggered) {
      transitionTriggered = true;
      stop();
      // playFinalTransition();
    }
  }

  /* =========================================
     生命周期
     ========================================= */

  function start() {
    stop();
    transitionTriggered = false;
    hasSeenNonZero = false;
    renderStatic();
    tick();
    intervalId = setInterval(tick, 1000);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  start();

  pageEl.addEventListener('page:activated', start);
  pageEl.addEventListener('page:deactivated', stop);
}

/* =========================================
   最终转场：Countdown → Showcase
   ========================================= */

const TRANSITION_TIMING = {
  bgIn:     0,      // bg4 淡入（2.5s）
  bg3Out:   600,    // bg3 淡出 + bg4 变亮
  switch:   2000,   // ← bg4 完全淡入后立即切到 showcase（观众看不到切换）
  textIn:   2100,   // text.png 淡入
  text2In:  2800,   // text2.png 淡入
  cutsShow: 4700,   // cut 滑入（0.5s → 5000 完成）
  hideOld:  5150,   // 隐藏 bg/text/text2（cut 已快闭合）
  cutsIn:   5350,   // cut 滑出（0.4s）
  cleanup:  5750,   // 清理
};

function playFinalTransition() {
  const finalBg   = document.getElementById('finalBg');
  const finalFore = document.getElementById('finalFore');
  if (!finalBg || !finalFore) return;

  /* ---------- 重置 ---------- */
  finalBg.hidden = false;
  finalFore.hidden = false;
  finalBg.classList.remove('is-bg3-out', 'is-visible');
  finalFore.classList.remove(
    'is-text-in', 'is-text2-in',
    'is-cuts-show', 'is-cuts-in', 'is-text-out',
    'is-old-hidden'
  );
  void finalBg.offsetWidth;

  /* ---------- 各阶段 ---------- */

  setTimeout(() => {
    finalBg.classList.add('is-visible');
    const currentPage = document.querySelector('.page.active');
    if (currentPage) currentPage.classList.add('is-fading-out');
  }, TRANSITION_TIMING.bgIn);

  setTimeout(() => {
    finalBg.classList.add('is-bg3-out');
  }, TRANSITION_TIMING.bg3Out);

  setTimeout(() => {
    finalFore.classList.add('is-text-in');
  }, TRANSITION_TIMING.textIn);

  setTimeout(() => {
    finalFore.classList.add('is-text2-in');
  }, TRANSITION_TIMING.text2In);

  setTimeout(() => {
    finalFore.classList.add('is-cuts-show');
    finalFore.classList.add('is-text-out');
  }, TRANSITION_TIMING.cutsShow);

  setTimeout(async () => {
    const router = window.app?.router;
    if (router) {
      await router.show('showcase');
    }

    /* 禁用 showcase 页的 fadeIn，让它瞬间完全显示 */
    const sc = document.querySelector('[data-page="showcase"]');
    if (sc) {
      sc.style.opacity   = '1';
    }
  }, TRANSITION_TIMING.switch);

  setTimeout(() => {
    finalBg.hidden = true;
    finalFore.classList.add('is-old-hidden');
  }, TRANSITION_TIMING.hideOld);

  setTimeout(() => {
    finalFore.classList.add('is-cuts-in');
  }, TRANSITION_TIMING.cutsIn);

  /* cut 滑出完成 → 清理 */
  setTimeout(() => {
    finalFore.hidden = true;
    finalBg.hidden = true;
    finalBg.classList.remove('is-bg3-out', 'is-visible');
    finalFore.classList.remove(
      'is-text-in', 'is-text2-in',
      'is-cuts-show', 'is-cuts-in', 'is-text-out',
      'is-old-hidden'
    );

    /* 恢复 showcase 页的 inline style（下次进入时还能正常 fadeIn） */
    const sc = document.querySelector('[data-page="showcase"]');
    if (sc) {
      sc.style.removeProperty('animation');
      sc.style.removeProperty('opacity');
    }

    document.querySelectorAll('.page.is-fading-out').forEach(p => {
      p.classList.remove('is-fading-out');
    });
  }, TRANSITION_TIMING.cleanup);
}

/* 调试：控制台执行 window.triggerFinalTransition() 立即触发转场 */
if (typeof window !== 'undefined') {
  window.triggerFinalTransition = playFinalTransition;
}