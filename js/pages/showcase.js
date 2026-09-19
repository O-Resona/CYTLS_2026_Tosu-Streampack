import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';

const COUNTDOWN_TITLE_KEY = 'cyt2026.showcaseCountdown.title';
const DEFAULT_TITLE = 'Qualifier ShowCase';

export function initShowcase({ mapInfo, tokenStore, tournamentState, tournamentData }) {
  const pageEl = document.querySelector('[data-page="showcase"]');
  if (!pageEl) return;

  /* ---------- 左下：地图卡片 ---------- */
  const cardEl = pageEl.querySelector('.map-card');
  if (cardEl) {
    const card = new MapCard(cardEl, { tournamentData, tokenStore });  // ← 多传两个依赖
    mapInfo.watch(info => card.render(info));
  }

  /* ---------- 右下：数值面板 ---------- */
  const statsEl = pageEl.querySelector('.stats-panel');
  if (statsEl) {
    new StatsPanel(statsEl, { tokenStore }).mount();
  }

  /* ---------- 右下：mod 列表 ---------- */
  const state = { round: null };

  function refresh() {
    const title = localStorage.getItem(COUNTDOWN_TITLE_KEY) || DEFAULT_TITLE;
    state.round = matchRound(tournamentData.getRounds(), title);
    renderModList(pageEl, state.round);
    highlightCurrentMod(pageEl, state.round, tokenStore.get('mapid'));
  }

  refresh();

  tokenStore.watch(['mapid'], (t) => {
    highlightCurrentMod(pageEl, state.round, t.mapid);
  });

  pageEl.addEventListener('page:activated', refresh);
}

/* ---------- Mod 列表 ---------- */

function renderModList(pageEl, round) {
  const container = pageEl.querySelector('.stats-modlist');
  if (!container) return;

  const items = buildModItems(round);

  // 每行 8 个
  const rows = [];
  for (let i = 0; i < items.length; i += 8) {
    rows.push(items.slice(i, i + 8));
  }

  container.innerHTML = rows.map(row =>
    `<div class="stats-modlist__row">${
      row.map(x => `<span data-mod="${x}">${x}</span>`).join('')
    }</div>`
  ).join('');
}

function buildModItems(round) {
  if (!round?.beatmaps?.length) return [];
  return round.beatmaps.map(bm => bm.mods || 'NM');
}

function matchRound(rounds, title) {
  if (!title || !rounds?.length) return null;
  for (const r of rounds) {
    if (r.name && title.includes(r.name)) return r;
  }
  const first = title.split(/\s+/)[0].replace(/[：:]/g, '');
  return rounds.find(r => r.name === first) || null;
}

function highlightCurrentMod(pageEl, round, mapId) {
  const container = pageEl.querySelector('.stats-modlist');
  if (!container) return;

  container.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));

  if (!round || mapId == null) return;

  const idStr = String(mapId);
  const current = round.beatmaps?.find(bm =>
    bm.beatmapInfo?.onlineId != null &&
    String(bm.beatmapInfo.onlineId) === idStr
  );
  if (!current?.mods) return;

  const target = container.querySelector(`[data-mod="${CSS.escape(current.mods)}"]`);
  if (target) target.classList.add('is-active');
}