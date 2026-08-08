/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 配置和全局变量
const API_BASE = window.location.origin + '/api';
const SERVER_BASE = window.location.origin;

// 全局状态
let scene, camera, renderer, controls, gltfLoader;
let charGroup = null, weaponGroup = null, rightElbow = null;
let glbMixer = null, glbAnimations = [], glbCurrentAction = null;

// MVP 9个动作的 mixer/action 缓存（扩展技能动态追加）
const ANIM_KEYS_BASE = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
  'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
let ANIM_KEYS = [...ANIM_KEYS_BASE];
const animMixers = {};  // key -> THREE.AnimationMixer
const animActions = {}; // key -> THREE.AnimationAction
let currentAnimMode = 'idle', animTime = 0;
let lastT = performance.now(), fCount = 0, fSample = 0;

// 当前模板所有动画URL
const tmplAnimUrls = {}; // key -> url


// 配置对象
const CONFIG = {
  API_BASE: window.location.origin + '/api',
  SERVER_BASE: window.location.origin,
  templateId: null,
  templateName: '默认方块人',
  glbUrl: null,
  character: {
    scale: 1,
    headColor: 0xffaa99,
    bodyColor: 0x4a90e2
  },
  glbTargetHeight: 1.8,
  preset: 'default',
  weapon: 'none',
  sword: {
    bladeColor: 0x00ffff,
    hiltColor: 0x111111,
    bladeLength: 0.8,
    glowIntensity: 0.8,
    position: { x: 0, y: -0.3, z: 0.1 },
    rotation: { x: 0, y: 0, z: 0 }
  },
  staff: {
    orbColor: 0xaa44ff,
    length: 1.2
  },
  attack: {
    duration: 300,
    walkSwing: 0.6,
    slowRate: 1
  },

  WS_URL: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`,
  ENABLE_VR: false,
  // 新增配置
  PLAYER_SPEED: 0.15,
  DRAW_DISTANCE: 500,
  MAX_HORIZONTAL_FOV: 90,
  MIN_VERTICAL_FOV: 35,
  // 性能配置
  TARGET_FPS: 60,
  MAX_PIXEL_RATIO: 1.0,
  WORLD_SIZE: 1000
};

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}



// 新手引导
let currentGuideStep = 1;
const totalGuideSteps = 5;

// 动画预览
let isAnimPlaying = false;
let animSpeed = 1.0;
let animLoopMode = 'loop';
let animDuration = 3.0;
let animCurrentTime = 0;
let animTotalTime = 0;



// 活跃的mixer（性能优化）
let activeMixers = [];
