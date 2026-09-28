/**
 * Mappool 子页面
 *
 * 图池展示 + BP 交互
 *
 * 轮次选择器现在按 mappool 分组显示：
 *   Swiss Phase Ⅰ / Swiss Phase Ⅱ / Bracket Stage
 */

const MOD_ICONS = {
  LM: 'src/mods/LM.png',
  NM: 'src/mods/NM.png',
  HD: 'src/mods/HD.png',
  HR: 'src/mods/HR.png',
  DT: 'src/mods/DT.png',
  FM: 'src/mods/FM.png',
  TB: 'src/mods/TB.png',
};

const STORAGE_KEY_LOCAL  = 'mapBPActions';
const STORAGE_KEY_SHARED = 'cyt_woc_bp_actions_shared';

/* mappool id → 显示名（json 里没写 name 时用） */
const MAPPool_LABELS = {
  'swiss-1': 'Swiss Phase Ⅰ',
  'swiss-2': 'Swiss Phase Ⅱ',
  'bracket': 'Bracket Stage',
};

/* mappool id → 布局（每行卡片数量） */
const MAPPool_LAYOUTS = {
  'swiss-1': [3, 1, 3, 2, 2, 2, 1],
  'swiss-2': [3, 2, 3, 2, 2, 3, 1],
  'bracket': [3, 3, 3, 1, 3, 3, 3, 1],
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function getMappoolLabel(pool) {
  if (!pool) return '—';
  return pool.name || MAPPool_LABELS[pool.id] || pool.id;
}

function getLayoutForMappool(pool) {
  if (!pool) return [3, 3, 3, 1, 3, 3, 3, 1];
  return MAPPool_LAYOUTS[pool.id] || [3, 3, 3, 1, 3, 3, 3, 1];
}

function isCompactMappool(pool) {
  return pool?.id === 'bracket';
}

/* =========================================
   入口
   ========================================= */

export function initMappool({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="mappool"]');
  if (!pageEl) return;

  const wrapper = pageEl.querySelector('#mappoolWrapper');

  const panel = document.getElementById('mappoolPanel');
  if (!panel) return;

  const selectedPoolEl  = panel.querySelector('#mappoolSelectedRound');   // 沿用原 id
  const poolOptionsEl   = panel.querySelector('#mappoolRoundOptions');    // 沿用原 id
  const btnRedBan       = panel.querySelector('#mappoolRedBanBtn');
  const btnBlueBan      = panel.querySelector('#mappoolBlueBanBtn');
  const btnRedPick      = panel.querySelector('#mappoolRedPickBtn');
  const btnBluePick     = panel.querySelector('#mappoolBluePickBtn');
  const btnReset        = panel.querySelector('#mappoolResetBtn');
  const btnReload       = panel.querySelector('#mappoolReloadBtn');

  const pools = tournamentData.getMappools();
  let currentPool = pools[0] || null;
  let currentMode = 'redBan';
  let maps        = [];
  const mapStates = new Map();

  if (!pools.length) {
    wrapper.innerHTML = '<div class="mappool-empty">没有可用的图池数据</div>';
    return;
  }

  /* =========================================
     数据转换
     ========================================= */

  function beatmapToCard(bm) {
    const info = bm.beatmapInfo || {};
    const meta = info.metadata || {};
    const rawMods = bm.mods || 'NM';
    const modKey = rawMods.replace(/\d+$/, '') || 'NM';

    return {
      id:         String(info.onlineId ?? bm.id ?? ''),
      title:      meta.title || '',
      mapper:     meta.author?.username || '',
      difficulty: info.difficultyName || '',
      mod:        modKey,
      rawMods,
      bg:         info.covers?.cover || info.covers?.['cover@2x'] || '',
    };
  }

  function loadMapsForPool(pool) {
    maps = (pool?.beatmaps || []).map(beatmapToCard);
  }

  /* =========================================
     渲染图池
     ========================================= */

  function renderLayout() {
    wrapper.innerHTML = '';
    wrapper.classList.toggle('is-compact', isCompactMappool(currentPool));

    const layout = getLayoutForMappool(currentPool);
    let idx = 0;

    for (const count of layout) {
      if (idx >= maps.length) break;
      const row = document.createElement('div');
      row.className = 'mapRow';
      for (let i = 0; i < count && idx < maps.length; i++, idx++) {
        row.appendChild(createMapCard(maps[idx]));
      }
      wrapper.appendChild(row);
    }

    while (idx < maps.length) {
      const row = document.createElement('div');
      row.className = 'mapRow';
      while (idx < maps.length && row.children.length < 3) {
        row.appendChild(createMapCard(maps[idx++]));
      }
      wrapper.appendChild(row);
    }

    restoreMapStates();
  }

  function createMapCard(map) {
    const card = document.createElement('div');
    card.className = 'mapContainer';
    card.dataset.mapId    = map.id;
    card.dataset.mapTitle = map.title;
    card.dataset.mods     = map.rawMods;
    if (map.bg) card.style.backgroundImage = `url('${map.bg}')`;

    card.innerHTML = `
      <div class="mapContent">
        <div class="banMap"></div>
        <div class="mapMetadata">
          <div class="bold">${escapeHtml(map.title)}</div>
          <div class="mapDetailsContainer">
            <div class="mapDetails">mapper <span class="bold">${escapeHtml(map.mapper)}</span></div>
            <div class="mapDetails">difficulty <span class="bold">${escapeHtml(map.difficulty)}</span></div>
          </div>
        </div>
        <div class="modImgContainer">
          <div class="modImgWrapper">
            <img src="${MOD_ICONS[map.mod] || MOD_ICONS.NM}" alt="${escapeHtml(map.mod)}">
          </div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => handleMapClick(card));
    return card;
  }

  /* =========================================
     交互
     ========================================= */

  function handleMapClick(card) {
    const mapId    = card.dataset.mapId;
    const mapTitle = card.dataset.mapTitle;
    const content  = card.querySelector('.mapContent');

    const team   = currentMode.includes('red') ? 'red' : 'blue';
    const action = currentMode.includes('Ban') ? 'ban' : 'pick';

    const existing = mapStates.get(mapId);

    if (existing && existing.team === team && existing.action === action) {
      card.classList.remove('redBorder', 'blueBorder');
      content.classList.remove('banned');
      mapStates.delete(mapId);
      removeMapState(mapTitle);
      return;
    }

    card.classList.remove('redBorder', 'blueBorder');
    card.classList.add(team === 'red' ? 'redBorder' : 'blueBorder');
    content.classList.toggle('banned', action === 'ban');

    triggerFlashAnimation(content);

    mapStates.set(mapId, { action, team });
    saveMapState(mapTitle, { action, team });
  }

  function triggerFlashAnimation(el) {
    el.classList.remove('flashingWhite');
    void el.offsetWidth;
    el.classList.add('flashingWhite');
    el.addEventListener('animationend', function onEnd() {
      el.classList.remove('flashingWhite');
      el.removeEventListener('animationend', onEnd);
    }, { once: true });
  }

  function setMode(mode) {
    currentMode = mode;
    [btnRedBan, btnBlueBan, btnRedPick, btnBluePick].forEach(b => b.classList.remove('active'));
    ({
      redBan:   btnRedBan,
      blueBan:  btnBlueBan,
      redPick:  btnRedPick,
      bluePick: btnBluePick,
    }[mode])?.classList.add('active');
  }

  /* =========================================
     存储
     ========================================= */

  function saveMapState(mapTitle, state) {
    if (!mapTitle) return;

    const local = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '{}');
    local[mapTitle] = { ...state, timestamp: Date.now(), source: 'manual' };
    localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(local));

    const shared = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    shared[mapTitle] = { ...state, timestamp: Date.now(), source: 'CYT_WOC_POOL' };
    localStorage.setItem(STORAGE_KEY_SHARED, JSON.stringify(shared));
  }

  function removeMapState(mapTitle) {
    if (!mapTitle) return;

    const local = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '{}');
    delete local[mapTitle];
    localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(local));

    const shared = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    delete shared[mapTitle];
    localStorage.setItem(STORAGE_KEY_SHARED, JSON.stringify(shared));
  }

  function restoreMapStates() {
    const local   = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL)  || '{}');
    const shared  = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    const actions = Object.keys(shared).length ? shared : local;
    const jsonBp  = getCurrentMatchBp();

    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      const mapId    = card.dataset.mapId;
      const mapTitle = card.dataset.mapTitle;
      const mods     = card.dataset.mods;
      const content  = card.querySelector('.mapContent');

      card.classList.remove('redBorder', 'blueBorder');
      content.classList.remove('banned');
      mapStates.delete(mapId);

      const localState = actions[mapTitle];
      if (localState) {
        applyBpState(card, content, mapId, localState);
        return;
      }

      const jsonState = findInJsonBp(jsonBp, mods);
      if (jsonState) {
        applyBpState(card, content, mapId, jsonState);
      }
    });
  }

  function applyBpState(card, content, mapId, state) {
    card.classList.add(state.team === 'red' ? 'redBorder' : 'blueBorder');
    content.classList.toggle('banned', state.action === 'ban');
    mapStates.set(mapId, { action: state.action, team: state.team });
  }

  function getCurrentMatchBp() {
    try {
      const idStr = localStorage.getItem('cyt2026.currentMatchId');
      if (!idStr) return { bans: [], picks: [] };
      const id = Number(idStr);
      if (!Number.isFinite(id)) return { bans: [], picks: [] };
      return tournamentData.getMatchBP(id);
    } catch {
      return { bans: [], picks: [] };
    }
  }

  function findInJsonBp(bp, mods) {
    if (!mods || !bp) return null;

    const ban = bp.bans?.find(x => x.mods === mods);
    if (ban) return { action: 'ban', team: ban.team };

    const pick = bp.picks?.find(x => x.mods === mods);
    if (pick) return { action: 'pick', team: pick.team };

    return null;
  }

  function resetAll() {
    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      card.classList.remove('redBorder', 'blueBorder');
      card.querySelector('.mapContent').classList.remove('banned');
    });
    mapStates.clear();
    localStorage.removeItem(STORAGE_KEY_LOCAL);
    localStorage.removeItem(STORAGE_KEY_SHARED);
  }

  function reloadFromJson() {
    localStorage.removeItem(STORAGE_KEY_LOCAL);
    localStorage.removeItem(STORAGE_KEY_SHARED);
    mapStates.clear();
    restoreMapStates();
  }

  /* =========================================
     图池选择器
     ========================================= */

  function renderPoolOptions() {
    poolOptionsEl.innerHTML = '';
    pools.forEach(p => {
      const opt = document.createElement('div');
      opt.className = 'custom-option';
      opt.dataset.value = p.id;
      opt.textContent = getMappoolLabel(p);
      opt.classList.toggle('selected', p.id === currentPool?.id);
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        switchPool(p.id);
      });
      poolOptionsEl.appendChild(opt);
    });
  }

  function switchPool(poolId) {
    const p = pools.find(x => x.id === poolId);
    if (!p) return;
    currentPool = p;
    selectedPoolEl.textContent = getMappoolLabel(p);
    poolOptionsEl.classList.remove('active');
    poolOptionsEl.querySelectorAll('.custom-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.value === poolId);
    });
    loadMapsForPool(p);
    renderLayout();
  }

  /* =========================================
     事件绑定
     ========================================= */

  btnRedBan.addEventListener('click',   () => setMode('redBan'));
  btnBlueBan.addEventListener('click',  () => setMode('blueBan'));
  btnRedPick.addEventListener('click',  () => setMode('redPick'));
  btnBluePick.addEventListener('click', () => setMode('bluePick'));
  btnReset.addEventListener('click', resetAll);
  btnReload?.addEventListener('click', reloadFromJson);

  selectedPoolEl.addEventListener('click', (e) => {
    e.stopPropagation();
    poolOptionsEl.classList.toggle('active');
  });
  document.addEventListener('click', () => poolOptionsEl.classList.remove('active'));

  /* =========================================
     面板显隐
     ========================================= */

  pageEl.addEventListener('page:activated', () => {
    panel.hidden = false;
    restoreMapStates();
  });
  pageEl.addEventListener('page:deactivated', () => {
    panel.hidden = true;
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'cyt2026.currentMatchId') restoreMapStates();
  });

  /* =========================================
     启动
     ========================================= */

  loadMapsForPool(currentPool);
  selectedPoolEl.textContent = getMappoolLabel(currentPool);
  renderPoolOptions();
  renderLayout();
  setMode('redBan');

  if (pageEl.classList.contains('active')) {
    panel.hidden = false;
  }
}