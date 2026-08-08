/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 远程玩家模型安全守卫 (前端模块)
 *
 * 功能：
 * - 从服务器动态获取可调阈值配置
 * - 加载前检测文件大小（HEAD 请求）
 * - 加载后验证 GLTF 复杂度（三角形/顶点/Mesh数）
 * - 超限时自动降级为占位符（木棍人/方块人/球体）
 *
 * 使用方式：
 *   RemoteModelGuard.shouldLoadRemoteModel(url, context)
 *     -> { shouldLoad: true/false, reason? }
 *
 *   RemoteModelGuard.validateLoadedModel(gltfScene, context)
 *     -> { safe: true/false, stats?, reason? }
 *
 *   RemoteModelGuard.createPlaceholder(characterGroup)
 *     -> 替换为占位符模型
 */

const RemoteModelGuard = (function() {
  'use strict';

  // ========== 状态 ==========
  var currentConfig = null;
  var configFetchPromise = null;
  var configLastFetched = 0;
  var CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2分钟缓存

  // 统计（本次会话）
  var stats = { blocked: 0, passed: 0, totalSize: 0, sizeCount: 0 };

  // 离线默认值
  var FALLBACK = {
    enabled: true,
    max_file_size: 10,
    max_triangles: 50000,
    max_vertices: 30000,
    max_mesh_count: 20,
    show_warning: true,
    placeholder_style: 'stickman'
  };

  // ========== 配置获取 ==========

  async function fetchConfig(forceRefresh) {
    if (currentConfig && !forceRefresh && (Date.now() - configLastFetched < CONFIG_CACHE_TTL)) {
      return currentConfig;
    }
    if (configFetchPromise) return configFetchPromise;

    configFetchPromise = _doFetch()
      .then(function(cfg) {
        currentConfig = cfg;
        configLastFetched = Date.now();
        configFetchPromise = null;
        return cfg;
      })
      .catch(function(err) {
        console.warn('[ModelGuard] 获取配置失败:', err.message);
        configFetchPromise = null;
        return currentConfig || FALLBACK;
      });

    return configFetchPromise;
  }

  async function _doFetch() {
    try {
      var base = '';
      if (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) {
        base = CONFIG.API_BASE.replace('/api', '');
      }
      var r = await fetch(base + '/api/model-guard/config', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      console.log('[ModelGuard] 配置已更新:', JSON.stringify(d.config));
      return d.config || FALLBACK;
    } catch (e) {
      console.error('[ModelGuard] 请求异常:', e);
      return FALLBACK;
    }
  }

  // ========== 核心方法 ==========

  /**
   * 加载前检查：是否应该加载这个远程模型？
   * @param {string} url GLB URL
   * @param {object} ctx { characterId, characterGroup, nameSprite, isSelf }
   */
  async function shouldLoadRemoteModel(url, ctx) {
    var cfg = await fetchConfig();
    if (!cfg.enabled) return { shouldLoad: true };
    if (ctx.isSelf) return { shouldLoad: true };

    try {
      var ctrl = new AbortController();
      var tid = setTimeout(function() { ctrl.abort(); }, 5000);
      var resp = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(tid);

      if (!resp.ok) return { shouldLoad: false, reason: '无法获取模型信息' };

      var len = parseInt(resp.headers.get('content-length') || '0', 10);
      var mb = len / (1024 * 1024);

      // 更新统计
      stats.totalSize += mb;
      stats.sizeCount++;
      stats.passed++;

      if (len > cfg.max_file_size * 1024 * 1024) {
        console.warn('[ModelGuard] 拒绝加载: ' + mb.toFixed(1) + 'MB > ' + cfg.max_file_size + 'MB');
        stats.passed--;
        stats.blocked++;
        return {
          shouldLoad: false,
          reason: '模型过大 (' + mb.toFixed(1) + 'MB > ' + cfg.max_file_size + 'MB)'
        };
      }

      return { shouldLoad: true };
    } catch (e) {
      console.warn('[ModelGuard] 预检异常，放行:', e.message);
      return { shouldLoad: true }; // 网络问题放行
    }
  }

  /**
   * 加载后验证：模型复杂度是否超标？
   * @param {THREE.Object3D} scene gltf.scene
   * @param {object} ctx { characterId, characterGroup, isSelf }
   */
  function validateLoadedModel(scene, ctx) {
    var cfg = currentConfig || FALLBACK;
    if (!cfg.enabled || ctx.isSelf) return { safe: true };

    var tri = 0, vert = 0, meshN = 0;

    scene.traverse(function(c) {
      if (c.isMesh && c.geometry) {
        meshN++;
        var g = c.geometry;
        var pa = g.getAttribute('position');
        if (pa) vert += pa.count;
        var ia = g.getIndex();
        tri += ia ? Math.floor(ia.count / 3) : (pa ? Math.floor(pa.count / 3) : 0);
      }
    });

    var st = { triangles: tri, vertices: vert, meshCount: meshN };
    console.log('[ModelGuard] 复杂度:', JSON.stringify(st));

    var violations = [];
    if (tri > cfg.max_triangles) violations.push('三角' + tri.toLocaleString());
    if (vert > cfg.max_vertices) violations.push('顶点' + vert.toLocaleString());
    if (meshN > cfg.max_mesh_count) violations.push('Mesh×' + meshN);

    if (violations.length > 0) {
      stats.blocked++;
      return {
        safe: false,
        stats: st,
        reason: '复杂度过高 [' + violations.join(', ') + ']'
      };
    }

    return { safe: true, stats: st };
  }

  /**
   * 创建占位符替换当前模型
   * @param {THREE.Group} group 角色组
   */
  function createPlaceholder(group) {
    if (!group) return;
    console.log('[ModelGuard] 生成占位符');

    // 清除现有 mesh
    var rm = [];
    group.traverse(function(c) {
      if (c.isMesh || c.type === 'SkinnedMesh') rm.push(c);
    });

    var keep = new Set();
    if (group.userData.nameSprite) keep.add(group.userData.nameSprite);
    if (group.userData.weaponGroup) keep.add(group.userData.weaponGroup);

    rm.forEach(function(c) {
      if (!keep.has(c)) {
        if (c.parent) c.parent.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (Array.isArray(c.material)) {
          c.material.forEach(function(m) { if (m) m.dispose(); });
        } else if (c.material) {
          c.material.dispose();
        }
      }
    });

    var style = (currentConfig || {}).placeholder_style || 'stickman';
    var ph = buildFigure(style);
    group.add(ph);

    group.userData.isPlaceholder = true;
    group.userData.glbModel = ph;
  }

  // ========== 占位符构建 ==========

  function buildFigure(style) {
    var g = new THREE.Group();
    g.name = 'mg-placeholder';
    switch (style) {
      case 'sphere': return _sphere(g);
      case 'block': return _block(g);
      default: return _stickman(g);
    }
  }

  function _stickman(g) {
    var m = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.6, metalness: 0.1 });
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), m);
    head.position.y = 1.65; g.add(head);

    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.55, 6), m);
    torso.position.y = 1.25; g.add(torso);

    var limbGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6);
    var positions = [[-0.18, 1.45, 0.15], [0.18, 1.45, -0.15], [-0.08, 0.78, 0], [0.08, 0.78, 0]];
    positions.forEach(function(p) {
      var l = new THREE.Mesh(limbGeo, m);
      l.position.set(p[0], p[1], 0);
      l.rotation.z = p[2];
      g.add(l);
    });
    return g;
  }

  function _block(g) {
    var m = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.8 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.25), m);
    body.position.y = 0.8; g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), m);
    head.position.y = 1.75; g.add(head);
    return g;
  }

  function _sphere(g) {
    var m = new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.5 });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), m);
    body.position.y = 0.9; body.scale.y = 1.5; g.add(body);
    return g;
  }

  // ========== 公共 API ==========
  return {
    fetchConfig: fetchConfig,
    forceRefreshConfig: function() { return fetchConfig(true); },
    getCurrentConfig: function() { return currentConfig; },
    getStats: function() { return stats; },
    shouldLoadRemoteModel: shouldLoadRemoteModel,
    validateLoadedModel: validateLoadedModel,
    createPlaceholder: createPlaceholder
  };
})();

// 全局暴露
window.RemoteModelGuard = RemoteModelGuard;
