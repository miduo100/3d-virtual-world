/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundRuntime.js —— 场景声源运行时（S3）
 *
 * 让 ② 模型声源里配好的声音，在游戏里真的响起来：
 *   进入半径 → 淡入播放；走出半径 → 淡出销毁；按距离衰减；同时发声有上限。
 *
 * 设计约束（重要）：
 *   1. 不改 world.js（已 9108 行，超红线）。本文件自己起一个 200ms 的循环，
 *      从 window.gameWorld 上读相机与物件位置，world.js 完全不知道它的存在。
 *   2. 复用 soundManager 的 AudioContext 与 sfx 总线（项目已有 4 个 ctx，不能再加）。
 *   3. 没配声音时不产生任何开销：configs 为空直接返回。
 *   4. 任何一步失败都静默降级，绝不影响主线程与渲染。
 *
 * 数据来源：GET /api/sound-scenes/objects?hasAudio=1（只拉挂了声音的物件，通常个位数）
 * 物件位置：从 scene 里按 userData.worldObjectId 匹配（world.js 给每个物件打了这个标）
 */
(function () {
  'use strict';

  var S = {
    ctx: null,
    bus: null,
    configs: [],       // [{ id, audio:{url,radius,minDist,volume,loop,falloff} }]
    positions: {},     // 'id' -> {x,y,z}
    active: {},        // 'id' -> { src, gain, panner, url }
    buffers: {},       // url -> AudioBuffer
    maxConcurrent: 8,
    tickMs: 200,
    timer: null,
    running: false,
    lastPosScan: 0,
    enabled: true
  };

  function log() {
    if (!S.enabled) return;
    console.log.apply(console, ['[SoundRuntime]'].concat([].slice.call(arguments)));
  }

  // ─── 上下文 ─────────────────────────────────────────────────

  function pickCtx() {
    var sm = window.soundManager;
    if (!sm || typeof sm.getContext !== 'function') return false;
    if (typeof sm.isUnlocked === 'function' && !sm.isUnlocked()) return false;
    var ctx = sm.getContext();
    if (!ctx) return false;
    S.ctx = ctx;
    S.bus = (typeof sm.getSfxGain === 'function') ? sm.getSfxGain() : null;
    return true;
  }

  // ─── 配置 ───────────────────────────────────────────────────

  async function loadConfigs() {
    try {
      // 公开只读接口（玩家页面无管理员 token），只返回 id + audio
      var r = await fetch('/api/sound-scenes/audio-sources');
      if (!r.ok) return;
      var d = await r.json();
      var items = (d.sources || []).filter(function (x) {
        return x.audio && (x.audio.url || (x.audio.layers && x.audio.layers.length));
      });
      // 只支持单文件音源（layers 留给后续）
      S.configs = items.filter(function (x) { return x.audio.url; }).map(function (x) {
        var a = x.audio;
        return {
          id: String(x.id),
          name: x.name || '',
          audio: {
            url: a.url,
            radius: num(a.radius, 15, 1, 300),
            minDist: num(a.minDist, 1, 0, 100),
            volume: num(a.volume, 0.7, 0, 1),
            loop: a.loop !== false,
            falloff: a.falloff === 'linear' ? 'linear' : 'inverse'
          }
        };
      });
      log('配置已加载:', S.configs.length, '个物件挂了声音');
    } catch (e) {
      log('配置加载失败（忽略）:', e.message);
    }
  }

  function num(v, def, min, max) {
    var n = parseFloat(v);
    if (!isFinite(n)) n = def;
    return Math.max(min, Math.min(max, n));
  }

  // ─── 位置索引 ───────────────────────────────────────────────

  function refreshPositions() {
    var gw = window.gameWorld;
    if (!gw || !gw.scene || !gw.scene.traverse) return;
    var map = {};
    try {
      gw.scene.traverse(function (o) {
        if (!o.userData) return;
        var id = o.userData.worldObjectId;
        if (id === undefined || id === null) return;
        o.updateWorldMatrix(true, false);
        var m = o.matrixWorld.elements;
        map[String(id)] = { x: m[12], y: m[13], z: m[14] };
      });
    } catch (e) { /* 场景遍历失败不影响主循环 */ }
    S.positions = map;
    S.lastPosScan = Date.now();
  }

  // ─── 播放控制 ───────────────────────────────────────────────

  async function getBuffer(url) {
    if (S.buffers[url]) return S.buffers[url];
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var ab = await res.arrayBuffer();
    var buf = await S.ctx.decodeAudioData(ab);
    S.buffers[url] = buf;
    return buf;
  }

  async function start(id, cfg) {
    if (S.active[id] || !S.ctx) return;
    S.active[id] = { pending: true };   // 占位，防止重复进入
    try {
      var buf = await getBuffer(cfg.audio.url);
      delete S.active[id].pending;

      var src = S.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;                  // 场景声都是循环铺底

      var gain = S.ctx.createGain();
      gain.gain.value = 0;              // 从 0 淡入，避免突然出现

      var panner = null;
      var pos = S.positions[id];
      if (pos) {
        panner = S.ctx.createPanner();
        panner.panningModel = 'equalpower';   // HRTF 对循环底噪收益很低但开销大
        panner.distanceModel = cfg.audio.falloff;
        panner.refDistance = Math.max(0.1, cfg.audio.minDist);
        panner.maxDistance = Math.max(1, cfg.audio.radius);
        panner.rolloffFactor = 1;
        if (panner.positionX) {
          panner.positionX.value = pos.x;
          panner.positionY.value = pos.y;
          panner.positionZ.value = pos.z;
        } else if (panner.setPosition) {
          panner.setPosition(pos.x, pos.y, pos.z);
        }
        src.connect(gain);
        gain.connect(panner);
        panner.connect(S.bus || S.ctx.destination);
      } else {
        src.connect(gain);
        gain.connect(S.bus || S.ctx.destination);
      }

      var now = S.ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, cfg.audio.volume), now + 0.8);

      src.start(now);
      S.active[id] = { src: src, gain: gain, panner: panner, url: cfg.audio.url };
      log('开始播放 #' + id, cfg.name || '', cfg.audio.url.split('/').pop());
    } catch (e) {
      delete S.active[id];
      log('播放失败 #' + id + '（忽略）:', e.message);
    }
  }

  function stop(id) {
    var a = S.active[id];
    if (!a || a.pending) { delete S.active[id]; return; }
    try {
      var now = S.ctx.currentTime;
      a.gain.gain.setValueAtTime(a.gain.gain.value || 0.0001, now);
      a.gain.gain.linearRampToValueAtTime(0.0001, now + 0.7);
      a.src.stop(now + 0.75);
    } catch (e) { /* 已经停了 */ }
    delete S.active[id];
  }

  function stopAll() {
    Object.keys(S.active).forEach(stop);
  }

  // ─── 监听者（相机）─────────────────────────────────────────

  function updateListener() {
    var gw = window.gameWorld;
    if (!gw || !gw.camera || !S.ctx) return;
    var cam = gw.camera;
    var l = S.ctx.listener;
    var p = cam.position;
    try {
      if (l.positionX) {
        l.positionX.setTargetAtTime(p.x, S.ctx.currentTime, 0.05);
        l.positionY.setTargetAtTime(p.y, S.ctx.currentTime, 0.05);
        l.positionZ.setTargetAtTime(p.z, S.ctx.currentTime, 0.05);
        if (cam.getWorldDirection) {
          var d = cam.getWorldDirection(new THREE.Vector3());
          l.forwardX.setTargetAtTime(d.x, S.ctx.currentTime, 0.1);
          l.forwardY.setTargetAtTime(d.y, S.ctx.currentTime, 0.1);
          l.forwardZ.setTargetAtTime(d.z, S.ctx.currentTime, 0.1);
          l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
        }
      } else if (l.setPosition) {
        l.setPosition(p.x, p.y, p.z);
      }
    } catch (e) { /* 老浏览器 API 差异，忽略 */ }
  }

  // ─── 主循环 ─────────────────────────────────────────────────

  function tick() {
    if (!S.ctx || !S.configs.length) return;
    var gw = window.gameWorld;
    if (!gw || !gw.camera) return;

    // 场景可能刚加载完物件，位置表定期重建（5 秒一次，开销可忽略）
    if (Date.now() - S.lastPosScan > 5000) refreshPositions();

    updateListener();

    var cam = gw.camera.position;
    var inRange = [];
    S.configs.forEach(function (c) {
      var p = S.positions[c.id];
      if (!p) return;
      var dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      var r = c.audio.radius;
      if (d2 <= r * r) inRange.push({ id: c.id, cfg: c, d: Math.sqrt(d2) });
    });

    inRange.sort(function (a, b) { return a.d - b.d; });
    var allowed = inRange.slice(0, S.maxConcurrent);
    var keep = {};
    allowed.forEach(function (x) {
      keep[x.id] = true;
      if (!S.active[x.id]) start(x.id, x.cfg);
    });

    // 超出范围或超出并发上限的，停掉
    Object.keys(S.active).forEach(function (id) {
      if (!keep[id]) stop(id);
    });
  }

  // ─── 启动 ───────────────────────────────────────────────────

  function bootLoop() {
    if (S.running) return;
    S.running = true;
    S.timer = setInterval(function () {
      try {
        if (!S.ctx && !pickCtx()) return;   // 等用户交互解锁 AudioContext
        tick();
      } catch (e) { /* 任何异常都不能打断循环 */ }
    }, S.tickMs);
    log('运行时已启动，每 ' + S.tickMs + 'ms 检查一次');
  }

  async function init() {
    await loadConfigs();
    if (!S.configs.length) {
      log('没有物件挂声音，运行时空转（不产生开销）');
    }
    bootLoop();
  }

  // 等 gameWorld 出现（world.js 初始化完成）再开始
  var waited = 0;
  var waiter = setInterval(function () {
    waited += 500;
    if (window.gameWorld && window.gameWorld.scene) {
      clearInterval(waiter);
      refreshPositions();
      init();
    } else if (waited > 60000) {
      clearInterval(waiter);
      log('等待 gameWorld 超时，放弃启动');
    }
  }, 500);

  window.SoundRuntime = {
    reload: async function () {
      stopAll();
      await loadConfigs();
      refreshPositions();
    },
    stats: function () {
      return { configs: S.configs.length, active: Object.keys(S.active).length, positions: Object.keys(S.positions).length };
    },
    stopAll: stopAll
  };
})();
