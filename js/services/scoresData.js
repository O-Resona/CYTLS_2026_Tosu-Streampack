/**
 * ScoresData —— 加载并解析 data/scores_*.txt 成绩文件
 *
 * 文件格式（tab 分隔，首行为表头）：
 *   Room Name / Room ID / User ID / Beatmap ID / Score / Passed? /
 *   Accuracy / Max Combo / Great(s) / Ok(s) / Meh(s) / Miss(es) /
 *   Mods / Rank / Scored at
 *
 * 只保留 Passed? === TRUE 的行。
 * 按 beatmapId → roomId → rows 三层索引，供 mappool 页按图查询。
 */

const SCORES_URLS = {
  'swiss-1': 'data/scores_swiss1.txt',
  'swiss-2': 'data/scores_swiss2.txt',
  'bracket': 'data/scores_bracket.txt',
};

export class ScoresData {
  constructor({ tournamentData } = {}) {
    this.tournamentData = tournamentData;
    this._pools   = new Map();   // poolId -> { byBeatmap } | null
    this._loading = new Map();   // poolId -> Promise
  }

  async loadPool(poolId) {
    if (!poolId) return null;
    if (this._pools.has(poolId))   return this._pools.get(poolId);
    if (this._loading.has(poolId)) return this._loading.get(poolId);

    const url = SCORES_URLS[poolId];
    if (!url) return null;

    const promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const pool = this._parse(text);
        this._pools.set(poolId, pool);
        return pool;
      } catch (e) {
        console.warn(`[ScoresData] 加载 ${url} 失败:`, e);
        this._pools.set(poolId, null);
        return null;
      } finally {
        this._loading.delete(poolId);
      }
    })();

    this._loading.set(poolId, promise);
    return promise;
  }

  _parse(text) {
    const byBeatmap = new Map();

    const lines = String(text).split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const c = line.split('\t');
      if (c.length < 6) continue;

      const passed = (c[5] || '').trim().toUpperCase() === 'TRUE';
      if (!passed) continue;

      const row = {
        roomName:  (c[0]  || '').trim(),
        roomId:    (c[1]  || '').trim(),
        userId:    (c[2]  || '').trim(),
        beatmapId: (c[3]  || '').trim(),
        score:     Number(c[4]) || 0,
        accuracy:  (c[6]  || '').trim(),
        maxCombo:  Number(c[7]) || 0,
        mods:      (c[12] || '').trim(),
        rank:      (c[13] || '').trim(),
        scoredAt:  (c[14] || '').trim(),
      };
      if (!row.beatmapId) continue;

      if (!byBeatmap.has(row.beatmapId)) byBeatmap.set(row.beatmapId, new Map());
      const byRoom = byBeatmap.get(row.beatmapId);
      if (!byRoom.has(row.roomId)) byRoom.set(row.roomId, []);
      byRoom.get(row.roomId).push(row);
    }

    return { byBeatmap };
  }

  /**
   * 取某谱面全部房间成绩
   * @returns {Array<{ roomId: string, roomName: string, rows: Array }>}
   */
  getRoomsForBeatmap(poolId, beatmapId) {
    const pool = this._pools.get(poolId);
    if (!pool) return [];
    const byRoom = pool.byBeatmap.get(String(beatmapId));
    if (!byRoom) return [];

    const out = [];
    for (const [roomId, rows] of byRoom) {
      out.push({
        roomId,
        roomName: rows[0]?.roomName || '',
        rows,
      });
    }
    return out;
  }
}