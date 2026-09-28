/**
 * ChatBox —— 全局聊天框（mappool / playing 共享）
 *
 * 列布局（相对 .main，宽 1920）：
 *   0-30    留空
 *   30-120  时间，格式 "10:33 PM"
 *   120-160 留空
 *   160-260 玩家 ID（右对齐，红/蓝/绿三色，过长省略号）
 *   260-270 留空
 *   270-600 聊天信息（左对齐，可换行）
 *   600-1920 留空
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const MAX_CHAT_LINES = 8;

export class ChatBox {
  constructor(root, { tournamentData } = {}) {
    this.root = root;
    this.tournamentData = tournamentData;
    this.listEl = root.querySelector('.chatbox__messages');
    this._lastSig = '';
    this._unsub = null;
    this._blocked = false;
  }

  /* ---------- 生命周期 ---------- */

  mount(osuSocket) {
    if (osuSocket) {
      this._unsub = osuSocket.on('chat', (msgs) => this.render(msgs));
    }
    return this;
  }

  show() {
    if (this._blocked) return;      // 被 block 时，任何 show 都无效
    this.root.classList.add('is-visible');
  }

  hide() {
    this.root.classList.remove('is-visible');
  }

  /* 打图期间用：彻底禁止显示 */
  block() {
    this._blocked = true;
    this.root.classList.remove('is-visible');
  }

  /* 打图结束后用 */
  unblock() {
    this._blocked = false;
  }

  destroy() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  /* ---------- 渲染 ---------- */

  render(messages) {
    if (!this.listEl || !Array.isArray(messages)) return;

    const list = messages.slice(-MAX_CHAT_LINES);

    const getName = m => m.name || m.username || m.user?.name || '';
    const getText = m => m.messageBody || m.message || m.text || m.content || '';

    const sig = list.map(m => `${getName(m)}|${getText(m)}`).join('\n');
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    this.listEl.innerHTML = '';

    for (const m of list) {
      const name = getName(m);
      const text = getText(m);
      const side = this._getPlayerTeamSide(name);

      const row = document.createElement('div');
      row.className = 'chatbox__line';

      const timeEl = document.createElement('span');
      timeEl.className = 'chatbox__time';
      timeEl.textContent = this._formatChatTime(m);

      const nameEl = document.createElement('span');
      nameEl.className = `chatbox__name chatbox__name--${side}`;
      nameEl.textContent = name;
      nameEl.title = name;

      const textEl = document.createElement('span');
      textEl.className = 'chatbox__text';
      textEl.textContent = text;

      row.appendChild(timeEl);
      row.appendChild(nameEl);
      row.appendChild(textEl);
      this.listEl.appendChild(row);
    }
  }

  /* ---------- 工具 ---------- */

  _getPlayerTeamSide(name) {
    if (!name || !this.tournamentData) return 'other';

    let matchId = null;
    try { matchId = Number(localStorage.getItem(CURRENT_MATCH_KEY)); } catch {}
    if (!matchId) return 'other';

    const match = this.tournamentData.getMatch(matchId);
    if (!match) return 'other';

    const inTeam = (acronym) => {
      const team = this.tournamentData.getTeam(acronym);
      return !!team?.players?.some(p => p.username === name);
    };

    if (inTeam(match.team1Acronym)) return 'red';
    if (inTeam(match.team2Acronym)) return 'blue';
    return 'other';
  }

  _formatChatTime(msg) {
    let ts = msg?.timestamp ?? msg?.time ?? msg?.timeMs ?? msg?.date ?? null;
    if (typeof ts === 'number' && ts > 0 && ts < 1e12) ts *= 1000;

    let d;
    if (ts != null) {
      d = new Date(ts);
      if (!Number.isFinite(d.getTime())) d = new Date();
    } else {
      d = new Date();
    }

    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h < 12 ? 'AM' : 'PM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }
}