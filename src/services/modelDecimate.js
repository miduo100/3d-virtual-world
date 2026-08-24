/**
 * modelDecimate.js — 上传/管理 3D 模型自动减面服务
 *
 * 用途：用 gltfpack -si 简化大面数 GLB 模型，输出 xxx_dec.glb 新文件，原始文件保留（可随时还原）
 * 阈值：auto 模式 >15 万面 才减；on 强制减；off 完全跳过
 * 分级：15-50 万面 -si 0.3 | 50-100 万面 -si 0.15 | >100 万面 -si 0.08
 * 安全：输出为空/面数未减少 → 清理输出、保留原文件；任何失败都不抛错阻断上传
 * 注意：不使用 -sn（平滑法线），它会拆分顶点导致 POSITION accessor 计数失真，干扰面数校验
 */
const path = require('path');
const fs = require('fs');

const TRI_THRESHOLD = 50000; // auto 模式减面阈值（5 万面，大量复制的场景模型默认都减）
const DEC_SUFFIX = '_dec.glb';

let gltfpackModule = null;
let gltfpackFailed = false;

function _getGltfpack() {
  if (gltfpackModule) return gltfpackModule;
  if (gltfpackFailed) return null;
  try {
    gltfpackModule = require('gltfpack');
    return gltfpackModule;
  } catch (e) {
    gltfpackFailed = true;
    console.warn('[modelDecimate] gltfpack 不可用，跳过减面:', e.message);
    return null;
  }
}

/** 统计 GLB 三角面数（POSITION accessor count/3，与 decimate_redarmy_models.js 一致） */
function countTris(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return 0; // 'glTF'
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    let total = 0;
    (json.meshes || []).forEach((m) => {
      (m.primitives || []).forEach((pr) => {
        const pi = pr.attributes && pr.attributes.POSITION;
        if (pi !== undefined) total += Math.floor(json.accessors[pi].count / 3);
      });
    });
    return total;
  } catch (e) {
    return 0;
  }
}

/** 依据面数选择简化比例（目标约 8-15 万面） */
function _pickRatio(tris) {
  if (tris > 1000000) return '0.08';
  if (tris > 500000) return '0.15';
  return '0.3';
}

/** 用 gltfpack 文件接口执行减面（参数与已验证的 decimate_redarmy_models.js 一致） */
async function _runPack(src, dst, ratio) {
  const gp = _getGltfpack();
  if (!gp) throw new Error('gltfpack 不可用');
  const iface = {
    read: (p) => fs.readFileSync(p),
    write: (p, d) => fs.writeFileSync(p, d),
  };
  return gp.pack(['-i', src, '-o', dst, '-si', ratio, '-kn', '-km'], iface);
}

/**
 * 对 GLB 执行减面（幂等：dec 文件已存在则直接跳过）
 * @param {string} absPath 原始 .glb 绝对路径
 * @param {object} [opts]
 * @param {string} [opts.mode] 'auto'(默认，>15 万面才减) | 'on'(强制减) | 'off'(跳过)
 * @returns {Promise<object>}
 *   { decimated:true, decimatedPath, origTris, newTris, ratio } — 减面成功
 *   { decimated:false, skipped:true, reason, ... } — 跳过（format/already/exists/low-poly/...）
 */
async function decimateIfNeeded(absPath, { mode = 'auto' } = {}) {
  const decPath = absPath.replace(/\.glb$/i, DEC_SUFFIX);
  try {
    if (mode === 'off') return { decimated: false, skipped: true, reason: 'off' };
    if (path.extname(absPath).toLowerCase() !== '.glb') {
      return { decimated: false, skipped: true, reason: 'format' };
    }
    if (absPath.endsWith(DEC_SUFFIX)) {
      return { decimated: false, skipped: true, reason: 'already-decimated' };
    }
    if (!fs.existsSync(absPath)) {
      return { decimated: false, skipped: true, reason: 'not-found' };
    }
    // 幂等：dec 输出已存在（可能是之前减过面/手动生成的）
    if (fs.existsSync(decPath)) {
      return { decimated: true, decimatedPath: decPath, origTris: countTris(absPath), newTris: countTris(decPath), ratio: null, reason: 'exists' };
    }

    const origTris = countTris(absPath);
    if (origTris <= 0) return { decimated: false, skipped: true, reason: 'not-glb-or-empty' };
    if (mode !== 'on' && origTris < TRI_THRESHOLD) {
      return { decimated: false, skipped: true, reason: 'low-poly', origTris };
    }

    const ratio = _pickRatio(origTris);
    const log = await _runPack(absPath, decPath, ratio);
    if (!fs.existsSync(decPath)) {
      console.warn('[modelDecimate] 减面无输出，保留原文件:', absPath, log);
      return { decimated: false, skipped: true, reason: 'no-output' };
    }

    const newTris = countTris(decPath);
    if (newTris <= 0 || newTris >= origTris) {
      // 输出无效或未变小 → 清理输出，保留原文件
      await fs.promises.unlink(decPath).catch(() => {});
      console.warn(`[modelDecimate] 减面未生效(${origTris}->${newTris})，已回退原文件:`, absPath);
      return { decimated: false, skipped: true, reason: 'not-reduced', origTris, newTris };
    }

    return { decimated: true, decimatedPath: decPath, origTris, newTris, ratio: +(newTris / origTris).toFixed(3) };
  } catch (e) {
    await fs.promises.unlink(decPath).catch(() => {});
    console.warn('[modelDecimate] 减面失败，保留原文件:', absPath, e.message);
    return { decimated: false, skipped: true, reason: 'error', error: e.message };
  }
}

module.exports = { decimateIfNeeded, countTris, TRI_THRESHOLD, DEC_SUFFIX };
