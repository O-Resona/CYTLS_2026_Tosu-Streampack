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
 * 玩家长条消耗也移到本文件：
 *   打图结束时把本局上场玩家写入 localStorage['cyt2026.playerRounds']，
 *   并派发 window 'player-rounds-changed'，mappool 页据此刷新长条。
 *
 * 打图结束后的切页：
 *   - 决胜（任一队 >= ceil(bestOf/2)）→ 交给 winnerWatcher
 *   - 非决胜 → 只在 spector 退出 result（previewPlaying=true）时切回 mappool
 */

import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';
import { playAutoTransition } from '../services/autoTransition.js';

const CURRENT_MATCH_KEY  = 'cyt2026.currentMatchId';
const PLAYER_ROUNDS_KEY  = 'cyt2026.playerRounds';

/* lazer mp 实测：0 = 打图中 */
const PLAYING_IPC_STATE = 0;

const EXIT_DELAY        = 10000;    /* 打图结束 → 聊天框/地图卡动画 */
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

  /* 分数元素宽度缓存：按 textContent.length 缓存，避免每帧 offsetWidth 强制回流 */
  const scoreWidthCache = {
    left:  { len: -1, width: 0 },
    right: { len: -1, width: 0 },
  };

  function getScoreWidth(side) {
    const node = scoreEl(side);
    if (!node) return 0;
    const len = node.textContent.length;
    const cache = scoreWidthCache[side];
    if (cache.len === len) return cache.width;
    cache.len = len;
    cache.width = node.offsetWidth || 0;
    return cache.width;
  }

  function scoreEl(side) {
    return side === 'left' ? el.score1 : el.score2;
  }

  function formatScore(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('en-US');
  }

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
  let transitionToken = 0;
  let hasInitStage = false;

  /* 本轮打图是否已结束（等待 spector 退出 result） */
  let _roundEnded = false;

  /* 本局参与的玩家列表（来自 osu 的 ipcClients） */
  let _lastRoundPlayers = [];

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
    stageEl.classList.remove('is-transitioning-to-a', 'is-transitioning-to-b', 'is-scores-hiding');
    if (state === 'A') {
      stageEl.classList.remove('state-b');
      statsEl?.classList.remove('is-solid');
      chatBox?.block();
    } else {
      stageEl.classList.add('state-b');
      statsEl?.classList.add('is-solid');
      if (chatBox) {
        chatBox.unblock();
        chatBox.show();
      }
    }
    currentStage = state;
  }

  async function transitionToB() {
    if (currentStage === 'B') return;
    const token = ++transitionToken;
    cancelExitTimer();

    stageEl.classList.add('is-scores-hiding');

    await sleep(150);
    if (token !== transitionToken) return;
    stageEl.classList.add('is-transitioning-to-b');

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

    if (diff <= 100000) {
      return (diff / 100000) * 400;
    }
    if (diff <= 300000) {
      const t = (diff - 100000) / 200000;
      const eased = 1 - Math.pow(1 - t, 2);
      return 400 + eased * 220;
    }
    if (diff <= 400000) {
      const t = (diff - 300000) / 100000;
      return 620 + t * 80;
    }
    return 700;
  }

  function renderScores() {
    scoreAnim.left.target  = scores.left;
    scoreAnim.right.target = scores.right;
    animateScoreTo('left');
    animateScoreTo('right');

    const diff = Math.abs(scores.left - scores.right);
    const leadingLeft  = diff > 0 && scores.left  > scores.right;
    const leadingRight = diff > 0 && scores.right > scores.left;

    el.score1.classList.toggle('is-light', leadingRight);
    el.score2.classList.toggle('is-light', leadingLeft);

    el.scoresEl.classList.toggle('is-left-leading',  leadingLeft);
    el.scoresEl.classList.toggle('is-right-leading', leadingRight);

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
      const w1 = getScoreWidth('left');
      const shift = Math.max(0, barWidth - w1 / 2 - 10);
      setBoxTransform(el.box1, `translateX(${-20 - shift}px)`);
      setBoxTransform(el.box2, 'translateX(20px)');
    } else {
      const w2 = getScoreWidth('right');
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
     本局结束 → 玩家长条消耗
     ========================================= */

  function applyPlayerRoundConsumption() {
    if (!Array.isArray(_lastRoundPlayers) || !_lastRoundPlayers.length) {
      _lastRoundPlayers = [];
      return;
    }

    const id = getCurrentMatchId();
    if (id == null) { _lastRoundPlayers = []; return; }

    const match = tournamentData.getMatch(id);
    if (!match) { _lastRoundPlayers = []; return; }

    const t1 = match.team1Acronym ? tournamentData.getTeam(match.team1Acronym) : null;
    const t2 = match.team2Acronym ? tournamentData.getTeam(match.team2Acronym) : null;

    const round = tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2) - 1;

    const norm = s => String(s ?? '').trim().toLowerCase();
    const findPlayer = (team, name) => {
      const n = norm(name);
      return (team?.players || []).find(p => norm(p.username) === n) || null;
    };

    let all = {};
    try { all = JSON.parse(localStorage.getItem(PLAYER_ROUNDS_KEY) || '{}'); } catch {}

    const sid = String(id);
    if (!all[sid]) all[sid] = {};

    let changed = false;
    for (const p of _lastRoundPlayers) {
      const name = p?.name;
      if (!name) continue;
      const matched = findPlayer(t1, name) || findPlayer(t2, name);
      if (!matched) continue;
      const canonical = matched.username;
      const used = Number(all[sid][canonical]) || 0;
      if (used >= maxStars) continue;
      all[sid][canonical] = used + 1;
      changed = true;
    }

    _lastRoundPlayers = [];

    if (!changed) return;
    try { localStorage.setItem(PLAYER_ROUNDS_KEY, JSON.stringify(all)); } catch {}
    window.dispatchEvent(new CustomEvent('player-rounds-changed'));
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
     切页判断
     ========================================= */

  function decideReturnPage() {
    const activePage = document.querySelector('.page.active');
    if (activePage?.dataset.page !== 'playing') return;

    const match = loadCurrentMatch();
    if (!match) {
      playAutoTransition(() => window.app?.router?.show('mappool'));
      return;
    }

    if (isMatchFinished(match)) return;

    playAutoTransition(() => window.app?.router?.show('mappool'));
  }

  /* =========================================
     打图状态
     ========================================= */

  function handlePlaying(isPlaying, roundPlayers) {
    /* 缓存本局参与的玩家 */
    if (isPlaying && Array.isArray(roundPlayers) && roundPlayers.length) {
      _lastRoundPlayers = roundPlayers;
    }

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
      chatBox?.block();
      previousScores.left  = scores.left;
      previousScores.right = scores.right;
      isNewRound = false;
      _roundEnded = false;
      transitionToA();
    } else {
      handleRoundEnd();
      applyPlayerRoundConsumption();   /* ← 本局结束：写 localStorage + 派发事件 */
      _roundEnded = true;
      cancelExitTimer();
      exitTimer = setTimeout(() => {
        exitTimer = null;
        transitionToB();
      }, EXIT_DELAY);
    }
  }

  /* =========================================
     spector 退出 result → 触发切页
     ========================================= */

  function handlePreviewPlaying(mapCleared) {
    if (!mapCleared) return;
    if (!_roundEnded) return;
    _roundEnded = false;
    decideReturnPage();
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