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

    root.classList.remove('redBorder', 'blueBorder');
    if (!mapTitle) return;

    try {
      const actions = JSON.parse(localStorage.getItem(BP_ACTIONS_KEY) || '{}');
      const state = actions[mapTitle];
      if (!state || state.action !== 'pick') return;
      root.classList.add(state.team === 'red' ? 'redBorder' : 'blueBorder');
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

    /* items 结构：{ type: 'img', name } 或 { type: 'label', text } */
    const items = [];

    const rawMod = String(bm?.mods || '').replace(/\d+$/, '').toUpperCase();

    /* DT 特例：右侧带倍率标签 */
    if (rawMod === 'DT') {
      items.push({ type: 'img', name: MOD_ICON_MAP.DT });

      if (bm?.dtRate != null) {
        const n = Number(bm.dtRate);
        if (Number.isFinite(n)) {
          const rateStr = n.toFixed(2).replace(/\.?0+$/, '');
          items.push({ type: 'label', text: `${rateStr}x` });
        }
      }
    }
    /* HR / HD → 单图标 */
    else if (MOD_ICON_MAP[rawMod]) {
      items.push({ type: 'img', name: MOD_ICON_MAP[rawMod] });
    }

    /* LM → 读 specialmods（支持多个） */
    if (rawMod === 'LM') {
      const raw = bm?.specialmods;
      const sp = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      sp.forEach(name => items.push({ type: 'img', name }));
    }

    const token = ++this._specialToken;

    /* 没有 → 清空隐藏 */
    if (!items.length) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    /* 先隐藏，避免切换时闪旧内容 */
    box.style.display = 'none';
    box.innerHTML = '';

    let loadedCount = 0;
    const total = items.length;

    const finish = () => {
      if (token !== this._specialToken) return;
      loadedCount++;
      if (loadedCount === total) {
        box.style.display = box.children.length ? 'flex' : 'none';
      }
    };

    items.forEach((item) => {
      if (item.type === 'label') {
        const el = document.createElement('span');
        el.className = 'map-card__special-label';
        el.textContent = item.text;
        el.style.zIndex = '1';
        box.appendChild(el);
        finish();
        return;
      }

      const img = new Image();
      img.className = 'map-card__special';
      img.alt = item.name;
      img.style.zIndex = '2';

      img.onload  = finish;
      img.onerror = () => {
        if (token !== this._specialToken) return;
        console.warn('[MapCard] special mod 图片加载失败:', `src/mods_tag/${item.name}.png`);
        finish();
      };

      img.src = `src/mods_tag/${item.name}.png`;
      box.appendChild(img);
    });
  }

  /* 可选：外部主动刷新边框 */
  refreshBorder() {
    this._applyBorderClass(this._lastMapTitle);
  }

  destroy() {
    window.removeEventListener('storage', this._onStorage);
  }
}