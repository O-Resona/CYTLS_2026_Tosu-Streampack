/**
 * LogoBadge —— 全局顶部 Logo + 轮次徽章
 *
 * 徽章显示当前比赛所绑定的轮次名（全大写）。
 * 由 router 控制显隐，仅在 mappool / playing / winner 显示。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';

export class LogoBadge {
  constructor(root, { tournamentData } = {}) {
    this.root = root;
    this.tournamentData = tournamentData;
    this.badgeEl = root.querySelector('#globalLogoBadge');
    this._lastText = null;

    window.addEventListener('storage', (e) => {
      if (e.key === CURRENT_MATCH_KEY) this.refresh();
    });
  }

  show() { this.root.classList.add('is-visible'); this.refresh(); }
  hide() { this.root.classList.remove('is-visible'); }

  refresh() {
    if (!this.badgeEl) return;

    let id = null;
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      id = v ? Number(v) : null;
    } catch {}

    let text = '';
    if (id != null) {
      const match = this.tournamentData?.getMatch(id);
      if (match) {
        const round = this.tournamentData.getRound(match.roundId);
        if (round?.name) text = String(round.name).toUpperCase();
      }
    }

    if (text === this._lastText) return;
    this._lastText = text;
    this.badgeEl.textContent = text;
  }
}