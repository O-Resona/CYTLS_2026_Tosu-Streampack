/**
 * Match Countdown 子页面
 *
 * 从 tournamentData.getMatches() 里选下一场比赛，自动倒计时。
 *
 * 选择优先级：
 *   1. current === true 的对局
 *   2. completed === false 且 date > now 中最早的一场
 *   3. 全部过期时，取最早的一场（仅显示日期，倒计时归零）
 */
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

  /* ---------- 找下一场比赛 ---------- */

  function pickNextMatch() {
    const matches = tournamentData.getMatches();
    if (!matches.length) return null;

    // 1. 正在进行的
    const current = matches.find(m => m.current === true && m.date);
    if (current) return current;

    const now = Date.now();

    // 2. 未来最早
    const upcoming = matches
      .filter(m => !m.completed && m.date)
      .map(m => ({ m, t: new Date(m.date).getTime() }))
      .filter(x => Number.isFinite(x.t) && x.t > now)
      .sort((a, b) => a.t - b.t);

    if (upcoming.length) return upcoming[0].m;

    // 3. 最早的一场
    const anyDate = matches
      .filter(m => m.date)
      .map(m => ({ m, t: new Date(m.date).getTime() }))
      .filter(x => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t);

    return anyDate[0]?.m || null;
  }

  /* ---------- 渲染 ---------- */

function renderStatic(match) {
  if (!match) {
    elRound.textContent = '';
    elTeam1.textContent = '—';
    elTeam2.textContent = '—';
    elDate.textContent  = '暂无比赛安排';
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
  if (!elTimer) return;

  let diff = targetTime - Date.now();
  if (!Number.isFinite(diff) || diff < 0) diff = 0;

  const totalSec = Math.floor(diff / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  // 每个字符独立 span，宽度由 CSS 控制
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
    renderStatic(pickNextMatch());
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
}