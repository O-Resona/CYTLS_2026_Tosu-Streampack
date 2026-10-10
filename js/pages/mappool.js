/**
 * Mappool 子页面
 *
 * 图池展示 + BP 交互 + 自动 BP（AutoBp）+ 左侧数据面板
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
 *
 * 左侧数据面板：
 *   · BP 开始（roll 或首次 BP 动作）→ 显示两队之前场次的 protect / ban
 *     （不再自动隐藏，等任一方出现 protect / ban 时隐藏）
 *   · pick 阶段换图后 4s → 显示该图历史成绩
 *     （不再自动隐藏，除非换图 / 切页 / 手动隐藏）
 *   · 手动「展示数据」按钮 / 下拉选择图 → 立即展示
 *   · 切页强制隐藏
 */

import { AutoBp } from '../services/autoBp.js';
import { playAutoTransition } from '../services/autoTransition.js';
import { ScoresData } from '../services/scoresData.js';
import { ScoreOverlay } from '../components/scoreOverlay.js';

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

  const selPickEl    = panel.querySelector('#mappoolSelectedPick');
  const pickOptsEl   = panel.querySelector('#mappoolPickOptions');
  const btnShowData  = panel.querySelector('#mappoolShowDataBtn');
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
  let _currentPickMapId = null;

  const mapStates     = new Map();
  const protectStates = new Map();

  /* ---------- 左侧数据面板 / 成绩数据 ---------- */
  const overlayEl    = pageEl.querySelector('#scoreOverlay');
  const scoreOverlay = overlayEl
    ? new ScoreOverlay(overlayEl, { onChange: () => updateShowDataBtn() })
    : null;
  const scoresData   = new ScoresData({ tournamentData });

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

  function getUsed(matchId, name) {
    if (matchId == null || !name) return 0;

    const localUsed = loadPlayerRounds()[String(matchId)]?.[name];
    if (localUsed != null) return Number(localUsed) || 0;

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
     ========================================= */

  let _lastPlayingState = null;

  function bindOsuEvents() {
    if (!osuSocket) return;

    osuSocket.on('playing', (isPlaying) => {
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

  function notifyBpChanged() {
    window.dispatchEvent(new CustomEvent('bp-actions-changed'));
  }

  function applyCardAction(card, action, team, { toggle }) {
    if (!card) return;
    const content  = card.querySelector('.mapContent');
    const mapId    = card.dataset.mapId;
    const mapTitle = card.dataset.mapTitle;
    const isTB     = isTBMap(card);

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
     左侧信息面板：BP / 出分
     ========================================= */

  let _bpOverlayShown = false;
  let _lastBpMatchId  = null;
  let _lastScoreMapId = null;
  let _scoreTimer     = null;
  let _overlayMode    = null;   // 'bp' | 'score' | null

  function formatNum(n) {
    return (Number(n) || 0).toLocaleString('en-US');
  }

  function fmtPct(v) {
    return Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : '--';
  }

  /* ---------- BP 榜：两队之前场次的 protect / ban ---------- */

  function onBpStateChange() {
    if (!scoreOverlay || !autoBp) return;

    const matchId = getCurrentMatchId();

    if (matchId !== _lastBpMatchId) {
      _lastBpMatchId  = matchId;
      _bpOverlayShown = false;
      _overlayMode    = null;
    }

    const s = autoBp.getState();
    if (!s.started) return;

    /* 已显示过 → 只要出现 protect / ban 就隐藏 BP 榜 */
    if (_bpOverlayShown) {
      if (_overlayMode === 'bp') {
        const hasBp = !!(s.teams.red.protect || s.teams.blue.protect
                      || s.teams.red.bans.length || s.teams.blue.bans.length);
        if (hasBp) {
          scoreOverlay.hide();
          _overlayMode = null;
        }
      }
      return;
    }

    _bpOverlayShown = true;
    showBpOverlay();
  }

  function showBpOverlay() {
    if (document.querySelector('.page.active')?.dataset.page !== 'mappool') return;

    const matchId = getCurrentMatchId();
    if (matchId == null) return;
    const match = tournamentData.getMatch(matchId);
    if (!match) return;

    const t1 = match.team1Acronym ? tournamentData.getTeam(match.team1Acronym) : null;
    const t2 = match.team2Acronym ? tournamentData.getTeam(match.team2Acronym) : null;

    const h1 = match.team1Acronym
      ? tournamentData.getTeamBpHistory(match.team1Acronym, { excludeMatchId: matchId })
      : { protects: [], bans: [] };
    const h2 = match.team2Acronym
      ? tournamentData.getTeamBpHistory(match.team2Acronym, { excludeMatchId: matchId })
      : { protects: [], bans: [] };

    const fmt = arr => (arr && arr.length) ? arr.join('  /  ') : '—';

    const bodyHtml = `
      <div class="so-table">
        <div class="so-row so-row--head">
          <span class="so-cell so-cell--team">TEAM</span>
          <span class="so-cell so-cell--protect">PROTECT</span>
          <span class="so-cell so-cell--ban">BAN</span>
        </div>
        <div class="so-row so-row--red">
          <span class="so-cell so-cell--team">${escapeHtml(t1?.acronym || 'RED')}</span>
          <span class="so-cell so-cell--protect">${escapeHtml(fmt(h1.protects))}</span>
          <span class="so-cell so-cell--ban">${escapeHtml(fmt(h1.bans))}</span>
        </div>
        <div class="so-row so-row--blue">
          <span class="so-cell so-cell--team">${escapeHtml(t2?.acronym || 'BLUE')}</span>
          <span class="so-cell so-cell--protect">${escapeHtml(fmt(h2.protects))}</span>
          <span class="so-cell so-cell--ban">${escapeHtml(fmt(h2.bans))}</span>
        </div>
      </div>
    `;

    scoreOverlay.show({
      title: 'Previous BP',
      bodyHtml,
      duration: 0,          /* 不自动隐藏，等 protect / ban 出现时隐藏 */
    });
    _overlayMode = 'bp';
  }

  /* ---------- 成绩榜：当前图历史成绩 ---------- */

  function onMapIdChange(mapId) {
    if (mapId != null && mapId !== '') {
      setPickMap(String(mapId));
    }

    if (!autoBp) return;
    if (autoBp.getState().phase !== 'pick') return;
    if (mapId == null || mapId === '') return;

    const idStr = String(mapId);
    if (idStr === _lastScoreMapId) return;
    _lastScoreMapId = idStr;

    if (_scoreTimer) clearTimeout(_scoreTimer);
    _scoreTimer = setTimeout(() => {
      _scoreTimer = null;
      showScoreOverlay(idStr);
    }, 4000);
  }

  async function showScoreOverlay(mapId) {
    if (!scoreOverlay || !scoresData) return;
    if (document.querySelector('.page.active')?.dataset.page !== 'mappool') return;

    const poolId = currentPool?.id;
    if (!poolId) return;

    await scoresData.loadPool(poolId);

    if (document.querySelector('.page.active')?.dataset.page !== 'mappool') return;

    const rooms = scoresData.getRoomsForBeatmap(poolId, mapId);
    if (!rooms.length) return;

    const matchId = getCurrentMatchId();
    const match   = matchId != null ? tournamentData.getMatch(matchId) : null;

    const bm   = maps.find(m => String(m.id) === String(mapId));
    const slot = bm?.rawMods || bm?.mod || '';

    /* 该图池 BP 统计（跨轮次累计，取已完赛非 FF 的场次） */
    let stats = null;
    if (poolId && slot) {
      const raw = tournamentData.getPoolBpStats(poolId, slot);
      if (raw.total > 0) {
        stats = {
          protect: raw.protect / raw.total,
          ban:     raw.ban     / raw.total,
          pick:    raw.pick    / raw.total,
        };
      } else {
        stats = { protect: null, ban: null, pick: null };
      }
    }

    const title    = buildScoreTitleHtml(slot, stats);
    const bodyHtml = buildScoreTableHtml(rooms, match);

    scoreOverlay.show({ title, bodyHtml, duration: 0 });   /* 不自动隐藏 */
    _overlayMode = 'score';
  }

  function buildScoreTitleHtml(slot, stats) {
    const slotHtml = escapeHtml(slot || 'MAP SCORES');

    if (!stats) return slotHtml;

    const p = fmtPct(stats.protect);
    const b = fmtPct(stats.ban);
    const k = fmtPct(stats.pick);

    return `
      <div class="score-overlay__stats">
        <div>protect: ${p}&nbsp;&nbsp;&nbsp;ban: ${b}</div>
        <div>pick: ${k}</div>
      </div>
      <span class="score-overlay__slot">${slotHtml}</span>
    `;
  }

  function buildScoreTableHtml(rooms, match) {
    const t1Acr = match?.team1Acronym || null;
    const t2Acr = match?.team2Acronym || null;

    const rows = [];

    for (const room of rooms) {
      for (const r of room.rows) {
        const found = tournamentData.findPlayerById(r.userId);
        const team  = found?.team || null;
        const uname = found?.player?.username || `User ${r.userId}`;

        let side = 'neutral';
        if (team && t1Acr && team.acronym === t1Acr) side = 'red';
        else if (team && t2Acr && team.acronym === t2Acr) side = 'blue';

        rows.push({
          teamName: team?.acronym || '—',
          username: uname,
          scoreRaw: Number(r.score) || 0,
          score:    formatNum(r.score),
          accRaw:   parseFloat(r.accuracy) || 0,
          acc:      r.accuracy || '—',
          cbRaw:    Number(r.maxCombo) || 0,
          cb:       r.maxCombo != null ? formatNum(r.maxCombo) : '—',
          side,
        });
      }
    }

    if (!rows.length) return '';

    /* 按 score 降序 */
    rows.sort((a, b) => b.scoreRaw - a.scoreRaw);

    const maxScore = Math.max(...rows.map(r => r.scoreRaw));
    const maxAcc   = Math.max(...rows.map(r => r.accRaw));
    const maxCb    = Math.max(...rows.map(r => r.cbRaw));

    const bodyHtml = rows.map(r => {
      const scoreCls = r.scoreRaw === maxScore ? ' is-max' : '';
      const accCls   = Math.abs(r.accRaw - maxAcc) < 1e-6 ? ' is-max' : '';
      const cbCls    = r.cbRaw === maxCb ? ' is-max' : '';

      return `
        <div class="so-row so-row--${r.side}">
          <span class="so-cell so-cell--team">${escapeHtml(r.teamName)}</span>
          <span class="so-cell so-cell--player">${escapeHtml(r.username)}</span>
          <span class="so-cell so-cell--score${scoreCls}">${escapeHtml(r.score)}</span>
          <span class="so-cell so-cell--acc${accCls}">${escapeHtml(r.acc)}</span>
          <span class="so-cell so-cell--cb${cbCls}">${escapeHtml(r.cb)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="so-table">
        <div class="so-row so-row--head">
          <span class="so-cell so-cell--team">TEAM</span>
          <span class="so-cell so-cell--player">PLAYER</span>
          <span class="so-cell so-cell--score">SCORE</span>
          <span class="so-cell so-cell--acc">ACC</span>
          <span class="so-cell so-cell--cb">COMBO</span>
        </div>
        <div class="so-scroll">
          <div class="so-track">
            <div class="so-segment">
              ${bodyHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* =========================================
     当前 pick 框 / 选项 / 展示按钮
     ========================================= */

  function renderPickOptions() {
    if (!pickOptsEl) return;
    pickOptsEl.innerHTML = '';

    maps.forEach(map => {
      const opt = document.createElement('div');
      opt.className = 'custom-option';
      opt.dataset.mapId = String(map.id);
      opt.textContent = map.rawMods || map.mod || '';
      opt.classList.toggle('selected', String(map.id) === _currentPickMapId);

      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        pickOptsEl.classList.remove('active');

        setPickMap(String(map.id));

        if (_scoreTimer) { clearTimeout(_scoreTimer); _scoreTimer = null; }
        showScoreOverlay(String(map.id));
      });

      pickOptsEl.appendChild(opt);
    });
  }

  function setPickMap(mapId) {
    _currentPickMapId = (mapId != null && mapId !== '') ? String(mapId) : null;

    const map = _currentPickMapId
      ? maps.find(m => String(m.id) === _currentPickMapId)
      : null;

    if (selPickEl) {
      selPickEl.textContent = map ? (map.rawMods || map.mod || '—') : '—';
    }

    if (pickOptsEl) {
      pickOptsEl.querySelectorAll('.custom-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.mapId === _currentPickMapId);
      });
    }
  }

  function updateShowDataBtn() {
    if (!btnShowData || !overlayEl) return;
    const visible = overlayEl.classList.contains('is-visible');
    const isScore = _overlayMode === 'score';
    /* 只有成绩榜可见时按钮才显示为"隐藏"；BP 榜可见时按钮仍显示为"展示数据" */
    btnShowData.textContent = (visible && isScore) ? '隐藏' : '展示数据';
    btnShowData.classList.toggle('is-active', visible && isScore);
  }

  /* =========================================
     AutoBp 集成
     ========================================= */

  let autoBp = null;
  let _lastAutoBpModeSig = '';

  function handleAutoAction(action, side, mods) {
    const card = findCardByMods(mods);
    if (!card) return;

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
      onStateChange: () => {
        syncModeFromAutoBp();
        onBpStateChange();
      },
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
     图池切换
     ========================================= */

  function switchPool(poolId) {
    const p = pools.find(x => x.id === poolId);
    if (!p) return;

    currentPool = p;
    loadMapsForPool(p);
    renderLayout();
    renderPickOptions();

    const id = tokenStore?.get('mapid');
    setPickMap(id ? String(id) : null);

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

  selPickEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    pickOptsEl?.classList.toggle('active');
  });
  document.addEventListener('click', () => pickOptsEl?.classList.remove('active'));

  btnShowData?.addEventListener('click', () => {
    const visible = overlayEl?.classList.contains('is-visible');
    const isScore = _overlayMode === 'score';

    if (visible && isScore) {
      /* 当前是成绩榜且可见 → 隐藏 */
      scoreOverlay.hide();
      _overlayMode = null;
      if (_scoreTimer) { clearTimeout(_scoreTimer); _scoreTimer = null; }
    } else if (_currentPickMapId) {
      /* 否则一律展示成绩榜（若当前是 BP 榜则被覆盖） */
      if (_scoreTimer) { clearTimeout(_scoreTimer); _scoreTimer = null; }
      showScoreOverlay(_currentPickMapId);
    }
  });

  /* =========================================
     面板显隐
     ========================================= */

  pageEl.addEventListener('page:activated', () => {
    panel.hidden = false;
    syncPoolWithCurrentMatch();
    restoreMapStates();
    renderPlayers();
    resetAutoBpModeSync();
    updateShowDataBtn();

    /* 补显 BP 榜：切回 mappool 且 AutoBp 已 started、尚未显示过 */
    if (autoBp?.getState().started && !_bpOverlayShown) {
      _lastBpMatchId = getCurrentMatchId();
      _bpOverlayShown = true;
      showBpOverlay();
    }
  });

  pageEl.addEventListener('page:deactivated', () => {
    panel.hidden = true;
    scoreOverlay?.hide();
    _overlayMode = null;
    if (_scoreTimer) { clearTimeout(_scoreTimer); _scoreTimer = null; }
    updateShowDataBtn();
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
  renderLayout();
  renderPickOptions();

  const _initMapId = tokenStore?.get('mapid');
  if (_initMapId) setPickMap(String(_initMapId));

  setMode('redProtect');
  bindBarEvents();
  bindOsuEvents();
  syncPoolWithCurrentMatch();
  renderPlayers();
  initAutoBp();
  updateShowDataBtn();

  /* 监听地图切换（用于 pick 阶段 4s 后弹出出分） */
  tokenStore?.watchKey('mapid', (id) => onMapIdChange(id));

  if (pageEl.classList.contains('active')) panel.hidden = false;
}