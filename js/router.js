/**
 * Router —— 导航切换 + 子页面懒加载 + 交叉渐变 + 背景控制
 *
 * 每个子页面定义：
 *   {
 *     html: 'pages/xxx.html',
 *     init: async (deps) => void,
 *     bg: 'main' | 'alt',           // 可选：背景图，默认 'main'
 *     cover: 0 | 1 | 0~1,           // 可选：覆盖层不透明度，默认 0
 *     coverColor: '#fff',            // 可选：覆盖层颜色，默认白色
 *   }
 */
export function createRouter({ pages, deps }) {
  const root     = document.getElementById('pageRoot');
  const buttons  = document.querySelectorAll('.nav-btn');
  const bgCover  = document.querySelector('.global-bg-cover');
  const bgImages = document.querySelectorAll('.global-bg-image');
  const bgVideos = document.querySelectorAll('.global-bg-video');

  const loaded = new Set();
  const inited = new Set();

  let currentPage = null;
  let isTransitioning = false;

  /* ---------- 等待动画结束（带超时兜底） ---------- */

  function waitAnimation(el, timeout = 1400) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('animationend', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeout);
      el.addEventListener('animationend', finish);
    });
  }


  /* ---------- 应用背景 ---------- */

function applyBackground(pageName) {
  const cfg = pages[pageName] || {};

  // ---------- 视频 ----------
  const videoKey = cfg.video || 'main';
  bgVideos.forEach(v => {
    const show = (v.dataset.bg === videoKey);
    v.style.display = show ? '' : 'none';

    if (show) {
      v.muted = true;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  });

  // ---------- 图片 ----------
  const imageKey = cfg.bg || 'main';
  bgImages.forEach(img => {
    img.style.display = (img.dataset.bg === imageKey) ? '' : 'none';
  });

  // ---------- 覆盖层 ----------
  if (bgCover) {
    const cover = typeof cfg.cover === 'number' ? cfg.cover : 0;
    const color = cfg.coverColor || '#ffffff';
    bgCover.style.background = color;
    bgCover.style.opacity = String(cover);
  }
}

  /* ---------- 加载页面 ---------- */

  async function loadPage(name) {
    const def = pages[name];
    if (!def) {
      console.warn(`[Router] 未注册的页面：${name}`);
      return null;
    }

    if (!loaded.has(name)) {
      try {
        const res = await fetch(def.html);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        root.insertAdjacentHTML('beforeend', html);
        loaded.add(name);
      } catch (e) {
        console.error(`[Router] 加载 ${def.html} 失败:`, e);
        return null;
      }
    }

    const section = root.querySelector(`[data-page="${name}"]`);
    if (!section) {
      console.error(`[Router] HTML 里找不到 [data-page="${name}"]`);
      return null;
    }

    if (!inited.has(name) && typeof def.init === 'function') {
      try {
        await def.init(deps);
        inited.add(name);
      } catch (e) {
        console.error(`[Router] init "${name}" 失败:`, e);
      }
    }

    return section;
  }

  /* ---------- 淡出旧页面 ---------- */

  function fadeOutPrev() {
    const prev = root.querySelector('.page.active');
    if (!prev) return Promise.resolve();

    prev.dispatchEvent(new CustomEvent('page:deactivated'));

    prev.classList.remove('active');
    prev.classList.add('is-leaving');

    return waitAnimation(prev, 1400).then(() => {
      prev.classList.remove('is-leaving');
    });
  }

  /* ---------- 切换页面 ---------- */

  async function show(name) {
    if (name === currentPage) return;
    if (isTransitioning) return;

    isTransitioning = true;
    try {
      // 1. 旧页面开始淡出（不 await）
      const fadeOutPromise = fadeOutPrev();

      // 2. 加载新页面
      const section = await loadPage(name);

      if (!section) {
        await fadeOutPromise;
        return;
      }

      // 3. 应用背景
      applyBackground(name);

      // 4. 新页面立即淡入
      section.classList.add('active');

      buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.target === name);
      });

      currentPage = name;

      section.dispatchEvent(new CustomEvent('page:activated'));

      // 5. 等旧页面淡出收尾
      await fadeOutPromise;
    } finally {
      isTransitioning = false;
    }
  }

  /* ---------- 绑定按钮 ---------- */

  buttons.forEach(btn => {
    btn.addEventListener('click', () => show(btn.dataset.target));
  });

  /* ---------- 默认显示第一个 ---------- */

  const initial = buttons[0]?.dataset.target;
  if (initial) show(initial);

  return { show };
}