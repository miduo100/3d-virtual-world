/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 角色模板模块 - 上传配置
 * 
 * 本文件包含所有上传相关的配置：GLB文件、技能动画、音效
 * 使用 multer 处理文件上传
 * 
 * @author Character Templates Module
 * @since 1.0.0
 */

const multer = require('multer');
const path = require('path');
const {
  UPLOAD_BASE_DIR,
  CHAR_TEMPLATE_MAX_UPLOAD_BYTES,
  SOUND_MAX_UPLOAD_BYTES,
} = require('./config');

// ===== GLB 文件上传配置 =====
const glbStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = UPLOAD_BASE_DIR;
    try {
      const fs = require('fs').promises;
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'char-' + suffix + ext);
  },
});

const upload = multer({
  storage: glbStorage,
  limits: { fileSize: CHAR_TEMPLATE_MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = /glb|gltf|png|jpg|jpeg|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 GLB/GLTF/图片 文件'));
    }
  },
});

// ===== 技能动画专用上传配置 =====
// 存放在 skill-anims 子目录
const skillAnimStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(UPLOAD_BASE_DIR, 'skill-anims');
    try {
      const fs = require('fs').promises;
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'skill-' + suffix + ext);
  },
});

const uploadSkillAnim = multer({
  storage: skillAnimStorage,
  limits: { fileSize: CHAR_TEMPLATE_MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (/glb|gltf/.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传 GLB/GLTF 文件'));
  },
});

// ===== 音频文件专用上传配置 =====
// 存放在 sounds 子目录
const soundStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(UPLOAD_BASE_DIR, 'sounds');
    try {
      const fs = require('fs').promises;
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'sound-' + suffix + ext);
  },
});

const uploadSound = multer({
  storage: soundStorage,
  limits: { fileSize: SOUND_MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = /mp3|ogg|wav|aac|m4a/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传音频文件（mp3/ogg/wav/aac/m4a）'));
  },
});

module.exports = {
  // GLB 上传
  upload,
  
  // 技能动画上传
  uploadSkillAnim,
  
  // 音效上传
  uploadSound,
};
