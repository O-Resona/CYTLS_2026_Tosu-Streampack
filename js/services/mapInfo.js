/**
 * MapInfo —— 派生地图信息（供所有子页面复用）
 *
 * 从 TokenStore 中筛选地图相关字段，计算：
 *   - artistTitle       艺术家 - 标题
 *   - creator           mapper
 *   - diffName          难度名
 *   - backgroundUrl     背景图 URL
 *   - borderClass       红/蓝边框（基于 localStorage.mapBPActions）
 *
 * 用法：
 *   const mapInfo = new MapInfo(tokenStore);
 *   mapInfo.watch(info => { ... });
 */
const TOKEN_KEYS = [
  'mapArtistTitle',
  'creator',
  'diffName',
  'backgroundImageLocation',
  'md5',
  'mapsetid',
];

export class MapInfo {
  constructor(tokenStore, options = {}) {
    this.store = tokenStore;
    this.baseUrl = options.baseUrl ?? '';
    this.bgWidth  = options.bgWidth  ?? 780;
    this.bgHeight = options.bgHeight ?? 75;

    this._handlers = new Set();
    this._unsubs = [];

    this._unsubs.push(this.store.watch(TOKEN_KEYS, () => this._notify()));

    // 边框依赖 localStorage，监听 storage 事件
    this._onStorage = (e) => {
      if (e.key === 'mapBPActions') this._notify();
    };
    window.addEventListener('storage', this._onStorage);
  }

  get() {
    const artistTitle = this.store.get('mapArtistTitle') || '';
    return {
      artistTitle,
      creator:      this.store.get('creator')  || '',
      diffName:     this.store.get('diffName') || '',
      backgroundUrl: this._buildBackgroundUrl(),
      borderClass:  this._readBorderClass(artistTitle),
    };
  }

  watch(fn) {
    this._handlers.add(fn);
    fn(this.get());  // 立即推一次
    return () => this._handlers.delete(fn);
  }

  _notify() {
    const info = this.get();
    this._handlers.forEach(fn => {
      try { fn(info); } catch (e) { console.error('[MapInfo]', e); }
    });
  }

_buildBackgroundUrl() {
  const md5      = this.store.get('md5');
  const mapsetid = this.store.get('mapsetid');

  if (!md5 && !mapsetid) return '';

  // 优先用显式配置的 baseUrl；否则用当前窗口的主机
  const base = this.baseUrl || `${window.location.protocol}//${window.location.host}`;

  const params = new URLSearchParams({
    width:     this.bgWidth,
    height:    this.bgHeight,
    mapset:    mapsetid,
    dummyData: md5,
    crop:      'true',
  });

  return `${base}/backgroundImage?${params.toString()}`;
}

  _readBorderClass(mapTitle) {
    if (!mapTitle) return '';
    try {
      const actions = JSON.parse(localStorage.getItem('mapBPActions') || '{}');
      const state = actions[mapTitle];
      if (!state) return '';
      return state.team === 'red' ? 'redBorder' : 'blueBorder';
    } catch {
      return '';
    }
  }

  destroy() {
    this._unsubs.forEach(u => u());
    window.removeEventListener('storage', this._onStorage);
  }
}