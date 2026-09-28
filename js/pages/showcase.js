import { MapCard }    from '../components/mapCard.js';
import { StatsPanel } from '../components/statsPanel.js';

const COUNTDOWN_TITLE_KEY = 'cyt2026.showcaseCountdown.title';
const DEFAULT_TITLE = 'Swiss Phase I Showcase';

/* 阶段名 → mappool id */
const STAGE_TO_MAPPool = {
  'Swiss Phase I':  'swiss-1',
  'Swiss Phase II': 'swiss-2',
  'Bracket Stage':  'bracket',
};

export function initShowcase({ mapInfo, tokenStore, tournamentState, tournamentData }) {
  const pageEl = document.querySelector('[data-page="showcase"]');
  if (!pageEl) return;

  /* ---------- 左下：地图卡片 ---------- */
  const cardEl = pageEl.querySelector('.map-card');
  if (cardEl) {
    const card = new MapCard(cardEl, { tournamentData, tokenStore });
    mapInfo.watch(info => card.render(info));
  }

  /* ---------- 右下：数值面板 ---------- */
  const statsEl = pageEl.querySelector('.stats-panel');
  if (statsEl) {
    new StatsPanel(statsEl, { tokenStore }).mount();
  }

  /* ---------- 右下：mod 列表 ---------- */
  const state = { pool: null };

  function refresh() {
    const title = localStorage.getItem(COUNTDOWN_TITLE_KEY) || DEFAULT_TITLE;
    state.pool = findMappoolByTitle(tournamentData, title);

    renderModList(pageEl, state.pool);
    highlightCurrentMod(pageEl, state.pool, tokenStore.get('mapid'));
  }

  refresh();

  tokenStore.watch(['mapid'], (t) => {
    highlightCurrentMod(pageEl, state.pool, t.mapid);
  });

  pageEl.addEventListener('page:activated', refresh);
}

/* ---------- 从标题解析 mappool ---------- */

function findMappoolByTitle(tournamentData, title) {
  if (!title || !tournamentData) return null;

  /* 尝试阶段名匹配：遍历 STAGE_TO_MAPPool */
  for (const [stage, poolId] of Object.entries(STAGE_TO_MAPPool)) {
    if (title.includes(stage)) {
      return tournamentData.getMappool(poolId);
    }
  }

  /* 兜底：如果标题就是某个 mappool id */
  const pools = tournamentData.getMappools();
  return pools.find(p => title.includes(p.id)) || null;
}

/* ---------- Mod 列表 ---------- */

function renderModList(pageEl, pool) {
  const container = pageEl.querySelector('.stats-modlist');
  if (!container) return;

  const items = buildModItems(pool);

  /* 每行 8 个 */
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

function buildModItems(pool) {
  if (!pool?.beatmaps?.length) return [];
  return pool.beatmaps.map(bm => bm.mods || 'NM');
}

/* ---------- 高亮当前 mod ---------- */

function highlightCurrentMod(pageEl, pool, mapId) {
  const container = pageEl.querySelector('.stats-modlist');
  if (!container) return;

  container.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));

  if (!pool || mapId == null) return;

  const idStr = String(mapId);
  const current = pool.beatmaps?.find(bm =>
    bm.beatmapInfo?.onlineId != null &&
    String(bm.beatmapInfo.onlineId) === idStr
  );
  if (!current?.mods) return;

  const target = container.querySelector(`[data-mod="${CSS.escape(current.mods)}"]`);
  if (target) target.classList.add('is-active');
}