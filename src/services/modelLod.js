/**
 * modelLod.js — 模型 LOD 三版（中模/低模）生成服务
 *
 * 规格（冻结，见《LOD三版模型方案-开发规划与规范.md》第 2 节）：
 *   基准名 = 生效文件名去掉末尾的 _dec.glb 或 .glb
 *   中模   = 基准名 + '_mid.glb'（gltfpack -si 0.25）
 *   低模   = 基准名 + '_lod.glb'（gltfpack -si 0.1）
 *   源模型面数 < 5000 → 不生成；输出面数 < 300 或未小于源 → 判无效并清理
 *   收益闸门：低模面数 ≥ 中模面数 → 判无效（reason: no-benefit-vs-mid），不落盘
 *   幂等：已存在的中/低模文件直接跳过（force=true 才重做）
 *   不删除/不覆盖任何原始 .glb 或 _dec.glb
 *
 * 达成率说明（2026-09-11 实测，5 个真实样本）：
 *   gltfpack 的 -si 是「目标比例」而非保证值，受网格拓扑（边界/薄片）限制会提前停止。
 *   实测 -si 0.25 → 13.3%~36.9%，-si 0.1 → 12.3%~21.0%（-si 0.05 也仍有卡在 21% 的模型）；
 *   -km 对达成率无影响，-sa 仅对部分模型有效。
 *   故对外口径为「相对达成」：中模 < 源 且 ≤40%，低模 < 中模 且 ≤22%。
 *
 * 约束：任何失败都不得抛异常阻断主流程；失败路径不留垃圾文件（先写 .tmp.glb 再原子 rename）
 */
const path = require('path');
const fs = require('fs');
const { runPack } = require('./modelDecimate');

const MID_RATIO = '0.25';
const LOW_RATIO = '0.1';
const MIN_SOURCE_TRIS = 5000;   // 源模型面数下限（低于此值不做 LOD）
const MIN_OUTPUT_TRIS = 300;    // 输出面数下限（低于此值判无效）
const MID_SUFFIX = '_mid.glb';
const LOW_SUFFIX = '_lod.glb';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'models', 'uploaded');
const MAX_WALK_DEPTH = 3;

let gltfpackUnavailableWarned = false;

/**
 * 统计 GLB 三角面数（只读文件头部 JSON chunk，不加载 BIN，避免大文件整读）
 * 优先用 index accessor.count/3；无索引时退化为 POSITION.count/3
 * @returns {number} 面数，解析失败返回 0
 */
function countTrisExact(absPath) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return 0;
    if (head.readUInt32LE(0) !== 0x46546c67) return 0; // 'glTF'
    const jsonLen = head.readUInt32LE(12);
    if (jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) return 0;
    const jsonBuf = Buffer.alloc(jsonLen);
    const read = fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
    if (read < 8) return 0;
    const json = JSON.parse(jsonBuf.toString('utf8').replace(/[\s\u0000]+$/, ''));
    const accessors = json.accessors || [];
    let total = 0;
    (json.meshes || []).forEach((m) => {
      (m.primitives || []).forEach((pr) => {
        const idx = pr.index !== undefined && accessors[pr.index] ? accessors[pr.index].count : 0;
        const pos = pr.attributes && pr.attributes.POSITION !== undefined && accessors[pr.attributes.POSITION]
          ? accessors[pr.attributes.POSITION].count
          : 0;
        if (idx > 0) total += Math.floor(idx / 3);
        else if (pos > 0) total += Math.floor(pos / 3);
      });
    });
    return total;
  } catch (e) {
    return 0;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

/** 基准名 + 中/低模路径推导（前后端必须一致的规则） */
function lodPaths(absPath) {
  const dir = path.dirname(absPath || '');
  const name = path.basename(absPath || '');
  let base = name.replace(/_dec\.glb$/i, '');
  if (base === name) base = name.replace(/\.glb$/i, '');
  return { base, midPath: path.join(dir, base + MID_SUFFIX), lowPath: path.join(dir, base + LOW_SUFFIX) };
}

/** 中/低模文件本身不可作为生成源 */
function _isVariantSource(absPath) {
  return new RegExp(`(_mid|_lod)\\.glb$`, 'i').test(absPath || '');
}

async function _safeUnlink(p) {
  try { await fs.promises.unlink(p); } catch (_) { /* ignore */ }
}

/**
 * 生成单个变体（先写 .tmp.glb，校验通过再 rename 覆盖目标，失败清理 tmp）
 * @param {object|null} [benefitRef] 收益参照（如低模须小于中模）：{ tris, label }
 * @returns {Promise<{status:'generated'|'exists'|'failed', path:string, tris?:number, ratio?:number, reason?:string, error?:string}>}
 */
async function _generateOne(srcPath, dstPath, ratio, sourceTris, force, benefitRef) {
  if (fs.existsSync(dstPath) && !force) {
    return { status: 'exists', path: dstPath, tris: countTrisExact(dstPath) };
  }
  const tmpPath = dstPath + '.tmp.glb';
  try {
    await _safeUnlink(tmpPath);
    await runPack(srcPath, tmpPath, ratio);

    if (!fs.existsSync(tmpPath)) {
      return { status: 'failed', path: dstPath, reason: 'no-output' };
    }
    const outTris = countTrisExact(tmpPath);
    if (outTris < MIN_OUTPUT_TRIS) {
      await _safeUnlink(tmpPath);
      return { status: 'failed', path: dstPath, reason: 'too-few-tris', tris: outTris };
    }
    if (outTris >= sourceTris) {
      await _safeUnlink(tmpPath);
      return { status: 'failed', path: dstPath, reason: 'not-reduced', tris: outTris };
    }
    if (benefitRef && benefitRef.tris > 0 && outTris >= benefitRef.tris) {
      await _safeUnlink(tmpPath);
      return {
        status: 'failed', path: dstPath, reason: `no-benefit-vs-${benefitRef.label}`,
        tris: outTris, refTris: benefitRef.tris,
      };
    }
    await fs.promises.rename(tmpPath, dstPath);
    return { status: 'generated', path: dstPath, tris: outTris, ratio: +(outTris / sourceTris).toFixed(3) };
  } catch (e) {
    await _safeUnlink(tmpPath);
    if (/gltfpack 不可用/.test(e.message) && !gltfpackUnavailableWarned) {
      gltfpackUnavailableWarned = true;
      console.warn('[modelLod] gltfpack 不可用，LOD 生成已跳过');
    }
    return { status: 'failed', path: dstPath, reason: 'error', error: e.message };
  }
}

/**
 * 幂等生成中/低模两个变体（绝不抛异常）
 * @param {string} absPath 生效模型文件的绝对路径（原文件或 _dec.glb）
 * @param {object} [opts]
 * @param {boolean} [opts.force] 已存在时是否重做（默认 false）
 * @returns {Promise<object>}
 *   { ok, skipped, reason?, source, base, sourceTris, variants:{mid,low} }
 *   skipped 时的 reason：bad-path / format / not-found / lod-variant-source / not-glb-or-empty / low-poly-source / error
 */
async function generateLodVariants(absPath, { force = false } = {}) {
  const empty = { ok: false, skipped: false, source: absPath || null, base: null, sourceTris: 0, variants: {} };
  try {
    if (!absPath || typeof absPath !== 'string') return { ...empty, skipped: true, reason: 'bad-path' };
    if (path.extname(absPath).toLowerCase() !== '.glb') return { ...empty, skipped: true, reason: 'format' };
    if (!fs.existsSync(absPath)) return { ...empty, skipped: true, reason: 'not-found' };
    if (_isVariantSource(absPath)) return { ...empty, skipped: true, reason: 'lod-variant-source' };

    const sourceTris = countTrisExact(absPath);
    const base = lodPaths(absPath);
    const head = { ...empty, base: base.base, sourceTris };

    if (sourceTris <= 0) return { ...head, skipped: true, reason: 'not-glb-or-empty' };
    if (sourceTris < MIN_SOURCE_TRIS) return { ...head, skipped: true, reason: 'low-poly-source' };

    // 先中模，再以中模面数作为低模的收益参照（低模必须真的比中模更轻，否则不落盘）
    const variants = {};
    variants.mid = await _generateOne(absPath, base.midPath, MID_RATIO, sourceTris, force);
    const midTris = (variants.mid.status === 'generated' || variants.mid.status === 'exists')
      ? (variants.mid.tris || countTrisExact(base.midPath))
      : 0;
    variants.low = await _generateOne(
      absPath, base.lowPath, LOW_RATIO, sourceTris, force,
      midTris > 0 ? { tris: midTris, label: 'mid' } : null
    );
    const okStatus = ['generated', 'exists'];
    return {
      ...head,
      ok: okStatus.includes(variants.mid.status) || okStatus.includes(variants.low.status),
      variants,
    };
  } catch (e) {
    return { ...empty, skipped: true, reason: 'error', error: e.message };
  }
}

/** 数据库 path 列（/models/uploaded/x.glb）→ 绝对路径 */
function _absFromDbPath(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') return null;
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.join(PUBLIC_DIR, dbPath.replace(/^[\\/]+/, ''));
}

/** 递归收集上传目录下的高模 .glb（跳过备份目录与中/低模文件） */
function _walkGlb(dir, depth, out) {
  if (depth > MAX_WALK_DEPTH) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/^_?backup/i.test(ent.name)) return;
      _walkGlb(full, depth + 1, out);
    } else if (/\.glb$/i.test(ent.name) && !new RegExp(`(_mid|_lod)\\.glb$`, 'i').test(ent.name) && !/\.tmp\.glb$/i.test(ent.name)) {
      out.push(full);
    }
  });
  return out;
}

/**
 * 扫描 uploaded_models + 磁盘，统计中低模覆盖情况
 * @returns {Promise<object>} { ok, dbError, total, midCount, lowCount, pending, lowPolySkipped, missingSource, models, pendingList }
 */
async function scanStatus() {
  const models = [];
  const seen = new Set();
  const push = (absPath, name, id) => {
    const key = absPath.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push({ id: id || null, name, absPath });
  };

  let dbError = null;
  try {
    const { query } = require('../database/db');
    const res = await query(
      `SELECT id, file_name, saved_file_name, path FROM uploaded_models
       WHERE LOWER(file_type) = 'glb' ORDER BY id DESC`
    );
    res.rows.forEach((row) => {
      const abs = _absFromDbPath(row.path);
      if (!abs) return;
      push(abs, row.saved_file_name || row.file_name || path.basename(abs), row.id);
    });
  } catch (e) {
    dbError = e.message;
    console.warn('[modelLod] scanStatus 读取数据库失败（仅按磁盘统计）:', e.message);
  }

  _walkGlb(UPLOAD_DIR, 0, []).forEach((abs) => push(abs, path.basename(abs), null));

  let midCount = 0;
  let lowCount = 0;
  let pending = 0;
  let lowPolySkipped = 0;
  let missingSource = 0;
  const pendingList = [];
  const list = [];

  models.forEach((m) => {
    const { midPath, lowPath } = lodPaths(m.absPath);
    const hasSource = fs.existsSync(m.absPath);
    const hasMid = fs.existsSync(midPath);
    const hasLow = fs.existsSync(lowPath);
    if (hasMid) midCount += 1;
    if (hasLow) lowCount += 1;

    let sourceTris = null;
    let isPending = false;
    let notEligible = false;

    if (!hasSource) {
      missingSource += 1;
    } else {
      if (!hasMid || !hasLow) {
        sourceTris = countTrisExact(m.absPath);
        if (sourceTris < MIN_SOURCE_TRIS) {
          lowPolySkipped += 1;
          notEligible = true;
        } else {
          isPending = true;
          pending += 1;
          pendingList.push({ absPath: m.absPath, name: m.name });
        }
      }
    }

    list.push({ ...m, hasSource, hasMid, hasLow, sourceTris, pending: isPending, notEligible });
  });

  return {
    ok: true,
    dbError,
    dir: UPLOAD_DIR,
    total: models.length,
    midCount,
    lowCount,
    pending,
    lowPolySkipped,
    missingSource,
    models: list,
    pendingList,
  };
}

/**
 * 批量补齐待生成模型（单个失败跳过，不中断）
 * @param {object} [opts]
 * @param {number} [opts.limit] 本批最多处理多少个（默认 3）
 * @returns {Promise<object>} { ok, total, pendingBefore, processed, succeeded, failed, remaining, results }
 */
async function batchGenerateMissing({ limit = 3 } = {}) {
  const status = await scanStatus();
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
  const batch = status.pendingList.slice(0, n);
  const results = [];
  let succeeded = 0;

  for (const item of batch) {
    const r = await generateLodVariants(item.absPath);
    const ok = !!r.ok;
    if (ok) succeeded += 1;
    results.push({
      name: item.name,
      absPath: item.absPath,
      ok,
      skipped: !!r.skipped,
      reason: r.reason || null,
      sourceTris: r.sourceTris,
      mid: r.variants && r.variants.mid ? r.variants.mid.status : null,
      low: r.variants && r.variants.low ? r.variants.low.status : null,
    });
  }

  return {
    ok: true,
    total: status.total,
    pendingBefore: status.pending,
    processed: batch.length,
    succeeded,
    failed: batch.length - succeeded,
    remaining: Math.max(0, status.pending - succeeded),
    results,
  };
}

module.exports = {
  lodPaths,
  generateLodVariants,
  scanStatus,
  batchGenerateMissing,
  countTrisExact,
  MID_RATIO,
  LOW_RATIO,
  MIN_SOURCE_TRIS,
  MIN_OUTPUT_TRIS,
  MID_SUFFIX,
  LOW_SUFFIX,
  UPLOAD_DIR,
};
