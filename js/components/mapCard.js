/**
 * MapCard —— 地图卡片渲染器
 *
 * 职责：
 *   - 背景图（带暗化层，切换时交叉淡入淡出）
 *   - 标题 / mapper / difficulty
 *   - LM 特殊 mod 图标（支持多个，水平重叠排列）
 *
 * mapper 优先取 tournamentData 里的，取不到再用 osu 传来的。
 * specialmods 支持字符串或数组两种写法。
 */
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

    // LM 特殊 mod 图标
    this._renderSpecial(bm);
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
    // 兜底：动画未触发时也移除
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
     LM 特殊 mod 图标（支持多个）
     ========================================= */

  _renderSpecial(bm) {
    const box = this.specialEl;
    if (!box) return;

    // 兼容字符串 / 数组两种写法
    const raw = bm?.specialmods;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    const token = ++this._specialToken;

    // 没有 → 清空隐藏
    if (!list.length) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    // 先隐藏，避免切换时闪旧内容
    box.style.display = 'none';
    box.innerHTML = '';

    let loadedCount = 0;
    const total = list.length;

    list.forEach((name, idx) => {
      const img = new Image();
      img.className = 'map-card__special';
      img.alt = name;
      img.style.zIndex = String(idx + 1);   // 右侧在上层

      img.onload = () => {
        if (token !== this._specialToken) return;
        loadedCount++;
        if (loadedCount === total) {
          box.style.display = box.children.length ? 'flex' : 'none';
        }
      };

      img.onerror = () => {
        if (token !== this._specialToken) return;
        console.warn('[MapCard] special mod 图片加载失败:', `src/mods/${name}.png`);
        loadedCount++;
        if (loadedCount === total) {
          box.style.display = box.children.length ? 'flex' : 'none';
        }
      };

      img.src = `src/mods/${name}.png`;
      box.appendChild(img);
    });
  }
}