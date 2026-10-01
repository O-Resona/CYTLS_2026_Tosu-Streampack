/**
 * AutoTransition —— 自动切页时的 bg4 上下滑入转场
 *
 * 时序：
 *   t=0       bg4 从页面上方滑入（0.7s）
 *   t=700ms   滑入完成，执行切页回调
 *   t=700ms   停住（0.5s）
 *   t=1200ms  bg4 向上滑出（0.7s）
 *   t=1900ms  隐藏，释放锁
 *
 * 与 final 转场（.final-bg）无关，独立层，互不影响。
 */

const SLIDE_IN  = 500;
const HOLD      = 100;
const SLIDE_OUT = 400;
const TOTAL     = SLIDE_IN + HOLD + SLIDE_OUT;

let _el   = null;
let _busy = false;

function ensureEl() {
  if (_el) return _el;
  _el = document.getElementById('autoTransition');
  return _el;
}

/**
 * 播放转场；滑入到底那一刻执行 onMidpoint（用于切页）。
 * 若当前已有转场在播放，直接执行 onMidpoint，不重复播放。
 *
 * @param {() => void} [onMidpoint]
 */
export function playAutoTransition(onMidpoint) {
  const el = ensureEl();

  if (!el || _busy) {
    try { onMidpoint?.(); } catch (e) { console.error('[AutoTransition]', e); }
    return;
  }

  _busy = true;

  el.hidden = false;
  el.classList.remove('is-playing');
  void el.offsetWidth;             // 强制 reflow，保证动画能重新触发
  el.classList.add('is-playing');

  /* t=700ms：滑入完成 → 切页 */
  setTimeout(() => {
    try { onMidpoint?.(); }
    catch (e) { console.error('[AutoTransition] onMidpoint failed:', e); }
  }, SLIDE_IN);

  /* t=1900ms：动画结束 → 清理 */
  setTimeout(() => {
    el.classList.remove('is-playing');
    el.hidden = true;
    _busy = false;
  }, TOTAL);
}

export function isAutoTransitionPlaying() {
  return _busy;
}

/* =========================================
   调试接口：F12 控制台手动触发
   ========================================= */

if (typeof window !== 'undefined') {
  window.debugTransition = (onMidpoint) => {
    console.log('[AutoTransition] 手动触发');
    playAutoTransition(onMidpoint || (() => console.log('[AutoTransition] 中点触发')));
  };
}