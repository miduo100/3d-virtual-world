/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * npcAnimator.js —— 让摆在世界里的角色模型保留骨骼并播放 Idle
 *
 * ── 要解决的问题 ──────────────────────────────────────────────
 * world.js 的 World.prototype._addModelToScene 会无条件调用 _bakeSkinsToStatic，
 * 该函数做了三件事：
 *   1. node.isSkinnedMesh = false（降级为静态网格）
 *   2. material.skinning = false
 *   3. 从场景树里 remove 掉所有 Bone 节点
 * 当初是为了修 LittlestTokyo 那类大场景的「幻影石头 / 视锥剔除闪烁」。
 * 副作用：任何自带骨骼动画的角色，一旦摆进世界就永久定格在 bind pose（T-pose 雕像），
 * 因为骨头已经不在树上了 —— 播动作也驱动不到任何东西。
 *
 * ── 本模块怎么做 ──────────────────────────────────────────────
 * 不修改 world.js 一个字符，全部从外部接管：
 *   1. 覆盖 World.prototype._bakeSkinsToStatic：
 *      识别出「这是角色」（有 Hips 骨 + 骨骼数 ≥15 + 蒙皮网格 1~4 个）→ 跳过烘焙，登记待播；
 *      其余一切模型（场景件、建筑、怪物道具）走原逻辑，行为完全不变。
 *   2. 动作 clip 从本地已入库的一个角色 GLB 提取一次。
 *      polyfork 全站角色共用同一套 Mixamo 命名骨架（Hips→ToeBase），
 *      所以动作按骨名即可跨角色复用，不需要重定向、不联网、不依赖 polyfork CDN。
 *   3. 自建 rAF 循环驱动各自的 AnimationMixer（不依赖 world.js 的 animate）。
 *
 * ── 回退方式 ──────────────────────────────────────────────────
 * 删掉本文件 + index.html 里那一行 <script> 即可完全还原，无残留状态。
 *
 * ── 明确不做 ──────────────────────────────────────────────────
 *   - 不动玩家自己的 avatar（它走 world.js 的 glbMixer/sharedMixer 那套，本模块只处理
 *     经过 _addModelToScene 的世界对象）
 *   - 不做 Walk/Run 按速度切换：世界对象是静态摆件，没有位移，播 Idle 才对
 *   - 不碰 polyfork 那 41 个只能热链 CDN 的动作
 */
(function () {
  'use strict';

  var LOG = '[NpcAnimator]';

  /** 参考动作来源：本地已入库的角色 GLB，取其中一个即可（骨架同源）。按顺序试，失败换下一个。 */
  var REF_CANDIDATES = [
    '/models/uploaded/free/polyfork/kid-witch-01c770.glb',
    '/models/uploaded/free/polyfork/merchant-6f606b.glb',
    '/models/uploaded/free/polyfork/tradesman-1707b9.glb'
  ];

  var refClips = null;    // { Idle, Walk, Run }
  var refLoading = null;
  var targets = [];       // [{ obj, mixer }]
  var origBake = null;    // 被覆盖前的 _bakeSkinsToStatic
  var started = false;

  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift(LOG);
    console.log.apply(console, a);
  }

  /* ====================== Worker 解析模式接管 ====================== */

  /**
   * 世界对象走 Worker 解析：world.js:6078 传的是 `{ static: true }`，
   * 而 gltfWorker.js 的 static 模式会「丢弃动画、SkinnedMesh 按静态网格序列化」
   * （worker 注释原文）—— 模型到主线程时骨头和蒙皮已经没了，
   * 后面再怎么播都是空转。worker 里本来就有 `strict` 模式完整保留骨骼/蒙皮/动画
   * （二期B 玩家模型用的那条路），只是世界对象没走。
   *
   * 这里在客户端外套一层：**只对「自己确实带 skins + Hips」的 GLB 改成 strict**，
   * 其余对象一字不动，保持原来的 static 优化不变。
   */

  /** 只读 GLB 头部 JSON 块判断是不是带骨骼的角色，不解码二进制、不建场景。 */
  function looksLikeCharacterGlb(buf) {
    try {
      var dv = new DataView(buf);
      if (dv.byteLength < 20) return false;
      if (dv.getUint32(0, true) !== 0x46546c67) return false;   // 'glTF'
      var jsonLen = dv.getUint32(12, true);
      if (jsonLen < 8 || jsonLen > 32 * 1024 * 1024) return false;
      var view = new Uint8Array(buf, 20, Math.min(jsonLen, 4 * 1024 * 1024));
      var s = new TextDecoder('utf-8').decode(view);
      var hasSkin = s.indexOf('"skins"') !== -1;
      // 有 Hips 的是标准双足角色；带 animations 的是「模型自带动作」的任意骨架（如 7 骨的士兵）
      return hasSkin && (s.indexOf('"Hips"') !== -1 || s.indexOf('"animations"') !== -1);
    } catch (e) {
      return false;
    }
  }

  function installWorkerHook() {
    var C = window.GltfWorkerClient;
    if (!C || typeof C.parseBuffer !== 'function') return false;
    if (C.__npcAnimHooked) return true;

    var origParse = C.parseBuffer;
    C.parseBuffer = function (buffer, opts) {
      try {
        if (buffer && looksLikeCharacterGlb(buffer)) {
          var o = {};
          if (opts) for (var k in opts) o[k] = opts[k];
          o.static = false;
          o.strict = true;      // 完整保留骨骼/蒙皮/动画
          if (window.__npcAnimDebug) log('Worker 改走 strict 模式（带骨骼的 GLB）');
          opts = o;
        }
      } catch (e) { /* 判定失败就走原路，不影响加载 */ }
      var p = origParse.call(C, buffer, opts);
      try {
        if (p && typeof p.then === 'function') {
          return p.then(function (gltf) { tagGltfClips(gltf); return gltf; });
        }
      } catch (e) { /* 包装失败就走原返回值 */ }
      return p;
    };
    C.__npcAnimHooked = true;
    log('已接管 GltfWorkerClient.parseBuffer（带骨骼的 GLB 走 strict 模式）');
    return true;
  }

  /* ====================== 模型自带动作登记 ====================== */

  /**
   * 绝大多数第三方角色是「模型 + 自带动作」一起交付的（实测库里 7 骨的士兵带 25 个动作）。
   * 有自带动作就优先播它，比借用本地 Mixamo 参考动作更贴合，也不挑骨架命名。
   *
   * 动作挂在 gltf 上，而进 _addModelToScene 的是克隆体 —— 克隆会丢 userData，
   * 但**共享 geometry**，所以用 geometry.uuid 做键把动作找回来。
   */
  var clipRegistry = new Map();   // geometry.uuid → AnimationClip[]

  function tagGltfClips(gltf) {
    try {
      var anims = gltf && gltf.animations;
      if (!anims || !anims.length || !gltf.scene) return;
      var n = 0;
      gltf.scene.traverse(function (o) {
        if (o.geometry && o.geometry.uuid && !clipRegistry.has(o.geometry.uuid)) {
          clipRegistry.set(o.geometry.uuid, anims);
          n++;
        }
      });
      if (n) log('登记自带动作 ' + anims.length + ' 个：' + anims.slice(0, 5).map(function (a) { return a.name; }).join('/') + (anims.length > 5 ? ' …' : ''));
    } catch (e) { /* 登记失败不影响加载 */ }
  }

  function ownClipsOf(obj) {
    var hit = null;
    try {
      obj.traverse(function (n) {
        if (hit || !n.geometry || !n.geometry.uuid) return;
        var c = clipRegistry.get(n.geometry.uuid);
        if (c && c.length) hit = c;
      });
    } catch (e) { /* ignore */ }
    return hit;
  }

  function pickIdleClip(anims) {
    if (!anims || !anims.length) return null;
    for (var i = 0; i < anims.length; i++) {
      if (/idle|stand|breath|default/i.test(anims[i].name || '')) return anims[i];
    }
    return anims[0];
  }

  /* ====================== 角色判定 ====================== */

  /**
   * 是不是一个「角色」。
   * 判据：有 Hips 骨（Mixamo 双足角色的标志）+ 骨骼数在合理区间 + 有蒙皮。
   *
   * 实测（2026-11-13）：polyfork 的角色把身体按部位拆成了多个 SkinnedMesh
   * （merchant 是 10 个蒙皮网格共用一个骨架），所以蒙皮数量上限不能按"1~2 个"卡。
   * 反过来用骨骼数上限拦住 LittlestTokyo 那类几百根骨的大场景 —— 那才是当初做
   * 去蒙皮烘焙要修的对象，不能被本模块误放行。
   */
  /** 骨名归一化：Mixamo 从 FBX 导出的常带 `mixamorig:` / `mixamorig` 前缀。 */
  function normBone(name) {
    return String(name || '').replace(/^mixamorig:?/i, '');
  }

  function characterStats(obj) {
    var s = { bones: 0, hasHips: false, skinned: 0 };
    if (!obj || typeof obj.traverse !== 'function') return s;
    obj.traverse(function (n) {
      if (n.isBone) {
        s.bones++;
        if (normBone(n.name) === 'Hips') s.hasHips = true;
      } else if (n.isSkinnedMesh) {
        s.skinned++;
      }
    });
    return s;
  }

  /** 是否具备 Mixamo 关键骨（本地参考动作能不能套上去的硬前提）。 */
  function hasMixamoCore(obj) {
    var need = { Hips: 0, Spine2: 0, LeftForeArm: 0, RightUpLeg: 0 };
    obj.traverse(function (n) {
      if (n.isBone) {
        var k = normBone(n.name);
        if (k in need) need[k] = 1;
      }
    });
    return need.Hips && need.Spine2 && need.LeftForeArm && need.RightUpLeg;
  }

  /**
   * 能不能播。守门人就是这一条 —— 只有真的能动才值得保留骨骼：
   *   a) 模型自带动作（任何骨架命名都行）
   *   b) 或者具备 Mixamo 关键骨，能套本地参考动作
   * 都不满足的（例如 VRM 风格 146 骨但无动作、骨名是 Chest/Eye.L 那种），
   * 保留骨骼只会留下渲染隐患，不如按原逻辑烘焙，行为与改动前一致。
   */
  function canAnimate(obj) {
    var st = characterStats(obj);
    if (st.skinned < 1 || st.skinned > 32) return false;
    if (st.bones < 2 || st.bones > 300) return false;
    var own = ownClipsOf(obj);
    if (own && own.length) return true;          // 自带动作：不挑骨架命名、不要求 Hips
    return st.hasHips && hasMixamoCore(obj);     // 否则必须能套本地参考动作
  }

  function isCharacter(obj) {
    var s = characterStats(obj);
    // 上限放宽到 300 骨 / 32 蒙皮：实测库里有 146 骨的角色（VRM 风格，带头发/眼睛骨），
    // 原来的 64 骨上限会把它误判成场景件。真·大场景（LittlestTokyo 那类）骨数远超这个量级，
    // 仍会被挡住 —— 真正的守门人是下面 override 里的「能不能播」判断。
    return s.hasHips && s.bones >= 15 && s.bones <= 300 && s.skinned >= 1 && s.skinned <= 32;
  }

  /* ====================== 动作 clip ====================== */

  /** 只保留目标骨架里真实存在的骨骼轨道；骨名对不上就丢掉，避免 mixer 报一堆警告。 */
  function filterTracks(clip, obj) {
    var names = Object.create(null);
    obj.traverse(function (n) {
      if (n.name) names[n.name] = true;
    });
    var c = clip.clone();
    c.tracks = c.tracks.filter(function (t) {
      var node = String(t.name || '').split('.')[0];
      return !!names[node];
    });
    return c;
  }

  function getLoader() {
    if (window.gameWorld && window.gameWorld.gltfLoader) return window.gameWorld.gltfLoader;
    if (window.THREE && THREE.GLTFLoader) return new THREE.GLTFLoader();
    return null;
  }

  /** 加载一次参考动作，进程内复用。 */
  var refState = 'idle';   // idle | loading | ready | failed
  function loadRef() {
    if (refClips) return Promise.resolve(refClips);
    if (refLoading) return refLoading;

    refState = 'loading';
    refLoading = new Promise(function (resolve) {
      var loader = getLoader();
      if (!loader) {
        refState = 'failed';
        console.warn(LOG, 'GLTFLoader 不可用，角色保持静立');
        resolve(null);
        return;
      }
      var i = 0;
      (function next() {
        if (i >= REF_CANDIDATES.length) {
          refState = 'failed';
          console.warn(LOG, '参考动作加载失败（候选全挂），角色退回原烘焙逻辑');
          resolve(null);
          return;
        }
        var url = REF_CANDIDATES[i++];
        loader.load(url, function (g) {
          var map = Object.create(null);
          (g.animations || []).forEach(function (c) { map[c.name] = c; });
          if (!map.Idle) {
            console.warn(LOG, '参考文件无 Idle 动画：' + url + '（实际含 ' + Object.keys(map).join(',') + '）');
            next();
            return;
          }
          refClips = map;
          refState = 'ready';
          log('参考动作就绪：' + Object.keys(map).join(' / ') + '（来源 ' + url + '）');
          resolve(map);
        }, undefined, function (err) {
          console.warn(LOG, '参考动作加载失败：' + url + ' → ' + (err && (err.message || err.type)) );
          next();
        });
      })();
    });

    return refLoading;
  }

  /* ====================== 骨架重绑 ====================== */

  /**
   * 修复「克隆模型蒙皮绑错骨架」。
   *
   * world.js 加载世界模型走的是 `cachedModel.clone()` / `gltf.scene.clone()`
   * （:5383、:5476）。three 的普通 clone 会复制骨骼节点，但 SkinnedMesh.copy()
   * 里的 `this.skeleton = source.skeleton` 是**共享引用** —— 克隆体的蒙皮仍然绑在
   * 母本的骨骼上。后果：
   *   - 母本（缓存里那份）不在场景里，骨骼矩阵是加载时的旧值 → 永远绑定姿势
   *   - 动画驱动克隆体自己的骨头，蒙皮看不见 → 看着像"没动"
   *   - 配件（attach-* 按骨骼定位的那些网格）错位或消失 → 看着像"缺零件"
   * 正解是 SkeletonUtils.clone()，但那是 world.js 的加载路径，本模块不改它，
   * 改成在接管时按骨名把 skeleton 重新指到克隆体自己的骨头上。
   *
   * @returns {number} 修好的蒙皮网格数量
   */
  function rebindSkeletons(root) {
    var byName = Object.create(null);
    root.traverse(function (n) {
      if (n.isBone && n.name) byName[n.name] = n;
    });

    var fixed = 0;
    root.traverse(function (mesh) {
      if (!mesh.isSkinnedMesh || !mesh.skeleton || !mesh.skeleton.bones) return;
      var oldBones = mesh.skeleton.bones;
      var mapped = [];
      for (var i = 0; i < oldBones.length; i++) {
        var b = byName[oldBones[i].name];
        if (!b) return;                 // 有骨头对不上名字，整体不动，避免绑坏
        mapped.push(b);
      }
      var same = true;
      for (var j = 0; j < mapped.length; j++) {
        if (mapped[j] !== oldBones[j]) { same = false; break; }
      }
      if (same) return;                 // 本来就绑对了
      try {
        mesh.skeleton = new THREE.Skeleton(mapped, mesh.skeleton.boneInverses);
        fixed++;
      } catch (e) {
        console.warn(LOG, '骨架重绑失败：', e && e.message);
      }
    });
    return fixed;
  }

  /* ====================== 包围盒重算 ====================== */

  /**
   * 修正蒙皮包围盒。
   *
   * three r158+ 的 SkinnedMesh 自带 `boundingBox`/`computeBoundingBox()`，
   * 而 `Box3.expandByObject()` 只要发现对象有 boundingBox 就直接用它。
   * 克隆体骨架还绑在母本上时算出来的顶点会被拉到原点，盒子从原点一直张到
   * 模型位置 —— 实测 merchant 的盒子是 213 × 3.89 × 254 米（正常 2.7m 高）。
   * world.js 会给 has_collision 的对象用 `Box3.setFromObject()` 生成碰撞盒，
   * 于是世界里凭空多出一个两百米见方、顶面约 y=3.65 的**隐形碰撞体**，
   * 人只能站在它上面走。
   *
   * 这里在骨架重绑之后立刻把 bounds 置空重算；算出来仍然离谱（跨度 >50m）
   * 就退回几何体自身的 bind pose 盒子，保证碰撞盒回到人体尺寸。
   */
  function fixSkinnedBounds(root) {
    try { root.updateMatrixWorld(true); } catch (e) { return 0; }
    var fixed = 0;
    root.traverse(function (m) {
      if (!m.isSkinnedMesh) return;
      try {
        if (m.skeleton && typeof m.skeleton.update === 'function') m.skeleton.update();
        m.boundingBox = null;
        m.boundingSphere = null;
        if (typeof m.computeBoundingBox === 'function') m.computeBoundingBox();

        var b = m.boundingBox;
        var bad = !b || !isFinite(b.min.x) || !isFinite(b.max.x) || (b.max.x - b.min.x) > 50 || (b.max.y - b.min.y) > 50 || (b.max.z - b.min.z) > 50;
        if (bad) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          if (m.geometry.boundingBox) m.boundingBox = m.geometry.boundingBox.clone();
        }
        fixed++;
      } catch (e) { /* 单个网格失败不影响整体 */ }
    });
    return fixed;
  }

  /* ====================== 接管角色 ====================== */

  function register(obj, world) {
    if (!obj.userData) obj.userData = {};
    if (obj.userData.__npcAnim) return;
    obj.userData.__npcAnim = true;

    // 蒙皮网格关掉视锥剔除：骨骼每帧驱动顶点，包围盒不可靠（world.js 玩家路径同款处理）
    obj.traverse(function (n) {
      if (n.isSkinnedMesh) n.frustumCulled = false;
    });

    // 先把蒙皮绑回它自己的骨头（克隆体默认绑在母本上，见 rebindSkeletons 注释）
    var fixedCount = rebindSkeletons(obj);
    if (fixedCount) log('骨架重绑：' + fixedCount + ' 个蒙皮网格已指回自身骨骼');

    // 骨架修好后必须重算包围盒：否则会留下一个两百米见方的隐形碰撞体
    var bboxCount = fixSkinnedBounds(obj);
    if (bboxCount) log('包围盒重算：' + bboxCount + ' 个蒙皮网格');

    // 优先用模型自带的动作；没有才借本地 Mixamo 参考动作（需要骨架对得上）
    var own = ownClipsOf(obj);
    var chain = (own && own.length) ? Promise.resolve(null) : loadRef();

    chain.then(function (ref) {
      var rawClip = null, from = '';
      if (own && own.length) {
        rawClip = pickIdleClip(own);
        from = '模型自带 ' + own.length + ' 个动作';
      } else if (ref && ref.Idle) {
        rawClip = ref.Idle;
        from = '本地参考动作';
      }
      if (!rawClip) {
        // 拿不到动作也**不回退烘焙**：烘焙会删骨骼、让按骨骼定位的配件（attach-*）
        // 错位或消失，比"原样站着"更糟。保持骨骼，角色以 bind pose 静立即可。
        console.warn(LOG, '无可用动作，角色保持 bind pose 静立（不烘焙）：' + (obj.name || '(未命名)'));
        return;
      }

      try {
        // mixer 必须绑在含骨骼的根上；obj 本身就是模型根，直接用
        var mixer = new THREE.AnimationMixer(obj);
        var clip = filterTracks(rawClip, obj);
        if (!clip.tracks.length) {
          console.warn(LOG, '骨架与参考动作不匹配，跳过：' + (obj.name || '(未命名)'));
          return;
        }
        var action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        mixer.update(0);
        targets.push({ obj: obj, mixer: mixer, action: action });
        log('已接管角色 → ' + rawClip.name + '（' + from + '）：' + (obj.name || '(未命名)') + '，轨道 ' + clip.tracks.length + ' 条');
      } catch (e) {
        console.warn(LOG, '接管失败，角色保持静立：', e && e.message);
      }
    });
  }

  /* ====================== 覆盖烘焙 ====================== */

  function patch(world) {
    var proto = Object.getPrototypeOf(world);
    if (!proto) return false;
    if (proto.__npcAnimPatched) return true;

    origBake = proto._bakeSkinsToStatic;
    if (typeof origBake !== 'function') {
      console.warn(LOG, '未找到 _bakeSkinsToStatic —— world.js 可能已改版，本模块自动退化为空转');
      return false;
    }

    proto._bakeSkinsToStatic = function (obj) {
      try {
        if (canAnimate(obj)) {
          register(obj, this);
          return;                       // 能播：保留骨骼，跳过烘焙
        }
        var st = characterStats(obj);
        if (st.skinned > 0 || st.bones > 0) {
          // 只对"带骨骼/蒙皮但没被认成角色"的模型留痕，纯道具不刷屏
          var ow = ownClipsOf(obj);
          console.warn(LOG, '无法播放，按原逻辑烘焙：骨 ' + st.bones + ' / 蒙皮 ' + st.skinned +
            ' / Hips ' + st.hasHips + ' / 自带动作 ' + (ow ? ow.length : 0) + ' 个 / ' + (obj.name || '(未命名)'));
        }
      } catch (e) {
        console.warn(LOG, '角色判定异常，按原逻辑烘焙：', e && e.message);
      }
      return origBake.call(this, obj);  // 其余一切：行为不变
    };

    proto.__npcAnimPatched = true;
    log('已接管 _bakeSkinsToStatic（角色不再被去蒙皮）');
    return true;
  }

  /* ====================== 主循环 ====================== */

  var lastT = 0;
  function tick(now) {
    var dt = (lastT ? (now - lastT) : 16) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;   // 切标签页回来别一次跳太多

    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i];
      var o = t.obj;
      if (!o || !o.parent) { targets.splice(i, 1); continue; }  // 已出场景，回收
      if (o.visible === false) continue;
      try { t.mixer.update(dt); } catch (e) { targets.splice(i, 1); }
    }
    requestAnimationFrame(tick);
  }

  function boot() {
    installWorkerHook();          // 先把 Worker 解析模式接管上，早于任何模型加载
    var world = window.gameWorld;
    if (!world) { setTimeout(boot, 300); return; }
    if (patch(world) && !started) {
      started = true;
      requestAnimationFrame(tick);
    }
  }

  /* ====================== 调试接口 ====================== */

  window.NpcAnimator = {
    /** 当前接管了几个角色 / 参考动作是否就绪 */
    stats: function () {
      return {
        patched: !!(window.gameWorld && Object.getPrototypeOf(window.gameWorld).__npcAnimPatched),
        animated: targets.length,
        refClips: refClips ? Object.keys(refClips) : null,
        refState: refState,
        targets: targets.map(function (t) { return t.obj.name || '(未命名)'; })
      };
    },
    /** 手动给某个对象套动作，用于试验：NpcAnimator.play(obj, 'Walk') */
    play: function (obj, name) {
      if (!refClips || !refClips[name] || !obj) return false;
      var hit = targets.find(function (t) { return t.obj === obj; });
      var mixer = hit ? hit.mixer : new THREE.AnimationMixer(obj);
      if (!hit) { targets.push({ obj: obj, mixer: mixer, action: null }); }
      var a = mixer.clipAction(filterTracks(refClips[name], obj));
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      if (hit) hit.action = a;
      return true;
    },
    /** 判定函数导出，方便在控制台验某对象会不会被当角色：NpcAnimator.isCharacter(gameWorld.scene) */
    isCharacter: isCharacter,
    /** 看某对象被判成什么：NpcAnimator.inspect(gameWorld.scene) */
    inspect: characterStats
  };

  installWorkerHook();             // 脚本一到位就装（Worker 客户端在更前面加载）

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
