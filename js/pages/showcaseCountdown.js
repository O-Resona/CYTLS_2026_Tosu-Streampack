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

  /* 该场比赛"未开始"：队伍空 或 无比分 */
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

  /* 返回：{ label, mappoolId, time } */
  function pickCurrentPhase() {
    if (!tournamentData) return null;

    for (const phase of PHASES) {
      if (isPhaseNotStarted(phase)) {
        const pool = tournamentData.getMappool(phase.mappoolId);
        return { label: phase.label, mappoolId: phase.mappoolId, time: pool?.time || '' };
      }
    }

    /* 所有阶段都开始了 → 显示最后一个阶段 */
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

    /* Swiss Phase I → 特殊两行标题 */
    const isSwiss1 = info.mappoolId === 'swiss-1';
    const titleHTML = isSwiss1
      ? 'Qual Results &amp;<br>Swiss Phase I Showcase'
      : `${info.label} Showcase`;

    /* 存储用纯文本（供其它页面读） */
    const titlePlain = isSwiss1
      ? 'Qual Results & Swiss Phase I Showcase'
      : `${info.label} Showcase`;

    if (elTitle)    elTitle.innerHTML = titleHTML;
    if (elSubtitle) elSubtitle.textContent = SUBTITLE;

    /* 广播给其它页面 */
    try { localStorage.setItem(TITLE_STORAGE_KEY, titlePlain); } catch (e) {
      console.warn('[ShowcaseCountdown] 写入 localStorage 失败:', e);
    }

    /* 目标时间 */
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
   最终转场：Countdown → Showcase（保持原逻辑）
   ========================================= */

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
    'is-cuts-show', 'is-cuts-in', 'is-text-out'
  );
  void finalBg.offsetWidth;

  /* ---------- t=0 ---------- */

  /* finalBg 淡入（2.5s CSS transition），把视频盖住 */
  finalBg.classList.add('is-visible');

  /* 当前 page 淡出（2s CSS animation） */
  const currentPage = document.querySelector('.page.active');
  if (currentPage) currentPage.classList.add('is-fading-out');

  /* bg3 淡出（2s）+ bg4 变亮（1s），延后 600ms 启动 */
  setTimeout(() => {
    finalBg.classList.add('is-bg3-out');
  }, 600);

  /* ---------- 文字淡入 ---------- */

  /* t=2800  text.png  淡入 */
  setTimeout(() => {
    finalFore.classList.add('is-text-in');
  }, 2800);

  /* t=3500  text2.png 淡入 */
  setTimeout(() => {
    finalFore.classList.add('is-text2-in');
  }, 3500);

  /* ---------- cut 显示 + text 消失 ---------- */

  /* t=4500  cut 淡入（0.5s），同时让 text/text2 开始消失（0.3s） */
  setTimeout(() => {
    finalFore.classList.add('is-cuts-show');
    finalFore.classList.add('is-text-out');       // ← 从 7500 提前到 4500
  }, 4500);

  /* t=5000  切到 showcase（cut 已完全不透明） */
  setTimeout(() => {
    window.app?.router?.show('showcase');
  }, 5000);

  /* ---------- cut 分离 ---------- */

  /* t=6000  cut 上下分离（1.2s），露出 showcase */
  setTimeout(() => {
    finalBg.hidden = true;
    finalFore.classList.add('is-cuts-in');
  }, 6000);

  /* t=7300  分离完成 → 立即清理（原本 9000） */
  setTimeout(() => {
    finalFore.hidden = true;
    finalBg.hidden = true;
    finalBg.classList.remove('is-bg3-out', 'is-visible');
    finalFore.classList.remove(
      'is-text-in', 'is-text2-in',
      'is-cuts-show', 'is-cuts-in', 'is-text-out'
    );
    document.querySelectorAll('.page.is-fading-out').forEach(p => {
      p.classList.remove('is-fading-out');
    });
  }, 7300);
}

/* 调试：控制台执行 window.triggerFinalTransition() 立即触发转场 */
if (typeof window !== 'undefined') {
  window.triggerFinalTransition = () => {
    playFinalTransition();
  };
}