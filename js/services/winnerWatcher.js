/**
 * WinnerWatcher —— 监测当前比赛，自动切换 Winner 页
 *
 * 规则：
 *   - 任一队比分达到本场最大值（bestOf 一半向上取整）且领先对手 → 「获胜」
 *   - 只有从「非获胜」变为「获胜」的过渡才会被记录
 *     （从 bracket 选中一个已结束的比赛不会触发）
 *   - 记录后 6 秒内比分保持不变 → 自动切到 winner 页
 *   - 6 秒内比分发生任何变化 → 重新计时
 *   - 同一场比赛只触发一次
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

const POLL_INTERVAL = 300;    /* 轮询间隔 */
const FIRE_DELAY    = 6000;   /* 比分稳定后停留多久再切 */

export class WinnerWatcher {
  constructor({ tournamentData, router }) {
    this.tournamentData = tournamentData;
    this.router = router;

    this._pollId = null;
    this._timer = null;

    this._matchId = null;         /* 上次观察到的比赛 id */
    this._seenNonWinner = false;  /* 本场比赛期间是否见过非获胜状态 */
    this._armedSnap = null;       /* 当前计时的比分快照 */
    this._firedMatchId = null;    /* 已触发过的比赛 id */
  }

  start() {
    if (this._pollId) return;
    this._pollId = setInterval(() => this._tick(), POLL_INTERVAL);

    window.addEventListener('storage', (e) => {
      if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) {
        /* 立即跑一次，别等下一个 tick */
        this._tick();
      }
    });
  }

  stop() {
    if (this._pollId) { clearInterval(this._pollId); this._pollId = null; }
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._armedSnap = null;
  }

  /* =========================================
     读取当前状态
     ========================================= */

  _readState() {
    let id = null;
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      id = v ? Number(v) : null;
    } catch {}

    if (id == null) return { id: null, winner: 0, acronym: '', snap: '' };

    const match = this.tournamentData.getMatch(id);
    if (!match) return { id, winner: 0, acronym: '', snap: '' };

    const round = this.tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2);

    const s1 = Number(match.team1Score) || 0;
    const s2 = Number(match.team2Score) || 0;

    let winner = 0;
    let acronym = '';
    if (s1 >= maxStars && s1 > s2) {
      winner = 1;
      acronym = match.team1Acronym || '';
    } else if (s2 >= maxStars && s2 > s1) {
      winner = 2;
      acronym = match.team2Acronym || '';
    }

    return {
      id,
      winner,
      acronym,
      snap: `${id}:${s1}-${s2}`,
    };
  }

  /* =========================================
     tick
     ========================================= */

  _tick() {
    const info = this._readState();

    /* 切了比赛（或从无到有/从有到无）→ 重置状态 */
    if (info.id !== this._matchId) {
      this._matchId = info.id;
      this._firedMatchId = null;
      this._clearTimer();

      /* 若切过去的第一眼就是「已获胜」→ 视为已结束的比赛，不参与触发 */
      this._seenNonWinner = !info.winner;

      return;   /* 本次不 arm，给下一次 tick 一点观察时间 */
    }

    /* 没有当前比赛 */
    if (!info.id) return;

    /* 未获胜 → 标记见过非获胜，并取消计时 */
    if (!info.winner) {
      this._seenNonWinner = true;
      this._clearTimer();
      return;
    }

    /* 到这里说明已经获胜 */

    /* 从未见过非获胜 → 本次比赛是从「已获胜」状态起步的，不触发 */
    if (!this._seenNonWinner) return;

    /* 这场比赛已经触发过 → 不重复 */
    if (this._firedMatchId === info.id) return;

    /* 新的比分快照 → 重设计时器 */
    if (this._armedSnap !== info.snap) {
      this._armedSnap = info.snap;
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this._fire(info), FIRE_DELAY);
    }
  }

  _fire(info) {
    this._timer = null;
    this._armedSnap = null;
    this._firedMatchId = info.id;

    if (this.router && typeof this.router.show === 'function') {
      this.router.show('winner');
    }
  }
}