import { ReconnectingWebSocket } from './reconnectingWebSocket.js';

/**
 * OsuSocket —— 与 osu!/tosu 之间唯一的 WebSocket 连接
 *
 * 事件：
 *   'open'      连接建立
 *   'close'     连接断开
 *   'error'     连接错误
 *   'message'   每条原始消息
 *   'tourney'   比赛房间数据
 *   'ipcState'  比赛状态数值
 *   'tokens'    token 批量更新
 *
 * 关键点：_extractTokens 里 mapid 必须**第一个写入**，
 * 因为下游（MapCard 等）会在其它 token 触发 render 时立刻读取 mapid。
 */
export class OsuSocket {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this._handlers = new Map();
  }

  /* =========================================
     事件总线
     ========================================= */

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this._handlers.get(event).delete(fn);
  }

  _emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (e) { console.error(`[OsuSocket] handler "${event}" failed:`, e); }
    }
  }

  /* =========================================
     连接
     ========================================= */

  connect() {
    this.socket = new ReconnectingWebSocket(this.url);
    this.socket.onopen    = () => this._emit('open');
    this.socket.onclose   = (e) => this._emit('close', e);
    this.socket.onerror   = (e) => this._emit('error', e);
    this.socket.onmessage = (e) => this._handleMessage(e);
  }

  /* =========================================
     消息处理
     ========================================= */

  _handleMessage(event) {
    let data;
    try { data = JSON.parse(event.data); }
    catch { return; }

    this._emit('message', data);

    // ---- 比赛房间 ----
    const manager = data?.tourney?.manager;
    if (manager) {
      this._emit('tourney', data.tourney);
      if (typeof manager.ipcState === 'number') {
        this._emit('ipcState', manager.ipcState);
      }
    }

    // ---- 地图信息 → tokens ----
    const tokens = this._extractTokens(data);
    if (tokens && Object.keys(tokens).length) {
      this._emit('tokens', tokens);
    }
  }

  /* =========================================
     原生 tosu 格式 → 扁平 tokens
     ========================================= */

  _extractTokens(data) {
    const tokens = {};
    const bm = data?.menu?.bm;
    if (!bm || typeof bm !== 'object') return tokens;

    /* ---------- 1. mapid 第一个写入 ---------- */
    if (bm.id != null) tokens.mapid = bm.id;

    /* ---------- 2. 元数据 ---------- */
    const meta = bm.metadata || {};

    const artist = meta.artist || meta.artistOriginal || '';
    const title  = meta.title  || meta.titleOriginal  || '';
    const mapper = meta.mapper || meta.creator || bm.creator || '';
    const diff   = meta.difficulty || meta.version || bm.version || '';

    if (artist) tokens.artist = artist;
    if (title)  tokens.title  = title;
    if (artist || title) tokens.mapArtistTitle = `${artist} - ${title}`;
    if (mapper) tokens.creator  = mapper;
    if (diff)   tokens.diffName = diff;

    /* ---------- 3. 标识 ---------- */
    if (bm.md5 != null) tokens.md5      = bm.md5;
    if (bm.set != null) tokens.mapsetid = bm.set;

    /* ---------- 4. 时长 ---------- */
    if (bm.time?.full != null) tokens.totaltime = bm.time.full;

    /* ---------- 5. mods ---------- */
    if (bm.mods != null) tokens.modsEnum = bm.mods;

    /* ---------- 6. 谱面数值（注意 tosu 用大写字段） ---------- */
    const stats = bm.stats || {};
    const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

    const cs = num(stats.CS);
    const ar = num(stats.AR);
    const od = num(stats.OD);
    const hp = num(stats.HP);

    // 星数优先 fullSR（基础难度），其次 SR
    const stars = num(stats.fullSR) ?? num(stats.SR);

    // BPM 优先 common，其次 realtime
    let bpm = null;
    if (stats.BPM && typeof stats.BPM === 'object') {
      bpm = num(stats.BPM.common) ?? num(stats.BPM.realtime);
    } else {
      bpm = num(stats.BPM);
    }

    if (bpm   != null) tokens.mBpm   = bpm.toFixed(0);
    if (cs    != null) tokens.mCS    = cs;
    if (ar    != null) tokens.mAR    = ar;
    if (od    != null) tokens.mOD    = od;
    if (hp    != null) tokens.mHP    = hp;
    if (stars != null) tokens.mStars = stars;

    return tokens;
  }

  /* =========================================
     发送 / 关闭
     ========================================= */

  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  }

  close() { this.socket?.close(); }
}