/**
 * ReconnectingWebSocket —— 极简断线重连 WebSocket
 *
 * 只实现本项目需要的功能：
 *   - 断线后指数退避重连
 *   - onopen / onclose / onerror / onmessage 事件
 *   - send / close / readyState
 */
export class ReconnectingWebSocket {
  constructor(url, protocols, options = {}) {
    this.url = url;
    this.protocols = protocols;

    this.minDelay = options.minDelay ?? 1000;   // 首次重连延迟 1s
    this.maxDelay = options.maxDelay ?? 30000;  // 最大延迟 30s
    this.decay    = options.decay    ?? 1.5;    // 每次乘 1.5

    this._retries = 0;
    this._forcedClose = false;
    this._ws = null;
    this._reconnectTimer = null;

    // 事件回调（由外部赋值）
    this.onopen    = null;
    this.onclose   = null;
    this.onerror   = null;
    this.onmessage = null;

    this._connect();
  }

  /* 与原生 WebSocket 一致的只读属性 */
  get readyState() { return this._ws ? this._ws.readyState : WebSocket.CLOSED; }

  _connect() {
    this._ws = new WebSocket(this.url, this.protocols);

    this._ws.onopen = (e) => {
      this._retries = 0;
      this.onopen && this.onopen(e);
    };

    this._ws.onmessage = (e) => {
      this.onmessage && this.onmessage(e);
    };

    this._ws.onerror = (e) => {
      this.onerror && this.onerror(e);
    };

    this._ws.onclose = (e) => {
      this.onclose && this.onclose(e);
      if (!this._forcedClose) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;

    const delay = Math.min(
      this.maxDelay,
      this.minDelay * Math.pow(this.decay, this._retries)
    );
    this._retries++;

    console.log(`[WS] 将在 ${Math.round(delay)}ms 后重连（第 ${this._retries} 次）`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._forcedClose) this._connect();
    }, delay);
  }

  send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(data);
    } else {
      console.warn('[WS] 连接未就绪，send 被忽略');
    }
  }

  close(code, reason) {
    this._forcedClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) this._ws.close(code, reason);
  }
}