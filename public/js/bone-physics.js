/**
 * BonePhysics —— 骨骼物理引擎（Dynamic Bone / PhysBone 风格）
 * ------------------------------------------------------------------
 * 用途：让 VRChat 等模型的头发 / 马尾 / 尾巴 / 裙子 / 丝带 / 胸部等
 *       骨骼链跟随角色移动而自然飘动、抖动、摆动。
 *
 * 原理（Dynamic Bone 经典算法）：
 *   1. 基于骨骼树自动识别"物理骨骼"（名称含物理关键词），构建质点系统。
 *   2. 每个物理骨骼是一个世界空间质点，用 verlet 积分（真实惯性）：
 *      急停时前冲、转向时甩动、加速时拖尾。
 *   3. 重力：每帧施加，让头发自然下垂。
 *   4. 弹性回拉（elasticity）：质点向"动画位置"软回拉。
 *   5. 距离约束（stiffness）：保持子→父的 rest 长度，用软弹簧实现。
 *      稳定性关键：每帧先把骨骼旋转恢复为绑定姿势再取动画快照，
 *      物理旋转不会污染下一帧的动画基准，从而杜绝自激漂移。
 *   6. 旋转应用：旋转每个物理骨骼自身，使其"父→子"方向从动画方向
 *      对齐到物理方向（每个子骨骼独立旋转，扇状结构互不干扰）。
 *   7. 根骨骼（父不是物理骨骼）默认刚性跟随动画，作为整条链的锚。
 *
 * 驱动源不依赖动画：角色整体移动 / 转向 / 加速时，动画位置改变而
 * 物理质点滞后，即产生拖拽飘动；动画驱动的骨骼起伏会叠加更丰富摆动。
 *
 * 用法：
 *   const bp = new BonePhysics(model, { gravity: 4, stiffness: 15, elasticity: 3 });
 *   characterGroup.userData.bonePhysics = bp;
 *   // 每帧（在动画 mixer 更新之后、渲染之前）：
 *   bp.update(deltaSeconds);
 */
(function () {
  'use strict';

  // ===== 物理骨骼关键词（小写匹配） =====
  var PHYSICS_KEYWORDS = [
    'hair', 'tail', 'skirt', 'cape', 'ribbon', 'bun', 'breast',
    'ahoge', 'kemomimi', 'bell', 'dress', 'fringe', 'bang',
    'ear', 'tassel', 'sash', 'hem', 'coat', 'ponytail',
    'twin', 'cloth', 'muscle', 'cloth_'
  ];

  // ===== 默认参数 =====
  var DEFAULT_OPTIONS = {
    enabled: true,
    gravity: 4.0,       // 重力加速度（世界单位/秒²），越大下垂越明显
    damping: 0.15,      // 阻尼 0~1，越大摆动衰减越快（越"重"）
    stiffness: 15,      // 距离约束强度（速率），越大链越"硬"（不易拉长变形）
    elasticity: 1.2,    // 弹性回拉强度（速率），越大越贴动画（越"硬"），越小越飘
    iterations: 1,      // 距离约束迭代次数
    maxAngle: 110,      // 单骨骼最大旋转角（度），防止 bind 造型与重力方向冲突时翻转
    rootInPhysics: false, // 根骨骼（父非物理）是否也参与物理摆动
    // 名称分组参数：先匹配的组覆盖默认参数
    groups: [
      // 胸部：轻微弹抖、回弹快、不夸张下垂
      { match: /breast/i, gravity: 0.8, stiffness: 25, elasticity: 5, damping: 0.22, rootInPhysics: true },
      // 马尾 / 尾巴：明显拖拽
      { match: /(ponytail|_tail|tail\.)/i, gravity: 5.0, stiffness: 12, elasticity: 1.0, damping: 0.13 },
      // 裙子：轻重力 + 强回拉，静止时贴合绑定造型，转动时才飘
      { match: /skirt/i, gravity: 1.2, stiffness: 12, elasticity: 2.8, damping: 0.14 },
      // 呆毛：轻、弹、灵动
      { match: /ahoge/i, gravity: 2.0, stiffness: 22, elasticity: 3.5, damping: 0.1 },
      // 兽耳：轻微摆动
      { match: /(kemomimi|kemo_ear|kemoear)/i, gravity: 1.5, stiffness: 22, elasticity: 3, damping: 0.14 },
      // 丝带 / 铃铛 / 披风：轻盈飘动
      { match: /(ribbon|bell|cape)/i, gravity: 4.0, stiffness: 15, elasticity: 1.2, damping: 0.12 }
    ]
  };

  // 小工具：求某骨骼世界位置（返回 target）
  function worldPos(bone, target) {
    bone.updateWorldMatrix(false, true);
    return target.setFromMatrixPosition(bone.matrixWorld);
  }

  function BonePhysics(model, options) {
    this.model = model;
    this.options = this._mergeOptions(options);
    this._particles = []; // 质点数据
    this._map = new Map(); // bone -> particle 索引
    this._initialized = false;
    this._firstUpdate = true;

    // 预分配临时对象（避免每帧 GC）
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();

    this.build();
  }

  BonePhysics.prototype._mergeOptions = function (opts) {
    opts = opts || {};
    var merged = {};
    Object.keys(DEFAULT_OPTIONS).forEach(function (k) {
      merged[k] = DEFAULT_OPTIONS[k];
    });
    Object.keys(opts).forEach(function (k) {
      if (k === 'groups' || k === 'groupOverride') return;
      merged[k] = opts[k];
    });
    if (Array.isArray(opts.groups)) merged.groups = opts.groups.slice();
    if (Array.isArray(opts.groupOverride)) {
      merged.groups = merged.groups.concat(opts.groupOverride);
    }
    return merged;
  };

  // 判断骨骼名是否为物理骨骼
  BonePhysics.prototype._isPhysicsBone = function (name) {
    var lower = (name || '').toLowerCase();
    for (var i = 0; i < PHYSICS_KEYWORDS.length; i++) {
      if (lower.indexOf(PHYSICS_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  };

  // 根据骨骼名匹配分组参数
  BonePhysics.prototype._matchGroup = function (name) {
    var groups = this.options.groups || [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g && g.match && g.match.test(name)) return g;
    }
    return null;
  };

  BonePhysics.prototype.build = function () {
    var self = this;
    var bones = [];
    var seen = new Set();

    // 收集场景树中的骨骼
    this.model.traverse(function (n) {
      if (n.isBone && !seen.has(n.uuid)) {
        seen.add(n.uuid);
        bones.push(n);
      }
    });
    // 补充蒙皮骨骼（可能不在场景树中）
    this.model.traverse(function (n) {
      if (n.isMesh && n.skeleton && n.skeleton.bones) {
        n.skeleton.bones.forEach(function (b) {
          if (b && !seen.has(b.uuid)) {
            seen.add(b.uuid);
            bones.push(b);
          }
        });
      }
    });

    if (!bones.length) {
      console.warn('[BonePhysics] 未找到骨骼，物理已禁用');
      return;
    }

    // 标记物理骨骼 + 计算深度
    var isPhys = new Map();
    var depth = new Map();
    var self2 = this;
    bones.forEach(function (b) {
      isPhys.set(b, self2._isPhysicsBone(b.name));
    });
    bones.forEach(function (b) {
      var d = 0, cur = b;
      while (cur.parent && cur.parent.isBone && d < 64) {
        cur = cur.parent; d++;
      }
      depth.set(b, d);
    });

    // 构建质点
    this._particles = [];
    this._map.clear();

    var opt = this.options;
    var rootInPhysicsDefault = !!opt.rootInPhysics;

    bones.forEach(function (b) {
      if (!isPhys.get(b)) return;
      var parent = b.parent && b.parent.isBone ? b.parent : null;
      var parentIsPhys = parent ? !!isPhys.get(parent) : false;
      var root = !parentIsPhys; // 根 = 父不是物理骨骼

      var group = self2._matchGroup(b.name);
      var rootInPhysics = rootInPhysicsDefault;
      if (group && group.rootInPhysics !== undefined) rootInPhysics = !!group.rootInPhysics;

      var p = {
        bone: b,
        parent: parent,
        isRoot: root,
        participates: !root || rootInPhysics, // 是否参与积分/旋转
        // 每帧快照
        animPos: new THREE.Vector3(),
        animQuat: new THREE.Quaternion(),
        baseLocalQuat: new THREE.Quaternion(),
        bindLocalQuat: new THREE.Quaternion().copy(b.quaternion), // 绑定姿势局部旋转
        // 物理状态
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(), // 上帧物理位置（verlet 惯性）
        restLen: 0,
        depth: depth.get(b) || 0,
        // 参数（组覆盖）
        gravity: opt.gravity,
        damping: opt.damping,
        stiffness: opt.stiffness,
        elasticity: opt.elasticity
      };
      if (group) {
        if (group.gravity !== undefined) p.gravity = group.gravity;
        if (group.damping !== undefined) p.damping = group.damping;
        if (group.stiffness !== undefined) p.stiffness = group.stiffness;
        if (group.elasticity !== undefined) p.elasticity = group.elasticity;
      }
      self2._particles.push(p);
      self2._map.set(b, p);
    });

    // 按深度排序（父先于子）
    this._particles.sort(function (a, b) { return a.depth - b.depth; });

    // 计算每个物理骨骼的"延伸方向"（骨骼自身局部空间单位向量）。
    // 关键：旋转骨骼 quaternion 只改变"本骨骼→子骨骼"的方向（不改变本骨骼自身位置），
    // 因此摆动基准必须是"本骨骼→物理子骨骼"的方向；末端骨骼无物理子，沿用"父→本骨骼"方向。
    // 同时记录"物理子粒子"，供旋转应用阶段取一致的参考点。
    var childByParent = new Map();
    this._particles.forEach(function (q) {
      if (q.parent) childByParent.set(q.parent, q);
    });
    this._particles.forEach(function (q) {
      var child = childByParent.get(q.bone);
      q.childParticle = child || null;
      var dir;
      if (child) {
        dir = child.bone.position.clone(); // "本骨骼→子骨骼"局部方向
      } else {
        // 末端：把"父→本骨骼"方向转到本骨骼自身空间（bind 姿态）
        dir = q.bone.position.clone();
        if (dir.lengthSq() > 0.000001) {
          dir.applyQuaternion(q.bindLocalQuat.clone().invert());
        }
      }
      if (dir.lengthSq() < 0.000001) dir.set(0, 0, 1); // 兜底方向
      q.extendDir = dir.normalize();
    });

    if (this._particles.length) {
      console.log('[BonePhysics] 初始化完成：物理骨骼 ' + this._particles.length + ' 个');
      this._initialized = true;
    }
  };

  BonePhysics.prototype.update = function (dt) {
    if (!this._initialized || !this.options.enabled) return;
    if (!this.model) return;

    dt = Math.min(Math.max(dt || 0.016, 0.001), 0.05); // 钳制
    var dt2 = dt * dt;

    // 1. 恢复绑定姿势：清除上一帧物理写入的骨骼旋转，
    //    使快照获得"干净的动画基础姿势"（无自反馈漂移）。
    //    注意：若未来有动画驱动这些物理骨骼，动画 mixer 会每帧覆盖，
    //    此时应跳过恢复（本引擎默认物理骨骼不被动画直接驱动）。
    var i, p;
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      p.bone.quaternion.copy(p.bindLocalQuat);
    }
    // 刷新世界矩阵（动画 mixer 已更新局部旋转，这里让世界矩阵同步）
    this.model.updateMatrixWorld(true);

    // 2. 快照：所有物理骨骼的动画位置/旋转（应用物理前）
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      worldPos(p.bone, p.animPos);
      p.animQuat.setFromRotationMatrix(p.bone.matrixWorld);
      p.baseLocalQuat.copy(p.bone.quaternion);
    }

    // 3. 首次更新：初始化物理位置与速度基准
    if (this._firstUpdate) {
      for (i = 0; i < this._particles.length; i++) {
        p = this._particles[i];
        p.pos.copy(p.animPos);
        p.prev.copy(p.animPos);
        if (p.parent) {
          worldPos(p.parent, this._v1);
          p.restLen = p.animPos.distanceTo(this._v1);
        } else {
          p.restLen = 0;
        }
      }
      this._firstUpdate = false;
    }

    // 4. 物理积分（verlet 真实惯性 + 弹性回拉 + 软距离约束，按深度父先子后）
    var v1 = this._v1, v2 = this._v2, v3 = this._v3;
    var kElastic, kStiff;
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];

      // 刚性根：直接跟随动画位置
      if (p.isRoot && !p.participates) {
        p.pos.copy(p.animPos);
        p.prev.copy(p.animPos);
        continue;
      }

      // 速度 = 物理真实速度（惯性，急停时头发前冲、转向时甩动）
      v1.copy(p.pos).sub(p.prev).multiplyScalar(1 - p.damping);

      // 推进：当前物理位置 + 速度 + 重力
      v2.copy(p.pos).add(v1);
      if (p.gravity !== 0) {
        v2.y -= p.gravity * dt2;
      }

      // 弹性回拉：向动画位置软回拉（帧率无关）
      kElastic = 1 - Math.exp(-p.elasticity * dt);
      v2.lerp(p.animPos, Math.min(kElastic, 1));

      // 距离约束（软弹簧）：保持子→父 rest 距离
      var anchor;
      var pp = p.parent ? this._map.get(p.parent) : null;
      if (pp) {
        anchor = pp.pos; // 父物理位置（父已先更新）
      } else if (p.parent) {
        worldPos(p.parent, v3);
        anchor = v3;
      } else {
        anchor = p.animPos;
      }
      var dx = v2.x - anchor.x, dy = v2.y - anchor.y, dz = v2.z - anchor.z;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 0.000001 && p.restLen > 0) {
        var scale = p.restLen / dist;
        v3.set(anchor.x + dx * scale, anchor.y + dy * scale, anchor.z + dz * scale);
        kStiff = 1 - Math.exp(-p.stiffness * dt);
        v2.lerp(v3, Math.min(kStiff, 1));
      }

      // 写回
      p.prev.copy(p.pos);
      p.pos.copy(v2);
    }

    // 5. 旋转应用：旋转骨骼自身，使其"延伸方向"从基础姿态方向对齐到物理方向
    //    注意：旋转骨骼 quaternion 只改变"本骨骼→子骨骼"方向（不改变自身位置），
    //    因此 v1 取"本骨骼→物理子骨骼"的延伸方向（build 时算好的 extendDir）；
    //    v2 的参考点必须与 v1 保持一致（都从本骨骼出发）：
    //      - 有物理子：物理方向 = 子粒子位置 − 本骨骼世界位置
    //      - 末端骨骼：物理方向 = 本骨骼粒子位置 − 父锚点
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      if (p.isRoot && !p.participates) continue;
      if (!p.parent) continue;

      // 父骨骼世界旋转（动画后，应用物理前）
      var fp = this._map.get(p.parent);
      var fWorldQuat = fp ? fp.animQuat : this._q1.setFromRotationMatrix(p.parent.matrixWorld);
      var fWorldQuatInv = this._q2.copy(fWorldQuat).invert();

      // 基础姿态下的延伸方向（父局部空间）：局部延伸方向 × 基础姿态
      v1.copy(p.extendDir).applyQuaternion(p.baseLocalQuat);
      if (v1.lengthSq() < 0.000001) continue;

      // 物理目标方向（父局部空间），参考点与 v1 一致（都从本骨骼出发）
      var pChild = p.childParticle;
      if (pChild) {
        // 有物理子：目标 = 子粒子位置 − 本骨骼世界位置
        worldPos(p.bone, v3);
        v2.copy(pChild.pos).sub(v3);
      } else {
        // 末端：目标 = 本骨骼粒子位置 − 父骨骼动画位置（bind 位置）。
        // 统一与"有物理子"分支的基准一致（都相对 bind 位置），摆动才能平滑传播到末端；
        // 若用父粒子位置，父粒子与末端粒子同步滞后、相减后方向不变，末端将不转、摆动被截断。
        worldPos(p.parent, v3);
        v2.copy(p.pos).sub(v3);
      }
      v2.applyQuaternion(fWorldQuatInv);
      if (v2.lengthSq() < 0.000001) continue;
      v2.normalize();

      this._q1.setFromUnitVectors(v1, v2);
      // 角度钳制：部分装饰骨骼（如贴身的缎带）bind 造型与重力方向夹角极大，
      // 直接对齐会整体翻折，视觉上像"反穿"。限制单骨骼旋转角避免翻转。
      var maxRad = this.options.maxAngle * Math.PI / 180;
      if (maxRad < Math.PI) {
        var halfAng = Math.acos(Math.min(1, Math.abs(this._q1.w))); // 旋转半角
        if (halfAng > maxRad * 0.5) {
          // 保留旋转轴、按比例缩小旋转角
          var axis = this._v3.set(this._q1.x, this._q1.y, this._q1.z);
          if (axis.lengthSq() > 1e-12) {
            axis.normalize();
            var s = Math.sin(maxRad * 0.5);
            this._q1.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(maxRad * 0.5));
          }
        }
      }
      // 左乘：在父局部空间下叠加物理旋转，同时保留基础姿态
      p.bone.quaternion.copy(this._q1).multiply(p.baseLocalQuat);
    }

    // 6. 应用旋转后的世界矩阵（渲染需要）
    this.model.updateMatrixWorld(true);
  };

  // 销毁
  BonePhysics.prototype.dispose = function () {
    this._particles = [];
    this._map.clear();
    this._initialized = false;
    this.model = null;
  };

  // 全局访问
  window.BonePhysics = BonePhysics;

  /**
   * 便捷初始化：传入模型，返回 BonePhysics 实例（失败返回 null）
   */
  window.initBonePhysics = function (model, options) {
    try {
      if (!model || typeof THREE === 'undefined') return null;
      return new BonePhysics(model, options);
    } catch (e) {
      console.warn('[BonePhysics] 初始化失败:', e);
      return null;
    }
  };

})();
