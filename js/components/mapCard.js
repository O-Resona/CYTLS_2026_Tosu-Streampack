/**
 * MapCard —— 地图卡片渲染器
 *
 * 职责：
 *   - 背景图（带渐变遮罩）
 *   - 标题 / mapper / difficulty
 *   - LM 特殊 mod 图标（读取 tournamentData 的 specialmods）
 *
 * mapper 优先取 tournamentData 里的，取不到再用 osu 传来的。
 */
export class MapCard {
  constructor(root, { tournamentData, tokenStore } = {}) {
    this.root = root;
    this.tournamentData = tournamentData || null;
    this.tokenStore = tokenStore || null;

    this.titleEl   = root.querySelector('.map-card__title');
    this.mapperEl  = root.querySelector('.map-card__mapper');
    this.diffEl    = root.querySelector('.map-card__difficulty');
    this.specialEl = root.querySelector('.map-card__special');

    this._imgId = 0;
  }

  render(info) {
    if (!this.root) return;

    /* ---------- 背景 ---------- */
    if (info.backgroundUrl) {
      const id = ++this._imgId;
      const img = new Image();
      img.onload = () => {
        if (id !== this._imgId) return;
        this.root.style.backgroundImage =
          `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.6)), url("${info.backgroundUrl}")`;
      };
      img.src = info.backgroundUrl;
    } else {
      this._imgId++;
      this.root.style.backgroundImage = '';
    }

    /* ---------- 文字 ---------- */
    const mapId = this._getCurrentMapId();
    const bm = this._findBeatmap(mapId);

    if (this.titleEl) this.titleEl.textContent = info.artistTitle || '—';

    const mapper = bm?.beatmapInfo?.metadata?.author?.username || info.creator;
    if (this.mapperEl) this.mapperEl.textContent = mapper || '—';

    if (this.diffEl) this.diffEl.textContent = info.diffName || '—';

    /* ---------- LM 特殊 mod 图标 ---------- */
    this._renderSpecial(bm);
  }

  /* ---------- 从 tournamentData 里找当前 beatmap ---------- */

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

  /* ---------- 渲染 specialmods 图标 ---------- */

  _renderSpecial(bm) {
    const el = this.specialEl;
    if (!el) return;

    const special = bm?.specialmods;

    // 每次调用递增 token，用于防止旧回调覆盖新状态
    const token = (this._specialToken = (this._specialToken || 0) + 1);

    if (!special) {
      el.style.display = 'none';
      el.removeAttribute('src');
      return;
    }

    const path = `src/mods/${special}.png`;

    if (
      el.getAttribute('src') === path &&
      el.style.display !== 'none'
    ) {
      return;
    }

    el.style.display = 'none';

    const probe = new Image();
    
    probe.onload = () => {
      // 已被后续 render 覆盖 → 放弃
      if (token !== this._specialToken) return;

      // 二次确认当前 el 没被别的 render 改过
      el.src = path;
      el.alt = special;
      el.style.display = 'block';
    };

    probe.onerror = () => {
      if (token !== this._specialToken) return;
      el.style.display = 'none';
      console.warn('[MapCard] special mod 图片加载失败:', path);
    };

    probe.src = path;
  }
}