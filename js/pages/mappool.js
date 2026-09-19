const MOD_ICONS = {
  LM: 'src/mods/LM.png',
  NM: 'src/mods/NM.png',
  HD: 'src/mods/HD.png',
  HR: 'src/mods/HR.png',
  DT: 'src/mods/DT.png',
  TB: 'src/mods/TB.png',
};

const STORAGE_KEY_LOCAL  = 'mapBPActions';
const STORAGE_KEY_SHARED = 'cyt_woc_bp_actions_shared';

function getLayoutForRound(round) {
  const name = `${round?.name || ''} ${round?.description || ''}`;

  // Swiss Round 1 / 2
  if (/swiss\s*round\s*[12]\b/i.test(name)) {
    return [3, 1, 3, 2, 2, 2, 1];
  }

  // Swiss Round 3 / 4 / 5
  if (/swiss\s*round\s*[345]\b/i.test(name)) {
    return [3, 2, 3, 2, 2, 3, 1];
  }

  // 其它（默认）
  return [3, 3, 3, 1, 3, 3, 3, 1];
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function initMappool({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="mappool"]');
  if (!pageEl) return;

  const wrapper = pageEl.querySelector('#mappoolWrapper');

  // 控制面板在 sidebar 里
  const panel = document.getElementById('mappoolPanel');
  if (!panel) return;

  const selectedRoundEl = panel.querySelector('#mappoolSelectedRound');
  const roundOptionsEl  = panel.querySelector('#mappoolRoundOptions');

  const btnRedBan    = panel.querySelector('#mappoolRedBanBtn');
  const btnBlueBan   = panel.querySelector('#mappoolBlueBanBtn');
  const btnRedPick   = panel.querySelector('#mappoolRedPickBtn');
  const btnBluePick  = panel.querySelector('#mappoolBluePickBtn');
  const btnReset     = panel.querySelector('#mappoolResetBtn');

  const rounds = tournamentData.getRounds();
  let currentRound = rounds[0] || null;
  let currentMode  = 'redBan';
  let maps         = [];
  const mapStates  = new Map();

  if (!rounds.length) {
    wrapper.innerHTML = '<div class="mappool-empty">没有可用的轮次数据</div>';
    return;
  }

  /* ---------- 数据转换 ---------- */

  function beatmapToCard(bm) {
    const info = bm.beatmapInfo || {};
    const meta = info.metadata || {};
    const rawMod = bm.mods || 'NM';
    // "LM1" → "LM"，"NM" → "NM"，"HD2" → "HD"
    const modKey = rawMod.replace(/\d+$/, '') || 'NM';

    return {
      id:         String(info.onlineId ?? bm.id ?? ''),
      title:      meta.title || '',
      mapper:     meta.author?.username || '',
      difficulty: info.difficultyName || '',
      mod:        modKey,
      bg:         info.covers?.cover || info.covers?.['cover@2x'] || '',
    };
  }

  function loadMapsForRound(round) {
    maps = (round?.beatmaps || []).map(beatmapToCard);
  }

  /* ---------- 渲染 ---------- */

  function renderLayout() {
    wrapper.innerHTML = '';

    const layout = getLayoutForRound(currentRound);
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

      const rows = wrapper.querySelectorAll('.mapRow').length;
      wrapper.classList.toggle('is-compact', rows >= 8);

    restoreMapStates();
  }

  function createMapCard(map) {
    const card = document.createElement('div');
    card.className = 'mapContainer';
    card.dataset.mapId    = map.id;
    card.dataset.mapTitle = map.title;
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

  /* ---------- 交互 ---------- */

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

  /* ---------- 存储 ---------- */

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
    const local   = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '{}');
    const shared  = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    const actions = Object.keys(shared).length ? shared : local;

    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      const mapId    = card.dataset.mapId;
      const mapTitle = card.dataset.mapTitle;
      const state    = actions[mapTitle];
      const content  = card.querySelector('.mapContent');

      card.classList.remove('redBorder', 'blueBorder');
      content.classList.remove('banned');
      mapStates.delete(mapId);

      if (!state) return;

      card.classList.add(state.team === 'red' ? 'redBorder' : 'blueBorder');
      content.classList.toggle('banned', state.action === 'ban');

      mapStates.set(mapId, { action: state.action, team: state.team });
    });
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

  /* ---------- 轮次选择器 ---------- */

  function renderRoundOptions() {
    roundOptionsEl.innerHTML = '';
    rounds.forEach(r => {
      const opt = document.createElement('div');
      opt.className = 'custom-option';
      opt.dataset.value = r.id;
      opt.textContent = r.name || r.id;
      opt.classList.toggle('selected', r.id === currentRound?.id);
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        switchRound(r.id);
      });
      roundOptionsEl.appendChild(opt);
    });
  }

  function switchRound(roundId) {
    const r = rounds.find(x => x.id === roundId);
    if (!r) return;
    currentRound = r;
    selectedRoundEl.textContent = r.name || r.id;
    roundOptionsEl.classList.remove('active');
    roundOptionsEl.querySelectorAll('.custom-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.value === roundId);
    });
    loadMapsForRound(r);
    renderLayout();
  }

  /* ---------- 事件绑定 ---------- */

  btnRedBan.addEventListener('click',   () => setMode('redBan'));
  btnBlueBan.addEventListener('click',  () => setMode('blueBan'));
  btnRedPick.addEventListener('click',  () => setMode('redPick'));
  btnBluePick.addEventListener('click', () => setMode('bluePick'));
  btnReset.addEventListener('click', resetAll);

  selectedRoundEl.addEventListener('click', (e) => {
    e.stopPropagation();
    roundOptionsEl.classList.toggle('active');
  });
  document.addEventListener('click', () => roundOptionsEl.classList.remove('active'));

  /* ---------- 面板显隐 ---------- */

  function showPanel() { panel.hidden = false; }
  function hidePanel() { panel.hidden = true; }

  pageEl.addEventListener('page:activated', () => {
    showPanel();
    restoreMapStates();
  });
  pageEl.addEventListener('page:deactivated', hidePanel);

  /* ---------- 启动 ---------- */

  loadMapsForRound(currentRound);
  selectedRoundEl.textContent = currentRound.name || currentRound.id;
  renderRoundOptions();
  renderLayout();
  setMode('redBan');

  if (pageEl.classList.contains('active')) {
    showPanel();
  }
}