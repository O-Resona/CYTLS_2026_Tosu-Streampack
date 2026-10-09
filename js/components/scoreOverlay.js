/**
 * ScoreOverlay —— mappool 页左侧滑出信息面板
 *
 * 面板从左侧滑入，duration 毫秒后自动收回。
 * 内容超出可视高度时：
 *   · 滑入 5s 后开始以固定慢速向下滚动
 *   · 用户手动滚轮时暂停自动滚动
 *   · 只有滚动容器本身接收鼠标事件，其它区域穿透到地图卡
 */

const SCROLL_DELAY_MS = 5000;
const SCROLL_SPEED    = 25;    // px / s

export class ScoreOverlay {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange || null;
    this.titleEl  = root?.querySelector('.score-overlay__title');
    this.bodyEl   = root?.querySelector('.score-overlay__body');
    this.scrollEl = null;
    this._hideTimer   = null;
    this._scrollTimer = null;
    this._scrollRaf   = null;
    this._manualPaused = false;

    this._onWheel = () => {
      /* 用户手动滚动 → 永久停掉本次自动滚动 */
      this._manualPaused = true;
      this._stopScroll();
    };
  }

  show({ title, bodyHtml, duration = 20000 }) {
    if (!this.root) return;

    if (this.titleEl) this.titleEl.innerHTML = title || '';
    if (this.bodyEl)  this.bodyEl.innerHTML = bodyHtml || '';

    this.scrollEl = this.bodyEl?.querySelector('.so-scroll') || this.bodyEl;

    /* 清理上一次的手动监听 */
    if (this.scrollEl && this._wheelBound) {
      this.scrollEl.removeEventListener('wheel', this._onWheel);
      this._wheelBound = false;
    }

    this._stopScroll();
    this._manualPaused = false;

    if (this.scrollEl) {
      this.scrollEl.scrollTop = 0;
      this.scrollEl.classList.remove('is-scrollable');
    }

    this.root.classList.remove('is-visible');
    void this.root.offsetWidth;
    this.root.classList.add('is-visible');

    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hide(), duration);

    /* 等布局完成后再判断是否溢出、绑定 wheel */
    requestAnimationFrame(() => {
      const el = this.scrollEl;
      if (!el) return;

      const overflow = el.scrollHeight - el.clientHeight > 1;
      el.classList.toggle('is-scrollable', overflow);

      if (overflow) {
        el.addEventListener('wheel', this._onWheel, { passive: true });
        this._wheelBound = true;

        /* 5s 后开始自动滚动（仅当用户未手滚） */
        this._scrollTimer = setTimeout(() => {
          this._scrollTimer = null;
          if (!this._manualPaused) this._startAutoScroll();
        }, SCROLL_DELAY_MS);
      }
    });

    this.onChange?.();
  }

  _startAutoScroll() {
    const el = this.scrollEl;
    if (!el || this._manualPaused) return;

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    let lastTs = null;

    const step = (ts) => {
      if (this._manualPaused) { this._scrollRaf = null; return; }

      if (lastTs == null) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      el.scrollTop = Math.min(maxScroll, el.scrollTop + SCROLL_SPEED * dt);

      if (el.scrollTop < maxScroll - 0.5) {
        this._scrollRaf = requestAnimationFrame(step);
      } else {
        this._scrollRaf = null;
      }
    };
    this._scrollRaf = requestAnimationFrame(step);
  }

  _stopScroll() {
    if (this._scrollTimer) { clearTimeout(this._scrollTimer); this._scrollTimer = null; }
    if (this._scrollRaf)   { cancelAnimationFrame(this._scrollRaf); this._scrollRaf = null; }
  }

  hide() {
    if (!this.root) return;
    this.root.classList.remove('is-visible');
    this._stopScroll();

    if (this.scrollEl && this._wheelBound) {
      this.scrollEl.removeEventListener('wheel', this._onWheel);
      this._wheelBound = false;
    }

    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    this.onChange?.();
  }

  destroy() { this.hide(); }
}