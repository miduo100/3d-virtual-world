/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Player controller
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
    // Calculate movement
    let moveForward = 0;
    let moveRight = 0;

    // W/S: Forward/Backward
    if (KEYS.w) moveForward += this.moveSpeed;
    if (KEYS.s) moveForward -= this.moveSpeed;
    
    // A/D: Left/Right strafe (A左移，D右移)
    if (KEYS.a) moveRight += this.moveSpeed;  // A向左
    if (KEYS.d) moveRight -= this.moveSpeed;  // D向右

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
        this.targetRotationY += config.speed;
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
        
        // 应用旋转
        this.targetRotationY -= config.speed;
        config.lastPressed = true;
      } else {
        // 松开键，重置状态
        this.rotationAcceleration.e.speed = 0;
        this.rotationAcceleration.e.holdTime = 0;
        this.rotationAcceleration.e.isPressed = false;
        this.rotationAcceleration.e.lastPressed = false;
      }
      
      // 平滑插值到目标旋转角度
      const rotationDiff = this.targetRotationY - MOUSE.rotationY;
      MOUSE.rotationY += rotationDiff * this.rotationSmoothness;

      // Auto-rotate camera slightly when strafing left/right
      const strafeRotationSpeed = 0.008; // Subtle rotation when strafing
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

        this.position.add(movement);
        
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
        MOUSE.targetRotationY += config.speed;
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
        MOUSE.targetRotationY -= config.speed;
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

        this.position.add(movement);
        
        // 🎯 新增：侧面碰撞检测（非飞行模式）
        if (!this.isFlying) {
          const newPosition = this.position.clone();
          
          if (this.checkSideCollision(newPosition)) {
            // 完整移动被阻挡，尝试沿墙滑动
            
            // 尝试只移动 X 方向
            const posXOnly = this.position.clone();
            posXOnly.x = newPosition.x;
            if (!this.checkSideCollision(posXOnly)) {
              this.position.x = newPosition.x;  // 允许X方向移动
            }
            
            // 尝试只移动 Z 方向
            const posZOnly = this.position.clone();
            posZOnly.z = newPosition.z;
            if (!this.checkSideCollision(posZOnly)) {
              this.position.z = newPosition.z;  // 允许Z方向移动
            }
          }
          // 如果无碰撞，保持完整移动（this.position.add(movement) 已执行）
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
    
    for (const obj of this.world.collisionObjects) {
      if (!obj.position || !obj.size) continue;
      
      // 统一读取尺寸（兼容 width/height/depth 和 x/y/z 两种格式）
      const width = obj.size.width ?? obj.size.x ?? 0;
      const height = obj.size.height ?? obj.size.y ?? 0;
      const depth = obj.size.depth ?? obj.size.z ?? 0;
      
      if (width === 0 || height === 0 || depth === 0) continue;
      
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
    
    return false;  // 无碰撞
  }

  handleVerticalMovement(delta) {
    if (this.isFlying) {
      // Flying mode
      if (KEYS.space) {
        this.position.y += CONFIG.PLAYER_SPEED * 2;
      }
      if (KEYS.shift) {
        this.position.y -= CONFIG.PLAYER_SPEED * 2;
      }
    } else {
      // Get ground height at current position (includes stairs and platforms)
      const groundHeight = this.world.getGroundHeight(this.position);
      // GLB 模型已通过 fitModel 将原点对齐脚底，characterGroup 直接落在地面（playerHeight=0）
      // 方块人（程序生成）脚底在 characterGroup 下方 1.5 个单位，playerHeight=1.5 使脚底贴地
      const playerHeight = (this.worldObject && this.worldObject.userData && this.worldObject.userData.isGlbLoaded) ? 0 : 1.5;
      const targetY = groundHeight + playerHeight;

      // Gravity and jumping
      if (this.position.y > targetY + 0.1) {
        // Player is in the air, apply gravity
        this.velocity.y -= this.gravity;
        this.position.y += this.velocity.y;
        this.isGrounded = false;
      } else {
        // Player is on the ground (or close enough)
        this.isGrounded = true;

        // Jump with stronger force - check BEFORE resetting position
        if (KEYS.space) {
          this.velocity.y = 0.8;  // Increased from 0.5 to 0.8 for higher jump
          this.position.y += this.velocity.y;  // Apply velocity immediately
          this.isGrounded = false;  // Player is now jumping
        } else {
          // Only snap to ground if not jumping
          this.position.y = targetY;
          this.velocity.y = 0;
        }
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
      const animSpeed = KEYS.shift ? 0.45 : 0.3;
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
        const levelingSpeed = 0.05;
        MOUSE.rotationX *= (1 - levelingSpeed);
        MOUSE.targetRotationX *= (1 - levelingSpeed);
      }
      
      // Show player model in third-person
      if (this.worldObject) {
        this.worldObject.visible = true;
        
        // 让人物模型跟随摄像机的水平旋转（Y轴）
        // 使用 MOUSE.rotationY 而不是 this.rotation
        this.worldObject.rotation.y = MOUSE.rotationY;
      }
      
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
        const levelingSpeed = 0.05;
        MOUSE.rotationX *= (1 - levelingSpeed);
        MOUSE.targetRotationX *= (1 - levelingSpeed);
      }
      
      // Hide player model in first-person
      if (this.worldObject) {
        this.worldObject.visible = false;
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
      
      camera.position.lerp(targetCameraPos, 0.1);
      
      // Set camera rotation directly from mouse rotation
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.y = MOUSE.rotationY;
      euler.x = MOUSE.rotationX;
      camera.quaternion.setFromEuler(euler);
    }
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
}
