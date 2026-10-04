/**
 * Bracket 子页面
 *
 * FF（teamXScore === -1）：显示为 "FF"，该队判负，对手判胜。
 * 双方都 FF → 双方都判负，不高亮。
 */

const GROUPS = [
  {
    id: 'swiss-1',
    title: 'SWISS PHASE Ⅰ',
    columns: [
      { id: 'swiss-r1', matcher: /swiss\s*round\s*1\b/i, groups: [8] },
      { id: 'swiss-r2', matcher: /swiss\s*round\s*2\b/i, groups: [4, 4] },
    ],
  },
  {
    id: 'swiss-2',
    title: 'SWISS PHASE Ⅱ',
    columns: [
      { id: 'swiss-r3', matcher: /swiss\s*round\s*3\b/i, groups: [2, 4, 2] },
      { id: 'swiss-r4', matcher: /swiss\s*round\s*4\b/i, groups: [3, 3] },
      { id: 'swiss-r5', matcher: /swiss\s*round\s*5\b/i, groups: [3] },
    ],
  },
  {
    id: 'bracket',
    title: 'BRACKET STAGE',
    columns: [
      { id: 'semifinals',   matcher: /semi/i,          count: 4 },
      { id: 'finals',       matcher: /^finals?\b/i,    count: 4 },
      { id: 'grand-finals', matcher: /grand\s*final/i, count: 2 },
    ],
  },
];

const TOP_MARKS = {
  'swiss-r1': { 0: 'green' },
  'swiss-r2': { 0: 'green', 4: 'red' },
  'swiss-r3': { 0: 'green', 2: 'white', 6: 'red' },
  'swiss-r4': { 0: 'green', 3: 'red' },
  'swiss-r5': { 0: 'green' },
};

const TOP_MARK_LABELS = {
  'swiss-r1:0': '0 - 0',
  'swiss-r2:0': '1 - 0',
  'swiss-r2:4': '0 - 1',
  'swiss-r3:0': '2 - 0',
  'swiss-r3:2': '1 - 1',
  'swiss-r3:6': '0 - 2',
  'swiss-r4:0': '2 - 1',
  'swiss-r4:3': '2 - 1',
  'swiss-r5:0': '2 - 2',
};

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

let _tournamentData = null;
let _layoutEl = null;
let _currentMatchId = null;

let _panel = null;
let _selTeam1 = null;
let _selTeam2 = null;
let _inpDate  = null;
let _btnReset = null;
let _btnClearAll = null;

let _tx = 0, _isDragging = false, _movedThisDrag = false;
let _startX = 0, _startTx = 0, _dragInited = false;

let _initScrollRight = false;

function isSwissPhaseComplete() {
  if (!_tournamentData) return false;

  const swissIds = [
    'swiss-round-1',
    'swiss-round-2',
    'swiss-round-3',
    'swiss-round-4',
    'swiss-round-5',
  ];

  const swissMatches = _tournamentData.getMatches()
    .filter(m => swissIds.includes(m.roundId));

  if (!swissMatches.length) return false;

  return swissMatches.every(m =>
    m.team1Score != null && m.team2Score != null
  );
}

/* ---------- 入口 ---------- */

export function initBracket({ tournamentData }) {
  _tournamentData = tournamentData;

  const pageEl = document.querySelector('[data-page="bracket"]');
  if (!pageEl) return;

  _layoutEl = pageEl.querySelector('#brLayout');
  if (!_layoutEl) return;

  _panel    = document.getElementById('bracketPanel');
  _selTeam1 = _panel?.querySelector('#bpTeam1');
  _selTeam2 = _panel?.querySelector('#bpTeam2');
  _inpDate  = _panel?.querySelector('#bpDate');
  _btnReset = _panel?.querySelector('#bpReset');
  _btnClearAll = _panel?.querySelector('#bpClearAll');

  if (_panel) { fillTeamSelects(); bindPanelEvents(); }

  loadCurrentMatchId();

  _initScrollRight = isSwissPhaseComplete();
  renderAll();
  initDrag();

  pageEl.addEventListener('page:activated', () => {
    if (_panel) _panel.hidden = false;
    loadCurrentMatchId();
    renderAll();
  });
  pageEl.addEventListener('page:deactivated', () => {
    if (_panel) _panel.hidden = true;
  });

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) {
      loadCurrentMatchId();
      renderAll();
    }
  });

  if (pageEl.classList.contains('active') && _panel) _panel.hidden = false;
}

/* ---------- localStorage ---------- */

function loadCurrentMatchId() {
  try {
    const v = localStorage.getItem(CURRENT_MATCH_KEY);
    _currentMatchId = v ? Number(v) : null;
  } catch { _currentMatchId = null; }
}

function setCurrentMatchId(id) {
  _currentMatchId = id;
  try {
    if (id == null) localStorage.removeItem(CURRENT_MATCH_KEY);
    else            localStorage.setItem(CURRENT_MATCH_KEY, String(id));
  } catch (e) { console.warn('[Bracket] write failed:', e); }
}

/* ---------- 清除所有本地状态 ---------- */

const LOCAL_KEYS_PREFIX = 'cyt';
const LOCAL_KEYS_EXTRA  = [
  'mapBPActions',
  'mapProtectActions',
];

function clearAllLocalState() {
  try {
    const toRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(LOCAL_KEYS_PREFIX) || LOCAL_KEYS_EXTRA.includes(k)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[Bracket] 清除本地状态失败:', e);
  }
}

/* ---------- 渲染 ---------- */

function renderAll() { renderLayout(); refreshSelection(); refreshPanel(); }

function renderLayout() {
  if (!_layoutEl) return;

  let track = _layoutEl.querySelector('.br-track');
  if (!track) {
    track = document.createElement('div');
    track.className = 'br-track';
    _layoutEl.appendChild(track);
  }

  track.innerHTML = '';

  GROUPS.forEach((group, i) => {
    if (group.id === 'bracket') {
      track.appendChild(buildBracketStageGroup());
    } else {
      track.appendChild(buildGroup(group));
    }
    if (i === 1) track.appendChild(buildScoresColumn());
  });

  const spacer = document.createElement('div');
  spacer.className = 'br-track-spacer';
  track.appendChild(spacer);

  requestAnimationFrame(updateDragBounds);
}

function buildGroup(group) {
  const gEl = document.createElement('div');
  gEl.className = 'br-group';
  gEl.dataset.groupId = group.id;

  const titleEl = document.createElement('div');
  titleEl.className = 'br-group__title';
  titleEl.textContent = group.title;
  gEl.appendChild(titleEl);

  const colsEl = document.createElement('div');
  colsEl.className = 'br-group__columns';
  group.columns.forEach(col => colsEl.appendChild(buildColumn(col)));
  gEl.appendChild(colsEl);

  return gEl;
}

function buildBracketStageGroup() {
  const gEl = document.createElement('div');
  gEl.className = 'br-group br-group--bracket-stage';
  gEl.dataset.groupId = 'bracket';

  const grid = document.createElement('div');
  grid.className = 'br-bracket-grid';

  const title = document.createElement('div');
  title.className = 'br-group__title';
  title.textContent = 'BRACKET STAGE';
  title.style.gridArea = 'title';
  grid.appendChild(title);

  grid.appendChild(makeLabel('Semifinals',   'sf-hdr'));
  grid.appendChild(makeLabel('Finals',       'f-hdr'));
  grid.appendChild(makeLabel('Grand Finals', 'gf-hdr'));

  const winnersSub = document.createElement('div');
  winnersSub.className = 'br-bracket-subtitle';
  winnersSub.textContent = "Winners' Bracket";
  winnersSub.style.gridArea = 'win';
  grid.appendChild(winnersSub);

  grid.appendChild(buildBracketPos('semifinals',   0, 'sf1'));
  grid.appendChild(buildBracketPos('semifinals',   1, 'sf2'));
  grid.appendChild(buildBracketPos('finals',       0, 'f5'));
  grid.appendChild(buildBracketPos('grand-finals', 1, 'gf10'));

  const losersSub = document.createElement('div');
  losersSub.className = 'br-bracket-subtitle';
  losersSub.textContent = "Losers' Bracket";
  losersSub.style.gridArea = 'lose';
  grid.appendChild(losersSub);

  grid.appendChild(buildBracketPos('semifinals',   2, 'sf3'));
  grid.appendChild(buildBracketPos('semifinals',   3, 'sf4'));
  grid.appendChild(buildBracketPos('finals',       1, 'f6'));
  grid.appendChild(buildBracketPos('finals',       3, 'f7'));
  grid.appendChild(buildBracketPos('finals',       2, 'f8'));
  grid.appendChild(buildBracketPos('grand-finals', 0, 'gf9'));

  gEl.appendChild(grid);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawBracketLines(gEl);
    });
  });

  return gEl;
}

function drawBracketLines(groupEl) {
  const gridEl = groupEl.querySelector('.br-bracket-grid');
  if (!gridEl) return;

  groupEl.querySelectorAll('.br-lines').forEach(el => el.remove());

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'br-lines');

  const gridRect = gridEl.getBoundingClientRect();
  const scale = getStageScale() || 1;

  const rectOf = (area) => {
    const el = gridEl.querySelector(`.br-match[style*="grid-area: ${area}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left:   (r.left   - gridRect.left) / scale,
      top:    (r.top    - gridRect.top)  / scale,
      right:  (r.right  - gridRect.left) / scale,
      bottom: (r.bottom - gridRect.top)  / scale,
      w: r.width  / scale,
      h: r.height / scale,
      cx: (r.left + r.right)  / 2 / scale - gridRect.left / scale,
      cy: (r.top  + r.bottom) / 2 / scale - gridRect.top  / scale,
    };
  };

  const addPathH = (from, to, color, width) => {
    if (!from || !to) return;
    const x1 = from.right;
    const y1 = from.top + from.h / 2;
    const x2 = to.left;
    const y2 = to.top + to.h / 2;
    const midX = (x1 + x2) / 2;

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d',
      `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  };

  const addPathVOffset = (from, to, color, width, offsetY = 0) => {
    if (!from || !to) return;
    const x1 = from.left + from.w / 2;
    const y1 = from.top + offsetY;
    const x2 = to.left + to.w / 2;
    const y2 = to.bottom + offsetY;

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  };

  const sf1 = rectOf('sf1');
  const sf2 = rectOf('sf2');
  const sf3 = rectOf('sf3');
  const sf4 = rectOf('sf4');
  const f5  = rectOf('f5');
  const f6  = rectOf('f6');
  const f7  = rectOf('f7');
  const f8  = rectOf('f8');
  const gf9  = rectOf('gf9');
  const gf10 = rectOf('gf10');

  addPathH(sf1, f5, '#ffffff', 3);
  addPathH(sf2, f5, '#ffffff', 3);
  addPathH(sf3, f6, '#ffffff', 3);
  addPathH(sf4, f7, '#ffffff', 3);

  addPathH(sf1, f6, 'rgba(255,255,255,0.35)', 2);
  addPathH(sf2, f7, 'rgba(255,255,255,0.35)', 2);

  addPathH(f6, f8, '#ffffff', 3);
  addPathH(f7, f8, '#ffffff', 3);

  addPathH(f5, gf10, '#ffffff', 3);
  addPathH(f5, gf9, 'rgba(255,255,255,0.35)', 2);
  addPathH(f8, gf9, '#ffffff', 3);

  addPathVOffset(gf9, gf10, '#ffffff', 3, -2);

  gridEl.appendChild(svg);
}

function makeLabel(text, area) {
  const el = document.createElement('div');
  el.className = 'br-bracket-label';
  el.textContent = text;
  el.style.gridArea = area;
  return el;
}

function buildBracketPos(roundKey, idx, pos) {
  const matcher =
    roundKey === 'semifinals'   ? /semi/i :
    roundKey === 'finals'       ? /^finals?\b/i :
    roundKey === 'grand-finals' ? /grand\s*final/i : null;
  if (!matcher || !_tournamentData) return document.createElement('div');

  const round = _tournamentData.getRounds().find(r =>
    matcher.test(`${r.name || ''} ${r.description || ''}`)
  );
  if (!round) return document.createElement('div');

  const matches = _tournamentData.getMatches().filter(m =>
    m.roundId === round.id || m.roundId === round.name
  );
  const match = matches[idx];

  const matchEl = buildMatchFromData(match);
  matchEl.style.gridArea = pos;
  return matchEl;
}

function refreshSelection() {
  if (!_layoutEl) return;
  _layoutEl.querySelectorAll('.br-match').forEach(el => {
    const id = Number(el.dataset.matchId);
    el.classList.toggle('is-selected', id === _currentMatchId);
  });
}

function findRoundForColumn(colId) {
  const col = findColDef(colId);
  if (!col || !_tournamentData) return null;
  return _tournamentData.getRounds().find(r =>
    col.matcher.test(`${r.name || ''} ${r.description || ''}`)
  ) || null;
}

function findColDef(colId) {
  for (const g of GROUPS) {
    const c = g.columns.find(x => x.id === colId);
    if (c) return c;
  }
  return null;
}

function buildColumn(col) {
  const columnEl = document.createElement('div');
  columnEl.className = 'br-column';
  columnEl.dataset.colId = col.id;

  const titleEl = document.createElement('div');
  titleEl.className = 'br-column__title';
  const round = findRoundForColumn(col.id);
  titleEl.textContent = round?.name ? String(round.name).toUpperCase() : col.id.toUpperCase();
  columnEl.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'br-column__body';

  const groups = col.groups || [col.count || 0];
  let idx = 0;

  groups.forEach((size, gi) => {
    if (gi > 0) {
      const spacer = document.createElement('div');
      spacer.className = 'br-column__gap';
      bodyEl.appendChild(spacer);
    }
    for (let i = 0; i < size; i++, idx++) {
      bodyEl.appendChild(buildMatch(col, idx));
    }
  });

  columnEl.appendChild(bodyEl);
  return columnEl;
}

function buildMatch(col, idx) {
  const matchEl = document.createElement('div');
  matchEl.className = 'br-match';
  matchEl.dataset.colId = col.id;
  matchEl.dataset.matchIdx = String(idx);

  const mark = TOP_MARKS[col.id]?.[idx];
  if (mark) {
    matchEl.classList.add(`br-match--mark-${mark}`);

    const label = TOP_MARK_LABELS[`${col.id}:${idx}`];
    if (label) {
      const labelEl = document.createElement('div');
      labelEl.className = 'br-match__mark-label';
      labelEl.textContent = label;
      matchEl.appendChild(labelEl);
    }
  }

  const match = findMatchForSlot(col.id, idx);
  fillMatchElement(matchEl, match);
  return matchEl;
}

function buildMatchFromData(match) {
  const matchEl = document.createElement('div');
  matchEl.className = 'br-match';
  fillMatchElement(matchEl, match);
  return matchEl;
}

function fillMatchElement(matchEl, match) {
  if (!match) {
    matchEl.appendChild(buildSlot({ seed: '—', acronym: '', score: '—', empty: true, state: 'neutral' }));
    matchEl.appendChild(buildSlot({ seed: '—', acronym: '', score: '—', empty: true, state: 'neutral' }));
    return;
  }

  matchEl.dataset.matchId = String(match.id);
  if (match.id === _currentMatchId) matchEl.classList.add('is-selected');

  const s1 = match.team1Score;
  const s2 = match.team2Score;

  const n1 = Number(s1);
  const n2 = Number(s2);

  const ff1 = n1 === -1;
  const ff2 = n2 === -1;

  /* ---------- 判定胜负（含 FF） ---------- */
  let leftState  = 'neutral';
  let rightState = 'neutral';

  if (ff1 && ff2) {
    leftState = 'lose';  rightState = 'lose';
  } else if (ff1) {
    leftState = 'lose';  rightState = 'win';
  } else if (ff2) {
    leftState = 'win';   rightState = 'lose';
  } else if (s1 != null && s2 != null && n1 !== n2) {
    leftState  = n1 > n2 ? 'win' : 'lose';
    rightState = n2 > n1 ? 'win' : 'lose';
  }

  /* ---------- 显示：FF 显示 "FF" ---------- */
  const score1Text = ff1 ? 'FF' : (s1 != null ? String(s1) : '—');
  const score2Text = ff2 ? 'FF' : (s2 != null ? String(s2) : '—');

  matchEl.appendChild(buildSlot({
    seed:    formatSeed(match.team1Acronym),
    acronym: match.team1Acronym,
    score:   score1Text,
    empty:   !match.team1Acronym,
    state:   leftState,
  }));
  matchEl.appendChild(buildSlot({
    seed:    formatSeed(match.team2Acronym),
    acronym: match.team2Acronym,
    score:   score2Text,
    empty:   !match.team2Acronym,
    state:   rightState,
  }));

  matchEl.addEventListener('click', () => {
    if (_movedThisDrag) return;
    if (_currentMatchId === match.id) setCurrentMatchId(null);
    else                              setCurrentMatchId(match.id);
    refreshSelection();
    refreshPanel();
  });
}

function buildSlot({ seed, acronym, score, empty, state = 'neutral' }) {
  const slotEl = document.createElement('div');
  slotEl.className = 'br-slot';
  if (empty) slotEl.classList.add('br-slot--empty');
  slotEl.classList.add(`br-slot--${state}`);

  const seedEl = document.createElement('span');
  seedEl.className = 'br-slot__seed';
  seedEl.textContent = seed;

  const nameEl = document.createElement('span');
  nameEl.className = 'br-slot__name';
  nameEl.textContent = acronym || '';

  const scoreEl = document.createElement('span');
  scoreEl.className = 'br-slot__score';
  scoreEl.textContent = score;

  slotEl.appendChild(seedEl);
  slotEl.appendChild(nameEl);
  slotEl.appendChild(scoreEl);
  return slotEl;
}

function formatSeed(acronym) {
  if (!acronym || !_tournamentData) return '—';
  const seed = _tournamentData.getTeam(acronym)?.seed;
  return seed ? `#${seed}` : '—';
}

function findMatchForSlot(colId, idx) {
  if (!_tournamentData) return null;
  const round = findRoundForColumn(colId);
  if (!round) return null;
  const matches = _tournamentData.getMatches().filter(m =>
    m.roundId === round.id || m.roundId === round.name
  );
  return matches[idx] || null;
}

/* ---------- SWISS SCORES 列 ---------- */

function buildScoresColumn() {
  const col = document.createElement('div');
  col.className = 'br-scores-column';

  const titleEl = document.createElement('div');
  titleEl.className = 'br-scores-column__title';
  titleEl.textContent = 'SWISS SCORES';
  col.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'br-scores-column__body';

  const standings = computeStandings();
  standings.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'br-scores-row';

    if (i === 0) row.classList.add('br-scores-row--mark-green');
    if (i === 8) row.classList.add('br-scores-row--mark-red');
    if (i >= 8)  row.classList.add('br-scores-row--lower');

    const seed = document.createElement('span');
    seed.className = 'br-scores-row__seed';
    seed.textContent = t.seed ? `#${t.seed}` : '—';

    const name = document.createElement('span');
    name.className = 'br-scores-row__name';
    name.textContent = t.fullName || t.acronym || '';
    name.title = t.fullName || t.acronym || '';

    const bu = document.createElement('span');
    bu.className = 'br-scores-row__bu';
    bu.textContent = `BU ${t.bu}`;

    const record = document.createElement('span');
    record.className = 'br-scores-row__record';
    record.textContent = `${t.wins}-${t.losses}`;

    row.appendChild(seed);
    row.appendChild(name);
    row.appendChild(bu);
    row.appendChild(record);
    bodyEl.appendChild(row);
  });

  col.appendChild(bodyEl);
  return col;
}

/* 排序规则：净胜场数降序 → BU 分降序 → 预选赛种子升序 */
function computeStandings() {
  if (!_tournamentData) return [];
  const teams   = _tournamentData.getTeams();
  const matches = _tournamentData.getMatches();

  /* ---------- 1. 各队胜负（含 FF） ---------- */
  const stats = new Map();
  teams.forEach(t => stats.set(t.acronym, { wins: 0, losses: 0 }));

  matches.forEach(m => {
    const s1 = m.team1Score, s2 = m.team2Score;
    if (s1 == null || s2 == null) return;
    const a = m.team1Acronym, b = m.team2Acronym;
    if (!a || !b || !stats.has(a) || !stats.has(b)) return;

    const n1 = Number(s1);
    const n2 = Number(s2);
    const ff1 = n1 === -1;
    const ff2 = n2 === -1;

    /* 双方 FF → 都算负 */
    if (ff1 && ff2) {
      stats.get(a).losses++;
      stats.get(b).losses++;
      return;
    }
    /* 单方 FF */
    if (ff1) {
      stats.get(b).wins++;   stats.get(a).losses++;
      return;
    }
    if (ff2) {
      stats.get(a).wins++;   stats.get(b).losses++;
      return;
    }

    /* 常规判定 */
    if (n1 === n2) return;
    if (n1 > n2) {
      stats.get(a).wins++;   stats.get(b).losses++;
    } else {
      stats.get(b).wins++;   stats.get(a).losses++;
    }
  });

  /* ---------- 2. BU ---------- */
  const buMap = new Map();
  teams.forEach(t => buMap.set(t.acronym, 0));

  matches.forEach(m => {
    const s1 = m.team1Score, s2 = m.team2Score;
    if (s1 == null || s2 == null) return;
    const a = m.team1Acronym, b = m.team2Acronym;
    if (!a || !b || !stats.has(a) || !stats.has(b)) return;

    const netA = stats.get(a).wins - stats.get(a).losses;
    const netB = stats.get(b).wins - stats.get(b).losses;

    buMap.set(a, (buMap.get(a) || 0) + netB);
    buMap.set(b, (buMap.get(b) || 0) + netA);
  });

  /* ---------- 3. 合并 + 排序 ---------- */
  return teams.map(t => {
    const s = stats.get(t.acronym);
    return {
      acronym:  t.acronym,
      fullName: t.fullName || t.acronym || '',
      seed:     Number(t.seed) || 999,
      wins:     s.wins,
      losses:   s.losses,
      net:      s.wins - s.losses,
      bu:       buMap.get(t.acronym) || 0,
    };
  }).sort((a, b) => {
    if (b.net !== a.net) return b.net - a.net;
    if (b.bu  !== a.bu)  return b.bu  - a.bu;
    return a.seed - b.seed;
  });
}

/* ---------- 面板 ---------- */

function fillTeamSelects() {
  if (!_selTeam1 || !_selTeam2 || !_tournamentData) return;
  const teams = _tournamentData.getTeams();
  const opts = teams.map(t => {
    const seed = t.seed ? `#${t.seed} ` : '';
    const name = t.fullName || t.acronym || '';
    return `<option value="${escapeAttr(t.acronym)}">${escapeHtml(seed + t.acronym + ' — ' + name)}</option>`;
  }).join('');
  const emptyOpt = '<option value="">— 未指定 —</option>';
  _selTeam1.innerHTML = emptyOpt + opts;
  _selTeam2.innerHTML = emptyOpt + opts;
}

function refreshPanel() {
  if (!_panel) return;
  const enabled = _currentMatchId != null;
  [_selTeam1, _selTeam2, _inpDate, _btnReset].forEach(el => {
    if (el) el.disabled = !enabled;
  });

  if (!enabled) {
    if (_selTeam1) _selTeam1.value = '';
    if (_selTeam2) _selTeam2.value = '';
    if (_inpDate)  _inpDate.value = '';
    return;
  }

  const match = _tournamentData.getMatch(_currentMatchId);
  if (!match) return;

  if (_selTeam1) _selTeam1.value = match.team1Acronym || '';
  if (_selTeam2) _selTeam2.value = match.team2Acronym || '';

  if (_inpDate && document.activeElement !== _inpDate) {
    const d = match.date ? new Date(match.date) : null;
    if (d && Number.isFinite(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      _inpDate.value = `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
      _inpDate.value = '';
    }
  }
}

function bindPanelEvents() {
  _selTeam1?.addEventListener('change', () => {
    if (_currentMatchId == null) return;
    _tournamentData.setMatchOverride(_currentMatchId, { team1Acronym: _selTeam1.value || null });
    renderLayout();
    refreshSelection();
  });
  _selTeam2?.addEventListener('change', () => {
    if (_currentMatchId == null) return;
    _tournamentData.setMatchOverride(_currentMatchId, { team2Acronym: _selTeam2.value || null });
    renderLayout();
    refreshSelection();
  });
  _inpDate?.addEventListener('input', () => {
    if (_currentMatchId == null) return;
    const v = _inpDate.value.trim();
    let iso = null;
    if (v) {
      const orig = _tournamentData.getMatch(_currentMatchId);
      const origDate = orig?.date ? new Date(orig.date) : null;
      const year = (origDate && Number.isFinite(origDate.getTime()))
        ? origDate.getFullYear() : new Date().getFullYear();
      const d = parseDateInput(v, year);
      if (d) iso = d.toISOString();
    }
    _tournamentData.setMatchOverride(_currentMatchId, { date: iso });
  });
  _btnReset?.addEventListener('click', () => {
    if (_currentMatchId == null) return;
    _tournamentData.clearMatchOverride(_currentMatchId);
    renderAll();
  });

  _btnClearAll?.addEventListener('click', () => {
    clearAllLocalState();
    location.reload();
  });
}

function parseDateInput(str, fallbackYear) {
  const m = String(str).trim().match(/^(\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]) - 1, day = Number(m[2]);
  const hour = Number(m[3]), min = Number(m[4]);
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || min > 59) return null;
  const d = new Date(fallbackYear, month, day, hour, min, 0, 0);
  return Number.isFinite(d.getTime()) ? d : null;
}

/* ---------- 拖拽 ---------- */

function initDrag() {
  if (!_layoutEl || _dragInited) return;
  _dragInited = true;
  _layoutEl.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  _layoutEl.addEventListener('click', (e) => {
    if (_movedThisDrag) {
      e.stopPropagation(); e.preventDefault();
      _movedThisDrag = false;
    }
  }, true);
}

function onDragStart(e) {
  if (e.button !== 0) return;
  _isDragging = true; _movedThisDrag = false;
  _startX = e.clientX; _startTx = _tx;
  _layoutEl.classList.add('is-dragging');
  e.preventDefault();
}
function onDragMove(e) {
  if (!_isDragging) return;
  const dx = e.clientX - _startX;
  if (Math.abs(dx) > 5) _movedThisDrag = true;
  _tx = clampTx(_startTx + dx / getStageScale());
  applyTx();
}
function onDragEnd() {
  if (!_isDragging) return;
  _isDragging = false;
  _layoutEl.classList.remove('is-dragging');
}
function applyTx() {
  const track = _layoutEl?.querySelector('.br-track');
  if (track) track.style.transform = `translateX(${_tx}px)`;
}
function getStageScale() {
  const stage = document.getElementById('stage');
  if (!stage) return 1;
  const w = stage.getBoundingClientRect().width;
  return (w && stage.offsetWidth) ? (w / stage.offsetWidth) : 1;
}

function clampTx(tx) {
  const track = _layoutEl?.querySelector('.br-track');
  if (!track) return tx;
  const cw = _layoutEl.clientWidth;
  const tw = track.scrollWidth;
  if (tw <= cw) return (cw - tw) / 2;
  return Math.max(cw - tw, Math.min(0, tx));
}

function updateDragBounds() {
  const track = _layoutEl?.querySelector('.br-track');

  if (track) {
    const cw = _layoutEl.clientWidth;
    const tw = track.scrollWidth;

    if (_initScrollRight && tw > cw) {
      _initScrollRight = false;
      _tx = cw - tw;
      applyTx();
      return;
    }
  }

  _tx = clampTx(_tx);
  applyTx();
}

/* ---------- 转义 ---------- */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }