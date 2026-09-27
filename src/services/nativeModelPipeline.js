/**
 * 原生（非 GLB）模型管线 v1 —— glTF 变体生成 + 外置纹理压缩
 *
 * 背景：多文件资源包（bundle）上传后，GLB 主文件走既有 modelLod 管线；
 *       glTF 原生格式此前没有减面/压缩/LOD 能力。本模块补齐 glTF 部分（用户决策：
 *       一期只做 glTF、不做格式转换，OBJ 二期）：
 *
 *   1. glTF 变体：gltfpack 原生支持 .gltf 进出 —— 输出 .gltf + 外置 .bin，
 *      贴图 URI 保持指向包内共享贴图（零内联零复制），与"不转换、保原格式"决策一致。
 *      命名沿用 GLB 同款约定：<base>_mid.gltf / <base>_lod.gltf。
 *   2. 外置纹理压缩：对 bundle 目录内图片【原地重编码（文件名不变）】，引用自动生效；
 *      glTF / OBJ（二期）共用。法线/遮蔽类（按文件名启发式）无损重编码不降分辨率。
 *
 * 边界：
 *   - glbTextureStripper（变体贴图剥离）不适用于 .gltf —— 共享贴图本来就是外置的。
 *   - 所有失败路径不抛异常阻断上传；半成品（gltf/bin）一律清理。
 *   - gltfpack 输出 .gltf 时 buffer 写成 <输出名>.bin —— 生成到临时名后统一
 *     finalize（改写 buffer uri 再改名），避免中间态 uri 失配。
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const sharp = require('sharp');
const { runPack } = require('./modelDecimate');

// ---- 与 modelLod 对齐的常量 ----
const MID_RATIO_CAP = 0.25;          // 中模比例上限（modelLod MID_RATIO 同款）
const MID_TARGET_FACES = 50000;      // 中模绝对面数上限（modelLod 同款）
const LOW_TARGET_FACES = 100;        // 低模 ≤100 面标准（modelLod 同款）
const LOW_MAX_PASSES = 4;            // -sa 迭代上限（modelLod 同款）
const MIN_SOURCE_TRIS = 2000;        // 低于此面数不生成变体（低多边形模型无收益）
const TEX_MARKER = '.texopt-done.json';
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
// 文件名命中 → 法线/遮蔽类贴图：仅无损重编码（不降分辨率不量化）
const LOSSLESS_NAME_RE = /normal|_n\.|_n-|_ddn|occlusion|_occ|_ao[._-]|bump|roughness|metallic/i;

/** 递归列文件（返回相对路径，跳过点开头文件/目录） */
async function listFilesRecursive(dir) {
  const out = [];
  async function walk(rel) {
    const abs = rel ? path.join(dir, rel) : dir;
    let items;
    try { items = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) await walk(r);
      else out.push(r);
    }
  }
  await walk('');
  return out;
}

/**
 * 统计 .gltf 三角面数（JSON 级，与 modelLod.countTrisExact 同口径）。
 * mode 缺省/4=三角形；5/6=条带/扇形(count-2)。解析失败返回 0。
 */
function countGltfTris(absGltfPath) {
  try {
    const json = JSON.parse(fs.readFileSync(absGltfPath, 'utf8'));
    const accessors = json.accessors || [];
    let total = 0;
    for (const mesh of json.meshes || []) {
      for (const prim of mesh.primitives || []) {
        const mode = prim.mode === undefined ? 4 : prim.mode;
        if (mode !== 4 && mode !== 5 && mode !== 6) continue;
        let n = 0;
        if (prim.indices !== undefined && accessors[prim.indices]) {
          n = accessors[prim.indices].count || 0;
        } else if (prim.attributes && prim.attributes.POSITION !== undefined && accessors[prim.attributes.POSITION]) {
          n = accessors[prim.attributes.POSITION].count || 0;
        }
        if (mode === 4) total += Math.floor(n / 3);
        else total += Math.max(0, n - 2);
      }
    }
    return total;
  } catch { return 0; }
}

function _binPathFor(gltfPath) { return gltfPath.replace(/\.gltf$/i, '.bin'); }

async function _safeUnlink(p) { try { await fsp.unlink(p); } catch { /* ignore */ } }

/** 清理一个 gltf 变体的全部产物（gltf + bin + 临时 pass 文件） */
async function _cleanupVariant(dstGltf) {
  const stem = dstGltf.replace(/\.gltf$/i, '');
  await _safeUnlink(dstGltf);
  await _safeUnlink(_binPathFor(dstGltf));
  for (const p of [stem + '.tmp1.gltf', stem + '.tmp1.bin', stem + '.tmp2.gltf', stem + '.tmp2.bin']) {
    await _safeUnlink(p);
  }
}

/**
 * finalize：把临时输出（tmp.gltf + 同名 .bin）落成最终名。
 * gltfpack 输出 .gltf 时 buffer uri 指向 <输出名>.bin —— 改名后 uri 会失配，
 * 这里统一改写 buffers[].uri 再改名。
 */
async function _finalizeGltf(tmpGltf, dstGltf) {
  const json = JSON.parse(await fsp.readFile(tmpGltf, 'utf8'));
  const tmpDir = path.dirname(tmpGltf);
  const dstDir = path.dirname(dstGltf);
  const dstBase = path.basename(dstGltf).replace(/\.gltf$/i, '');
  const moves = [];
  (json.buffers || []).forEach((b, i) => {
    if (!b || typeof b.uri !== 'string' || /^[a-z]+:/i.test(b.uri)) return;
    const newName = dstBase + (i > 0 ? `.${i}` : '') + '.bin';
    const oldAbs = path.resolve(tmpDir, decodeURIComponent(b.uri));
    moves.push([oldAbs, path.join(dstDir, newName)]);
    b.uri = newName;
  });
  await fsp.writeFile(dstGltf, JSON.stringify(json));
  for (const [from, to] of moves) {
    if (fs.existsSync(from)) await fsp.rename(from, to).catch(() => {});
  }
  await _safeUnlink(tmpGltf);
  await _safeUnlink(_binPathFor(tmpGltf));
  return { json };
}

/**
 * 贴图 URI 对齐：gltfpack 可能复制/改名贴图。目标是让输出 .gltf 的
 * images[].uri 全部指向包内【原有】共享贴图（同名优先），并删除 gltfpack 新造的副本。
 * @param {string[]} sourceUris 源 gltf 的贴图 uri 列表（源与变体同目录，相对 uri 直接有效）
 * @param {Set<string>} preFiles 生成前目录内已有文件（相对路径，/ 分隔）
 */
async function _fixupGltfImageUris(dstGltf, sourceUris, preFiles) {
  let json;
  try { json = JSON.parse(await fsp.readFile(dstGltf, 'utf8')); } catch { return { fixed: 0, removed: 0 }; }
  const imgs = json.images || [];
  if (!imgs.length) return { fixed: 0, removed: 0 };
  const dir = path.dirname(dstGltf);
  let fixed = 0, removed = 0;
  // 可用源贴图（按文件名索引）
  const byBase = new Map();
  for (const u of sourceUris || []) {
    try {
      if (fs.existsSync(path.resolve(dir, decodeURIComponent(u)))) {
        const k = path.basename(decodeURIComponent(u)).toLowerCase();
        if (!byBase.has(k)) byBase.set(k, u);
      }
    } catch { /* ignore */ }
  }
  for (let i = 0; i < imgs.length; i++) {
    const uri = imgs[i] && typeof imgs[i].uri === 'string' ? imgs[i].uri : null;
    if (!uri || /^(data|https?):/i.test(uri)) continue;
    let abs = null;
    try { abs = path.resolve(dir, decodeURIComponent(uri)); } catch { continue; }
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const existedBefore = preFiles.has(rel);
    if (existedBefore) continue; // 已是包内原有文件 → 保持
    // gltfpack 新造的文件：优先指回源贴图（按序 → 按名）
    let target = null;
    if (sourceUris && sourceUris[i] && byBase.has(path.basename(decodeURIComponent(sourceUris[i])).toLowerCase())) {
      target = sourceUris[i];
    } else {
      const cand = byBase.get(path.basename(decodeURIComponent(uri)).toLowerCase());
      if (cand) target = cand;
    }
    if (target && target !== uri) {
      if (IMAGE_EXTS.has(path.extname(abs).toLowerCase())) { await _safeUnlink(abs); removed++; }
      imgs[i].uri = target; fixed++;
    }
  }
  if (fixed) { try { await fsp.writeFile(dstGltf, JSON.stringify(json)); } catch { /* ignore */ } }
  return { fixed, removed };
}

/** 单个变体生成（mid 用）：tmp 生成 → finalize → 校验 → 修 URI */
async function _genVariant(src, dst, ratio, extraArgs, sourceTris, sourceUris, preFiles) {
  const tmp = dst.replace(/\.gltf$/i, '.tmp1.gltf');
  await _cleanupVariant(dst);
  try {
    await runPack(src, tmp, ratio.toFixed(6), extraArgs || []);
  } catch (e) {
    await _cleanupVariant(dst);
    return { status: 'failed', reason: 'pack-error', error: String(e.message || e).slice(0, 120) };
  }
  if (!fs.existsSync(tmp)) { await _cleanupVariant(dst); return { status: 'failed', reason: 'no-output' }; }
  await _finalizeGltf(tmp, dst);
  const tris = countGltfTris(dst);
  if (tris <= 0 || tris >= sourceTris) {
    await _cleanupVariant(dst);
    return { status: 'failed', reason: 'not-reduced', tris };
  }
  const fx = await _fixupGltfImageUris(dst, sourceUris, preFiles);
  return { status: 'generated', path: dst, tris, fixedUris: fx.fixed, removedCopies: fx.removed };
}

/** 低模生成：pass1 定向比例 + 迭代 -sa 直到 ≤100 面或触底（modelLod._generateLow 同思路） */
async function _genLow(src, dst, sourceTris, sourceUris, preFiles) {
  const stem = dst.replace(/\.gltf$/i, '');
  const tmp = stem + '.tmp1.gltf';
  const tmp2 = stem + '.tmp2.gltf';
  await _cleanupVariant(dst);
  try {
    const r1 = Math.min(0.01, LOW_TARGET_FACES / Math.max(sourceTris, 1));
    await runPack(src, tmp, r1.toFixed(6), ['-sa']);
    if (!fs.existsSync(tmp)) { await _cleanupVariant(dst); return { status: 'failed', reason: 'no-output' }; }
    let tris = countGltfTris(tmp);
    let cur = tmp;
    for (let pass = 2; pass <= LOW_MAX_PASSES && tris > LOW_TARGET_FACES; pass++) {
      const before = tris;
      const next = (cur === tmp) ? tmp2 : tmp;
      try { await runPack(cur, next, '0.0001', ['-sa']); } catch { break; }
      if (!fs.existsSync(next)) break;
      const t2 = countGltfTris(next);
      if (t2 <= 0 || t2 >= before * 0.95) {
        await _safeUnlink(next); await _safeUnlink(_binPathFor(next));
        break;
      }
      cur = next; tris = t2;
    }
    if (tris >= sourceTris) { await _cleanupVariant(dst); return { status: 'failed', reason: 'not-reduced', tris }; }
    await _finalizeGltf(cur, dst);
    // 清理落选的中间产物
    const other = (cur === tmp) ? tmp2 : tmp;
    await _safeUnlink(other); await _safeUnlink(_binPathFor(other));
    const fx = await _fixupGltfImageUris(dst, sourceUris, preFiles);
    return { status: 'generated', path: dst, tris, fixedUris: fx.fixed, removedCopies: fx.removed };
  } catch (e) {
    await _cleanupVariant(dst);
    return { status: 'failed', reason: 'error', error: String(e.message || e).slice(0, 120) };
  }
}

/**
 * 为一个 .gltf 生成 _mid/_lod 变体（幂等：变体已存在且 !force 直接返回 exists）。
 * @returns {Promise<object>} { ok, skipped?, sourceTris, mid:{status,tris,path,...}, low:{...} }
 */
async function generateGltfVariants(absGltfPath, opts = {}) {
  const force = !!opts.force;
  try {
    if (!/\.gltf$/i.test(absGltfPath)) return { ok: false, skipped: true, reason: 'format' };
    const base = path.basename(absGltfPath).replace(/\.gltf$/i, '');
    if (/_(mid|lod)$/i.test(base)) return { ok: false, skipped: true, reason: 'is-variant' };
    if (!fs.existsSync(absGltfPath)) return { ok: false, skipped: true, reason: 'not-found' };
    const sourceTris = countGltfTris(absGltfPath);
    if (sourceTris <= 0) return { ok: false, skipped: true, reason: 'no-tris' };
    if (sourceTris < MIN_SOURCE_TRIS) return { ok: false, skipped: true, reason: 'low-poly', sourceTris };

    const srcDir = path.dirname(absGltfPath);
    const preFiles = new Set((await listFilesRecursive(srcDir)).map((r) => r.replace(/\\/g, '/')));
    let sourceUris = [];
    try {
      const sj = JSON.parse(await fsp.readFile(absGltfPath, 'utf8'));
      sourceUris = (sj.images || []).map((im) => (im && typeof im.uri === 'string') ? im.uri : null).filter(Boolean);
    } catch { /* ignore */ }

    const midPath = path.join(srcDir, base + '_mid.gltf');
    const lowPath = path.join(srcDir, base + '_lod.gltf');
    const midRatio = Math.min(MID_RATIO_CAP, MID_TARGET_FACES / sourceTris);
    const mid = await _genVariant(absGltfPath, midPath, midRatio, [], sourceTris, sourceUris, preFiles);
    const low = await _genLow(absGltfPath, lowPath, sourceTris, sourceUris, preFiles);

    // 收益闸门：低模必须优于中模，否则丢弃低模（回退链会落到中模）
    const midTris = mid.tris || 0, lowTris = low.tris || 0;
    if (low.status === 'generated' && midTris > 0 && lowTris >= midTris) {
      await _cleanupVariant(lowPath);
      low.status = 'failed'; low.reason = 'not-better-than-mid'; delete low.tris;
    }
    const anyFail = (mid.status === 'failed') && (low.status === 'failed');
    return { ok: !anyFail, sourceTris, mid, low };
  } catch (e) {
    return { ok: false, skipped: true, reason: 'error', error: String(e.message || e).slice(0, 120) };
  }
}

/**
 * 外置纹理压缩：目录内图片原地重编码（文件名不变 → 所有 gltf/obj 引用自动生效）。
 * 策略（与 GLB 纹理压缩同口径）：
 *   - 文件名命中法线/遮蔽启发式 → 仅无损重编码（PNG compressionLevel 9 effort 10），
 *     不降分辨率不量化；非 PNG 的法线类直接跳过。
 *   - 其余：降分辨率 maxDim 2048（不放大）+ PNG palette q80 / JPEG mozjpeg q80 / WebP q80。
 *   - 输出 ≥ 原大小则保留原文件。
 *   - 幂等：完成后写 <dir>/.texopt-done.json 标记，重跑直接跳过（--force 可重压）。
 */
async function compressExternalTextures(dir, opts = {}) {
  const maxDim = opts.maxDim || 2048;
  const marker = path.join(dir, TEX_MARKER);
  if (!opts.force && fs.existsSync(marker)) {
    try {
      const prev = JSON.parse(await fsp.readFile(marker, 'utf8'));
      return { skipped: true, ...prev };
    } catch { /* 标记坏了就重压 */ }
  }
  const rels = await listFilesRecursive(dir);
  let processed = 0, savedBytes = 0;
  const skipped = [];
  for (const rel of rels) {
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const abs = path.join(dir, rel);
    let before = 0;
    try { before = (await fsp.stat(abs)).size; } catch { continue; }
    try {
      const lossless = LOSSLESS_NAME_RE.test(path.basename(rel));
      if (lossless && ext !== '.png') { skipped.push({ file: rel, reason: 'lossless-name-non-png' }); continue; }
      let pipe = sharp(abs);
      if (lossless) {
        pipe = pipe.png({ compressionLevel: 9, effort: 10, palette: false });
      } else {
        const meta = await sharp(abs).metadata();
        if ((meta.width || 0) > maxDim || (meta.height || 0) > maxDim) {
          pipe = pipe.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
        }
        if (ext === '.png') pipe = pipe.png({ palette: true, quality: 80 });
        else if (ext === '.webp') pipe = pipe.webp({ quality: 80 });
        else pipe = pipe.jpeg({ quality: 80, mozjpeg: true });
      }
      const out = await pipe.toBuffer();
      if (out.length < before) {
        const tmp = abs + '.tmp';
        await fsp.writeFile(tmp, out);
        await fsp.rename(tmp, abs);
        savedBytes += before - out.length;
        processed++;
      } else {
        skipped.push({ file: rel, reason: 'no-gain' });
      }
    } catch (e) {
      skipped.push({ file: rel, reason: String(e.message || e).slice(0, 80) });
    }
  }
  const stats = { processed, savedBytes, skippedCount: skipped.length };
  try { await fsp.writeFile(marker, JSON.stringify(stats, null, 2)); } catch { /* ignore */ }
  return { ...stats, skipped };
}

module.exports = {
  generateGltfVariants,
  compressExternalTextures,
  countGltfTris,
  listFilesRecursive,
  MID_TARGET_FACES,
  LOW_TARGET_FACES,
  MIN_SOURCE_TRIS,
};
