/**
 * LogoBadge —— 全局顶部 Logo + 轮次框
 *
 * 轮次框改为图片：src/round_titles/<key>.png
 * key 由当前比赛的 id 决定：
 *   1-8   → R1 0-0
 *   9-12  → R2 1-0
 *   13-16 → R2 0-1
 *   17-18 → R3 2-0
 *   19-22 → R3 1-1
 *   23-24 → R3 0-2
 *   25-27 → R4 2-1
 *   28-30 → R4 1-2
 *   31-33 → R5 2-2
 *   34-35 → SF WB
 *   36-37 → SF LB
 *   38    → F WB
 *   39-41 → F LB
 *   42    → GF LB
 *   43    → GF WB
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const IMG_BASE = 'src/round_titles';

const ROUND_TITLE_IMAGES = {
  1:  'R1 0-0',
  2:  'R1 0-0',
  3:  'R1 0-0',
  4:  'R1 0-0',
  5:  'R1 0-0',
  6:  'R1 0-0',
  7:  'R1 0-0',
  8:  'R1 0-0',
  9:  'R2 1-0',
  10: 'R2 1-0',
  11: 'R2 1-0',
  12: 'R2 1-0',
  13: 'R2 0-1',
  14: 'R2 0-1',
  15: 'R2 0-1',
  16: 'R2 0-1',
  17: 'R3 2-0',
  18: 'R3 2-0',
  19: 'R3 1-1',
  20: 'R3 1-1',
  21: 'R3 1-1',
  22: 'R3 1-1',
  23: 'R3 0-2',
  24: 'R3 0-2',
  25: 'R4 2-1',
  26: 'R4 2-1',
  27: 'R4 2-1',
  28: 'R4 1-2',
  29: 'R4 1-2',
  30: 'R4 1-2',
  31: 'R5 2-2',
  32: 'R5 2-2',
  33: 'R5 2-2',
  34: 'SF WB',
  35: 'SF WB',
  36: 'SF LB',
  37: 'SF LB',
  38: 'F WB',
  39: 'F LB',
  40: 'F LB',
  41: 'F LB',
  42: 'GF LB',
  43: 'GF WB',
};

export class LogoBadge {
  constructor(root, { tournamentData } = {}) {
    this.root = root;
    this.tournamentData = tournamentData;
    this.badgeEl = root.querySelector('#globalLogoBadge');
    this._lastSrc = null;

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

    const key = id != null ? ROUND_TITLE_IMAGES[id] : null;
    const nextSrc = key ? `${IMG_BASE}/${key}.png` : '';

    if (nextSrc === this._lastSrc) return;
    this._lastSrc = nextSrc;

    if (nextSrc) {
      this.badgeEl.src = nextSrc;
      this.badgeEl.style.opacity = '';
    } else {
      this.badgeEl.removeAttribute('src');
      this.badgeEl.style.opacity = '0';
    }
  }
}