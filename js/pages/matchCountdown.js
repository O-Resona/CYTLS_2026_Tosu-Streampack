/**
 * Match Info 子页面
 *
 * 从 localStorage['cyt2026.currentMatchId'] 读当前比赛，
 * 在画面中央两侧显示 RED / BLUE TEAM + 队名 + seed + 两名队员。
 */

import { initHaloCrossfade } from '../components/haloCrossfade.js';

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

export function initMatchCountdown({ tournamentData }) {
  const pageEl = document.querySelector('[data-page="match-countdown"]');
  if (!pageEl) return;

  initHaloCrossfade();

  const refs = {
    team1Name:   pageEl.querySelector('#mcTeam1Name'),
    team1Seed:   pageEl.querySelector('#mcTeam1Seed'),
    team1P1:     pageEl.querySelector('#mcTeam1P1'),
    team1P2:     pageEl.querySelector('#mcTeam1P2'),
    team1Avatar: pageEl.querySelector('#mcTeam1Avatar'),
    team2Name:   pageEl.querySelector('#mcTeam2Name'),
    team2Seed:   pageEl.querySelector('#mcTeam2Seed'),
    team2P1:     pageEl.querySelector('#mcTeam2P1'),
    team2P2:     pageEl.querySelector('#mcTeam2P2'),
    team2Avatar: pageEl.querySelector('#mcTeam2Avatar'),
    roundName:   pageEl.querySelector('#mcRoundName'),
  };

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
    imgEl.style.opacity = '0';
    imgEl.alt = base;

    imgEl.onload = () => {
      imgEl.style.opacity = '1';
      imgEl.onload = null;
      imgEl.onerror = null;
    };
    imgEl.onerror = () => {
      imgEl.style.opacity = '0';
      imgEl.onload = null;
      imgEl.onerror = null;
    };

    imgEl.src = `src/ava/${base}.png`;
  }

  function pickCurrentMatch() {
    let idStr;
    try { idStr = localStorage.getItem(CURRENT_MATCH_KEY); }
    catch { return null; }
    if (!idStr) return null;

    const id = Number(idStr);
    if (!Number.isFinite(id)) return null;
    return tournamentData.getMatch(id);
  }

  function renderSide(match, side) {
    const acronym = side === 'left' ? match.team1Acronym : match.team2Acronym;
    const team = acronym ? tournamentData.getTeam(acronym) : null;

    const nameEl = side === 'left' ? refs.team1Name : refs.team2Name;
    const seedEl = side === 'left' ? refs.team1Seed : refs.team2Seed;
    const p1El   = side === 'left' ? refs.team1P1   : refs.team2P1;
    const p2El   = side === 'left' ? refs.team1P2   : refs.team2P2;
    const avEl   = side === 'left' ? refs.team1Avatar : refs.team2Avatar;

    if (nameEl) nameEl.textContent = team?.fullName || acronym || '—';
    if (seedEl) seedEl.textContent = team?.seed ? `#${team.seed}` : '';

    const players = team?.players || [];
    if (p1El) p1El.textContent = players[0]?.username || '';
    if (p2El) p2El.textContent = players[1]?.username || '';

    setAvatar(avEl, team);
  }

  function render() {
    const match = pickCurrentMatch();

    if (!match) {
      reset();
      return;
    }

    if (refs.roundName) {
      const round = tournamentData.getRound(match.roundId);
      refs.roundName.textContent = round?.name || '';
    }

    renderSide(match, 'left');
    renderSide(match, 'right');
  }

  function reset() {
    ['team1Name','team1Seed','team1P1','team1P2'].forEach(k => {
      if (refs[k]) refs[k].textContent = k.includes('Name') ? '—' : '';
    });
    ['team2Name','team2Seed','team2P1','team2P2'].forEach(k => {
      if (refs[k]) refs[k].textContent = k.includes('Name') ? '—' : '';
    });

    if (refs.team1Avatar) { refs.team1Avatar.removeAttribute('src'); refs.team1Avatar.style.opacity = '0'; }
    if (refs.team2Avatar) { refs.team2Avatar.removeAttribute('src'); refs.team2Avatar.style.opacity = '0'; }
    if (refs.roundName) refs.roundName.textContent = '';
  }

  render();

  pageEl.addEventListener('page:activated', render);

  window.addEventListener('storage', (e) => {
    if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) {
      render();
    }
  });
}