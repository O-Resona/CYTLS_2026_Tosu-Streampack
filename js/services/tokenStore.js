/**
 * TokenStore —— 集中保存 osu 发来的 token
 *
 * 所有子页面共享同一份 token 数据；新增页面只需要 watch 自己关心的字段。
 *
 * 用法：
 *   store.updateBulk({ mapArtistTitle: '...', creator: '...' });
 *   store.get('mapArtistTitle');
 *   store.watch(['creator', 'diffName'], changes => { ... });
 */
export class TokenStore {
  constructor() {
    this.tokens = Object.create(null);
    this._keyHandlers = new Map();  // key -> Set<fn>
    this._anyHandlers = new Set();  // fn(key, value)
  }

  get(key, fallback = '') {
    return key in this.tokens ? this.tokens[key] : fallback;
  }

  /** 读取数值型 token，可指定保留小数位 */
  getNumber(key, decimals) {
    const v = Number(this.tokens[key]);
    if (!Number.isFinite(v)) return decimals != null ? (0).toFixed(decimals) : '0';
    return decimals != null ? v.toFixed(decimals) : String(v);
  }

  set(key, value) {
    if (this.tokens[key] === value) return;
    this.tokens[key] = value;

    const keySet = this._keyHandlers.get(key);
    if (keySet) keySet.forEach(fn => this._safe(fn, value));

    this._anyHandlers.forEach(fn => this._safe(fn, key, value));
  }

  updateBulk(values) {
    for (const key in values) this.set(key, values[key]);
  }

  /** 监听单个 key，立即用当前值触发一次 */
  watchKey(key, fn) {
    if (!this._keyHandlers.has(key)) this._keyHandlers.set(key, new Set());
    this._keyHandlers.get(key).add(fn);

    if (key in this.tokens) this._safe(fn, this.tokens[key]);

    return () => this._keyHandlers.get(key)?.delete(fn);
  }

  /** 监听一组 key，任意一个变化就回调（入参为快照对象） */
  watch(keys, fn) {
    const unsubs = keys.map(k => this.watchKey(k, () => fn(this.snapshot(keys))));
    fn(this.snapshot(keys));
    return () => unsubs.forEach(u => u());
  }

  snapshot(keys) {
    const out = {};
    for (const k of keys) out[k] = this.get(k);
    return out;
  }

  onAny(fn) {
    this._anyHandlers.add(fn);
    return () => this._anyHandlers.delete(fn);
  }

  _safe(fn, ...args) {
    try { fn(...args); } catch (e) { console.error('[TokenStore]', e); }
  }
}