/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 移动端虚拟摇杆控制系统
class MobileControls {
  constructor() {
    this.enabled = false;
    this.joystickActive = false;
    this.joystickStartX = 0;
    this.joystickStartY = 0;
    this.joystickCurrentX = 0;
    this.joystickCurrentY = 0;
    this.joystickMaxDistance = 60; // 摇杆最大移动距离
    
    // 触摸相机控制
    this.touchCameraActive = false;
    this.touchCameraLastX = 0;
    this.touchCameraLastY = 0;
    this.touchCameraSensitivity = 0.005; // 触摸相机灵敏度（平衡速度，避免震动）
    
    // DOM元素
    this.joystickContainer = null;
    this.joystickKnob = null;
    this.jumpButton = null;
    this.cameraToggleButton = null;
    this.turnLeftButton = null;
    this.turnRightButton = null;
    
    // 检测是否是移动设备
    this.isMobile = this.detectMobile();
    
    if (this.isMobile) {
      this.init();
    }
  }
  
  detectMobile() {
    // 检测是否是移动设备
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase()) 
           || (window.innerWidth <= 768);
  }
  
  init() {
    console.log('📱 初始化移动端控制');
    this.createJoystick();
    this.createButtons();
    this.setupTouchEvents();
    this.enabled = true;
    
    // 应用 UI 配置到刚创建的控件
    this.applyUIControlConfig();
  }
  
  /**
   * 应用 UI 控件管理器的配置
   */
  applyUIControlConfig() {
    if (window.uiControlManager) {
      const mobileControls = ['mobile_joystick', 'mobile_jump_btn', 'mobile_sprint_btn', 'mobile_camera_toggle_btn', 'mobile_turn_left_btn', 'mobile_turn_right_btn'];
      mobileControls.forEach(controlId => {
        if (window.uiControlManager.getControlConfig) {
          window.uiControlManager.applyControl(controlId);
        }
      });
    }
  }
  
  createJoystick() {
    // 创建摇杆容器
    this.joystickContainer = document.createElement('div');
    this.joystickContainer.id = 'mobile-joystick';
    this.joystickContainer.style.cssText = `
      position: fixed;
      left: 24px;
      bottom: 100px;
      width: 150px;
      height: 150px;
      background: rgba(0, 255, 0, 0.15);
      border: 3px solid rgba(0, 255, 0, 0.4);
      border-radius: 50%;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
    `;
    
    // 创建摇杆把手
    this.joystickKnob = document.createElement('div');
    this.joystickKnob.id = 'mobile-joystick-knob';
    this.joystickKnob.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 60px;
      height: 60px;
      background: rgba(0, 255, 0, 0.6);
      border: 3px solid #00ff00;
      border-radius: 50%;
      box-shadow: 0 0 15px rgba(0, 255, 0, 0.8);
      transition: background 0.1s;
    `;
    
    this.joystickContainer.appendChild(this.joystickKnob);
    document.body.appendChild(this.joystickContainer);
    
    // 添加中心点指示
    const centerDot = document.createElement('div');
    centerDot.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 6px;
      height: 6px;
      background: #00ff00;
      border-radius: 50%;
      pointer-events: none;
    `;
    this.joystickContainer.appendChild(centerDot);
  }
  
  createButtons() {
    // 创建跳跃按钮（右下角，技能栏在其上方，z-index:1000避免遮挡技能HUD:1500）
    this.jumpButton = document.createElement('button');
    this.jumpButton.id = 'mobile-jump-btn';
    this.jumpButton.innerHTML = '⬆️';
    this.jumpButton.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 70px;
      height: 70px;
      background: rgba(0, 255, 0, 0.3);
      border: 3px solid #00ff00;
      border-radius: 50%;
      color: white;
      font-size: 32px;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(0, 255, 0, 0.5);
    `;
    document.body.appendChild(this.jumpButton);
    
    // 创建视角切换按钮（跳跃按钮左侧）
    this.cameraToggleButton = document.createElement('button');
    this.cameraToggleButton.id = 'mobile-camera-toggle-btn';
    this.cameraToggleButton.innerHTML = '📷';
    this.cameraToggleButton.style.cssText = `
      position: fixed;
      right: 110px;
      bottom: 24px;
      width: 60px;
      height: 60px;
      background: rgba(0, 255, 255, 0.3);
      border: 3px solid #00ffff;
      border-radius: 50%;
      color: white;
      font-size: 28px;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(0, 255, 255, 0.5);
    `;
    document.body.appendChild(this.cameraToggleButton);
    
    // 冲刺按钮（视角切换按钮左侧）
    this.sprintButton = document.createElement('button');
    this.sprintButton.id = 'mobile-sprint-btn';
    this.sprintButton.innerHTML = '⚡';
    this.sprintButton.style.cssText = `
      position: fixed;
      right: 186px;
      bottom: 24px;
      width: 60px;
      height: 60px;
      background: rgba(255, 255, 0, 0.3);
      border: 3px solid #ffff00;
      border-radius: 50%;
      color: white;
      font-size: 28px;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(255, 255, 0, 0.5);
    `;
    document.body.appendChild(this.sprintButton);

    // 左转按钮（右侧按钮区上方，等效桌面端 Q 键）
    this.turnLeftButton = document.createElement('button');
    this.turnLeftButton.id = 'mobile-turn-left-btn';
    this.turnLeftButton.innerHTML = '◀';
    this.turnLeftButton.style.cssText = `
      position: fixed;
      right: 110px;
      bottom: 180px;
      width: 50px;
      height: 50px;
      background: rgba(0, 255, 255, 0.25);
      border: 2px solid #00ffff;
      border-radius: 50%;
      color: #00ffff;
      font-size: 20px;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.4);
    `;
    document.body.appendChild(this.turnLeftButton);

    // 右转按钮（左转按钮右侧，等效桌面端 E 键）
    this.turnRightButton = document.createElement('button');
    this.turnRightButton.id = 'mobile-turn-right-btn';
    this.turnRightButton.innerHTML = '▶';
    this.turnRightButton.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 180px;
      width: 50px;
      height: 50px;
      background: rgba(0, 255, 255, 0.25);
      border: 2px solid #00ffff;
      border-radius: 50%;
      color: #00ffff;
      font-size: 20px;
      z-index: 1000;
      pointer-events: auto;
      touch-action: none;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.4);
    `;
    document.body.appendChild(this.turnRightButton);
  }
  
  setupTouchEvents() {
    // 摇杆触摸事件
    this.joystickContainer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.handleJoystickStart(e.touches[0]);
    });
    
    this.joystickContainer.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.handleJoystickMove(e.touches[0]);
    });
    
    this.joystickContainer.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleJoystickEnd();
    });
    
    // 跳跃按钮
    this.jumpButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      KEYS.space = true;
      this.jumpButton.style.background = 'rgba(0, 255, 0, 0.6)';
    });
    
    this.jumpButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      KEYS.space = false;
      this.jumpButton.style.background = 'rgba(0, 255, 0, 0.3)';
    });
    
    // 冲刺按钮
    this.sprintButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      KEYS.shift = true;
      this.sprintButton.style.background = 'rgba(255, 255, 0, 0.6)';
    });
    
    this.sprintButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      KEYS.shift = false;
      this.sprintButton.style.background = 'rgba(255, 255, 0, 0.3)';
    });
    
    // 视角切换按钮
    this.cameraToggleButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      GAME_STATE.cameraMode = GAME_STATE.cameraMode === 'first-person' ? 'third-person' : 'first-person';
      const modeText = GAME_STATE.cameraMode === 'first-person' ? '第一视角' : '第三视角';
      if (typeof UI !== 'undefined' && UI.addChatMessage) {
        UI.addChatMessage('系统', `已切换到${modeText}`);
      }
      this.cameraToggleButton.style.background = 'rgba(0, 255, 255, 0.6)';
      setTimeout(() => {
        this.cameraToggleButton.style.background = 'rgba(0, 255, 255, 0.3)';
      }, 200);
    });

    // 左转按钮（按住 = Q 键按下，松开 = Q 键释放）
    this.turnLeftButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      KEYS.q = true;
      this.turnLeftButton.style.background = 'rgba(0, 255, 255, 0.6)';
    });
    this.turnLeftButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      KEYS.q = false;
      this.turnLeftButton.style.background = 'rgba(0, 255, 255, 0.25)';
    });
    this.turnLeftButton.addEventListener('touchcancel', (e) => {
      KEYS.q = false;
      this.turnLeftButton.style.background = 'rgba(0, 255, 255, 0.25)';
    });

    // 右转按钮（按住 = E 键按下，松开 = E 键释放）
    this.turnRightButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      KEYS.e = true;
      this.turnRightButton.style.background = 'rgba(0, 255, 255, 0.6)';
    });
    this.turnRightButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      KEYS.e = false;
      this.turnRightButton.style.background = 'rgba(0, 255, 255, 0.25)';
    });
    this.turnRightButton.addEventListener('touchcancel', (e) => {
      KEYS.e = false;
      this.turnRightButton.style.background = 'rgba(0, 255, 255, 0.25)';
    });

    // 画面右侧触摸控制相机
    const canvas = document.getElementById('canvas');
    if (canvas) {
      let activeTouches = new Map(); // 跟踪多点触摸
      
      canvas.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          // 右侧屏幕用于相机控制
          if (touch.clientX > window.innerWidth / 2) {
            activeTouches.set(touch.identifier, {
              startX: touch.clientX,
              startY: touch.clientY,
              lastX: touch.clientX,
              lastY: touch.clientY
            });
          }
        }
      });
      
      canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          const touchData = activeTouches.get(touch.identifier);
          
          if (touchData) {
            const deltaX = touch.clientX - touchData.lastX;
            const deltaY = touch.clientY - touchData.lastY;
            
            // 更新目标旋转角度（平滑过渡）
            MOUSE.targetRotationY -= deltaX * this.touchCameraSensitivity;
            
            // 第一视角和第三视角方向不同
            if (GAME_STATE.cameraMode === 'first-person') {
              MOUSE.targetRotationX -= deltaY * this.touchCameraSensitivity;
            } else {
              MOUSE.targetRotationX += deltaY * this.touchCameraSensitivity;
            }
            
            // 限制垂直旋转目标
            MOUSE.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, MOUSE.targetRotationX));
            
            // 更新last位置
            touchData.lastX = touch.clientX;
            touchData.lastY = touch.clientY;
          }
        }
      });
      
      canvas.addEventListener('touchend', (e) => {
        // 移除结束的触摸点
        for (let i = 0; i < e.changedTouches.length; i++) {
          activeTouches.delete(e.changedTouches[i].identifier);
        }
      });
      
      canvas.addEventListener('touchcancel', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          activeTouches.delete(e.changedTouches[i].identifier);
        }
      });
    }
  }
  
  handleJoystickStart(touch) {
    this.joystickActive = true;
    const rect = this.joystickContainer.getBoundingClientRect();
    this.joystickStartX = rect.left + rect.width / 2;
    this.joystickStartY = rect.top + rect.height / 2;
    this.joystickKnob.style.background = 'rgba(0, 255, 0, 0.9)';
  }
  
  handleJoystickMove(touch) {
    if (!this.joystickActive) return;
    
    // 计算摇杆偏移
    const deltaX = touch.clientX - this.joystickStartX;
    const deltaY = touch.clientY - this.joystickStartY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // 限制摇杆移动距离
    let finalX = deltaX;
    let finalY = deltaY;
    
    if (distance > this.joystickMaxDistance) {
      const angle = Math.atan2(deltaY, deltaX);
      finalX = Math.cos(angle) * this.joystickMaxDistance;
      finalY = Math.sin(angle) * this.joystickMaxDistance;
    }
    
    // 更新摇杆把手位置
    this.joystickKnob.style.transform = `translate(calc(-50% + ${finalX}px), calc(-50% + ${finalY}px))`;
    
    // 转换为游戏输入（归一化到-1到1）
    const normalizedX = finalX / this.joystickMaxDistance;
    const normalizedY = finalY / this.joystickMaxDistance;
    
    // 死区处理
    const deadZone = 0.15;
    const absX = Math.abs(normalizedX);
    const absY = Math.abs(normalizedY);
    
    // 前后移动
    if (absY > deadZone) {
      if (normalizedY < 0) {
        KEYS.w = true;
        KEYS.s = false;
      } else {
        KEYS.w = false;
        KEYS.s = true;
      }
    } else {
      KEYS.w = false;
      KEYS.s = false;
    }
    
    // 左右移动
    if (absX > deadZone) {
      if (normalizedX < 0) {
        KEYS.a = true;
        KEYS.d = false;
      } else {
        KEYS.a = false;
        KEYS.d = true;
      }
    } else {
      KEYS.a = false;
      KEYS.d = false;
    }
  }
  
  handleJoystickEnd() {
    this.joystickActive = false;
    
    // 重置摇杆位置
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    this.joystickKnob.style.background = 'rgba(0, 255, 0, 0.6)';
    
    // 重置所有移动键
    KEYS.w = false;
    KEYS.a = false;
    KEYS.s = false;
    KEYS.d = false;
  }
  
  // 在桌面端隐藏移动控制
  hide() {
    if (this.joystickContainer) this.joystickContainer.style.display = 'none';
    if (this.jumpButton) this.jumpButton.style.display = 'none';
    if (this.cameraToggleButton) this.cameraToggleButton.style.display = 'none';
    if (this.sprintButton) this.sprintButton.style.display = 'none';
    if (this.turnLeftButton) this.turnLeftButton.style.display = 'none';
    if (this.turnRightButton) this.turnRightButton.style.display = 'none';
  }

  // 显示移动控制
  show() {
    if (this.joystickContainer) this.joystickContainer.style.display = 'block';
    if (this.jumpButton) this.jumpButton.style.display = 'block';
    if (this.cameraToggleButton) this.cameraToggleButton.style.display = 'block';
    if (this.sprintButton) this.sprintButton.style.display = 'block';
    if (this.turnLeftButton) this.turnLeftButton.style.display = 'block';
    if (this.turnRightButton) this.turnRightButton.style.display = 'block';
  }
}

// 初始化移动控制（在页面加载时自动创建）
let mobileControls = null;

window.addEventListener('load', () => {
  mobileControls = new MobileControls();
  
  // 监听窗口大小变化，动态显示/隐藏控制
  window.addEventListener('resize', () => {
    if (mobileControls) {
      const isMobile = window.innerWidth <= 768;
      if (isMobile && !mobileControls.enabled) {
        mobileControls.init();
      } else if (!isMobile && mobileControls.enabled) {
        mobileControls.hide();
      }
    }
  });
});
