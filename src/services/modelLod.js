/**
 * modelLod.js — 模型 LOD 三版（中模/低模）生成服务
 *
 * 规格（冻结，见《LOD三版模型方案-开发规划与规范.md》第 2 节）：
 *   基准名 = 生效文件名去掉末尾的 _dec.glb 或 .glb
 *   中模   = 基准名 + '_mid.glb'（gltfpack -si 0.25）
 *   低模   = 基准名 + '_lod.glb'（gltfpack -si 0.01 -sa 激进简化，2026-09-12 二期收尾决策）
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
const { stripVariantTextures } = require('./glbTextureStripper');

const MID_RATIO = '0.25';
// 低模激进简化（2026-09-12 二期收尾实验，用户决策「方案 1 全量改」）：
// 红军族 _dec 已二次减面到 ~8k 面，无 -sa 时 gltfpack 拓扑下限 ~3900 面（-si 0.05~0.005 实测完全不变）；
// 加 -sa（aggressive）后实测 8099→28 面 / 7599→29 面（0.3~0.4%），包围盒保留、未退化。
// -sa 模式下 -si 比例值不再影响结果（0.01 与 0.005 输出相同），取 0.01 即可。
const LOW_RATIO = '0.01';
const LOW_EXTRA_ARGS = ['-sa'];
const MIN_SOURCE_TRIS = 5000;   // 源模型面数下限（低于此值不做 LOD）
// 输出面数下限（低于此值判无效）。低模改 -sa 激进简化后实测 ~28~29 面（2026-09-12），
// 旧值 300 会把激进低模误杀（too-few-tris），按用户「100 面量级也要」的决策放宽到 16；
// 中模输出数千面，不受此值影响。
const MIN_OUTPUT_TRIS = 16;
const MID_SUFFIX = '_mid.glb';
const LOW_SUFFIX = '_lod.glb';
// 低模收益余量：低模面数 ≥ 中模 × MARGIN 即判无效、不落盘。
//
// ⚠️ 必须保持 1（2026-09-11 阶段 5 用户决策，曾试过 0.95 后回退）：
//   曾按「16/104 件低模与中模几乎等面（≥95%），落盘纯属浪费磁盘」加了 +5% 余量并清理了这 16 个文件，
//   但实测代价不可接受 —— 前端 `worldInstanceMerger_v2.js` 的远界是
//   `farLimit = (lodOn && lowReady) ? 400 : 200`，**低模文件缺失会直接把该组远界从 400m 回落到 200m**，
//   200~400m 的实例不再渲染、只由蓝方块表示（规范 2.3 表格口径：低模未生成时回退蓝色占位方块）。
//   实测受影响 16 个合批组 / 381 个实例（红军群主力：72、54、36×3、18×9 …）。
//   → 结论：**低模文件存在本身就是 200~400m 带能否显示几何的开关**，
//     即使面数收益≈0 也必须生成；省磁盘要另想办法（二期「LOD 复用高模贴图」）。
const LOW_BENEFIT_MARGIN = 1;
// 低模被收益闸门判无效后留下的标记文件：证明「这件产物的低模已判定无意义」，
// 使 scanStatus 不再把它算作「待生成」（否则后台永远显示待生成、点一键生成也清不掉）
const LOW_SKIP_SUFFIX = '_lod.skip.json';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'models', 'uploaded');
const MAX_WALK_DEPTH = 3;

let gltfpackUnavailableWarned = false;

/** 字节数格式化（日志用） */
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)}${units[i]}`;
}

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
        // ⚠️ glTF 规范字段是 pr.indices（复数）。曾误写 pr.index（单数）导致永远取不到，
        // 静默回退 POSITION/3 —— 对带索引的模型会低估面数数倍
        //（实测教室「女生3」：索引 4,499,166/3=150 万面 vs POSITION/3=29.9 万，差 5 倍）。
        // 2026-09-13 教室热点排查时修正。
        const idx = pr.indices !== undefined && accessors[pr.indices] ? accessors[pr.indices].count : 0;
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

/** 低模「已判定无收益」标记文件路径（与 lowPath 同目录同基准名） */
function lowSkipPath(lowPath) {
  return String(lowPath || '').replace(/\.glb$/i, '') + '.skip.json';
}

/** 以「变体基准名」为唯一身份的分组键：X.glb 与 X_dec.glb 共享同一组 _mid/_lod */
function _variantKey(absPath) {
  const p = lodPaths(absPath);
  return (path.dirname(absPath) + '|' + p.base).toLowerCase();
}

/** 中/低模文件本身不可作为生成源 */
function _isVariantSource(absPath) {
  return new RegExp(`(_mid|_lod)\\.glb$`, 'i').test(absPath || '');
}

/**
 * 生成源解析（规范 2.2：「生成源 = 实际生效的文件，有 _dec 版时从 _dec 派生，保证与高模同源」）
 *
 * 背景（阶段 5 全量转换定位）：减面后原始 .glb 仍留在磁盘（供 restore 还原），
 * 而 lodPaths 对 `X.glb` 与 `X_dec.glb` 推出的是**同一组** _mid/_lod 路径 →
 * 谁先被处理谁就决定了变体的源。scanStatus 里「数据库行(生效) + 磁盘孤儿(原文件)」并存时
 * 会命中此歧义（实测 20 组原文件排在 _dec 之前），故在此收敛：只要同名 _dec.glb 存在就用它。
 * @returns {string} 实际用于生成的绝对路径
 */
function resolveLodSource(absPath) {
  if (!absPath || typeof absPath !== 'string') return absPath;
  if (/_dec\.glb$/i.test(absPath)) return absPath;
  const decPath = absPath.replace(/\.glb$/i, '_dec.glb');
  if (decPath !== absPath && fs.existsSync(decPath)) return decPath;
  return absPath;
}

async function _safeUnlink(p) {
  try { await fs.promises.unlink(p); } catch (_) { /* ignore */ }
}

/**
 * 生成单个变体（先写 .tmp.glb，校验通过再 rename 覆盖目标，失败清理 tmp）
 * @param {object|null} [benefitRef] 收益参照（如低模须小于中模）：{ tris, label }
 * @param {string[]} [extraArgs] 传给 gltfpack 的追加参数（低模 ['-sa']）
 * @returns {Promise<{status:'generated'|'exists'|'failed', path:string, tris?:number, ratio?:number, reason?:string, error?:string}>}
 */
async function _generateOne(srcPath, dstPath, ratio, sourceTris, force, benefitRef, extraArgs) {
  if (fs.existsSync(dstPath) && !force) {
    // 幂等补剥：存量变体（贴图剥离上线前生成）在再次触发生成时补一次剥离（已剥过的幂等跳过）
    const fixup = await stripVariantTextures(dstPath, { sourcePath: srcPath });
    if (fixup.ok) console.log(`[modelLod] 变体贴图补剥 ${path.basename(dstPath)}: ${fmtBytes(fixup.saved)}`);
    return { status: 'exists', path: dstPath, tris: countTrisExact(dstPath) };
  }
  const tmpPath = dstPath + '.tmp.glb';
  try {
    await _safeUnlink(tmpPath);
    await runPack(srcPath, tmpPath, ratio, extraArgs);

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
    if (benefitRef && benefitRef.tris > 0 && outTris >= benefitRef.tris * (benefitRef.margin || 1)) {
      await _safeUnlink(tmpPath);
      return {
        status: 'failed', path: dstPath, reason: `no-benefit-vs-${benefitRef.label}`,
        tris: outTris, refTris: benefitRef.tris,
      };
    }
    // 二期「变体复用高模贴图」：变体文件只留几何，贴图由前端按节点名借用高模材质。
    // 剥离失败（闸门拦截/解析失败）不影响变体落盘，只是该变体多带一份贴图。
    const stripped = await stripVariantTextures(tmpPath, { sourcePath: srcPath });
    if (stripped.ok) console.log(`[modelLod] 变体贴图已剥离 ${path.basename(dstPath)}: ${fmtBytes(stripped.saved)}`);
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

    // 规范 2.2：有名同名的 _dec.glb 时以它为准（原文件可能只是留作 restore 的历史副本）
    const srcPath = resolveLodSource(absPath);
    const sourceTris = countTrisExact(srcPath);
    const base = lodPaths(absPath);
    const head = { ...empty, base: base.base, sourceTris, sourceUsed: srcPath };

    if (sourceTris <= 0) return { ...head, skipped: true, reason: 'not-glb-or-empty' };
    if (sourceTris < MIN_SOURCE_TRIS) return { ...head, skipped: true, reason: 'low-poly-source' };

    // 先中模，再以中模面数作为低模的收益参照（低模必须真的比中模更轻，否则不落盘）
    const variants = {};
    variants.mid = await _generateOne(srcPath, base.midPath, MID_RATIO, sourceTris, force);
    const midTris = (variants.mid.status === 'generated' || variants.mid.status === 'exists')
      ? (variants.mid.tris || countTrisExact(base.midPath))
      : 0;
    variants.low = await _generateOne(
      srcPath, base.lowPath, LOW_RATIO, sourceTris, force,
      midTris > 0 ? { tris: midTris, label: 'mid', margin: LOW_BENEFIT_MARGIN } : null,
      LOW_EXTRA_ARGS
    );
    // 低模「已判定无收益」标记：落盘成功则清除标记；被收益闸门拦下则留下标记；
    // 其它失败原因（error / too-few-tris / not-reduced / no-output）不写标记 ——
    // 那些是可能恢复的失败，应继续算作「待生成」以便重试。
    const skipPath = lowSkipPath(base.lowPath);
    if (variants.low.status === 'generated' || variants.low.status === 'exists') {
      await _safeUnlink(skipPath);
    } else if (String(variants.low.reason || '').startsWith('no-benefit-vs-')) {
      try {
        await fs.promises.writeFile(skipPath, JSON.stringify({
          reason: variants.low.reason, midTris, lowTris: variants.low.tris || 0,
          source: path.basename(srcPath), at: new Date().toISOString(),
        }), 'utf8');
      } catch (_) { /* 标记写失败不影响主流程，只影响状态显示 */ }
    }
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

/**
 * 数据库 path 列（/models/uploaded/x.glb）→ 绝对路径
 *
 * ⚠️ 不能用 path.isAbsolute 判断：Windows 下 `path.isAbsolute('/models/x.glb')` 返回 **true**，
 * 会让 web 路径被当成文件系统绝对路径原样返回 → existsSync 必然失败 →
 * 数据库里所有模型都会被误判成「源文件缺失」（阶段 5 实测 missingSource=113 假数字，
 * 数据库那半边统计形同死代码）。只有真正的盘符路径 / UNC 才原样使用。
 */
function _absFromDbPath(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') return null;
  if (/^[a-zA-Z]:[\\/]/.test(dbPath) || /^\\\\/.test(dbPath) || /^\/\//.test(dbPath)) return dbPath;
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
 *
 * 统计口径（2026-09-11 阶段 5 用户确认修正）：
 *   1. 以「变体基准名」为唯一身份 —— `X.glb` 与 `X_dec.glb` 共享同一组 `_mid/_lod`，算**一件产物**
 *      （旧版按文件计数：后台「模型总数」显示 264，实际只有 118 件）；
 *   2. 每件产物取**生效源** = 优先 `_dec.glb`（规范 2.2），无 `_dec` 时取数据库登记的那条，最后取磁盘文件；
 *   3. `pending`（待生成）= 还能做的工作 —— 中模缺失，或低模缺失且**未被收益闸门判过无效**
 *      （后者的标记文件 `_lod.skip.json` 由 generateLodVariants 写入）。
 *      旧版把「低模判无效」的模型永久算作待生成，后台会一直显示待生成且点一键生成清不掉。
 *
 * @returns {Promise<object>} { ok, dbError, total, midCount, lowCount, pending, lowPolySkipped,
 *                             lowBenefitSkipped, superseded, missingSource, models, pendingList }
 */
async function scanStatus() {
  const entries = [];
  const seen = new Set();
  const push = (absPath, name, id) => {
    const key = absPath.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ id: id || null, name, absPath });
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

  // 按变体基准名聚合（同一件产物的多个入口只算一件）
  const groups = new Map();
  entries.forEach((e) => {
    const key = _variantKey(e.absPath);
    let g = groups.get(key);
    if (!g) { g = { key, entries: [] }; groups.set(key, g); }
    g.entries.push(e);
  });

  let midCount = 0;
  let lowCount = 0;
  let pending = 0;
  let lowPolySkipped = 0;
  let lowBenefitSkipped = 0;
  let superseded = 0;
  let missingSource = 0;
  const pendingList = [];
  const list = [];

  groups.forEach((g) => {
    // 生效入口：_dec.glb 优先 → 数据库登记的那条 → 磁盘文件
    const decEntry = g.entries.find((e) => /_dec\.glb$/i.test(e.absPath));
    const dbEntry = g.entries.find((e) => e.id);
    const eff = decEntry || dbEntry || g.entries[0];
    superseded += g.entries.length - 1;

    const srcPath = resolveLodSource(eff.absPath);
    const { midPath, lowPath } = lodPaths(eff.absPath);
    const hasSource = fs.existsSync(srcPath);
    const hasMid = fs.existsSync(midPath);
    const hasLow = fs.existsSync(lowPath);
    const hasLowSkip = fs.existsSync(lowSkipPath(lowPath));
    if (hasMid) midCount += 1;
    if (hasLow) lowCount += 1;

    let sourceTris = null;
    let isPending = false;
    let notEligible = false;

    if (!hasSource) {
      missingSource += 1;
    } else {
      // 低模缺失但已被收益闸门判无效 → 不是待生成（否则永远清不掉）
      const lowUnresolved = !hasLow && !hasLowSkip;
      if (!hasMid || lowUnresolved) {
        sourceTris = countTrisExact(srcPath);
        if (sourceTris < MIN_SOURCE_TRIS) {
          lowPolySkipped += 1;
          notEligible = true;
        } else {
          isPending = true;
          pending += 1;
          pendingList.push({ absPath: eff.absPath, name: eff.name });
        }
      }
    }

    list.push({
      id: eff.id, name: eff.name, absPath: eff.absPath, sourcePath: srcPath,
      aliases: g.entries.length, hasSource, hasMid, hasLow, hasLowSkip,
      sourceTris, pending: isPending, notEligible,
    });
  });

  lowBenefitSkipped = list.filter((m) => m.hasLowSkip && !m.hasLow).length;

  return {
    ok: true,
    dbError,
    dir: UPLOAD_DIR,
    total: groups.size,
    superseded,
    lowBenefitSkipped,
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
  lowSkipPath,
  resolveLodSource,
  generateLodVariants,
  scanStatus,
  batchGenerateMissing,
  countTrisExact,
  MID_RATIO,
  LOW_RATIO,
  LOW_EXTRA_ARGS,
  LOW_BENEFIT_MARGIN,
  MIN_SOURCE_TRIS,
  MIN_OUTPUT_TRIS,
  MID_SUFFIX,
  LOW_SUFFIX,
  LOW_SKIP_SUFFIX,
  UPLOAD_DIR,
};
