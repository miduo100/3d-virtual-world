/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 移动端虚拟摇杆控制系统
class MobileControls {
  constructor() {
    this.enabled = false;
    this.joystickActive = false;
    this.joystickTouchId = null; // 摇杆手指的 identifier（多指时必须认自己那根）
    this.joystickStartX = 0;
    this.joystickStartY = 0;
    this.joystickCurrentX = 0;
    this.joystickCurrentY = 0;
    this.joystickMaxDistance = 60; // 摇杆最大移动距离
    
    // 触摸相机控制
    this.touchCameraActive = false;
    this.touchCameraLastX = 0;
    this.touchCameraLastY = 0;
    this.touchCameraSensitivity = 0.008; // 滑屏灵敏度：改单链写入后按标称值补回（原 0.005 实际被两条监听各写一次=0.01）
    
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
    // 摇杆触摸事件（按 identifier 归属：多指时只认落在摇杆上的那根手指）
    this.joystickContainer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (!t) return;
      this.joystickTouchId = t.identifier;
      this.handleJoystickStart(t);
    });

    this.joystickContainer.addEventListener('touchmove', (e) => {
      e.preventDefault();
      // 原实现用 e.touches[0]：先滑屏再按摇杆时会认成滑屏那根手指，手柄被拽到错误位置
      const t = this._findTouch(e.touches, this.joystickTouchId);
      if (t) this.handleJoystickMove(t);
    });

    this.joystickContainer.addEventListener('touchend', (e) => {
      e.preventDefault();
      // 只有摇杆手指抬起才结束，滑屏手指抬起不应松开摇杆
      if (this._findTouch(e.changedTouches, this.joystickTouchId)) {
        this.joystickTouchId = null;
        this.handleJoystickEnd();
      }
    });

    this.joystickContainer.addEventListener('touchcancel', (e) => {
      if (this._findTouch(e.changedTouches, this.joystickTouchId)) {
        this.joystickTouchId = null;
        this.handleJoystickEnd();
      }
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

    // 画面滑屏控制相机（2026-11-24 重做：按 identifier 归属，单指/双指都可用）
    // 为什么要重做：原实现只登记「起手位置在屏幕右半屏」的触摸，左手按摇杆时右手从中间起滑就完全不登记；
    // 而 main.js 里另一条同名监听又用 e.touches.length === 1 把双指情形整体挡掉，两者叠加 = 视角转不动。
    // 现在全局只有这一条链：谁先落在 canvas 上谁就是相机手指，直到它自己抬起为止。
    const canvas = document.getElementById('canvas');
    if (canvas) {
      let camTouchId = null;   // 正在驱动相机的触摸点 identifier
      let camLastX = 0;
      let camLastY = 0;
      let camFirstMove = true;

      canvas.addEventListener('touchstart', (e) => {
        // 已有相机手指在用时，后来的手指不抢控制权（避免双指瞬间跳视角）
        if (camTouchId !== null) return;
        const t = e.changedTouches[0];
        if (!t) return;
        // 摇杆和按钮都是独立 DOM，落在它们上面的触摸不会到这里；
        // 能进到 canvas 的就是「滑屏看四周」的那根手指。
        camTouchId = t.identifier;
        camLastX = t.clientX;
        camLastY = t.clientY;
        camFirstMove = true;
        MOUSE.isDragging = true;  // 第三人称「不拖拽时俯仰自动回水平」依赖这个标志
      }, { passive: true });

      canvas.addEventListener('touchmove', (e) => {
        if (camTouchId === null) return;
        const t = this._findTouch(e.touches, camTouchId);
        if (!t) {
          // 自愈：相机手指已不在屏幕上（部分浏览器双指同时抬起时 changedTouches 只报一根）
          camTouchId = null;
          MOUSE.isDragging = false;
          return;
        }
        e.preventDefault();
        if (camFirstMove) {          // 跳过第一次 move，避免按下瞬间跳变
          camLastX = t.clientX;
          camLastY = t.clientY;
          camFirstMove = false;
          return;
        }
        const deltaX = t.clientX - camLastX;
        const deltaY = t.clientY - camLastY;
        camLastX = t.clientX;
        camLastY = t.clientY;
        // 过滤异常跳变，阈值与桌面端 mousemove 的 maxDelta 一致
        if (Math.abs(deltaX) > 100 || Math.abs(deltaY) > 100) return;

        MOUSE.targetRotationY -= deltaX * this.touchCameraSensitivity;
        if (GAME_STATE.cameraMode === 'first-person') {
          MOUSE.targetRotationX -= deltaY * this.touchCameraSensitivity;
        } else {
          MOUSE.targetRotationX += deltaY * this.touchCameraSensitivity;
        }
        MOUSE.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, MOUSE.targetRotationX));
      }, { passive: false });

      const endCameraTouch = (e) => {
        if (camTouchId === null) return;
        // 只有相机手指自己抬起才收尾：抬摇杆手指不能把滑屏状态一起清掉
        // e.touches.length === 0 兜底双指同时抬起（此时 changedTouches 未必包含相机手指）
        if (e.touches.length === 0 || this._findTouch(e.changedTouches, camTouchId)) {
          camTouchId = null;
          MOUSE.isDragging = false;
        }
      };
      canvas.addEventListener('touchend', endCameraTouch);
      canvas.addEventListener('touchcancel', endCameraTouch);
    }
  }

  /**
   * 在 TouchList 里按 identifier 找指针对应的触摸点
   * 多指场景下不能用 touches[0]，否则会认成另一根手指
   */
  _findTouch(list, id) {
    if (id === null || id === undefined || !list) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
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

// 【2026-10-24】改在 DOMContentLoaded 启动：window.load 可能被第三方扩展/外部资源挂起而永不触发
function bootMobileControls() {
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
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMobileControls, { once: true });
} else {
  bootMobileControls();
}
