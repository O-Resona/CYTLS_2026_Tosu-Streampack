/**
 * StatsPanel —— 谱面数值面板
 *
 * 显示 CS / AR / OD、Length、Star Rating、BPM、OSU! 徽章。
 * 只依赖 tokenStore，两个页面（Showcase / Playing）共用。
 */
export class StatsPanel {
  constructor(root, { tokenStore }) {
    this.root = root;
    this.tokenStore = tokenStore;
    this._unsub = null;

    this.refs = {
      mCS:       root.querySelector('[data-field="mCS"]'),
      mAR:       root.querySelector('[data-field="mAR"]'),
      mOD:       root.querySelector('[data-field="mOD"]'),
      mStars:    root.querySelector('[data-field="mStars"]'),
      mBpm:      root.querySelector('[data-field="mBpm"]'),
      totalTime: root.querySelector('[data-field="totalTime"]'),
    };
  }

  mount() {
    this._unsub = this.tokenStore.watch(
      ['mCS', 'mAR', 'mOD', 'mStars', 'mBpm', 'totaltime'],
      (t) => this.render(t)
    );
    return this;
  }

  render(t) {
    const { mCS, mAR, mOD, mStars, mBpm, totalTime } = this.refs;
    if (mCS)       mCS.textContent       = t.mCS    || '-';
    if (mAR)       mAR.textContent       = t.mAR    || '-';
    if (mOD)       mOD.textContent       = t.mOD    || '-';
    if (mStars)    mStars.textContent    = t.mStars || '-';
    if (mBpm)      mBpm.textContent      = t.mBpm   || '-';
    if (totalTime) totalTime.textContent = this._formatTime(t.totaltime);
  }

  _formatTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '0:00';
    const sec = Math.floor(n / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  destroy() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }
}