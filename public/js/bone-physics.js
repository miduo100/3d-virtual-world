/**
 * BonePhysics —— 骨骼物理引擎（Dynamic Bone / PhysBone 风格）
 * 让模型头发/马尾/尾巴/裙子/丝带/胸部等骨骼链跟随移动自然摆动。
 *
 * 原理：
 *   1. 按骨骼名自动识别"物理骨骼"（匹配词在 bonePhysicsConfig.js），构建质点系统。
 *   2. 每个物理骨骼是世界空间质点，用 verlet 积分（真实惯性）：急停前冲/转向甩动/加速拖尾。
 *   3. 重力每帧施加；弹性回拉把质点向动画位置软拉；距离约束保持子→父 rest 长度。
 *      稳定性关键：每帧先把骨骼旋转恢复为绑定姿势再取动画快照，杜绝自激漂移。
 *   4. 旋转应用：旋转每个物理骨骼自身，使"父→子"方向从动画方向对齐到物理方向。
 *   5. 根骨骼（父非物理）默认刚性跟随动画，作为整条链的锚。
 *
 * 2026-09 摆动调优（层0/1/2）：
 *   - 阶段0「角色平移跟随」：质点继承角色根节点真实位移（DynamicBone m_ObjectMove 语义），
 *     跑动不再被甩在身后拉直/卷曲；只跟随平移不跟旋转，转向甩动完整保留。
 *   - 帧率无关阻尼 (1-damping)^(dt*60)；最大偏移钳制 maxOffsetRatio×restLen（防飞起/卷曲）；
 *     分层转角：链根段 maxAngleRoot、其余 maxAngle。
 *   - 参数集中在 bonePhysicsConfig.js，控制台 window.BonePhysicsTuning 可实时热调。
 */
(function () {
  'use strict';

  // 参数与匹配词集中到 bonePhysicsConfig.js（window.BonePhysicsConfig）；此处最小回退防独立崩溃
  var PHYSICS_PATTERNS = (window.BonePhysicsConfig && window.BonePhysicsConfig.PATTERNS) || [
    /hair/i, /tail/i, /skirt/i, /cape/i, /ribbon/i, /bun/i, /breast/i,
    /ahoge/i, /kemomimi/i, /bell/i, /fringe/i, /bang/i, /\bear\b/i,
    /tassel/i, /sash/i, /ponytail/i
  ];
  var DEFAULT_OPTIONS = (window.BonePhysicsConfig && window.BonePhysicsConfig.DEFAULTS) || {
    enabled: true, gravity: 4.0, damping: 0.32, stiffness: 18, elasticity: 3.5,
    iterations: 1, maxAngle: 35, maxAngleRoot: 18, maxOffsetRatio: 0.45,
    maxOffsetRootRatio: 0.25, moveFollow: 0.97, teleportSpeed: 60,
    scaleNormalize: true, rootInPhysics: false, groups: []
  };

  // 求骨骼世界位置（写入 target 返回）
  function worldPos(bone, target) {
    bone.updateWorldMatrix(false, true);
    return target.setFromMatrixPosition(bone.matrixWorld);
  }

  function BonePhysics(model, options) {
    this.model = model;
    this._userOptions = options || {};
    this.options = this._mergeOptions(this._userOptions);
    this._particles = []; // 质点数据
    this._map = new Map(); // bone -> particle 索引
    this._initialized = false;
    this._firstUpdate = true;
    this._hasPrevRoot = false; // 阶段0：是否已有上一帧根位置
    this._teleported = false;  // 阶段0：本帧判定为传送/重生
    this._lenScale = 1;        // 重力尺度归一（按骨架高度估算）
    this._alive = true;        // dispose 后 false，供 Tuning 清理

    // 预分配临时对象（避免每帧 GC）
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._curRootPos = new THREE.Vector3(); // 阶段0平移跟随
    this._prevRootPos = new THREE.Vector3();
    this._move = new THREE.Vector3();

    this.build();
    if (window.BonePhysicsConfig && window.BonePhysicsConfig._register) {
      window.BonePhysicsConfig._register(this);
    }
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
    if (Array.isArray(opts.groupOverride)) merged.groups = merged.groups.concat(opts.groupOverride);
    return merged;
  };

  // 骨骼名是否物理骨骼（'ear' 走词边界避免误伤 ForeArm）
  BonePhysics.prototype._isPhysicsBone = function (name) {
    var n = name || '';
    for (var i = 0; i < PHYSICS_PATTERNS.length; i++) {
      if (PHYSICS_PATTERNS[i].test(n)) return true;
    }
    return false;
  };

  // 按骨骼名匹配分组参数
  BonePhysics.prototype._matchGroup = function (name) {
    var groups = this.options.groups || [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g && g.match && g.match.test(name)) return g;
    }
    return null;
  };

  // 参数（含分组覆盖）应用到粒子；refreshOptions 热更新时复用
  BonePhysics.prototype._applyGroupToParticle = function (p, group) {
    var opt = this.options;
    p.gravity = opt.gravity;
    p.damping = Math.min(Math.max(opt.damping, 0), 0.95);
    p.stiffness = opt.stiffness;
    p.elasticity = Math.min(Math.max(opt.elasticity, 0.1), 30);
    p.maxOffsetRatio = p.isRoot ? opt.maxOffsetRootRatio : opt.maxOffsetRatio;
    p.maxAngle = p.isRoot ? opt.maxAngleRoot : opt.maxAngle;
    if (!group) return;
    if (group.gravity !== undefined) p.gravity = group.gravity;
    if (group.damping !== undefined) p.damping = Math.min(Math.max(group.damping, 0), 0.95);
    if (group.stiffness !== undefined) p.stiffness = group.stiffness;
    if (group.elasticity !== undefined) p.elasticity = Math.min(Math.max(group.elasticity, 0.1), 30);
    if (group.maxOffsetRatio !== undefined) p.maxOffsetRatio = group.maxOffsetRatio;
    if (group.maxAngle !== undefined) p.maxAngle = group.maxAngle;
    if (p.isRoot && group.maxAngleRoot !== undefined) p.maxAngle = group.maxAngleRoot;
  };

  BonePhysics.prototype.build = function () {
    var self = this;
    var bones = [];
    var seen = new Set();

    // 收集场景树骨骼 + 蒙皮骨骼（可能不在场景树）
    this.model.traverse(function (n) {
      if (n.isBone && !seen.has(n.uuid)) { seen.add(n.uuid); bones.push(n); }
    });
    this.model.traverse(function (n) {
      if (n.isMesh && n.skeleton && n.skeleton.bones) {
        n.skeleton.bones.forEach(function (b) {
          if (b && !seen.has(b.uuid)) { seen.add(b.uuid); bones.push(b); }
        });
      }
    });

    if (!bones.length) {
      console.warn('[BonePhysics] 未找到骨骼，物理已禁用');
      return;
    }
    this._bones = bones;

    // 标记物理骨骼 + 计算深度
    var isPhys = new Map();
    var depth = new Map();
    var self2 = this;
    bones.forEach(function (b) { isPhys.set(b, self2._isPhysicsBone(b.name)); });
    bones.forEach(function (b) {
      var d = 0, cur = b;
      while (cur.parent && cur.parent.isBone && d < 64) { cur = cur.parent; d++; }
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
        bone: b, parent: parent, isRoot: root,
        participates: !root || rootInPhysics, // 是否参与积分/旋转
        animPos: new THREE.Vector3(),
        animQuat: new THREE.Quaternion(),
        baseLocalQuat: new THREE.Quaternion(),
        bindLocalQuat: new THREE.Quaternion().copy(b.quaternion), // 绑定姿势局部旋转
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(), // 上帧物理位置（verlet 惯性）
        restLen: 0,
        depth: depth.get(b) || 0,
        _lastAngleDeg: 0, // 诊断：上一帧实际转角
        gravity: 0, damping: 0, stiffness: 0, elasticity: 0, // 由 _applyGroupToParticle 赋值
        maxAngle: 0, maxOffsetRatio: 0
      };
      self2._applyGroupToParticle(p, group);
      self2._particles.push(p);
      self2._map.set(b, p);
    });

    // 按深度排序（父先于子）
    this._particles.sort(function (a, b) { return a.depth - b.depth; });

    // 计算每骨"延伸方向"（自身局部空间单位向量）：旋转 quaternion 只改变"本骨→子骨"方向，
    // 摆动基准须为"本骨→物理子骨"方向；末端骨无物理子则沿用"父→本骨"方向。
    var childByParent = new Map();
    this._particles.forEach(function (q) { if (q.parent) childByParent.set(q.parent, q); });
    this._particles.forEach(function (q) {
      var child = childByParent.get(q.bone);
      q.childParticle = child || null;
      var dir;
      if (child) {
        dir = child.bone.position.clone();
      } else {
        dir = q.bone.position.clone();
        if (dir.lengthSq() > 0.000001) dir.applyQuaternion(q.bindLocalQuat.clone().invert());
      }
      if (dir.lengthSq() < 0.000001) dir.set(0, 0, 1);
      q.extendDir = dir.normalize();
    });

    if (this._particles.length) {
      console.log('[BonePhysics] 初始化完成：物理骨骼 ' + this._particles.length + ' 个');
      this._initialized = true;
    }
  };

  // 传送/重生：粒子吸附到最新动画位置，避免巨大位移把头发甩飞
  BonePhysics.prototype._resetParticles = function () {
    for (var i = 0; i < this._particles.length; i++) {
      var p = this._particles[i];
      p.pos.copy(p.animPos);
      p.prev.copy(p.animPos);
    }
  };

  BonePhysics.prototype.update = function (dt) {
    if (!this._initialized || !this.options.enabled) return;
    if (!this.model) return;

    dt = Math.min(Math.max(dt || 0.016, 0.001), 0.05); // 钳制
    var dt2 = dt * dt;
    var i, p;

    // ── 阶段0：角色平移跟随（m_ObjectMove）。质点只靠 2%/帧 回拉追不上跑动位移，
    // 会被甩在身后拉直/卷曲。这里把根节点本帧真实位移直接加给所有质点（pos+prev 同加
    // 不产生速度）；只跟平移不跟旋转，转向/加减速甩动保留。
    this.model.updateWorldMatrix(true, false); // 只刷新祖先链+自身
    this._curRootPos.setFromMatrixPosition(this.model.matrixWorld);
    if (this._hasPrevRoot) {
      this._move.subVectors(this._curRootPos, this._prevRootPos);
      if (this._move.length() / dt > this.options.teleportSpeed) {
        this._teleported = true; // 传送：跳过跟随，稍后吸附重置
      } else if (this._move.lengthSq() > 1e-12) {
        var f = this.options.moveFollow;
        for (i = 0; i < this._particles.length; i++) {
          p = this._particles[i];
          p.pos.addScaledVector(this._move, f);
          p.prev.addScaledVector(this._move, f);
        }
      }
    } else {
      this._hasPrevRoot = true;
    }
    this._prevRootPos.copy(this._curRootPos);

    // 1. 恢复绑定姿势，快照获得干净的动画基准（无自反馈漂移）
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      p.bone.quaternion.copy(p.bindLocalQuat);
    }
    this.model.updateMatrixWorld(true);

    // 2. 快照：动画位置/旋转（应用物理前）
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      worldPos(p.bone, p.animPos);
      p.animQuat.setFromRotationMatrix(p.bone.matrixWorld);
      p.baseLocalQuat.copy(p.bone.quaternion);
    }

    // 3. 首次更新：初始化物理位置/restLen + 估算骨架高度（重力归一化）
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
      if (this.options.scaleNormalize && this._bones) {
        var _minY = Infinity, _maxY = -Infinity, _by;
        for (var _bi = 0; _bi < this._bones.length; _bi++) {
          _by = this._bones[_bi].matrixWorld.elements[13];
          if (_by < _minY) _minY = _by;
          if (_by > _maxY) _maxY = _by;
        }
        var _span = _maxY - _minY;
        this._lenScale = _span > 0.01 ? Math.max(0.5, Math.min(2, _span / 1.6)) : 1;
      }
      this._firstUpdate = false;
    }

    // 传送/重生：吸附（此时 animPos 已是最新快照）
    if (this._teleported) {
      this._resetParticles();
      this._teleported = false;
    }

    // 4. 物理积分（verlet 惯性 + 弹性回拉 + 软距离约束，父先子后）
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

      // 速度（惯性）。帧率无关阻尼：掉帧观感一致（原 (1-d) 与帧率相关）
      v1.copy(p.pos).sub(p.prev).multiplyScalar(Math.pow(1 - p.damping, dt * 60));

      // 推进 + 重力（按骨架高度归一化，模板间观感一致）
      v2.copy(p.pos).add(v1);
      if (p.gravity !== 0) {
        v2.y -= p.gravity * this._lenScale * dt2;
      }

      // 弹性回拉：向动画位置软回拉
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

      // 最大偏移钳制（防跑动飞起/卷曲）：压在 ratio×restLen 内，
      // 并抹掉速度中"继续向外"的分量（否则贴边高频抖动）
      var maxOff = p.maxOffsetRatio * p.restLen;
      if (maxOff > 0) {
        v1.subVectors(p.pos, p.animPos);
        var offLen = v1.length();
        if (offLen > maxOff && offLen > 1e-6) {
          v1.multiplyScalar(1 / offLen); // 外向单位法线
          p.pos.copy(p.animPos).addScaledVector(v1, maxOff);
          var outV = v3.subVectors(p.pos, p.prev).dot(v1);
          if (outV > 0) p.prev.addScaledVector(v1, outV);
        }
      }
    }

    // 5. 旋转应用：旋转每骨使"延伸方向"从动画方向对齐到物理方向。
    //    v1 = 基础姿态延伸方向；v2 = 物理目标方向（有物理子：子粒子−本骨位置；
    //    末端：本骨粒子−父动画位置），参考点与 v1 一致，摆动才能平滑传播到末端。
    for (i = 0; i < this._particles.length; i++) {
      p = this._particles[i];
      if (p.isRoot && !p.participates) continue;
      if (!p.parent) continue;

      // 父骨骼世界旋转（动画后、物理前）
      var fp = this._map.get(p.parent);
      var fWorldQuat = fp ? fp.animQuat : this._q1.setFromRotationMatrix(p.parent.matrixWorld);
      var fWorldQuatInv = this._q2.copy(fWorldQuat).invert();

      v1.copy(p.extendDir).applyQuaternion(p.baseLocalQuat);
      if (v1.lengthSq() < 0.000001) continue;

      var pChild = p.childParticle;
      if (pChild) {
        worldPos(p.bone, v3);
        v2.copy(pChild.pos).sub(v3);
      } else {
        worldPos(p.parent, v3);
        v2.copy(p.pos).sub(v3);
      }
      v2.applyQuaternion(fWorldQuatInv);
      if (v2.lengthSq() < 0.000001) continue;
      v2.normalize();

      this._q1.setFromUnitVectors(v1, v2);
      p._lastAngleDeg = Math.acos(Math.min(1, Math.abs(this._q1.w))) * 2 * 180 / Math.PI;
      // 角度钳制：链根段走 maxAngleRoot、其余走 maxAngle；保留旋转轴按比例缩角防翻折
      var maxRad = (p.maxAngle || 35) * Math.PI / 180;
      if (maxRad < Math.PI) {
        var halfAng = Math.acos(Math.min(1, Math.abs(this._q1.w))); // 旋转半角
        if (halfAng > maxRad * 0.5) {
          var axis = this._v3.set(this._q1.x, this._q1.y, this._q1.z);
          if (axis.lengthSq() > 1e-12) {
            axis.normalize();
            var s = Math.sin(maxRad * 0.5);
            this._q1.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(maxRad * 0.5));
          }
        }
      }
      // 左乘：父局部空间叠加物理旋转，同时保留基础姿态
      p.bone.quaternion.copy(this._q1).multiply(p.baseLocalQuat);
    }

    // 6. 应用旋转后的世界矩阵（渲染需要）
    this.model.updateMatrixWorld(true);
  };

  // 运行时热更新参数（BonePhysicsTuning.set/reset 调用所有存活实例）
  BonePhysics.prototype.refreshOptions = function () {
    if (!this.model) return;
    this.options = this._mergeOptions(this._userOptions);
    var self = this;
    this._particles.forEach(function (p) {
      self._applyGroupToParticle(p, self._matchGroup(p.bone.name));
    });
    if (this._initialized) {
      console.log('[BonePhysics] 参数已热更新（物理骨骼 ' + this._particles.length + ' 个）');
    }
  };

  // 诊断：每骨 restLen / 当前偏移 / 限幅上限 / 实际转角
  BonePhysics.prototype.diag = function () {
    if (!this._initialized) return { ok: false, particles: [] };
    var list = [];
    for (var i = 0; i < this._particles.length; i++) {
      var p = this._particles[i];
      list.push({
        bone: p.bone.name,
        root: !!p.isRoot,
        restLen: +p.restLen.toFixed(4),
        offset: +p.pos.distanceTo(p.animPos).toFixed(4),
        maxOffset: +(p.maxOffsetRatio * p.restLen).toFixed(4),
        angleDeg: +(p._lastAngleDeg || 0).toFixed(1),
        maxAngle: p.maxAngle
      });
    }
    return {
      ok: true,
      enabled: !!this.options.enabled,
      lenScale: +(this._lenScale || 1).toFixed(3),
      count: list.length,
      particles: list
    };
  };

  // 销毁
  BonePhysics.prototype.dispose = function () {
    this._alive = false;
    this._particles = [];
    this._map.clear();
    this._initialized = false;
    this.model = null;
    if (window.BonePhysicsConfig && window.BonePhysicsConfig._unregister) {
      window.BonePhysicsConfig._unregister(this);
    }
  };

  // 全局访问
  window.BonePhysics = BonePhysics;

  /**
   * 便捷初始化。options 可选：不传则使用 bonePhysicsConfig.js 全局默认（推荐，可热调）
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
