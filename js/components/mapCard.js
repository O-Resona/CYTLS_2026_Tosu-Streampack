/**
 * MapCard —— 地图卡片渲染器
 *
 * 职责：
 *   - 背景图（带暗化层，切换时交叉淡入淡出）
 *   - 标题 / mapper / difficulty
 *   - LM 特殊 mod 图标（支持多个，水平重叠排列）
 *   - 当前图被某队 pick 时，加红/蓝内边框
 *
 * mapper 优先取 tournamentData 里的，取不到再用 osu 传来的。
 * specialmods 支持字符串或数组两种写法。
 *
 * 同时监听：
 *   - window 'storage'（跨 tab 改动 BP）
 *   - window 'bp-actions-changed'（同 tab 内 mappool 手动改动 BP）
 * 两者都会触发边框刷新。
 */

/* 非 LM 的 mod 图标（文件名不含扩展名） */
const MOD_ICON_MAP = {
  HR: 'Hard Rock',
  HD: 'Hidden',
  DT: 'Double Time',
};

const BP_ACTIONS_KEY = 'mapBPActions';

export class MapCard {
  constructor(root, { tournamentData, tokenStore } = {}) {
    this.root = root;
    this.tournamentData = tournamentData || null;
    this.tokenStore = tokenStore || null;

    this.titleEl   = root.querySelector('.map-card__title');
    this.mapperEl  = root.querySelector('.map-card__mapper');
    this.diffEl    = root.querySelector('.map-card__difficulty');
    this.specialEl = root.querySelector('.map-card__specials');

    this._specialToken = 0;
    this._bgToken = 0;
    this._lastMapTitle = '';

    /* 其他标签页/窗口改动 BP 状态时同步边框 */
    this._onStorage = (e) => {
      if (e.key === BP_ACTIONS_KEY) {
        this._applyBorderClass(this._lastMapTitle);
      }
    };
    window.addEventListener('storage', this._onStorage);

    /* 同 tab 内 mappool 手动修改 BP → 收到自定义事件刷新边框 */
    this._onBpChanged = () => {
      this._applyBorderClass(this._lastMapTitle);
    };
    window.addEventListener('bp-actions-changed', this._onBpChanged);
  }

  /* =========================================
     入口
     ========================================= */

  render(info) {
    if (!this.root) return;

    // 背景
    this._renderBackground(info.backgroundUrl);

    // 数据查询
    const mapId = this._getCurrentMapId();
    const bm = this._findBeatmap(mapId);

    // 文字
    if (this.titleEl) this.titleEl.textContent = info.artistTitle || '—';

    const mapper = bm?.beatmapInfo?.metadata?.author?.username || info.creator;
    if (this.mapperEl) this.mapperEl.textContent = mapper || '—';

    if (this.diffEl) this.diffEl.textContent = info.diffName || '—';

    // 当前图 title → 应用红/蓝内边框（只有 pick 状态才显示）
    this._lastMapTitle = bm?.beatmapInfo?.metadata?.title || '';
    this._applyBorderClass(this._lastMapTitle);

    // LM 特殊 mod 图标
    this._renderSpecial(bm);
  }

  /* =========================================
     内边框：当前图被 pick 时，加上对应队伍色
     ========================================= */

  _applyBorderClass(mapTitle) {
    const root = this.root;
    if (!root) return;

    root.classList.remove('redBorder', 'blueBorder', 'purpleBorder');
    if (!mapTitle) return;

    try {
      const actions = JSON.parse(localStorage.getItem(BP_ACTIONS_KEY) || '{}');
      const state = actions[mapTitle];
      if (!state || state.action !== 'pick') return;

      if (state.team === 'tb') {
        root.classList.add('purpleBorder');
      } else {
        root.classList.add(state.team === 'red' ? 'redBorder' : 'blueBorder');
      }
    } catch {}
  }

  /* =========================================
     背景：交叉淡入淡出
     ========================================= */

  _renderBackground(url) {
    const root = this.root;
    const token = ++this._bgToken;

    if (!url) {
      root.querySelectorAll('.map-card__bg').forEach(el => this._fadeOut(el));
      return;
    }

    const probe = new Image();
    probe.onload = () => {
      if (token !== this._bgToken) return;

      const newBg = document.createElement('div');
      newBg.className = 'map-card__bg';
      newBg.style.backgroundImage =
        `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.6)), url("${url}")`;
      newBg.style.opacity = '0';

      root.insertBefore(newBg, root.firstChild);

      void newBg.offsetWidth;
      newBg.style.opacity = '1';

      root.querySelectorAll('.map-card__bg').forEach(el => {
        if (el === newBg) return;
        this._fadeOut(el);
      });
    };

    probe.onerror = () => {
      if (token !== this._bgToken) return;
      console.warn('[MapCard] 背景图加载失败:', url);
    };

    probe.src = url;
  }

  _fadeOut(el) {
    if (el.dataset.leaving === '1') return;
    el.dataset.leaving = '1';
    el.style.opacity = '0';
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 800);
  }

  /* =========================================
     数据查询
     ========================================= */

  _findBeatmap(mapId) {
    if (!mapId || !this.tournamentData) return null;
    const idStr = String(mapId);

    for (const round of this.tournamentData.getRounds()) {
      const bm = (round.beatmaps || []).find(b =>
        b.beatmapInfo?.onlineId != null &&
        String(b.beatmapInfo.onlineId) === idStr
      );
      if (bm) return bm;
    }
    return null;
  }

  _getCurrentMapId() {
    if (!this.tokenStore) return '';
    return (
      this.tokenStore.get('mapid') ||
      this.tokenStore.get('mapId') ||
      ''
    );
  }

  /* =========================================
     LM 特殊 mod 图标（支持多个）+ 普通图标
     ========================================= */

  _renderSpecial(bm) {
    const box = this.specialEl;
    if (!box) return;

    const token = ++this._specialToken;

    /* 所有现存层先淡出（含上一次调用的残留） */
    const oldLayers = Array.from(box.querySelectorAll('.map-card__specials-layer'));
    oldLayers.forEach(layer => {
      layer.classList.remove('is-in');
      setTimeout(() => {
        if (layer.parentNode) layer.remove();
        /* 最后一个 layer 移除后，没有任何 layer 就隐藏容器 */
        if (!box.querySelector('.map-card__specials-layer')) {
          box.classList.remove('is-on');
        }
      }, 400);
    });

    /* ---------- 收集 items ---------- */
    const items = [];
    const rawMod = String(bm?.mods || '').replace(/\d+$/, '').toUpperCase();

    if (rawMod === 'DT') {
      items.push({ type: 'img', name: MOD_ICON_MAP.DT });
      if (bm?.dtRate != null) {
        const n = Number(bm.dtRate);
        if (Number.isFinite(n)) {
          const rateStr = n.toFixed(2).replace(/\.?0+$/, '');
          items.push({ type: 'label', text: `${rateStr}x` });
        }
      }
    } else if (MOD_ICON_MAP[rawMod]) {
      items.push({ type: 'img', name: MOD_ICON_MAP[rawMod] });
    }

    if (rawMod === 'LM') {
      const raw = bm?.specialmods;
      const sp = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      sp.forEach(name => items.push({ type: 'img', name }));
    }

    /* ---------- 无 item → 上面已处理淡出，结束 ---------- */
    if (!items.length) return;

    /* ---------- 有 item → 显示容器，新建层 ---------- */
    box.classList.add('is-on');

    const layer = document.createElement('div');
    layer.className = 'map-card__specials-layer';
    box.appendChild(layer);

    const finish = () => {
      if (token !== this._specialToken) {
        /* 已被后续调用取代 → 自我清理 */
        if (layer.parentNode) layer.remove();
        return;
      }
      void layer.offsetWidth;      /* 强制 reflow，保证 transition 触发 */
      layer.classList.add('is-in');
    };

    let pending  = 0;
    let finished = 0;

    items.forEach(item => {
      if (item.type === 'label') {
        const el = document.createElement('span');
        el.className = 'map-card__special-label';
        el.textContent = item.text;
        el.style.zIndex = '1';
        layer.appendChild(el);
        return;
      }

      pending++;
      const img = document.createElement('img');
      img.className = 'map-card__special';
      img.alt = item.name;
      img.style.zIndex = '2';

      img.onload = () => {
        if (token !== this._specialToken) return;
        finished++;
        if (finished === pending) finish();
      };
      img.onerror = () => {
        if (token !== this._specialToken) return;
        console.warn('[MapCard] special mod 图片加载失败:', `src/mods_tag/${item.name}.png`);
        finished++;
        if (finished === pending) finish();
      };

      layer.appendChild(img);
      img.src = `src/mods_tag/${item.name}.png`;
    });

    if (pending === 0) finish();
  }

  /* 可选：外部主动刷新边框 */
  refreshBorder() {
    this._applyBorderClass(this._lastMapTitle);
  }

  destroy() {
    window.removeEventListener('storage', this._onStorage);
    window.removeEventListener('bp-actions-changed', this._onBpChanged);
  }
}