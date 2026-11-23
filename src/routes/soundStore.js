/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundStore.js —— 音效落盘统一入口（上传 / 编辑器另存 / AI 入库 共用）
 *
 * 为什么要有这一层：
 *   三个口子都会往 sounds 目录写文件，文件名即引用键（soundAssetsRoute 靠这个建引用明细）。
 *   如果只有 AI 入库走压缩，而上传和编辑器还是原样落盘，目录里就会混着
 *   「压过的 MP3」和「没压的 WAV」，体积优化做一半就废了。
 *   所以压缩规则收敛到这里，三个口子共用一套判定。
 *
 * 压缩策略（2026-11-03 实测，项目 12 个素材整体 22.6 倍）：
 *   WAV → MP3 单声道 32kbps，采样率按素材类型分级（环境音 22.05kHz / 动作音 44.1kHz）
 *   已经是 mp3/aac/m4a 的 → **不再压**（再压是 generational loss，音质只降不升）
 *   压缩后体积没变小 → 保留原文件（仿 textureCompress.js 范式）
 *   压缩失败 → 保留原文件，绝不阻断上传
 */
'use strict';

const fs = require('fs');
const path = require('path');
const audioCompress = require('../services/audioCompress');

const SOUNDS_DIR = path.join(__dirname, '../../public/uploads/character-templates/sounds');

/** 已经是压缩格式的，不再二次压缩 */
const ALREADY_COMPRESSED = /\.(mp3|aac|m4a|ogg|opus)$/i;

/**
 * 把一个已落盘的音频文件处理成最终形态。
 * @param {string} filePath  已落盘的原始文件绝对路径
 * @param {object} [opts]
 * @param {string} [opts.hint]     素材名/场景关键词，用于采样率分级
 * @param {boolean} [opts.keepOriginal=true] 是否保留原文件（保留则返回 originalUrl）
 * @returns {Promise<{ok:boolean, filePath:string, filename:string, url:string, size:number,
 *                    compressed:boolean, originalPath?:string, originalUrl?:string,
 *                    originalSize?:number, ratio?:number, reason?:string}>}
 */
async function storeSound(filePath, opts = {}) {
  const keepOriginal = opts.keepOriginal !== false;
  const baseName = path.basename(filePath);
  const originalSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

  // 非 WAV 或已是压缩格式 → 原样保留
  if (!/\.wav$/i.test(baseName)) {
    return {
      ok: true, compressed: false, filePath, filename: baseName,
      url: '/uploads/character-templates/sounds/' + baseName,
      size: originalSize, reason: '非 WAV，跳过压缩',
    };
  }

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    return {
      ok: false, compressed: false, filePath, filename: baseName, size: originalSize,
      reason: '读取失败：' + e.message,
    };
  }

  const rate = audioCompress.suggestSampleRate(baseName, opts.hint);
  const r = await audioCompress.compressAudio(buf, { sampleRate: rate });

  if (!r.ok) {
    // 无收益 / 解码失败 → 保留原文件，不阻断
    return {
      ok: true, compressed: false, filePath, filename: baseName,
      url: '/uploads/character-templates/sounds/' + baseName,
      size: originalSize, reason: r.reason,
    };
  }

  // 压缩成功：写 .mp3，删原 WAV（保留则改名存到 .origin/）
  const mp3Name = baseName.replace(/\.wav$/i, '.mp3');
  const mp3Path = path.join(SOUNDS_DIR, mp3Name);
  try {
    fs.writeFileSync(mp3Path, r.buffer);
  } catch (e) {
    return {
      ok: true, compressed: false, filePath, filename: baseName,
      url: '/uploads/character-templates/sounds/' + baseName,
      size: originalSize, reason: '压缩文件写入失败：' + e.message,
    };
  }

  let originalPath = null;
  let originalUrl = null;
  if (keepOriginal) {
    // 原件挪到 .origin/ 子目录：不在扫描白名单里，不会被资产清单列出来
    const originDir = path.join(SOUNDS_DIR, '.origin');
    try {
      fs.mkdirSync(originDir, { recursive: true });
      originalPath = path.join(originDir, baseName);
      fs.renameSync(filePath, originalPath);
      originalUrl = '/uploads/character-templates/sounds/.origin/' + baseName;
    } catch (e) {
      // 挪不动就留在原地（资产清单会多列一条，但不影响使用）
      originalPath = filePath;
      originalUrl = '/uploads/character-templates/sounds/' + baseName;
    }
  } else {
    try { fs.unlinkSync(filePath); } catch (e) { /* 已删或不存在 */ }
  }

  return {
    ok: true, compressed: true,
    filePath: mp3Path, filename: mp3Name,
    url: '/uploads/character-templates/sounds/' + mp3Name,
    size: r.buffer.length,
    originalPath, originalUrl,
    originalSize,
    ratio: Number(r.ratio.toFixed(2)),
    sampleRate: r.sampleRate,
    bitrate: r.bitrate,
  };
}

/**
 * 从内存 buffer 直接落盘并压缩（编辑器「另存为」走这条，不先落临时文件）。
 * @param {Buffer} buffer 音频内容
 * @param {string} originalName 原始文件名（决定扩展名与采样率分级）
 * @param {object} [opts]
 */
async function storeBuffer(buffer, originalName, opts = {}) {
  const ext = path.extname(String(originalName || '')).toLowerCase() || '.wav';
  const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const tmpName = 'sound-' + suffix + ext;
  const tmpPath = path.join(SOUNDS_DIR, tmpName);

  try {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    fs.writeFileSync(tmpPath, buffer);
  } catch (e) {
    return { ok: false, error: '写入失败：' + e.message };
  }

  const r = await storeSound(tmpPath, opts);
  if (!r.ok) {
    // 落盘失败的话把临时文件清掉
    try { fs.unlinkSync(tmpPath); } catch (e) { /* 忽略 */ }
    return r;
  }
  return r;
}

module.exports = { storeSound, storeBuffer, SOUNDS_DIR, ALREADY_COMPRESSED };
