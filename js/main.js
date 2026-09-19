import { OsuSocket }       from './services/osuSocket.js';
import { TokenStore }      from './services/tokenStore.js';
import { TournamentState } from './services/tournamentState.js';
import { MapInfo }         from './services/mapInfo.js';
import { TournamentData }  from './services/tournamentData.js';

import { createRouter }          from './router.js';

import { initShowcase }          from './pages/showcase.js';
import { initMappool }           from './pages/mappool.js';
import { initShowcaseCountdown } from './pages/showcaseCountdown.js';
import { initMatchCountdown }    from './pages/matchCountdown.js';
import { initPlaying } from './pages/playing.js';
import { initBracket } from './pages/bracket.js';

/* =========================================
   1. 创建服务实例
   ========================================= */

const osuSocket       = new OsuSocket(`ws://${location.host}/ws`);
const tokenStore      = new TokenStore();
const tournamentState = new TournamentState();
const mapInfo         = new MapInfo(tokenStore);
const tournamentData  = new TournamentData();

/* =========================================
   2. 接线：osu 消息 → store
   ========================================= */

osuSocket.on('tokens',   tokens => tokenStore.updateBulk(tokens));
osuSocket.on('ipcState', state  => tournamentState.setIpcState(state));
osuSocket.connect();

/* =========================================
   3. 页面注册表
   =========================================
   background 字段：
     video: 'main' | 'alt2'       ← 指定视频（默认 'main'）
     bg:    'main' | 'alt' | 'third' | 'none'   ← 指定图片（默认 'main'）
     cover: 0 ~ 1                 ← 覆盖层不透明度（默认 0）
     coverColor: '#fff'           ← 覆盖层颜色（默认白色）
   ========================================= */

const pages = {
  'showcase': {
    html: 'pages/showcase.html',
    init: () => initShowcase({ mapInfo, tokenStore, tournamentState, tournamentData }),
    // 默认：video 'main' + image 'main'
  },
  'playing': {
    html: 'pages/playing.html',
    init: () => initPlaying({ tokenStore, tournamentState, mapInfo, tournamentData}),
  },
  'bracket': {
    html: 'pages/bracket.html',
    init: () => initBracket({ tournamentData }),
    bg: 'alt',
  },
  'mappool': {
    html: 'pages/mappool.html',
    init: () => initMappool({ tournamentData }),
    bg: 'alt',
  },
  'showcase-countdown': {
    html: 'pages/showcase-countdown.html',
    init: () => initShowcaseCountdown(),
    video: 'alt2',
    bg: 'third',
  },
  'match-countdown': {
    html: 'pages/match-countdown.html',
    init: () => initMatchCountdown({ tournamentData }),
    bg: 'alt',
  },
};

/* =========================================
   4. 全局背景视频：静音 + 自动播放兜底
   ========================================= */

function initBgVideo() {
  const videos = document.querySelectorAll('.global-bg-video');
  if (!videos.length) return;

  videos.forEach(video => {
    // HTML 上的 muted 属性在部分浏览器首次加载时可能不生效，显式再设一次
    video.muted       = true;
    video.loop        = true;
    video.playsInline = true;

    const tryPlay = () => {
      video.play().catch(err => {
        console.warn('[BG] 自动播放被阻止，等待用户交互:', err);

        const retry = () => {
          video.play().catch(() => {});
          document.removeEventListener('click', retry);
          document.removeEventListener('keydown', retry);
        };
        document.addEventListener('click', retry, { once: true });
        document.addEventListener('keydown', retry, { once: true });
      });
    };

    if (video.readyState >= 2) {
      tryPlay();
    } else {
      video.addEventListener('canplay', tryPlay, { once: true });
    }
  });
}

/* =========================================
   5. 启动
   ========================================= */

async function boot() {
  await tournamentData.init();

  initBgVideo();

  createRouter({
    pages,
    deps: { osuSocket, tokenStore, tournamentState, mapInfo, tournamentData },
  });

  // 暴露到全局，便于调试 / 后续页面接入
  window.app = { osuSocket, tokenStore, tournamentState, mapInfo, tournamentData };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* =========================================
   6. Stage 自适应缩放
   ========================================= */

const STAGE_W = 2200;
const STAGE_H = 1080;

function fitStage() {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitStage);
fitStage();