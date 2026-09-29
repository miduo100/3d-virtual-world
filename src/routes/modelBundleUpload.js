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

/** 公共入库：扫描 bundleDir → 逐主文件入库 → 纹理压缩 + 变体生成 */
async function ingestBundle(bundleName) {
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

    const insert = await pool.query(
      `INSERT INTO uploaded_models
       (file_name, saved_file_name, path, file_type, file_size, display_name, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [path.basename(rel), rel, `/models/uploaded/${bundleName}/${rel}`, ext, fileSize, displayName, null]
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
    models.push(rec);
  }

  // 外置纹理压缩（整目录级；失败不阻断）
  let textureCompression = null;
  try { textureCompression = await compressExternalTextures(bundleDir); }
  catch (e) { textureCompression = { error: String(e.message || e).slice(0, 120) }; }

  return { bundleName, modelCount: models.length, models, skippedOther, textureCompression };
}

/**
 * POST /api/upload-model-bundle —— 文件夹上传
 * form-data: files[]（多文件）+ relPaths（JSON 字符串数组，与 files 顺序一一对应）
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
    const result = await ingestBundle(bundleName);
    res.json({ success: true, message: `已导入 ${result.modelCount} 个模型`, ...result });
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
    const result = await ingestBundle(bundleName);
    res.json({ success: true, message: `已导入 ${result.modelCount} 个模型`, ...result });
  } catch (error) {
    if (req.file) await fsp.unlink(req.file.path).catch(() => {});
    console.error('❌ zip 上传失败:', error);
    res.status(500).json({ error: 'zip 上传失败', details: String(error.message || error).slice(0, 200) });
  }
});

module.exports = router;
