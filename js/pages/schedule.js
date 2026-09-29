/**
 * Schedule 子页面
 *
 * 按轮次分组展示所有比赛（队名 / seed / 时间）。
 * 点击某场 → 设为当前比赛（写入 cyt2026.currentMatchId），
 * 再点一次 → 取消选中。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

export function initSchedule({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="schedule"]');
  if (!pageEl) return;

  const layoutEl = pageEl.querySelector('#schLayout');
  if (!layoutEl) return;

  let currentMatchId = null;

  /* ---------- 当前比赛 ---------- */

  function loadCurrentMatchId() {
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      currentMatchId = v ? Number(v) : null;
    } catch { currentMatchId = null; }
  }

  function setCurrentMatchId(id) {
    currentMatchId = id;
    try {
      if (id == null) localStorage.removeItem(CURRENT_MATCH_KEY);
      else            localStorage.setItem(CURRENT_MATCH_KEY, String(id));
    } catch (e) { console.warn('[Schedule] write failed:', e); }
  }

  /* ---------- 格式化 ---------- */

  function formatDate(iso) {
    if (!iso) return 'TBD';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 'TBD';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---------- 渲染 ---------- */

  function render() {
    loadCurrentMatchId();
    layoutEl.innerHTML = '';

    const rounds  = tournamentData.getRounds();
    const matches = tournamentData.getMatches();

    for (const round of rounds) {
      const roundMatches = matches.filter(m => m.roundId === round.id);
      if (!roundMatches.length) continue;

      layoutEl.appendChild(buildGroup(round, roundMatches));
    }
  }

  function buildGroup(round, matches) {
    const groupEl = document.createElement('div');
    groupEl.className = 'sch-group';

    const titleEl = document.createElement('div');
    titleEl.className = 'sch-group__title';
    titleEl.textContent = String(round.name || round.id).toUpperCase();
    groupEl.appendChild(titleEl);

    const listEl = document.createElement('div');
    listEl.className = 'sch-group__list';

    for (const m of matches) {
      listEl.appendChild(buildMatch(m));
    }

    groupEl.appendChild(listEl);
    return groupEl;
  }

  function buildMatch(m) {
    const row = document.createElement('div');
    row.className = 'sch-match';
    if (m.id === currentMatchId) row.classList.add('is-selected');

    const t1 = m.team1Acronym ? tournamentData.getTeam(m.team1Acronym) : null;
    const t2 = m.team2Acronym ? tournamentData.getTeam(m.team2Acronym) : null;

    const name1 = t1?.fullName || m.team1Acronym || '—';
    const name2 = t2?.fullName || m.team2Acronym || '—';
    const seed1 = t1?.seed ? `#${t1.seed}` : '';
    const seed2 = t2?.seed ? `#${t2.seed}` : '';

    if (!m.team1Acronym && !m.team2Acronym) row.classList.add('is-empty');

    row.innerHTML = `
      <div class="sch-match__time">${formatDate(m.date)}</div>
      <div class="sch-match__team sch-match__team--left">
        <span class="sch-match__seed">${seed1}</span>
        <span class="sch-match__name"></span>
      </div>
      <div class="sch-match__vs">VS</div>
      <div class="sch-match__team sch-match__team--right">
        <span class="sch-match__name"></span>
        <span class="sch-match__seed">${seed2}</span>
      </div>
    `;

    /* 用 textContent 赋值，避免队名里的特殊字符破坏 HTML */
    const names = row.querySelectorAll('.sch-match__name');
    if (names[0]) names[0].textContent = name1;
    if (names[1]) names[1].textContent = name2;

    row.addEventListener('click', () => {
      if (currentMatchId === m.id) setCurrentMatchId(null);
      else                         setCurrentMatchId(m.id);
      render();
    });

    return row;
  }

  /* ---------- 启动 ---------- */

  render();

  pageEl.addEventListener('page:activated', render);

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) render();
  });
}