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
 *
 * 打图结束后的切页：
 *   - 决胜（任一队 >= ceil(bestOf/2)）→ 交给 winnerWatcher
 *   - 非决胜 → PAGE_RETURN_DELAY 兜底回 mappool
 *   - 提前切：spector 退出 result、预览重新开始播放 → 立即回 mappool
 */

import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';
import { playAutoTransition } from '../services/autoTransition.js';

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';

/* lazer mp 实测：0 = 打图中 */
const PLAYING_IPC_STATE = 0;

const EXIT_DELAY        = 8000;    /* 打图结束 → 聊天框/地图卡动画 */
const PAGE_RETURN_DELAY = 13000;   /* 打图结束 → 判断切页（兜底） */
const A_TO_B_FADE       = 500;
const B_TO_A_FADE       = 500;

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
     分数数字的平滑缓冲
     ========================================= */

  const SCORE_SMOOTH = 0.15;
  const scoreAnim = {
    left:  { current: 0, target: 0, raf: null },
    right: { current: 0, target: 0, raf: null },
  };

  function scoreEl(side) {
    return side === 'left' ? el.score1 : el.score2;
  }

  /* 千分位格式化：1234567 → "1,234,567" */
  function formatScore(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('en-US');
  }

  /* 分差数字：用平滑中的分数计算，跟随缓动 */
  function updateDiffText() {
    const l = Math.round(scoreAnim.left.current);
    const r = Math.round(scoreAnim.right.current);
    const d = Math.abs(l - r);
    const leadingLeft  = d > 0 && l > r;
    const leadingRight = d > 0 && r > l;

    if (el.diff1) {
      el.diff1.textContent = leadingRight ? `-${formatScore(d)}` : '';
      el.diff1.classList.toggle('is-visible', leadingRight);
    }
    if (el.diff2) {
      el.diff2.textContent = leadingLeft ? `-${formatScore(d)}` : '';
      el.diff2.classList.toggle('is-visible', leadingLeft);
    }
  }

  function jumpScore(side, value) {
    const s = scoreAnim[side];
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = null; }
    s.current = value;
    s.target  = value;
    const node = scoreEl(side);
    if (node) node.textContent = formatScore(s.current);
    updateDiffText();
  }

  function animateScoreTo(side) {
    const s = scoreAnim[side];
    if (s.raf) return;

    const step = () => {
      const diff = s.target - s.current;

      if (Math.abs(diff) < 0.5) {
        s.current = s.target;
        const node = scoreEl(side);
        if (node) node.textContent = formatScore(s.current);
        s.raf = null;
        updateDiffText();
        return;
      }

      s.current += diff * SCORE_SMOOTH;
      const node = scoreEl(side);
      if (node) node.textContent = formatScore(s.current);
      updateDiffText();
      s.raf = requestAnimationFrame(step);
    };

    s.raf = requestAnimationFrame(step);
  }

  /* =========================================
     绿幕宽度（px 制，960 ~ 1920）
     ========================================= */

  const greenEl      = pageEl.querySelector('.pl-green-screen');
  const greenPanel   = document.getElementById('greenPanel');
  const greenRangeEl = document.getElementById('plGreenWidth');
  const greenValEl   = document.getElementById('plGreenWidthVal');
  const greenInputEl = document.getElementById('plGreenWidthInput');

  const GREEN_WIDTH_KEY = 'cyt2026.greenWidth';
  const GREEN_MIN = 960;
  const GREEN_MAX = 1920;

  function clampGreen(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return GREEN_MAX;
    return Math.min(GREEN_MAX, Math.max(GREEN_MIN, Math.round(n)));
  }

  function applyGreenWidth(v) {
    const val = clampGreen(v);

    if (greenEl) greenEl.style.width = val + 'px';
    if (greenRangeEl && greenRangeEl.value !== String(val)) {
      greenRangeEl.value = String(val);
    }
    if (greenInputEl && document.activeElement !== greenInputEl
                    && greenInputEl.value !== String(val)) {
      greenInputEl.value = String(val);
    }
    if (greenValEl) greenValEl.textContent = val + ' px';

    try { localStorage.setItem(GREEN_WIDTH_KEY, String(val)); } catch {}
  }

  function loadSavedGreen() {
    const raw = Number(localStorage.getItem(GREEN_WIDTH_KEY));
    return (raw >= GREEN_MIN && raw <= GREEN_MAX) ? raw : GREEN_MAX;
  }

  if (greenRangeEl) {
    applyGreenWidth(loadSavedGreen());
    greenRangeEl.addEventListener('input', () => {
      applyGreenWidth(greenRangeEl.value);
    });
  }

  if (greenInputEl) {
    greenInputEl.addEventListener('input', () => {
      const raw = greenInputEl.value;
      if (raw === '' || raw === '-') return;
      applyGreenWidth(raw);
    });

    greenInputEl.addEventListener('blur', () => {
      applyGreenWidth(greenInputEl.value);
    });

    greenInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        greenInputEl.blur();
      }
    });
  }

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
  let pageSwitchTimer = null;
  let transitionToken = 0;
  let hasInitStage = false;

  /* 歌曲预览播放状态（用于 spector 退出 result 后提前切回 mappool） */
  let _lastPreviewPlaying = null; 

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cancelExitTimer = () => {
    if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
  };
  const cancelPageSwitchTimer = () => {
    if (pageSwitchTimer) { clearTimeout(pageSwitchTimer); pageSwitchTimer = null; }
  };

  /* =========================================
     布局状态切换
     ========================================= */

  function setStageImmediate(state) {
    transitionToken++;
    cancelExitTimer();
    stageEl.classList.remove('is-transitioning-to-a', 'is-transitioning-to-b', 'is-scores-hiding');
    if (state === 'A') {
      stageEl.classList.remove('state-b');
      statsEl?.classList.remove('is-solid');
    } else {
      stageEl.classList.add('state-b');
      statsEl?.classList.add('is-solid');
    }
    currentStage = state;
  }

  async function transitionToB() {
    if (currentStage === 'B') return;
    const token = ++transitionToken;
    cancelExitTimer();

    /* 阶段 1：分数条开始淡出 */
    stageEl.classList.add('is-scores-hiding');

    /* 阶段 2：150ms 后 mapcard 也开始淡出 */
    await sleep(150);
    if (token !== transitionToken) return;
    stageEl.classList.add('is-transitioning-to-b');

    /* 阶段 3：mapcard 淡出完成 → 换位置 → 淡入 + chat 同时淡入 */
    await sleep(A_TO_B_FADE);
    if (token !== transitionToken) return;

    stageEl.classList.add('state-b');
    stageEl.classList.remove('is-transitioning-to-b', 'is-scores-hiding');
    currentStage = 'B';

    statsEl?.classList.add('is-solid');

    chatBox?.unblock();
    chatBox?.show();

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

    stageEl.classList.remove('state-b', 'is-transitioning-to-a', 'is-scores-hiding');
    currentStage = 'A';

    statsEl?.classList.remove('is-solid');

    await sleep(B_TO_A_FADE);
    if (token !== transitionToken) return;
  }

  /* =========================================
     分数条宽度：分段增长
     ========================================= */

  function computeBarWidth(diff) {
    if (diff <= 0) return 0;

    /* 0 ~ 10w：最敏感，线性 → 0 ~ 400px */
    if (diff <= 100000) {
      return (diff / 100000) * 400;
    }

    /* 10w ~ 30w：增长变慢 → 400 ~ 620px */
    if (diff <= 300000) {
      const t = (diff - 100000) / 200000;
      const eased = 1 - Math.pow(1 - t, 2);
      return 400 + eased * 220;
    }

    /* 30w ~ 40w：极慢 → 620 ~ 700px */
    if (diff <= 400000) {
      const t = (diff - 300000) / 100000;
      return 620 + t * 80;
    }

    /* 40w+：封顶 */
    return 700;
  }

  function renderScores() {
    /* 数字：平滑变动 */
    scoreAnim.left.target  = scores.left;
    scoreAnim.right.target = scores.right;
    animateScoreTo('left');
    animateScoreTo('right');

    /* 用真实分数判定领先 */
    const diff = Math.abs(scores.left - scores.right);
    const leadingLeft  = diff > 0 && scores.left  > scores.right;
    const leadingRight = diff > 0 && scores.right > scores.left;

    el.score1.classList.toggle('is-light', leadingRight);
    el.score2.classList.toggle('is-light', leadingLeft);

    el.scoresEl.classList.toggle('is-left-leading',  leadingLeft);
    el.scoresEl.classList.toggle('is-right-leading', leadingRight);

    /* diff 文本交给 updateDiffText 每帧刷（不在这里写） */

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

  function setBoxTransform(boxEl, value) {
    if (boxEl.dataset.lastTransform === value) return;
    boxEl.dataset.lastTransform = value;
    boxEl.style.transform = value;
  }

  /* =========================================
     结算 → 自动加星
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

  /* 判断当前比赛是否处于决胜状态 */
  function isMatchFinished(match) {
    if (!match) return false;
    const round = tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2);
    const s1 = Number(match.team1Score) || 0;
    const s2 = Number(match.team2Score) || 0;
    return (s1 >= maxStars) || (s2 >= maxStars);
  }

  /* =========================================
     切页判断（兜底）
     ========================================= */

  function decideReturnPage() {
    const activePage = document.querySelector('.page.active');
    if (activePage?.dataset.page !== 'playing') return;

    const match = loadCurrentMatch();
    if (!match) {
      playAutoTransition(() => window.app?.router?.show('mappool'));
      return;
    }

    /* 决胜局 → 交给 winnerWatcher */
    if (isMatchFinished(match)) return;

    /* 非决胜局 → 回 mappool */
    playAutoTransition(() => window.app?.router?.show('mappool'));
  }

  /* =========================================
     歌曲预览重新播放 → 提前切回 mappool
     ========================================= */

  function handlePreviewPlaying(isPreview) {
    const prev = _lastPreviewPlaying;
    _lastPreviewPlaying = isPreview;

    /* 只在 false → true 上升沿触发 */
    if (!isPreview || prev) return;

    /* 只在 still 在 playing 页 */
    const activePage = document.querySelector('.page.active');
    if (activePage?.dataset.page !== 'playing') return;

    /* 只在打过图之后的非打图状态 */
    if (!hasInitStage) return;
    if (currentIpcState === PLAYING_IPC_STATE) return;

    /* 决胜局不响应预览切页，交给 winnerWatcher */
    const match = loadCurrentMatch();
    if (isMatchFinished(match)) return;

    /* 取消已排好的 PAGE_RETURN_DELAY 兜底，立即切回 mappool */
    cancelPageSwitchTimer();
    playAutoTransition(() => window.app?.router?.show('mappool'));
  }

  /* =========================================
     打图状态
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
      // 进入打图：立即 block + A；取消上一次排好的切页
      cancelPageSwitchTimer();
      chatBox?.block();
      previousScores.left  = scores.left;
      previousScores.right = scores.right;
      isNewRound = false;
      transitionToA();
    } else {
      // 打图结束：延迟 → 依次 分数条隐藏 → mapcard 移动 → chat 出现
      handleRoundEnd();
      cancelExitTimer();
      exitTimer = setTimeout(() => {
        exitTimer = null;
        transitionToB();
      }, EXIT_DELAY);

      // 打图结束 → 兜底切页
      cancelPageSwitchTimer();
      pageSwitchTimer = setTimeout(() => {
        pageSwitchTimer = null;
        decideReturnPage();
      }, PAGE_RETURN_DELAY);
    }
  }

  /* =========================================
     刷新
     ========================================= */

  function refresh() {
    currentMatch = loadCurrentMatch();

    if (!currentMatch) {
      scores.left  = 0;
      scores.right = 0;

      jumpScore('left',  0);
      jumpScore('right', 0);

      el.diff1.textContent = '';
      el.diff2.textContent = '';
      el.diff1.classList.remove('is-visible');
      el.diff2.classList.remove('is-visible');
      return;
    }

    scores.left  = Number(currentMatch.team1Score) || 0;
    scores.right = Number(currentMatch.team2Score) || 0;

    jumpScore('left',  scores.left);
    jumpScore('right', scores.right);

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
    }
    if (greenPanel) greenPanel.hidden = false;
  });

  pageEl.addEventListener('page:deactivated', () => {
    cancelExitTimer();
    cancelPageSwitchTimer();
    if (greenPanel) greenPanel.hidden = true;
  });

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY) refresh();
  });

  if (pageEl.classList.contains('active') && greenPanel) {
    greenPanel.hidden = false;
  }

  if (osuSocket) {
    osuSocket.on('playing',        handlePlaying);
    osuSocket.on('gameplay',       handleGameplay);
    osuSocket.on('previewPlaying', handlePreviewPlaying);
  }
}