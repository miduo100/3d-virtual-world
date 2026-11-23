/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundFederation.js —— 跨世界音效传递
 *
 * 为什么单独一个文件：
 *   main.js（3049 行）和 federationUI.js（887 行）都已超过 500 行红线，
 *   按项目规范只能「引用」不能再往里写业务代码，因此把跨世界音效的
 *   打包 / 接收 / 加载判定全部收在这里，原文件只保留 1~2 行调用。
 *
 * 职责边界（只做四件事，不碰播放器）：
 *   1. buildSendConfig()  传送发起端：把本机音效配置转绝对 URL，供令牌带走
 *   2. applyReceived(cc)  传送接收端：把源世界带来的音效写入本机缓存
 *   3. resolveForLoad(t)  进世界时：决定该加载模板音效还是跨世界音效
 *   4. cacheLocal / readCached  本机缓存的读写
 *
 * 存储：localStorage['selectedTemplateSounds'] =
 *   { anim_sounds: {...}, weapon_sounds: {...} }
 *
 * 设计前提（与 GLB / 动画一致）：源世界必须在线，绝对 URL 由目标世界跨域拉取。
 * 源世界不在线时音效加载失败，播放层会静默降级，不会报错、不会阻塞。
 */
(function () {
  'use strict';

  var LS_KEY = 'selectedTemplateSounds';

  // ─── 工具 ───────────────────────────────────────────────────

  function absUrl(u, origin) {
    if (!u || typeof u !== 'string' || u === 'null') return null;
    return u.indexOf('http') === 0 ? u : (origin + u);
  }

  /** 从多种值形态里取出一个可播的 URL：字符串 / 数组 / {urls:[]} / {url} */
  function pickUrl(v, origin) {
    if (!v) return null;
    if (typeof v === 'string') return absUrl(v, origin);
    if (Array.isArray(v)) return absUrl(v[0], origin);
    if (typeof v === 'object') {
      if (Array.isArray(v.urls) && v.urls.length) return absUrl(v.urls[0], origin);
      if (v.url) return absUrl(v.url, origin);
    }
    return null;
  }

  /** 服务端偶尔回 JSON 字符串（JSONB 未解析），统一转对象 */
  function asObject(v) {
    if (typeof v === 'string') {
      try { return JSON.parse(v) || {}; } catch (e) { return {}; }
    }
    return v || {};
  }

  function countKeys(o) {
    return Object.keys(o || {}).length;
  }

  // ─── 缓存读写 ───────────────────────────────────────────────

  function cacheLocal(animSounds, weaponSounds) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        anim_sounds: animSounds || {},
        weapon_sounds: weaponSounds || {}
      }));
    } catch (e) { /* 隐私模式 / 存储满，忽略即可 */ }
  }

  function readCached() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }

  function clearCached() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }

  // ─── 1. 传送发起端：打包 ────────────────────────────────────

  /**
   * 把本机音效配置转成绝对 URL，供传送令牌的 characterConfig 带走。
   * 变体池只传第一个（避免令牌过大），空 URL 不传（避免目标世界请求空路径）。
   * @returns {{animSounds: Object, weaponSounds: Object}}
   */
  function buildSendConfig(origin) {
    var base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    var out = { animSounds: {}, weaponSounds: {} };
    var raw = readCached();
    if (!raw) return out;

    var collect = function (dict, target) {
      Object.keys(dict || {}).forEach(function (k) {
        var u = pickUrl(dict[k], base);
        if (u) target[k] = u;
      });
    };
    collect(raw.anim_sounds, out.animSounds);
    collect(raw.weapon_sounds, out.weaponSounds);
    return out;
  }

  // ─── 2. 传送接收端：落地 ────────────────────────────────────

  /**
   * 把源世界带来的音效写入本机缓存。
   * 源世界没配音效时主动清除旧值，避免目标世界误播上一个角色的声音。
   * @returns {{anim: number, weapon: number}} 收到多少个键
   */
  function applyReceived(cc) {
    if (!cc) return { anim: 0, weapon: 0 };
    var anim = asObject(cc.animSounds);
    var weapon = asObject(cc.weaponSounds);
    var a = countKeys(anim);
    var w = countKeys(weapon);
    if (a || w) {
      cacheLocal(anim, weapon);
    } else {
      clearCached();
    }
    return { anim: a, weapon: w };
  }

  // ─── 3. 进世界时：决定加载什么 ──────────────────────────────

  /**
   * 决定进世界时该加载哪套音效。
   * **始终返回对象**，因为 loadTemplateAudio 除了加载音效，还负责预热合成音
   * （只预热 idle/walk/run/jump/land/attack1/attack2/hit/swing 九个常用键），
   * 跳过调用会导致首次动作没声，所以即使音效为空也要调。
   *
   * @param {Object|null} tmplData 本地模板数据；跨世界到达时为 null
   * @returns {{cfg: {anim_sounds: Object, weapon_sounds: Object}, from: 'template'|'federated'|'none'}}
   */
  function resolveForLoad(tmplData) {
    if (tmplData) {
      var cfg = {
        anim_sounds: asObject(tmplData.anim_sounds),
        weapon_sounds: asObject(tmplData.weapon_sounds)
      };
      // 本地模板：即使为空也写入缓存，避免残留上一个角色的跨世界音效
      cacheLocal(cfg.anim_sounds, cfg.weapon_sounds);
      return { cfg: cfg, from: 'template' };
    }

    var cached = readCached();
    if (cached && (countKeys(cached.anim_sounds) || countKeys(cached.weapon_sounds))) {
      return {
        cfg: {
          anim_sounds: asObject(cached.anim_sounds),
          weapon_sounds: asObject(cached.weapon_sounds)
        },
        from: 'federated'
      };
    }

    return { cfg: { anim_sounds: {}, weapon_sounds: {} }, from: 'none' };
  }

  // ─── 导出 ───────────────────────────────────────────────────

  window.SoundFederation = {
    buildSendConfig: buildSendConfig,
    applyReceived: applyReceived,
    resolveForLoad: resolveForLoad,
    cacheLocal: cacheLocal,
    readCached: readCached,
    clearCached: clearCached
  };
})();
