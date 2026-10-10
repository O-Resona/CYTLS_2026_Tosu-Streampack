/**
 * ScoreOverlay —— mappool 页左侧滑出信息面板
 *
 * 面板从左侧滑入，duration 毫秒后自动收回（duration = 0 表示永不自动隐藏）。
 *
 * 内容超出可视高度时：
 *   · 滑入 5s 后开始以固定慢速向下滚动
 *   · 滚动到底后无缝接续（末尾 → 空行 → 头部），接续瞬间暂停 5s
 *   · 用户手动滚轮时暂停自动滚动，3s 后自动恢复
 *   · 手动滚到顶部/底部时，把滚轮量转发给 mappool 页本身
 *
 * 布局准备用双层 rAF + 80ms 延迟，避免切页 / 滑入动画期间
 * scrollHeight 尚未算好导致"不滚"。
 */

const SCROLL_DELAY_MS  = 5000;   // 首次启动自动滚动的延迟
const SCROLL_SPEED     = 10;     // px / s
const LOOP_PAUSE_MS    = 5000;   // 循环接续时的暂停
const RESUME_DELAY_MS  = 3000;   // 手动滚动后多久恢复自动滚动

export class ScoreOverlay {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange || null;
    this.titleEl  = root?.querySelector('.score-overlay__title');
    this.bodyEl   = root?.querySelector('.score-overlay__body');
    this.scrollEl = null;

    this._hideTimer    = null;
    this._scrollTimer  = null;
    this._scrollRaf    = null;
    this._resumeTimer  = null;
    this._manualPaused = false;
    this._wheelBound   = false;

    this._onWheel = (e) => {
      /* 手动滚动 → 暂时停掉自动滚动，3s 后恢复 */
      this._manualPaused = true;
      this._stopScroll();

      if (this._resumeTimer) clearTimeout(this._resumeTimer);
      this._resumeTimer = setTimeout(() => {
        this._resumeTimer = null;
        this._manualPaused = false;
        this._startAutoScroll();
      }, RESUME_DELAY_MS);

      /* 面板到达顶部/底部 → 把剩余滚轮量转发给 mappool 页本身 */
      const el = this.scrollEl;
      if (!el) return;

      const atTop    = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        const page = document.querySelector('[data-page="mappool"] .mappool-wrapper');
        if (page) page.scrollTop += e.deltaY;
      }
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
    if (this._resumeTimer) { clearTimeout(this._resumeTimer); this._resumeTimer = null; }
    this._manualPaused = false;

    if (this.scrollEl) {
      this.scrollEl.scrollTop = 0;
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

    /* 等布局稳定后：判断是否溢出 → 复制一份 → 绑定 wheel → 启动滚动
       用双层 rAF + 短延迟，避免切页 / 滑入动画期间 scrollHeight 尚未算好 */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => this._prepareScroll(), 80);
      });
    });

    this.onChange?.();
  }

  _prepareScroll() {
    const el = this.scrollEl;
    if (!el) return;
    if (!el.isConnected) return;

    const seg = el.querySelector('.so-segment');
    const overflow = el.scrollHeight - el.clientHeight > 1;

    /* 溢出 → 复制一份 segment（幂等：已复制则跳过） */
    if (overflow && seg && !el.querySelector('.so-row-gap')) {
      const gap = document.createElement('div');
      gap.className = 'so-row-gap';
      el.appendChild(gap);
      el.appendChild(seg.cloneNode(true));
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
    const el = this.scrollEl;
    if (!el || this._manualPaused) return;

    const segs = el.querySelectorAll('.so-segment');
    if (segs.length < 2) return;

    /* 循环单位 = 第二个 segment 的 offsetTop - 第一个的 offsetTop
       （含两份之间的空行） */
    const segH = segs[1].offsetTop - segs[0].offsetTop;
    if (segH <= 0) return;

    let lastTs = null;
    let pauseUntil = 0;

    const step = (ts) => {
      if (this._manualPaused) { this._scrollRaf = null; return; }

      if (lastTs == null) lastTs = ts;

      /* 循环接续处暂停 */
      if (ts < pauseUntil) {
        lastTs = ts;
        this._scrollRaf = requestAnimationFrame(step);
        return;
      }

      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      el.scrollTop += SCROLL_SPEED * dt;

      /* 越过一个循环单位 → 往回跳（无缝接续），并暂停 */
      if (el.scrollTop >= segH) {
        el.scrollTop -= segH;
        pauseUntil = ts + LOOP_PAUSE_MS;
      }

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