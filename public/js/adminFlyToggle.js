/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * adminFlyToggle.js — 管理员模式飞行开关：面板开关 + H 键，缓降落地（2026-11-06）  v1
 * 诊断：window.AdminFlyToggle._diag()
 *
 * 为什么独立成文件（对齐《开发规范-代码组织与文件边界》）：
 *  - player.js 1839 行 ≥1000 = 冻结档，禁止追加新功能 → 本模块用「旁路包装」
 *    包住 Player.prototype 的 enableFlying / disableFlying / handleVerticalMovement，
 *    原文件 0 改动（规范 §1.4 处置法 3）。
 *  - buildingManager.js 1103 行同样冻结 → 不改，面板靠 500ms 巡检注入（§5 惯例频率）。
 *  - F 键已被"世界交互"占用（开门/交互点/视频声音）→ 热键用 H。
 *
 * 行为约定（2026-11-06 与策凌确认）：
 *  - 飞行中完全无视碰撞（可穿墙穿楼，方便钻进建筑内部看结构）；
 *  - 升降跟着视角走（抬头 + W 往上飞），Shift 只做加速，不负责下降；
 *  - 飞行/缓降期间**视角不回正**（保持拖到的俯仰角，否则一回平就爬升中断）；
 *  - 关开关不直接掉下来，而是以 8m/s 缓降到地面再退出；
 *  - 高度不封顶。
 *
 * 关闭本模块：window.__ADMIN_FLY_OFF = true（需在脚本加载前设置）。
 */
(function () {
  'use strict';
  if (window.__ADMIN_FLY_OFF) return;
  if (window.AdminFlyToggle) return;                 // 幂等（规范 §2.4）

  var CFG = {
    LAND_SPEED: 8,      // 缓降速度 m/s
    LAND_EPS: 0.15,     // 触地容差 m
    HOTKEY: 'h',        // 切换热键（F 已被交互占用）
    BOOST_MIN: 10,      // 飞行时 Shift 加速倍率下限
    BOOST_MAX: 100,     // 上限（地面冲刺仍是原逻辑的 ×3，与这里无关）
    BOOST_DEFAULT: 50,  // 首次使用的默认倍率（100 实测太快，见 2026-11-06 反馈）
    BOOST_STEP: 10,
    BOOST_KEY: 'adminFlyBoost',
    MOUNT_POLL_MS: 500, // 面板巡检间隔（项目惯例 0.5s）
    MOUNT_MAX_TRIES: 240
  };

  var els = null;        // { block, input, track, knob, text }
  var orig = null;       // 原型原始方法
  var mounted = false;
  var pollTimer = null;
  var pollTries = 0;
  var boost = CFG.BOOST_DEFAULT;   // 当前 Shift 加速倍率（面板滑块可调，持久化到 localStorage）

  // ---------------- 小工具 ----------------

  function getPlayer() {
    return window.player || null;
  }

  /** 脚底与模型原点的偏移：GLB 角色原点即脚底；方块人在原点下方 1.5 */
  function feetOffset(p) {
    return (p.worldObject && p.worldObject.userData && p.worldObject.userData.isGlbLoaded) ? 0 : 1.5;
  }

  /** 脚下地面高度（世界 y）；无地面返回 null */
  function groundYAt(p) {
    if (!p || !p.world || typeof p.world.getGroundHeight !== 'function') return null;
    var g = p.world.getGroundHeight(p.position);
    if (g === null || g === undefined || !isFinite(g)) return null;
    return g + feetOffset(p);
  }

  /** 输入框/文本域里按键不触发（聊天、改名等） */
  function isTyping(e) {
    var t = e && e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!(t.isContentEditable);
  }

  function isFlyingNow() {
    var p = getPlayer();
    return !!(p && (p.isFlying || p._flyLanding));
  }

  // ---------------- Shift 加速倍率（10-100，持久化） ----------------

  function loadBoost() {
    try {
      var v = parseInt(localStorage.getItem(CFG.BOOST_KEY), 10);
      if (isFinite(v)) boost = Math.max(CFG.BOOST_MIN, Math.min(CFG.BOOST_MAX, v));
    } catch (e) { /* 隐私模式禁用 localStorage 时按默认值走 */ }
  }

  function setBoost(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return boost;
    n = Math.max(CFG.BOOST_MIN, Math.min(CFG.BOOST_MAX, n));
    boost = n;
    try { localStorage.setItem(CFG.BOOST_KEY, String(boost)); } catch (e) { /* 忽略 */ }
    if (els) {
      if (els.boostVal) els.boostVal.textContent = boost + '×';
      if (els.boost && String(els.boost.value) !== String(boost)) els.boost.value = String(boost);
    }
    return boost;
  }

  // ---------------- UI ----------------

  function buildDom() {
    var block = document.createElement('div');
    block.id = 'admin-fly-block';
    block.style.cssText = 'margin-top:8px; padding:6px 8px; background:rgba(0,0,0,0.45); '
      + 'border:1px solid #444; border-radius:4px;';
    block.innerHTML = ''
      + '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">'
      + '  <span style="color:#aaa; font-size:11px;">🕊 飞行模式</span>'
      + '  <label id="admin-fly-switch" title="开启后朝哪看就往哪飞（抬头=上升）；Shift 加速；关闭时缓降落地" '
      + '         style="position:relative; display:inline-block; width:42px; height:20px; cursor:pointer; flex:0 0 auto;">'
      + '    <input type="checkbox" id="admin-fly-toggle" style="position:absolute; opacity:0; width:0; height:0;">'
      + '    <span id="admin-fly-track" style="position:absolute; inset:0; background:#555; border-radius:20px; transition:background .2s;"></span>'
      + '    <span id="admin-fly-knob" style="position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:transform .2s;"></span>'
      + '  </label>'
      + '</div>'
      + '<div id="admin-fly-text" style="font-size:10px; margin-top:4px; color:#888;">已关闭：正常行走</div>'
      + '<div style="margin-top:6px; padding-top:5px; border-top:1px solid #3a3a3a;">'
      + '  <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa;">'
      + '    <span>Shift 加速</span><span id="admin-fly-boost-val" style="color:#4CAF50;">' + boost + '×</span>'
      + '  </div>'
      + '  <input type="range" id="admin-fly-boost" min="' + CFG.BOOST_MIN + '" max="' + CFG.BOOST_MAX + '"'
      + '         step="' + CFG.BOOST_STEP + '" value="' + boost + '"'
      + '         style="width:100%; height:14px; margin:2px 0 0; accent-color:#4CAF50; cursor:pointer;">'
      + '</div>';

    els = {
      block: block,
      input: block.querySelector('#admin-fly-toggle'),
      track: block.querySelector('#admin-fly-track'),
      knob: block.querySelector('#admin-fly-knob'),
      text: block.querySelector('#admin-fly-text'),
      boost: block.querySelector('#admin-fly-boost'),
      boostVal: block.querySelector('#admin-fly-boost-val')
    };
    els.input.addEventListener('change', function () {
      setFlying(this.checked);
      // 【2026-11-06 修复"按空格飞行自己关了"】点开关后焦点会留在 checkbox 上，
      // 此时按空格会被浏览器当成"激活复选框"→ 再触发一次 change → 飞行被关掉。
      // 点完立刻失焦，空格就只走游戏的跳跃/上升逻辑。
      this.blur();
    });
    // 倍率滑块：input 实时生效（拖的时候就能感觉到），change 后失焦避免抢空格
    els.boost.addEventListener('input', function () {
      setBoost(this.value);
    });
    els.boost.addEventListener('change', function () {
      setBoost(this.value);
      this.blur();
    });
    return block;
  }

  function paint(on) {
    if (!els) return;
    var p = getPlayer();
    var landing = !!(p && p._flyLanding);
    els.input.checked = on;
    els.track.style.background = on ? '#4CAF50' : '#555';
    els.knob.style.transform = on ? 'translateX(22px)' : 'translateX(0)';
    els.text.style.color = on ? '#4CAF50' : '#888';
    els.text.textContent = landing
      ? '缓降中…（再按 H 可恢复飞行）'
      : (on
        ? '飞行中：朝视线方向飞 · Shift 加速'
        : '已关闭：正常行走');
    if (landing) els.text.style.color = '#FFC107';
  }

  // ---------------- 玩家能力（旁路包装 Player.prototype） ----------------

  function patchPlayer() {
    var P = window.Player;
    if (!P || !P.prototype) return false;
    var proto = P.prototype;
    if (proto.__adminFlyPatched) return true;
    if (typeof proto.enableFlying !== 'function' ||
        typeof proto.disableFlying !== 'function' ||
        typeof proto.handleVerticalMovement !== 'function') {
      console.warn('[AdminFly] Player 原型缺少预期方法，飞行开关不装配');
      return false;
    }

    orig = {
      enable: proto.enableFlying,
      disable: proto.disableFlying,
      vertical: proto.handleVerticalMovement,
      anim: proto.updateWalkingAnimation,
      camera: proto.updateCamera,
      move: proto.handleMovement
    };

    proto.enableFlying = function () {
      this._flyLanding = false;
      var r = orig.enable.call(this);
      paint(true);
      return r;
    };

    // 关飞行：高处不直接掉下去，改为缓降（isFlying 保持 true，水平移动继续无视碰撞）
    proto.disableFlying = function () {
      if (!this.isFlying || this._flyLanding) return orig.disable.call(this);
      var gy = groundYAt(this);
      if (gy === null || this.position.y - gy <= CFG.LAND_EPS) {
        this._flyLanding = false;
        var r = orig.disable.call(this);
        paint(false);
        return r;
      }
      this._flyLanding = true;
      this.velocity.y = 0;
      paint(false);
      return undefined;
    };

    proto.handleVerticalMovement = function (delta) {
      if (this._flyLanding) {
        var fs = this._fs || 1;
        var gy = groundYAt(this);
        if (gy === null) {
          // 脚下没有地面（飞出地形外）：直接收尾，剩余交给原逻辑与"掉出世界送回出生点"兜底
          this._flyLanding = false;
          this.isFlying = false;
          this.velocity.y = 0;
          paint(false);
          return;
        }
        var gap = this.position.y - gy;
        if (gap <= CFG.LAND_EPS) {
          this.position.y = gy;
          this.velocity.y = 0;
          this._flyLanding = false;
          this.isFlying = false;
          this.isGrounded = true;
          paint(false);
          return;
        }
        this.position.y = Math.max(gy, this.position.y - CFG.LAND_SPEED * fs);
        return;
      }

      if (this.isFlying) {
        // 【2026-11-06 手感调整】接管原飞行分支：原实现里 Shift = 下降，会和"飞行加速"打架。
        // 改成「视角控制升降」：看哪儿就往哪儿飞，Shift 只做加速。
        //
        // 为什么不直接让 player 用相机的视线方向：第三人称相机每帧 lookAt 玩家，
        // cameraDirection 恒指向角色本身（平视时甚至是 -0.1 的缓降分量），拿它当
        // 飞行方向会"平视一直往下沉"。所以这里改用 MOUSE.rotationX（真正的俯仰输入）
        // 算垂直分量，水平方向仍交给 player 原有的移动逻辑。
        //   第三人称：rotationX>0 = 相机抬高俯视（看向下）→ 负值才是抬头
        //   第一人称：鼠标上移 rotationX 减小 → 同样是负值抬头
        var fs = this._fs || 1;
        var spd = (window.CONFIG && window.CONFIG.PLAYER_SPEED) ? window.CONFIG.PLAYER_SPEED : 0.15;
        if (window.KEYS && window.KEYS.shift) spd *= boost;   // 飞行加速（面板可调 10-100 倍）
        // 【2026-11-06 修复：两个视角的 rotationX 语义相反】
        //   第一人称：player.js:849 直接 euler.x = rotationX。Three 里 euler.x>0 是"看向上方"，
        //            且 main.js:1047 写的是「鼠标上移 → rotationX 增加」→ **正值 = 抬头**。
        //   第三人称：相机位置 targetCameraPos.y += 2 + sin(rotationX)*5，
        //            正值把相机抬到玩家头顶向下看 → **正值 = 低头俯视**。
        // 原实现统一用 pitch = -rotationX，只对第三人称成立：
        //   第一人称低头（rotationX<0）会算成 pitch>0 → y 增加 →「朝下看却往上飞」，方向全反。
        // 因此这里按视角取符号，第三人称行为保持原样。
        var firstPerson = (typeof GAME_STATE !== 'undefined' && GAME_STATE &&
          GAME_STATE.cameraMode === 'first-person');
        var rx = (window.MOUSE ? (window.MOUSE.rotationX || 0) : 0);
        var pitch = firstPerson ? rx : -rx;
        if (Math.abs(pitch) < 0.08) pitch = 0;               // 死区：平视不升不降
        var fwd = ((window.KEYS && window.KEYS.w) ? 1 : 0) - ((window.KEYS && window.KEYS.s) ? 1 : 0);
        if (fwd !== 0 && pitch !== 0) {
          this.position.y += Math.sin(pitch) * fwd * spd * 2 * fs;
        }
        if (window.KEYS && window.KEYS.space) {
          this.position.y += spd * 2 * fs;                   // 原地上升备用（手机端 ⬆️）
        }
        return;
      }

      return orig.vertical.call(this, delta);
    };

    // 飞行/缓降期间固定待机动作，避免"在空中跑步"
    if (typeof orig.anim === 'function') {
      proto.updateWalkingAnimation = function (isMoving) {
        if ((this.isFlying || this._flyLanding) && window.gameWorld &&
            typeof window.gameWorld._switchPlayerAnim === 'function' &&
            typeof GAME_STATE !== 'undefined' && GAME_STATE) {
          window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'idle');
          return;
        }
        return orig.anim.call(this, isMoving);
      };
    }

    // 飞行时的水平移动：完全接管，不再走原逻辑的相机 getWorldDirection。
    // 【2026-11-06】为什么必须接管：
    //  player.js 第一人称分支是 `camera.getWorldDirection(dir); dir.y = 0; dir.normalize();`
    //  第一人称俯仰被 main.js 夹在 ±π/2，正好能低到"垂直朝下"——
    //  此时 getWorldDirection ≈ (0,-1,0)，砍掉 y 得到零向量；Three 的 normalize() 对零向量
    //  是空操作（内部 length() || 1），于是 movement = 0，按 W 完全不移动；
    //  接近垂直（cos(pitch)≈0.02）时水平方向由数值噪音决定，方向符号乱跳 → 表现为反向。
    //  第三人称相机永远在玩家后上方 lookAt 玩家、俯角只有 20° 上下，所以那边从不触发。
    //  改用 MOUSE.rotationY 直接推水平前向：与俯仰角无关，低头到 -90° 也稳定。
    //  副产物：飞行本来就要无视碰撞（可穿墙看结构），这里直接改 position 正合语义。
    if (typeof orig.move === 'function') {
      proto.handleMovement = function (delta) {
        // 注意别用 boost 当局部变量名：会遮蔽模块级的倍率值，导致倍率恒等于 1
        if (!(this.isFlying && !this._flyLanding)) return orig.move.call(this, delta);

        var fs = this._fs || 1;
        var k = window.KEYS || {};
        var base = (window.CONFIG && window.CONFIG.PLAYER_SPEED) ? window.CONFIG.PLAYER_SPEED : 0.15;
        var dist = base * fs;
        if (k.shift) dist *= boost;      // 飞行加速按面板倍率；地面冲刺的 ×3 不受影响
        var fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0);
        var strafe = (k.a ? 1 : 0) - (k.d ? 1 : 0);
        if (fwd === 0 && strafe === 0) return false;

        // 与 player.js 同口径：forward=(sinθ, cosθ)，left=cross(up, forward)=(cosθ, -sinθ)。
        // 第一人称相机 yaw 多了 +π（player.js:848），两次取反正好抵消，因此两视角公式相同。
        var th = (window.MOUSE && typeof window.MOUSE.rotationY === 'number') ? window.MOUSE.rotationY : 0;
        var fx = Math.sin(th), fz = Math.cos(th);
        var lx = Math.cos(th), lz = -Math.sin(th);

        this.position.x += (fx * fwd + lx * strafe) * dist;
        this.position.z += (fz * fwd + lz * strafe) * dist;
        this.rotation = Math.atan2(fx, fz);   // 朝向跟随，broadcastPosition 会读
        return true;
      };
    }

    // 飞行/缓降期间保持视角：关掉 player.js updateCamera 里的俯仰回正。
    // 原实现两个视角都会 `MOUSE.rotationX *= keep`（松开鼠标就回水平），
    // 但飞行时要靠视角控制方向/升降，视角一回平就平飞、爬升中断（用户 2026-11-06 要求）。
    //
    // 【第一人称必须与第三人称分开处理（2026-11-06 修复）】
    //  · 第三人称：相机位置是由 rotationX 算出来的
    //      (player.js:797 targetCameraPos.y += 2 + sin(verticalAngle)*5)
    //    「调用后写回角度」会让位置用衰减值、角度用原值，两者每帧打架 → 抖。
    //    所以那边继续用"压 _fs"的办法：pow(1-0.05, 1e-9)≈1，回正系数变 1，一帧内自洽。
    //  · 第一人称：相机位置只由 position + 1.6 或 cameraBone 决定，与 rotationX 无关，
    //    写回角度不会造成位置/朝向冲突。而 _fs 在 player.js:840 还兼着相机跟随的插值指数
    //      (camera.position.lerp(target, 1 - pow(0.9, _fs)))
    //    压到 1e-9 后系数≈1e-10，相机原地卡死 —— 表现为"不点鼠标镜头不动、点一下瞬移到
    //    实际位置"。所以第一人称绝不能压 _fs，改用调用后写回角度。
    if (typeof orig.camera === 'function') {
      proto.updateCamera = function (camera) {
        var holdView = (this.isFlying || this._flyLanding) && window.MOUSE && !window.MOUSE.isDragging;
        if (!holdView) return orig.camera.call(this, camera);

        var firstPerson = (typeof GAME_STATE !== 'undefined' && GAME_STATE &&
          GAME_STATE.cameraMode === 'first-person');

        if (firstPerson) {
          var rx = window.MOUSE.rotationX;
          var trx = window.MOUSE.targetRotationX;
          var r = orig.camera.call(this, camera);   // 此处 _fs 保持正常 → lerp 正常跟随
          window.MOUSE.rotationX = rx;
          window.MOUSE.targetRotationX = trx;
          // orig 内部是按"被回正后的" rotationX 设的朝向，这里按原值重设一次，
          // 否则朝向和角度对不上（相机看着一个方向、实际朝向另一个）
          if (window.THREE) {
            var euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.y = window.MOUSE.rotationY + Math.PI;   // 与 player.js:848 保持一致
            euler.x = window.MOUSE.rotationX;
            camera.quaternion.setFromEuler(euler);
          }
          return r;
        }

        var savedFs = this._fs;
        this._fs = 1e-9;
        try {
          return orig.camera.call(this, camera);
        } finally {
          this._fs = savedFs;
        }
      };
    }

    proto.__adminFlyPatched = true;
    return true;
  }

  /** 开/关飞行；缓降中调用一次 = 取消降落恢复飞行 */
  function setFlying(on) {
    var p = getPlayer();
    if (!p) return false;
    if (on) {
      if (p._flyLanding) {
        p._flyLanding = false;
        paint(true);
        return true;
      }
      if (!p.isFlying) p.enableFlying();
      else paint(true);
      return true;
    }
    if (p._flyLanding) {         // 已经在降落，不要重复触发
      paint(false);
      return true;
    }
    if (p.isFlying) p.disableFlying();
    else paint(false);
    return true;
  }

  function toggle() {
    var p = getPlayer();
    if (!p) return;
    if (p._flyLanding) {         // 缓降中按 H = 取消降落、恢复飞行
      p._flyLanding = false;
      paint(true);
      return;
    }
    setFlying(!p.isFlying);
  }

  // ---------------- 面板注入（不改 buildingManager.js） ----------------

  function tryMount() {
    if (mounted) return true;
    if (!patchPlayer()) return false;
    var anchor = document.getElementById('toggle-admin-mode');
    if (!anchor || !anchor.parentNode) return false;
    if (!document.getElementById('admin-fly-block')) {
      anchor.parentNode.appendChild(buildDom());
    }
    mounted = true;
    paint(isFlyingNow());
    return true;
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      pollTries++;
      if (tryMount() || pollTries >= CFG.MOUNT_MAX_TRIES) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, CFG.MOUNT_POLL_MS);
  }

  // ---------------- 热键 ----------------

  // 空格保险（捕获阶段）：焦点停在飞行开关上时，空格会被浏览器解释成"切换复选框"，
  // 表现就是"一按空格飞行自己关掉了"。这里先拦掉默认动作，再让游戏正常收到空格。
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    var ae = document.activeElement;
    if (ae && ae.id === 'admin-fly-toggle') e.preventDefault();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!mounted) return;                       // 管理面板没出现前不接管按键
    if (isTyping(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (String(e.key || '').toLowerCase() !== CFG.HOTKEY) return;
    e.preventDefault();
    toggle();
  });

  // ---------------- 启动 ----------------

  loadBoost();  // 面板渲染前先读持久化的倍率，滑块初始值才正确
  startPoll();
  tryMount();   // 脚本晚于面板创建时直接成功

  window.AdminFlyToggle = {
    setFlying: setFlying,
    toggle: toggle,
    mount: tryMount,
    setBoost: setBoost,
    getBoost: function () { return boost; },
    _diag: function () {
      var p = getPlayer();
      return {
        mounted: mounted,
        patched: !!(window.Player && window.Player.prototype && window.Player.prototype.__adminFlyPatched),
        hasPlayer: !!p,
        isFlying: !!(p && p.isFlying),
        landing: !!(p && p._flyLanding),
        y: p && p.position ? +p.position.y.toFixed(2) : null,
        groundY: p ? (function () { var g = groundYAt(p); return g === null ? null : +g.toFixed(2); })() : null,
        hotkey: CFG.HOTKEY,
        boost: boost
      };
    }
  };
})();
