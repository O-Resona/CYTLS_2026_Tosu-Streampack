/**
 * ScoreOverlay —— mappool 页左侧滑出信息面板
 *
 * 面板从左侧滑入，duration 毫秒后自动收回（duration = 0 表示永不自动隐藏）。
 *
 * 内容超出可视高度时：
 *   · 滑入 5s 后开始以固定慢速向下滚动（transform 平移，sub-pixel 平滑）
 *   · 滚动到底后无缝接续（末尾 → 空行 → 头部），接续瞬间暂停 5s
 *   · 用户手动滚轮时暂停自动滚动，3s 后自动恢复
 *   · 手动滚到顶部/底部时，把滚轮量转发给 mappool 页本身
 *
 * 性能：
 *   · 滚动期间给面板加 .is-scrolling → 临时关闭 backdrop-filter，避免每帧重算模糊
 *   · .so-track 用 transform 平移，sub-pixel 平滑
 */

const SCROLL_DELAY_MS  = 5000;   // 首次启动自动滚动的延迟
const SCROLL_SPEED     = 20;     // px / s
const LOOP_PAUSE_MS    = 5000;   // 循环接续时的暂停
const RESUME_DELAY_MS  = 3000;   // 手动滚动后多久恢复自动滚动

export class ScoreOverlay {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange || null;
    this.titleEl  = root?.querySelector('.score-overlay__title');
    this.bodyEl   = root?.querySelector('.score-overlay__body');
    this.scrollEl = null;
    this.trackEl  = null;
    this._panelEl = root || null;

    this._hideTimer    = null;
    this._scrollTimer  = null;
    this._scrollRaf    = null;
    this._resumeTimer  = null;
    this._manualPaused = false;
    this._wheelBound   = false;

    this._pos  = 0;   // 当前平移位置（向下为正，px，浮点）
    this._segH = 0;   // 循环单位高度（一份 segment + 空行）

    this._onWheel = (e) => {
      this._manualPaused = true;
      this._stopScroll();

      if (this._resumeTimer) clearTimeout(this._resumeTimer);
      this._resumeTimer = setTimeout(() => {
        this._resumeTimer = null;
        this._manualPaused = false;
        this._startAutoScroll();
      }, RESUME_DELAY_MS);

      const el    = this.scrollEl;
      const track = this.trackEl;
      if (!el || !track) return;

      const maxScroll = Math.max(0, this._segH - el.clientHeight);
      const before    = this._pos;
      const next      = Math.max(0, Math.min(maxScroll, this._pos + e.deltaY));

      /* 已到边界 → 把滚轮量转发给 mappool 页 */
      if (next === before) {
        const page = document.querySelector('[data-page="mappool"] .mappool-wrapper');
        if (page) page.scrollTop += e.deltaY;
        return;
      }

      this._pos = next;
      track.style.transform = `translate3d(0, ${-next}px, 0)`;
    };
  }

  show({ title, bodyHtml, duration = 20000 }) {
    if (!this.root) return;

    if (this.titleEl) this.titleEl.innerHTML = title || '';
    if (this.bodyEl)  this.bodyEl.innerHTML = bodyHtml || '';

    this.scrollEl = this.bodyEl?.querySelector('.so-scroll') || this.bodyEl;
    this.trackEl  = this.scrollEl?.querySelector('.so-track') || null;

    /* 清理上一次的手动监听 */
    if (this.scrollEl && this._wheelBound) {
      this.scrollEl.removeEventListener('wheel', this._onWheel);
      this._wheelBound = false;
    }

    this._stopScroll();
    if (this._resumeTimer) { clearTimeout(this._resumeTimer); this._resumeTimer = null; }
    this._manualPaused = false;
    this._pos  = 0;
    this._segH = 0;

    if (this.trackEl) {
      this.trackEl.style.transform = 'translate3d(0, 0, 0)';
    }
    if (this.scrollEl) {
      this.scrollEl.classList.remove('is-scrollable');
    }

    this.root.classList.remove('is-visible');
    void this.root.offsetWidth;
    this.root.classList.add('is-visible');

    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (duration > 0) {
      this._hideTimer = setTimeout(() => this.hide(), duration);
    } else {
      this._hideTimer = null;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => this._prepareScroll(), 80);
      });
    });

    this.onChange?.();
  }

  _prepareScroll() {
    const el    = this.scrollEl;
    const track = this.trackEl;
    if (!el || !track) return;
    if (!el.isConnected) return;

    const seg = track.querySelector('.so-segment');

    /* 用 segment 高度判断是否溢出（.so-scroll 是 overflow: hidden） */
    const overflow = seg ? (seg.offsetHeight > el.clientHeight + 1) : false;

    /* 溢出 → 复制一份 segment（幂等：已复制则跳过） */
    if (overflow && seg && !track.querySelector('.so-row-gap')) {
      const gap = document.createElement('div');
      gap.className = 'so-row-gap';
      track.appendChild(gap);
      track.appendChild(seg.cloneNode(true));
    }

    /* 计算循环单位高度 */
    const segs = track.querySelectorAll('.so-segment');
    if (segs.length >= 2) {
      let segH = segs[1].offsetTop - segs[0].offsetTop;
      if (!(segH > 0)) {
        const gapEl = track.querySelector('.so-row-gap');
        const gapH  = gapEl ? gapEl.offsetHeight : 40;
        segH = segs[0].offsetHeight + gapH + 8;
      }
      this._segH = segH;
    }

    el.classList.toggle('is-scrollable', overflow);

    if (!overflow) return;
    if (this._wheelBound) return;

    el.addEventListener('wheel', this._onWheel, { passive: true });
    this._wheelBound = true;

    this._scrollTimer = setTimeout(() => {
      this._scrollTimer = null;
      if (!this._manualPaused) this._startAutoScroll();
    }, SCROLL_DELAY_MS);
  }

  _startAutoScroll() {
    const el    = this.scrollEl;
    const track = this.trackEl;
    if (!el || !track || this._manualPaused) return;

    const segs = track.querySelectorAll('.so-segment');
    if (segs.length < 2) return;

    const segH = this._segH;
    if (!(segH > 0)) return;

    /* 从当前位置开始 */
    let pos        = this._pos;
    let lastTs     = null;
    let pauseUntil = 0;

    const step = (ts) => {
      if (this._manualPaused) { this._scrollRaf = null; return; }

      if (lastTs == null) lastTs = ts;

      if (ts < pauseUntil) {
        lastTs = ts;
        this._scrollRaf = requestAnimationFrame(step);
        return;
      }

      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      pos += SCROLL_SPEED * dt;

      /* 越过一个循环单位 → 无缝接续 + 暂停 */
      if (pos >= segH) {
        pos -= segH;
        pauseUntil = ts + LOOP_PAUSE_MS;
      }

      this._pos = pos;
      track.style.transform = `translate3d(0, ${-pos}px, 0)`;

      this._scrollRaf = requestAnimationFrame(step);
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

    if (this._resumeTimer) { clearTimeout(this._resumeTimer); this._resumeTimer = null; }

    if (this.scrollEl && this._wheelBound) {
      this.scrollEl.removeEventListener('wheel', this._onWheel);
      this._wheelBound = false;
    }

    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    this.onChange?.();
  }

  destroy() { this.hide(); }
}