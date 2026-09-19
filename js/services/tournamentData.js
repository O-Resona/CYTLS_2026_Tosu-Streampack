/**
 * TournamentData —— 只读的总比赛数据
 *
 * 从 data/tournament.json 加载一次，之后不再写盘。
 * 数据更新方式：手动编辑 data/tournament.json，刷新页面即可生效。
 *
 * 数据结构参照 bracket.json，字段说明见 data/tournament.json。
 */
const SEED_URL = 'data/tournament.json';

export class TournamentData {
  constructor() {
    this.data = null;
    this._readyPromise = null;
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
     对局
     ========================================= */

  getMatches() {
    return this.data?.matches ?? [];
  }

  getMatch(id) {
    if (id === undefined || id === null) return null;
    return this.getMatches().find(m => m.id === id) || null;
  }

  /** 某轮次下的所有对局（按 matches[].roundId 过滤） */
  getMatchesByRound(roundId) {
    return this.getMatches().filter(m => m.roundId === roundId);
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