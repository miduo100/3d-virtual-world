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

  async function probe(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return r.ok;
    } catch (e) {
      return false;
    }
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
      if (s.state === 'none') return null;
      s.state = 'loading';
      const exists = await probe(vUrl);
      if (!exists) {
        s.state = 'none';
        console.log(`[LOD] 无${level === 'low' ? '低' : '中'}模，沿用高模/占位方块:`, vUrl);
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
    forget,
    /** 调试：查看某 URL 的变体状态 */
    debugState: function (url) {
      const s = cache.get(url);
      return s ? { mid: s.mid.state, low: s.low.state } : null;
    },
  };
})();
