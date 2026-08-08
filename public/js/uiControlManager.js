/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * UI控件管理器
 * 负责从服务器加载UI配置并应用到游戏界面
 */

class UIControlManager {
  constructor() {
    this.controls = [];
    this.config = {};
    this.platform = this.detectPlatform();
    this.initialized = false;
  }

  /**
   * 检测平台类型（含方向和VR）
   * 返回: 'desktop' | 'mobile-portrait' | 'mobile-landscape' | 'vr'
   */
  detectPlatform() {
    // VR检测
    if (this.detectVR()) {
      return 'vr';
    }

    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
      || (window.innerWidth <= 768);

    if (isMobile) {
      // 区分竖屏/横屏
      return window.innerHeight >= window.innerWidth ? 'mobile-portrait' : 'mobile-landscape';
    }

    return 'desktop';
  }

  /**
   * 检测VR设备
   */
  detectVR() {
    // 检查URL参数强制VR模式
    if (window.location.search.includes('vr=1') || window.location.hash.includes('vr')) {
      return true;
    }
    // 检查全局VR标志（由VR系统设置）
    if (window.VR_ACTIVE === true || window.GAME_STATE?.vrMode === true) {
      return true;
    }
    return false;
  }

  /**
   * 异步初始化VR检测（WebXR）
   */
  async initVRDetection() {
    if (navigator.xr) {
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
          console.log('[UIControlManager] WebXR VR设备已检测到');
          // 监听XR session开始/结束
          navigator.xr.addEventListener('sessiongranted', () => {
            window.VR_ACTIVE = true;
            this.platform = 'vr';
            this.refresh();
          });
        }
      } catch (e) {
        // WebXR不可用，忽略
      }
    }
  }

  /**
   * 获取当前屏幕方向（仅移动端有效）
   */
  getOrientation() {
    if (this.platform === 'mobile-portrait' || this.platform === 'mobile-landscape') {
      return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
    }
    return null;
  }

  /**
   * 初始化并加载配置
   */
  async init() {
    try {
      console.log(`[UIControlManager] 初始化，平台: ${this.platform}`);
      this.initVRDetection();
      await this.loadConfig();
      this.applyConfig();
      this.initialized = true;
      console.log('[UIControlManager] 初始化完成');
    } catch (error) {
      console.error('[UIControlManager] 初始化失败:', error);
    }
  }

  /**
   * 从服务器加载UI配置
   */
  async loadConfig() {
    try {
      const response = await fetch(`/api/ui-controls/config?platform=${this.platform}`);
      const data = await response.json();

      if (data.success) {
        this.controls = data.controls;
        // 转换为以control_id为key的对象
        this.config = this.controls.reduce((acc, control) => {
          acc[control.control_id] = control;
          return acc;
        }, {});
        console.log('[UIControlManager] 加载配置成功:', Object.keys(this.config));
      } else {
        console.warn('[UIControlManager] 加载配置失败，使用默认配置');
        this.useDefaultConfig();
      }
    } catch (error) {
      console.warn('[UIControlManager] 加载配置失败，使用默认配置:', error);
      this.useDefaultConfig();
    }
  }

  /**
   * 使用默认配置
   */
  useDefaultConfig() {
    this.config = {};
  }

  /**
   * 应用配置到UI元素
   */
  applyConfig() {
    console.log('[UIControlManager] 应用UI配置...');

    // 应用所有控件配置（包括不可见的，以应用 display:none）
    for (const controlId in this.config) {
      const control = this.config[controlId];
      this.applyControlConfig(controlId, control);
    }
  }

  /**
   * 应用单个控件配置
   */
  applyControlConfig(controlId, control) {
    // 根据control_id查找对应的DOM元素
    const element = this.findElementByControlId(controlId);

    if (element) {
      console.log(`[UIControlManager] 应用配置到 ${controlId}:`, {
        x: control.position_x,
        y: control.position_y,
        width: control.width,
        height: control.height
      });
      this.applyStyles(element, control);
    } else {
      // 对于动态创建的控件（移动端控件、性能监控面板等），稍后再尝试
      const isDynamicControl = controlId.startsWith('mobile_') || 
        controlId === 'performance_monitor' || 
        controlId === 'skill_hud' || 
        controlId === 'skill_voice_btn' ||
        controlId === 'federation_portal_btn' ||  // 联邦传送按钮由 federationUI.js 动态创建
        controlId === 'copy_coords_btn';  // 复制坐标按钮是 debug_panel 子元素，不单独控制
      if (!isDynamicControl) {
        console.warn(`[UIControlManager] 未找到控件: ${controlId}`);
      }
      // 保存配置，稍后可以通过 applyControl 方法应用
      this.config[controlId] = control;
    }
  }

  /**
   * 根据control_id查找对应的DOM元素
   */
  findElementByControlId(controlId) {
    // 控件ID到DOM元素选择器的映射
    const selectorMap = {
      // 桌面端控件
      'btn_profile': '#user-quick-actions',
      'btn_inventory': '#btn-inventory',

      // 通用控件
      'health_bar': '#health-bar',
      'minimap': '#minimap',
      'skill_hud': '#skill-hud',  // 技能栏（由 skillHUD.js 动态创建）
      'skill_voice_btn': '#skill-voice-btn',  // 语音按钮（由 skillHUD.js 动态创建）
      'voice_indicator': '#voiceIndicator',  // 语音录制指示器（录音时的动画效果）
      'portal_btn': '#world-portal-btn',  // 世界传送门按钮
      'federation_portal_btn': '#federation-teleport-btn',  // 联邦传送门按钮
      // copy_coords_btn 是 debug_panel 的子元素，不单独控制
      'performance_monitor': '#performance-panel',  // 性能监控面板
      'debug_panel': '#debug-panel',  // 坐标调试面板

      // 移动端控件
      'mobile_joystick': '#mobile-joystick',
      'mobile_jump_btn': '#mobile-jump-btn',
      'mobile_sprint_btn': '#mobile-sprint-btn',
      'mobile_camera_toggle_btn': '#mobile-camera-toggle-btn',
      'mobile_turn_left_btn': '#mobile-turn-left-btn',
      'mobile_turn_right_btn': '#mobile-turn-right-btn'
    };

    const selector = selectorMap[controlId];
    if (selector) {
      return document.querySelector(selector);
    }

    // 如果没有映射，尝试直接查找
    return document.getElementById(controlId) ||
           document.querySelector(`.${controlId}`);
  }

  /**
   * 应用样式到元素
   */
  applyStyles(element, config) {
    if (!element || !config) return;

    const styles = {};

    // 水平位置和对齐方式
    if (config.position_x) {
      const hAlign = config.h_align || 'left';
      if (hAlign === 'right') {
        styles.right = config.position_x === 'auto' ? '20px' : config.position_x;
        styles.left = 'auto';
      } else {
        styles.left = config.position_x === 'auto' ? '20px' : config.position_x;
        styles.right = 'auto';
      }
    }

    // 垂直位置和对齐方式
    if (config.position_y) {
      const vAlign = config.v_align || 'top';
      if (vAlign === 'bottom') {
        styles.bottom = config.position_y === 'auto' ? '20px' : config.position_y;
        styles.top = 'auto';
      } else {
        styles.top = config.position_y === 'auto' ? '20px' : config.position_y;
        styles.bottom = 'auto';
      }
    }

    // 大小（过滤空字符串和null，避免覆盖元素原有尺寸
    // 性能监控面板尺寸范围保护：min=120×80, max=400×250）
    if (config.width && config.width !== 'null' && config.width !== 'undefined') {
      let w = parseFloat(config.width);
      if (config.control_id === 'performance_monitor') {
        if (isNaN(w) || w < 120) {
          console.warn('[UIControlManager] performance_monitor 宽度异常过小:', config.width, '→ 200px');
          styles.width = '200px';
        } else if (w > 400) {
          console.warn('[UIControlManager] performance_monitor 宽度过大:', config.width, '→ 200px');
          styles.width = '200px';
        } else {
          styles.width = config.width;
        }
      } else {
        styles.width = config.width;
      }
    }
    if (config.height && config.height !== 'null' && config.height !== 'undefined') {
      let h = parseFloat(config.height);
      if (config.control_id === 'performance_monitor') {
        if (isNaN(h) || h < 80) {
          console.warn('[UIControlManager] performance_monitor 高度异常过小:', config.height, '→ 120px');
          styles.height = '120px';
        } else if (h > 250) {
          console.warn('[UIControlManager] performance_monitor 高度过大:', config.height, '→ 120px');
          styles.height = '120px';
        } else {
          styles.height = config.height;
        }
      } else {
        styles.height = config.height;
      }
    }

    // 定位方式（只有有位置坐标时才设置，子控件如 copy_coords_btn 不设）
    if (config.position_x || config.position_y) {
      if (config.position_type) {
        styles.position = config.position_type;
      } else {
        styles.position = 'fixed';
      }
    }

    // 层级
    if (config.z_index) styles.zIndex = config.z_index;

    // 可见性
    if (config.is_visible === false) {
      styles.display = 'none';
    } else {
      styles.display = '';
    }

    // 应用样式
    Object.assign(element.style, styles);

    // 应用自定义样式配置
    if (config.style_config) {
      try {
        const customStyles = typeof config.style_config === 'string'
          ? JSON.parse(config.style_config)
          : config.style_config;
        Object.assign(element.style, customStyles);
      } catch (e) {
        console.warn('[UIControlManager] 解析样式配置失败:', e);
      }
    }
  }

  /**
   * 获取控件配置
   */
  getControlConfig(controlId) {
    return this.config[controlId];
  }

  /**
   * 检查控件是否可见
   */
  isControlVisible(controlId) {
    const control = this.config[controlId];
    return control ? control.is_visible !== false : true;
  }

  /**
   * 刷新配置（重新加载并应用）
   */
  async refresh() {
    console.log('[UIControlManager] 刷新配置...');
    await this.loadConfig();
    this.applyConfig();
  }

  /**
   * 应用指定控件的配置（供动态创建的控件调用）
   * @param {string} controlId - 控件ID
   * @param {HTMLElement} element - 控件DOM元素（可选，如果不传则自动查找）
   */
  applyControl(controlId, element = null) {
    const control = this.config[controlId];
    if (!control) {
      console.warn(`[UIControlManager] 未找到控件配置: ${controlId}`);
      return;
    }

    const el = element || this.findElementByControlId(controlId);
    if (el) {
      console.log(`[UIControlManager] 应用配置到 ${controlId}:`, {
        x: control.position_x,
        y: control.position_y,
        width: control.width,
        height: control.height
      });
      this.applyStyles(el, control);
    } else {
      console.warn(`[UIControlManager] 未找到控件元素: ${controlId}`);
    }
  }

  /**
   * 监听窗口大小变化，动态调整
   */
  setupResizeListener() {
    let resizeTimer;
    const handleChange = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const newPlatform = this.detectPlatform();
        if (newPlatform !== this.platform) {
          this.platform = newPlatform;
          this.refresh();
        }
      }, 250);
    };
    window.addEventListener('resize', handleChange);
    window.addEventListener('orientationchange', handleChange);
  }
}

// 创建全局实例
window.uiControlManager = new UIControlManager();

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.uiControlManager.init();
    window.uiControlManager.setupResizeListener();
  });
} else {
  window.uiControlManager.init();
  window.uiControlManager.setupResizeListener();
}
