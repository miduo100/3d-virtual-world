/**
 * gltfWorkerClient.js —— GLB Worker 解析的主线程客户端（会话2）
 * ------------------------------------------------------------------
 * 对 world.js 暴露唯一入口：
 *   GltfWorkerClient.parseBuffer(arrayBuffer, { fallbackLoader })
 *     → Promise<{ scene: Object3D }>   // 与 gltf.scene 同构，onComplete(gltf) 兼容
 *
 * 路径：
 *   1) 首选 Worker 解析（主线程零停顿），拿到 transferable 后 1~3ms 组装；
 *   2) worker 返回 fb（动画/蒙皮/morph/特殊材质）或 err/超时/创建失败
 *      → 用 fallbackLoader（已配好 Draco+Meshopt 的共享 GLTFLoader）主线程 parse 兜底；
 *   3) worker 端脚本加载失败（onerror）→ 本会话内永久走兜底，不再重试。
 *
 * 保留原 buffer（传给 worker 的是副本），兜底 parse 仍可用原始数据。
 */
(function () {
  'use strict';
  if (window.GltfWorkerClient) return;

  var DEFAULT_WORKER_URL = '/js/workers/gltfWorker.js?v=2';
  var PARSE_TIMEOUT_MS = 30000;

  /* ---------------- 客户端工厂（二期B）----------------
   * createClient() 返回隔离实例（各自的 Worker/序号/统计）。
   * 玩家模板解析（gltfTemplateCache）用专用实例，避免与场景 GLB 队列
   * 争用同一个 Worker（实测在线玩家 28MB 模型 + 场景大 GLB 会把 0.76MB
   * 角色模型排队挤到 +7s）。默认实例供 world.js 场景路径继续使用。 */
  function createClient(workerUrl) {
    var WORKER_URL = workerUrl || DEFAULT_WORKER_URL;

    var worker = null;
    var workerBroken = false;
    var seq = 0;
    var pending = new Map();   // id -> { resolve, reject }
    var stats = { worker: 0, fallback: 0, failed: 0 };

    function ensureWorker() {
      if (workerBroken) return null;
      if (worker) return worker;
      try {
        worker = new Worker(WORKER_URL);
        worker.onmessage = onMessage;
        worker.onerror = function (e) {
          // 脚本级失败：拒绝全部在途请求（走兜底），本会话不再尝试 worker
          workerBroken = true;
          pending.forEach(function (p) { p.reject(new Error('worker script error')); });
          pending.clear();
          try { console.warn('[GltfWorkerClient] worker 不可用，后续解析走主线程兜底'); } catch (err) {}
        };
        return worker;
      } catch (e) {
        workerBroken = true;
        return null;
      }
    }

    function onMessage(e) {
      var msg = e.data;
      if (!msg || !msg.type) return;
      var p = pending.get(msg.id);
      if (msg.type !== 'ok') {
        if (p) {
          if (msg.type === 'fb') { try { console.info('[GltfWorkerClient] 回退主线程解析:', msg.reason); } catch (e) {} }
          else { try { console.warn('[GltfWorkerClient] worker 解析失败，回退主线程:', msg.message); } catch (e) {} }
          pending.delete(msg.id);
          p.reject(Object.assign(new Error(msg.message || 'fallback'), { fallback: msg.type === 'fb' }));
        }
        return;
      }
      if (!p) return; // 超时后迟到：丢弃（buffer 已 transfer，无泄漏）
      pending.delete(msg.id);
      try {
        var scene = buildScene(msg.payload);
        p.resolve({ scene: scene, animations: buildAnimations(msg.payload), __viaWorker: true });
      } catch (err) {
        p.reject(err);
      }
    }

    function parseBuffer(buffer, opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        var fallbackParse = function () {
          try {
            if (!opts.fallbackLoader) { stats.failed++; reject(new Error('no fallback loader')); return; }
            opts.fallbackLoader.parse(buffer, '', function (gltf) {
              stats.fallback++;
              resolve({ scene: gltf.scene, animations: gltf.animations || [], __viaWorker: false });
            }, function (err) {
              stats.failed++;
              reject(err);
            });
          } catch (e) { stats.failed++; reject(e); }
        };

        var w = ensureWorker();
        if (!w || workerBroken) { fallbackParse(); return; }

        var id = ++seq;
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          pending.delete(id);
          fallbackParse();               // worker 超时 → 主线程兜底
        }, PARSE_TIMEOUT_MS);

        pending.set(id, {
          resolve: function (result) { if (settled) return; settled = true; clearTimeout(timer); stats.worker++; resolve(result); },
          reject: function (err) { if (settled) return; settled = true; clearTimeout(timer); fallbackParse(); }
        });

        try {
          var copy = buffer.slice(0);      // 副本 transfer 给 worker，原 buffer 留给兜底
          w.postMessage({ type: 'parse', id: id, buffer: copy, dracoPath: '/js/libs/draco/', static: !!opts.static, strict: !!opts.strict, maxTexSize: opts.maxTexSize }, [copy]);
        } catch (e) {
          settled = true; clearTimeout(timer); pending.delete(id);
          fallbackParse();
        }
      });
    }

    return {
      parseBuffer: parseBuffer,
      stats: function () { return Object.assign({}, stats, { pending: pending.size, workerBroken: workerBroken }); }
    };
  }

  /* ---------------- 主线程组装 ---------------- */

  var SRGB = 'srgb';

  function buildTexture(t, bitmap) {
    var tex = new THREE.Texture(bitmap);
    tex.flipY = false;                       // GLTF 约定
    tex.colorSpace = t.colorSpace || '';
    tex.wrapS = t.wrapS; tex.wrapT = t.wrapT;
    if (t.repeat) tex.repeat.set(t.repeat[0], t.repeat[1]);
    if (t.offset) tex.offset.set(t.offset[0], t.offset[1]);
    if (t.rotation) tex.rotation = t.rotation;
    tex.needsUpdate = true;
    return tex;
  }

  function buildMaterials(payload) {
    var imgMap = new Map();
    (payload.images || []).forEach(function (im) { imgMap.set(im.id, im.bitmap); });
    var texMap = new Map();
    (payload.textures || []).forEach(function (t) { texMap.set(t.id, buildTexture(t, imgMap.get(t.imageId))); });
    function texOf(id) { return id >= 0 ? (texMap.get(id) || null) : null; }

    return (payload.materials || []).map(function (m) {
      var mat = new (THREE[m.type] || THREE.MeshStandardMaterial)({
        name: m.name,
        color: m.color,
        metalness: m.metalness,
        roughness: m.roughness,
        emissive: m.emissive,
        emissiveIntensity: m.emissiveIntensity,
        opacity: m.opacity,
        transparent: m.transparent,
        alphaTest: m.alphaTest,
        side: m.side,
        vertexColors: m.vertexColors,
        depthWrite: m.depthWrite
      });
      if (m.physical) {
        var p = m.physical;
        mat.clearcoat = p.clearcoat;
        mat.clearcoatRoughness = p.clearcoatRoughness;
        mat.transmission = p.transmission;
        mat.thickness = p.thickness;
        mat.ior = p.ior;
        mat.specularIntensity = p.specularIntensity;
        mat.specularColor = new THREE.Color(p.specularColor);
        mat.sheen = p.sheen;
        mat.sheenColor = new THREE.Color(p.sheenColor);
        mat.sheenRoughness = p.sheenRoughness;
        mat.attenuationColor = new THREE.Color(p.attenuationColor);
        mat.attenuationDistance = p.attenuationDistance;
      }
      var map = texOf(m.map);
      if (map) { mat.map = map; if (map.colorSpace !== SRGB) { map.colorSpace = SRGB; map.needsUpdate = true; } }
      var nm = texOf(m.normalMap);
      if (nm) { mat.normalMap = nm; mat.normalScale = new THREE.Vector2(m.normalScale[0], m.normalScale[1]); }
      mat.roughnessMap = texOf(m.roughnessMap);
      mat.metalnessMap = texOf(m.metalnessMap);
      var ao = texOf(m.aoMap);
      if (ao) { mat.aoMap = ao; mat.aoMapIntensity = m.aoMapIntensity; }
      var em = texOf(m.emissiveMap);
      if (em) { mat.emissiveMap = em; if (em.colorSpace !== SRGB) { em.colorSpace = SRGB; em.needsUpdate = true; } }
      return mat;
    });
  }

  function buildGeometries(payload) {
    // 交错缓冲去重重建（多个属性共享同一 InterleavedBuffer，与 GLTFLoader 行为一致）
    var ibMap = new Map();
    (payload.interleaved || []).forEach(function (ib) {
      var buf = new THREE.InterleavedBuffer(ib.array, ib.stride);
      ibMap.set(ib.id, buf);
    });

    return (payload.geometries || []).map(function (g) {
      var geo = new THREE.BufferGeometry();
      for (var name in g.attributes) {
        var a = g.attributes[name];
        if (a.interleaved !== undefined) {
          var ib = ibMap.get(a.interleaved);
          geo.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, a.itemSize, a.offset, a.normalized));
        } else {
          geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
        }
      }
      if (g.index) geo.setIndex(new THREE.BufferAttribute(g.index.array, 1));
      if (g.morph) {
        for (var k in g.morph.attrs) {
          geo.morphAttributes[k] = g.morph.attrs[k].map(function (a) {
            return new THREE.BufferAttribute(a.array, a.itemSize, a.normalized);
          });
        }
        geo.morphTargetsRelative = !!g.morph.relative;
      }
      if (g.groups) g.groups.forEach(function (gr) { geo.addGroup(gr.start, gr.count, gr.materialIndex); });
      try {
        if (g.boundingBox) {
          geo.boundingBox = new THREE.Box3(
            new THREE.Vector3().fromArray(g.boundingBox.min),
            new THREE.Vector3().fromArray(g.boundingBox.max)
          );
        }
        if (g.boundingSphere) {
          geo.boundingSphere = new THREE.Sphere(
            new THREE.Vector3().fromArray(g.boundingSphere.center),
            g.boundingSphere.radius
          );
        }
      } catch (e) { /* 组装异常时主流程 computeBoundingSphere 兜底 */ }
      return geo;
    });
  }

  function buildScene(payload) {
    if (!window.THREE) throw new Error('THREE not ready');
    var mats = buildMaterials(payload);
    var geos = buildGeometries(payload);

    function matFor(matIdx) {
      if (Array.isArray(matIdx)) {
        var arr = matIdx.map(function (i) { return i >= 0 ? mats[i] : null; });
        return arr;
      }
      return matIdx >= 0 ? mats[matIdx] : null;
    }

    /* 【二期B strict】节点序号 → 已构建 Object3D（骨架 bones 按索引引用） */
    var nodesByIdx = [];

    function buildNode(n) {
      var obj;
      if (n.type === 'skinned') {
        obj = new THREE.SkinnedMesh(geos[n.geo], matFor(n.mat));
        if (n.skinned) {
          obj.__skel = n.skinned.skel;
          if (n.skinned.bindMatrix) obj.__bindMatrix = n.skinned.bindMatrix;
          if (n.skinned.bindMatrixInverse) obj.__bindMatrixInverse = n.skinned.bindMatrixInverse;
          obj.bindMode = n.skinned.bindMode || 'attached';
        }
      } else if (n.type === 'bone') {
        obj = new THREE.Bone();
      } else if (n.type === 'mesh') {
        obj = new THREE.Mesh(geos[n.geo], matFor(n.mat));
      } else {
        obj = new THREE.Group();
      }
      obj.name = n.name || '';
      obj.position.fromArray(n.pos);
      obj.quaternion.fromArray(n.quat);
      obj.scale.fromArray(n.scale);
      obj.visible = n.visible;
      if (n.userData) obj.userData = n.userData;
      if (n.i !== undefined) nodesByIdx[n.i] = obj;
      for (var i = 0; i < n.children.length; i++) obj.add(buildNode(n.children[i]));
      return obj;
    }

    var scene = buildNode(payload.root);

    /* 【二期B strict】骨架绑定：先建 Skeleton（bones 按 node 索引取回 + IBM），
     * 再给每个 SkinnedMesh bind()（bindMatrix/bindMatrixInverse 精确还原 GLTFLoader 产物） */
    if (payload.skeletons && payload.skeletons.length) {
      var skeletons = payload.skeletons.map(function (s) {
        var bones = s.bones.map(function (i) { return nodesByIdx[i]; });
        var inverses = s.boneInverses.map(function (m) { return new THREE.Matrix4().fromArray(m); });
        return new THREE.Skeleton(bones, inverses);
      });
      scene.traverse(function (o) {
        if (o.isSkinnedMesh && o.__skel != null && skeletons[o.__skel]) {
          var bm = o.__bindMatrix ? new THREE.Matrix4().fromArray(o.__bindMatrix) : undefined;
          o.bind(skeletons[o.__skel], bm);
          if (o.__bindMatrixInverse) o.bindMatrixInverse.fromArray(o.__bindMatrixInverse);
          delete o.__skel; delete o.__bindMatrix; delete o.__bindMatrixInverse;
        }
      });
    }

    // 兜底：任何缺失包围盒的几何体现在补算（正常已在 worker 算好，零成本）
    scene.traverse(function (o) {
      if (o.isMesh && o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    });
    return scene;
  }

  /* 【二期B strict】AnimationClip 重建：ValueTypeName 精确映射回轨道类 */
  var TRACK_CLASS = null;
  function trackClass(vt) {
    if (!TRACK_CLASS) {
      TRACK_CLASS = {
        vector: THREE.VectorKeyframeTrack,
        quaternion: THREE.QuaternionKeyframeTrack,
        number: THREE.NumberKeyframeTrack,
        color: THREE.ColorKeyframeTrack,
        string: THREE.StringKeyframeTrack,
        boolean: THREE.BooleanKeyframeTrack
      };
    }
    return TRACK_CLASS[vt] || null;
  }
  function buildAnimations(payload) {
    return (payload.animations || []).map(function (c) {
      var tracks = [];
      (c.tracks || []).forEach(function (t) {
        var C = trackClass(t.valueType);
        if (!C) return; // 未知轨道类型：跳过该轨道（宁可少一条轨道也不错渲染）
        var tr = new C(t.name, t.times, t.values);
        if (t.blendMode !== undefined && t.blendMode !== null) tr.blendMode = t.blendMode;
        tracks.push(tr);
      });
      return new THREE.AnimationClip(c.name, c.duration, tracks);
    });
  }

  /* ---------------- 对外入口 ---------------- */

  var defaultClient = createClient();

  window.GltfWorkerClient = {
    /** 默认实例（world.js 场景模型路径沿用） */
    parseBuffer: defaultClient.parseBuffer,
    stats: defaultClient.stats,
    /** 【二期B】创建隔离实例（专用 Worker）——玩家模板解析用，避免与场景队列争用 */
    create: createClient,
  };
})();
