/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 文件上传配置模块
 * 包含：所有 multer 上传配置（角色模板、武器、技能动画、音频、动作库）
 */

const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { CHAR_TEMPLATE_MAX_UPLOAD_BYTES } = require('./utils');

// ===== GLB 文件上传配置 =====
const glbStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../../../public/uploads/character-templates');
    try {
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
    const allowed = /glb|gltf|png|jpg|jpeg|webp|fbx/i;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 GLB/GLTF/FBX/图片 文件'));
    }
  },
});

// 技能动画专用上传（存放在 skill-anims 子目录）
const skillAnimStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../../../public/uploads/character-templates/skill-anims');
    try {
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
    if (/glb|gltf|fbx/i.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传 GLB/GLTF/FBX 文件'));
  },
});

// 音频文件专用上传（存放在 sounds 子目录）
const soundStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../../../public/uploads/character-templates/sounds');
    try {
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 音频限制 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /mp3|ogg|wav|aac|m4a/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传音频文件（mp3/ogg/wav/aac/m4a）'));
  },
});

// 武器GLB专用上传
const weaponStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../../../public/uploads/weapons');
    try { await fs.mkdir(dir, { recursive: true }); cb(null, dir); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'weapon-' + suffix + path.extname(file.originalname).toLowerCase());
  },
});
const uploadWeapon = multer({
  storage: weaponStorage,
  limits: { fileSize: CHAR_TEMPLATE_MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (/glb|gltf|fbx/i.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传 GLB/GLTF/FBX 文件'));
  },
});

// 动作库专用上传（存放在 anim-library 子目录）
const animLibStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../../../public/uploads/anim-library');
    try { await fs.mkdir(dir, { recursive: true }); cb(null, dir); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'anim-' + suffix + path.extname(file.originalname).toLowerCase());
  },
});
const uploadAnimLib = multer({
  storage: animLibStorage,
  limits: { fileSize: CHAR_TEMPLATE_MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (/glb|gltf|fbx/i.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('只允许上传 GLB/GLTF/FBX 文件'));
  },
});

module.exports = {
  upload,
  uploadSkillAnim,
  uploadSound,
  uploadWeapon,
  uploadAnimLib
};
