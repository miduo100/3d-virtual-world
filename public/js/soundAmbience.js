/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundAmbience.js —— 环境声景 + 天气联动 运行时（S3）
 *
 * 三件事：
 *   ③ 声音点位：玩家走进点位半径 → 淡入循环播放；走出半径 → 淡出销毁。半径一半内是满音量。
 *   ③ 区域铺底：玩家进入区域 → 交叉淡化淡入；离开 → 淡出。区域嵌套时小的优先。（旧模型，保留兼容）
 *   ④ 天气联动：风速/雨强/雪强/雾浓度 → 连续驱动音量与滤波；雷暴 → 随机滚雷。
 *
 * 与 soundRuntime.js 的分工：
 *   soundRuntime  管「物件声源」（有方位、按距离衰减）
 *   soundAmbience 管「区域铺底 + 天气」（无方位、环绕）
 *
 * 复用 soundManager 的 AudioContext 与 sfx 总线，不再新开 ctx。
 * 不改 world.js：自己起 300ms 循环，从 gameWorld.camera 读位置。
 */
(function () {
  'use strict';

  var S = {
    ctx: null,
    bus: null,          // ambient 总巴士 → sfxGain
    fogFilter: null,    // 全局低通（雾）
    regions: [],
    regionBeds: [],     // [{ id, gain, src, url }] 最多两个，交叉淡化
    activeRegionId: null,
    pads: [],           // ③ 声音点位（声音 + 坐标 + 半径）
    padLanes: {},       // id → { src, gain, url }
    bufCache: {},       // url → Promise<AudioBuffer|null>，同一段声音多个点位共用
    weatherCfg: null,
    weather: { type: 'clear', intensity: 0, wind: 0 },
    lanes: {},          // wind/rain/snow → { src, gain, filter, url }
    thunderTimer: null,
    lastFetch: 0,
    lastRegionScan: 0,
    tickMs: 300,
    started: false
  };

  function log() { console.log.apply(console, ['[Ambience]'].concat([].slice.call(arguments))); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function pickCtx() {
    var sm = window.soundManager;
    if (!sm || typeof sm.getContext !== 'function') return false;
    if (typeof sm.isUnlocked === 'function' && !sm.isUnlocked()) return false;
    var ctx = sm.getContext();
    if (!ctx) return false;
    if (S.ctx === ctx) return true;
    S.ctx = ctx;
    var sfx = (typeof sm.getSfxGain === 'function') ? sm.getSfxGain() : null;
    S.bus = ctx.createGain();
    S.bus.gain.value = 1;
    S.bus.connect(sfx || ctx.destination);
    S.fogFilter = ctx.createBiquadFilter();
    S.fogFilter.type = 'lowpass';
    S.fogFilter.frequency.value = 20000;
    S.fogFilter.connect(S.bus);
    return true;
  }

  // ─── 配置拉取 ───────────────────────────────────────────────

  async function fetchConfig() {
    try {
      var r = await fetch('/api/sound-scenes/ambience');
      if (!r.ok) return;
      var d = await r.json();
      S.regions = (d.regions || []).filter(function (x) { return x.audio && x.audio.url; });
      S.pads = (d.pads || []).filter(function (p) { return p && p.url && p.enabled !== false; });
      S.weatherCfg = d.weatherAudio || null;
      S.weather = d.weather || S.weather;
      S.lastFetch = Date.now();
    } catch (e) { /* 静默 */ }
  }

  // ─── 区域判定 ───────────────────────────────────────────────

  function boundsContains(b, x, z) {
    if (!b) return false;
    try {
      // 兼容多种存法：{x,z,w,d} / {minX,maxX,minZ,maxZ} / {x1,z1,x2,z2} / [[x,z],[x,z]]
      if (Array.isArray(b) && b.length >= 2) {
        var xs = [], zs = [];
        b.forEach(function (p) {
          if (Array.isArray(p)) { xs.push(p[0]); zs.push(p[1] || p[2]); }
          else if (p && typeof p === 'object') { xs.push(p.x); zs.push(p.z); }
        });
        if (xs.length >= 2) return x >= Math.min.apply(null, xs) && x <= Math.max.apply(null, xs) &&
                                  z >= Math.min.apply(null, zs) && z <= Math.max.apply(null, zs);
      }
      if (typeof b === 'object') {
        if (b.minX != null && b.maxX != null) {
          return x >= b.minX && x <= b.maxX && z >= (b.minZ != null ? b.minZ : -1e9) && z <= (b.maxZ != null ? b.maxZ : 1e9);
        }
        if (b.x != null && b.w != null) {
          return x >= b.x && x <= b.x + b.w && z >= (b.z || 0) && z <= (b.z || 0) + (b.d || b.w);
        }
        if (b.x1 != null && b.x2 != null) {
          return x >= Math.min(b.x1, b.x2) && x <= Math.max(b.x1, b.x2) &&
                 z >= Math.min(b.z1, b.z2) && z <= Math.max(b.z1, b.z2);
        }
      }
    } catch (e) { /* 解析失败当不包含 */ }
    return false;
  }

  function findRegion(pos) {
    var hit = null;
    var hitArea = Infinity;
    S.regions.forEach(function (r) {
      if (!boundsContains(r.bounds, pos.x, pos.z)) return;
      // 面积小的优先（小区覆盖大区）
      var a = area(r.bounds);
      if (a < hitArea) { hitArea = a; hit = r; }
    });
    return hit;
  }

  function area(b) {
    try {
      if (b && b.w != null) return Math.abs(b.w * (b.d || b.w));
      if (b && b.minX != null) return Math.abs((b.maxX - b.minX) * ((b.maxZ || 0) - (b.minZ || 0)));
      if (b && b.x1 != null) return Math.abs((b.x2 - b.x1) * (b.z2 - b.z1));
    } catch (e) {}
    return 1e9;
  }

  // ─── 区域交叉淡化 ───────────────────────────────────────────

  async function playRegion(r) {
    if (!S.ctx) return;
    var url = r.audio.url;
    var fade = clamp(parseFloat(r.audio.fadeIn) || 2.5, 0.3, 8) * 1000;
    var vol = clamp(parseFloat(r.audio.volume) || 0.5, 0, 1);
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var buf = await S.ctx.decodeAudioData(await res.arrayBuffer());

      var src = S.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var g = S.ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(g); g.connect(S.fogFilter);
      var now = S.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(vol, now + fade / 1000);
      src.start(now);

      var bed = { id: r.id, src: src, gain: g, url: url };
      S.regionBeds.push(bed);
      // 最多保留两个：旧的开始淡出
      while (S.regionBeds.length > 2) {
        var old = S.regionBeds.shift();
        fadeOut(old, fade);
      }
      S.activeRegionId = r.id;
      log('进入区域:', r.name || r.region_key);
    } catch (e) {
      log('区域铺底播放失败（忽略）:', e.message);
    }
  }

  function fadeOut(bed, ms) {
    if (!bed || !S.ctx) return;
    try {
      var now = S.ctx.currentTime;
      bed.gain.gain.setValueAtTime(bed.gain.gain.value || 0.0001, now);
      bed.gain.gain.linearRampToValueAtTime(0.0001, now + (ms || 2500) / 1000);
      bed.src.stop(now + (ms || 2500) / 1000 + 0.1);
    } catch (e) {}
  }

  // ─── ③ 声音点位 ─────────────────────────────────────────────
  // 与区域铺底的区别：点位是「一段声音挂在一个坐标上，有可听半径」，
  // 走进半径才响、走出去就淡掉；同一段声音可以放多处，互不影响。

  /** 三维距离：Y 也参与（树冠上的鸟叫、地下室的回声要靠高度差区分） */
  function distXYZ(pos, p) {
    var dx = pos.x - (parseFloat(p.x) || 0);
    var dy = (pos.y || 0) - (parseFloat(p.y) || 0);
    var dz = pos.z - (parseFloat(p.z) || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** 半径一半内满音量，从一半衰减到边缘为 0 */
  function padVolumeAt(p, d) {
    var r = parseFloat(p.radius) || 30;
    var vol = (p.volume != null) ? clamp(parseFloat(p.volume), 0, 1) : 0.5;
    if (vol <= 0) return 0;
    if (d >= r) return 0;
    var inner = r * 0.5;
    if (d <= inner) return vol;
    return vol * ((r - d) / (r - inner));
  }

  function getBuffer(url) {
    if (S.bufCache[url]) return S.bufCache[url];
    S.bufCache[url] = fetch(url)
      .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
      .then(function (ab) { return ab ? S.ctx.decodeAudioData(ab) : null; })
      .catch(function () { return null; });
    return S.bufCache[url];
  }

  function ensurePadLane(p) {
    var lane = S.padLanes[p.id];
    if (lane && lane.url === p.url) return;
    if (lane) { try { lane.src.stop(); } catch (e) {} delete S.padLanes[p.id]; }
    if (!S.ctx || !p.url) return;
    getBuffer(p.url).then(function (buf) {
      if (!buf || !S.ctx) return;
      // 等 buffer 的这段时间里可能已经走远或删了点位，再确认一次
      if (S.padLanes[p.id]) return;
      var src = S.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = (p.loop !== false);
      var g = S.ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(g); g.connect(S.fogFilter);
      try { src.start(); } catch (e) { return; }
      S.padLanes[p.id] = { src: src, gain: g, url: p.url };
    });
  }

  function fadeOutPad(id, ms) {
    var lane = S.padLanes[id];
    if (!lane || !S.ctx) return;
    delete S.padLanes[id];
    try {
      var now = S.ctx.currentTime;
      lane.gain.gain.cancelScheduledValues(now);
      lane.gain.gain.setValueAtTime(Math.max(0.0001, lane.gain.gain.value), now);
      lane.gain.gain.linearRampToValueAtTime(0.0001, now + (ms || 2000) / 1000);
      lane.src.stop(now + (ms || 2000) / 1000 + 0.05);
    } catch (e) {}
  }

  function applyPads(pos) {
    if (!S.pads.length && !Object.keys(S.padLanes).length) return;
    var alive = {};

    S.pads.forEach(function (p) {
      alive[p.id] = 1;
      var d = distXYZ(pos, p);
      var target = padVolumeAt(p, d);

      if (target <= 0.001) {
        if (S.padLanes[p.id]) fadeOutPad(p.id, (parseFloat(p.fadeIn) || 2) * 1000);
        return;
      }
      var lane = S.padLanes[p.id];
      if (!lane || lane.url !== p.url) { ensurePadLane(p); return; }
      // 时间常数取淡入秒数的 1/3：听起来像"渐渐出现"，不是硬切
      var tau = Math.max(0.2, (parseFloat(p.fadeIn) || 2) / 3);
      lane.gain.gain.setTargetAtTime(target, S.ctx.currentTime, tau);
    });

    // 后台删掉/停用的点位 → 收尾淡出
    Object.keys(S.padLanes).forEach(function (id) {
      if (!alive[id]) fadeOutPad(id, 1500);
    });
  }

  // ─── 天气层 ─────────────────────────────────────────────────

  /**
   * 探测解码后音频的「有声区间」，用来绕开 MP3 编码器延迟。
   *
   * 为什么需要：MP3 编码器会在开头插入一段静音（encoder delay，576 样本起），
   * 本项目用的编码器没写 LAME/Xing gapless 头，浏览器解码后不会自动裁掉 →
   * 实测天气音开头有 40~50ms 静音。天气音是 src.loop = true 的无限铺底，
   * 这段静音会让**每一圈循环的接缝处"断一下"**（风声里特别明显）。
   * 把 loopStart/loopEnd 收进有声区间就消除了。
   *
   * 保守起见：只在「前导/尾部静音都很短」时采用（<200ms），
   * 避免把真正渐入渐出的素材（如雷声）切掉。
   */
  function audibleRange(buf) {
    var d = buf.getChannelData(0);
    var n = d.length;
    if (!n) return null;
    var peak = 0, i, v;
    for (i = 0; i < n; i += 13) { v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
    if (peak <= 0) return null;
    var th = peak * 0.12;
    var lead = 0, tail = n - 1;
    for (i = 0; i < n; i++) { v = d[i] < 0 ? -d[i] : d[i]; if (v > th) { lead = i; break; } }
    for (i = n - 1; i >= 0; i--) { v = d[i] < 0 ? -d[i] : d[i]; if (v > th) { tail = i; break; } }
    var leadSec = lead / buf.sampleRate;
    var tailSec = (n - 1 - tail) / buf.sampleRate;
    if (leadSec <= 0.002 || leadSec > 0.2) return null;   // 没有延迟 / 不像编码延迟 → 不动
    if (tailSec > 0.2) return null;
    return { start: leadSec, end: (tail + 1) / buf.sampleRate };
  }

  function ensureLane(name, url, opts) {
    var lane = S.lanes[name];
    if (lane && lane.url === url) return lane;
    if (lane) { try { lane.src.stop(); } catch (e) {} delete S.lanes[name]; }
    if (!url || !S.ctx) return null;

    fetch(url).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (ab) {
      if (!ab) return;
      return S.ctx.decodeAudioData(ab);
    }).then(function (buf) {
      if (!buf || S.lanes[name]) return;
      var src = S.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      // 跳过 MP3 编码延迟，否则每圈接缝都会"断一下"（见 audibleRange 注释）
      var seam = audibleRange(buf);
      if (seam) { src.loopStart = seam.start; src.loopEnd = seam.end; }
      var g = S.ctx.createGain();
      g.gain.value = 0.0001;
      var f = null;
      if (opts && opts.lowpass) {
        f = S.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = opts.lowpass;
        src.connect(g); g.connect(f); f.connect(S.fogFilter);
      } else {
        src.connect(g); g.connect(S.fogFilter);
      }
      src.start();
      S.lanes[name] = { src: src, gain: g, filter: f, url: url };
    }).catch(function (e) { log(name + ' 加载失败:', e.message); });
    return null;
  }

  function setLaneVolume(name, target) {
    var lane = S.lanes[name];
    if (!lane || !S.ctx) return;
    var now = S.ctx.currentTime;
    lane.gain.gain.setTargetAtTime(Math.max(0.0001, target), now, 0.4);
  }

  function applyWeather() {
    var c = S.weatherCfg;
    if (!c || !S.ctx) return;
    var w = S.weather;

    // 风：音量随风速，滤波随速度升高。
    // 【2026-11-14】风是唯一「常驻」通道（雨/雪/雾都按天气开关，非本天气时归零），
    // 所以雨天里会听见风声叠在雨声上——实测用户第一反应就是"雨里怎么有风"。
    // 这里按天气压一档：雨/雪/雾里只留一点空气感，晴朗和暴风雨才给满。
    var WIND_WEATHER = { clear: 1.0, rain: 0.35, snow: 0.45, fog: 0.3, storm: 1.0 };
    if (c.wind && c.wind.enabled && c.wind.url) {
      ensureLane('wind', c.wind.url);
      var windFactor = (WIND_WEATHER[w.type] !== undefined) ? WIND_WEATHER[w.type] : 1.0;
      setLaneVolume('wind', (w.wind / 100) * (c.wind.maxVolume || 0.7) * windFactor);
      var lane = S.lanes.wind;
      if (lane && lane.filter) {
        var f0 = c.wind.freqFrom || 300, f1 = c.wind.freqTo || 1800;
        var f = f0 + (f1 - f0) * (w.wind / 100);
        lane.filter.frequency.setTargetAtTime(f, S.ctx.currentTime, 0.6);
      }
    }

    // 雨
    if (c.rain && c.rain.enabled && c.rain.url) {
      ensureLane('rain', c.rain.url);
      var rainOn = (w.type === 'rain' || w.type === 'storm') ? 1 : 0;
      setLaneVolume('rain', rainOn * (w.intensity / 100) * (c.rain.maxVolume || 0.8));
    }

    // 雪（几乎没有声音）
    if (c.snow && c.snow.enabled && c.snow.url) {
      ensureLane('snow', c.snow.url);
      var snowOn = (w.type === 'snow') ? 1 : 0;
      setLaneVolume('snow', snowOn * (w.intensity / 100) * (c.snow.maxVolume || 0.2));
    }

    // 雾：全局低通（不是加声音）
    if (c.fog && c.fog.enabled && S.fogFilter) {
      var fogLevel = (w.type === 'fog') ? (w.intensity / 100) : 0;
      var from = c.fog.lowpassFrom || 20000;
      var to = c.fog.lowpassTo || 1800;
      var hz = from + (to - from) * fogLevel;
      S.fogFilter.frequency.setTargetAtTime(hz, S.ctx.currentTime, 1.2);
    }

    // 雾专属环境声（可选）：有就放，音量随雾浓度；没配就只有低通效果
    if (c.fog && c.fog.url) {
      ensureLane('fog', c.fog.url);
      var fogVol = (w.type === 'fog') ? (w.intensity / 100) : 0;
      setLaneVolume('fog', fogVol * (c.fog.maxVolume || 0.5));
    }

    // 雷：雷暴时随机
    scheduleThunder(c.thunder);
  }

  function scheduleThunder(t) {
    if (!t || !t.enabled || !t.url || !S.ctx) return;
    if (S.weather.type !== 'storm') return;
    if (S.thunderTimer) return;
    var gap = (t.minGap || 8) + Math.random() * ((t.maxGap || 25) - (t.minGap || 8));
    S.thunderTimer = setTimeout(function () {
      S.thunderTimer = null;
      if (S.weather.type !== 'storm') return;
      fetch(t.url).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return S.ctx.decodeAudioData(ab); })
        .then(function (buf) {
          var src = S.ctx.createBufferSource();
          src.buffer = buf;
          var g = S.ctx.createGain();
          g.gain.value = clamp(t.volume || 0.8, 0, 1);
          src.connect(g); g.connect(S.bus);
          src.start();
        })
        .catch(function () {});
    }, gap * 1000);
  }

  // ─── 主循环 ─────────────────────────────────────────────────

  function tick() {
    if (!S.ctx) return;
    var gw = window.gameWorld;
    if (!gw || !gw.camera) return;

    // 配置每 15 秒刷一次（后台改完不用重进世界）
    if (Date.now() - S.lastFetch > 15000) fetchConfig();

    // 区域
    var pos = gw.camera.position;
    var r = findRegion(pos);
    if (r && r.id !== S.activeRegionId) {
      playRegion(r);
    } else if (!r && S.activeRegionId) {
      // 走出所有区域 → 现有 bed 淡出
      S.regionBeds.forEach(function (b) { fadeOut(b, 2500); });
      S.regionBeds = [];
      S.activeRegionId = null;
    }

    // 声音点位（按坐标与半径）
    applyPads(pos);

    applyWeather();
  }

  async function start() {
    await fetchConfig();
    S.started = true;
    setInterval(function () {
      try {
        if (!pickCtx()) return;
        tick();
      } catch (e) { /* 不打断循环 */ }
    }, S.tickMs);
    log('已启动（声音点位 ' + S.pads.length + ' 个，区域铺底 ' + S.regions.length + ' 个）');
  }

  var waited = 0;
  var waiter = setInterval(function () {
    waited += 500;
    if (window.gameWorld && window.gameWorld.scene) {
      clearInterval(waiter);
      start();
    } else if (waited > 60000) {
      clearInterval(waiter);
    }
  }, 500);

  window.SoundAmbience = {
    reload: fetchConfig,
    stats: function () {
      return {
        pads: S.pads.length,
        activePads: Object.keys(S.padLanes),
        regions: S.regions.length,
        activeRegion: S.activeRegionId,
        weather: S.weather,
        lanes: Object.keys(S.lanes)
      };
    }
  };
})();
