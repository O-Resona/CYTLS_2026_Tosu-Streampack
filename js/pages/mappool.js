/**
 * Mappool 子页面
 *
 * 图池展示 + BP 交互 + 自动 BP（AutoBp）
 *
 * 图池会跟随当前选中比赛所属轮次自动切换。
 * protect 与 ban/pick 互相独立；自动与手动操作共存，手动可覆盖。
 *
 * 手动操作会通过 syncFromUI 覆盖 AutoBp 内部状态，纠正误判。
 *
 * TB 图：protect / ban 一律忽略；pick 时统一紫框，不分队伍。
 *
 * 手动修改 BP 状态后派发 'bp-actions-changed' 事件，
 * 让 playing 页的 MapCard 在同一个 tab 内也能立即刷新边框。
 *
 * 切页：仅在 osu 发出「进入打图」事件时自动切到 playing。
 *       pick 地图本身不触发切页。
 */

import { AutoBp } from '../services/autoBp.js';
import { playAutoTransition } from '../services/autoTransition.js';

const MOD_ICONS = {
  LM: 'src/mods/LM.png',
  NM: 'src/mods/NM.png',
  HD: 'src/mods/HD.png',
  HR: 'src/mods/HR.png',
  DT: 'src/mods/DT.png',
  FM: 'src/mods/FM.png',
  TB: 'src/mods/TB.png',
};

const PROTECT_ICONS = {
  red:  'src/mods/protect_red.png',
  blue: 'src/mods/protect_blue.png',
};

const STORAGE_KEY_LOCAL          = 'mapBPActions';
const STORAGE_KEY_SHARED         = 'cyt_woc_bp_actions_shared';
const STORAGE_KEY_PROTECT_LOCAL  = 'mapProtectActions';
const STORAGE_KEY_PROTECT_SHARED = 'cyt_woc_protect_shared';

const MAPPool_LABELS = {
  'swiss-1': 'Swiss Phase Ⅰ',
  'swiss-2': 'Swiss Phase Ⅱ',
  'bracket': 'Bracket Stage',
};

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

export function initMappool({ tournamentData, osuSocket, tokenStore }) {
  const pageEl = document.querySelector('[data-page="mappool"]');
  if (!pageEl) return;

  const wrapper = pageEl.querySelector('#mappoolWrapper');

  const panel = document.getElementById('mappoolPanel');
  if (!panel) return;

  const selectedPoolEl  = panel.querySelector('#mappoolSelectedRound');
  const poolOptionsEl   = panel.querySelector('#mappoolRoundOptions');
  const btnRedProtect   = panel.querySelector('#mappoolRedProtectBtn');
  const btnBlueProtect  = panel.querySelector('#mappoolBlueProtectBtn');
  const btnRedBan       = panel.querySelector('#mappoolRedBanBtn');
  const btnBlueBan      = panel.querySelector('#mappoolBlueBanBtn');
  const btnRedPick      = panel.querySelector('#mappoolRedPickBtn');
  const btnBluePick     = panel.querySelector('#mappoolBluePickBtn');
  const btnReset        = panel.querySelector('#mappoolResetBtn');
  const btnReload       = panel.querySelector('#mappoolReloadBtn');
  const radioFirstRed   = panel.querySelector('input[name="firstPicker"][value="red"]');
  const radioFirstBlue  = panel.querySelector('input[name="firstPicker"][value="blue"]');

  const pools = tournamentData.getMappools();
  let currentPool = pools[0] || null;
  let currentMode = 'redProtect';
  let maps        = [];

  const mapStates     = new Map();   // mapId -> { action:'ban'|'pick', team:'red'|'blue'|'tb' }
  const protectStates = new Map();   // mapId -> { team }

  if (!pools.length) {
    wrapper.innerHTML = '<div class="mappool-empty">没有可用的图池数据</div>';
    return;
  }

  const playerRefs = {
    p1:       pageEl.querySelector('#mpTeam1P1'),
    p2:       pageEl.querySelector('#mpTeam1P2'),
    p1Bars:   pageEl.querySelector('#mpTeam1P1Bars'),
    p2Bars:   pageEl.querySelector('#mpTeam1P2Bars'),
    q1:       pageEl.querySelector('#mpTeam2P1'),
    q2:       pageEl.querySelector('#mpTeam2P2'),
    q1Bars:   pageEl.querySelector('#mpTeam2P1Bars'),
    q2Bars:   pageEl.querySelector('#mpTeam2P2Bars'),
  };

  function getCurrentMatchId() {
    try {
      const v = localStorage.getItem('cyt2026.currentMatchId');
      return v ? Number(v) : null;
    } catch { return null; }
  }

  /* =========================================
     图池自动同步
     ========================================= */

  function getPoolIdForCurrentMatch() {
    const id = getCurrentMatchId();
    if (id == null) return null;
    const match = tournamentData.getMatch(id);
    if (!match) return null;
    const round = tournamentData.getRound(match.roundId);
    return round?.mappool || null;
  }

  function syncPoolWithCurrentMatch() {
    const poolId = getPoolIdForCurrentMatch();
    if (!poolId) return;
    if (currentPool?.id === poolId) return;
    const p = pools.find(x => x.id === poolId);
    if (p) switchPool(poolId);
  }

  /* =========================================
     玩家长条
     ========================================= */

  const PLAYER_ROUNDS_KEY = 'cyt2026.playerRounds';

  function loadPlayerRounds() {
    try { return JSON.parse(localStorage.getItem(PLAYER_ROUNDS_KEY) || '{}'); }
    catch { return {}; }
  }
  function savePlayerRounds(d) {
    try { localStorage.setItem(PLAYER_ROUNDS_KEY, JSON.stringify(d)); } catch {}
  }

  /*
   * getUsed：
   *   1. 优先用 localStorage（手动调整 / 本局打图累计）
   *   2. localStorage 无记录 → 若该比赛已结束，回退到 bp.json 的 Pick 统计
   *      （只算 Pick，跳过 TB）
   */
  function getUsed(matchId, name) {
    if (matchId == null || !name) return 0;

    /* 1. 优先 localStorage */
    const localUsed = loadPlayerRounds()[String(matchId)]?.[name];
    if (localUsed != null) return Number(localUsed) || 0;

    /* 2. 已结束的比赛 → bp.json 统计 */
    if (tournamentData.isMatchFinished(matchId)) {
      const counts = tournamentData.getPlayerRoundsFromBp(matchId);
      if (counts) {
        const norm = s => String(s ?? '').trim().toLowerCase();
        const n = norm(name);
        const key = Object.keys(counts).find(k => norm(k) === n);
        if (key) return counts[key];
      }
    }

    return 0;
  }

  function setUsed(matchId, name, count) {
    if (matchId == null || !name) return;
    const all = loadPlayerRounds();
    const id = String(matchId);
    if (!all[id]) all[id] = {};
    all[id][name] = Math.max(0, count);
    savePlayerRounds(all);
  }

  function getMaxStarsForMatch(match) {
    if (!match) return 4;
    const round = tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    return Math.ceil(bestOf / 2) - 1;
  }

  function renderBars(container, name, matchId, maxStars) {
    if (!container || !name) { if (container) container.innerHTML = ''; return; }
    const used = getUsed(matchId, name);
    const remaining = Math.max(0, maxStars - used);

    if (remaining === 0) {
      if (container.dataset.mode !== 'cross') {
        container.dataset.mode = 'cross';
        container.innerHTML = '<span class="mp-player__cross"></span>';
      }
      return;
    }
    if (container.dataset.mode === 'bars'
        && container.children.length === remaining) return;

    container.dataset.mode = 'bars';
    container.innerHTML = '';
    for (let i = 0; i < remaining; i++) {
      const bar = document.createElement('span');
      bar.className = 'mp-player__bar';
      container.appendChild(bar);
    }
  }

  function renderPlayers() {
    const id = getCurrentMatchId();
    const match = id != null ? tournamentData.getMatch(id) : null;

    if (!match) {
      ['p1','p2','q1','q2'].forEach(k => {
        if (playerRefs[k]) playerRefs[k].textContent = '';
      });
      ['p1Bars','p2Bars','q1Bars','q2Bars'].forEach(k => {
        if (playerRefs[k]) { playerRefs[k].innerHTML = ''; playerRefs[k].dataset.mode = ''; }
      });
      return;
    }

    const t1 = match.team1Acronym ? tournamentData.getTeam(match.team1Acronym) : null;
    const t2 = match.team2Acronym ? tournamentData.getTeam(match.team2Acronym) : null;
    const maxStars = getMaxStarsForMatch(match);

    const ps1 = t1?.players || [];
    const ps2 = t2?.players || [];
    const n1 = ps1[0]?.username || '';
    const n2 = ps1[1]?.username || '';
    const n3 = ps2[0]?.username || '';
    const n4 = ps2[1]?.username || '';

    if (playerRefs.p1) playerRefs.p1.textContent = n1;
    if (playerRefs.p2) playerRefs.p2.textContent = n2;
    if (playerRefs.q1) playerRefs.q1.textContent = n3;
    if (playerRefs.q2) playerRefs.q2.textContent = n4;

    alignPlayerNames();
    renderBars(playerRefs.p1Bars, n1, id, maxStars);
    renderBars(playerRefs.p2Bars, n2, id, maxStars);
    renderBars(playerRefs.q1Bars, n3, id, maxStars);
    renderBars(playerRefs.q2Bars, n4, id, maxStars);
  }

  function adjustBar(name, delta) {
    const id = getCurrentMatchId();
    if (id == null || !name) return;
    const match = tournamentData.getMatch(id);
    if (!match) return;
    const maxStars = getMaxStarsForMatch(match);
    const used = getUsed(id, name);
    const next = Math.max(0, Math.min(maxStars, used + delta));
    if (next === used) return;
    setUsed(id, name, next);
    renderPlayers();
  }

  function bindBarEvents() {
    const map = [
      [playerRefs.p1Bars, () => playerRefs.p1?.textContent],
      [playerRefs.p2Bars, () => playerRefs.p2?.textContent],
      [playerRefs.q1Bars, () => playerRefs.q1?.textContent],
      [playerRefs.q2Bars, () => playerRefs.q2?.textContent],
    ];
    for (const [container, getName] of map) {
      if (!container) continue;
      const playerEl = container.closest('.mp-player');
      if (!playerEl || playerEl.dataset.bound === '1') continue;
      playerEl.dataset.bound = '1';
      playerEl.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const n = getName(); if (n) adjustBar(n, +1);
      });
      playerEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const n = getName(); if (n) adjustBar(n, -1);
      });
    }
  }

  /* =========================================
     打图状态：仅保留「进图 → 切页」逻辑
     扣条逻辑已在 playing.js 里处理
     ========================================= */

  let _lastPlayingState = null;

  function bindOsuEvents() {
    if (!osuSocket) return;

    osuSocket.on('playing', (isPlaying) => {
      /* 刚进图（false → true）且当前在 mappool 页 → 切到 playing */
      if (isPlaying && _lastPlayingState === false) {
        const activePage = document.querySelector('.page.active');
        if (activePage?.dataset.page === 'mappool') {
          playAutoTransition(() => {
            window.app?.router?.show('playing');
          });
        }
      }
      _lastPlayingState = isPlaying;
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'cyt2026.currentMatchId') {
        _lastPlayingState = false;
      }
      if (e.key === 'cyt2026.playerRounds') {
        renderPlayers();
      }
    });

    /* 同 tab 内打图结束 → 刷新长条 */
    window.addEventListener('player-rounds-changed', renderPlayers);
  }

  function alignPlayerNames() {
    const sides = [['p1','p2'], ['q1','q2']];
    for (const [a, b] of sides) {
      const elA = playerRefs[a], elB = playerRefs[b];
      if (!elA || !elB) continue;
      elA.style.minWidth = '0';
      elB.style.minWidth = '0';
      const maxW = Math.max(elA.offsetWidth, elB.offsetWidth);
      elA.style.minWidth = `${maxW}px`;
      elB.style.minWidth = `${maxW}px`;
    }
  }

  /* =========================================
     数据转换
     ========================================= */

  function beatmapToCard(bm) {
    const info = bm.beatmapInfo || {};
    const meta = info.metadata || {};
    const rawMods = bm.mods || 'NM';
    const modKey = rawMods.replace(/\d+$/, '') || 'NM';

    const artist = meta.artist || '';
    const title  = meta.title  || '';
    const artistTitle =
      (artist && title) ? `${artist}  -  ${title}` : (title || artist || '');

    return {
      id:         String(info.onlineId ?? bm.id ?? ''),
      artistTitle,
      title,
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
     渲染
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
          <div class="bold">${escapeHtml(map.artistTitle)}</div>
          <div class="mapDetailsContainer">
            <div class="mapDetails">mapper <span class="bold">${escapeHtml(map.mapper)}</span></div>
            <div class="mapDetails">difficulty <span class="bold">${escapeHtml(map.difficulty)}</span></div>
          </div>
        </div>
        <div class="modImgContainer">
          <div class="modImgWrapper">
            <img src="${MOD_ICONS[map.mod] || MOD_ICONS.NM}" alt="${escapeHtml(map.mod)}">
          </div>
          <img class="protectImg" src="${PROTECT_ICONS.red}" alt="protect">
        </div>
      </div>
    `;

    card.addEventListener('click', () => handleMapClick(card));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      resetMapCard(card);
    });
    return card;
  }

  /* =========================================
     核心操作
     ========================================= */

  function findCardByMods(mods) {
    if (!mods) return null;
    return wrapper.querySelector(`.mapContainer[data-mods="${mods}"]`);
  }

  function setProtectIcon(content, team) {
    const img = content?.querySelector('.protectImg');
    if (!img) return;
    const next = PROTECT_ICONS[team] || PROTECT_ICONS.red;
    if (img.getAttribute('src') !== next) img.setAttribute('src', next);
  }

  function isTBMap(card) {
    const mods = card?.dataset?.mods || '';
    return /^TB/i.test(mods);
  }

  /* 广播给同 tab 的其它组件（MapCard 等） */
  function notifyBpChanged() {
    window.dispatchEvent(new CustomEvent('bp-actions-changed'));
  }

  function applyCardAction(card, action, team, { toggle }) {
    if (!card) return;
    const content  = card.querySelector('.mapContent');
    const mapId    = card.dataset.mapId;
    const mapTitle = card.dataset.mapTitle;
    const isTB     = isTBMap(card);

    /* TB 图：protect / ban 一律忽略 */
    if (isTB && (action === 'protect' || action === 'ban')) return;

    /* ---------- protect ---------- */

    if (action === 'protect') {
      const existing = protectStates.get(mapId);
      if (toggle && existing && existing.team === team) {
        protectStates.delete(mapId);
        content.classList.remove('is-protected');
        removeProtectState(mapTitle);
        if (toggle) syncAutoBpToAuto('clear', null, mapId);
        return;
      }
      protectStates.set(mapId, { team });
      content.classList.add('is-protected');
      setProtectIcon(content, team);
      saveProtectState(mapTitle, { team });
      if (toggle) syncAutoBpToAuto('protect', team, mapId);
      return;
    }

    /* ---------- ban ---------- */

    if (action === 'ban') {
      const existing = mapStates.get(mapId);
      if (toggle && existing && existing.team === team && existing.action === action) {
        card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
        content.classList.remove('banned');
        mapStates.delete(mapId);
        removeMapState(mapTitle);
        if (toggle) syncAutoBpToAuto('clear', null, mapId);
        return;
      }

      card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
      card.classList.add(team === 'red' ? 'redBorder' : 'blueBorder');
      content.classList.add('banned');
      triggerFlashAnimation(content);

      mapStates.set(mapId, { action, team });
      saveMapState(mapTitle, { action, team });

      if (toggle) syncAutoBpToAuto(action, team, mapId);
      return;
    }

    /* ---------- pick ---------- */

    if (action === 'pick') {
      const existing = mapStates.get(mapId);

      /* TB：不分队伍，统一紫框 */
      if (isTB) {
        if (toggle && existing && existing.action === 'pick') {
          card.classList.remove('purpleBorder');
          mapStates.delete(mapId);
          removeMapState(mapTitle);
          return;
        }
        card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
        card.classList.add('purpleBorder');
        triggerFlashAnimation(content);

        mapStates.set(mapId, { action: 'pick', team: 'tb' });
        saveMapState(mapTitle, { action: 'pick', team: 'tb' });
        return;
      }

      /* 普通图 pick */
      if (toggle && existing && existing.team === team && existing.action === action) {
        card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
        mapStates.delete(mapId);
        removeMapState(mapTitle);
        if (toggle) syncAutoBpToAuto('clear', null, mapId);
        return;
      }

      card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
      card.classList.add(team === 'red' ? 'redBorder' : 'blueBorder');
      content.classList.remove('banned');
      triggerFlashAnimation(content);

      mapStates.set(mapId, { action, team });
      saveMapState(mapTitle, { action, team });

      if (toggle) syncAutoBpToAuto('pick', team, mapId);
    }
  }

  function handleMapClick(card) {
    const team   = currentMode.includes('red') ? 'red' : 'blue';
    const action = currentMode.includes('Protect') ? 'protect'
                 : currentMode.includes('Ban')     ? 'ban'
                 : 'pick';
    applyCardAction(card, action, team, { toggle: true });
  }

  function resetMapCard(card) {
    const mapId    = card.dataset.mapId;
    const mapTitle = card.dataset.mapTitle;
    const content  = card.querySelector('.mapContent');

    const hasBorder  = card.classList.contains('redBorder')
                    || card.classList.contains('blueBorder')
                    || card.classList.contains('purpleBorder');
    const hasBanned  = content.classList.contains('banned');
    const hasProtect = content.classList.contains('is-protected');
    if (!hasBorder && !hasBanned && !hasProtect) return;

    card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
    content.classList.remove('banned', 'is-protected');

    mapStates.delete(mapId);
    protectStates.delete(mapId);
    removeMapState(mapTitle);
    removeProtectState(mapTitle);

    syncAutoBpToAuto('clear', null, mapId);
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
    [btnRedProtect, btnBlueProtect,
     btnRedBan, btnBlueBan,
     btnRedPick, btnBluePick].forEach(b => b?.classList.remove('active'));
    ({
      redProtect:  btnRedProtect,
      blueProtect: btnBlueProtect,
      redBan:      btnRedBan,
      blueBan:     btnBlueBan,
      redPick:     btnRedPick,
      bluePick:    btnBluePick,
    }[mode])?.classList.add('active');
  }

  /* =========================================
     UI → AutoBp 同步
     ========================================= */

  /* 从 UI 读取完整 BP 状态快照（mods 为 key） */
  function buildUISnapshotForAutoBp() {
    const protects = { red: [], blue: [] };
    const bans     = { red: [], blue: [] };
    const picks    = { red: [], blue: [] };

    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      const mapId = card.dataset.mapId;
      const mods  = card.dataset.mods;
      if (!mapId || !mods) return;

      const ps = protectStates.get(mapId);
      if (ps) protects[ps.team].push(mods);

      const ms = mapStates.get(mapId);
      if (ms) {
        if (ms.action === 'ban' && (ms.team === 'red' || ms.team === 'blue')) {
          bans[ms.team].push(mods);
        } else if (ms.action === 'pick' && (ms.team === 'red' || ms.team === 'blue')) {
          picks[ms.team].push(mods);
        }
      }
    });

    return { protects, bans, picks };
  }

  /* 把 UI 最新状态同步给 autoBp */
  function syncAutoBpToAuto(action, side, mapId) {
    if (!autoBp) return;

    const snapshot = buildUISnapshotForAutoBp();

    if (action === 'clear') {
      snapshot.lastAction = { action: 'clear' };
    } else {
      const card = wrapper.querySelector(`.mapContainer[data-map-id="${mapId}"]`);
      const mods = card?.dataset.mods || '';
      snapshot.lastAction = { action, side, mods };
    }

    autoBp.syncFromUI(snapshot);
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

    notifyBpChanged();
  }
  function removeMapState(mapTitle) {
    if (!mapTitle) return;
    const local = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '{}');
    delete local[mapTitle];
    localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(local));
    const shared = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    delete shared[mapTitle];
    localStorage.setItem(STORAGE_KEY_SHARED, JSON.stringify(shared));

    notifyBpChanged();
  }
  function saveProtectState(mapTitle, state) {
    if (!mapTitle) return;
    const local = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_LOCAL) || '{}');
    local[mapTitle] = { ...state, timestamp: Date.now(), source: 'manual' };
    localStorage.setItem(STORAGE_KEY_PROTECT_LOCAL, JSON.stringify(local));

    const shared = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_SHARED) || '{}');
    shared[mapTitle] = { ...state, timestamp: Date.now(), source: 'CYT_WOC_POOL' };
    localStorage.setItem(STORAGE_KEY_PROTECT_SHARED, JSON.stringify(shared));
  }
  function removeProtectState(mapTitle) {
    if (!mapTitle) return;
    const local = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_LOCAL) || '{}');
    delete local[mapTitle];
    localStorage.setItem(STORAGE_KEY_PROTECT_LOCAL, JSON.stringify(local));
    const shared = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_SHARED) || '{}');
    delete shared[mapTitle];
    localStorage.setItem(STORAGE_KEY_PROTECT_SHARED, JSON.stringify(shared));
  }

  function restoreMapStates() {
    const localBP  = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL)  || '{}');
    const sharedBP = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARED) || '{}');
    const actions  = Object.keys(sharedBP).length ? sharedBP : localBP;

    const localP   = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_LOCAL)  || '{}');
    const sharedP  = JSON.parse(localStorage.getItem(STORAGE_KEY_PROTECT_SHARED) || '{}');
    const protects = Object.keys(sharedP).length ? sharedP : localP;

    const jsonBp = getCurrentMatchBp();

    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      const mapId    = card.dataset.mapId;
      const mapTitle = card.dataset.mapTitle;
      const mods     = card.dataset.mods;
      const content  = card.querySelector('.mapContent');

      card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
      content.classList.remove('banned', 'is-protected');
      mapStates.delete(mapId);
      protectStates.delete(mapId);

      const localState = actions[mapTitle];
      if (localState) applyBpState(card, content, mapId, localState);
      else {
        const jsonState = findInJsonBp(jsonBp, mods);
        if (jsonState) applyBpState(card, content, mapId, jsonState);
      }

      const localProt = protects[mapTitle];
      if (localProt) applyProtectState(content, mapId, localProt);
      else {
        const jsonProt = findProtectInJsonBp(jsonBp, mods);
        if (jsonProt) applyProtectState(content, mapId, jsonProt);
      }
    });
  }

  function applyBpState(card, content, mapId, state) {
    if (state.team === 'tb') {
      card.classList.add('purpleBorder');
    } else {
      card.classList.add(state.team === 'red' ? 'redBorder' : 'blueBorder');
      content.classList.toggle('banned', state.action === 'ban');
    }
    mapStates.set(mapId, { action: state.action, team: state.team });
  }
  function applyProtectState(content, mapId, state) {
    content.classList.add('is-protected');
    setProtectIcon(content, state.team);
    protectStates.set(mapId, { team: state.team });
  }

  function getCurrentMatchBp() {
    try {
      const idStr = localStorage.getItem('cyt2026.currentMatchId');
      if (!idStr) return { bans: [], picks: [], protects: [] };
      const id = Number(idStr);
      if (!Number.isFinite(id)) return { bans: [], picks: [], protects: [] };
      return tournamentData.getMatchBP(id);
    } catch { return { bans: [], picks: [], protects: [] }; }
  }
  function findInJsonBp(bp, mods) {
    if (!mods || !bp) return null;
    const ban  = bp.bans?.find(x => x.mods === mods);
    if (ban)  return { action: 'ban', team: ban.team };
    const pick = bp.picks?.find(x => x.mods === mods);
    if (pick) return { action: 'pick', team: pick.team };
    return null;
  }
  function findProtectInJsonBp(bp, mods) {
    if (!mods || !bp) return null;
    const protect = bp.protects?.find(x => x.mods === mods);
    if (protect) return { team: protect.team };
    return null;
  }

  function resetAll() {
    wrapper.querySelectorAll('.mapContainer').forEach(card => {
      card.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
      card.querySelector('.mapContent').classList.remove('banned', 'is-protected');
    });
    mapStates.clear();
    protectStates.clear();
    localStorage.removeItem(STORAGE_KEY_LOCAL);
    localStorage.removeItem(STORAGE_KEY_SHARED);
    localStorage.removeItem(STORAGE_KEY_PROTECT_LOCAL);
    localStorage.removeItem(STORAGE_KEY_PROTECT_SHARED);

    notifyBpChanged();

    autoBp?.reset();

    if (autoBp) {
      autoBp.syncFromUI({
        protects: { red: [], blue: [] },
        bans:     { red: [], blue: [] },
        picks:    { red: [], blue: [] },
        lastAction: { action: 'clear' },
      });
    }

    resetAutoBpModeSync();
    setMode('redProtect');
  }

  function reloadFromJson() {
    localStorage.removeItem(STORAGE_KEY_LOCAL);
    localStorage.removeItem(STORAGE_KEY_SHARED);
    localStorage.removeItem(STORAGE_KEY_PROTECT_LOCAL);
    localStorage.removeItem(STORAGE_KEY_PROTECT_SHARED);
    mapStates.clear();
    protectStates.clear();

    notifyBpChanged();

    restoreMapStates();
    autoBp?.reset();

    resetAutoBpModeSync();
    setMode('redProtect');
  }

  /* =========================================
     AutoBp 集成
     ========================================= */

  let autoBp = null;
  let _lastAutoBpModeSig = '';

  function handleAutoAction(action, side, mods) {
    const card = findCardByMods(mods);
    if (!card) return;

    /* 自动操作 → 同步左侧控制面板高亮 */
    const modeName = side === 'red'
      ? (action === 'protect' ? 'redProtect'
       : action === 'ban'     ? 'redBan'
       :                        'redPick')
      : (action === 'protect' ? 'blueProtect'
       : action === 'ban'     ? 'blueBan'
       :                        'bluePick');
    setMode(modeName);

    applyCardAction(card, action, side, { toggle: false });
  }

  function initAutoBp() {
    if (!tokenStore) return;
    autoBp = new AutoBp({
      tournamentData,
      osuSocket,
      tokenStore,
      onAction:      handleAutoAction,
      onStateChange: () => syncModeFromAutoBp(),
    });
    autoBp.start();

    if (radioFirstRed)  radioFirstRed.checked  = true;
    if (radioFirstBlue) radioFirstBlue.checked = false;
    const savedPicker = getFirstPickerFromStorage();
    if (savedPicker) {
      autoBp.setFirstPicker(savedPicker);
      if (radioFirstRed)  radioFirstRed.checked  = savedPicker === 'red';
      if (radioFirstBlue) radioFirstBlue.checked = savedPicker === 'blue';
    }

    radioFirstRed ?.addEventListener('change', () => {
      if (radioFirstRed.checked) {
        autoBp.setFirstPicker('red');
        setFirstPickerToStorage('red');
        syncModeFromAutoBp();
      }
    });
    radioFirstBlue?.addEventListener('change', () => {
      if (radioFirstBlue.checked) {
        autoBp.setFirstPicker('blue');
        setFirstPickerToStorage('blue');
        syncModeFromAutoBp();
      }
    });

    syncModeFromAutoBp();
  }

  /* 根据 autoBp 状态同步左侧黄框（带签名判重，只在状态真正变化时才改） */
  function syncModeFromAutoBp() {
    if (!autoBp) return;
    const s = autoBp.getState();
    if (!s.started) return;

    let mode = null;

    if (s.phase === 'pick') {
      mode = s.pickTurn === 'red' ? 'redPick' : 'bluePick';
    } else {
      const order = s.firstPicker === 'red' ? ['red', 'blue'] : ['blue', 'red'];

      for (const side of order) {
        if (!s.teams[side].protect) {
          mode = side === 'red' ? 'redProtect' : 'blueProtect';
          break;
        }
      }

      if (!mode) {
        const r = s.teams.red.bans.length;
        const b = s.teams.blue.bans.length;
        let side;
        if (r < b) side = 'red';
        else if (b < r) side = 'blue';
        else side = order[0];
        mode = side === 'red' ? 'redBan' : 'blueBan';
      }
    }

    const sig = `${mode}|${s.phase}|${s.pickTurn}`;
    if (sig === _lastAutoBpModeSig) return;
    _lastAutoBpModeSig = sig;

    if (mode) setMode(mode);
  }

  /* 重置签名并立刻重新同步 */
  function resetAutoBpModeSync() {
    _lastAutoBpModeSig = '';
    syncModeFromAutoBp();
  }

  const FIRST_PICKER_KEY = 'cyt2026.firstPicker';
  function getFirstPickerFromStorage() {
    try { return localStorage.getItem(FIRST_PICKER_KEY) || null; }
    catch { return null; }
  }
  function setFirstPickerToStorage(v) {
    try { localStorage.setItem(FIRST_PICKER_KEY, v); } catch {}
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
    resetAutoBpModeSync();
  }

  /* =========================================
     事件绑定
     ========================================= */

  btnRedProtect .addEventListener('click', () => setMode('redProtect'));
  btnBlueProtect.addEventListener('click', () => setMode('blueProtect'));
  btnRedBan     .addEventListener('click', () => setMode('redBan'));
  btnBlueBan    .addEventListener('click', () => setMode('blueBan'));
  btnRedPick    .addEventListener('click', () => setMode('redPick'));
  btnBluePick   .addEventListener('click', () => setMode('bluePick'));
  btnReset      .addEventListener('click', resetAll);
  btnReload    ?.addEventListener('click', reloadFromJson);

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
    syncPoolWithCurrentMatch();
    restoreMapStates();
    renderPlayers();
    resetAutoBpModeSync();
  });
  pageEl.addEventListener('page:deactivated', () => {
    panel.hidden = true;
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'cyt2026.currentMatchId' || e.key === 'cyt2026.matchOverrides') {
      syncPoolWithCurrentMatch();
      restoreMapStates();
      renderPlayers();
      resetAutoBpModeSync();
    }
  });

  /* =========================================
     启动
     ========================================= */

  loadMapsForPool(currentPool);
  selectedPoolEl.textContent = getMappoolLabel(currentPool);
  renderPoolOptions();
  renderLayout();
  setMode('redProtect');
  bindBarEvents();
  bindOsuEvents();
  syncPoolWithCurrentMatch();
  renderPlayers();
  initAutoBp();

  if (pageEl.classList.contains('active')) panel.hidden = false;
}