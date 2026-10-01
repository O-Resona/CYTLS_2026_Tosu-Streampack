/**
 * AutoBp —— 从聊天消息与地图切换中自动解析 protect / ban / pick
 *
 * 触发流程：
 *   1. Guest 发送 "... rolled x points out of 100" → 进入就绪
 *   2. 就绪后，本队队员发含 mods 标识的消息 → 按序列执行该队的 protect / ban 序列
 *   3. 两队序列执行完 → 进入 pick 阶段
 *   4. pick 阶段：监听当前地图变化，轮流标记为队伍的 pick
 *
 * 外部通过 onAction(type, side, mods) 处理实际操作。
 *
 * 手动操作通过 syncFromUI() 覆盖内部状态，纠正误判：
 *   - autoBp 不再维护 cursor，进度完全由 protect / bans / picks 的实际内容决定
 *   - 手动改 UI 后调 syncFromUI，autoBp 采纳 UI 为准
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';

const SEQUENCES = {
  'swiss-1': ['protect', 'ban'],
  'swiss-2': ['protect', 'ban'],
  'bracket': ['protect', 'ban', 'ban'],
};

export class AutoBp {
  constructor({ tournamentData, osuSocket, tokenStore, onAction, onStateChange }) {
    this.tournamentData = tournamentData;
    this.osuSocket      = osuSocket;
    this.tokenStore     = tokenStore;
    this.onAction       = onAction;
    this.onStateChange  = onStateChange;

    this._unsubChat = null;
    this._unsubMap  = null;
    this._sequenceLength = 0;

    this._reset();
  }

  /* =========================================
     状态
     ========================================= */

  _reset() {
    this.started     = false;
    this.phase       = 'idle';
    this.firstPicker = 'red';
    this._sequenceLength = 0;

    this.teams = {
      red:  { sequence: [], protect: null, bans: [], picks: [] },
      blue: { sequence: [], protect: null, bans: [], picks: [] },
    };

    this.pickTurn       = null;
    this._lastPickMapId = null;
  }

  reset() {
    this._reset();
    this._emitChange();
  }

  setFirstPicker(side) {
    if (side !== 'red' && side !== 'blue') return;
    this.firstPicker = side;
    if (this.phase !== 'pick') this.pickTurn = side;
    this._emitChange();
  }

  /* =========================================
     生命周期
     ========================================= */

  start() {
    if (this._unsubChat) return;
    this._unsubChat = this.osuSocket?.on('chat', (msgs) => this._onChat(msgs));
    this._unsubMap  = this.tokenStore?.watchKey('mapid', (id) => this._onMapChange(id));
  }

  stop() {
    this._unsubChat?.(); this._unsubChat = null;
    this._unsubMap ?.(); this._unsubMap  = null;
  }

  /* =========================================
     初始化序列
     ========================================= */

  _initSequences() {
    const id = this._getMatchId();
    if (id == null) return false;
    const match = this.tournamentData.getMatch(id);
    if (!match) return false;

    const round = this.tournamentData.getRound(match.roundId);
    const seq = SEQUENCES[round?.mappool];
    if (!seq) return false;

    this._sequenceLength = seq.length;

    for (const side of ['red', 'blue']) {
      const t = this.teams[side];
      t.sequence = seq.slice();
      t.protect  = null;
      t.bans     = [];
      t.picks    = [];
    }
    this.pickTurn = this.firstPicker;
    return true;
  }

  /* =========================================
     内部判断（基于实际 set，不用 cursor）
     ========================================= */

  /* 该队下一步该做什么，null 表示已完成 */
  _nextActionFor(side) {
    const t = this.teams[side];
    if (!this._sequenceLength) return null;
    if (!t.protect) return 'protect';
    const needBans = this._sequenceLength - 1;
    if (t.bans.length < needBans) return 'ban';
    return null;
  }

  _bothDone() {
    return this._nextActionFor('red') === null
        && this._nextActionFor('blue') === null;
  }

  /* =========================================
     聊天处理
     ========================================= */

  _onChat(msgs) {
    if (!Array.isArray(msgs) || !msgs.length) return;

    const last = msgs[msgs.length - 1];
    const name = last.name || last.username || last.user?.name || '';
    const text = last.messageBody || last.message || last.text || last.content || '';
    if (!name || !text) return;

    if (!this.started) {
      if (this._isGuestRolled(name, text)) {
        if (!this._initSequences()) return;
        this.started = true;
        this.phase   = 'protect-ban';
        this._emitChange();
      }
      return;
    }

    if (this.phase === 'protect-ban') {
      this._handleProtectBan(name, text);
    }
    /* pick 阶段不处理聊天，走 mapid 变化 */
  }

  _isGuestRolled(name, text) {
    if (!/guest/i.test(name)) return false;
    return /rolled\s+[\d.]+\s+points?\s+out\s+of\s+\d+/i.test(text);
  }

  _handleProtectBan(name, text) {
    const side = this._findSideOfPlayer(name);
    if (!side) return;

    const action = this._nextActionFor(side);
    if (!action) return;               // 该队已完成

    const mods = this._extractMods(text);
    if (!mods) return;                 // 识别失败 → 忽略，不动状态
    if (this._modsUsed(mods)) return;

    const team = this.teams[side];
    if (action === 'protect') team.protect = mods;
    else if (action === 'ban') team.bans.push(mods);

    this.onAction?.(action, side, mods);

    if (this._bothDone()) {
      this.phase = 'pick';
      this.pickTurn = this.firstPicker;
    }
    this._emitChange();
  }

  _findSideOfPlayer(name) {
    const id = this._getMatchId();
    if (id == null) return null;
    const match = this.tournamentData.getMatch(id);
    if (!match) return null;

    const norm = s => String(s ?? '').trim().toLowerCase();
    const inTeam = (acronym) => {
      const team = this.tournamentData.getTeam(acronym);
      return !!team?.players?.some(p => norm(p.username) === norm(name));
    };

    if (inTeam(match.team1Acronym)) return 'red';
    if (inTeam(match.team2Acronym)) return 'blue';
    return null;
  }

  _extractMods(text) {
    const pool = this._getCurrentPool();
    if (!pool) return null;

    const normalized = String(text).toLowerCase().replace(/\s+/g, '');
    for (const bm of pool.beatmaps) {
      const mods = bm.mods;
      if (!mods) continue;
      if (/^tb/i.test(mods)) continue;   /* ← 跳过 TB */
      const needle = mods.toLowerCase().replace(/\s+/g, '');
      if (normalized.includes(needle)) return mods;
    }
    return null;
  }

  _modsUsed(mods) {
    const r = this.teams.red;
    const b = this.teams.blue;
    return r.protect === mods || r.bans.includes(mods) || r.picks.includes(mods)
        || b.protect === mods || b.bans.includes(mods) || b.picks.includes(mods);
  }

  /* =========================================
     Pick 阶段：监听地图变化
     ========================================= */

  _onMapChange(mapId) {
    if (this.phase !== 'pick') return;
    if (mapId == null || mapId === '') return;

    const idStr = String(mapId);
    if (idStr === this._lastPickMapId) return;

    const pool = this._getCurrentPool();
    if (!pool) return;

    const bm = pool.beatmaps.find(b =>
      b.beatmapInfo?.onlineId != null &&
      String(b.beatmapInfo.onlineId) === idStr
    );
    if (!bm?.mods) return;

    const mods = bm.mods;
    if (this._modsUsed(mods)) return;

    this._lastPickMapId = idStr;

    const side = this.pickTurn || this.firstPicker;
    this.teams[side].picks.push(mods);

    this.onAction?.('pick', side, mods);

    this.pickTurn = side === 'red' ? 'blue' : 'red';
    this._emitChange();
  }

  /* =========================================
     手动同步：以 UI 状态为准
     ========================================= */

  /**
   * 手动操作后调用，用 UI 的完整状态覆盖内部 set。
   * 手动修正会被 autoBp 采纳，后续自动判定基于最新 UI。
   *
   * @param {{
   *   protects?: { red: string[], blue: string[] },
   *   bans?:     { red: string[], blue: string[] },
   *   picks?:    { red: string[], blue: string[] },
   *   lastAction?: { action: 'protect'|'ban'|'pick'|'clear', side?: 'red'|'blue', mods?: string }
   * }} snapshot
   */
  syncFromUI(snapshot = {}) {
    if (!this.started) return;

    const { protects, bans, picks, lastAction } = snapshot;

    for (const side of ['red', 'blue']) {
      const t = this.teams[side];
      if (protects) t.protect = protects[side]?.[0] || null;
      if (bans)     t.bans    = Array.isArray(bans[side]) ? [...bans[side]] : [];
      if (picks)    t.picks   = Array.isArray(picks[side]) ? [...picks[side]] : [];
    }

    /* 根据最新 set 重判阶段 */
    if (this._bothDone()) {
      if (this.phase !== 'pick') {
        this.phase = 'pick';
        this.pickTurn = this.firstPicker;
      }
    } else {
      if (this.phase === 'pick') {
        this.phase = 'protect-ban';    // 手动退回
      }
    }

    /* 手动 pick 后翻转 pickTurn，让下一次自动 pick 归另一方 */
    if (lastAction?.action === 'pick' && lastAction.side) {
      this.pickTurn = lastAction.side === 'red' ? 'blue' : 'red';
    }

    this._emitChange();
  }

  /* =========================================
     工具
     ========================================= */

  _getMatchId() {
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      return v ? Number(v) : null;
    } catch { return null; }
  }

  _getCurrentPool() {
    const id = this._getMatchId();
    if (id == null) return null;
    const match = this.tournamentData.getMatch(id);
    if (!match) return null;
    const round = this.tournamentData.getRound(match.roundId);
    return this.tournamentData.getMappool(round?.mappool) || null;
  }

  getState() {
    return {
      started:     this.started,
      phase:       this.phase,
      firstPicker: this.firstPicker,
      pickTurn:    this.pickTurn,
      teams: {
        red:  { ...this.teams.red,  bans: [...this.teams.red.bans],  picks: [...this.teams.red.picks]  },
        blue: { ...this.teams.blue, bans: [...this.teams.blue.bans], picks: [...this.teams.blue.picks] },
      },
    };
  }

  _emitChange() {
    this.onStateChange?.(this.getState());
  }
}