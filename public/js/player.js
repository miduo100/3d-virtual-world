/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Player controller

// ==================== 第三人称弹簧臂相机（2026-11-24） ====================
// 旧实现是「绕人物公转 + 无条件 lookAt 胸口」，距离锁死 5m、无遮挡检测：
//   ① 视角转到模型另一侧时相机直接穿进模型内部；
//   ② 半径缩到 0 得到的是「站在头顶往下看自己」，不是第一人称（无法做退化）。
// 现改为标准弹簧臂：机位 = 眼位 − 视线方向 × d，朝向由 pitch/yaw 直设。
// d 由遮挡检测收缩，收到 min 即天然第一人称（本体自动隐藏），朝向零跳变。
//
// 运行时开关（控制台可随时改，立即生效）：
//   window.__CAM_SPRING  = false  完整退回旧公转实现（同一份代码保留在后面）
//   window.__CAM_OCCLUDE = false  关掉遮挡检测，只留弹簧距离
//   window.__CAM_DIST    = 6      覆盖期望距离（默认 4.5）
//   window.__CAM_PITCH_SIGN = -1  翻转俯仰方向（默认 1 与旧实现同向）
const CAM_SPRING = {
  distance: 4.5,     // 期望距离（米）。旧实现是 5，收紧一点减少遮挡触发频率
  min: 0.02,         // 遮挡收缩下限（≈0 即第一人称，不取 0 避免数学退化）
  padding: 0.25,     // 命中点前留白，避免贴面穿模
  hideDist: 1.2,     // 低于此距离隐藏本体模型（等同第一人称观感）
  eye: 1.6,          // 眼高（相对人物锚点，GLB 脚底口径）
  rise: 0.4,         // 相机额外抬升：d=期望值 时 1.6+0.4=2.0，与旧实现 +2.0 对齐
  pitchBias: 0.1,    // 俯角补偿（rad，约 5.7°）：抵消旧实现恒定 lookAt 胸口的下压
  pull: 0.65,        // 拉近系数（每秒比例基准）：60fps 约 2~3 帧到位。
                     //   不取瞬时——瞬时拉近会让「转头 1 度推一下」变成硬跳；
                     //   但也不能太小，否则快速跑向墙时约 50cm 的滞后就会穿模。
                     //   边缘跳变交给 histLen 窗口过滤，不靠这里拖慢。
  ret: 0.12,         // 回弹系数（每秒比例），约 0.3s 归位
  retDead: 0.2,      // 回弹死区（米）：差值小于此不回弹，压掉命中边缘的单帧跳变
  retDelay: 120,     // 回弹延迟（ms）：需持续超出死区这么久才开始回弹
  histLen: 3,        // 目标距离滑动窗口（帧）：取窗口最小值（保守），过滤边缘跳变
  refreshMs: 400,    // 遮挡盒刷新间隔（ms）
  moveEps: 2.0,      // 玩家位移超过此值也强制刷新候选盒
  maxBoxes: 96,      // 候选盒上限（防极端场景遍历爆量；精筛后通常只有几个到十几个）
  minHeight: 1.2,    // 低于此高度的物体不挡镜头（草丛/矮台沿/薄片）
  maxSpan: 120       // 水平跨度超过此值的盒不参与拉近（地形块/世界边界，交给地面 clamp）
};

// 查询热路径零分配用的临时对象
const _csEye = new THREE.Vector3();
const _csDir = new THREE.Vector3();
const _csHit = new THREE.Vector3();
const _csRay = new THREE.Ray();
const _csEuler = new THREE.Euler(0, 0, 0, 'YXZ');

class Player {
  constructor(world, characterId, characterData, glbUrl = null) {
    this.world = world;
    this.characterId = characterId;
    this.characterData = characterData;
    this.glbUrl = glbUrl;

    // Position and movement
    this.position = new THREE.Vector3(0, 2, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.direction = new THREE.Vector3(0, 0, 0);
    this.rotation = 0; // Player rotation (Y-axis) for third-person

    // Movement
    this.moveSpeed = CONFIG.PLAYER_SPEED;
    this.rotationSpeed = 0.06; // Rotation speed for Q/E keys (increased for faster turning)
    this.targetRotationY = 0; // 目标旋转角度（用于平滑过渡）
    this.rotationSmoothness = 0.25; // 旋转平滑度（0-1，值越大越平滑但响应越慢）
    this.isGrounded = false;
    this.gravity = 0.02;
    
    // Q/E键基于时间的加速-减速系统
    this.rotationAcceleration = {
      q: {
        speed: 0,              // 当前转向速度
        holdTime: 0,           // 按键持续时间（秒）
        startTime: 0,          // 按键开始时间
        isPressed: false,
        lastPressed: false
      },
      e: {
        speed: 0,
        holdTime: 0,
        startTime: 0,
        isPressed: false,
        lastPressed: false
      }
    };

    // State
    this.health = (characterData && characterData.character) ? characterData.character.health : 100;
    this.maxHealth = (characterData && characterData.character) ? characterData.character.max_health : 100;
    this.isFlying = false;
    this.canAttack = true;
    this.lastAttackTime = 0;

    // 连击状态
    this.comboCount = 0;       // 当前连击段数 (1/2/3)
    this.comboTimer = null;    // 连击重置计时器
    this.comboCooldown = 900;  // 同一连击段内，多久算下一段（ms）
    
    // 传送门相关
    this.lastTeleportTime = 0; // 上次传送时间
    this.teleportCooldown = 2000; // 传送冷却2秒（防止重复传送）
    this.nearPortal = null; // 当前接近的传送门
    this.isTeleporting = false; // 是否正在传送（防止重复触发）

    // ==================== 战斗状态机 ====================
    this.combatState = 'idle';      // 'idle' | 'chasing' | 'attacking'
    this.combatTarget = null;       // { id, data } 当前锁定怪物
    this.comboIndex = 0;            // 七段连击序列指针
    this.isAttackingCombo = false;  // 当前连招动画锁
    this.combatChaseTimer = null;   // 追击超时计时器
    this.comboTimeoutHandle = null; // 连招 setTimeout 句柄

    // Create player in world
    const playerName = (characterData && characterData.character) ? characterData.character.name : '游客';
    this.worldObject = world.addPlayer(
      characterId,
      playerName,
      this.position,
      true,
      glbUrl,
      (function() {
        try {
          const wcRaw = localStorage.getItem('selectedTemplateWeaponConfig');
          return wcRaw ? JSON.parse(wcRaw) : null;
        } catch(e) { return null; }
      })()
    );

    // Setup input
    this.setupInput();
    
    // 初始化目标旋转角度为当前鼠标旋转角度
    this.targetRotationY = MOUSE.rotationY;
  }

  setupInput() {
    // Keyboard input is handled globally in config.js
    console.log('Player input setup complete');
  }

  onKeyDown(e) {
    // Handled by global listener in config.js
  }

  onKeyUp(e) {
    // Handled by global listener in config.js
  }

  update(delta, camera) {
    /* 【帧率解耦 2026-10-22 重做】所有"每帧固定增量"的控制量统一乘以 fs：
       fs = 本帧毫秒 / 16.667（60fps 时恰为 1，逐字节等价；帧率掉到 10fps 时 = 6）。
       为什么必须：加载期主线程会被建模/预热占用，帧率会掉到 10~30fps。旧实现按帧加
       0.15 的位移在 10fps 下只有正常速度的 1/6 —— 表现为"走不动、转向迟钝、一顿一顿"，
       而玩家感知到的是"卡"，不是"帧率低"。补偿后无论帧率如何，每秒位移/转角都一致。
       （这块逻辑在 2026-09-14 的未提交改动丢失事故中丢过，本次重建。） */
    const fs = Math.max(0.05, Math.min(6, (delta || 16.667) / 16.667));
    this._fs = fs;

    // 同步目标旋转角度（当鼠标拖拽时）
    if (MOUSE.isDragging) {
      this.targetRotationY = MOUSE.targetRotationY;
    }
    
    // Handle movement input
    const wasMoving = this.handleMovement(delta);

    // Handle jumping/flying
    this.handleVerticalMovement(delta);
    
    // 检测传送门
    this.checkPortalInteraction();

    // Update camera
    this.updateCamera(camera);

    // Update world object position
    this.worldObject.position.copy(this.position);
    
    // Update walking animation for local player
    this.updateWalkingAnimation(wasMoving);

    // Broadcast position
    this.broadcastPosition();

    // 战斗状态机每帧更新
    this.updateCombat(delta, camera);
  }

  handleMovement(delta) {
    // 帧率解耦：本帧步长 = 60fps 时的一帧步长 × fs（见 update() 里的说明）
    const fs = this._fs || 1;
    const step = this.moveSpeed * fs;

    // Calculate movement
    let moveForward = 0;
    let moveRight = 0;

    // W/S: Forward/Backward
    if (KEYS.w) moveForward += step;
    if (KEYS.s) moveForward -= step;
    
    // A/D: Left/Right strafe (A左移，D右移)
    if (KEYS.a) moveRight += step;  // A向左
    if (KEYS.d) moveRight -= step;  // D向右

    // Apply sprint modifier (increased speed)
    if (KEYS.shift) {
      moveForward *= 3;  // Increased from 2 to 3
      moveRight *= 3;
    }

    const camera = this.world.getCamera();
    if (!camera) return false;
    
    const isMoving = (moveForward !== 0 || moveRight !== 0);

    // Different movement logic for first-person and third-person
    if (GAME_STATE.cameraMode === 'first-person') {
      // First-person: Movement based on camera direction
      
      // Handle rotation with Q and E keys (基于时间的加速-减速曲线)
      // Q键 - 向左转（基于时间的平滑加速）
      if (KEYS.q) {
        const config = this.rotationAcceleration.q;
        
        if (!config.lastPressed) {
          // 刚按下，记录开始时间
          config.startTime = Date.now();
          config.holdTime = 0;
          config.speed = 0.03;
          config.isPressed = true;
        } else {
          // 持续按住，计算持续时间
          config.holdTime = (Date.now() - config.startTime) / 1000; // 转换为秒
          
          // 基于持续时间计算速度（平滑插值）
          if (config.holdTime < 0.5) {
            // 0 → 0.5秒：0.03 → 0.063
            const t = config.holdTime / 0.5;
            config.speed = 0.03 + (0.063 - 0.03) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.0) {
            // 0.5 → 1秒：0.063 → 0.105
            const t = (config.holdTime - 0.5) / 0.5;
            config.speed = 0.063 + (0.105 - 0.063) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.5) {
            // 1 → 1.5秒：0.105 → 0.2
            const t = (config.holdTime - 1.0) / 0.5;
            config.speed = 0.105 + (0.2 - 0.105) * this.easeInOut(t);
          }
          else if (config.holdTime < 2.0) {
            // 1.5 → 2秒：维持 0.2
            config.speed = 0.2;
          }
          else if (config.holdTime < 2.5) {
            // 2 → 2.5秒：0.2 → 0.3
            const t = (config.holdTime - 2.0) / 0.5;
            config.speed = 0.2 + (0.3 - 0.2) * this.easeInOut(t);
          }
          else if (config.holdTime < 3.0) {
            // 2.5 → 3秒：维持 0.3
            config.speed = 0.3;
          }
          else {
            // 3秒+：0.3 → 0.01 平滑减速
            const t = Math.min((config.holdTime - 3.0) / 1.0, 1.0); // 1秒内减速到最低
            config.speed = 0.3 - (0.3 - 0.01) * this.easeInOut(t);
          }
        }
        
        // 应用旋转
        this.targetRotationY += config.speed * (this._fs || 1);
        config.lastPressed = true;
      } else {
        // 松开键，重置状态
        this.rotationAcceleration.q.speed = 0;
        this.rotationAcceleration.q.holdTime = 0;
        this.rotationAcceleration.q.isPressed = false;
        this.rotationAcceleration.q.lastPressed = false;
      }
      
      // E键 - 向右转（基于时间的平滑加速）
      if (KEYS.e) {
        const config = this.rotationAcceleration.e;
        
        if (!config.lastPressed) {
          // 刚按下，记录开始时间
          config.startTime = Date.now();
          config.holdTime = 0;
          config.speed = 0.03;
          config.isPressed = true;
        } else {
          // 持续按住，计算持续时间
          config.holdTime = (Date.now() - config.startTime) / 1000; // 转换为秒
          
          // 基于持续时间计算速度（平滑插值）
          if (config.holdTime < 0.5) {
            // 0 → 0.5秒：0.03 → 0.063
            const t = config.holdTime / 0.5;
            config.speed = 0.03 + (0.063 - 0.03) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.0) {
            // 0.5 → 1秒：0.063 → 0.105
            const t = (config.holdTime - 0.5) / 0.5;
            config.speed = 0.063 + (0.105 - 0.063) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.5) {
            // 1 → 1.5秒：0.105 → 0.2
            const t = (config.holdTime - 1.0) / 0.5;
            config.speed = 0.105 + (0.2 - 0.105) * this.easeInOut(t);
          }
          else if (config.holdTime < 2.0) {
            // 1.5 → 2秒：维持 0.2
            config.speed = 0.2;
          }
          else if (config.holdTime < 2.5) {
            // 2 → 2.5秒：0.2 → 0.3
            const t = (config.holdTime - 2.0) / 0.5;
            config.speed = 0.2 + (0.3 - 0.2) * this.easeInOut(t);
          }
          else if (config.holdTime < 3.0) {
            // 2.5 → 3秒：维持 0.3
            config.speed = 0.3;
          }
          else {
            // 3秒+：0.3 → 0.01 平滑减速
            const t = Math.min((config.holdTime - 3.0) / 1.0, 1.0); // 1秒内减速到最低
            config.speed = 0.3 - (0.3 - 0.01) * this.easeInOut(t);
          }
        }
        
        // 应用旋转（× fs：帧率无关，60fps 时等价）
        this.targetRotationY -= config.speed * (this._fs || 1);
        config.lastPressed = true;
      } else {
        // 松开键，重置状态
        this.rotationAcceleration.e.speed = 0;
        this.rotationAcceleration.e.holdTime = 0;
        this.rotationAcceleration.e.isPressed = false;
        this.rotationAcceleration.e.lastPressed = false;
      }
      
      // 平滑插值到目标旋转角度（1-pow(1-s,fs)：帧率无关的指数平滑）
      const rotationDiff = this.targetRotationY - MOUSE.rotationY;
      MOUSE.rotationY += rotationDiff * (1 - Math.pow(1 - this.rotationSmoothness, fs));

      // Auto-rotate camera slightly when strafing left/right
      const strafeRotationSpeed = 0.008 * fs; // Subtle rotation when strafing
      if (KEYS.a && !KEYS.d) {
        MOUSE.rotationY += strafeRotationSpeed; // Turn left when moving left
      }
      if (KEYS.d && !KEYS.a) {
        MOUSE.rotationY -= strafeRotationSpeed; // Turn right when moving right
      }

      if (moveForward !== 0 || moveRight !== 0) {
        // Get camera's forward direction (ignoring vertical component)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0; // Keep movement horizontal
        cameraDirection.normalize();

        // Get camera's right direction (up × forward = right)
        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(new THREE.Vector3(0, 1, 0), cameraDirection);
        cameraRight.normalize();

        // Calculate final movement
        const movement = new THREE.Vector3();
        movement.addScaledVector(cameraDirection, moveForward);
        movement.addScaledVector(cameraRight, moveRight);

        // 🎯 侧面碰撞检测（与第三人称分支保持一致，非飞行模式）
        // 【修复】原第一人称分支直接 position.add(movement) 无任何碰撞检测，
        // 可自由穿墙（含城堡墙体）；现复用与第三人称相同的回滚+单轴滑动逻辑。
        if (!this.isFlying) {
          const prevPosition = this.position.clone(); // 移动前位置（回滚锚点）
          this.position.add(movement);
          if (this.checkSideCollision(this.position)) {
            // 完整移动被阻挡：以移动前位置为基准尝试单轴滑动
            const tryX = prevPosition.clone();
            tryX.x = this.position.x;
            if (!this.checkSideCollision(tryX)) {
              this.position.copy(tryX);          // 允许 X 方向移动（沿墙滑动）
            } else {
              const tryZ = prevPosition.clone();
              tryZ.z = this.position.z;
              if (!this.checkSideCollision(tryZ)) {
                this.position.copy(tryZ);        // 允许 Z 方向移动（沿墙滑动）
              } else {
                this.position.copy(prevPosition); // 全挡：留在原地，绝不前进
              }
            }
          }
        } else {
          this.position.add(movement);
        }

        // Update player rotation to match movement direction if moving
        this.rotation = Math.atan2(cameraDirection.x, cameraDirection.z);
      }
    } else {
      // Third-person: Movement based on camera direction, Q/E rotates player
      
      // Handle rotation with Q and E keys (基于角度的加速-减速曲线)
      // Q键 - 向左转（基于时间的平滑加速）
      if (KEYS.q) {
        const config = this.rotationAcceleration.q;
        
        if (!config.lastPressed) {
          // 刚按下，记录开始时间
          config.startTime = Date.now();
          config.holdTime = 0;
          config.speed = 0.03;
          config.isPressed = true;
        } else {
          // 持续按住，计算持续时间
          config.holdTime = (Date.now() - config.startTime) / 1000; // 转换为秒
          
          // 基于持续时间计算速度（平滑插值）
          if (config.holdTime < 0.5) {
            // 0 → 0.5秒：0.03 → 0.063
            const t = config.holdTime / 0.5;
            config.speed = 0.03 + (0.063 - 0.03) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.0) {
            // 0.5 → 1秒：0.063 → 0.105
            const t = (config.holdTime - 0.5) / 0.5;
            config.speed = 0.063 + (0.105 - 0.063) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.5) {
            // 1 → 1.5秒：0.105 → 0.2
            const t = (config.holdTime - 1.0) / 0.5;
            config.speed = 0.105 + (0.2 - 0.105) * this.easeInOut(t);
          }
          else if (config.holdTime < 2.0) {
            // 1.5 → 2秒：维持 0.2
            config.speed = 0.2;
          }
          else if (config.holdTime < 2.5) {
            // 2 → 2.5秒：0.2 → 0.3
            const t = (config.holdTime - 2.0) / 0.5;
            config.speed = 0.2 + (0.3 - 0.2) * this.easeInOut(t);
          }
          else if (config.holdTime < 3.0) {
            // 2.5 → 3秒：维持 0.3
            config.speed = 0.3;
          }
          else {
            // 3秒+：0.3 → 0.01 平滑减速
            const t = Math.min((config.holdTime - 3.0) / 1.0, 1.0); // 1秒内减速到最低
            config.speed = 0.3 - (0.3 - 0.01) * this.easeInOut(t);
          }
        }
        
        // 应用旋转：驱动持久目标角 MOUSE.targetRotationY（不是 MOUSE.rotationY）
        // 游戏主循环每帧会把 MOUSE.rotationY 拉回 MOUSE.targetRotationY，
        // 若只改 rotationY 则一松手即被拉回原位（弹回）。改目标角则松手后停留新角度。
        MOUSE.targetRotationY += config.speed * fs;
        this.rotation = MOUSE.targetRotationY; // 保持字段同步，避免从旧值跳变
        config.lastPressed = true;
      } else {
        // 松开键，重置状态
        this.rotationAcceleration.q.speed = 0;
        this.rotationAcceleration.q.holdTime = 0;
        this.rotationAcceleration.q.isPressed = false;
        this.rotationAcceleration.q.lastPressed = false;
      }
      
      // E键 - 向右转（基于时间的平滑加速）
      if (KEYS.e) {
        const config = this.rotationAcceleration.e;
        
        if (!config.lastPressed) {
          // 刚按下，记录开始时间
          config.startTime = Date.now();
          config.holdTime = 0;
          config.speed = 0.03;
          config.isPressed = true;
        } else {
          // 持续按住，计算持续时间
          config.holdTime = (Date.now() - config.startTime) / 1000; // 转换为秒
          
          // 基于持续时间计算速度（平滑插值）
          if (config.holdTime < 0.5) {
            // 0 → 0.5秒：0.03 → 0.063
            const t = config.holdTime / 0.5;
            config.speed = 0.03 + (0.063 - 0.03) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.0) {
            // 0.5 → 1秒：0.063 → 0.105
            const t = (config.holdTime - 0.5) / 0.5;
            config.speed = 0.063 + (0.105 - 0.063) * this.easeInOut(t);
          }
          else if (config.holdTime < 1.5) {
            // 1 → 1.5秒：0.105 → 0.2
            const t = (config.holdTime - 1.0) / 0.5;
            config.speed = 0.105 + (0.2 - 0.105) * this.easeInOut(t);
          }
          else if (config.holdTime < 2.0) {
            // 1.5 → 2秒：维持 0.2
            config.speed = 0.2;
          }
          else if (config.holdTime < 2.5) {
            // 2 → 2.5秒：0.2 → 0.3
            const t = (config.holdTime - 2.0) / 0.5;
            config.speed = 0.2 + (0.3 - 0.2) * this.easeInOut(t);
          }
          else if (config.holdTime < 3.0) {
            // 2.5 → 3秒：维持 0.3
            config.speed = 0.3;
          }
          else {
            // 3秒+：0.3 → 0.01 平滑减速
            const t = Math.min((config.holdTime - 3.0) / 1.0, 1.0); // 1秒内减速到最低
            config.speed = 0.3 - (0.3 - 0.01) * this.easeInOut(t);
          }
        }
        
        // 应用旋转：驱动持久目标角 MOUSE.targetRotationY（见上方 Q 键说明）
        MOUSE.targetRotationY -= config.speed * fs;
        this.rotation = MOUSE.targetRotationY;
        config.lastPressed = true;
      } else {
        // 松开键，重置状态
        this.rotationAcceleration.e.speed = 0;
        this.rotationAcceleration.e.holdTime = 0;
        this.rotationAcceleration.e.isPressed = false;
        this.rotationAcceleration.e.lastPressed = false;
      }

      if (moveForward !== 0 || moveRight !== 0) {
        // Get camera's forward direction (ignoring vertical component)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0; // Keep movement horizontal
        cameraDirection.normalize();

        // Get camera's right direction (up × forward = right in right-hand coordinate system)
        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(new THREE.Vector3(0, 1, 0), cameraDirection);
        cameraRight.normalize();

        // Calculate final movement based on camera direction
        const movement = new THREE.Vector3();
        movement.addScaledVector(cameraDirection, moveForward);
        movement.addScaledVector(cameraRight, moveRight);

        // 🎯 侧面碰撞检测（非飞行模式）
        // 【修复穿墙根因】原实现先 add 再检测、被挡时无回滚——斜着走向墙时位置
        // 每帧仍前进 0.15，2~3 帧后胶囊沉入墙体内部（厚墙内部无面可碰即永久放行），
        // 之后可从另一侧穿出。现改为：被挡时回滚到移动前位置，再尝试单轴滑动。
        if (!this.isFlying) {
          const prevPosition = this.position.clone(); // 移动前位置（回滚锚点）
          this.position.add(movement);
          if (this.checkSideCollision(this.position)) {
            // 完整移动被阻挡：以移动前位置为基准尝试单轴滑动
            const tryX = prevPosition.clone();
            tryX.x = this.position.x;
            if (!this.checkSideCollision(tryX)) {
              this.position.copy(tryX);          // 允许 X 方向移动（沿墙滑动）
            } else {
              const tryZ = prevPosition.clone();
              tryZ.z = this.position.z;
              if (!this.checkSideCollision(tryZ)) {
                this.position.copy(tryZ);        // 允许 Z 方向移动（沿墙滑动）
              } else {
                this.position.copy(prevPosition); // 全挡：留在原地，绝不前进
              }
            }
          }
        } else {
          // 【2026-11-06 修复】飞行态原本缺 else：movement 算完就被丢弃，
          // 第三人称飞行时 WASD 完全不动（只有第一人称分支写了这句）。
          this.position.add(movement);
        }
        
        // Don't auto-rotate player in third-person mode
        // Player rotation is controlled by Q/E keys only
      }
    }
    
    return isMoving;
  }

  /**
   * 🎯 检查侧面碰撞（解决穿墙问题）
   * 使用 AABB 碰撞检测，支持沿墙滑动
   * @param {THREE.Vector3} position - 玩家位置
   * @returns {boolean} 是否发生碰撞
   */
  checkSideCollision(position) {
    const playerRadius = 0.3;  // 玩家碰撞半径
    const playerHeight = 1.8;  // 玩家总高度
    // 脚底高度：GLB 角色 position.y 即脚底；方块人 position.y 在脚底上方 1.5
    const isGlb = this.worldObject && this.worldObject.userData && this.worldObject.userData.isGlbLoaded;
    const feetY = position.y - (isGlb ? 0 : 1.5);
    // 登步容差：与 getGroundHeight 的 (topHeight - 1) 一致，顶面在此范围内视为可踏面
    const STEP_UP_TOLERANCE = 1.0;

    for (const obj of this.world.collisionObjects) {
      if (!obj.position || !obj.size) continue;
      
      // 统一读取尺寸（兼容 width/height/depth 和 x/y/z 两种格式）
      const width = obj.size.width ?? obj.size.x ?? 0;
      const height = obj.size.height ?? obj.size.y ?? 0;
      const depth = obj.size.depth ?? obj.size.z ?? 0;
      
      if (width === 0 || height === 0 || depth === 0) continue;

      // 🎯 可踏面豁免：顶面不高于脚底+登步容差的薄板（如出生点圆盘，高仅 0.1m）
      // 是可以走上去/走下来的地面，不参与侧向阻挡。否则 GLB 角色（position.y=脚底）
      // 站上圆盘后 y 恰落在碰撞盒 Y 范围内，水平移动被判"侧碰"整体回滚——
      // 只能跳起（y 升出盒范围）才能移出。旧版无回滚逻辑时误报挡不住人，故未暴露。
      const topY = obj.boundingBox ? obj.boundingBox.max.y : obj.position.y + height / 2;
      if (topY <= feetY + STEP_UP_TOLERANCE) continue;
      
      // 扩展碰撞盒（加上玩家半径，实现更自然的碰撞）
      const halfWidth = width / 2 + playerRadius;
      const halfDepth = depth / 2 + playerRadius;
      const halfHeight = height / 2;
      
      // AABB 碰撞检测（包含 Y 轴范围）
      // 只有当玩家在物体的垂直范围内时才检测侧面碰撞
      if (
        position.x >= obj.position.x - halfWidth &&
        position.x <= obj.position.x + halfWidth &&
        position.z >= obj.position.z - halfDepth &&
        position.z <= obj.position.z + halfDepth &&
        position.y >= obj.position.y - halfHeight &&          // 底部边界
        position.y <= obj.position.y + halfHeight + 0.01     // 顶部边界（+容差）
      ) {
        return true;  // 发生碰撞
      }
    }

    // 🎯 模型表面碰撞（胶囊 + BVH）：上传模型按真实网格侧向阻挡
    if (window.CapsuleCollision && window.CapsuleCollision.isEnabled()) {
      try {
        if (window.CapsuleCollision.checkCapsule(position.x, feetY, position.z)) {
          return true;
        }
      } catch (e) { /* 碰撞查询异常不阻塞移动 */ }
    }

    return false;  // 无碰撞
  }

  handleVerticalMovement(delta) {
    const fs = this._fs || 1;   // 帧率解耦（跳跃/重力同样按真实时间推进）
    if (this.isFlying) {
      // Flying mode
      if (KEYS.space) {
        this.position.y += CONFIG.PLAYER_SPEED * 2 * fs;
      }
      if (KEYS.shift) {
        this.position.y -= CONFIG.PLAYER_SPEED * 2 * fs;
      }
    } else {
      // Get ground height at current position (includes stairs and platforms)
      const groundHeight = this.world.getGroundHeight(this.position);
      // GLB 模型已通过 fitModel 将原点对齐脚底，characterGroup 直接落在地面（playerHeight=0）
      // 方块人（程序生成）脚底在 characterGroup 下方 1.5 个单位，playerHeight=1.5 使脚底贴地
      const playerHeight = (this.worldObject && this.worldObject.userData && this.worldObject.userData.isGlbLoaded) ? 0 : 1.5;
      // groundHeight === null：脚下没有任何地形 → targetY = -Infinity，走"空中"分支一直往下掉
      const targetY = (groundHeight === null) ? -Infinity : groundHeight + playerHeight;

      // 【下台阶吸附 2026-10-29】站在地面上而脚下地面只低一点点（≤0.5m）时直接贴地：
      // 旧逻辑会先落进"空中"分支（失重飘 80~100ms + isGrounded=false 触发跳跃动画），
      // 下台阶一顿一顿。targetY=-Infinity 时 dropToGround=Infinity，不会命中此分支。
      // 【可调高度联动】上台阶的"可跨越高度"用 window.__STEP_UP_MAX 现场调（见
      // capsuleCollision.resolveStepOver）；下台阶吸附上限跟着它走，改一处两边对称。
      const stepOverCfg = (typeof window.__STEP_UP_MAX === 'number' && isFinite(window.__STEP_UP_MAX) && window.__STEP_UP_MAX >= 0)
        ? window.__STEP_UP_MAX : 1.0;
      const STEP_DOWN_MAX = Math.max(0.5, stepOverCfg + 0.05);
      const dropToGround = this.position.y - targetY;

      // Gravity and jumping（重力积分 × fs：帧率无关，60fps 时等价）
      if (this.isGrounded && this.velocity.y <= 0 && dropToGround > 0.1 && dropToGround <= STEP_DOWN_MAX) {
        // 下台阶：平滑跟随地面，不进入空中阶段
        this.position.y = targetY;
        this.velocity.y = 0;
        this.isGrounded = true;
      } else if (this.position.y > targetY + 0.1) {
        // Player is in the air, apply gravity
        this.velocity.y -= this.gravity * fs;
        this.position.y += this.velocity.y * fs;
        this.isGrounded = false;
      } else {
        // Player is on the ground (or close enough)
        this.isGrounded = true;

        // Jump with stronger force - check BEFORE resetting position
        if (KEYS.space) {
          this.velocity.y = 0.8;  // Increased from 0.5 to 0.8 for higher jump
          this.position.y += this.velocity.y * fs;  // Apply velocity immediately
          this.isGrounded = false;  // Player is now jumping
        } else {
          // Only snap to ground if not jumping
          this.position.y = targetY;
          this.velocity.y = 0;
        }
      }
    }

    // 【2026-10-28】掉出世界兜底：地形之外没有地面（设计如此），离开地形边界后会一直往下掉，
    // 旧版只能刷新页面。这里送回出生点，避免"卡在虚空里没法自救"。
    // 注意必须同时要求"脚下确实没有地面"：地形内允许有很深的坑（山地 heightScale 可到 60+，
    // 低洼处 y 为负），只看 y 阈值会把站在深坑里的玩家误传回出生点。
    if (this.position.y < -50 && this.world.getGroundHeight(this.position) === null) {
      const sp = this.world.getSpawnPosition();
      this.position.set(sp.x, sp.y, sp.z);
      this.velocity.set(0, 0, 0);
      this.isGrounded = false;
      console.warn('[Player] 掉出世界边界，已送回出生点:', sp);
      if (typeof UI !== 'undefined' && UI.addChatMessage) {
        UI.addChatMessage('系统', '你掉出了世界边界，已送回出生点');
      }
    }
  }

  updateWalkingAnimation(isMoving) {
    if (!this.worldObject) return;

    // GLB角色：使用独立动画GLB切换
    if (this.worldObject.userData.glbModel && window.gameWorld) {
      const isSprint = KEYS.shift;
      // 跳跃状态优先
      if (!this.isGrounded) {
        window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'jump');
        return;
      }
      // 死亡状态
      if (this.health <= 0) {
        window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'death');
        return;
      }
      // 战斗攻击中不覆盖攻击动画
      if (this.combatState === 'attacking' && this.isAttackingCombo) return;
      const mode = isMoving ? (isSprint ? 'run' : 'walk') : 'idle';
      window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, mode);
      return;
    }

    // 方块人：原有四肢动画逻辑
    if (!this.worldObject.userData.leftArm) return;
    if (this.worldObject.userData.isAttacking) return;
    
    if (isMoving) {
      if (!this.worldObject.userData.animTime) {
        this.worldObject.userData.animTime = 0;
      }
      const animSpeed = (KEYS.shift ? 0.45 : 0.3) * (this._fs || 1);
      this.worldObject.userData.animTime += animSpeed;
      const time = this.worldObject.userData.animTime;
      const swingMultiplier = KEYS.shift ? 1.3 : 1.0;
      const armSwing = Math.sin(time) * 0.6 * swingMultiplier;
      const legSwing = Math.sin(time) * 0.5 * swingMultiplier;
      this.worldObject.userData.leftArm.rotation.x = armSwing;
      this.worldObject.userData.rightArm.rotation.x = -armSwing;
      this.worldObject.userData.leftElbow.rotation.x = -Math.abs(armSwing) * 0.3;
      this.worldObject.userData.rightElbow.rotation.x = -Math.abs(armSwing) * 0.3;
      this.worldObject.userData.leftLeg.rotation.x = -legSwing;
      this.worldObject.userData.rightLeg.rotation.x = legSwing;
      this.worldObject.userData.leftKnee.rotation.x = Math.max(0, legSwing * 0.8);
      this.worldObject.userData.rightKnee.rotation.x = Math.max(0, -legSwing * 0.8);
    } else {
      this.worldObject.userData.leftArm.rotation.x = 0;
      this.worldObject.userData.rightArm.rotation.x = 0;
      this.worldObject.userData.leftLeg.rotation.x = 0;
      this.worldObject.userData.rightLeg.rotation.x = 0;
      this.worldObject.userData.leftElbow.rotation.x = 0;
      this.worldObject.userData.rightElbow.rotation.x = 0;
      this.worldObject.userData.leftKnee.rotation.x = 0;
      this.worldObject.userData.rightKnee.rotation.x = 0;
    }
  }

  // 触发受击动画（外部调用）
  playHitAnim() {
    if (this.worldObject?.userData?.glbModel && window.gameWorld) {
      window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'hit');
      // 受击动画播完后自动回到idle
      setTimeout(() => {
        if (this.health > 0) window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'idle');
      }, 800);
    }
  }

  // 触发普攻/连击动画（外部调用）
  // comboKey: 'attack1' | 'attack2' | 'attack3'
  playAttackAnim(comboKey = 'attack1') {
    if (this.worldObject?.userData?.glbModel && window.gameWorld) {
      window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, comboKey);
      // 估计动画时长：attack1=900ms，attack2=800ms，attack3=1100ms
      const durations = { attack1: 900, attack2: 800, attack3: 1100 };
      const dur = durations[comboKey] || 1000;
      setTimeout(() => {
        // 只有没有新连击正在播放时才回idle
        if (this.comboCount === 0) {
          window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'idle');
        }
      }, dur);
    }
  }

  updateCamera(camera) {
    // First-person or third-person camera follow
    if (GAME_STATE.cameraMode === 'third-person') {
      // Auto-level camera pitch in third-person ONLY when not dragging
      if (!MOUSE.isDragging) {
        // 帧率无关的回正：60fps 时等价于 ×0.95/帧
        const keep = Math.pow(1 - 0.05, this._fs || 1);
        MOUSE.rotationX *= keep;
        MOUSE.targetRotationX *= keep;
      }
      
      // Show player model in third-person
      if (this.worldObject) {
        this.worldObject.visible = true;
        
        // 让人物模型跟随摄像机的水平旋转（Y轴）
        // 使用 MOUSE.rotationY 而不是 this.rotation
        this.worldObject.rotation.y = MOUSE.rotationY;
      }
      
      // ===== 弹簧臂相机（默认路径）=====
      // 机位/朝向/遮挡收缩见 _updateSpringCamera。
      // 旧「公转 + lookAt」实现保留在下方，供 window.__CAM_SPRING=false 完整回退。
      if (typeof window !== 'undefined' && window.__CAM_SPRING !== false) {
        this._updateSpringCamera(camera);
        return;
      }

      // ===== 旧实现：绕人物公转 + lookAt 胸口（2026-11-24 前的行为，仅回退用）=====
      // Third-person camera: 自由旋转视角，只基于鼠标旋转（不受人物旋转影响）
      const cameraDistance = 5;
      
      // Calculate camera position based ONLY on mouse rotation (not player rotation)
      const horizontalAngle = MOUSE.rotationY;
      const verticalAngle = MOUSE.rotationX;
      
      const targetCameraPos = this.position.clone();
      // 水平旋转 + 垂直角度计算摄像机位置
      targetCameraPos.x -= Math.sin(horizontalAngle) * cameraDistance * Math.cos(verticalAngle);
      targetCameraPos.z -= Math.cos(horizontalAngle) * cameraDistance * Math.cos(verticalAngle);
      targetCameraPos.y += 2 + Math.sin(verticalAngle) * cameraDistance;
      
      // Use faster lerp or direct assignment to reduce camera lag
      camera.position.copy(targetCameraPos);
      
      // Look at player - use fixed position for third-person
      const lookTarget = new THREE.Vector3(
        this.position.x,
        this.position.y + 1.5,
        this.position.z
      );
      camera.lookAt(lookTarget);
    } else {
      // Auto-level camera pitch in first-person ONLY when not dragging
      if (!MOUSE.isDragging) {
        // 帧率无关的回正：60fps 时等价于 ×0.95/帧
        const keep = Math.pow(1 - 0.05, this._fs || 1);
        MOUSE.rotationX *= keep;
        MOUSE.targetRotationX *= keep;
      }
      
      // Hide player model in first-person
      if (this.worldObject) {
        this.worldObject.visible = false;
        // 同步模型朝向（本地不可见，但 broadcastPosition 广播的 rotation
        // 读自 worldObject.rotation.y，不更新会导致其他玩家看不到转向）
        this.worldObject.rotation.y = MOUSE.rotationY;
      }
      
      // First-person camera: use camera bone if available, otherwise use head level
      let targetCameraPos;
      if (this.worldObject && this.worldObject.userData.cameraBone) {
        const cameraBone = this.worldObject.userData.cameraBone;
        const bonePos = new THREE.Vector3();
        cameraBone.getWorldPosition(bonePos);
        targetCameraPos = bonePos;
      } else {
        // Default head level position
        const cameraOffset = new THREE.Vector3(0, 1.6, 0);
        targetCameraPos = this.position.clone().add(cameraOffset);
      }
      
      // 帧率无关的相机跟随（60fps 时等价 0.1/帧）
      camera.position.lerp(targetCameraPos, 1 - Math.pow(0.9, this._fs || 1));
      
      // Set camera rotation directly from mouse rotation
      // 视角连续性：第三人称相机在人物背后 (player − (sinθ,cosθ)·d, θ=MOUSE.rotationY)，
      // 视线方向 = (sinθ,cosθ)；欧拉 yaw=θ 的相机 forward = (−sinθ,−cosθ) 恰好反向 180°，
      // 因此第一人称 yaw 需 +π，保证按 C 切换瞬间朝向与第三人称人物朝向一致（前后移动不反转）。
      // 注意 pitch 不要在此取反：main.js 输入层已按视角模式对 pitch 增量做过方向补偿。
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.y = MOUSE.rotationY + Math.PI;
      euler.x = MOUSE.rotationX;
      camera.quaternion.setFromEuler(euler);
    }
  }

  /**
   * 第三人称弹簧臂：机位 = 眼位 − 视线方向 × d，d 由遮挡检测收缩。
   * 收到 min（≈0）时相机正好落在眼睛上，天然第一人称——不改 GAME_STATE.cameraMode，
   * 所以 WASD 手感、广播朝向、飞行覆写（adminFlyToggle 压 _fs）全都不受影响。
   */
  _updateSpringCamera(camera) {
    const base = (typeof window.__CAM_DIST === 'number' && window.__CAM_DIST > 0)
      ? window.__CAM_DIST : CAM_SPRING.distance;
    if (typeof this._camD !== 'number') this._camD = base;

    const fs = this._fs || 1;
    const h = MOUSE.rotationY;
    const v = MOUSE.rotationX;
    // 俯仰符号：默认 1 = 与旧实现同向（鼠标上移 → 相机抬高 → 视线下压）
    const psign = (window.__CAM_PITCH_SIGN === -1) ? -1 : 1;

    // 眼位 → 相机的方向（视线反方向），与旧公式同一象限：
    //   旧 camera = P + (-sinθ·d·cosφ, sinφ·d + 2, -cosθ·d·cosφ)
    const cosV = Math.cos(v);
    const bx = -Math.sin(h) * cosV;
    const by = Math.sin(v) * psign;
    const bz = -Math.cos(h) * cosV;

    // 眼高恒定 1.6（**不能随 d 变化**）。
    // 【2026-11-24 修振荡】早先写成 eyeY = 1.6 + 0.4*(d/base)：眼位随距离抬降，
    // 而距离又由以眼位为起点的射线决定 →「距离变→眼位变→命中变→距离变」正反馈。
    // 模型上沿与眼位齐平时射线在命中/不命中之间反复，表现为镜头来回拉近拉远。
    const eyeY = this.position.y + CAM_SPRING.eye;
    _csEye.set(this.position.x, eyeY, this.position.z);
    _csDir.set(bx, by, bz);
    if (_csDir.lengthSq() < 1e-8) _csDir.set(0, 0, -1);
    _csDir.normalize();

    // ---- 遮挡：允许的最大距离 ----
    let want = base;
    if (window.__CAM_OCCLUDE !== false) {
      this._refreshOccluders(base, _csEye);
      want = this._occludedDistance(_csEye, _csDir, base);
      // 滑动窗口取最小值：压掉射线在盒边缘「命中 / 不命中」的单帧跳变。
      // 用 min 而不是平均——宁可保守少放一点，也不放过去导致穿模。
      const n = CAM_SPRING.histLen;
      if (!this._camHist || this._camHist.length !== n) {
        this._camHist = new Array(n).fill(want);
        this._camHi = 0;
      }
      this._camHi = (this._camHi + 1) % n;
      this._camHist[this._camHi] = want;
      want = Math.min.apply(null, this._camHist);
    } else {
      this._camHist = null;
    }

    // ---- 距离平滑：非对称（拉近快 / 回弹慢 + 死区 + 延迟）----
    // 【2026-11-24 修来回抽动】原来拉近是瞬时的：模型边缘每触发一次就是一次硬推镜，
    // 贴着边缘转头时 want 在两值间反复 → 视觉上就是「来回拉近拉远」。现在拉近也带
    // 时间常数（~3 帧），回弹则要超出死区并持续 retDelay 才动。
    const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (want < this._camD) {
      this._camD += (want - this._camD) * (1 - Math.pow(1 - CAM_SPRING.pull, fs));
      if (this._camD - want < 0.005) this._camD = want;
      this._camRetAt = 0;
    } else if (want - this._camD > CAM_SPRING.retDead) {
      if (!this._camRetAt) this._camRetAt = nowMs;
      else if (nowMs - this._camRetAt >= CAM_SPRING.retDelay) {
        this._camD += (want - this._camD) * (1 - Math.pow(1 - CAM_SPRING.ret, fs));
        if (want - this._camD < 0.01) this._camD = want;
      }
    } else {
      this._camRetAt = 0;   // 差值落在死区内：视为稳定，不动作
    }
    if (this._camD < CAM_SPRING.min) this._camD = CAM_SPRING.min;

    camera.position.copy(_csEye).addScaledVector(_csDir, this._camD);
    // 抬升只加在相机上、不参与求交：d=base 时 1.6+0.4=2.0 与旧实现对齐，d→0 归零为真眼高
    camera.position.y += CAM_SPRING.rise * Math.min(1, this._camD / base);

    // ---- 地面约束：不允许钻到地面以下（旧实现没有这层）----
    // 只在相机低于眼位时才查（by<0：抬头时相机降到人物下方），避免每帧多跑一次地形/碰撞遍历。
    // 飞行态跳过：飞行本来就要能穿地形，clamp 会把人卡在地表。
    if (by < 0.05 && !this.isFlying && !this._flyLanding &&
        this.world && typeof this.world.getGroundHeight === 'function') {
      try {
        const gy = this.world.getGroundHeight(camera.position);
        if (gy !== null && isFinite(gy) && camera.position.y < gy + 0.3) {
          camera.position.y = gy + 0.3;
        }
      } catch (e) { /* 地形查询异常不阻塞相机 */ }
    }

    // ---- 朝向：欧拉直设，避免 lookAt 在视线垂直向下时 up 向量退化 ----
    // 俯角补偿随距离淡出（d=base 时约 5.7°，与旧 lookAt 的观感对齐；d→0 归零）
    const bias = CAM_SPRING.pitchBias * Math.min(1, this._camD / base);
    _csEuler.set(-v * psign - bias, h + Math.PI, 0, 'YXZ');
    camera.quaternion.setFromEuler(_csEuler);

    // ---- 贴脸隐藏本体：等同第一人称观感，但不切 cameraMode ----
    if (this.worldObject) {
      this.worldObject.visible = this._camD > CAM_SPRING.hideDist;
    }
  }

  /**
   * 刷新遮挡候选盒（按 400ms / 位移 2m 节流）。
   * 两个来源：
   *   ① world.collisionObjects —— 开了碰撞的模型（AABB，现成数组，零成本）
   *   ② generatedBuildings 里已加载的模型本体 —— 覆盖没开碰撞的装饰模型（'周边都是模型' 的主场景）
   * 盒缓存在 WorldObjectBounds（有 TTL 自愈），这里只做锚点粗筛，不每帧 setFromObject。
   */
  _refreshOccluders(base, eye) {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const p = this.position;
    const moved = this._occPos
      ? Math.hypot(p.x - this._occPos.x, p.z - this._occPos.z) : Infinity;
    if (this._occBoxes && (now - (this._occAt || 0)) < CAM_SPRING.refreshMs &&
        moved < CAM_SPRING.moveEps) {
      return;
    }
    this._occAt = now;
    this._occPos = { x: p.x, z: p.z };

    const boxes = this._occBoxes || (this._occBoxes = []);
    // 复用旧数组元素位置，减少 GC：只重置长度
    boxes.length = 0;
    const eyeRef = eye || _csEye;
    // 精筛阈值：盒到眼位超过「臂长 + 1m」的一律不要（锚点粗筛放宽后靠这条收口）
    const nearLimit = base + 1;

    // 锚点粗筛半径。两个源的锚点可信度不同：
    //  · collisionObjects 的 position 基本就是盒中心 → 60m 够
    //  · 模型条目的锚点可能离本体上百米（整栋楼锚点在楼外、装配期偏移），必须给宽
    // 之前统一用 base+40，等于把「人贴着墙、锚点却很远」的墙全漏掉了（用户实机 bug）。
    const R2C = (base + 60) * (base + 60);
    const R2M = (base + 200) * (base + 200);

    // ---- ① 世界碰撞盒 ----
    const colliders = (this.world && this.world.collisionObjects) || [];
    for (let i = 0; i < colliders.length && boxes.length < CAM_SPRING.maxBoxes; i++) {
      const o = colliders[i];
      if (!o || !o.position || !o.size) continue;
      const dx = o.position.x - p.x, dz = o.position.z - p.z;
      if (dx * dx + dz * dz > R2C) continue;
      const w = o.size.width ?? o.size.x ?? 0;
      const hgt = o.size.height ?? o.size.y ?? 0;
      const dep = o.size.depth ?? o.size.z ?? 0;
      if (w <= 0 || hgt <= 0 || dep <= 0) continue;
      if (hgt < CAM_SPRING.minHeight) continue;   // 矮台沿/薄板不挡镜头
      // 地形块 / 世界边界级大盒不参与拉近：低头时射线会打中地面，导致「一低头镜头怼脸」。
      // 这种情况交给下面的地面 clamp 处理。
      if (Math.max(w, dep) > CAM_SPRING.maxSpan) continue;
      // 优先用已有 boundingBox（地形方块带锚点偏移，不能只按 position+size 推）
      let b;
      if (o.boundingBox && o.boundingBox.min && isFinite(o.boundingBox.min.y)) {
        b = o.boundingBox.clone();
      } else {
        b = new THREE.Box3(
          new THREE.Vector3(o.position.x - w / 2, o.position.y - hgt / 2, o.position.z - dep / 2),
          new THREE.Vector3(o.position.x + w / 2, o.position.y + hgt / 2, o.position.z + dep / 2)
        );
      }
      // 精筛：盒到眼位太远的不要（锚点可信度有限，用盒本身收口）
      if (b.distanceToPoint(eyeRef) > nearLimit) continue;
      boxes.push(b);
    }

    // ---- ② 已加载模型本体 ----
    const gb = this.world && this.world.generatedBuildings;
    if (gb && typeof gb.forEach === 'function') {
      const WB = (typeof window !== 'undefined') ? window.WorldObjectBounds : null;
      gb.forEach((entry, id) => {
        if (boxes.length >= CAM_SPRING.maxBoxes) return;
        if (!entry || entry.isPlaceholder || !entry.model) return;
        if (entry.model === this.worldObject) return;        // 自己不算遮挡
        if (entry.model.visible === false) return;
        const data = entry.data || {};
        // 【2026-11-24 修「穿过模型时镜头拉近又弹开」】
        // 能穿过去的模型不该挡镜头：否则玩家走向它时相机被推开，走进去后眼位落进盒内
        // → containsPoint 跳过该盒 → 距离从 3.5 弹回 4.5（人已经穿过去了、镜头还卡在外侧）。
        // 语义跟物理保持一致：has_collision=false 的东西既不挡人，也不挡镜头。
        // 想让装饰模型也挡镜头：后台给模型打开「碰撞」开关，或临时 window.__CAM_OCCLUDE_ALL = true。
        if (window.__CAM_OCCLUDE_ALL !== true && data.has_collision !== true) return;
        const ax = (typeof data.position_x === 'number') ? data.position_x : null;
        const az = (typeof data.position_z === 'number') ? data.position_z : null;
        if (ax !== null && az !== null) {
          const dx = ax - p.x, dz = az - p.z;
          if (dx * dx + dz * dz > R2M) return;
        }
        let box = null;
        if (WB && typeof WB.ensure === 'function') {
          try { box = WB.ensure(id, entry.model, data); } catch (e) { box = null; }
        }
        if (!box || box.isEmpty()) {
          // 兜底：无包围盒注册表时现算（仅在 400ms 刷新节奏下发生，可接受）
          try { box = new THREE.Box3().setFromObject(entry.model); } catch (e) { return; }
        }
        if (!box || box.isEmpty()) return;
        if ((box.max.y - box.min.y) < CAM_SPRING.minHeight) return;  // 矮物不挡
        // 大跨度盒（地形块/整片地台）不参与：低头射线会命中原地面，表现是「低头就怼脸」
        if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > CAM_SPRING.maxSpan) return;
        // 精筛：盒到眼位超过臂长 + 1m 的不要。眼位在盒内时 distanceToPoint = 0（保留），
        // 这正是「站在屋里的墙」这种关键情况。
        if (box.distanceToPoint(eyeRef) > nearLimit) return;
        boxes.push(box);
      });
    }
  }

  /**
   * 沿「眼位 → 相机」方向求最近命中距离。
   * @returns {number} 允许的相机距离（已扣 padding，钳在 [min, maxD]）
   */
  _occludedDistance(eye, dir, maxD) {
    const boxes = this._occBoxes || [];
    let best = maxD;
    let hitAny = false;

    // ---- ① 精确路径：BVH 真实三角面（开碰撞的模型都建了 BVH）----
    // 【2026-11-24 修「站在建筑内部 / 四周是墙却不拉近」】
    // 玩家在包围盒内部时 AABB 只能给出「盒外表面」的出射距离：实测 26.5×9.3×23.7 的盒，
    // 人在其中出射约 10m，远超臂长 4.5 → 判成无遮挡 → 相机穿墙；真实内墙可能只有 1~2m。
    // AABB 区分不了盒里有什么，BVH 可以。
    const CC = (typeof window !== 'undefined') ? window.CapsuleCollision : null;
    let usedBvh = false;
    if (CC && typeof CC.raycastDistance === 'function' &&
        typeof CC.isEnabled === 'function' && CC.isEnabled() &&
        window.__CAM_OCCLUDE_ALL !== true) {
      try {
        const d = CC.raycastDistance(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxD + 1);
        if (d !== null && d < best) {
          best = d;
          hitAny = true;
          // 只有「BVH 真的命中」才跳过 AABB。命中不到时仍跑 AABB 兜底——
          // 宁可过度拉近（难受），不能穿模（更糟）；这种情形只出现在 BVH 未就绪
          // 或模型超面数被跳过的时候。
          usedBvh = true;
        }
      } catch (e) {
        usedBvh = false;   // 精确查询异常 → 退回 AABB
      }
    }

    // ---- ② 兜底路径：AABB（无 BVH 覆盖 / 强制全部遮挡时；走 BVH 时整段跳过）----
    _csRay.origin.copy(eye);
    _csRay.direction.copy(dir);
    for (let i = 0; i < boxes.length && !usedBvh; i++) {
      const b = boxes[i];
      // 【2026-11-24 修「四周是墙却不拉近、直接穿模」】
      // 眼位落在盒内时**绝对不能跳过**：玩家站在房间/墙体的包围盒内部是常态
      // （走进屋里、贴着大模型侧面），跳过等于把最近的那堵墙从遮挡列表里删掉。
      // Ray.intersectBox 在起点位于盒内时返回**出射点**，正是相机该停的位置：
      //   · 小房间（盒 3~6m）→ 出射距离小 → 正常拉近
      //   · 大建筑外包围盒（盒上百米）→ 出射距离远超 maxD → 自动不起作用
      const hit = _csRay.intersectBox(b, _csHit);
      if (!hit) continue;
      const dist = eye.distanceTo(_csHit);
      if (dist < best) { best = dist; hitAny = true; }
    }
    // 没命中任何盒时必须原样返回 maxD——不能减 padding，
    // 否则「附近有盒但都没挡路」的场合相机被永久缩短 0.25m（实测过的真 bug）。
    return hitAny ? Math.max(best - CAM_SPRING.padding, CAM_SPRING.min) : maxD;
  }

  /**
   * 遮挡诊断（控制台）：`__camDiag()` 或 `__camDiag(40)`
   * 列出当前位置附近的对象、它们的包围盒、是否开碰撞、盒到眼位的距离。
   * 用来排查「四周是墙却不拉近 / 直接穿模」——一眼就能看出是漏了、被过滤了、还是没开碰撞。
   */
  _camDiag(radius) {
    radius = radius || 30;
    const p = this.position;
    const eye = new THREE.Vector3(p.x, p.y + CAM_SPRING.eye, p.z);
    const col = (this.world && this.world.collisionObjects) || [];
    const summary = {
      位置: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      眼位y: +eye.y.toFixed(2),
      当前距离: this._camD ? +this._camD.toFixed(2) : null,
      候选盒数: this._occBoxes ? this._occBoxes.length : 0,
      碰撞盒总数: col.length,
      开关: {
        spring: window.__CAM_SPRING !== false,
        occlude: window.__CAM_OCCLUDE !== false,
        occludeAll: window.__CAM_OCCLUDE_ALL === true,
        dist: (typeof window.__CAM_DIST === 'number') ? window.__CAM_DIST : CAM_SPRING.distance
      },
      // BVH = 有精确三角面射线（开碰撞的模型）；AABB兜底 = 只能测包围盒（盒内会失效）
      遮挡精度: (() => {
        const c = window.CapsuleCollision;
        if (!c || typeof c.raycastDistance !== 'function') return '模块未加载';
        return c.isEnabled() ? 'BVH' : 'AABB兜底（无已注册碰撞模型）';
      })(),
      附近碰撞盒: 0
    };

    // 附近 collisionObjects（已开碰撞的，一定有盒）
    col.forEach(o => {
      if (!o || !o.position) return;
      const w = o.size.width ?? o.size.x ?? 0;
      const h = o.size.height ?? o.size.y ?? 0;
      const d = o.size.depth ?? o.size.z ?? 0;
      const dist = Math.hypot(o.position.x - p.x, o.position.z - p.z) - Math.max(w, d) / 2;
      if (dist <= radius) summary.附近碰撞盒++;
    });

    // 附近模型
    const rows = [];
    const gb = this.world && this.world.generatedBuildings;
    if (gb && gb.forEach) {
      gb.forEach((entry, id) => {
        if (!entry || !entry.model) return;
        const data = entry.data || {};
        const ax = data.position_x, az = data.position_z;
        const dAnchor = (typeof ax === 'number' && typeof az === 'number')
          ? Math.hypot(ax - p.x, az - p.z) : -1;
        if (dAnchor >= 0 && dAnchor > radius) return;
        let box = null;
        try {
          const WB = (typeof window !== 'undefined') ? window.WorldObjectBounds : null;
          box = (WB && WB.ensure) ? WB.ensure(id, entry.model, data)
            : new THREE.Box3().setFromObject(entry.model);
        } catch (e) { /* 忽略单个对象失败 */ }
        const size = (box && !box.isEmpty())
          ? [(box.max.x - box.min.x), (box.max.y - box.min.y), (box.max.z - box.min.z)] : null;
        rows.push({
          id: id,
          锚点距: dAnchor < 0 ? '无锚点' : +dAnchor.toFixed(1),
          碰撞: data.has_collision === true ? 'Y' : '-',
          占位: entry.isPlaceholder ? 'Y' : '-',
          可见: entry.model.visible === false ? 'N' : 'Y',
          尺寸: size ? size.map(n => +n.toFixed(1)).join('×') : '无盒',
          盒距眼: (box && !box.isEmpty()) ? +box.distanceToPoint(eye).toFixed(2) : null
        });
      });
    }
    rows.sort((a, b) => (a.盒距眼 ?? 999) - (b.盒距眼 ?? 999));

    console.log('[camDiag] 摘要', summary);
    console.table(rows.slice(0, 25));
    return { summary, rows: rows.slice(0, 25) };
  }

  broadcastPosition() {
    if (WSClient.isConnected()) {
      // 获取当前动画模式
      let animMode = 'idle';
      if (this.worldObject && this.worldObject.userData.glbModel) {
        animMode = this.worldObject.userData.currentAnimMode || 'idle';
      }
      WSClient.send({
        type: 'POSITION_UPDATE',
        payload: {
          characterId: this.characterId,
          position: {
            x: Math.round(this.position.x * 100) / 100,
            y: Math.round(this.position.y * 100) / 100,
            z: Math.round(this.position.z * 100) / 100,
          },
          animMode,
          rotation: this.worldObject ? Math.round(this.worldObject.rotation.y * 1000) / 1000 : 0,
        },
      });
    }
  }

  takeDamage(damage) {
    this.health -= damage;
    if (this.health < 0) this.health = 0;

    UI.updateHealthBar(this.health, this.maxHealth);
    // 触发受击动画
    this.playHitAnim();

    if (this.health <= 0) {
      this.respawn();
    }
  }

  respawn() {
    // 优先使用角色的重生点，如果没有则使用世界出生点
    const respawnPoint = (this.characterData && this.characterData.character && this.characterData.character.respawn_point)
      || this.world.getSpawnPosition();
    this.position.set(respawnPoint.x, respawnPoint.y, respawnPoint.z);
    this.health = this.maxHealth;
    UI.addChatMessage('系统', '你已在重生点复活！');
  }

  attack(target) {
    if (!this.canAttack) return;

    const now = Date.now();
    if (now - this.lastAttackTime < CONFIG.SKILL_COOLDOWN) return;

    this.canAttack = false;
    this.lastAttackTime = now;

    // ── 连击逻辑 ──────────────────────────────
    clearTimeout(this.comboTimer);
    this.comboCount = (this.comboCount % 3) + 1;  // 1 → 2 → 3 → 1 循环
    const comboKey = `attack${this.comboCount}`;
    this.playAttackAnim(comboKey);

    // comboCooldown 内再次攻击才进入下一段，否则重置
    this.comboTimer = setTimeout(() => {
      this.comboCount = 0;
    }, this.comboCooldown);
    // ──────────────────────────────────────────

    // Animation and damage calculation
    const distance = this.position.distanceTo(target.position);
    if (distance <= CONFIG.ATTACK_RANGE) {
      const damage = 10 + Math.floor(Math.random() * 5);
      WSClient.send({
        type: 'MONSTER_ATTACK',
        payload: {
          attackerId: this.characterId,
          targetId: target.id,
          damage,
        },
      });
    }

    setTimeout(() => {
      this.canAttack = true;
    }, CONFIG.SKILL_COOLDOWN);
  }

  enableFlying() {
    this.isFlying = true;
    this.velocity.y = 0;
    UI.addChatMessage('系统', '飞行技能已启用！');
  }

  disableFlying() {
    this.isFlying = false;
    this.velocity.y = 0;
  }

  applyBuff(buffType, duration, multiplier = 1) {
    if (buffType === 'ATTACK_BOOST_3MIN') {
      GAME_STATE.activeBuff = {
        type: buffType,
        multiplier: multiplier,
        startTime: Date.now(),
        duration: duration,
      };
      UI.addChatMessage('系统', `攻击力提升！持续${duration / 1000}秒`);
    }
  }

  getAttackPower() {
    // 游客没有攻击力
    if (!this.characterData || !this.characterData.character) return 0;
    let power = this.characterData.character.attack_power;
    if (GAME_STATE.activeBuff) {
      const elapsed = Date.now() - GAME_STATE.activeBuff.startTime;
      if (elapsed < GAME_STATE.activeBuff.duration) {
        power *= GAME_STATE.activeBuff.multiplier;
      } else {
        GAME_STATE.activeBuff = null;
      }
    }
    return power;
  }

  // ==================== 传送门交互系统 ====================

  /**
   * 检测并处理传送门交互
   */
  checkPortalInteraction() {
    // 游客模式：禁止触发任何传送门，但显示提示
    if (GAME_STATE && GAME_STATE.isGuest) {
      // 检查 world.checkPortalProximity 方法是否存在
      if (!this.world.checkPortalProximity) {
        return;
      }
      // 检查玩家是否接近传送门
      const portalProximity = this.world.checkPortalProximity(this.position, 2);
      if (portalProximity) {
        const now = Date.now();
        if (!this._guestPortalHintCooldown || now - this._guestPortalHintCooldown > 3000) {
          this._guestPortalHintCooldown = now;
          this.showGuestPortalHint();
        }
        // 延迟检查玩家是否离开传送门范围
        setTimeout(() => {
          if (!this.world.checkPortalProximity || !this.world.checkPortalProximity(this.position, 2)) {
            this.hideGuestPortalHint();
          }
        }, 100);
      } else {
        this.hideGuestPortalHint();
      }
      return;
    }

    // 如果正在传送中，跳过检测
    if (this.isTeleporting) {
      return;
    }
    
    // 检查 world.checkPortalProximity 方法是否存在
    if (!this.world.checkPortalProximity) {
      return;
    }
    
    // 检查玩家是否接近传送门
    const portalProximity = this.world.checkPortalProximity(this.position, 2);
    
    if (portalProximity) {
      const { portalId, portal, distance } = portalProximity;
      
      // 安全检查：确保 portal 数据存在
      if (!portal || !portal.name) {
        console.error('❌ 传送门数据结构错误:', portal);
        return;
      }
      
      this.nearPortal = portal;
      
      // 本世界内传送门（portalType='local'）直接传送，不弹确认框
      if (portal.portalType === 'local') {
        this.teleportThroughPortal(portalId, portal);
        return;
      }
      
      // 远程/跨服传送门才显示确认对话框
      this.showPortalHint(portal.name, distance, portalId, portal);
    } else {
      if (this.nearPortal) {
        this.hidePortalHint();
        this.nearPortal = null;
      }
    }
  }

  /**
   * 显示游客传送门提示
   */
  showGuestPortalHint() {
    const hintElement = document.getElementById('guest-portal-hint');
    if (!hintElement) {
      const hint = document.createElement('div');
      hint.id = 'guest-portal-hint';
      hint.style.cssText = `
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 100, 0, 0.9);
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 24px;
        font-weight: bold;
        border: 3px solid #ff6400;
        box-shadow: 0 0 20px rgba(255, 100, 0, 0.5);
        z-index: 1000;
        pointer-events: none;
        text-align: center;
      `;
      document.body.appendChild(hint);
    }
    const hint = document.getElementById('guest-portal-hint');
    hint.innerHTML = '⚠️ 游客模式限制<br><span style="font-size:18px;">请注册后使用传送门功能</span>';
  }

  /**
   * 隐藏游客传送门提示
   */
  hideGuestPortalHint() {
    const hintElement = document.getElementById('guest-portal-hint');
    if (hintElement) {
      hintElement.remove();
    }
  }

  /**
   * 显示传送门提示（交互确认对话框）
   */
  showPortalHint(portalName, distance, portalId, portal) {
    const hintElement = document.getElementById('portal-hint');
    if (!hintElement) {
      // 创建提示元素
      const hint = document.createElement('div');
      hint.id = 'portal-hint';
      hint.style.cssText = `
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.88);
        color: white;
        padding: 30px 40px;
        border-radius: 12px;
        font-size: 22px;
        font-weight: bold;
        border: 2px solid rgba(0, 200, 255, 0.6);
        box-shadow: 0 0 30px rgba(0, 200, 255, 0.4);
        z-index: 1000;
        pointer-events: auto;
        text-align: center;
        min-width: 280px;
        font-family: 'Microsoft YaHei', sans-serif;
      `;
      document.body.appendChild(hint);
    }
    
    const hint = document.getElementById('portal-hint');
    
    // ====== 构建目标描述 ======
    let targetDesc = `<span style="font-size: 18px; color: #00ccff;">${portalName}</span>`;
    let actionText = '确定传送';
    let actionColor = 'linear-gradient(135deg, #00cc66, #00aa55)';
    
    if (portal._isAdSlot && portal._meta) {
      const meta = portal._meta;
      if (meta.portal_type === 'link' && meta.target_url) {
        try {
          const urlObj = new URL(meta.target_url);
          targetDesc = `<span style="font-size: 18px; color: #00ccff;">${portalName}</span><br><span style="font-size: 14px; color: #aaa;">${urlObj.hostname}</span>`;
          actionText = '🔗 打开链接';
          actionColor = 'linear-gradient(135deg, #ff6600, #cc5500)';
        } catch(e) {
          actionText = '🔗 打开链接';
        }
      } else if (meta.portal_type === 'world') {
        targetDesc = `<span style="font-size: 18px; color: #ff00ff;">${portalName}</span>`;
        actionText = '🌍 开始传送';
        actionColor = 'linear-gradient(135deg, #cc00ff, #8800cc)';
      } else if (meta.portal_type === 'app') {
        actionText = '📱 打开应用';
        actionColor = 'linear-gradient(135deg, #0099ff, #0066cc)';
      }
    }
    
    // 检查冷却时间
    const now = Date.now();
    const cooldownRemaining = Math.ceil((this.teleportCooldown - (now - this.lastTeleportTime)) / 1000);
    const isOnCooldown = now - this.lastTeleportTime < this.teleportCooldown;
    
    // 构建 HTML（先算好再比较 hash，避免离开→再靠近变空框）
    let newHtml;
    if (isOnCooldown) {
      newHtml = `
        🌀 ${portalName}<br>
        <span style="font-size: 16px; color: #ff9900;">⏳ 冷却中，请等待 ${cooldownRemaining} 秒</span>
      `;
    } else {
      newHtml = `
        🌀 是否传送到？<br>
        ${targetDesc}<br>
        <div style="margin-top: 18px; display: flex; justify-content: center;">
          <button id="portal-confirm-btn" style="
            padding: 10px 32px;
            background: ${actionColor};
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
          ">${actionText}</button>
        </div>
      `;
    }
    
    // 内容相同则跳过（离远再靠近不重建 DOM）
    if (this._lastPortalHintHash !== newHtml) {
      hint.innerHTML = newHtml;
      this._lastPortalHintHash = newHtml;
    }
    
    // 绑定确认按钮（离开时弹窗被 remove()，回到范围才重新显示）
    if (!isOnCooldown) {
      const confirmBtn = document.getElementById('portal-confirm-btn');
      if (confirmBtn && !confirmBtn._bound) {
        confirmBtn._bound = true;
        confirmBtn.onclick = () => {
          this.hidePortalHint();
          this.teleportThroughPortal(portalId, portal);
        };
      }
    }
  }

  /**
   * 隐藏传送门提示
   */
  hidePortalHint() {
    this._lastPortalHintHash = null;  // 清除缓存，确保下次靠近重建内容
    const hintElement = document.getElementById('portal-hint');
    if (hintElement) {
      hintElement.remove();
    }
  }

  /**
   * 通过传送门传送
   */
  async teleportThroughPortal(portalId, portalData) {
    // 防止重复传送
    if (this.isTeleporting) {
      console.log('⚠️ 传送进行中，跳过');
      return;
    }
    
    console.log('🌀 开始传送...', portalData);
    
    // 设置传送锁
    this.isTeleporting = true;
    this.lastTeleportTime = Date.now();
    
    try {
      // 创建传送特效
      if (this.world && this.world.createTeleportEffect) {
        this.world.createTeleportEffect(this.position);
      }
      
      // ====== 广告位传送门处理 ======
      if (portalData._isAdSlot && portalData._meta) {
        const meta = portalData._meta;
        console.log('🔗 广告位传送门:', meta);
        
        setTimeout(() => {
          if (meta.portal_type === 'link' && meta.target_url) {
            // 打开外部链接（新标签页）
            window.open(meta.target_url, '_blank');
            UI.addChatMessage('系统', `🔗 正在打开: ${meta.name}`);
          } else if (meta.portal_type === 'world') {
            // 跳转到其他世界
            if (meta.target_world_url) {
              const worldUrl = new URL(meta.target_world_url);
              if (typeof GAME_STATE !== 'undefined' && GAME_STATE.characterId) {
                worldUrl.searchParams.set('characterId', GAME_STATE.characterId);
              }
              UI.addChatMessage('系统', `🌍 正在传送到: ${meta.target_world_name || meta.name}`);
              window.location.href = worldUrl.toString();
            } else if (meta.target_world_id) {
              // 通过世界ID跳转
              UI.addChatMessage('系统', `🌍 正在传送到: ${meta.target_world_name || meta.name}`);
              window.location.href = `/?worldId=${meta.target_world_id}`;
            } else {
              UI.addChatMessage('系统', `⚠️ 目标世界未配置`);
            }
          } else if (meta.portal_type === 'app' && meta.deep_link) {
            // 尝试拉起应用
            window.location.href = meta.deep_link;
            setTimeout(() => {
              if (meta.target_url) window.open(meta.target_url, '_blank');
            }, 2000);
            UI.addChatMessage('系统', `📱 正在打开: ${meta.name}`);
          } else {
            UI.addChatMessage('系统', `⚠️ 未知的传送门类型: ${meta.portal_type}`);
          }
          this.isTeleporting = false;
        }, 800);
        return;
      }
      
      // 如果是跨服传送门，需要跳转到另一个服务器
      if (portalData.portalType === 'remote' && portalData.targetWorldUrl) {
        UI.addChatMessage('系统', '正在传送到远程世界...');
        
        // 保存token并跳转
        setTimeout(() => {
          const token = localStorage.getItem('token');
          const targetUrl = `${portalData.targetWorldUrl}?token=${token}&portal=true`;
          window.location.href = targetUrl;
        }, 1000);
        return;
      }
      
      // 本地传送
      console.log('调用传送API，角色ID:', this.characterId);
      
      // 调用API记录传送日志
      const response = await API.post('/portal/use', {
        portal_id: portalId,
        character_id: this.characterId,
      });
      
      console.log('✅ API响应:', response);
      
      if (response.target_position) {
        // 解析目标位置（可能是JSON字符串）
        let targetPos = response.target_position;
        if (typeof targetPos === 'string') {
          targetPos = JSON.parse(targetPos);
        }
        
        console.log('目标位置:', targetPos);
        
        // 设置目标位置
        this.position.set(targetPos.x, targetPos.y, targetPos.z);
        
        // 创建到达特效
        setTimeout(() => {
          if (this.world && this.world.createTeleportEffect) {
            this.world.createTeleportEffect(this.position);
          }
        }, 100);
        
        UI.addChatMessage('系统', `✨ 已传送到: ${portalData.name}`);
        console.log('✅ 传送成功:', targetPos);
      } else {
        console.error('❌ 响应中没有目标位置');
        UI.addChatMessage('系统', '传送失败：没有目标位置');
      }
    } catch (error) {
      console.error('❌ 传送失败，详细错误:', error);
      
      if (error.message.includes('401')) {
        UI.addChatMessage('系统', '传送失败：身份验证过期，请重新登录');
      } else if (error.message.includes('403')) {
        UI.addChatMessage('系统', '传送失败：等级不足或权限不够');
      } else if (error.message.includes('429')) {
        UI.addChatMessage('系统', '传送失败：冷却中');
      } else {
        UI.addChatMessage('系统', `传送失败：${error.message || '未知错误'}`);
      }
    } finally {
      // 延迟解锁（防止立即再次触发）
      setTimeout(() => {
        this.isTeleporting = false;
        console.log('传送锁已解除');
      }, 500);
    }
  }

  /**
   * 手动触发传送（按F键）
   */
  triggerPortalTeleport() {
    if (this.nearPortal) {
      const portalEntry = Array.from(this.world.portals.entries()).find(
        ([id, data]) => data === this.nearPortal
      );
      
      if (portalEntry) {
        const [portalId, portalData] = portalEntry;
        this.teleportThroughPortal(portalId, portalData);
      }
    }
  }

  // ==================== 传送门交互系统结束 ====================

  // ==================== 战斗状态机 ====================

  // 七段连击序列与每段动画时长(ms)
  static get COMBO_SEQUENCE() {
    return ['attack1', 'attack_slash', 'attack_swing', 'attack_uppercut', 'attack_stab', 'attack2', 'attack3'];
  }
  static get COMBO_DURATIONS() {
    return { attack1: 900, attack_slash: 700, attack_swing: 800, attack_uppercut: 750, attack_stab: 700, attack2: 800, attack3: 1100 };
  }
  // 攻击范围（光剑所到之处，约2.5单位）
  static get ATTACK_RANGE() { return 3.0; }

  /**
   * 锁定怪物目标，开始追击
   * @param {string} monsterId
   * @param {object} monsterData  来自 gameWorld.monsters.get(id)
   */
  setTarget(monsterId, monsterData) {
    // 若已有选中高亮则先清除
    if (this.combatTarget && window.gameWorld) {
      window.gameWorld.hideMonsterSelected(this.combatTarget.id);
    }
    // 清除旧超时
    if (this.combatChaseTimer) { clearTimeout(this.combatChaseTimer); this.combatChaseTimer = null; }
    if (this.comboTimeoutHandle) { clearTimeout(this.comboTimeoutHandle); this.comboTimeoutHandle = null; }

    this.combatTarget = { id: monsterId, data: monsterData };
    this.combatState = 'chasing';
    this.isAttackingCombo = false;
    this.comboIndex = 0;

    // 显示选中光圈
    if (window.gameWorld) window.gameWorld.showMonsterSelected(monsterId);

    // 显示头顶血条 HUD
    this._showMonsterHud(monsterData);

    // 5秒追不到则放弃
    this.combatChaseTimer = setTimeout(() => {
      if (this.combatState === 'chasing') {
        console.log('[Combat] 追击超时，放弃目标');
        this.clearCombat();
      }
    }, 5000);

    console.log(`[Combat] 锁定目标: ${monsterId}`);
  }

  /**
   * 每帧驱动战斗状态机
   */
  updateCombat(delta, camera) {
    if (this.combatState === 'idle') return;

    const target = this.combatTarget;
    if (!target) { this.clearCombat(); return; }

    // 检查怪物是否还存在
    if (!window.gameWorld || !window.gameWorld.monsters.has(target.id)) {
      console.log('[Combat] 怪物已消失，结束战斗');
      this.clearCombat();
      return;
    }

    const monsterData = window.gameWorld.monsters.get(target.id);
    const monsterPos = monsterData.group.position;
    const distance = this.position.distanceTo(monsterPos);

    // 更新头顶血条位置
    this._updateMonsterHudPosition(monsterPos, monsterData, camera);

    if (this.combatState === 'chasing') {
      if (distance <= Player.ATTACK_RANGE) {
        // 进入攻击范围
        if (this.combatChaseTimer) { clearTimeout(this.combatChaseTimer); this.combatChaseTimer = null; }
        this.combatState = 'attacking';
        this.startComboAttack();
      } else {
        // 自动向目标跑去
        this._chaseTarget(monsterPos, delta);
      }
    } else if (this.combatState === 'attacking') {
      if (distance > Player.ATTACK_RANGE + 1.5) {
        // 目标跑远了，重新追击
        this.isAttackingCombo = false;
        if (this.comboTimeoutHandle) { clearTimeout(this.comboTimeoutHandle); this.comboTimeoutHandle = null; }
        this.combatState = 'chasing';
        if (window.gameWorld) window.gameWorld._switchPlayerAnim(this.characterId, 'run');
        // 重置超时计时器
        if (this.combatChaseTimer) clearTimeout(this.combatChaseTimer);
        this.combatChaseTimer = setTimeout(() => {
          if (this.combatState === 'chasing') this.clearCombat();
        }, 5000);
      }
      // 面向怪物
      this._faceTarget(monsterPos);
    }
  }

  /**
   * 角色面向目标怪物（只旋转模型，不改变相机视角）
   */
  _faceTarget(monsterPos) {
    const dx = monsterPos.x - this.position.x;
    const dz = monsterPos.z - this.position.z;
    const angle = Math.atan2(dx, dz);
    // 只旋转角色模型，不覆盖 MOUSE.rotationY（避免抢占相机控制）
    if (this.worldObject) this.worldObject.rotation.y = angle;
  }

  /**
   * 追击目标（覆盖移动方向）
   * 停在怪物正前方 ATTACK_RANGE 距离处，不冲入怪物中心
   */
  _chaseTarget(monsterPos, delta) {
    const dx = monsterPos.x - this.position.x;
    const dz = monsterPos.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.1) return;

    // 目标停止点：距怪物中心 ATTACK_RANGE * 0.9，停在面前而不是中心
    const stopDist = Player.ATTACK_RANGE * 0.9;
    if (dist <= stopDist) return;

    const speed = this.moveSpeed * 1.5; // 追击时用跑步速度
    // 每帧最多移动到停止点，不超过
    const maxStep = Math.min((dist - stopDist), speed * delta);
    this.position.x += (dx / dist) * maxStep;
    this.position.z += (dz / dist) * maxStep;

    // 只旋转模型朝向目标，不覆盖相机
    const angle = Math.atan2(dx, dz);
    if (this.worldObject) this.worldObject.rotation.y = angle;

    // 播放奔跑动画
    if (window.gameWorld) window.gameWorld._switchPlayerAnim(this.characterId, 'run');
  }

  /**
   * 开始连击（从当前 comboIndex 开始）
   */
  startComboAttack() {
    if (this.combatState !== 'attacking') return;
    if (this.isAttackingCombo) return;
    this.isAttackingCombo = true;
    this.comboIndex = 0;
    this._playComboStep();
  }

  /**
   * 播放当前连击段动画 + 发伤害，动画播完后自动进入下一段（event-driven）
   */
  _playComboStep() {
    if (this.combatState !== 'attacking') { this.isAttackingCombo = false; return; }

    // 目标是否还存在
    if (!this.combatTarget || !window.gameWorld || !window.gameWorld.monsters.has(this.combatTarget.id)) {
      this.clearCombat();
      return;
    }

    // 攻击范围检测
    const monsterData = window.gameWorld.monsters.get(this.combatTarget.id);
    const dist = this.position.distanceTo(monsterData.group.position);
    if (dist > Player.ATTACK_RANGE + 1.0) {
      // 超出范围 → 转追击，动画由 chasing 分支处理
      this.isAttackingCombo = false;
      this.combatState = 'chasing';
      if (window.gameWorld) window.gameWorld._switchPlayerAnim(this.characterId, 'run');
      return;
    }

    const seq = Player.COMBO_SEQUENCE;
    const key = seq[this.comboIndex];

    // 从已加载的 action 读取实际动画时长（毫秒），fallback 到硬编码
    const gw = window.gameWorld;
    const clipDuration = gw?.players?.get(this.characterId)
      ?.group?.userData?.animActions?.[key]?._clip?.duration;
    const duration = clipDuration ? Math.ceil(clipDuration * 1000) : (Player.COMBO_DURATIONS[key] || 900);

    // 尝试通过 finished 事件驱动（优先）；如动画未加载则用 setTimeout fallback
    const played = gw ? gw._switchPlayerAnim(this.characterId, key, {
      inCombat: true,
      onFinished: () => this._onComboStepFinished(),
    }) : false;

    // 发伤害（在动画启动时计算，模拟击中判定）
    this._dealDamageToTarget();

    if (!played) {
      // 动画未加载时用 setTimeout fallback，保证战斗不卡死
      if (this.comboTimeoutHandle) clearTimeout(this.comboTimeoutHandle);
      this.comboTimeoutHandle = setTimeout(() => {
        this.comboTimeoutHandle = null;
        this._onComboStepFinished();
      }, duration);
    } else {
      // 动画已加载：用超时保底（防止 finished 事件丢失导致链断）
      // 保底时长 = 实际动画时长 + 300ms 宽余，确保 finished 事件优先触发
      if (this.comboTimeoutHandle) clearTimeout(this.comboTimeoutHandle);
      this.comboTimeoutHandle = setTimeout(() => {
        this.comboTimeoutHandle = null;
        // 若动画事件已经触发过则 currentAnimMode 已变，此处是保底
        if (this.combatState === 'attacking' && this.isAttackingCombo) {
          this._onComboStepFinished();
        }
      }, duration + 300); // 保底 = 实际动画时长 + 300ms，确保 finished 事件优先
    }
  }

  /**
   * 一段连击结束后的回调（由 finished 事件或超时 fallback 触发）
   */
  _onComboStepFinished() {
    // 清除保底超时
    if (this.comboTimeoutHandle) { clearTimeout(this.comboTimeoutHandle); this.comboTimeoutHandle = null; }

    if (this.combatState !== 'attacking' || !this.isAttackingCombo) return;

    // 目标检查
    if (!this.combatTarget || !window.gameWorld || !window.gameWorld.monsters.has(this.combatTarget.id)) {
      this.clearCombat();
      return;
    }

    // 推进到下一段
    this.comboIndex = (this.comboIndex + 1) % Player.COMBO_SEQUENCE.length;
    this._playComboStep();
  }

  /**
   * 对锁定目标造成伤害
   */
  _dealDamageToTarget() {
    if (!this.combatTarget) return;
    const monsterId = this.combatTarget.id;
    const damage = Math.floor(this.getAttackPower() * (0.9 + Math.random() * 0.3));

    // 本地先更新血量（驱动血条）
    let monsterDied = false;
    if (window.gameWorld && window.gameWorld.monsters.has(monsterId)) {
      const md = window.gameWorld.monsters.get(monsterId);
      md.health = Math.max(0, (md.health != null ? md.health : (md.maxHealth || 50)) - damage);
      this._updateMonsterHudHp(md);

      if (md.health <= 0) {
        console.log(`[Combat] 怪物 ${monsterId} 死亡`);
        monsterDied = true;
        this.clearCombat();
        window.gameWorld.removeMonster(monsterId);
      }
    }

    // REST API 发送伤害，携带 characterId 和 userId 供后端记录击杀者
    if (typeof API !== 'undefined' && API.monsterTakeDamage) {
      const characterId = this.characterId || GAME_STATE.characterId || localStorage.getItem('characterId');
      const userId = GAME_STATE.userId || localStorage.getItem('userId');
      API.monsterTakeDamage(monsterId, damage, characterId, userId)
        .then(result => {
          if (!result) return;
          // 处理掉落奖励
          if (result.drop && result.drop.dropId) {
            this._autoPickDrop(result.drop, userId);
          }
        })
        .catch(() => {});
    }

    console.log(`[Combat] 对 ${monsterId} 造成 ${damage} 点伤害`);
  }

  /**
   * 自动拾取掉落物并写入背包
   * 家园世界模式：
   *   步骤1 - 调用当前世界 mark-picked，标记 world_drops 已拾取（不写 player_inventory）
   *   步骤2 - 调用家园世界 remote-add，把奖励写入玩家注册的那个世界的 player_inventory
   * 本地模式（未传送）：
   *   直接调用当前世界 pick 接口（原有逻辑）
   */
  async _autoPickDrop(drop, userId) {
    try {
      if (!userId) {
        userId = GAME_STATE.userId || localStorage.getItem('userId');
      }
      if (!userId) return;

      const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE)
        ? CONFIG.API_BASE
        : (window.location.origin + '/api');

      const homeWorldApiUrl = localStorage.getItem('homeWorldApiUrl');
      const homeWorldUserId = localStorage.getItem('homeWorldUserId');
      const homeWorldToken  = localStorage.getItem('homeWorldToken');
      const localToken      = localStorage.getItem('token') || '';

      const isHomeWorldMode = !!(homeWorldApiUrl && homeWorldUserId &&
                                 homeWorldApiUrl !== window.location.origin);

      if (isHomeWorldMode) {
        // ────────────────────────────────────────────────
        // 家园世界模式：两步拾取
        // ────────────────────────────────────────────────

        // 步骤1：标记当前世界掉落物已被拾取（只更新 world_drops，不写 player_inventory）
        let itemData = null;
        try {
          const markRes = await fetch(`${apiBase}/inventory/drops/${drop.dropId}/mark-picked`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localToken}`
            },
            body: JSON.stringify({ userId })
          });
          const markData = await markRes.json();
          if (markData.item) {
            itemData = markData.item;
          } else {
            console.warn('[Drop] mark-picked 失败:', markData.error);
            return;
          }
        } catch (e) {
          console.error('[Drop] mark-picked 请求失败:', e);
          return;
        }

        // 步骤2：把奖励远程写入家园世界 player_inventory
        try {
          const remoteRes = await fetch(`${homeWorldApiUrl}/api/inventory/remote-add`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${homeWorldToken}`
            },
            body: JSON.stringify({
              homeUserId:    homeWorldUserId,
              rewardName:    itemData.rewardName  || drop.rewardName || '奖励',
              rewardDesc:    itemData.rewardDesc  || '',
              code:          itemData.code        || drop.code || '',
              platformUrl:   itemData.platformUrl || '',
              sourceWorldUrl: window.location.origin
            })
          });
          const remoteData = await remoteRes.json();

          if (remoteData.inserted || remoteData.message?.includes('已存在')) {
            const itemName = itemData.rewardName || drop.rewardName || '奖励';
            if (typeof UI !== 'undefined' && UI.showNotification) {
              UI.showNotification('🎁 获得奖励', `${itemName} 已写入家园世界背包！`, 4000);
            }
            console.log('[Drop] 家园世界写入成功:', itemName, '→', homeWorldApiUrl);
          } else {
            console.warn('[Drop] 家园世界写入返回:', remoteData);
          }
        } catch (e) {
          console.error('[Drop] 家园世界 remote-add 失败:', e);
          // 步骤2失败不影响步骤1（掉落物已标记拾取），仅通知用户
          if (typeof UI !== 'undefined' && UI.showNotification) {
            UI.showNotification('⚠️ 背包同步失败', '奖励已拾取但写入家园世界失败，请稍后重试', 5000);
          }
        }

      } else {
        // ────────────────────────────────────────────────
        // 本地模式（未传送或在家园世界本身）：原有逻辑
        // ────────────────────────────────────────────────
        const res = await fetch(`${apiBase}/inventory/drops/${drop.dropId}/pick`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localToken}`
          },
          body: JSON.stringify({ userId })
        });
        const data = await res.json();

        if (data.message === '拾取成功' && data.item) {
          const itemName = data.item.rewardName || drop.rewardName || '奖励';
          if (typeof UI !== 'undefined' && UI.showNotification) {
            UI.showNotification('🎁 获得奖励', `${itemName} 已加入背包！`, 4000);
          }
          console.log('[Drop] 自动拾取成功:', itemName, data.item);
        }
      }
    } catch (e) {
      console.error('[Drop] 自动拾取失败:', e);
    }
  }

  /**
   * 清除战斗状态，回到 idle
   */
  clearCombat() {
    if (this.combatChaseTimer) { clearTimeout(this.combatChaseTimer); this.combatChaseTimer = null; }
    if (this.comboTimeoutHandle) { clearTimeout(this.comboTimeoutHandle); this.comboTimeoutHandle = null; }

    if (this.combatTarget && window.gameWorld) {
      window.gameWorld.hideMonsterSelected(this.combatTarget.id);
    }

    this.combatTarget = null;
    this.combatState = 'idle';
    this.isAttackingCombo = false;
    this.comboIndex = 0;

    // 隐藏头顶血条
    this._hideMonsterHud();

    // 回到 idle 动画
    if (window.gameWorld) {
      window.gameWorld._switchPlayerAnim(this.characterId, 'idle');
    }
  }

  // ─── 头顶血条 HUD ────────────────────────────────────────────

  _showMonsterHud(monsterData) {
    let hud = document.getElementById('monster-head-hud');
    if (!hud) return;
    const name = monsterData.type || '怪物';
    const hp = monsterData.health != null ? monsterData.health : (monsterData.maxHealth || 50);
    const maxHp = monsterData.maxHealth || hp || 50;
    hud.querySelector('.mhud-name').textContent = name;
    const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    hud.querySelector('.mhud-bar-fill').style.width = pct + '%';
    hud.style.display = 'block';
  }

  _updateMonsterHudHp(monsterData) {
    const hud = document.getElementById('monster-head-hud');
    if (!hud || hud.style.display === 'none') return;
    const hp = monsterData.health != null ? monsterData.health : 0;
    const maxHp = monsterData.maxHealth || 50;
    const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    hud.querySelector('.mhud-bar-fill').style.width = pct + '%';
  }

  _updateMonsterHudPosition(monsterPos, monsterData, camera) {
    const hud = document.getElementById('monster-head-hud');
    if (!hud || hud.style.display === 'none' || !camera) return;

    // 取怪物头顶位置
    const headPos = new THREE.Vector3(monsterPos.x, monsterPos.y + 3.2, monsterPos.z);
    headPos.project(camera);

    // NDC → CSS 像素
    const canvas = document.getElementById('gameCanvas') || document.querySelector('canvas');
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const x = (headPos.x * 0.5 + 0.5) * w;
    const y = (-headPos.y * 0.5 + 0.5) * h;

    // 在相机视野后方时隐藏
    if (headPos.z > 1) { hud.style.display = 'none'; return; }
    hud.style.display = 'block';
    hud.style.left = (x - hud.offsetWidth / 2) + 'px';
    hud.style.top = (y - hud.offsetHeight) + 'px';
  }

  _hideMonsterHud() {
    const hud = document.getElementById('monster-head-hud');
    if (hud) hud.style.display = 'none';
  }

  // ==================== 战斗状态机结束 ====================

  /**
   * 缓动函数：平滑的加速减速曲线（ease-in-out）
   */
  easeInOut(t) {
    // 使用平滑的三次方曲线
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.Player = Player;
  // 遮挡诊断：控制台 __camDiag() / __camDiag(40)
  window.__camDiag = function (r) {
    const p = window.player || (window.gameWorld && window.gameWorld.player);
    if (!p || typeof p._camDiag !== 'function') return 'player 未就绪';
    return p._camDiag(r);
  };
}
