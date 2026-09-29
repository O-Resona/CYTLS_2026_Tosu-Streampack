/**
 * ChatBox —— 全局聊天框（mappool / playing 共享）
 *
 * 列布局（相对 .main，宽 1920）：
 *   0-30    留空
 *   30-140  时间，格式 "HH:MM:SS AM/PM"
 *   140-160 留空
 *   160-280 玩家 ID（右对齐，红/蓝/绿三色，过长省略号）
 *   280-290 留空
 *   290-630 聊天信息（左对齐，可换行）
 *   630-1920 留空
 *
 * 支持：滚轮翻页、鼠标拖动（在滚动容器上按住鼠标左键上下拖）。
 */

const CURRENT_MATCH_KEY = 'cyt2026.currentMatchId';
const MAX_CHAT_LINES    = 50;   /* 保留最近 50 条 */
const STICK_THRESHOLD   = 30;   /* 距底部 30px 内视为「跟随最新」 */

export class ChatBox {
  constructor(root, { tournamentData } = {}) {
    this.root = root;
    this.tournamentData = tournamentData;
    this.listEl = root.querySelector('.chatbox__messages');
    this._lastSig = '';
    this._unsub = null;
    this._blocked = false;

    this._drag = null;
    this._dragInited = false;

    this._onMouseDown = null;
    this._onMouseMove = null;
    this._onMouseUp   = null;
  }

  /* ---------- 生命周期 ---------- */

  mount(osuSocket) {
    if (osuSocket) {
      this._unsub = osuSocket.on('chat', (msgs) => this.render(msgs));
    }
    this._initDrag();
    return this;
  }

  show() {
    if (this._blocked) return;
    this.root.classList.add('is-visible');
  }

  hide() {
    this.root.classList.remove('is-visible');
  }

  block() {
    this._blocked = true;
    this.root.classList.remove('is-visible');
  }

  unblock() {
    this._blocked = false;
  }

  destroy() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this._removeDrag();
  }

  /* ---------- 拖动 / 滚轮 ---------- */

  _initDrag() {
    if (!this.listEl || this._dragInited) return;
    this._dragInited = true;

    const el = this.listEl;

    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (el.scrollHeight <= el.clientHeight) return;  /* 不可滚 → 不启动拖动 */
      this._drag = { startY: e.clientY, startTop: el.scrollTop };
      el.classList.add('is-dragging');
      e.preventDefault();                              /* 阻止文本选中 */
    };

    this._onMouseMove = (e) => {
      if (!this._drag) return;
      const dy = e.clientY - this._drag.startY;
      el.scrollTop = this._drag.startTop - dy;
    };

    this._onMouseUp = () => {
      if (!this._drag) return;
      this._drag = null;
      el.classList.remove('is-dragging');
    };

    el.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _removeDrag() {
    if (!this.listEl || !this._dragInited) return;
    this.listEl.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this._dragInited = false;
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

    const el = this.listEl;

    /* 判断是否「跟随最新」：是否在底部附近 */
    const wasAtBottom =
      (el.scrollHeight - el.scrollTop - el.clientHeight) < STICK_THRESHOLD;

    el.innerHTML = '';

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
      el.appendChild(row);
    }

    /* 首次渲染或用户在底部 → 滚到最新 */
    if (wasAtBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
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

    const norm = s => String(s ?? '').trim().toLowerCase();

    const inTeam = (acronym) => {
      const team = this.tournamentData.getTeam(acronym);
      return !!team?.players?.some(p => norm(p.username) === norm(name));
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
    const s = String(d.getSeconds()).padStart(2, '0');
    const ampm = h < 12 ? 'AM' : 'PM';
    h = h % 12;
    if (h === 0) h = 12;
    const hh = String(h).padStart(2, '0');

    return `${hh}:${m}:${s} ${ampm}`;
  }
}