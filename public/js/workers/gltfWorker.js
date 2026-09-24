/**
 * gltfWorker.js —— GLB 解析 Worker（会话2：Worker 化 GLB 解析）
 * ------------------------------------------------------------------
 * 把 GLTFLoader.parse（每个 50~300ms 的主线程大停顿）搬进 Worker：
 *   worker 内 parse → 校验可序列化 → 拆成 transferable（属性数组/ImageBitmap）
 *   → 主线程只做 1~3ms 的 BufferGeometry/Material 组装。
 *
 * 协议：
 *   入：{ type:'parse', id, buffer(ArrayBuffer, transfer), dracoPath,
 *         static, strict, maxTexSize }
 *   出：{ type:'ok',    id, payload, transfer }   payload=可组装的序列化模型
 *       { type:'fb',    id, reason }              不可序列化（主线程回退）
 *       { type:'err',   id, message }             parse 失败，主线程回退
 *
 * 不可序列化判定（宁可回退，不可错渲染）：【非 strict 模式】动画、骨骼/蒙皮、
 *   morph、Interleaved 属性、非 MeshStandardMaterial、Points/Line。
 *   strict 模式（二期B 玩家模型专用）：允许并完整序列化 骨骼/Bone 节点树/
 *   SkinnedMesh(skeleton+IBM+bindMatrix)/AnimationClip（times/values 传输）。
 * meshopt（gltfpack -cc）用动态 import 加载 ESM 解码器；Draco 用本地 wasm 目录。
 */
'use strict';

// esbuild bundle 的 banner 带有 typeof document 守卫，worker 内可直接 importScripts
importScripts('/js/lib/three.min.js');

var MESHOPT_URL = '/js/libs/meshopt/meshopt_decoder.module.js';
var meshoptReady = null;

/** 动态 import ESM 解码器（classic worker 支持 import()），失败返回 null（触发主线程回退） */
function ensureMeshopt() {
  if (meshoptReady) return meshoptReady;
  meshoptReady = import(MESHOPT_URL)
    .then(function (m) { return (m && m.MeshoptDecoder) || null; })
    .catch(function () { return null; });
  return meshoptReady;
}

/** 构建一个带 Draco+Meshopt 的 GLTFLoader */
function buildLoader(dracoPath) {
  var loader = new THREE.GLTFLoader();
  try {
    var draco = new THREE.DRACOLoader();
    draco.setDecoderPath(dracoPath || '/js/libs/draco/');
    loader.setDRACOLoader(draco);
  } catch (e) { /* draco 不可用时无 draco 模型仍可解析 */ }
  return loader;
}

function parseAsync(loader, buffer) {
  return new Promise(function (resolve, reject) {
    try {
      loader.parse(buffer, '', resolve, reject);
    } catch (e) { reject(e); }
  });
}

/* ---------------- 纹理预降级（worker 内 OffscreenCanvas，主线程零 Canvas 开销） ----------------
 * 与 worldTextureOptimizer 的 1024px 策略对齐：worker 侧先降好，主线程 downsizeSceneTextures
 * 检测到纹理已 ≤1024 会整体跳过（不再有主线程 drawImage 重采样的长帧），transfer 体量也同步减小。
 * 【二期B】strict 模式（玩家模型）传 maxTexSize=Infinity：纹理保持原分辨率不降级
 *（玩家模型路径本就不走降级管线，§7.3-6；降级档位若将来接入必须并入缓存 key）。 */
var TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'specularMap'];

async function downscaleGltfTextures(gltf, maxTexSize) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return;
  if (maxTexSize === Infinity) return; // strict（玩家模型）：不降级，保持原分辨率
  var MAX_TEX_SIZE = (typeof maxTexSize === 'number' && isFinite(maxTexSize) && maxTexSize > 0) ? maxTexSize : 1024;
  var texSet = new Set();
  gltf.scene.traverse(function (o) {
    if (!o.isMesh || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m) continue;
      for (var s = 0; s < TEX_SLOTS.length; s++) {
        var t = m[TEX_SLOTS[s]];
        if (t && t.image && t.image.width) texSet.add(t);
      }
    }
  });
  if (texSet.size === 0) return;
  var jobs = [];
  texSet.forEach(function (t) {
    var img = t.image;
    if (Math.max(img.width, img.height) > MAX_TEX_SIZE) jobs.push(t);
  });
  for (var i = 0; i < jobs.length; i++) {
    var tex = jobs[i];
    var img = tex.image;
    try {
      var ratio = MAX_TEX_SIZE / Math.max(img.width, img.height);
      var w = Math.max(1, Math.round(img.width * ratio));
      var h = Math.max(1, Math.round(img.height * ratio));
      var canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      tex.image = await createImageBitmap(canvas);
    } catch (e) { /* 单张失败保留原图 */ }
  }
}

/* ---------------- 序列化（仅可安全重建的子集，其余回退） ---------------- */

function serializeGltf(gltf, staticMode, strictMode) {
  // static 模式（世界对象专用）：世界管线本来就把蒙皮烘焙为静态、不播世界对象动画
  //（world.js _bakeSkinsToStatic），因此动画可安全丢弃、SkinnedMesh 按静态网格序列化。
  // strict 模式（二期B 玩家模型专用）：动画/骨骼/蒙皮 允许并完整序列化。
  if (!staticMode && !strictMode && gltf.animations && gltf.animations.length > 0) throw { fallback: 'animations' };

  var textures = [];   // { id, imageId, colorSpace, wrapS, wrapT, repeat, offset, rotation }
  var texIds = new Map();
  var images = [];     // { id, bitmap } —— 多个 Texture 可共享同一 ImageBitmap，必须去重
  var imageIds = new Map();
  function imageId(img) {
    if (!imageIds.has(img)) {
      imageIds.set(img, images.length);
      images.push({ id: images.length, bitmap: img });
    }
    return imageIds.get(img);
  }
  function texId(t) {
    if (!t) return -1;
    if (!t.image || typeof t.image.width !== 'number') throw { fallback: 'texture-image' };
    if (!texIds.has(t.uuid)) {
      texIds.set(t.uuid, textures.length);
      textures.push({
        id: textures.length,
        imageId: imageId(t.image),
        colorSpace: t.colorSpace || '',
        wrapS: t.wrapS, wrapT: t.wrapT,
        repeat: [t.repeat.x, t.repeat.y],
        offset: [t.offset.x, t.offset.y],
        rotation: t.rotation
      });
    }
    return texIds.get(t.uuid);
  }

  var materials = [];
  var matIds = new Map();
  function matId(m) {
    if (!m) return -1;
    if (matIds.has(m.uuid)) return matIds.get(m.uuid);
    if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshPhysicalMaterial') throw { fallback: 'material:' + m.type };
    var id = materials.length;
    matIds.set(m.uuid, id);
    var entry = {
      type: m.type,
      name: m.name || '',
      color: m.color.getHex(),
      metalness: m.metalness,
      roughness: m.roughness,
      emissive: m.emissive.getHex(),
      emissiveIntensity: m.emissiveIntensity,
      opacity: m.opacity,
      transparent: m.transparent,
      alphaTest: m.alphaTest,
      side: m.side,
      vertexColors: m.vertexColors,
      depthWrite: m.depthWrite,
      map: texId(m.map),
      normalMap: texId(m.normalMap),
      normalScale: [m.normalScale.x, m.normalScale.y],
      roughnessMap: texId(m.roughnessMap),
      metalnessMap: texId(m.metalnessMap),
      aoMap: texId(m.aoMap),
      aoMapIntensity: m.aoMapIntensity,
      emissiveMap: texId(m.emissiveMap)
    };
    if (m.type === 'MeshPhysicalMaterial') {
      entry.physical = {
        clearcoat: m.clearcoat,
        clearcoatRoughness: m.clearcoatRoughness,
        transmission: m.transmission,
        thickness: m.thickness,
        ior: m.ior,
        specularIntensity: m.specularIntensity,
        specularColor: m.specularColor.getHex(),
        sheen: m.sheen,
        sheenColor: m.sheenColor.getHex(),
        sheenRoughness: m.sheenRoughness,
        attenuationColor: m.attenuationColor.getHex(),
        attenuationDistance: m.attenuationDistance
      };
    }
    materials.push(entry);
    return id;
  }

  var geometries = [];
  var geoIds = new Map();
  var interleaved = [];              // 去重后的交错缓冲 { id, array, stride, offset }
  var ibIds = new Map();
  function ibId(data) {
    if (!ibIds.has(data.uuid)) {
      ibIds.set(data.uuid, interleaved.length);
      interleaved.push({ id: interleaved.length, array: data.array, stride: data.stride, offset: data.offset || 0 });
    }
    return ibIds.get(data.uuid);
  }
  function serializeGeometry(mesh) {
    var g = mesh.geometry;
    if (!g) throw { fallback: 'no-geometry' };
    if (geoIds.has(g.uuid)) return geoIds.get(g.uuid);
    // morph 目标（r185 渲染器按 geometry.morphAttributes 自动派生，材质无需标记）
    var morph = null;
    if (g.morphAttributes) {
      var ma = null;
      for (var k in g.morphAttributes) {
        var arr = g.morphAttributes[k];
        if (!arr || !arr.length) continue;
        if (!ma) ma = {};
        ma[k] = arr.map(function (a) {
          if (!a.isInterleavedBufferAttribute) return { array: a.array, itemSize: a.itemSize, normalized: !!a.normalized };
          // 交错 morph 目标：worker 内解交错拷贝（仅此处需要拷贝，量级可控）
          var count = a.count;
          var out = new a.data.array.constructor(count * a.itemSize);
          for (var i = 0; i < count; i++) {
            for (var j = 0; j < a.itemSize; j++) {
              out[i * a.itemSize + j] = a.data.array[i * a.data.stride + a.offset + j];
            }
          }
          return { array: out, itemSize: a.itemSize, normalized: !!a.normalized };
        });
      }
      if (ma) morph = { attrs: ma, relative: !!g.morphTargetsRelative };
    }
    var attrs = {};
    for (var name in g.attributes) {
      var a = g.attributes[name];
      if (!a) throw { fallback: 'null-attr:' + name };
      // 交错属性（gltfpack -cc 常见）：零拷贝传回交错缓冲，主线程重建 InterleavedBufferAttribute
      if (a.isInterleavedBufferAttribute) {
        attrs[name] = {
          interleaved: ibId(a.data),
          itemSize: a.itemSize,
          offset: a.offset || 0,
          normalized: !!a.normalized
        };
      } else {
        attrs[name] = { array: a.array, itemSize: a.itemSize, normalized: !!a.normalized };
      }
    }
    if (!attrs.position) throw { fallback: 'no-position' };
    var entry = {
      id: geometries.length,
      attributes: attrs,
      morph: morph,
      index: g.index ? { array: g.index.array } : null,
      groups: (g.groups && g.groups.length) ? g.groups.map(function (gr) { return { start: gr.start, count: gr.count, materialIndex: gr.materialIndex }; }) : null,
      boundingSphere: null,
      boundingBox: null
    };
    try {
      g.computeBoundingBox(); g.computeBoundingSphere();
      if (g.boundingBox) entry.boundingBox = { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
      if (g.boundingSphere) entry.boundingSphere = { center: g.boundingSphere.center.toArray(), radius: g.boundingSphere.radius };
    } catch (e) { /* 主线程兜底再算 */ }
    geoIds.set(g.uuid, entry.id);
    geometries.push(entry);
    return entry.id;
  }

  function meshEntry(mesh) {
    if (mesh.isSkinnedMesh && !staticMode && !strictMode) throw { fallback: 'skinned' };
    if (!mesh.isMesh) throw { fallback: 'objtype:' + mesh.type };
    var matIdx;
    if (Array.isArray(mesh.material)) matIdx = mesh.material.map(matId);
    else matIdx = matId(mesh.material);
    var entry = { geo: serializeGeometry(mesh), mat: matIdx };
    if (mesh.isSkinnedMesh && strictMode) {
      // 【二期B】蒙皮绑定数据：skeleton（骨索引 + IBM）+ bindMatrix 全套
      if (!mesh.skeleton || !mesh.skeleton.bones || !mesh.skeleton.bones.length) throw { fallback: 'empty-skeleton' };
      entry.skinned = {
        skel: skelId(mesh.skeleton),
        bindMatrix: mesh.bindMatrix.toArray(),
        bindMatrixInverse: mesh.bindMatrixInverse.toArray(),
        bindMode: (typeof mesh.bindMode === 'string') ? mesh.bindMode : (mesh.bindMode === 1 ? 'detached' : 'attached')
      };
    }
    return entry;
  }

  /* 【二期B strict】节点索引预分配：骨架 bones 按节点序号引用（骨骼可能晚于
   * SkinnedMesh 被遍历，索引必须先于序列化建立） */
  var nodeIndices = new Map();
  var animationsOut = [];
  var skeletons = [];
  var skelIds = new Map();
  function skelId(s) {
    if (!s || !s.bones || !s.bones.length) return -1;
    if (skelIds.has(s.uuid)) return skelIds.get(s.uuid);
    var id = skeletons.length;
    var bones = s.bones.map(function (b) {
      var idx = nodeIndices.get(b);
      if (idx === undefined) throw { fallback: 'bone-outside-scene' }; // 骨不在场景树（理论不出现，宁可回退）
      return idx;
    });
    var inverses = s.boneInverses.map(function (m) { return m.toArray(); });
    skeletons.push({ id: id, bones: bones, boneInverses: inverses });
    skelIds.set(s.uuid, id);
    return id;
  }

  /** 【二期B strict】AnimationClip 序列化：times/values 是 TypedArray（进 transfer），
   * string/boolean 轨道的 values 是普通数组（走结构化克隆）。ValueTypeName 精确映射回轨道类。 */
  function serializeClip(clip) {
    return {
      name: clip.name || '',
      duration: clip.duration,
      tracks: (clip.tracks || []).map(function (t) {
        var e = { name: t.name, valueType: t.ValueTypeName, times: t.times, values: t.values };
        if (t.blendMode !== undefined && t.blendMode !== null) e.blendMode = t.blendMode;
        return e;
      })
    };
  }

  // 递归序列化节点树
  var transfer = [];
  var seenBuf = new Set();
  function pushBuf(b) {
    // GLTFLoader 的属性数组常共享同一底层 ArrayBuffer（subarray 视图），transfer 列表必须去重
    if (b && !seenBuf.has(b)) { seenBuf.add(b); transfer.push(b); }
  }
  function collectTransfer() {
    geometries.forEach(function (g) {
      for (var n in g.attributes) {
        var a = g.attributes[n];
        if (a.interleaved !== undefined) continue; // 交错缓冲的 transfer 在 interleaved 列表统一处理
        pushBuf(a.array.buffer);
      }
      if (g.index) pushBuf(g.index.array.buffer);
      if (g.morph) {
        for (var k in g.morph.attrs) {
          g.morph.attrs[k].forEach(function (a) { pushBuf(a.array.buffer); });
        }
      }
    });
    interleaved.forEach(function (ib) { pushBuf(ib.array.buffer); });
    animationsOut.forEach(function (c) {
      c.tracks.forEach(function (t) {
        if (t.times && t.times.buffer) pushBuf(t.times.buffer);
        if (t.values && t.values.buffer) pushBuf(t.values.buffer);
      });
    });
    images.forEach(function (im) { transfer.push(im.bitmap); });
    return transfer;
  }

  function node(n) {
    if (n.isBone && !staticMode && !strictMode) throw { fallback: 'bone' };
    if (!n.isMesh && !n.isObject3D) throw { fallback: 'objtype:' + n.type };
    var out = {
      name: n.name || '',
      type: (n.isMesh ? 'mesh' : 'group'),
      pos: n.position.toArray(),
      quat: n.quaternion.toArray(),
      scale: n.scale.toArray(),
      visible: n.visible,
      userData: null,
      children: []
    };
    if (strictMode) out.i = nodeIndices.get(n);
    try {
      out.userData = n.userData && Object.keys(n.userData).length ? JSON.parse(JSON.stringify(n.userData)) : null;
    } catch (e) { out.userData = null; }
    if (n.isMesh) {
      var me = meshEntry(n);
      out.geo = me.geo;
      out.mat = me.mat;
      if (me.skinned) {
        out.type = 'skinned';
        out.skinned = me.skinned;
      }
    }
    if (strictMode && n.isBone) out.type = 'bone';
    for (var i = 0; i < n.children.length; i++) out.children.push(node(n.children[i]));
    return out;
  }

  var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!root) throw { fallback: 'no-scene' };
  if (strictMode) {
    (function walk(n) {
      nodeIndices.set(n, nodeIndices.size);
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
    })(root);
    animationsOut = (gltf.animations || []).map(serializeClip);
  }
  var payload = { root: node(root), images: images, textures: textures, materials: materials, geometries: geometries, interleaved: interleaved };
  if (strictMode) {
    payload.skeletons = skeletons;
    payload.animations = animationsOut;
  }
  payload.transfer = collectTransfer();
  return payload;
}

/* ---------------- 消息处理 ---------------- */

self.addEventListener('message', function (e) {
  var msg = e.data;
  if (!msg || msg.type !== 'parse') return;

  Promise.resolve()
    .then(function () { return ensureMeshopt(); })
    .then(function (dec) {
      var loader = buildLoader(msg.dracoPath);
      if (dec) loader.setMeshoptDecoder(dec);
      return parseAsync(loader, msg.buffer);
    })
    .then(function (gltf) {
      return downscaleGltfTextures(gltf, msg.maxTexSize).then(function () { return gltf; });
    })
    .then(function (gltf) {
      try {
        var payload = serializeGltf(gltf, !!msg.static, !!msg.strict);
        self.postMessage({ type: 'ok', id: msg.id, payload: payload, transfer: payload.transfer }, payload.transfer);
      } catch (fb) {
        if (fb && fb.fallback) self.postMessage({ type: 'fb', id: msg.id, reason: fb.fallback });
        else self.postMessage({ type: 'err', id: msg.id, message: String(fb && fb.message || fb) });
      }
    })
    .catch(function (err) {
      self.postMessage({ type: 'err', id: msg.id, message: String(err && err.message || err) });
    });
});
