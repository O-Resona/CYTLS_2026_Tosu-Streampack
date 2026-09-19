/**
 * TournamentState —— 比赛房间状态
 *
 * 目前聚焦 ipcState，但其它子页面可继续在这里扩展（比分、BP、轮次等）。
 */
const STATE_DESCRIPTIONS = {
  1: 'Idle',
  3: 'Playing',
  4: 'Ranking',
};

export class TournamentState {
  constructor() {
    this.ipcState = 0;
    this.previousIpcState = 0;
    this._handlers = new Set();
  }

  setIpcState(next) {
    if (next === this.ipcState) return;
    this.previousIpcState = this.ipcState;
    this.ipcState = next;
    this._handlers.forEach(fn => {
      try { fn(next, this.previousIpcState); } catch (e) { console.error(e); }
    });
  }

  onChange(fn) {
    this._handlers.add(fn);
    // 立即推送当前值
    fn(this.ipcState, this.previousIpcState);
    return () => this._handlers.delete(fn);
  }

  getDescription(state = this.ipcState) {
    return STATE_DESCRIPTIONS[state] || `未知状态 (${state})`;
  }
}