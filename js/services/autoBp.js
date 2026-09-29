/**
 * AutoBp —— 从聊天消息与地图切换中自动解析 protect / ban / pick
 *
 * 触发流程：
 *   1. 检测到 Guest 发送 "... rolled x points out of 100" → 进入就绪
 *   2. 就绪后，本队队员发含 mods 标识（如 "hd2"、"hd 2"，忽略空格/大小写）的消息
 *      → 按顺序执行该队的 protect / ban 序列
 *      swiss-1 / swiss-2：['protect', 'ban']
 *      bracket：          ['protect', 'ban', 'ban']
 *   3. 两队序列执行完 → 进入 pick 阶段
 *   4. pick 阶段：监听当前地图变化，轮流标记为队伍的 pick
 *
 * 外部通过 onAction(type, side, mods) 处理实际操作。
 * 自动触发的动作都会被后续手动点击覆盖。
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
    this.onAction       = onAction;        // (action, side, mods) => void
    this.onStateChange  = onStateChange;   // (state) => void

    this._unsubChat = null;
    this._unsubMap  = null;

    this._reset();
  }

  /* =========================================
     状态
     ========================================= */

  _reset() {
    this.started     = false;
    this.phase       = 'idle';      // idle | protect-ban | pick
    this.firstPicker = 'red';       // red | blue

    this.teams = {
      red:  { sequence: [], cursor: 0, protect: null, bans: [], picks: [] },
      blue: { sequence: [], cursor: 0, protect: null, bans: [], picks: [] },
    };

    this.pickTurn     = null;
    this._lastPickMapId = null;
  }

  reset() {
    this._reset();
    this._emitChange();
  }

  setFirstPicker(side) {
    if (side !== 'red' && side !== 'blue') return;
    this.firstPicker = side;
    /* pick 阶段尚未开始 → 提前记录，开始时用此值 */
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

    for (const side of ['red', 'blue']) {
      const t = this.teams[side];
      t.sequence = seq.slice();
      t.cursor   = 0;
      t.protect  = null;
      t.bans     = [];
      t.picks    = [];
    }
    this.pickTurn = this.firstPicker;
    return true;
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
  }

  _isGuestRolled(name, text) {
    if (!/guest/i.test(name)) return false;
    return /rolled\s+[\d.]+\s+points?\s+out\s+of\s+\d+/i.test(text);
  }

  _handleProtectBan(name, text) {
    const side = this._findSideOfPlayer(name);
    if (!side) return;
    const team = this.teams[side];
    if (!team || team.cursor >= team.sequence.length) return;

    const mods = this._extractMods(text);
    if (!mods) return;
    if (this._modsUsed(mods)) return;

    const action = team.sequence[team.cursor];
    team.cursor++;

    if (action === 'protect') team.protect = mods;
    else if (action === 'ban') team.bans.push(mods);

    this.onAction?.(action, side, mods);

    if (this._bothDone()) {
      this.phase = 'pick';
      this.pickTurn = this.firstPicker;
    }
    this._emitChange();
  }

  _bothDone() {
    return this.teams.red.cursor  >= this.teams.red.sequence.length
        && this.teams.blue.cursor >= this.teams.blue.sequence.length;
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
      const needle = mods.toLowerCase().replace(/\s+/g, '');
      if (normalized.includes(needle)) return mods;
    }
    return null;
  }

  _modsUsed(mods) {
    const r = this.teams.red;
    const b = this.teams.blue;
    return r.protect === mods || r.bans.includes(mods)
        || b.protect === mods || b.bans.includes(mods);
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
    if (this.teams.red.picks.includes(mods)
     || this.teams.blue.picks.includes(mods)) return;

    this._lastPickMapId = idStr;

    const side = this.pickTurn || this.firstPicker;
    this.teams[side].picks.push(mods);

    this.onAction?.('pick', side, mods);

    this.pickTurn = side === 'red' ? 'blue' : 'red';
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