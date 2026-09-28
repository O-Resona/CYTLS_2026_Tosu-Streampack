/**
 * TournamentData —— 只读的总比赛数据
 *
 * 从 data/tournament.json 加载一次，之后不再写盘。
 * 数据更新方式：手动编辑 data/tournament.json，刷新页面即可生效。
 *
 * 数据结构参照 bracket.json，字段说明见 data/tournament.json。
 */
const SEED_URL = 'data/tournament.json';
const OVERRIDE_KEY = 'cyt2026.matchOverrides';

export class TournamentData {
  constructor() {
    this.data = null;
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
      const res = await fetch(SEED_URL);
      if (!res.ok) throw new Error(`加载 ${SEED_URL} 失败: ${res.status}`);
      this.data = await res.json();

      /* 把 mappools 里的 beatmaps 按 round.mappool 注入到各 round */
      const pools = this.data.mappools || [];
      for (const round of (this.data.rounds || [])) {
        const pool = pools.find(p => p.id === round.mappool);
        round.beatmaps = pool?.beatmaps || [];
      }

      console.log('[TournamentData] 已加载', SEED_URL);
      return this.data;
    })();
    return this._readyPromise;
  }

  /* =========================================
     顶层读取
     ========================================= */

  /** 完整数据对象 */
  get() {
    return this.data;
  }

  /** meta 段 */
  getMeta() {
    return this.data?.meta ?? {};
  }

  /** ruleset 段 */
  getRuleset() {
    return this.data?.ruleset ?? {};
  }

  /* =========================================
     队伍
     ========================================= */

  getTeams() {
    return this.data?.teams ?? [];
  }

  getTeam(acronym) {
    if (!acronym) return null;
    return this.getTeams().find(t => t.acronym === acronym) || null;
  }

  /** 队伍的全名，找不到时回落到 acronym */
  getTeamName(acronym) {
    const team = this.getTeam(acronym);
    return team?.fullName || team?.flagName || acronym || '';
  }

  /* =========================================
     轮次
     ========================================= */

  getRounds() {
    return this.data?.rounds ?? [];
  }

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

    /* 回退：从 rounds 反推 unique mappools */
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
    return raw.map(m => {
      const ov = this._overrides[String(m.id)];
      return ov ? { ...m, ...ov } : m;
    });
  }

  getMatch(id) {
    if (id === undefined || id === null) return null;
    const raw = (this.data?.matches ?? []).find(m => m.id === id);
    if (!raw) return null;
    const ov = this._overrides[String(id)];
    return ov ? { ...raw, ...ov } : raw;
  }

getMatchBP(matchId) {
  const match = this.getMatch(matchId);
  if (!match) return { bans: [], picks: [] };
  return {
    bans:  Array.isArray(match.bans)  ? match.bans  : [],
    picks: Array.isArray(match.picks) ? match.picks : [],
  };
}

  /** 某轮次下的所有对局（按 matches[].roundId 过滤） */
  getMatchesByRound(roundId) {
    return this.getMatches().filter(m => m.roundId === roundId);
  }

  /* =========================================
     比赛覆盖层（直播员手动修正，不影响本地文件）
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

  /** 当前正在进行的对局 */
  getCurrentMatch() {
    return this.getMatches().find(m => m.current) || null;
  }

  /* =========================================
     图池（按轮次）
     ========================================= */

  /** 某轮次下指定 mod 的图（NM / HD / HR / DT / FM / TB） */
  getBeatmapsByMods(roundId, mods) {
    const round = this.getRound(roundId);
    if (!round) return [];
    return (round.beatmaps || []).filter(b => b.mods === mods);
  }

  /** 通过 beatmapId 查找图，返回 { beatmap, round } */
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

  /** 所有出现过的队伍 acronym（用于渲染列/筛选） */
  getAllAcronyms() {
    return this.getTeams().map(t => t.acronym);
  }

  /** 所有 mod 类型 */
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