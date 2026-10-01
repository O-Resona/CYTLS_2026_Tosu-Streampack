/**
 * Schedule 子页面
 *
 * 只展示当前轮次（第一个还有未结束比赛的轮次）。
 *
 * 布局：
 *   - 轮次标题（白底黑字）
 *   - 下方：两列
 *       · 左：RECENT MATCHES（已结束，时间升序）
 *       · 右：UPCOMING MATCHS（未结束，剔除选中，时间降序）
 *   - 距底部：COMING UP NEXT（选中的比赛）+ 相对时间字样
 *
 * 单场比赛：深灰底框，结构为：
 *   时间 | 红队名 | 红队比分 | VS | 蓝队比分 | 蓝队名
 *
 * 获胜方高亮：队名白底黑字，比分块红/蓝底白字（仅当比赛已结束）。
 *
 * 初始化自动选中：最早的一场未开始比赛。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

export function initSchedule({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="schedule"]');
  if (!pageEl) return;

  const layoutEl = pageEl.querySelector('#schLayout');
  if (!layoutEl) return;

  let currentMatchId = null;
  let _relTimer = null;

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

  /* ---------- 比赛状态判断 ---------- */

  function isFinished(match, round) {
    const s1 = match.team1Score;
    const s2 = match.team2Score;
    if (s1 == null || s2 == null) return false;

    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2);
    return (Number(s1) >= maxStars) || (Number(s2) >= maxStars);
  }

  /* ---------- 找出当前轮次 ---------- */

  function findCurrentRound(rounds, matches) {
    if (currentMatchId != null) {
      const cur = matches.find(m => m.id === currentMatchId);
      if (cur) {
        const r = rounds.find(x => x.id === cur.roundId);
        if (r) return r;
      }
    }

    for (const round of rounds) {
      const rm = matches.filter(m => m.roundId === round.id);
      if (!rm.length) continue;
      if (rm.some(m => !isFinished(m, round))) return round;
    }

    const withM = rounds.filter(r => matches.some(m => m.roundId === r.id));
    return withM[withM.length - 1] || null;
  }

  /* ---------- 自动选中 ----------
     1. 未开始的比赛中，选时间最近的一场（最早）
     2. 若全部已结束，选已结束中时间最近的一场（最晚）
  */
  function autoSelect(roundMatches, round) {
    if (currentMatchId != null) {
      const cur = roundMatches.find(m => m.id === currentMatchId);
      if (cur) return;
    }

    /* 未开始：无比分 + 两队已确定 */
    const unstarted = roundMatches
      .filter(m => m.team1Score == null && m.team2Score == null)
      .filter(m => m.team1Acronym && m.team2Acronym)
      .sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : Infinity;
        const tb = b.date ? new Date(b.date).getTime() : Infinity;
        return ta - tb;   /* 升序：越早越靠前 */
      });

    if (unstarted.length) {
      setCurrentMatchId(unstarted[0].id);
      return;
    }

    /* 兜底：全部已结束 → 选最晚的一场 */
    const finished = roundMatches
      .filter(m => isFinished(m, round))
      .sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;   /* 降序：越晚越靠前 */
      });

    if (finished.length) setCurrentMatchId(finished[0].id);
  }

  /* ---------- 格式化 ---------- */

  function formatDate(iso) {
    if (!iso) return 'TBD';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 'TBD';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* 相对时间：只显示最大单位
     返回 { text, started } 或 null */
  function formatRelativeTime(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;

    const diffMs = Date.now() - t;   // >0 = 已开始；<0 = 未开始
    const absSec = Math.floor(Math.abs(diffMs) / 1000);

    const day  = Math.floor(absSec / 86400);
    const hour = Math.floor(absSec / 3600);
    const min  = Math.floor(absSec / 60);
    const sec  = absSec;

    let value, unit;
    if (day  >= 1) { value = day;  unit = 'day';    }
    else if (hour >= 1) { value = hour; unit = 'hour';   }
    else if (min  >= 1) { value = min;  unit = 'minute'; }
    else                { value = sec;  unit = 'second'; }

    const unitStr = value === 1 ? unit : unit + 's';

    if (diffMs >= 0) {
      return { text: `Started ${value} ${unitStr} ago`,       started: true  };
    } else {
      return { text: `Starting ${value} ${unitStr} from now`, started: false };
    }
  }

  /* ---------- 渲染 ---------- */

  function render() {
    loadCurrentMatchId();
    layoutEl.innerHTML = '';

    const rounds  = tournamentData.getRounds();
    const matches = tournamentData.getMatches();

    const currentRound = findCurrentRound(rounds, matches);
    if (!currentRound) return;

    const roundMatches = matches.filter(m => m.roundId === currentRound.id);
    autoSelect(roundMatches, currentRound);

    /* 已结束 / 未结束 */
    const finished   = roundMatches.filter(m => isFinished(m, currentRound));
    const unfinished = roundMatches.filter(m => !isFinished(m, currentRound));

    /* RECENT：时间升序 */
    const recent = [...finished].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return ta - tb;
    });

    /* UPCOMING：时间降序，剔除选中 */
    const upcoming = unfinished
      .filter(m => m.id !== currentMatchId)
      .sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      });

    const selected = roundMatches.find(m => m.id === currentMatchId) || null;

    layoutEl.appendChild(buildGroup(currentRound, recent, upcoming));
    layoutEl.appendChild(buildComing(currentRound, selected));

    startRelTimer();
  }

  function buildGroup(round, recent, upcoming) {
    const groupEl = document.createElement('div');
    groupEl.className = 'sch-group';

    const titleEl = document.createElement('div');
    titleEl.className = 'sch-group__title';
    titleEl.textContent = String(round.name || round.id).toUpperCase();
    groupEl.appendChild(titleEl);

    const colsEl = document.createElement('div');
    colsEl.className = 'sch-cols';

    /* RECENT */
    const recentColEl = document.createElement('div');
    recentColEl.className = 'sch-col sch-col--recent';

    const recentTitleEl = document.createElement('div');
    recentTitleEl.className = 'sch-col__title';
    recentTitleEl.textContent = 'RECENT MATCHES';
    recentColEl.appendChild(recentTitleEl);

    const recentListEl = document.createElement('div');
    recentListEl.className = 'sch-col__list';
    recent.forEach(m => recentListEl.appendChild(buildMatch(m, round)));
    recentColEl.appendChild(recentListEl);

    colsEl.appendChild(recentColEl);

    /* UPCOMING */
    const upcomingColEl = document.createElement('div');
    upcomingColEl.className = 'sch-col sch-col--upcoming';

    const upcomingTitleEl = document.createElement('div');
    upcomingTitleEl.className = 'sch-col__title';
    upcomingTitleEl.textContent = 'UPCOMING MATCHS';
    upcomingColEl.appendChild(upcomingTitleEl);

    const upcomingListEl = document.createElement('div');
    upcomingListEl.className = 'sch-col__list';
    upcoming.forEach(m => upcomingListEl.appendChild(buildMatch(m, round)));
    upcomingColEl.appendChild(upcomingListEl);

    colsEl.appendChild(upcomingColEl);

    groupEl.appendChild(colsEl);
    return groupEl;
  }

  function buildComing(round, selected) {
    const comingEl = document.createElement('div');
    comingEl.className = 'sch-coming';

    const titleEl = document.createElement('div');
    titleEl.className = 'sch-coming__title';
    titleEl.textContent = 'COMING UP NEXT';
    comingEl.appendChild(titleEl);

    if (!selected) return comingEl;

    const rowEl = document.createElement('div');
    rowEl.className = 'sch-coming__row';

    rowEl.appendChild(buildMatch(selected, round));

    const rel = formatRelativeTime(selected.date);
    const relEl = document.createElement('div');
    relEl.className = 'sch-coming__rel';
    if (rel) {
      relEl.textContent = rel.text;
      relEl.classList.add(rel.started
        ? 'sch-coming__rel--started'
        : 'sch-coming__rel--upcoming');
      relEl.dataset.started = rel.started ? '1' : '0';
    }
    rowEl.appendChild(relEl);

    comingEl.appendChild(rowEl);
    return comingEl;
  }

  function buildMatch(m, round) {
    const row = document.createElement('div');
    row.className = 'sch-match';

    const isSelected = m.id === currentMatchId;
    const finished   = isFinished(m, round);

    if (isSelected) row.classList.add('is-selected');

    const t1 = m.team1Acronym ? tournamentData.getTeam(m.team1Acronym) : null;
    const t2 = m.team2Acronym ? tournamentData.getTeam(m.team2Acronym) : null;

    const name1 = t1?.fullName || m.team1Acronym || '—';
    const name2 = t2?.fullName || m.team2Acronym || '—';

    if (!m.team1Acronym && !m.team2Acronym) row.classList.add('is-empty');

    /* ---------- 比分显示 ----------
       · 选中 → 始终显示（未开始即 0-0，随比赛实时更新）
       · 已结束（非选中）→ 显示最终比分
       · 其它 → 不显示
    */
    const hasScore1 = m.team1Score != null;
    const hasScore2 = m.team2Score != null;

    let score1 = '';
    let score2 = '';

    if (isSelected) {
      score1 = String(Number(m.team1Score) || 0);
      score2 = String(Number(m.team2Score) || 0);
    } else if (finished) {
      score1 = hasScore1 ? String(m.team1Score) : '';
      score2 = hasScore2 ? String(m.team2Score) : '';
    }

    /* ---------- 获胜方：仅已结束 ---------- */
    const hasBoth = hasScore1 && hasScore2;
    const s1 = Number(m.team1Score);
    const s2 = Number(m.team2Score);
    const redWin  = finished && hasBoth && Number.isFinite(s1) && Number.isFinite(s2) && s1 > s2;
    const blueWin = finished && hasBoth && Number.isFinite(s1) && Number.isFinite(s2) && s2 > s1;

    row.innerHTML = `
      <div class="sch-match__time"></div>
      <div class="sch-match__team sch-match__team--red"></div>
      <div class="sch-match__score"></div>
      <div class="sch-match__vs">VS</div>
      <div class="sch-match__score"></div>
      <div class="sch-match__team sch-match__team--blue"></div>
    `;

    row.querySelector('.sch-match__time').textContent = formatDate(m.date);

    const nameEls = row.querySelectorAll('.sch-match__team');
    nameEls[0].textContent = name1;
    nameEls[1].textContent = name2;

    const scoreEls = row.querySelectorAll('.sch-match__score');
    scoreEls[0].textContent = score1;
    scoreEls[1].textContent = score2;

    if (redWin) {
      nameEls[0].classList.add('sch-match__team--win');
      scoreEls[0].classList.add('sch-match__score--red-win');
    }
    if (blueWin) {
      nameEls[1].classList.add('sch-match__team--win');
      scoreEls[1].classList.add('sch-match__score--blue-win');
    }

    row.addEventListener('click', () => {
      if (currentMatchId === m.id) setCurrentMatchId(null);
      else                         setCurrentMatchId(m.id);
      render();
    });

    return row;
  }

  /* ---------- 相对时间每秒刷新 ---------- */

  function startRelTimer() {
    stopRelTimer();
    _relTimer = setInterval(() => {
      const el = layoutEl.querySelector('.sch-coming__rel');
      if (!el) return;

      const id = currentMatchId;
      if (id == null) return;

      const match = tournamentData.getMatch(id);
      if (!match?.date) return;

      const rel = formatRelativeTime(match.date);
      if (!rel) return;

      el.textContent = rel.text;
      el.classList.remove('sch-coming__rel--started', 'sch-coming__rel--upcoming');
      el.classList.add(rel.started
        ? 'sch-coming__rel--started'
        : 'sch-coming__rel--upcoming');
    }, 1000);
  }

  function stopRelTimer() {
    if (_relTimer) { clearInterval(_relTimer); _relTimer = null; }
  }

  /* ---------- 启动 ---------- */

  render();

  pageEl.addEventListener('page:activated', () => {
    render();
  });

  pageEl.addEventListener('page:deactivated', () => {
    stopRelTimer();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) render();
  });
}