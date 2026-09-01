/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 畸形双骨骼链修复器（Duplicate Bone Chain Fixer）
 *
 * ── 问题背景 ──
 * 部分角色 GLB（如「拿剑武士」char-1779180094927）导出时把整套骨骼复制了一份：
 *   主链：      mixamorigHips  → mixamorigSpine → mixamorigLeftArm ...
 *   副本链：    mixamorigHips_1 → mixamorigSpine_1 → mixamorigLeftArm_1 ...
 * 且副本骨骼是「主骨骼的同名子节点」（本地变换为单位矩阵），形成嵌套副本链。
 *
 * Three.js 的 GLTFLoader 加载时会给重复节点名自动加去重后缀（_1 / _2），
 * 于是：
 *   1. 身体 SkinnedMesh 的 skin.joints 指向了副本链（_1 那一套）；
 *   2. 动画 clip 的轨道名来自原始 GLB 节点名（无后缀），只能驱动主链；
 *   3. 两套对不上 → 身体骨骼永远不被驱动，模型停在 bind pose，
 *      表现为「手臂完全变形 / 扭曲」。
 *
 * ── 修复思路 ──
 * 副本骨骼的本地变换是单位矩阵，所以它的世界矩阵 == 主骨骼的世界矩阵，
 * inverseBindMatrices 对主链同样成立。因此可以安全地：
 *   把绑定了副本骨骼的 SkinnedMesh，其 skeleton.bones 逐根换绑到对应的主骨骼。
 *
 * 这样动画轨道（无后缀）就能直接驱动身体 mesh，恢复骨骼动画。
 */
(function () {
  'use strict';

  // 匹配 Three.js 自动加的去重后缀：Name_1 / Name_2 ...
  var DUP_SUFFIX_RE = /^(.*?)_(\d+)$/;

  /**
   * 检测模型是否存在畸形副本链
   * @param {THREE.Object3D} model
   * @returns {boolean}
   */
  function hasDuplicateChain(model) {
    var bones = [];
    model.traverse(function (n) { if (n.isBone) bones.push(n); });
    if (!bones.length) return false;

    var mainNames = new Set();
    bones.forEach(function (b) {
      if (!DUP_SUFFIX_RE.test(b.name)) mainNames.add(b.name);
    });

    for (var i = 0; i < bones.length; i++) {
      var m = bones[i].name.match(DUP_SUFFIX_RE);
      if (m && mainNames.has(m[1])) return true;
    }
    return false;
  }

  /**
   * 修复模型中的畸形双骨骼链
   * 把绑定副本骨骼的 SkinnedMesh 换绑到对应的主骨骼。
   *
   * @param {THREE.Object3D} model GLTF 加载后的模型对象
   * @returns {{fixed:boolean, reason:string, fixedMeshes:number, changedBones:number, dupBones:number}}
   */
  function fix(model) {
    var miss = { fixed: false, reason: '', fixedMeshes: 0, changedBones: 0, dupBones: 0 };
    if (!model) { miss.reason = 'no-model'; return miss; }

    // 1. 收集所有骨骼
    var bones = [];
    model.traverse(function (n) { if (n.isBone) bones.push(n); });
    if (!bones.length) { miss.reason = 'no-bones'; return miss; }

    // 2. 区分主骨骼（无后缀）与副本骨骼（带 _N 后缀）
    var mainByName = new Map();
    var dupList = [];

    bones.forEach(function (b) {
      var m = b.name.match(DUP_SUFFIX_RE);
      if (m) {
        dupList.push({ bone: b, base: m[1] });
      } else if (!mainByName.has(b.name)) {
        mainByName.set(b.name, b);
      }
    });

    if (!dupList.length) { miss.reason = 'no-duplicate-bones'; return miss; }

    // 3. 建立 副本骨骼 -> 主骨骼 的映射（仅当主骨骼确实存在时）
    var remap = new Map();
    dupList.forEach(function (item) {
      var main = mainByName.get(item.base);
      if (main && main !== item.bone) remap.set(item.bone, main);
    });

    if (!remap.size) { miss.reason = 'no-matching-main-bone'; return miss; }
    miss.dupBones = remap.size;

    // 4. 换绑所有绑定了副本骨骼的 SkinnedMesh
    model.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.skeleton || !n.skeleton.bones) return;

      var oldBones = n.skeleton.bones;
      var changed = 0;
      var newBones = oldBones.map(function (b) {
        var target = remap.get(b);
        if (target) { changed++; return target; }
        return b;
      });
      if (!changed) return;

      n.skeleton.bones = newBones;
      miss.changedBones += changed;
      miss.fixedMeshes++;
    });

    if (!miss.fixedMeshes) { miss.reason = 'no-mesh-bound-to-duplicate'; return miss; }

    // 5. 刷新 skeleton 内部状态（副本与主骨骼世界矩阵一致，inverseBindMatrices 无需重算）
    model.traverse(function (n) {
      if (n.isSkinnedMesh && n.skeleton && typeof n.skeleton.update === 'function') {
        try { n.skeleton.update(); } catch (e) { /* 忽略 */ }
      }
    });

    miss.fixed = true;
    return miss;
  }

  // 暴露到全局
  window.DuplicateBoneChainFixer = {
    fix: fix,
    hasDuplicateChain: hasDuplicateChain
  };

  console.log('[duplicate-bone-chain-fixer] 畸形双骨骼链修复器已加载');
})();
