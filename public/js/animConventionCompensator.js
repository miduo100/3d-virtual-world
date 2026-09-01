/**
 * animConventionCompensator.js —— 动作库动画「骨骼约定」托底补偿
 * ------------------------------------------------------------------
 * 背景：动作库（Mixamo 平台）动画的 quaternion 轨道存的是**绝对局部旋转值**，
 *       播放时按骨骼名直接写入模型骨骼（world.js _processAnimClip 只过滤
 *       .position 轨道）。若模型骨骼的 rest 约定（局部坐标系朝向）与标准
 *       Mixamo 约定不一致（实测案例 Kipfel_Mobile：UpLeg=X轴180° vs 标准
 *       Z轴180°，肩/脚/脚趾偏差 112°~180°），轨道值在错误的坐标系里被解释：
 *       大腿 180° 翻滚把蒙皮裙摆拧起（裙子收起）、脚掌转到垂直戳地（前倾）。
 *
 * 方案：内置「标准约定表」（提取自已验证正常的拿剑武士 bind：与动作库共用
 *       idle/walk/run 且显示正常的 6 个模板之一，65 根 mixamorig 骨骼的
 *       局部/世界静止四元数）。动画加载时从模型 skeleton 的 IBM⁻¹ 重建自身
 *       bind，与标准表逐骨算补偿量；检测到明显翻转约定（任一骨骼 P 或 K
 *       > 85°）时，对每根匹配骨骼的每个关键帧做：
 *           q' = P × q × K
 *           P(b) = W_model(parent,bind)⁻¹ × W_std(parent,bind)
 *           K(b) = L_std(b)⁻¹ × P(b)⁻¹ × L_model(b)
 *       语义 = 「标准 bind ↔ 模型 bind 互为锚点、世界空间运动增量等价传递」
 *       （与 SkeletonUtils.retargetClip 同族；sandwich 是 S³ 等距映射，
 *       与 slerp 插值可交换，逐关键帧改写不破坏插值语义）。
 *
 * 覆盖范围（托底语义，保守介入，自动分类两类问题）：
 *   B 类「双重轴转换」（实测案例 谁到发疯：Armature(+90°X) 残留 + 顶点已是
 *       Y-up → rest 渲染躺倒）→ 容器旋转下沉归一：清容器旋转、折叠进骨骼根
 *       （骨骼世界绑定不变 → IBM 零破坏）、网格随容器清零整体剥离多余旋转。
 *   A 类「动画约定不匹配」：rest 渲染正常但骨骼局部坐标系与动作库不同
 *       （Kipfel 类中段骨骼翻面；zhu 类抵消型根旋转）→ 动画轨道 P×q×K 补偿。
 *   两类兼有的模型（谁到发疯：双重转换 + 肢体骨翻面）→ 先归一再补偿。
 *
 * 安全边界：
 *   - 只处理带 mixamorigHips 骨骼的模型（mofx 等其它命名体系自动跳过）
 *   - 只由 world.js 的「动作库加载路径」调用；模型自带动画、自包含角色包不经过本模块
 *   - 归一触发判据带尺寸/裕度守卫（近立方体部件不参与、mofx 0.01 缩放等退化盒忽略），
 *     健康模型（含 Z-up 顶点的合法 Blender 导出）rest 渲染站立 → 永不触发
 *   - 归一后 rest 渲染仍躺倒的模型（归一不适用）→ 跳过动画补偿并警告（防误伤），
 *     该类模型需文件级修复（retarget-tool 的 upAxis 能力）
 *   - 标准约定模型（P/K 均 < 85°）零干预，已决策模型/已补偿 clip 有防重复保护
 *   - 任何内部异常都静默降级（走原播放逻辑，不阻塞功能）
 */
(function () {
  'use strict';

  /** 触发阈值：任一骨骼 P 或 K 超过此角度（度）才判定为非标准约定并补偿。
   *  保守取 85°：明显翻转约定（90°/112°/180°）会命中；A-pose 等小幅差异
   *  （<85°）的现有模型零干预，避免改变当前显示效果。 */
  var TRIGGER_DEG = 85;

  /** ── 容器归一（B 类双重轴转换）判据参数 ──
   *  站/躺判定裕度：Y 轴尺寸需 > 1.15×Z 才算「站」，反之算「躺」，
   *  防止近立方体部件（脸/披风/鞋等）的 Y/Z 比较噪声参与触发（实测教训）。
   *  盒子最小尺寸：小于 0.05m 的退化渲染盒（如 mofx 0.01 缩放 → 盒子仅 1cm）
   *  的 Y/Z 比较是纯噪声，一律忽略（zhu 模型因此安全不触发）。 */
  var BOX_MARGIN = 1.15;
  var BOX_MIN_SIZE = 0.05;
  /** 容器节点旋转超过此角度（度）才纳入归一候选 */
  var CONTAINER_ROT_DEG = 5;

  /** 标准约定表：'骨骼名': [局部qx,qy,qz,qw, 标准父世界qx,qy,qz,qw]
   *  生成自 拿剑武士 char-1779180094927-135896146.glb（scripts/gen_animcomp_table.mjs）。
   *  第二段 = 该骨骼在参考骨架真实层级中父链的世界静止四元数（预存，
   *  运行时不依赖模型侧层级——模型可能缺骨，如 Kipfel 无 mixamorigSpine1）。 */
  var STANDARD_BIND = {
    'mixamorigHead':[0,0,0,1,0,0,0,1],
    'mixamorigHeadTop_End':[0,0,0,1,0,0,0,1],
    'mixamorigHips':[0,0,0.000001,1,0,0,0,1],
    'mixamorigLeftArm':[0.093071,-0.00024,-0.002568,-0.995656,-0.54296,-0.452456,0.545768,-0.450128],
    'mixamorigLeftFoot':[0.295927,-0.022913,0.020053,0.954725,0,-0.052606,0.998615,0],
    'mixamorigLeftForeArm':[0,0,0.008726,0.999962,0.500001,0.499999,-0.5,0.5],
    'mixamorigLeftHand':[0,0,0,1,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandIndex1':[0.00003,0,0.002448,0.999997,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandIndex2':[0.000032,0,0.002162,0.999998,0.505572,0.494366,-0.494397,0.505541],
    'mixamorigLeftHandIndex3':[0.000014,0,0.00097,0.999999,0.506656,0.493256,-0.493318,0.506592],
    'mixamorigLeftHandIndex4':[0,0,0,1,0.507141,0.492757,-0.492833,0.507063],
    'mixamorigLeftHandMiddle1':[-0.000008,0,-0.000337,1,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandMiddle2':[-0.000001,0,-0.000049,1,0.504173,0.495791,-0.495784,0.504181],
    'mixamorigLeftHandMiddle3':[0.000009,0,0.000371,1,0.504148,0.495817,-0.495808,0.504157],
    'mixamorigLeftHandMiddle4':[0,0,0,1,0.504337,0.495625,-0.495625,0.504337],
    'mixamorigLeftHandPinky1':[-0.000002,0,-0.000142,1,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandPinky2':[0.000013,0,0.000831,0.999999,0.504273,0.49569,-0.495689,0.504274],
    'mixamorigLeftHandPinky3':[-0.000013,0,-0.000858,0.999999,0.504691,0.495264,-0.495276,0.50468],
    'mixamorigLeftHandPinky4':[0,0,0,1,0.504259,0.495704,-0.495702,0.504261],
    'mixamorigLeftHandRing1':[0,0,-0.000012,1,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandRing2':[-0.000025,0,-0.000723,1,0.504339,0.495623,-0.495624,0.504338],
    'mixamorigLeftHandRing3':[0.000026,0,0.000743,1,0.503968,0.496,-0.495976,0.503993],
    'mixamorigLeftHandRing4':[0,0,0,1,0.504349,0.495613,-0.495614,0.504348],
    'mixamorigLeftHandThumb1':[0.218628,0.071693,0.254759,0.939234,0.504345,0.495617,-0.495618,0.504344],
    'mixamorigLeftHandThumb2':[0,0,-0.000002,1,0.745756,0.264816,-0.409213,0.454164],
    'mixamorigLeftHandThumb3':[0.000001,0,0,1,0.745756,0.264818,-0.409214,0.454163],
    'mixamorigLeftHandThumb4':[0,0,0,1,0.745756,0.264817,-0.409214,0.454163],
    'mixamorigLeftLeg':[-0.069743,0,0,0.997565,0,0.017168,0.999853,0],
    'mixamorigLeftShoulder':[-0.54296,-0.452456,0.545768,-0.450128,0,0,0,1],
    'mixamorigLeftToeBase':[0.511198,-0.010073,-0.012824,0.859308,0.021826,0.245293,0.968971,-0.02123],
    'mixamorigLeftToe_End':[0,0,0,1,0.014517,0.706612,0.707303,-0.014504],
    'mixamorigLeftUpLeg':[0,0.017168,0.999853,0.000001,0,0,0.000001,1],
    'mixamorigNeck':[0,0,0,1,0,0,0,1],
    'mixamorigRightArm':[-0.093037,-0.00024,-0.002568,0.995659,0.542944,-0.452475,0.545752,0.450148],
    'mixamorigRightFoot':[0.295928,0.022913,-0.020051,0.954725,0,-0.052606,0.998615,0],
    'mixamorigRightForeArm':[0.000022,0,-0.008726,0.999962,0.5,-0.5,0.5,0.5],
    'mixamorigRightHand':[0,0,0,1,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandIndex1':[-0.000022,0,-0.002448,0.999997,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandIndex2':[0,0,-0.002164,0.999998,0.505556,-0.494381,0.494382,0.505556],
    'mixamorigRightHandIndex3':[0.000204,0,-0.000967,0.999999,0.506625,-0.493286,0.493286,0.506625],
    'mixamorigRightHandIndex4':[0,0,0,1,0.507205,-0.492695,0.492896,0.506999],
    'mixamorigRightHandMiddle1':[-0.000022,0,0.000336,1,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandMiddle2':[0,0,0.000051,1,0.504177,-0.495787,0.495788,0.504178],
    'mixamorigRightHandMiddle3':[0,0,-0.000372,1,0.504152,-0.495813,0.495813,0.504152],
    'mixamorigRightHandMiddle4':[0,0,0,1,0.504336,-0.495625,0.495626,0.504337],
    'mixamorigRightHandPinky1':[-0.000022,0,0.000143,1,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandPinky2':[0,0,-0.000833,0.999999,0.504273,-0.495689,0.49569,0.504273],
    'mixamorigRightHandPinky3':[0,0,0.000858,0.999999,0.504686,-0.495269,0.49527,0.504686],
    'mixamorigRightHandPinky4':[0,0,0,1,0.50426,-0.495702,0.495703,0.504261],
    'mixamorigRightHandRing1':[-0.000022,0,0.000012,1,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandRing2':[0,0,0.000723,1,0.504338,-0.495623,0.495624,0.504339],
    'mixamorigRightHandRing3':[0,0,-0.000743,1,0.50398,-0.495988,0.495988,0.50398],
    'mixamorigRightHandRing4':[0,0,0,1,0.504349,-0.495613,0.495613,0.504349],
    'mixamorigRightHandThumb1':[0.219408,-0.06887,-0.254097,0.939442,0.504355,-0.495607,0.495628,0.504333],
    'mixamorigRightHandThumb2':[-0.000109,0,0.000005,1,0.744533,-0.263427,0.41147,0.454938],
    'mixamorigRightHandThumb3':[0.000103,0,0.000005,1,0.744482,-0.263476,0.411443,0.455017],
    'mixamorigRightHandThumb4':[0,0,0,1,0.744528,-0.263437,0.411473,0.454939],
    'mixamorigRightLeg':[-0.069743,0,0,0.997565,0,0.017168,0.999853,0],
    'mixamorigRightShoulder':[0.542944,-0.452475,0.545752,0.450148,0,0,0,1],
    'mixamorigRightToeBase':[0.511198,0.010076,0.012819,0.859308,-0.021827,0.245293,0.968971,0.021229],
    'mixamorigRightToe_End':[0,0,0,1,-0.014523,0.706612,0.707303,0.014507],
    'mixamorigRightUpLeg':[0,0.017168,0.999853,0.000001,0,0,0.000001,1],
    'mixamorigSpine':[-0.031532,0,-0.000001,0.999503,0,0,0.000001,1],
    'mixamorigSpine1':[-0.035455,0,0,0.999371,-0.031532,0,0,0.999503],
    'mixamorigSpine2':[0.06695,0,0,0.997756,-0.06695,0,0,0.997756],
  };

  var root = typeof window !== 'undefined' ? window : globalThis;
  var T = root.THREE || (typeof THREE !== 'undefined' ? THREE : null);

  var bindCache = new WeakMap();   // model 根节点 -> bind 信息（含补偿常量）
  var decidedModels = new WeakSet(); // 已输出过决策日志的模型
  var doneClips = new WeakSet();   // 已处理（补偿或判定标准）的 clip

  function quatOf(arr, off) { return new T.Quaternion(arr[off], arr[off + 1], arr[off + 2], arr[off + 3]); }
  function angleDeg(q) { return 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI; }

  // ---------------------------------------------------------------- 容器旋转下沉归一（B 类）

  var normalizedModels = new WeakSet();

  function rawBoxOf(mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox;
  }

  /** 网格 bbox 的 8 角经 matrixWorld 变换后的盒子（rest 渲染盒，姿态无关） */
  function worldBoxOf(mesh, bb, out) {
    var box = out || new T.Box3();
    box.makeEmpty();
    var c = new T.Vector3();
    for (var ix = 0; ix < 2; ix++) for (var iy = 0; iy < 2; iy++) for (var iz = 0; iz < 2; iz++) {
      c.set(ix ? bb.max.x : bb.min.x, iy ? bb.max.y : bb.min.y, iz ? bb.max.z : bb.min.z);
      box.expandByPoint(c.applyMatrix4(mesh.matrixWorld));
    }
    return box;
  }

  /** 'stand' | 'lie' | 'amb'（近立方体）| 'tiny'（退化盒） */
  function boxVerdict(box) {
    var sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
    if (Math.max(sy, sz, box.max.x - box.min.x) < BOX_MIN_SIZE) return 'tiny';
    if (sy > sz * BOX_MARGIN) return 'stand';
    if (sz > sy * BOX_MARGIN) return 'lie';
    return 'amb';
  }

  /** 骨骼的世界【绑定】矩阵（姿态无关）：优先取 skeleton 中该骨骼 IBM 的逆
   *  （IBM = 绑定世界矩阵的逆，烘死在 BIN，不受当前播放状态影响）。
   *  取不到（该骨骼不是蒙皮 joint）时退回当前 matrixWorld。 */
  function bindWorldOf(model, bone) {
    var found = null;
    model.traverse(function (m) {
      if (found || !m.isSkinnedMesh || !m.skeleton) return;
      var idx = m.skeleton.bones.indexOf(bone);
      if (idx >= 0 && m.skeleton.boneInverses[idx]) found = m.skeleton.boneInverses[idx].clone().invert();
    });
    return found || bone.matrixWorld.clone();
  }

  /** B 类触发判据（模型级）：∃ 置信网格「顶点数据站立 且 rest 渲染躺倒」
   *  → 双重轴转换（容器旋转与顶点数据不配套）。
   *  置信 = 两个盒子均非退化、且判定非 amb。 */
  function restRenderBroken(model) {
    var broken = false;
    model.traverse(function (m) {
      if (broken || !m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      var rb = rawBoxOf(m);
      if (boxVerdict(rb) !== 'stand') return;
      var wb = worldBoxOf(m, rb);
      if (boxVerdict(wb) === 'lie') broken = true;
    });
    return broken;
  }

  /**
   * 容器旋转下沉归一（每模型一次，算法已 Node 全项验证 scripts/verify_shuida_sink.mjs）：
   *  1. 触发：rest 渲染躺倒（双重轴转换）才介入；健康模型（渲染站立）零干预
   *  2. 收集 mixamorigHips → model 之间带旋转(>5°)的容器节点（如 Armature +90°X）
   *  3. 快照容器直接骨子（骨骼根）的世界矩阵 → 容器清为恒等 →
   *     骨根 local' = parent.matrixWorld⁻¹ × world_old（精确保全世界 → IBM 零破坏）
   *  4. 网格局部一律不动：容器清零即从 mesh.matrixWorld 中整体剥离多余旋转
   *     （模型级决策——逐网格判定在近立方体部件上是噪声，实测教训）
   *  归一后 rest 渲染 = bind 盒（fitModel 贴地无需重校准），骨骼根 rest 对齐标准约定。
   *  注意：必须在模型首次播放动画前调用（骨骼处于 rest 姿态），world.js 的
   *  动作库加载路径满足此条件（首个 clip 在 action.play() 之前经过本模块）。 */
  function normalizeContainers(model) {
    if (normalizedModels.has(model)) return { ok: false, reason: 'already' };
    normalizedModels.add(model);
    try {
      if (!restRenderBroken(model)) return { ok: false, reason: 'rest render standing (healthy)' };

      var hips = null;
      model.traverse(function (n) { if (!hips && n.isBone && n.name === 'mixamorigHips') hips = n; });
      if (!hips) return { ok: false, reason: 'no mixamorigHips' };

      // 防御：Hips 必须在 model 子树内，避免误清 model 之外的世界级节点
      var cur = hips.parent, under = false;
      while (cur) { if (cur === model) { under = true; break; } cur = cur.parent; }
      if (!under) return { ok: false, reason: 'hips not under model' };

      var containers = [];
      cur = hips.parent;
      while (cur && cur !== model) {
        if (angleDeg(cur.quaternion) > CONTAINER_ROT_DEG) containers.push(cur);
        cur = cur.parent;
      }
      if (!containers.length) return { ok: false, reason: 'no rotating containers (model broken otherwise)' };

      // 骨骼根（容器的直接 Bone 子节点）世界矩阵保真式折叠
      var boneRoots = [];
      containers.forEach(function (c) {
        c.children.forEach(function (ch) { if (ch.isBone) boneRoots.push(ch); });
      });
      if (!boneRoots.length) return { ok: false, reason: 'no bone roots under containers' };
      // 世界【绑定】矩阵一律取 IBM⁻¹（姿态无关）。
      // 关键：远端玩家 MODEL_UPDATE（换模板）时，可能在新模型就绪前就拿旧模型（正在播放
      // 动画）触发动画加载；若此时用 matrixWorld 当绑定姿态，会把动画姿态误当 rest 折叠。
      // IBM 是烘死在 BIN 里的绑定世界矩阵的逆，取它即可彻底免疫当前播放状态。
      var worlds = new Map();
      boneRoots.forEach(function (b) { worlds.set(b, bindWorldOf(model, b)); });

      containers.forEach(function (c) {
        c.quaternion.identity();
        c.position.set(0, 0, 0);
        c.scale.set(1, 1, 1);
      });
      model.updateMatrixWorld(true);
      worlds.forEach(function (w, node) {
        var pm = node.parent.matrixWorld.clone().invert();
        new T.Matrix4().multiplyMatrices(pm, w).decompose(node.position, node.quaternion, node.scale);
      });
      model.updateMatrixWorld(true);
      console.log('[AnimComp] 🔧 检测到容器残留旋转导致 rest 躺倒（双重轴转换），已下沉归一：' +
        containers.map(function (c) { return c.name || c.type; }).join(',') +
        '（骨骼根折叠 ' + boneRoots.length + '，网格随容器剥离）');
      return { ok: true, containers: containers.length, boneRoots: boneRoots.length };
    } catch (e) {
      console.warn('[AnimComp] 容器归一异常（跳过）:', e && e.message);
      return { ok: false, reason: 'error: ' + (e && e.message) };
    }
  }

  // ---------------------------------------------------------------- 模型 bind 重建

  /** 从 skeleton 的 IBM⁻¹ 重建骨骼 bind（世界+局部静止四元数）。
   *  首次调用前先执行 B 类「容器旋转下沉归一」（若触发会原地修改模型节点变换，
   *  必须发生在任何动画播放之前——world.js 动作库路径满足）。
   *  口径与 retarget 工具一致：IBM⁻¹ = 骨骼在 glTF 场景系下的世界绑定旋转，
   *  与外部 characterGroup 的摆放变换无关。 */
  function getModelBind(model) {
    var cached = bindCache.get(model);
    if (cached) return cached;

    var info = { unsupported: null, bones: null, W: null, L: null, parentWorldQ: null, comp: null,
      sink: null, restBroken: false };
    bindCache.set(model, info); // 先占位防递归

    // B 类：容器旋转下沉归一（每模型一次；rest 渲染躺倒才触发，健康模型零干预）
    try { model.updateMatrixWorld(true); } catch (e) { /* ignore */ }
    info.sink = normalizeContainers(model);

    // 安全门：归一后 rest 渲染仍躺倒 → 模型文件级问题，动画补偿无法救且会误伤 → 跳过
    try {
      if (restRenderBroken(model)) info.restBroken = true;
    } catch (e) { /* 判定失败不阻断，按可补偿处理 */ }

    var sk = null;
    try {
      model.traverse(function (n) {
        if (sk || !n.isSkinnedMesh || !n.skeleton) return;
        var bs = n.skeleton.bones;
        for (var i = 0; i < bs.length; i++) {
          if (bs[i].name === 'mixamorigHips') { sk = n.skeleton; return; }
        }
      });
    } catch (e) { sk = null; }
    if (!sk) { info.unsupported = 'no mixamorigHips skeleton'; return info; }

    var W = new Map(), L = new Map(), bones = new Map();
    sk.bones.forEach(function (b, i) {
      if (!b || !b.name || bones.has(b.name)) return;
      bones.set(b.name, b);
      var m = new T.Matrix4().copy(sk.boneInverses[i]).invert();
      W.set(b.name, new T.Quaternion().setFromRotationMatrix(m));
    });

    /** 父世界静止四元数：父是骨骼且已重建 → 用其 bind 世界；
     *  否则沿 Object3D 节点链累计当前旋转（非骨骼节点不被动画驱动，当前=rest） */
    function parentWorldQ(b) {
      var p = b.parent;
      if (p && p.isBone && W.has(p.name)) return W.get(p.name);
      var q = new T.Quaternion(), cur = p;
      while (cur) { q.premultiply(cur.quaternion); cur = cur.parent; }
      return q;
    }
    bones.forEach(function (b, name) {
      L.set(name, parentWorldQ(b).clone().invert().multiply(W.get(name)));
    });

    info.bones = bones; info.W = W; info.L = L; info.parentWorldQ = parentWorldQ;
    return info;
  }

  // ---------------------------------------------------------------- 补偿常量

  /** 计算全部匹配骨骼的 P/K 补偿常量与最大偏差角。
   *  P(b) = W_model(父,bind)⁻¹ × PW_std(b)   —— 标准侧父世界取自表内预存值
   *                                          （参考骨架真实层级，不依赖模型层级）
   *  K(b) = L_std(b)⁻¹ × P(b)⁻¹ × L_model(b) */
  function buildCompensation(info) {
    if (info.comp) return info.comp;
    var P = new Map(), K = new Map(), maxDev = 0, worst = '';
    Object.keys(STANDARD_BIND).forEach(function (name) {
      var b = info.bones.get(name);
      var std = STANDARD_BIND[name];
      if (!b || !std) return;
      var Pq = info.parentWorldQ(b).clone().invert().multiply(quatOf(std, 4));
      var Kq = quatOf(std, 0).clone().invert().multiply(Pq.clone().invert()).multiply(info.L.get(name));
      P.set(name, Pq); K.set(name, Kq);
      var d = Math.max(angleDeg(Pq), angleDeg(Kq));
      if (d > maxDev) { maxDev = d; worst = name; }
    });
    info.comp = { P: P, K: K, maxDev: maxDev, worst: worst, matched: P.size };
    return info.comp;
  }

  // ---------------------------------------------------------------- 对外接口

  /**
   * 对动作库动画 clip 做骨骼约定补偿（原地改写 quaternion 轨道值）。
   * @param {THREE.AnimationClip} clip  动作库动画 clip
   * @param {THREE.Object3D} model      角色模型根节点（含骨骼的 glbModel）
   * @param {string} type               动画类型（idle/walk/run…，仅用于日志）
   * @returns {{compensated:boolean, reason?:string, bones?:number, frames?:number}}
   */
  function processClip(clip, model, type) {
    try {
      if (!T) return { compensated: false, reason: 'THREE unavailable' };
      if (!clip || !clip.tracks || !clip.tracks.length) return { compensated: false, reason: 'no clip' };
      if (!model) return { compensated: false, reason: 'no model' };
      if (doneClips.has(clip)) return { compensated: false, reason: 'already processed' };

      var info = getModelBind(model);
      if (info.unsupported) return { compensated: false, reason: info.unsupported };

      // 安全门：模型 rest 渲染躺倒（归一不适用/失败的文件级问题）→ 跳过补偿防误伤
      // （实测教训：谁到发疯被误补偿后从半埋地翻成平躺）
      if (info.restBroken) {
        doneClips.add(clip);
        if (!decidedModels.has(model)) {
          decidedModels.add(model);
          console.warn('[AnimComp] ⚠️ 模型 rest 姿态异常（蒙皮渲染躺倒且容器归一未解决），' +
            '动画补偿已跳过防误伤——该模型需要文件级修复（retarget-tool upAxis 能力）');
        }
        return { compensated: false, reason: 'model rest pose broken' };
      }

      var comp = buildCompensation(info);
      if (!comp.matched) return { compensated: false, reason: 'no matched bones' };

      // 标准约定：零干预（每个模型只提示一次，避免刷屏）
      if (comp.maxDev <= TRIGGER_DEG) {
        doneClips.add(clip);
        if (!decidedModels.has(model)) {
          decidedModels.add(model);
          console.log('[AnimComp] 标准骨骼约定，无需补偿（匹配 ' + comp.matched +
            ' 骨，最大偏差 ' + comp.maxDev.toFixed(1) + '°）');
        }
        return { compensated: false, reason: 'standard convention' };
      }

      // 非标准约定：逐关键帧补偿 q' = P × q × K
      // 注意 '.quaternion' 是 11 字符（quaternion 10 个字母 + 点），别用 slice(-10)
      var q = new T.Quaternion(), q2 = new T.Quaternion();
      var frames = 0, bonesHit = 0;
      clip.tracks.forEach(function (tr) {
        if (!tr.name || !tr.name.endsWith('.quaternion')) return;
        var name = tr.name.slice(0, -11);
        var p = comp.P.get(name), k = comp.K.get(name);
        if (!p || !k) return;
        var v = tr.values, n = tr.times.length;
        for (var i = 0; i < n; i++) {
          q.set(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]);
          q2.copy(p).multiply(q).multiply(k);
          v[i * 4] = q2.x; v[i * 4 + 1] = q2.y; v[i * 4 + 2] = q2.z; v[i * 4 + 3] = q2.w;
          frames++;
        }
        bonesHit++;
      });
      doneClips.add(clip);
      console.log('[AnimComp] ⚠️ 检测到非标准骨骼约定（' + comp.worst + ' 偏差 ' +
        comp.maxDev.toFixed(0) + '°），已补偿 ' + (type || 'anim') + ' \'' + clip.name +
        '\'：' + bonesHit + ' 骨 / ' + frames + ' 关键帧');
      return { compensated: true, bones: bonesHit, frames: frames };
    } catch (e) {
      // 托底原则：任何异常都不阻塞动画播放
      console.warn('[AnimComp] 补偿异常，走原始动画:', e && e.message);
      return { compensated: false, reason: 'error: ' + (e && e.message) };
    }
  }

  root.AnimConventionCompensator = {
    processClip: processClip,
    version: '2.0.0',
    // 诊断接口（控制台排查用）
    _diag: function (model) {
      var info = getModelBind(model);
      if (info.unsupported) return { supported: false, reason: info.unsupported };
      var c = buildCompensation(info);
      return { supported: true, matched: c.matched, maxDev: +c.maxDev.toFixed(1), worst: c.worst,
        willCompensate: !info.restBroken && c.maxDev > TRIGGER_DEG,
        sunk: !!(info.sink && info.sink.ok), restBroken: info.restBroken };
    }
  };
})();
