/**
 * Winner 子页面
 *
 * 直接读当前比赛（cyt2026.currentMatchId）的比分判定胜者：
 *   - 任一方比分 >= ceil(bestOf/2) 且领先 → 该方为胜者
 *   - 否则页面不显示额外内容（仅背景）
 *
 * 展示格式与 Match Info 一致。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

export function initWinner({ tournamentData } = {}) {
  const pageEl = document.querySelector('[data-page="winner"]');
  if (!pageEl) return;

  const layoutEl = pageEl.querySelector('#wcLayout');
  const refs = {
    avatar: pageEl.querySelector('#wcAvatar'),
    tag:    pageEl.querySelector('#wcTag'),
    name:   pageEl.querySelector('#wcName'),
    seed:   pageEl.querySelector('#wcSeed'),
    p1:     pageEl.querySelector('#wcP1'),
    p2:     pageEl.querySelector('#wcP2'),
  };

  /* ---------- 头像：jpg / png 兜底 ---------- */

  function setAvatar(imgEl, team) {
    if (!imgEl) return;
    if (!team?.acronym) {
      imgEl.removeAttribute('src');
      imgEl.style.opacity = '0';
      imgEl.onload = null;
      imgEl.onerror = null;
      return;
    }

    const base = team.acronym;
    const candidates = [`src/ava/${base}.jpg`, `src/ava/${base}.png`];

    imgEl.style.opacity = '0';
    imgEl.alt = base;

    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        imgEl.style.opacity = '0';
        imgEl.onload = null;
        imgEl.onerror = null;
        return;
      }
      const path = candidates[i++];
      imgEl.onerror = () => tryNext();
      imgEl.onload = () => {
        imgEl.style.opacity = '1';
        imgEl.onload = null;
        imgEl.onerror = null;
      };
      imgEl.src = path;
    };
    tryNext();
  }

  /* ---------- 读取 ---------- */

  function getCurrentMatch() {
    try {
      const idStr = localStorage.getItem(CURRENT_MATCH_KEY);
      if (!idStr) return null;
      const id = Number(idStr);
      if (!Number.isFinite(id)) return null;
      return tournamentData?.getMatch(id) || null;
    } catch { return null; }
  }

  /* 返回 { team, side } 或 null */
  function resolveWinner(match) {
    if (!match || !tournamentData) return null;

    const round = tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    const maxStars = Math.ceil(bestOf / 2);

    const s1 = Number(match.team1Score) || 0;
    const s2 = Number(match.team2Score) || 0;

    let acronym = '';
    let side = '';
    if (s1 >= maxStars && s1 > s2) {
      acronym = match.team1Acronym;
      side = 'red';
    } else if (s2 >= maxStars && s2 > s1) {
      acronym = match.team2Acronym;
      side = 'blue';
    }
    if (!acronym) return null;

    const team = tournamentData.getTeam(acronym);
    if (!team) return null;

    return { team, side };
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const match = getCurrentMatch();
    const result = resolveWinner(match);

    if (!result) { reset(); return; }

    const { team, side } = result;
    const isRed = side === 'red';

    if (refs.tag) {
      refs.tag.textContent = isRed ? 'team red' : 'team blue';
      refs.tag.classList.toggle('wc-tag--red',  isRed);
      refs.tag.classList.toggle('wc-tag--blue', !isRed);
    }

    if (refs.name) refs.name.textContent = team.fullName || team.acronym;
    if (refs.seed) refs.seed.textContent = team.seed ? `#${team.seed}` : '';

    const players = team.players || [];
    if (refs.p1) refs.p1.textContent = players[0]?.username || '';
    if (refs.p2) refs.p2.textContent = players[1]?.username || '';

    setAvatar(refs.avatar, team);

    if (layoutEl) layoutEl.hidden = false;
  }

  function reset() {
    if (layoutEl) layoutEl.hidden = true;
    if (refs.name) refs.name.textContent = '—';
    if (refs.seed) refs.seed.textContent = '';
    if (refs.p1)   refs.p1.textContent = '';
    if (refs.p2)   refs.p2.textContent = '';
    if (refs.avatar) {
      refs.avatar.removeAttribute('src');
      refs.avatar.style.opacity = '0';
    }
  }

  /* ---------- 启动 ---------- */

  render();

  pageEl.addEventListener('page:activated', render);

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) render();
  });
}