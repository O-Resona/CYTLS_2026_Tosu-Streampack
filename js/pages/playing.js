import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';

export function initPlaying({ tokenStore, tournamentState, mapInfo, tournamentData }) {
  const pageEl = document.querySelector('[data-page="playing"]');
  if (!pageEl) return;

  const stageEl = pageEl.querySelector('.pl-stage');
  if (!stageEl) return;

  /* ---------- 数据绑定 ---------- */
  const cardEl = pageEl.querySelector('.pl-map-card');
  if (cardEl) {
    const card = new MapCard(cardEl, { tournamentData, tokenStore });  // ← 多传依赖
    mapInfo.watch(info => card.render(info));
  }

  const statsEl = pageEl.querySelector('.pl-stats-panel');
  if (statsEl) {
    new StatsPanel(statsEl, { tokenStore }).mount();
  }

  /* ---------- 状态机（不变） ---------- */
  const PLAYING_IPC_STATE = 3;
  const EXIT_DELAY = 3000;
  const HALF_FADE = 500;

  let currentState = null;
  let pendingTimer = null;
  let transitionToken = 0;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function setStateImmediate(state) {
    transitionToken++;
    stageEl.classList.add('pl-no-transition');
    stageEl.classList.remove('pl-transitioning', 'state-a', 'state-b');
    stageEl.classList.add(`state-${state}`);
    void stageEl.offsetWidth;
    stageEl.classList.remove('pl-no-transition');
    currentState = state;
  }

  async function setStateAnimated(state) {
    if (state === currentState) return;
    const myToken = ++transitionToken;

    stageEl.classList.add('pl-transitioning');
    await sleep(HALF_FADE);
    if (myToken !== transitionToken) return;

    stageEl.classList.remove('state-a', 'state-b');
    stageEl.classList.add(`state-${state}`);
    currentState = state;
    void stageEl.offsetWidth;

    stageEl.classList.remove('pl-transitioning');
    await sleep(HALF_FADE);
    if (myToken !== transitionToken) return;
  }

  function handleIpcState(ipcState) {
    if (ipcState === PLAYING_IPC_STATE) {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      setStateAnimated('A');
    } else {
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        setStateAnimated('B');
      }, EXIT_DELAY);
    }
  }

  setStateImmediate(tournamentState.ipcState === PLAYING_IPC_STATE ? 'A' : 'B');
  tournamentState.onChange(handleIpcState);

  pageEl.addEventListener('page:activated', () => {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    setStateImmediate(tournamentState.ipcState === PLAYING_IPC_STATE ? 'A' : 'B');
    if (tournamentState.ipcState !== PLAYING_IPC_STATE) {
      handleIpcState(tournamentState.ipcState);
    }
  });

  pageEl.addEventListener('page:deactivated', () => {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  });
}