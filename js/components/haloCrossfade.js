/**
 * HaloCrossfade —— 两个 <video> 轮流播放做无缝循环
 *
 * 每个 stack 内放两个相同的 <video>。
 * 当前主角播到 FADE_AT（默认 11s）时，副角从 0 开始播，
 * 用 FADE_DURATION 秒交叉淡化：主角从 FADE_AT 到 FADE_AT+DURATION 淡出，
 * 副角从 0 到 DURATION 淡入。淡化结束后角色互换，循环往复。
 *
 * 这样视觉上就像一个持续播放的视频，切换点被淡化掩盖。
 */

const FADE_AT       = 11;
const FADE_DURATION = 1;

export function initHaloCrossfade() {
  document
    .querySelectorAll('.mc-halo-stack, .wc-halo-stack')
    .forEach(setupStack);
}

function setupStack(stack) {
  /* 防止同一 stack 被 setup 两次（router 懒加载会多次调用 initHaloCrossfade） */
  if (stack.dataset.haloInited === '1') return;
  stack.dataset.haloInited = '1';

  const [a, b] = stack.querySelectorAll('.mc-halo, .wc-halo');
  if (!a || !b) return;

  a.style.opacity = '1';
  b.style.opacity = '0';
  a.currentTime = 0;
  b.currentTime = 0;

  let active  = a;
  let standby = b;
  let fading  = false;

  active.play().catch(() => {});

  function tick() {
    if (!fading && active.currentTime >= FADE_AT) {
      fading = true;

      standby.currentTime = 0;
      standby.play().catch(() => {});

      const startTime = performance.now();

      function step(now) {
        const t = Math.min(1, (now - startTime) / (FADE_DURATION * 1000));
        active.style.opacity  = String(1 - t);
        standby.style.opacity = String(t);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          active.pause();
          active.currentTime = 0;
          active.style.opacity  = '0';
          standby.style.opacity = '1';

          [active, standby] = [standby, active];
          fading = false;
        }
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}