/**
 * 对象自定义配置注册表
 * 作用：为不同类型的世界对象定义可调整的参数面板
 * 支持：threejs_code（粒子/动画）、uploaded_model（动画/阴影）、geometry_building（颜色/线框）等
 */
(function () {
  'use strict';

  // 工具函数：按点号路径读取/设置嵌套对象值
  function deepGet(obj, path) {
    if (!obj || !path) return undefined;
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length; i++) {
      if (current === null || current === undefined) return undefined;
      current = current[keys[i]];
    }
    return current;
  }

  function deepSet(obj, path, value) {
    if (!obj || !path) return;
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  /**
   * 字段定义：
   * key: 配置路径，支持点号，如 'particle.size'
   * type: slider | color | toggle | number | select
   * label: 显示名称
   * min/max/step: 数值范围（slider/number）
   * options: select 选项 [{label, value}]
   * default: 默认值
   * condition: 函数(objData) 返回 true 才显示
   */
  const REGISTRY = {
    'threejs_code': {
      label: '✨ 粒子与特效',
      icon: '✨',
      fields: [
        {
          key: 'particle.size',
          type: 'slider',
          label: '粒子大小',
          min: 0.01,
          max: 5,
          step: 0.01,
          default: 0.2,
          help: '单个粒子的显示尺寸，过大易产生白球'
        },
        {
          key: 'particle.opacity',
          type: 'slider',
          label: '粒子透明度',
          min: 0.01,
          max: 1,
          step: 0.01,
          default: 0.15,
          help: '发光粒子叠加会越叠越亮，建议 0.05~0.3'
        },
        {
          key: 'particle.color',
          type: 'color',
          label: '粒子颜色',
          default: '#ffffff',
          help: '全体发光粒子的统一色调'
        },
        {
          key: 'animationSpeed',
          type: 'slider',
          label: '动画速度',
          min: 0,
          max: 5,
          step: 0.1,
          default: 1,
          help: '代码块中主动画的速度倍率（需代码配合读取）'
        }
      ]
    },

    'uploaded_model': {
      label: '🎨 模型参数',
      icon: '🎨',
      fields: [
        {
          key: 'animation.speed',
          type: 'slider',
          label: '动画速度',
          min: 0,
          max: 5,
          step: 0.1,
          default: 1,
          help: 'GLB 动画播放速度倍率'
        },
        {
          key: 'animation.loop',
          type: 'toggle',
          label: '循环播放',
          default: true
        },
        {
          key: 'castShadow',
          type: 'toggle',
          label: '投射阴影',
          default: true
        },
        {
          key: 'receiveShadow',
          type: 'toggle',
          label: '接收阴影',
          default: true
        }
      ]
    },

    'geometry_building': {
      label: '📐 几何体样式',
      icon: '📐',
      fields: [
        {
          key: 'color',
          type: 'color',
          label: '基础颜色',
          default: '#ffffff'
        },
        {
          key: 'emissive',
          type: 'color',
          label: '自发光颜色',
          default: '#000000'
        },
        {
          key: 'emissiveIntensity',
          type: 'slider',
          label: '发光强度',
          min: 0,
          max: 5,
          step: 0.1,
          default: 0
        },
        {
          key: 'wireframe',
          type: 'toggle',
          label: '线框模式',
          default: false
        }
      ]
    }
  };

  // 为某个类型注册/扩展配置（外部插件也可用）
  function register(type, config) {
    REGISTRY[type] = config;
  }

  // 获取某类型的配置定义
  function get(type) {
    return REGISTRY[type] || null;
  }

  // 判断某类型是否有自定义配置
  function has(type) {
    return !!REGISTRY[type];
  }

  // 获取字段的当前值（优先用已保存配置，否则用默认值）
  function getFieldValue(type, field, savedConfig) {
    const saved = savedConfig !== undefined ? deepGet(savedConfig, field.key) : undefined;
    return saved !== undefined ? saved : field.default;
  }

  window.CustomConfigRegistry = {
    register,
    get,
    has,
    deepGet,
    deepSet,
    getFieldValue
  };

  console.log('✅ CustomConfigRegistry 已加载，支持类型:', Object.keys(REGISTRY).join(', '));
})();
