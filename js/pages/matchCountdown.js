/**
 * Match Countdown 子页面
 *
 * 从 localStorage['cyt2026.currentMatchId'] 读取当前比赛。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';

export function initMatchCountdown({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="match-countdown"]');
  if (!pageEl) return;

  const elRound   = pageEl.querySelector('#mcRound');
  const elTeam1   = pageEl.querySelector('#mcTeam1');
  const elTeam2   = pageEl.querySelector('#mcTeam2');
  const elDate    = pageEl.querySelector('#mcDate');
  const elHours   = pageEl.querySelector('[data-unit="hours"]');
  const elMinutes = pageEl.querySelector('[data-unit="minutes"]');
  const elSeconds = pageEl.querySelector('[data-unit="seconds"]');

  const pad2 = (n) => String(n).padStart(2, '0');

  let targetTime = null;
  let intervalId = null;

  /* ---------- 读当前比赛 ---------- */

  function pickCurrentMatch() {
    let idStr;
    try { idStr = localStorage.getItem(CURRENT_MATCH_KEY); }
    catch { return null; }
    if (!idStr) return null;
    const id = Number(idStr);
    return tournamentData.getMatch(id);
  }

  /* ---------- 渲染 ---------- */

  function renderStatic(match) {
    if (!match) {
      elRound.textContent = '';
      elTeam1.textContent = '—';
      elTeam2.textContent = '—';
      elDate.textContent  = '未选择比赛';
      targetTime = null;
      return;
    }

    const round = tournamentData.getRound(match.roundId);
    elRound.textContent = round?.name || '';
    elTeam1.textContent = match.team1Acronym || '—';
    elTeam2.textContent = match.team2Acronym || '—';

    const d = new Date(match.date);
    if (Number.isFinite(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      elDate.textContent = `${mm}/${dd} ${hh}:${mi}`;
      targetTime = d.getTime();
    } else {
      elDate.textContent = '';
      targetTime = null;
    }
  }

  /* ---------- Tick ---------- */

  function tick() {
    if (!targetTime) {
      elHours.textContent   = '00';
      elMinutes.textContent = '00';
      elSeconds.textContent = '00';
      return;
    }

    let diff = targetTime - Date.now();
    if (diff < 0) diff = 0;

    const totalSec = Math.floor(diff / 1000);
    const hours   = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    elHours.textContent   = pad2(hours);
    elMinutes.textContent = pad2(minutes);
    elSeconds.textContent = pad2(seconds);
  }

  /* ---------- 生命周期 ---------- */

  function start() {
    stop();
    renderStatic(pickCurrentMatch());
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
  pageEl.addEventListener('page:activated',   start);
  pageEl.addEventListener('page:deactivated', stop);

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY) start();
  });
}