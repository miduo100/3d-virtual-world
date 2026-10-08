/**
 * 多文件资源包上传（bundle）—— OBJ/glTF 多文件模型入库
 *
 * 背景：glTF/OBJ 是多文件格式（.gltf+.bin+共享贴图 / .obj+.mtl+贴图），单文件上传
 * 接口 /api/upload-model 无法携带引用文件。本模块提供两种入库方式：
 *   1. POST /api/upload-model-bundle —— 文件夹上传（前端 webkitdirectory 逐文件 +
 *      relPaths 相对路径数组），完整保留目录结构落盘；
 *   2. POST /api/upload-model-zip —— 整包 zip 上传，服务器解压（逐条目 getData 落盘，
 *      天然免疫 zip-slip；拒绝相对路径逃逸与隐藏文件）。
 *
 * 入库语义（ingestBundle）：
 *   - 落盘到 public/models/uploaded/bundle-<ts>/，相对路径原样保留；
 *   - 扫描主文件（.gltf/.obj/.glb，排除 _mid/_lod 变体名）→ 每个主文件一条
 *     uploaded_models 记录（path 指向包内文件，世界端现有 obj/gltf/glb 加载分支直接可用）；
 *   - glTF 主文件做引用完整性检查（buffers/images uri 缺失记 warnings，不阻断）；
 *   - 后处理：外置纹理压缩（nativeModelPipeline.compressExternalTextures）+
 *     glTF 变体生成（generateGltfVariants）；GLB 主文件复用 modelLod.generateLodVariants；
 *     OBJ 变体 = 二期（phase2）。
 *
 * 鉴权：与既有 /api/upload-model 保持一致（无鉴权）；限额：单文件 100MB / 总量 500MB / 800 文件。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const { pool } = require('../database/db');
const {
  generateGltfVariants,
  compressExternalTextures,
  listFilesRecursive,
} = require('../services/nativeModelPipeline');
const { generateLodVariants } = require('../services/modelLod');

const UPLOAD_ROOT = path.join(__dirname, '../../public/models/uploaded');
const TMP_DIR = path.join(UPLOAD_ROOT, '_tmp_bundle_upload');
const MAX_FILES = 800;
const MAX_FILE_BYTES = 100 * 1024 * 1024;   // 单文件 100MB（与 /api/upload-model 一致）
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;  // 整包 500MB
const PRIMARY_EXTS = new Set(['.gltf', '.obj', '.glb']);
const ALLOWED_EXTS = new Set(['.gltf', '.obj', '.glb', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.mtl']);
const VARIANT_RE = /_(mid|lod)\.(gltf|glb|obj)$/i;

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try { await fsp.mkdir(TMP_DIR, { recursive: true }); cb(null, TMP_DIR); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
    cb(null, `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const uploadBundle = multer({ storage, limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

/** 相对路径清洗：拒绝绝对路径/盘符/.. 逃逸；返回 / 分隔的安全相对路径或 null */
function sanitizeRel(raw) {
  if (!raw) return null;
  const p = String(raw).replace(/\\/g, '/').trim();
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const segs = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    segs.push(seg.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
  }
  if (!segs.length) return null;
  return segs.join('/');
}

/** glTF 引用完整性检查：返回缺失 uri 列表（空数组=引用齐全） */
function checkGltfRefs(absGltfPath) {
  let json;
  try { json = JSON.parse(fs.readFileSync(absGltfPath, 'utf8')); } catch (e) {
    return ['JSON 解析失败: ' + String(e.message || e).slice(0, 80)];
  }
  const missing = [];
  const dir = path.dirname(absGltfPath);
  const uris = [];
  for (const b of json.buffers || []) if (b && typeof b.uri === 'string') uris.push(b.uri);
  for (const im of json.images || []) if (im && typeof im.uri === 'string') uris.push(im.uri);
  for (const u of uris) {
    if (/^(data|https?):/i.test(u)) continue;
    try {
      if (!fs.existsSync(path.resolve(dir, decodeURIComponent(u)))) missing.push(u);
    } catch { missing.push(u); }
  }
  return missing;
}

/**
 * 公共入库：扫描 bundleDir → 逐主文件入库 → 纹理压缩 + 变体生成
 *
 * @param {string} bundleName  bundle 目录名（相对 UPLOAD_ROOT）
 * @param {object} [opts]
 *   target            'model'（默认，进 3D 资产库） | 'part'（进零件库）
 *                     'part' 时写 part_category='part'，pack_id 由调用方在
 *                     归类阶段（partLibraryRegistrar）回填。
 *   compressTextures  是否压缩外置纹理（默认 true）。Kenney 的 colormap 是共享
 *                     图集，palette 量化会出色带 → 零件库通常传 false。
 *   variants          是否生成 LOD 变体（默认 true）。零件面数普遍低于
 *                     modelLod.MIN_SOURCE_TRIS=5000，本来也会跳过 → 可传 false 省时间。
 *   libraryName       target='part' 时的库名（用于派生 pack_key）
 * @returns {Promise<object>} 入库结果
 */
async function ingestBundle(bundleName, opts = {}) {
  const target = opts.target === 'part' ? 'part' : 'model';
  const doCompress = opts.compressTextures !== false;
  const doVariants = opts.variants !== false;
  const bundleDir = path.join(UPLOAD_ROOT, bundleName);
  const rels = await listFilesRecursive(bundleDir);
  const allowed = [];
  const skippedOther = [];
  for (const rel of rels) {
    (ALLOWED_EXTS.has(path.extname(rel).toLowerCase()) ? allowed : skippedOther).push(rel);
  }

  const primaries = allowed.filter((rel) => {
    const ext = path.extname(rel).toLowerCase();
    return PRIMARY_EXTS.has(ext) && !VARIANT_RE.test(rel);
  });

  const models = [];
  for (const rel of primaries) {
    const abs = path.join(bundleDir, rel);
    const ext = path.extname(rel).toLowerCase().replace('.', '');
    let fileSize = 0;
    try { fileSize = (await fsp.stat(abs)).size; } catch { /* ignore */ }
    const displayName = path.basename(rel).replace(/\.[^.]+$/, '');
    const warnings = ext === 'gltf' ? checkGltfRefs(abs) : [];

    // 落库（target='part' 时标记为零件，pack_id 稍后由归类阶段回填）
    const insert = await pool.query(
      `INSERT INTO uploaded_models
       (file_name, saved_file_name, path, file_type, file_size, display_name, description, part_category, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [path.basename(rel), rel, `/models/uploaded/${bundleName}/${rel}`, ext, fileSize, displayName, null, target]
    );

    const rec = {
      id: insert.rows[0].id,
      name: displayName,
      path: `/models/uploaded/${bundleName}/${rel}`,
      fileType: ext,
      fileSize,
      warnings,
      variants: null,
    };

    // 变体生成（失败自动跳过，绝不阻断入库）
    if (doVariants) {
      try {
        if (ext === 'gltf') {
          rec.variants = await generateGltfVariants(abs);
      } else if (ext === 'glb') {
        const r = await generateLodVariants(abs);
        rec.variants = r && r.variants ? { mid: r.variants.mid, low: r.variants.low, sourceTris: r.sourceTris } : r;
      } else if (ext === 'obj') {
        rec.variants = { ok: false, skipped: true, reason: 'obj-phase2' };
      }
      } catch (e) {
        rec.variants = { ok: false, skipped: true, reason: 'error', error: String(e.message || e).slice(0, 120) };
      }
    }
    models.push(rec);
  }

  // 外置纹理压缩（整目录级；失败不阻断；doCompress=false 时跳过）
  let textureCompression = null;
  if (doCompress) {
    try { textureCompression = await compressExternalTextures(bundleDir); }
    catch (e) { textureCompression = { error: String(e.message || e).slice(0, 120) }; }
  } else {
    textureCompression = { skipped: true, reason: 'disabled-by-caller' };
  }

  return {
    bundleName, target, modelCount: models.length, models,
    skippedOther, textureCompression,
  };
}

/**
 * 落盘后的统一收尾：入库（ingestBundle）+ target='part' 时再建库归类。
 *
 * 上传通道与扫描通道都调它，保证「交互与流程完全一致，唯一区别是数据流向」：
 *   target='model' → 只入库（3D 资产库）
 *   target='part'  → 入库 + 建 part_libraries + 归类 part_library_items（零件库）
 *
 * @param {string} bundleName
 * @param {'model'|'part'} target
 * @param {object} opts  { sourceRef, libraryName, compressTextures, variants, status, licenseInfo }
 */
async function finalizeBundle(bundleName, target, opts = {}) {
  const ingestOpts = {
    target,
    compressTextures: opts.compressTextures,
    variants: opts.variants,
  };
  const ing = await ingestBundle(bundleName, ingestOpts);
  if (target !== 'part') {
    return { ...ing, library: null };
  }
  // 懒 require：仅零件库通道才加载归类器，避免默认通道的额外开销
  const { registerBundle } = require('../services/partLibraryRegistrar');
  const library = await registerBundle({
    bundleName,
    uploadRoot: UPLOAD_ROOT,
    sourceRef: opts.sourceRef || opts.libraryName || bundleName,
    // 扫描通道会传来源目录绝对路径；上传通道没有（同一文件夹重传靠 bundleName 兜底幂等）
    sourcePath: opts.sourcePath || null,
    licenseInfo: opts.licenseInfo || null,
    styleFamily: opts.styleFamily || null,
    sourceType: 'external_kit',
    status: opts.status || 'active',
  });
  return { ...ing, library, renamed: !!library.renamed };
}

/** 从请求体解析 target（缺省 model，保证既有前端行为不变） */
function readTarget(req) {
  const t = String((req.body && req.body.target) || '').toLowerCase();
  return t === 'part' ? 'part' : 'model';
}

/** 从请求体解析归类/入库选项 */
function readIngestOpts(req) {
  const b = req.body || {};
  const bool = (v, dft) => (v === undefined || v === '' ? dft : (v === true || v === 'true' || v === 1 || v === '1'));
  return {
    sourceRef: b.sourceRef || b.libraryName || null,
    libraryName: b.libraryName || null,
    styleFamily: b.styleFamily || null,
    licenseInfo: b.license ? (() => { try { return JSON.parse(b.license); } catch (e) { return null; } })() : null,
    compressTextures: bool(b.compressTextures, true),
    variants: bool(b.variants, true),
    status: b.status === 'pending_review' ? 'pending_review' : 'active',
  };
}

/**
 * POST /api/upload-model-bundle —— 文件夹上传
 * form-data: files[]（多文件）+ relPaths（JSON 字符串数组，与 files 顺序一一对应）
 *          + target（'model' 默认 | 'part' 零件库）
 */
router.post('/upload-model-bundle', uploadBundle.array('files', MAX_FILES), async (req, res) => {
  const tmpFiles = [];
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '请上传文件' });
    let relPaths;
    try {
      relPaths = typeof req.body.relPaths === 'string' ? JSON.parse(req.body.relPaths) : req.body.relPaths;
    } catch { return res.status(400).json({ error: 'relPaths 不是合法 JSON' }); }
    if (!Array.isArray(relPaths) || relPaths.length !== files.length) {
      return res.status(400).json({ error: `relPaths(${Array.isArray(relPaths) ? relPaths.length : 'null'}) 与文件数(${files.length})不一致` });
    }
    const cleaned = [];
    for (let i = 0; i < relPaths.length; i++) {
      const c = sanitizeRel(relPaths[i]);
      if (!c) return res.status(400).json({ error: `非法路径: ${relPaths[i]}` });
      cleaned.push(c);
    }
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      return res.status(400).json({ error: `整包 ${(total / 1048576).toFixed(1)}MB 超过上限 500MB` });
    }

    const bundleName = 'bundle-' + Date.now();
    const bundleDir = path.join(UPLOAD_ROOT, bundleName);
    await fsp.mkdir(bundleDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      tmpFiles.push(files[i].path);
      // 安全修复 S2-04c：落盘前按扩展名白名单过滤。
      // 此前只做 sanitizeRel（防 zip-slip），.html/.js/.svg 会被写进同源可达的
      // public/models/uploaded/bundle-<ts>/ → 直接构成存储型 XSS。
      if (!ALLOWED_EXTS.has(path.extname(cleaned[i]).toLowerCase())) {
        await fsp.unlink(files[i].path).catch(() => {});
        continue;
      }
      const dest = path.join(bundleDir, cleaned[i]);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(files[i].path, dest);
      await fsp.unlink(files[i].path).catch(() => {});
    }
    const target = readTarget(req);
    const ingestOpts = readIngestOpts(req);
    const result = await finalizeBundle(bundleName, target, ingestOpts);
    res.json({
      success: true,
      target,
      message: target === 'part'
        ? `已导入 ${result.modelCount} 个零件到零件库`
        : `已导入 ${result.modelCount} 个模型`,
      ...result,
    });
  } catch (error) {
    for (const p of tmpFiles) await fsp.unlink(p).catch(() => {});
    console.error('❌ bundle 上传失败:', error);
    res.status(500).json({ error: 'bundle 上传失败', details: String(error.message || error).slice(0, 200) });
  }
});

/**
 * POST /api/upload-model-zip —— 整包 zip 上传
 * form-data: file（单个 .zip）
 */
router.post('/upload-model-zip', uploadBundle.single('file'), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: '请上传 .zip 文件' });
    if (!/\.zip$/i.test(f.originalname || '')) {
      await fsp.unlink(f.path).catch(() => {});
      return res.status(400).json({ error: '仅支持 .zip 压缩包' });
    }
    const bundleName = 'bundle-' + Date.now();
    const bundleDir = path.join(UPLOAD_ROOT, bundleName);
    await fsp.mkdir(bundleDir, { recursive: true });

    try {
      const zip = new AdmZip(f.path);
      let total = 0, count = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const rel = sanitizeRel(entry.entryName);
        if (!rel) continue; // 非法路径（zip-slip / 绝对路径）→ 跳过
        if (rel.split('/').some((s) => s === '__MACOSX' || s.startsWith('.'))) continue; // macOS 垃圾/隐藏文件
        // 安全修复 S2-04c：扩展名白名单（.html/.js/.svg 等脚本类文件绝不落盘到同源目录）
        if (!ALLOWED_EXTS.has(path.extname(rel).toLowerCase())) continue;
        total += entry.header.size;
        if (total > MAX_TOTAL_BYTES) throw new Error('解压后总量超过 500MB 上限');
        if (++count > MAX_FILES) throw new Error(`文件数超过 ${MAX_FILES} 上限`);
        const dest = path.join(bundleDir, rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, entry.getData());
      }
      if (count === 0) {
        await fsp.rm(bundleDir, { recursive: true, force: true });
        await fsp.unlink(f.path).catch(() => {});
        return res.status(400).json({ error: '压缩包内没有可用文件' });
      }
    } catch (e) {
      await fsp.rm(bundleDir, { recursive: true, force: true }).catch(() => {});
      await fsp.unlink(f.path).catch(() => {});
      const msg = String(e.message || e);
      const status = msg.includes('上限') ? 400 : 500;
      return res.status(status).json({ error: 'zip 解压失败', details: msg.slice(0, 200) });
    }

    await fsp.unlink(f.path).catch(() => {});
    const target = readTarget(req);
    const ingestOpts = readIngestOpts(req);
    const result = await finalizeBundle(bundleName, target, ingestOpts);
    res.json({
      success: true,
      target,
      message: target === 'part'
        ? `已导入 ${result.modelCount} 个零件到零件库`
        : `已导入 ${result.modelCount} 个模型`,
      ...result,
    });
  } catch (error) {
    if (req.file) await fsp.unlink(req.file.path).catch(() => {});
    console.error('❌ zip 上传失败:', error);
    res.status(500).json({ error: 'zip 上传失败', details: String(error.message || error).slice(0, 200) });
  }
});

module.exports = router;

// 供服务器目录扫描通道（src/routes/assetLibrary.js）复用：
// 扫描 = 复制落盘 → finalizeBundle，与浏览器上传走完全相同的入库路径。
module.exports.ingestBundle = ingestBundle;
module.exports.finalizeBundle = finalizeBundle;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.MAX_FILES = MAX_FILES;
module.exports.MAX_TOTAL_BYTES = MAX_TOTAL_BYTES;
