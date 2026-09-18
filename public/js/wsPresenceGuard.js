/**
 * wsPresenceGuard.js —— WebSocket 断线自愈：重连后自动重新登记玩家身份
 * （2026-09-18 定位修复）
 *
 * 【问题】A/B 两个页面过一段时间后互相看不见对方移动，只有各自刷新页面才恢复。
 *   服务器把"在线玩家"挂在 connectionId 上（src/websocket/wsServer.js 的
 *   playerPositions），而前端 websocket.js 的自动重连只重建了连接、没有重发
 *   PLAYER_JOIN —— 重连后的连接在服务器眼里是个"幽灵"：
 *     · 它的 POSITION_UPDATE / MODEL_UPDATE / 附近聊天 / 语音 全被服务器忽略
 *       （handlePositionUpdate 里 if (playerPositions.has(connectionId)) 直接跳过）
 *       → 对方看不到我移动；
 *     · 服务器只在 PLAYER_JOIN 时回 WORLD_STATE，幽灵连接拿不到名册；
 *     · 对方会因为我原连接 close 收到 PLAYER_LEFT，把我的角色整个删掉，且不再重建。
 *   服务器是"每连接"登记，所以有连接的一方重新登记后只能被对方看到，不会自动
 *   看到对方 → 表现就是"必须 AB 各自刷新页面"。
 *   触发场景：服务器重启、笔记本休眠/网络切换、代理/NAT 空闲断链、后台标签页被
 *   浏览器冻结导致协议层 ping 无 pong 被服务器心跳 terminate。
 *
 * 【本模块】全部为对 WSClient 的包装，不修改 websocket.js：
 *   1. 缓存 PLAYER_JOIN（并合并后续 MODEL_UPDATE），每次连接建立后自动重发 → 身份自愈；
 *   2. 无限重连（指数退避、上限 30s）——原实现 5 次后彻底放弃，服务器重启久一点就永久失联；
 *   3. 应用层探活（PING/PONG）+ 静默看门狗：半开连接（onclose 不触发）也能被发现并重连；
 *      服务器不支持 PING（旧版本）时自动降级为被动检测，不做无谓重连；
 *   4. WORLD_STATE 视为权威名册，清理断线期间对方离线留下的本地残留角色。
 *
 * 依赖：window.WSClient（websocket.js）、window.CONFIG、window.GAME_STATE、window.gameWorld
 */
(function () {
  'use strict';

  var WS = window.WSClient;
  if (!WS || typeof WS.send !== 'function') return; // websocket.js 未加载

  var PROBE_MS = 25000;       // 静默超过该时长 → 发一次应用层探活
  var TICK_MS = 15000;        // 看门狗节奏
  var SILENCE_LIMIT = 90000;  // 探活可用时：静默超时 → 判定链路已死
  var MAX_DELAY = 30000;      // 重连退避上限
  var OPEN = 1;

  var st = {
    join: null,          // 最后一次 PLAYER_JOIN payload（合并 MODEL_UPDATE）
    lastIn: Date.now(),  // 最后一次收到下行数据
    probes: 0,
    pongs: 0,
    probeSupported: null, // null 未知 / true 支持 / false 旧服务器
    lastProbeAt: 0,
    retryTimer: null,
    inFlight: false,
    attempts: 0
  };

  function openState() { return WS.ws ? WS.ws.readyState : -1; }
  function r2(v) { return Math.round(v * 100) / 100; }

  /** 当前真实位置（重连登记时用，避免用掉线前的旧坐标复活） */
  function currentPos() {
    var p = window.player && window.player.position;
    if (!p || typeof p.x !== 'number') return null;
    return { x: r2(p.x), y: r2(p.y), z: r2(p.z) };
  }

  function copy(obj) {
    var o = {};
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k]; }
    return o;
  }

  // ─────────── 1. 缓存身份信息（PLAYER_JOIN / MODEL_UPDATE） ───────────
  var origSend = WS.send.bind(WS);
  WS.send = function (message) {
    try {
      if (message && message.type === 'PLAYER_JOIN' && message.payload) {
        st.join = copy(message.payload);
      } else if (message && message.type === 'MODEL_UPDATE' && message.payload && st.join &&
                 message.payload.characterId === st.join.characterId) {
        if (message.payload.glbUrl) st.join.glbUrl = message.payload.glbUrl;
        if (message.payload.animUrls) st.join.animUrls = message.payload.animUrls;
        if (message.payload.isSelfContainedBundle !== undefined) {
          st.join.isSelfContainedBundle = message.payload.isSelfContainedBundle;
        }
      }
    } catch (e) { /* 缓存失败不影响发送 */ }

    // 原实现只判 connected 布尔：socket 处于 CONNECTING/CLOSING/CLOSED 时
    // ws.send 会抛 "WebSocket is already in CLOSING or CLOSED state."，这里改为入队等重连补发
    if (openState() !== OPEN) {
      try {
        if (WS.messageQueue.length > 300) WS.messageQueue.shift(); // 长断线时防止无界堆积
        WS.messageQueue.push(message);
      } catch (e) {}
      return;
    }
    return origSend(message);
  };

  // ─────────── 2. 连接建立后自动重新登记（身份自愈） ───────────
  // onopen 里调用的是 this.flushMessageQueue()，包装它即可覆盖首次连接与所有重连
  var origFlush = WS.flushMessageQueue.bind(WS);
  WS.flushMessageQueue = function () {
    if (st.join && openState() === OPEN) {
      try {
        var payload = copy(st.join);
        var pos = currentPos();
        if (pos) payload.position = pos;
        WS.ws.send(JSON.stringify({ type: 'PLAYER_JOIN', payload: payload }));
        console.log('[WSGuard] 连接建立 → 自动重新登记玩家身份:', payload.characterId);
      } catch (e) {
        console.warn('[WSGuard] 重新登记失败:', e && e.message);
      }
    }
    return origFlush();
  };

  // ─────────── 3. 无限重连（原实现 5 次后永久放弃） ───────────
  function doConnect() {
    st.retryTimer = null;
    if (WS.connected && openState() === OPEN) { st.attempts = 0; return; }
    st.inFlight = true;
    WS.connect(CONFIG.WS_URL).then(function () {
      st.inFlight = false;
      st.attempts = 0;
    }).catch(function () {
      st.inFlight = false;
      WS.attemptReconnect();
    });
  }

  WS.attemptReconnect = function () {
    if (st.retryTimer || st.inFlight) return; // 已在重连流程中，去重（onerror/onclose 会双触发）
    st.attempts++;
    var delay = Math.min(MAX_DELAY, 1000 * Math.pow(2, Math.min(st.attempts, 5)));
    st.retryTimer = setTimeout(doConnect, delay);
  };

  // ─────────── 4. 应用层探活 + 静默看门狗 ───────────
  var origHandle = WS.handleMessage.bind(WS);
  WS.handleMessage = function (data) {
    st.lastIn = Date.now();
    if (data && data.type === 'PONG') {
      st.pongs++;
      if (st.probeSupported !== true) {
        st.probeSupported = true;
        console.log('[WSGuard] 应用层探活已启用（链路半开可被自动发现）');
      }
      return; // PONG 无需进入业务分发（否则会打 "Unknown message type: PONG"）
    }
    return origHandle(data);
  };

  function probe() { st.probes++; WS.send({ type: 'PING', payload: { t: Date.now() } }); }

  function forceReconnect(why) {
    console.warn('[WSGuard] 强制重连：' + why);
    try { WS.connected = false; } catch (e) {}
    try { if (WS.ws) WS.ws.close(); } catch (e) {}
    WS.attemptReconnect();
  }

  setInterval(function () {
    // 兜底：未连接且没有任何重连计划 → 补一次（无论之前因何中断）
    if (!WS.connected) {
      // 旧 socket 的 onclose 晚到会把新连接误标为断开（websocket.js 的 connected 是类级
      // 标志，close 回调不区分是哪条 socket）；这里按真实 readyState 纠正，避免空建连接
      if (openState() === OPEN) { WS.connected = true; return; }
      if (!st.retryTimer && !st.inFlight) WS.attemptReconnect();
      return;
    }
    // 连接期间固定周期发一次探活（25s 一条，成本可忽略），
    // 服务器会回 PONG —— 半开连接时探活与 PONG 都石沉大海
    if (Date.now() - st.lastProbeAt >= PROBE_MS) {
      st.lastProbeAt = Date.now();
      probe();
    }
    // 连发 3 次探活都没有 PONG → 旧版本服务器，降级为被动检测（不做无谓重连）
    if (st.probeSupported === null && st.probes >= 3 && st.pongs === 0) {
      st.probeSupported = false;
      console.log('[WSGuard] 服务器未响应探活（旧版本），降级为被动检测');
    }
    var silence = Date.now() - st.lastIn;
    if (st.probeSupported === true && silence > SILENCE_LIMIT) {
      forceReconnect('链路静默 ' + Math.round(silence / 1000) + 's 无任何下行数据');
    }
  }, TICK_MS);

  // 回到前台 / 网络恢复：立刻补一次判断（后台期间看门狗被浏览器节流）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !WS.connected) return;
    var silence = Date.now() - st.lastIn;
    if (st.probeSupported === true && silence > SILENCE_LIMIT) {
      forceReconnect('回到前台发现链路已静默 ' + Math.round(silence / 1000) + 's');
    } else if (st.probeSupported !== false && silence > PROBE_MS) {
      probe();
    }
  });
  window.addEventListener('online', function () {
    if (!WS.connected) WS.attemptReconnect();
  });

  // ─────────── 5. WORLD_STATE 是服务器权威名册：清理本地残留角色 ───────────
  // （断线期间对方离线，我收不到 PLAYER_LEFT，只会在本地留一个不动的"僵尸分身"；
  //   服务器在 PLAYER_JOINED 之前就登记好节点，快照与广播同链路有序，剪除是安全的）
  var origWorldState = WS.handleWorldState.bind(WS);
  WS.handleWorldState = function (payload) {
    var r = origWorldState(payload);
    try {
      if (payload && Array.isArray(payload.players) && window.gameWorld && window.gameWorld.players) {
        var alive = new Set();
        payload.players.forEach(function (p) { if (p) alive.add(p.characterId); });
        var selfId = window.GAME_STATE && window.GAME_STATE.characterId;
        var stale = [];
        window.gameWorld.players.forEach(function (pd, cid) {
          if (cid !== selfId && !alive.has(cid)) stale.push(cid);
        });
        stale.forEach(function (cid) {
          console.log('[WSGuard] 名册同步：清理已离线的残留角色', cid);
          window.gameWorld.removePlayer(cid);
        });
      }
    } catch (e) { /* 名册同步失败不影响主流程 */ }
    return r;
  };

  window.WSPresenceGuard = {
    _probe: probe,   // 供诊断/验收手动触发一次探活
    _diag: function () {
      return {
        registered: !!st.join,
        characterId: st.join ? st.join.characterId : null,
        connected: WS.connected,
        readyState: openState(),
        reconnectAttempts: st.attempts,
        probeSupported: st.probeSupported,
        probes: st.probes,
        pongs: st.pongs,
        silenceMs: Date.now() - st.lastIn
      };
    }
  };
})();
