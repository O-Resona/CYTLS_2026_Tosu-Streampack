/**
 * TournamentData —— 只读的总比赛数据
 *
 * 从 data/tournament.json 加载一次，之后不再写盘。
 * 数据更新方式：手动编辑 data/tournament.json，刷新页面即可生效。
 *
 * 另从 data/bp.json 加载 BP 操作历史：
 *   · 已结束的比赛：BP 永远以 bp.json 为准（忽略 localStorage）
 *   · 未结束的比赛：优先 match 自身字段，回退 bp.json
 *
 * 本地覆盖层（localStorage）：
 *   合并规则 —— tournament.json 里字段有值则用 json，为空则用本地 override。
 *
 * FF：teamXScore === -1 表示该队弃权，视为比赛结束。
 */

const SEED_URL      = 'data/tournament.json';
const BP_URL        = 'data/bp.json';
const OVERRIDE_KEY  = 'cyt2026.matchOverrides';

export class TournamentData {
  constructor() {
    this.data = null;
    this.bpData = null;
    this._readyPromise = null;
    this._overrides = this._loadOverrides();
  }

  _loadOverrides() {
    try {
      const raw = localStorage.getItem(OVERRIDE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _saveOverrides() {
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(this._overrides));
    } catch {}
  }

  /* =========================================
     初始化
     ========================================= */

  async init() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      /* 1. 加载 tournament.json */
      const res = await fetch(SEED_URL);
      if (!res.ok) throw new Error(`加载 ${SEED_URL} 失败: ${res.status}`);
      this.data = await res.json();

      /* 把 mappools 里的 beatmaps 按 round.mappool 注入到各 round */
      const pools = this.data.mappools || [];
      for (const round of (this.data.rounds || [])) {
        const pool = pools.find(p => p.id === round.mappool);
        round.beatmaps = pool?.beatmaps || [];
      }

      /* 2. 加载 bp.json（可选，失败不阻塞） */
      try {
        const bpRes = await fetch(BP_URL);
        if (bpRes.ok) {
          this.bpData = await bpRes.json();
        }
      } catch (e) {
        console.warn('[TournamentData] bp.json 加载失败:', e);
      }
      if (!this.bpData) this.bpData = { matches: [] };

      console.log('[TournamentData] 已加载', SEED_URL);
      return this.data;
    })();
    return this._readyPromise;
  }

  /* =========================================
     顶层读取
     ========================================= */

  get() { return this.data; }
  getMeta() { return this.data?.meta ?? {}; }
  getRuleset() { return this.data?.ruleset ?? {}; }

  /* =========================================
     队伍
     ========================================= */

  getTeams() { return this.data?.teams ?? []; }

  getTeam(acronym) {
    if (!acronym) return null;
    return this.getTeams().find(t => t.acronym === acronym) || null;
  }

  getTeamName(acronym) {
    const team = this.getTeam(acronym);
    return team?.fullName || team?.flagName || acronym || '';
  }

  /* =========================================
     轮次
     ========================================= */

  getRounds() { return this.data?.rounds ?? []; }

  getRound(id) {
    if (!id) return null;
    return this.getRounds().find(r => r.id === id) || null;
  }

  /* =========================================
     图池
     ========================================= */

  getMappools() {
    if (Array.isArray(this.data?.mappools) && this.data.mappools.length) {
      return this.data.mappools;
    }

    const map = new Map();
    for (const r of this.getRounds()) {
      const id = r.mappool || r.id;
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: r.name,
          beatmaps: r.beatmaps || [],
        });
      }
    }
    return Array.from(map.values());
  }

  getMappool(id) {
    if (!id) return null;
    return (this.data?.mappools || []).find(p => p.id === id) || null;
  }

  /* =========================================
     对局
     ========================================= */

  getMatches() {
    const raw = this.data?.matches ?? [];
    if (!Object.keys(this._overrides).length) return raw;
    return raw.map(m => this.mergeMatch(m, this._overrides[String(m.id)]));
  }

  getMatch(id) {
    if (id === undefined || id === null) return null;
    const raw = (this.data?.matches ?? []).find(m => m.id === id);
    if (!raw) return null;
    return this.mergeMatch(raw, this._overrides[String(id)]);
  }

  /* ---------- 合并：json 有值的字段优先用 json ---------- */

  _isEmptyField(v) {
    if (v === undefined || v === null || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  }

  mergeMatch(raw, ov) {
    if (!ov) return raw;
    const out = { ...raw };
    for (const k of Object.keys(ov)) {
      /* json 里这个字段为空/缺省 → 用本地 override；否则保留 json 的值 */
      if (this._isEmptyField(raw[k])) out[k] = ov[k];
    }
    return out;
  }

  /* =========================================
     FF 与比赛结束判定
     ========================================= */

  /* 某方是否 FF（分数 === -1） */
  isForfeit(match, side) {
    if (!match) return false;
    const score = side === 'team2' ? match.team2Score : match.team1Score;
    return Number(score) === -1;
  }

  /* 比赛是否已结束（任一方达到决胜分，或任一方 FF） */
  _isMatchFinished(match) {
    if (!match) return false;

    const s1 = Number(match.team1Score);
    const s2 = Number(match.team2Score);

    /* FF：任一方 -1 → 已结束 */
    if (s1 === -1 || s2 === -1) return true;

    const round = this.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2);
    return (s1 >= maxStars) || (s2 >= maxStars);
  }

  /* =========================================
     BP 数据
     ========================================= */

  _bpEmpty() {
    return { bans: [], picks: [], protects: [] };
  }

  _bpFromMatch(match) {
    return {
      bans:     Array.isArray(match?.bans)     ? match.bans     : [],
      picks:    Array.isArray(match?.picks)    ? match.picks    : [],
      protects: Array.isArray(match?.protects) ? match.protects : [],
    };
  }

  _bpFromBpJson(matchId) {
    const bpMatch = this.bpData?.matches?.find(m => m.id === matchId);
    if (!bpMatch?.actions?.length) return null;

    const out = this._bpEmpty();
    for (const a of bpMatch.actions) {
      const team = String(a.team || '').toLowerCase();
      const mods = a.map;
      const act  = String(a.action || '').toLowerCase();
      if (!team || !mods) continue;

      if (act === 'ban')          out.bans.push({ mods, team });
      else if (act === 'pick')    out.picks.push({ mods, team });
      else if (act === 'protect') out.protects.push({ mods, team });
    }
    return out;
  }

  _bpHasData(bp) {
    return !!bp && (bp.bans.length || bp.picks.length || bp.protects.length);
  }

  getMatchBP(matchId) {
    const match = this.getMatch(matchId);
    const fromMatch = this._bpFromMatch(match);
    const fromBp    = this._bpFromBpJson(matchId);

    /* ---------- 已结束：bp.json 优先 ---------- */
    if (this._isMatchFinished(match)) {
      if (this._bpHasData(fromBp))    return fromBp;
      if (this._bpHasData(fromMatch)) return fromMatch;
      return this._bpEmpty();
    }

    /* ---------- 未结束：match 优先 ---------- */
    if (this._bpHasData(fromMatch)) return fromMatch;
    if (this._bpHasData(fromBp))    return fromBp;
    return this._bpEmpty();
  }

  /* =========================================
     玩家长条：从 bp.json 统计上场次数
     ========================================= */

  isMatchFinished(matchId) {
    const match = this.getMatch(matchId);
    return this._isMatchFinished(match);
  }

  getPlayerRoundsFromBp(matchId) {
    if (matchId == null) return null;

    const match = this.getMatch(matchId);
    if (!match) return null;

    const bpMatch = this.bpData?.matches?.find(m => m.id === matchId);
    if (!bpMatch?.actions?.length) return null;

    const round = this.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2) - 1;

    const counts = {};
    for (const a of bpMatch.actions) {
      const act = String(a.action || '').toLowerCase();
      if (act !== 'pick') continue;

      const map = String(a.map || '');
      if (/^tb/i.test(map)) continue;

      if (a.redPlayer)  counts[a.redPlayer]  = (counts[a.redPlayer]  || 0) + 1;
      if (a.bluePlayer) counts[a.bluePlayer] = (counts[a.bluePlayer] || 0) + 1;
    }

    for (const k of Object.keys(counts)) {
      counts[k] = Math.min(counts[k], maxStars);
    }
    return counts;
  }

  /* =========================================
     某图池 BP 统计：某图被 protect / ban / pick 的次数
     （统计范围：所有使用该图池的轮次里，已完赛且非 FF 的场次）
     ========================================= */

  getPoolBpStats(mappoolId, mapMods) {
    const empty = { protect: 0, ban: 0, pick: 0, total: 0 };
    if (!mappoolId || !mapMods) return empty;

    /* 找出所有使用该图池的轮次 id（字符串） */
    const roundIds = new Set(
      this.getRounds()
        .filter(r => String(r.mappool) === String(mappoolId))
        .map(r => String(r.id))
    );
    if (!roundIds.size) return empty;

    /* 已完赛且非 FF 的场次 id（字符串） */
    const finishedIds = new Set();
    for (const m of this.getMatches()) {
      if (!roundIds.has(String(m.roundId))) continue;

      const round    = this.getRound(m.roundId);
      const bestOf   = Number(round?.bestOf) || 9;
      const maxStars = Math.ceil(bestOf / 2);

      const s1 = Number(m.team1Score);
      const s2 = Number(m.team2Score);
      if (!Number.isFinite(s1) || !Number.isFinite(s2)) continue;
      if (s1 === -1 || s2 === -1) continue;                 /* 排除 FF */
      if (s1 >= maxStars || s2 >= maxStars) {
        finishedIds.add(String(m.id));
      }
    }

    const total = finishedIds.size;
    if (!total) return empty;

    const target = String(mapMods).trim().toLowerCase();

    let protect = 0, ban = 0, pick = 0;
    for (const bpM of (this.bpData?.matches || [])) {
      if (!finishedIds.has(String(bpM.id))) continue;

      for (const a of bpM.actions || []) {
        const map = String(a.map || '').trim().toLowerCase();
        if (map !== target) continue;

        const act = String(a.action || '').trim().toLowerCase();
        if (act === 'protect')      protect++;
        else if (act === 'ban')     ban++;
        else if (act === 'pick')    pick++;
      }
    }

    return { protect, ban, pick, total };
  }

  /* =========================================
     某队在 bp.json 中所有场次的 protect / ban 历史
     （不含当前场次）
     ========================================= */

  getTeamBpHistory(acronym, { excludeMatchId = null } = {}) {
    const out = { protects: [], bans: [] };
    if (!acronym) return out;
    if (!this.bpData?.matches?.length) return out;

    for (const bpMatch of this.bpData.matches) {
      if (excludeMatchId != null && bpMatch.id === excludeMatchId) continue;

      const tMatch = this.getMatch(bpMatch.id);
      if (!tMatch) continue;

      /* 判断该队在这场 bp.json 记录里是红还是蓝 */
      let side = null;
      if (tMatch.team1Acronym === acronym) side = 'red';
      else if (tMatch.team2Acronym === acronym) side = 'blue';
      else continue;

      for (const a of bpMatch.actions || []) {
        const team = String(a.team || '').toLowerCase();
        if (team !== side) continue;

        const act  = String(a.action || '').toLowerCase();
        const mods = a.map;
        if (!mods) continue;

        if (act === 'protect') out.protects.push(mods);
        else if (act === 'ban') out.bans.push(mods);
      }
    }

    out.protects = Array.from(new Set(out.protects));
    out.bans     = Array.from(new Set(out.bans));
    return out;
  }

  /* =========================================
     通过 osu user id 反查选手
     ========================================= */

  findPlayerById(userId) {
    if (userId == null) return null;
    const idStr = String(userId);

    for (const team of this.getTeams()) {
      for (const p of team.players || []) {
        if (p.id != null && String(p.id) === idStr) {
          return { team, player: p };
        }
      }
    }
    return null;
  }

  getMatchesByRound(roundId) {
    return this.getMatches().filter(m => m.roundId === roundId);
  }

  /* =========================================
     比赛覆盖层
     ========================================= */

  setMatchOverride(matchId, patch) {
    if (matchId == null) return;
    const id = String(matchId);
    const cur = this._overrides[id] || {};
    this._overrides[id] = { ...cur, ...patch };
    this._saveOverrides();
  }

  clearMatchOverride(matchId) {
    if (matchId == null) return;
    delete this._overrides[String(matchId)];
    this._saveOverrides();
  }

  hasMatchOverride(matchId) {
    return matchId != null && !!this._overrides[String(matchId)];
  }

  getCurrentMatch() {
    return this.getMatches().find(m => m.current) || null;
  }

  /* =========================================
     图池查询
     ========================================= */

  getBeatmapsByMods(roundId, mods) {
    const round = this.getRound(roundId);
    if (!round) return [];
    return (round.beatmaps || []).filter(b => b.mods === mods);
  }

  findBeatmap(beatmapId) {
    for (const round of this.getRounds()) {
      const found = (round.beatmaps || []).find(
        b => b.beatmapInfo?.onlineId === beatmapId || b.id === beatmapId
      );
      if (found) return { beatmap: found, round };
    }
    return null;
  }

  /* =========================================
     派生
     ========================================= */

  getAllAcronyms() {
    return this.getTeams().map(t => t.acronym);
  }

  getAllMods() {
    const set = new Set();
    for (const round of this.getRounds()) {
      for (const b of round.beatmaps || []) {
        if (b.mods) set.add(b.mods);
      }
    }
    return Array.from(set);
  }
}