/**
 * Playing 子页面
 *
 * 布局状态：
 *   A（打图中）：左下地图卡 | 右下四维
 *   B（未开始/结束）：左下聊天框 | 右下四维，地图卡叠在四维上方
 *
 * 队伍 HUD（头像/名称/星星）与聊天框由全局组件负责，
 * 本文件不再维护队伍/聊天相关的 DOM。
 *
 * 自动加星逻辑仍在本文件：
 *   打图结束比较双方比分，赢家调用 teamHud.incrementStar()
 */

import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';

/* lazer mp 实测：0 = 打图中 */
const PLAYING_IPC_STATE = 0;

const EXIT_DELAY  = 4000;
const A_TO_B_FADE = 500;
const B_TO_A_FADE = 500;

export function initPlaying({
  tokenStore,
  tournamentState,
  mapInfo,
  tournamentData,
  osuSocket,
  teamHud,
  chatBox
}) {
  const pageEl = document.querySelector('[data-page="playing"]');
  if (!pageEl) return;

  const stageEl = pageEl.querySelector('.pl-stage');
  if (!stageEl) return;

  /* =========================================
     DOM（地图卡 / 分数 / 四维）
     ========================================= */

  const el = {
    score1:   pageEl.querySelector('#plScore1'),
    score2:   pageEl.querySelector('#plScore2'),
    diff1:    pageEl.querySelector('#plDiff1'),
    diff2:    pageEl.querySelector('#plDiff2'),
    bar:      pageEl.querySelector('#plScoreBar'),
    box1:     pageEl.querySelector('.pl-score-box--left'),
    box2:     pageEl.querySelector('.pl-score-box--right'),
    scoresEl: pageEl.querySelector('.pl-scores'),
  };

  /* =========================================
     地图卡片 + 四维
     ========================================= */

  const cardEl = pageEl.querySelector('.pl-map-card');
  if (cardEl) {
    const card = new MapCard(cardEl, { tournamentData, tokenStore });
    mapInfo.watch(info => card.render(info));
  }

  const statsEl = pageEl.querySelector('.pl-stats-panel');
  if (statsEl) {
    new StatsPanel(statsEl, { tokenStore }).mount();
  }

  /* =========================================
     状态
     ========================================= */

  let currentMatch = null;

  let scores = { left: 0, right: 0 };
  let previousScores = { left: 0, right: 0 };
  let isNewRound = false;

  let currentIpcState = 11;
  let currentStage = null;
  let exitTimer = null;
  let transitionToken = 0;
  let hasInitStage = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cancelExitTimer = () => {
    if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
  };

  /* =========================================
     布局状态切换
     ========================================= */

  function setStageImmediate(state) {
    transitionToken++;
    cancelExitTimer();
    stageEl.classList.remove('is-transitioning-to-a', 'is-transitioning-to-b');
    if (state === 'A') stageEl.classList.remove('state-b');
    else               stageEl.classList.add('state-b');
    currentStage = state;
  }

  async function transitionToB() {
    if (currentStage === 'B') return;
    const token = ++transitionToken;
    cancelExitTimer();

    stageEl.classList.add('is-transitioning-to-b');
    await sleep(A_TO_B_FADE);
    if (token !== transitionToken) return;

    stageEl.classList.add('state-b');
    stageEl.classList.remove('is-transitioning-to-b');
    currentStage = 'B';

    await sleep(A_TO_B_FADE);
    if (token !== transitionToken) return;
  }

  async function transitionToA() {
    if (currentStage === 'A') return;
    const token = ++transitionToken;
    cancelExitTimer();

    stageEl.classList.add('is-transitioning-to-a');
    await sleep(B_TO_A_FADE);
    if (token !== transitionToken) return;

    stageEl.classList.remove('state-b', 'is-transitioning-to-a');
    currentStage = 'A';

    await sleep(B_TO_A_FADE);
    if (token !== transitionToken) return;
  }

   /* =========================================
     分数
     ========================================= */

  function computeBarWidth(diff) {
    if (diff <= 0) return 0;
    if (diff <= 300000) {
      return (diff / 300000) * 400;
    }
    if (diff <= 600000) {
      const t = (diff - 300000) / 300000;
      const eased = 1 - Math.pow(1 - t, 2);
      return 400 + eased * 300;
    }
    return 700;
  }

  function renderScores() {
    el.score1.textContent = String(scores.left);
    el.score2.textContent = String(scores.right);

    const diff = Math.abs(scores.left - scores.right);
    const leadingLeft  = diff > 0 && scores.left  > scores.right;
    const leadingRight = diff > 0 && scores.right > scores.left;

    /* ---------- class 切换（toggle 不会重复触发） ---------- */

    el.score1.classList.toggle('is-light', leadingRight);
    el.score2.classList.toggle('is-light', leadingLeft);

    el.diff1.textContent = leadingRight ? `-${diff}` : '';
    el.diff2.textContent = leadingLeft  ? `-${diff}` : '';
    el.diff1.classList.toggle('is-visible', leadingRight);
    el.diff2.classList.toggle('is-visible', leadingLeft);

    el.scoresEl.classList.toggle('is-left-leading',  leadingLeft);
    el.scoresEl.classList.toggle('is-right-leading', leadingRight);

    /* ---------- 分数条 ---------- */

    if (diff === 0) {
      el.bar.style.width = '0px';
      el.bar.style.transform = 'translateX(0)';
      setBoxTransform(el.box1, 'translateX(-20px)');
      setBoxTransform(el.box2, 'translateX(20px)');
      return;
    }

    const barWidth = computeBarWidth(diff);
    el.bar.style.width = barWidth + 'px';
    el.scoresEl.style.setProperty('--bar-w', barWidth + 'px');

    if (leadingLeft) {
      el.bar.style.backgroundColor = '#AE1318';
      el.bar.style.transform = 'translateX(-100%)';
    } else {
      el.bar.style.backgroundColor = '#1661AB';
      el.bar.style.transform = 'translateX(0)';
    }

    /* ---------- 分数盒位移 ---------- */

    if (leadingLeft) {
      const w1 = el.score1.offsetWidth || 0;
      const shift = Math.max(0, barWidth - w1 / 2 - 10);
      setBoxTransform(el.box1, `translateX(${-20 - shift}px)`);
      setBoxTransform(el.box2, 'translateX(20px)');
    } else {
      const w2 = el.score2.offsetWidth || 0;
      const shift = Math.max(0, barWidth - w2 / 2 - 10);
      setBoxTransform(el.box2, `translateX(${20 + shift}px)`);
      setBoxTransform(el.box1, 'translateX(-20px)');
    }
  }

  /* 值没变就不写，避免无谓地打断 transition */
  function setBoxTransform(boxEl, value) {
    if (boxEl.dataset.lastTransform === value) return;
    boxEl.dataset.lastTransform = value;
    boxEl.style.transform = value;
  }

  /* =========================================
     结算 → 自动加星（走 TeamHud）
     ========================================= */

  function handleRoundEnd() {
    if (isNewRound) { isNewRound = false; return; }

    const leftDiff  = scores.left  - previousScores.left;
    const rightDiff = scores.right - previousScores.right;

    if (leftDiff > rightDiff) {
      teamHud?.incrementStar('left');
    } else if (rightDiff > leftDiff) {
      teamHud?.incrementStar('right');
    }

    previousScores.left  = scores.left;
    previousScores.right = scores.right;
  }

  /* =========================================
     实时比分
     ========================================= */

  function handleGameplay({ left, right }) {
    if (currentIpcState !== PLAYING_IPC_STATE) return;

    scores.left  = left;
    scores.right = right;
    renderScores();
  }

  /* =========================================
     打图状态（osuSocket 'playing' 事件传入 boolean）
     ========================================= */

  function handlePlaying(isPlaying) {
    const newState = isPlaying ? PLAYING_IPC_STATE : 11;

    if (!hasInitStage) {
      hasInitStage = true;
      currentIpcState = newState;
      setStageImmediate(isPlaying ? 'A' : 'B');
      isPlaying ? chatBox?.block() : chatBox?.unblock();
      return;
    }

    const oldState = currentIpcState;
    if (newState === oldState) return;
    currentIpcState = newState;

    if (isPlaying) {
      // 进入打图：立即 block + A
      chatBox?.block();
      previousScores.left  = scores.left;
      previousScores.right = scores.right;
      isNewRound = false;
      transitionToA();
    } else {
      // 打图结束：延迟 4s → unblock + 显示 + B
      handleRoundEnd();
      cancelExitTimer();
      exitTimer = setTimeout(() => {
        exitTimer = null;
        chatBox?.unblock();
        chatBox?.show();            // 立即显形（applyHud 会再 show 一次，也无所谓）
        transitionToB();
      }, EXIT_DELAY);
    }
  }

  /* =========================================
     当前比赛
     ========================================= */

  function getCurrentMatchId() {
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      return v ? Number(v) : null;
    } catch { return null; }
  }

  function loadCurrentMatch() {
    const id = getCurrentMatchId();
    if (id == null) return null;
    return tournamentData.getMatch(id);
  }

  /* =========================================
     刷新
     ========================================= */

  function refresh() {
    currentMatch = loadCurrentMatch();

    if (!currentMatch) {
      scores.left  = 0;
      scores.right = 0;
      el.score1.textContent = '0';
      el.score2.textContent = '0';
      el.diff1.textContent = '';
      el.diff2.textContent = '';
      el.diff1.classList.remove('is-visible');
      el.diff2.classList.remove('is-visible');
      return;
    }

    scores.left  = Number(currentMatch.team1Score) || 0;
    scores.right = Number(currentMatch.team2Score) || 0;

    renderScores();
  }

  /* =========================================
     初始状态
     ========================================= */

  setStageImmediate('B');
  refresh();

  /* =========================================
     事件
     ========================================= */

  pageEl.addEventListener('page:activated', () => {
    refresh();
    if (hasInitStage) {
      setStageImmediate(currentIpcState === PLAYING_IPC_STATE ? 'A' : 'B');
      if (isA) chatBox?.hide();
    }
  });

  pageEl.addEventListener('page:deactivated', () => {
    cancelExitTimer();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY) refresh();
  });

  if (osuSocket) {
    osuSocket.on('playing',  handlePlaying);
    osuSocket.on('gameplay', handleGameplay);
  }
}