/**
 * WinnerWatcher —— 监测当前比赛，自动切换 Winner 页
 *
 * 规则：
 *   - 任一方比分达到本场决胜分且领先 → 「获胜」
 *   - 或任一方 FF（分数 === -1）→ 对手获胜
 *   - 只有从「非获胜」变为「获胜」的过渡才会被记录
 *   - 记录后 16 秒内比分保持不变 → 自动切到 winner 页
 *   - 比分变化会重新计时
 *   - 同一场比赛只触发一次
 */

import { playAutoTransition } from './autoTransition.js';

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

const POLL_INTERVAL = 300;
const FIRE_DELAY    = 16000;

export class WinnerWatcher {
  constructor({ tournamentData, router }) {
    this.tournamentData = tournamentData;
    this.router = router;

    this._pollId = null;
    this._timer = null;

    this._matchId = null;
    this._seenNonWinner = false;
    this._armedSnap = null;
    this._firedMatchId = null;
  }

  start() {
    if (this._pollId) return;
    this._pollId = setInterval(() => this._tick(), POLL_INTERVAL);

    window.addEventListener('storage', (e) => {
      if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) {
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

    const s1 = Number(match.team1Score);
    const s2 = Number(match.team2Score);
    const ff1 = s1 === -1;
    const ff2 = s2 === -1;

    let winner = 0;
    let acronym = '';

    /* FF 优先判定 */
    if (ff1 && !ff2) {
      winner = 2;
      acronym = match.team2Acronym || '';
    } else if (ff2 && !ff1) {
      winner = 1;
      acronym = match.team1Acronym || '';
    } else if (!ff1 && !ff2) {
      const round = this.tournamentData.getRound(match.roundId);
      const bestOf = Number(round?.bestOf) || 9;
      const maxStars = Math.ceil(bestOf / 2);
      const n1 = s1 || 0;
      const n2 = s2 || 0;

      if (n1 >= maxStars && n1 > n2) {
        winner = 1; acronym = match.team1Acronym || '';
      } else if (n2 >= maxStars && n2 > n1) {
        winner = 2; acronym = match.team2Acronym || '';
      }
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

    /* 切了比赛 → 重置状态 */
    if (info.id !== this._matchId) {
      this._matchId = info.id;
      this._firedMatchId = null;
      this._clearTimer();

      /* 若切过去第一眼就是「已获胜」→ 视为已结束的比赛，不触发 */
      this._seenNonWinner = !info.winner;
      return;
    }

    if (!info.id) return;

    if (!info.winner) {
      this._seenNonWinner = true;
      this._clearTimer();
      return;
    }

    if (!this._seenNonWinner) return;
    if (this._firedMatchId === info.id) return;

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
      playAutoTransition(() => this.router.show('winner'));
    }
  }
}