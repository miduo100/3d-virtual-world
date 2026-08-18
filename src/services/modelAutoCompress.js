/**
 * modelAutoCompress.js — 上传3D模型自动压缩服务
 *
 * 用途：gltfpack 压缩上传的大尺寸 GLB 模型（-cc 几何meshopt压缩 + -ke/-kn 保留extras与命名节点）
 * 阈值：>10MB 且 .glb 才压缩；OBJ/MTL/ZIP 解压的 OBJ 一律跳过
 * 安全：输出为空/未变小 → 保留原文件；压缩失败 → 清理临时文件、保留原文件、绝不抛错阻断上传
 * 使用 gltfpack 内存接口（require('gltfpack')），跨平台，无 spawn 依赖
 */
const path = require('path');
const fs = require('fs');

const COMPRESS_THRESHOLD = 10 * 1024 * 1024; // 10MB
// gltfpack 0.24 无 -tw（WebP）选项；-tc（KTX2）需 r128 不支持的 KTX2Loader，故仅做几何 meshopt 压缩
const GLTFPACK_ARGS = ['-cc', '-ke', '-kn'];

let gltfpackModule = null;
let gltfpackFailed = false;

/** 获取 gltfpack 库（node 环境下 require 时自动 init wasm） */
function _getGltfpack() {
  if (gltfpackFailed) return null;
  if (!gltfpackModule) {
    try {
      gltfpackModule = require('gltfpack');
    } catch (e) {
      gltfpackFailed = true;
      console.warn('[modelAutoCompress] gltfpack 不可用，跳过压缩:', e.message);
      return null;
    }
  }
  return gltfpackModule;
}

/**
 * 压缩指定 GLB 文件（原地原子替换）
 * @param {string} absPath 文件绝对路径
 * @param {number} [originalSize] 已知的原始大小（如上传接口的 req.file.size），可避免重复 stat
 * @returns {Promise<object>}
 *   { compressed:true,  originalSize, compressedSize, ratio }
 *   { compressed:false, skipped:true, reason, error? }
 */
async function compressIfNeeded(absPath, originalSize) {
  try {
    // 1) 格式过滤：仅 .glb（.gltf 需改写外部 .bin 引用，易出错且目标场景均为 GLB，跳过）
    const ext = path.extname(absPath).toLowerCase();
    if (ext !== '.glb') {
      return { compressed: false, skipped: true, reason: 'format' };
    }

    // 2) 大小阈值
    const size = (originalSize !== undefined && originalSize !== null)
      ? originalSize
      : fs.statSync(absPath).size;
    if (size < COMPRESS_THRESHOLD) {
      return { compressed: false, skipped: true, reason: 'size' };
    }

    // 3) 压缩
    const gp = _getGltfpack();
    if (!gp) {
      return { compressed: false, skipped: true, reason: 'no-gltfpack' };
    }

    const inputKey = 'input.glb';
    const outputKey = 'output.glb';
    const originalBuf = await fs.promises.readFile(absPath);
    let outputBuf = null;

    const iface = {
      read(p) {
        if (p === inputKey) return new Uint8Array(originalBuf);
        throw new Error('unknown read path: ' + p);
      },
      write(p, data) {
        if (p === outputKey) outputBuf = Buffer.from(data);
      },
    };

    await gp.pack(['-i', inputKey, '-o', outputKey].concat(GLTFPACK_ARGS), iface);

    // 4) 校验：输出为空或未变小 → 保留原文件
    if (!outputBuf || outputBuf.length === 0) {
      return { compressed: false, skipped: true, reason: 'empty-output' };
    }
    if (outputBuf.length >= originalBuf.length) {
      return { compressed: false, skipped: true, reason: 'not-smaller' };
    }

    // 5) 原子替换：先写 .tmp 再 rename（Windows 上 rename 可覆盖目标）
    const tmpPath = absPath + '.compress.tmp';
    await fs.promises.writeFile(tmpPath, outputBuf);
    await fs.promises.rename(tmpPath, absPath);

    return {
      compressed: true,
      originalSize: originalBuf.length,
      compressedSize: outputBuf.length,
      ratio: outputBuf.length / originalBuf.length,
    };
  } catch (e) {
    // 失败回退：清理临时文件、保留原文件、绝不阻断
    try {
      const tmpPath = absPath + '.compress.tmp';
      if (fs.existsSync(tmpPath)) await fs.promises.unlink(tmpPath);
    } catch (_) { /* ignore */ }
    console.warn('[modelAutoCompress] 压缩失败，保留原文件:', absPath, e.message);
    return { compressed: false, skipped: true, reason: 'error', error: e.message };
  }
}

module.exports = { compressIfNeeded, COMPRESS_THRESHOLD };
