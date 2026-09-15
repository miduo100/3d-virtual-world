/**
 * worldLodAssets.js — 模型 LOD 三版方案的「资源侧」助手（模型 LOD 三版方案 · 阶段 4）
 *
 * 职责（只管"资源从哪来"，不参与渲染决策）：
 *   1. 启动时读取开关：GET /api/config/lod-enabled → window.__LOD_ENABLED（失败默认 true）
 *   2. URL 推导：/models/uploaded/x_dec.glb → x_mid.glb / x_lod.glb（与服务端规则完全一致）
 *   3. HEAD 探测变体是否存在（不存在直接返回 null，不发起下载）
 *   4. 用 world.gltfLoader 异步加载变体场景，带进行中/已完成缓存（同 URL 只下不重复）
 *
 * 渲染侧（三带矩阵写入 / count / 远距方块阈值）由 worldInstanceMerger_v2.js 负责。
 *
 * 约束：任何失败都静默回退（返回 null），绝不抛异常影响世界加载。
 */
(function () {
  'use strict';

  const MID_SUFFIX = '_mid.glb';
  const LOW_SUFFIX = '_lod.glb';

  // 变体"确认缺失/失败"的冷却期（三期会话3机动，2026-09-13）：
  // 此前 state='none' 永久生效——服务器重启窗口/网络抖动中的一次失败会让该模型
  // 永久回退高模直到刷新页面（用户实测"这部分学生的模型没有中低"的根因之一）。
  const NONE_TTL_MISSING = 10 * 60 * 1000; // HEAD 404 确认不存在：10 分钟后再探测（防刷 HEAD）
  const NONE_TTL_ERROR = 60 * 1000;        // 网络失败/非 404 错误：60s 后重试（瞬时故障自愈）

  const cache = new Map();   // url → { mid: {state,scene}, low: {state,scene} }
  const inflight = new Map(); // 'url|level' → Promise<scene|null>

  let _enabled = true;
  let _fetched = false;
  // 分带距离（二期 C：后台「本世界模型设置」可调，随 /lod-enabled 下发；缺省 30/60/400）
  let _near = 30;
  let _mid = 60;
  let _far = 400;

  function slot(url, level) {
    if (!cache.has(url)) cache.set(url, { mid: { state: 'idle', scene: null }, low: { state: 'idle', scene: null } });
    return cache.get(url)[level];
  }

  /** 变体 URL 推导（与服务端 modelLod.lodPaths 同一规则） */
  function lodUrl(url, level) {
    if (!url || typeof url !== 'string') return null;
    const m = /^(.*?)(?:_dec)?\.glb$/i.exec(url);
    if (!m) return null;
    return m[1] + (level === 'low' ? LOW_SUFFIX : MID_SUFFIX);
  }

  /** 读取开关（只取一次；失败默认开启 —— 后端不可用不应导致世界没有 LOD） */
  function applyRemote(j) {
    const prev = `${_enabled}|${_near}|${_mid}|${_far}`;
    _enabled = !(j && j.enabled === false);
    if (j && Number.isFinite(j.near) && j.near > 0) _near = j.near;
    if (j && Number.isFinite(j.mid) && j.mid > 0) _mid = j.mid;
    if (j && Number.isFinite(j.far) && j.far > 0) _far = j.far;
    window.__LOD_ENABLED = _enabled;
    window.__LOD_BANDS = { near: _near, mid: _mid, far: _far };
    const cur = `${_enabled}|${_near}|${_mid}|${_far}`;
    if (cur !== prev) {
      console.log('[LOD] 配置已更新（后台修改自动跟进）:', _enabled ? '开启' : '关闭',
        `| 分带: 高≤${_near}m / 中≤${_mid}m / 低≤${_far}m`);
    }
  }

  async function fetchEnabled() {
    if (_fetched) return _enabled;
    _fetched = true;
    try {
      const r = await fetch('/api/config/lod-enabled', { cache: 'no-store' });
      applyRemote(await r.json());
    } catch (e) {
      _enabled = true;
    }
    // 二期 C 补丁（2026-09-12）：后台改分带距离后，已打开的玩家端 60s 内自动跟进，
    // 无需刷新页面（此前只在页面加载时读一次，已打开的客户端会一直用旧值）
    setInterval(() => {
      fetch('/api/config/lod-enabled', { cache: 'no-store' })
        .then((r) => r.json())
        .then(applyRemote)
        .catch(() => { /* 静默：下次轮询再试 */ });
    }, 60000);
    console.log('[LOD] 分级渲染开关:', _enabled ? '开启' : '关闭（全部按高模渲染）',
      `| 分带: 高≤${_near}m / 中≤${_mid}m / 低≤${_far}m`);
    return _enabled;
  }

  async function probeStatus(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return 'ok';
      return r.status === 404 ? 'missing' : 'error';
    } catch (e) {
      return 'error'; // 网络失败（服务器重启/断网等瞬时故障）
    }
  }

  async function probe(url) {
    return (await probeStatus(url)) === 'ok';
  }

  /**
   * 加载变体场景（同 URL 同 level 并发去重）
   * @returns {Promise<THREE.Object3D|null>} 变体场景根节点，不存在/失败返回 null
   */
  async function loadVariant(loader, url, level) {
    const vUrl = lodUrl(url, level);
    if (!vUrl || !loader || typeof loader.load !== 'function') return null;
    const key = url + '|' + level;
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      const s = slot(url, level);
      if (s.state === 'ready') return s.scene;
      if (s.state === 'none') {
        // 冷却期内的"确认缺失/失败"直接返回 null；冷却已过则重新探测（自愈）
        const ttl = (s.noneReason === 'missing') ? NONE_TTL_MISSING : NONE_TTL_ERROR;
        if (Date.now() - (s.noneAt || 0) < ttl) return null;
        s.state = 'idle';
      }
      s.state = 'loading';
      const st = await probeStatus(vUrl);
      if (st !== 'ok') {
        s.state = 'none';
        s.noneAt = Date.now();
        s.noneReason = st;
        if (st === 'error') console.warn('[LOD] 变体探测失败（60s后自动重试）:', vUrl);
        return null;
      }
      const scene = await new Promise((resolve) => {
        try {
          loader.load(vUrl, (gltf) => resolve(gltf && gltf.scene ? gltf.scene : null), undefined, (err) => {
            console.warn('[LOD] 变体加载失败（回退高模）:', vUrl, err && err.message ? err.message : '');
            resolve(null);
          });
        } catch (e) {
          resolve(null);
        }
      });
      if (!scene) {
        s.state = 'none';
        s.noneAt = Date.now();
        s.noneReason = 'error'; // 下载/解析失败属瞬时类，60s 后重试
        return null;
      }
      s.state = 'ready';
      s.scene = scene;
      console.log('[LOD] 变体已加载:', vUrl);
      return scene;
    })();

    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
    return p;
  }

  /** 变体是否已就绪（用于远距方块阈值判定：低模就绪才把远界放到 400m） */
  function isReady(url, level) {
    const s = cache.get(url);
    return !!(s && s[level] && s[level].state === 'ready');
  }

  /**
   * 变体当前状态：'idle' | 'loading' | 'ready' | 'none'（未探测过返回 'idle'）。
   * 渲染侧严格分带（2026-09-14）用它区分「加载中」与「确认缺失」：
   *   加载中 → 该带暂不渲染（占位方块顶替，严禁高模顶替）；
   *   确认缺失（'none'）→ 维持既有失败回退（高模兜底）。
   */
  function stateOf(url, level) {
    const s = cache.get(url);
    return (s && s[level]) ? s[level].state : 'idle';
  }

  /**
   * 距离 → 模型精度层级【唯一权威规则】（2026-09-14 收敛：合批/散装共用）。
   * 距离值来自后台「本世界模型设置」（system_config.lod_near_dist / lod_mid_far_dist /
   * lod_far_dist，合法范围 5~150 / 10~300 / 50~2000，须递增），经 GET /api/config/lod-enabled
   * 下发、60s 轮询自动跟进，改配置免刷新生效。
   *
   *   d ≤ near        → 'high'（高模）
   *   near < d ≤ mid  → 'mid' （中模）
   *   mid < d ≤ far   → 'low' （低模）
   *   d > far         → 'none'（只显示占位方块）
   *
   * 返回的是「配置上的目标层级」。调用方还需各自处理：
   *   · 变体未就绪：加载中 → 占位方块顶替；确认缺失 → 既有回退链（低缺→中、中缺→高）；
   *   · 合批组/散装在低模未就绪时远界封顶 min(far, 200)（二期 D 行为）。
   */
  function resolveBand(d) {
    if (typeof d !== 'number' || !isFinite(d)) return 'none';
    if (d <= _near) return 'high';
    if (d <= _mid) return 'mid';
    if (d <= _far) return 'low';
    return 'none';
  }

  /** 当前生效的分带距离（调试/诊断用） */
  function getBands() {
    return { near: _near, mid: _mid, far: _far };
  }

  /**
   * 丢弃某 URL 的缓存（该组合批组【真正解散】时调用，例如走远后对象被卸载）。
   * GPU 资源（geometry/贴图）由调用方释放，这里只丢引用，使下次重建重新加载。
   * 注意：合批组"重建"（新实例加载导致的 unmerge+re-merge）不走这里 ——
   * 否则加载期数十次重建会反复下载同一个 8MB 变体。
   */
  function forget(url) {
    cache.delete(url);
    inflight.delete(url + '|mid');
    inflight.delete(url + '|low');
  }

  window.WorldLodAssets = {
    /** 分带距离（getter：随后台配置动态变化，worldInstanceMerger_v2 每帧读取） */
    get NEAR_DIST() { return _near; },   // ≤near 高模
    get MID_FAR_DIST() { return _mid; }, // near~mid 中模
    get FAR_DIST() { return _far; },     // mid~far 低模（低模缺失时按 MID_FAR_DIST 处理；>far 蓝方块）
    fetchEnabled,
    isEnabled: () => _enabled,
    /** 运行时开关（测试/调试用；返回旧值） */
    setEnabled: function (v) {
      const old = _enabled;
      _enabled = !!v;
      window.__LOD_ENABLED = _enabled;
      console.log('[LOD] 开关切换:', old, '→', _enabled);
      return old;
    },
    lodUrl,
    probe,
    loadVariant,
    isReady,
    stateOf,
    resolveBand,
    getBands,
    forget,
    /** 调试：查看某 URL 的变体状态 */
    debugState: function (url) {
      const s = cache.get(url);
      return s ? { mid: s.mid.state, low: s.low.state } : null;
    },
  };
})();
