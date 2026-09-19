/**
 * Bracket 子页面
 */

const COLUMNS = [
  { id: 'swiss-r1',     name: 'Swiss Round 1', count: 8 },
  { id: 'swiss-r2',     name: 'Swiss Round 2', count: 8 },
  { id: 'swiss-r3',     name: 'Swiss Round 3', count: 8 },
  { id: 'swiss-r4',     name: 'Swiss Round 4', count: 6 },
  { id: 'swiss-r5',     name: 'Swiss Round 5', count: 3 },
  { id: 'semifinals',   name: 'Semifinals',    count: 4 },
  { id: 'finals',       name: 'Finals',        count: 4 },
  { id: 'grand-finals', name: 'Grand Finals',  count: 2 },
];

const ROUND_MATCHERS = {
  'swiss-r1':     /swiss\s*round\s*1\b/i,
  'swiss-r2':     /swiss\s*round\s*2\b/i,
  'swiss-r3':     /swiss\s*round\s*3\b/i,
  'swiss-r4':     /swiss\s*round\s*4\b/i,
  'swiss-r5':     /swiss\s*round\s*5\b/i,
  'semifinals':   /semi/i,
  'finals':       /^finals?\b/i,
  'grand-finals': /grand\s*final/i,
};

let _tournamentData = null;

export function initBracket({ tournamentData }) {
  _tournamentData = tournamentData;

  const pageEl = document.querySelector('[data-page="bracket"]');
  if (!pageEl) return;

  const layoutEl = pageEl.querySelector('#brLayout');
  if (!layoutEl) return;

  layoutEl.innerHTML = '';
  COLUMNS.forEach(col => layoutEl.appendChild(buildColumn(col)));
}

function buildColumn(col) {
  const columnEl = document.createElement('div');
  columnEl.className = 'br-column';
  columnEl.dataset.colId = col.id;

  const titleEl = document.createElement('div');
  titleEl.className = 'br-column__title';
  titleEl.textContent = col.name;
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

  const match = findMatchForSlot(col.id, idx);

  if (!match) {
    matchEl.appendChild(buildSlot({ seed: '—', score: '—', empty: true }));
    matchEl.appendChild(buildSlot({ seed: '—', score: '—', empty: true }));
    return matchEl;
  }

  matchEl.appendChild(buildSlot({
    seed:  match.team1Acronym ? `seed ${match.team1Acronym}` : '—',
    score: match.team1Score != null ? String(match.team1Score) : '—',
    empty: !match.team1Acronym,
  }));

  matchEl.appendChild(buildSlot({
    seed:  match.team2Acronym ? `seed ${match.team2Acronym}` : '—',
    score: match.team2Score != null ? String(match.team2Score) : '—',
    empty: !match.team2Acronym,
  }));

  return matchEl;
}

function buildSlot({ seed, score, empty }) {
  const slotEl = document.createElement('div');
  slotEl.className = 'br-slot';
  if (empty) slotEl.classList.add('br-slot--empty');

  const seedEl = document.createElement('span');
  seedEl.className = 'br-slot__seed';
  seedEl.textContent = seed;

  const scoreEl = document.createElement('span');
  scoreEl.className = 'br-slot__score';
  scoreEl.textContent = score;

  slotEl.appendChild(seedEl);
  slotEl.appendChild(scoreEl);
  return slotEl;
}

/* ---------- 数据查询（兼容 roundId = id 或 name） ---------- */

function findMatchForSlot(colId, idx) {
  if (!_tournamentData) return null;

  const pattern = ROUND_MATCHERS[colId];
  if (!pattern) return null;

  const rounds = _tournamentData.getRounds();
  const round = rounds.find(r =>
    pattern.test(`${r.name || ''} ${r.description || ''}`)
  );
  if (!round) {
    console.warn(`[Bracket] 找不到列 "${colId}" 对应的轮次（正则：${pattern}）`);
    return null;
  }

  const all = _tournamentData.getMatches();
  const matches = all.filter(m =>
    m.roundId === round.id || m.roundId === round.name
  );

  if (!matches.length && idx === 0) {
    console.warn(
      `[Bracket] 轮次 "${round.name}"（id: ${round.id}）下没有匹配的 match。` +
      `请检查 matches[].roundId 是否等于 "${round.id}" 或 "${round.name}"`
    );
  }

  return matches[idx] || null;
}