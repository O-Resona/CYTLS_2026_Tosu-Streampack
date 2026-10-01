/**
 * TeamHud —— 全局队伍 HUD（头像 / 标签 / 星星 / 队名 / seed）
 *
 * 星星数 = match.team1Score / match.team2Score（直接从 tournamentData 读）
 * 点击星星 = 修改 match 比分（写入 override，同步到 bracket 等页面）
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const OVERRIDE_KEY      = 'cyt2026.matchOverrides';

export class TeamHud {
  constructor(root, { tournamentData }) {
    this.root = root;
    this.tournamentData = tournamentData;

    this.refs = {
      team1Name:   root.querySelector('#ghTeam1Name'),
      team2Name:   root.querySelector('#ghTeam2Name'),
      team1Seed:   root.querySelector('#ghTeam1Seed'),
      team2Seed:   root.querySelector('#ghTeam2Seed'),
      team1Avatar: root.querySelector('#ghTeam1Avatar'),
      team2Avatar: root.querySelector('#ghTeam2Avatar'),
      team1Stars:  root.querySelector('#ghTeam1Stars'),
      team2Stars:  root.querySelector('#ghTeam2Stars'),
    };

    this.match = null;
    this.maxStars = 5;

    window.addEventListener('storage', (e) => {
      if (e.key === CURRENT_MATCH_KEY || e.key === OVERRIDE_KEY) {
        this.refresh();
      }
    });
  }

  /* ---------- 显隐 ---------- */

  show() { this.root.classList.add('is-visible'); this.refresh(); }
  hide() { this.root.classList.remove('is-visible'); }

  /* ---------- 内部工具 ---------- */

  _getMatchId() {
    try {
      const v = localStorage.getItem(CURRENT_MATCH_KEY);
      return v ? Number(v) : null;
    } catch { return null; }
  }

  _setAvatar(imgEl, team) {
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

  /* ---------- 星星 = match 比分 ---------- */

  _readStars(matchId) {
    const m = this.tournamentData?.getMatch(matchId);
    return {
      left:  Math.max(0, Number(m?.team1Score) || 0),
      right: Math.max(0, Number(m?.team2Score) || 0),
    };
  }

  _writeStars(matchId, stars) {
    if (!this.tournamentData || matchId == null) return;
    this.tournamentData.setMatchOverride(matchId, {
      team1Score: stars.left,
      team2Score: stars.right,
    });
  }

  _renderStars(container, filled, side) {
    if (!container) return;

    let stars = container.querySelectorAll('.global-hud__star');

    /* 结构不存在 / 数量不匹配 → 重建 */
    if (stars.length !== this.maxStars) {
      container.innerHTML = '';
      for (let i = 0; i < this.maxStars; i++) {
        const box = document.createElement('span');
        box.className = 'global-hud__star';
        box.addEventListener('click', (e) => {
          e.preventDefault();
          this._adjustStar(side, +1);
        });
        box.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._adjustStar(side, -1);
        });
        container.appendChild(box);
      }
      stars = container.querySelectorAll('.global-hud__star');
    }

    /* 只切换 class，不重建，让 transition / animation 生效 */
    stars.forEach((box, i) => {
      const shouldActive = i < filled;
      if (box.classList.contains('is-active') !== shouldActive) {
        box.classList.toggle('is-active', shouldActive);
      }
    });
  }

  _adjustStar(side, delta) {
    if (!this.match) return;
    const id = this.match.id;
    const stars = this._readStars(id);
    if (side === 'left') stars.left  = Math.max(0, Math.min(this.maxStars, stars.left  + delta));
    else                 stars.right = Math.max(0, Math.min(this.maxStars, stars.right + delta));

    this._writeStars(id, stars);
    this._renderStars(this.refs.team1Stars, stars.left,  'left');
    this._renderStars(this.refs.team2Stars, stars.right, 'right');

    /* 本地 match 对象也要更新（供后续 incrementStar 用） */
    this.match.team1Score = stars.left;
    this.match.team2Score = stars.right;
  }

  /* 供 playing.js 在结算时自动加星 */
  incrementStar(side) {
    if (!this.match) return;
    const id = this.match.id;
    const stars = this._readStars(id);

    if (side === 'left') {
      if (stars.left >= this.maxStars) return;
      stars.left++;
    } else {
      if (stars.right >= this.maxStars) return;
      stars.right++;
    }

    this._writeStars(id, stars);
    this._renderStars(this.refs.team1Stars, stars.left,  'left');
    this._renderStars(this.refs.team2Stars, stars.right, 'right');

    this.match.team1Score = stars.left;
    this.match.team2Score = stars.right;
  }

  /* ---------- 刷新 ---------- */

  refresh() {
    const id = this._getMatchId();

    if (id == null) {
      this.match = null;
      this._clearAll();
      return;
    }

    const match = this.tournamentData.getMatch(id);
    if (!match) {
      this.match = null;
      this._clearAll();
      return;
    }

    /* 同一场 + 队未变 → 只重绘星星（响应比分变化） */
    if (this.match
        && this.match.id === match.id
        && this.match.team1Acronym === match.team1Acronym
        && this.match.team2Acronym === match.team2Acronym) {
      const stars = this._readStars(id);
      this._renderStars(this.refs.team1Stars, stars.left,  'left');
      this._renderStars(this.refs.team2Stars, stars.right, 'right');
      return;
    }

    /* 完整重绘 */
    this.match = match;

    const t1 = match.team1Acronym ? this.tournamentData.getTeam(match.team1Acronym) : null;
    const t2 = match.team2Acronym ? this.tournamentData.getTeam(match.team2Acronym) : null;

    if (this.refs.team1Name) this.refs.team1Name.textContent = t1?.fullName || match.team1Acronym || '—';
    if (this.refs.team2Name) this.refs.team2Name.textContent = t2?.fullName || match.team2Acronym || '—';

    if (this.refs.team1Seed) this.refs.team1Seed.textContent = t1?.seed ? `#${t1.seed}` : '';
    if (this.refs.team2Seed) this.refs.team2Seed.textContent = t2?.seed ? `#${t2.seed}` : '';

    this._setAvatar(this.refs.team1Avatar, t1);
    this._setAvatar(this.refs.team2Avatar, t2);

    const round = this.tournamentData.getRound(match.roundId);
    const bestOf = Number(round?.bestOf) || 9;
    this.maxStars = Math.ceil(bestOf / 2);

    const stars = this._readStars(id);
    this._renderStars(this.refs.team1Stars, stars.left,  'left');
    this._renderStars(this.refs.team2Stars, stars.right, 'right');
  }

  _clearAll() {
    if (this.refs.team1Name) this.refs.team1Name.textContent = '—';
    if (this.refs.team2Name) this.refs.team2Name.textContent = '—';
    if (this.refs.team1Seed) this.refs.team1Seed.textContent = '';
    if (this.refs.team2Seed) this.refs.team2Seed.textContent = '';
    if (this.refs.team1Stars) this.refs.team1Stars.innerHTML = '';
    if (this.refs.team2Stars) this.refs.team2Stars.innerHTML = '';
    this._setAvatar(this.refs.team1Avatar, null);
    this._setAvatar(this.refs.team2Avatar, null);
  }

  forceRefresh() {
    this.match = null;
    this.refresh();
  }
}