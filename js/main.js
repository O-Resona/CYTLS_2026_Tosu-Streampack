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
import { initPlaying }           from './pages/playing.js';
import { initBracket }           from './pages/bracket.js';
import { initSchedule }          from './pages/schedule.js';
import { initWinner }            from './pages/winner.js';
import { TeamHud }               from './components/teamHud.js';
import { ChatBox } from './components/chatBox.js';
import { LogoBadge } from './components/logoBadge.js';
import { WinnerWatcher } from './services/winnerWatcher.js'; 

/* =========================================
   1. 创建服务实例
   ========================================= */

const osuSocket       = new OsuSocket(`ws://${location.host}/ws`);
const tokenStore      = new TokenStore();
const tournamentState = new TournamentState();
const mapInfo         = new MapInfo(tokenStore);
const tournamentData  = new TournamentData();

/* teamHud 是全局单例，先声明，boot() 里赋值 */
let teamHud = null;
let chatBox = null;
let logoBadge = null; 

/* =========================================
   2. 接线：osu 消息 → store
   ========================================= */

osuSocket.on('tokens',   tokens => tokenStore.updateBulk(tokens));
osuSocket.on('ipcState', state  => tournamentState.setIpcState(state));
osuSocket.connect();

/* =========================================
   3. 页面注册表
   ========================================= */

const pages = {
  'bracket': {
    html: 'pages/bracket.html',
    init: () => initBracket({ tournamentData }),
    bg: 'alt',
  },
  'schedule': {
    html: 'pages/schedule.html',
    init: () => initSchedule({ tournamentData }),
    bg: 'alt',
  },
  'match-countdown': {
    html: 'pages/match-countdown.html',
    init: () => initMatchCountdown({ tournamentData }),
    bg: 'alt',
  },
  'mappool': {
    html: 'pages/mappool.html',
    init: () => initMappool({ tournamentData, osuSocket, tokenStore }),
    bg: 'alt',
    hud: true,
    logoBadge: true,
  },
  'playing': {
    html: 'pages/playing.html',
    init: () => initPlaying({
      tokenStore, tournamentState, mapInfo, tournamentData, osuSocket, teamHud, chatBox
    }),
    hud: true,
    logoBadge: true,
  },
  'winner': {
    html: 'pages/winner.html',
    init: () => initWinner({ tournamentData }),
    bg: 'alt',
    logoBadge: true,
  },
  'showcase-countdown': {
    html: 'pages/showcase-countdown.html',
    init: () => initShowcaseCountdown({ tournamentData }),
    video: 'alt2',
    bg: 'third',
  },
  'showcase': {
    html: 'pages/showcase.html',
    init: () => initShowcase({ mapInfo, tokenStore, tournamentState, tournamentData }),
  },
};

/* =========================================
   4. 全局背景视频
   ========================================= */

function initBgVideo() {
  const videos = document.querySelectorAll('.global-bg-video');
  if (!videos.length) return;

  videos.forEach(video => {
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

  /* 预加载 SourceHanSerif，避免 showcase-countdown 首次进入时字体闪烁 */
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('900 100px "SourceHanSerif"'),
      document.fonts.load('700 28px "SourceHanSerif"'),
      document.fonts.load('400 100px "SourceHanSerif"'),
    ]).catch(() => {});
  }

  await tournamentData.init();

  initBgVideo();

  const hudEl = document.getElementById('globalHud');
  teamHud = hudEl ? new TeamHud(hudEl, { tournamentData }) : null;

  const chatEl = document.getElementById('globalChatBox');
  chatBox = chatEl ? new ChatBox(chatEl, { tournamentData }) : null;
  chatBox?.mount(osuSocket);

  const logoEl = document.getElementById('globalLogo');
  logoBadge = logoEl ? new LogoBadge(logoEl, { tournamentData }) : null;

  const router = createRouter({
    pages,
    deps: { osuSocket, tokenStore, tournamentState, mapInfo, tournamentData, teamHud, chatBox , logoBadge }
  });

  const winnerWatcher = new WinnerWatcher({ tournamentData, router });
  winnerWatcher.start(); 

  window.app = {
    osuSocket, tokenStore, tournamentState, mapInfo, tournamentData,
    router, teamHud, chatBox, logoBadge, winnerWatcher,
  };
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