/**
 * Bracket 子页面
 */

const GROUPS = [
  {
    id: 'swiss-1',
    title: 'SWISS PHASE Ⅰ',
    columns: [
      { id: 'swiss-r1', matcher: /swiss\s*round\s*1\b/i, count: 8 },
      { id: 'swiss-r2', matcher: /swiss\s*round\s*2\b/i, count: 8 },
      { id: 'swiss-r3', matcher: /swiss\s*round\s*3\b/i, count: 8 },
    ],
  },
  {
    id: 'swiss-2',
    title: 'SWISS PHASE Ⅱ',
    columns: [
      { id: 'swiss-r4', matcher: /swiss\s*round\s*4\b/i, count: 6 },
      { id: 'swiss-r5', matcher: /swiss\s*round\s*5\b/i, count: 3 },
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

/* 每列需要高亮上边框的 match：{ colId: { idx: 'green'|'white'|'red' } } */
const TOP_MARKS = {
  'swiss-r1': { 0: 'green' },
  'swiss-r2': { 0: 'green', 4: 'red' },
  'swiss-r3': { 0: 'green', 2: 'white', 6: 'red' },
  'swiss-r4': { 0: 'green', 3: 'red' },
  'swiss-r5': { 0: 'green' },
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

let _tx = 0, _isDragging = false, _movedThisDrag = false;
let _startX = 0, _startTx = 0, _dragInited = false;

/* 一次性标志：首次初始化时是否要拖到最右 */
let _initScrollRight = false;

/* 判断 swiss round 1-5 是否全部结束 */
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

  if (_panel) { fillTeamSelects(); bindPanelEvents(); }

  loadCurrentMatchId();

  /* 首次初始化时判断：swiss 阶段全结束 → 拖到最右 */
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

  /* 右侧留白占位：作为真实 flex item，一定进 scrollWidth */
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

  /* 1. BRACKET STAGE 大标题 */
  const title = document.createElement('div');
  title.className = 'br-group__title';
  title.textContent = 'BRACKET STAGE';
  title.style.gridArea = 'title';
  grid.appendChild(title);

  /* 2. 列标题：Semifinals / Finals / Grand Finals */
  grid.appendChild(makeLabel('Semifinals',   'sf-hdr'));
  grid.appendChild(makeLabel('Finals',       'f-hdr'));
  grid.appendChild(makeLabel('Grand Finals', 'gf-hdr'));

  /* 3. Winners' Bracket 副标题 */
  const winnersSub = document.createElement('div');
  winnersSub.className = 'br-bracket-subtitle';
  winnersSub.textContent = "Winners' Bracket";
  winnersSub.style.gridArea = 'win';
  grid.appendChild(winnersSub);

  /* 4. Winners 比赛 */
  grid.appendChild(buildBracketPos('semifinals',   0, 'sf1'));
  grid.appendChild(buildBracketPos('semifinals',   1, 'sf2'));
  grid.appendChild(buildBracketPos('finals',       0, 'f5'));
  grid.appendChild(buildBracketPos('grand-finals', 1, 'gf10'));

  /* 5. Losers' Bracket 副标题 */
  const losersSub = document.createElement('div');
  losersSub.className = 'br-bracket-subtitle';
  losersSub.textContent = "Losers' Bracket";
  losersSub.style.gridArea = 'lose';
  grid.appendChild(losersSub);

  /* 6. Losers 比赛 */
  grid.appendChild(buildBracketPos('semifinals',   2, 'sf3'));
  grid.appendChild(buildBracketPos('semifinals',   3, 'sf4'));
  grid.appendChild(buildBracketPos('finals',       1, 'f6'));
  grid.appendChild(buildBracketPos('finals',       3, 'f7'));
  grid.appendChild(buildBracketPos('finals',       2, 'f8'));
  grid.appendChild(buildBracketPos('grand-finals', 0, 'gf9'));

  gEl.appendChild(grid);
  return gEl;
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

/* ---------- 列 & match ---------- */

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

  for (let i = 0; i < col.count; i++) {
    bodyEl.appendChild(buildMatch(col, i));
  }
  columnEl.appendChild(bodyEl);
  return columnEl;
}

function buildMatch(col, idx) {
  const matchEl = document.createElement('div');
  matchEl.className = 'br-match';
  matchEl.dataset.colId = col.id;
  matchEl.dataset.matchIdx = String(idx);

  const mark = TOP_MARKS[col.id]?.[idx];
  if (mark) matchEl.classList.add(`br-match--mark-${mark}`);

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

  const s1 = match.team1Score, s2 = match.team2Score;
  const hasResult = s1 != null && s2 != null && Number(s1) !== Number(s2);
  const leftState  = hasResult ? (Number(s1) > Number(s2) ? 'win' : 'lose') : 'neutral';
  const rightState = hasResult ? (Number(s2) > Number(s1) ? 'win' : 'lose') : 'neutral';

  matchEl.appendChild(buildSlot({
    seed:    formatSeed(match.team1Acronym),
    acronym: match.team1Acronym,
    score:   s1 != null ? String(s1) : '—',
    empty:   !match.team1Acronym,
    state:   leftState,
  }));
  matchEl.appendChild(buildSlot({
    seed:    formatSeed(match.team2Acronym),
    acronym: match.team2Acronym,
    score:   s2 != null ? String(s2) : '—',
    empty:   !match.team2Acronym,
    state:   rightState,
  }));

  matchEl.addEventListener('click', () => {
    if (_movedThisDrag) return;
    if (_currentMatchId === match.id) setCurrentMatchId(null);
    else                              setCurrentMatchId(match.id);
    renderAll();
  });
}

function buildSlot({ seed, acronym, score, empty, state = 'neutral' }) {
  const slotEl = document.createElement('div');
  slotEl.className = 'br-slot';
  if (empty) slotEl.classList.add('br-slot--empty');
  slotEl.classList.add(`br-slot--${state}`);     // win / lose / neutral

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

    const record = document.createElement('span');
    record.className = 'br-scores-row__record';
    record.textContent = `${t.wins}-${t.losses}`;

    row.appendChild(seed);
    row.appendChild(name);
    row.appendChild(record);
    bodyEl.appendChild(row);
  });

  col.appendChild(bodyEl);
  return col;
}

/* 胜场降序 → 败场升序 → seed 升序 */
function computeStandings() {
  if (!_tournamentData) return [];
  const teams = _tournamentData.getTeams();
  const matches = _tournamentData.getMatches();

  const stats = new Map();
  teams.forEach(t => stats.set(t.acronym, { wins: 0, losses: 0 }));

  matches.forEach(m => {
    const s1 = m.team1Score, s2 = m.team2Score;
    if (s1 == null || s2 == null) return;
    const a = m.team1Acronym, b = m.team2Acronym;
    if (!a || !b || !stats.has(a) || !stats.has(b)) return;

    if (s1 > s2)      { stats.get(a).wins++;   stats.get(b).losses++; }
    else if (s2 > s1) { stats.get(b).wins++;   stats.get(a).losses++; }
  });

  return teams.map(t => ({
    acronym:  t.acronym,
    fullName: t.fullName || t.acronym || '',
    seed:     Number(t.seed) || 999,
    ...stats.get(t.acronym),
  })).sort((a, b) => {
    if (b.wins   !== a.wins)   return b.wins   - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
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

    /* 首次初始化且 swiss 全结束 → 直接定位到最右 */
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