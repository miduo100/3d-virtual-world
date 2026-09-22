/**
 * waiter.js — 消息等待原语（从客户端主流程里剥出来的"等回执 / 等某类消息"）
 *
 * 两个关键点，改动前先读：
 *   ① **recent 缓冲**：READY 可能在我们挂 waiting 之前就到了（服务端在 upgrade 后立刻发），
 *      所以 watchType 先查最近收到的消息，再挂等待者 —— 否则会假超时。
 *   ② **回执可能多次到达**：walk_to 先 ACTION_ACCEPTED、几秒后才 ACTION_COMPLETED（异步补发），
 *      所以 slot 保留全部回执，允许多次 watch 同一个 requestId。
 */
export class MessageBus {
  constructor() {
    this.recent = [];
    this.slots = new Map();        // requestId -> { list, waiters, at }
    this.typeWaiters = new Map();  // msgType -> [fn]
    this.maxRecent = 30;
    this.maxSlots = 60;
    this.slotTtlMs = 120000;
  }

  /** 新连接建立时清空 recent（避免读到上一条连接的 READY） */
  reset() {
    this.recent = [];
  }

  ingest(msg) {
    this.recent.push(msg);
    if (this.recent.length > this.maxRecent) this.recent.shift();

    const p = msg.payload || {};
    if (p.requestId) {
      const slot = this.slots.get(p.requestId);
      if (slot) {
        slot.list.push(msg);
        for (const w of slot.waiters.slice()) w(msg);
      }
    }

    const waiters = this.typeWaiters.get(msg.type);
    if (waiters && waiters.length) {
      const w = waiters.shift();
      if (waiters.length === 0) this.typeWaiters.delete(msg.type);
      w(msg);
    }
  }

  slot(requestId) {
    let slot = this.slots.get(requestId);
    if (!slot) {
      slot = { list: [], waiters: [], at: Date.now() };
      this.slots.set(requestId, slot);
      if (this.slots.size > this.maxSlots) {
        const cutoff = Date.now() - this.slotTtlMs;
        for (const [k, v] of this.slots) if (v.at < cutoff) this.slots.delete(k);
      }
    }
    return slot;
  }

  /** 等某个 requestId 的某几类回执（已有则立即返回；超时返回 null） */
  watch(requestId, types, timeoutMs) {
    const slot = this.slot(requestId);
    return new Promise((resolve) => {
      const immediate = slot.list.find((m) => types.includes(m.type));
      if (immediate) return resolve(immediate);
      let done = false;
      const waiter = (m) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const i = slot.waiters.indexOf(waiter);
        if (i >= 0) slot.waiters.splice(i, 1);
        resolve(m);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const i = slot.waiters.indexOf(waiter);
        if (i >= 0) slot.waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      slot.waiters.push(waiter);
    });
  }

  /** 等某一类服务端消息（READY / SUBSCRIBED / PONG / ERROR ...） */
  watchType(type, timeoutMs) {
    const hit = this.recent.find((m) => m.type === type);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const list = this.typeWaiters.get(type) || [];
      let done = false;
      const waiter = (m) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const i = list.indexOf(waiter);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.typeWaiters.delete(type);
        resolve(m);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const i = list.indexOf(waiter);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.typeWaiters.delete(type);
        resolve(null);
      }, timeoutMs);
      list.push(waiter);
      this.typeWaiters.set(type, list);
    });
  }

  /** 连接断开时唤醒所有等待者（避免工具调用挂到超时） */
  failAll(reason) {
    for (const list of this.typeWaiters.values()) {
      for (const w of list.slice()) w({ type: 'DISCONNECTED', payload: { reason } });
    }
    this.typeWaiters.clear();
  }
}
