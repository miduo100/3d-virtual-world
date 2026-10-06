/**
 * 服务器目录扫描通道（Phase 1）
 *
 * 与浏览器上传通道**完全对称**：交互、流程、结果结构一致，唯一区别是数据流向。
 *   浏览器上传：<input webkitdirectory> → POST /api/upload-model-bundle ┐
 *   服务器扫描：填服务器本地目录       → POST /api/asset-library/scan   ┘→ 同一个 finalizeBundle
 *
 * target='model' → 3D 资产库（part_category='model'）
 * target='part'  → 零件库（建 part_libraries + 归类 part_library_items）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const { authenticateAdminToken } = require('../middleware/adminAuth');
const assetPathKit = require('../services/assetPathKit');
const classifier = require('../services/partClassifier');
const bundleRouter = require('./modelBundleUpload');

const router = express.Router();
const UPLOAD_ROOT = bundleRouter.UPLOAD_ROOT
  || path.join(__dirname, '../../public/models/uploaded');
const finalizeBundle = bundleRouter.finalizeBundle;
const MAX_FILES = bundleRouter.MAX_FILES || 800;
const MAX_TOTAL_BYTES = bundleRouter.MAX_TOTAL_BYTES || (500 * 1024 * 1024);

// 与既有上传接口保持同一权限级别
router.use(authenticateAdminToken);

function readTarget(req) {
  // 兼容两种调用：传 Express req（读 req.body.target）或直接传已取出的 body。
  // ⚠️ 此前只读 req.body.target，而 POST /scan 里调用的是 readTarget(body) ——
  //    body.body 为 undefined → target 恒为 'model'，扫描通道永远进不了零件库
  //    （零件库建的 part_libraries / part_library_items 全是空的，库列表恒 0）。
  const b = req && req.body !== undefined ? req.body : req;
  const t = String((b && b.target) || '').toLowerCase();
  return t === 'part' ? 'part' : 'model';
}
function readBool(v, dft) {
  if (v === undefined || v === null || v === '') return dft;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** 预检一个目录（只读，不落盘） */
function previewSource(absDir) {
  const { files, skipped } = assetPathKit.listSourceFiles(absDir);
  // 同零件多格式去重（GLB > glTF > OBJ）：预检口径必须与执行口径一致，
  // 否则预检说 216 个、执行入库 108 个，用户无法判断。
  const canon = assetPathKit.selectCanonicalFiles(files, {
    rootDir: absDir,
    readRefs: abs => classifier.collectExternalRefs(abs),
  });
  // ⚠ 用 rawOf 换回源目录真实路径再读文件：keep 里是规范化路径（空格→下划线），
  //   直接 join 源目录会 stat 不到 → 预检的 totalTris/lodNever 全 0（曾实测）。
  const primaries = assetPathKit.pickPrimaries([...canon.keep])
    .map(n => canon.rawOf.get(n) || n);
  const textures = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
  const variants = files.filter(f => /_(mid|lod)\.(gltf|glb|obj)$/i.test(f));

  let totalTris = 0, noStats = 0, externalRefs = 0, lodNever = 0, bytes = 0;
  const roleCount = {}, samples = [];
  for (const rel of primaries) {
    const abs = path.join(absDir, rel);
    const st = classifier.readModelStats(abs);
    const key = classifier.derivePartKey(rel);
    const cls = classifier.classifyByName(key);
    roleCount[cls.role] = (roleCount[cls.role] || 0) + 1;
    if (st) {
      totalTris += st.tris;
      externalRefs += st.externalRefs;
      if (st.tris > 0 && st.tris < classifier.LOD_MIN_TRIS) lodNever++;
    } else noStats++;
    if (samples.length < 10) {
      samples.push({
        partKey: key, role: cls.role, file: rel,
        tris: st ? st.tris : null,
        dims: st && st.w !== null ? `${st.w} x ${st.h} x ${st.d}` : null,
        externalTextures: st ? st.externalRefs : 0,
      });
    }
  }
  for (const rel of files) { try { bytes += fs.statSync(path.join(absDir, rel)).size; } catch (e) { /* ignore */ } }

  // 落盘口径：只复制被选中的文件
  const keep = canon.keep || new Set(files);
  let keepBytes = 0;
  for (const n of keep) {
    const rel = canon.rawOf ? (canon.rawOf.get(n) || n) : n;
    try { keepBytes += fs.statSync(path.join(absDir, rel)).size; } catch (e) { /* ignore */ }
  }

  const droppedModels = canon.dropped.filter(d => /\.(gltf|glb|obj|fbx|stl|dae)$/i.test(d.file));

  return {
    fileCount: files.length,
    modelCount: primaries.length,
    rawModelCount: assetPathKit.pickPrimaries(files).length,
    textureCount: textures.length,
    variantCount: variants.length,
    skippedCount: skipped.length,
    skippedSample: skipped.slice(0, 6),
    droppedCount: canon.dropped.length,
    droppedModels: droppedModels.length,
    droppedSample: droppedModels.slice(0, 4),
    copyFileCount: keep.size,
    copyBytes: keepBytes,
    totalTris, noStats, externalRefs, lodNever, bytes, roleCount, samples,
  };
}

/** 列出含模型的直接子目录（判断"单包"还是"多包根目录"） */
function listPackDirs(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, abs: path.join(absDir, e.name) }))
      .filter(d => {
        try {
          return fs.readdirSync(d.abs, { withFileTypes: true })
            .some(e => e.isFile() && /\.(gltf|glb|obj)$/i.test(e.name));
        } catch (e) { return false; }
      });
  } catch (e) { return []; }
}

/**
 * 深度扫描子目录是否含模型（≤3 层）。
 *
 * 为什么要这条：Kenney 的 kit 结构是 `kenney_xxx/Models/GLB format/*.glb`
 * —— kit 目录下**没有**直接放模型的文件，全在第三层。
 * 于是 `listPackDirs`（只看直接子文件）对 `H:\kenney` 返回空 → 预检误判成
 * 「单包」→ 扫完只有一个库且 part_key 全撞在一起。
 * 显式开关 `splitSubdirs=true` 让根目录的每个 kit 各成一个包。
 */
function dirHasModelDeep(absDir, maxDepth) {
  const LIMIT = maxDepth || 3;
  const walk = (d, depth) => {
    if (depth > LIMIT) return false;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return false; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      if (e.isFile() && /\.(gltf|glb|obj)$/i.test(e.name)) return true;
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (walk(path.join(d, e.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(absDir, 0);
}

function listPackDirsDeep(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, abs: path.join(absDir, e.name) }))
      .filter(d => dirHasModelDeep(d.abs, 3));
  } catch (e) { return []; }
}

function packMeta(abs, dirName) {
  return {
    dirName,
    sourceDir: abs,
    packKey: assetPathKit.derivePackKey(dirName, abs),
    displayName: assetPathKit.deriveDisplayName(dirName),
    licenseInfo: assetPathKit.readLicenseInfo(abs),
  };
}

// ── 预检（只读）────────────────────────────────────────────────────
router.post('/scan/preview', async (req, res) => {
  try {
    const check = assetPathKit.assertSafeSourceDir(req.body && req.body.sourceDir);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    const abs = check.abs;
    const target = readTarget(req);
    const splitSubdirs = readBool(req.body && req.body.splitSubdirs, false);

    // 多包识别：显式 splitSubdirs 用深度扫描（Kenney kit 结构），否则只看直接子文件
    const packDirs = splitSubdirs ? listPackDirsDeep(abs) : listPackDirs(abs);
    if (packDirs.length > 0) {
      const packs = packDirs.map(d => {
        const p = { ...packMeta(d.abs, d.name), ...previewSource(d.abs) };
        p.overFileLimit = p.fileCount > MAX_FILES;
        p.overSizeLimit = p.bytes > MAX_TOTAL_BYTES;
        return p;
      });
      return res.json({
        success: true, target, mode: 'multi-pack', splitSubdirs, packCount: packs.length,
        totalModel: packs.reduce((s, p) => s + p.modelCount, 0),
        totalTris: packs.reduce((s, p) => s + p.totalTris, 0),
        packs,
      });
    }

    const p = { ...packMeta(abs, path.basename(abs)), ...previewSource(abs) };
    p.overFileLimit = p.fileCount > MAX_FILES;
    p.overSizeLimit = p.bytes > MAX_TOTAL_BYTES;
    // 顺带告诉前端：这个根目录下有哪些"看起来像包"的子目录（供 UI 提示可勾 splitSubdirs）
    res.json({
      success: true, target, mode: 'single-pack', splitSubdirs, pack: p,
      candidatePacks: listPackDirsDeep(abs).map(d => d.name),
    });
  } catch (error) {
    console.error('❌ 扫描预检失败:', error);
    res.status(500).json({ success: false, error: '预检失败', details: String(error.message || error).slice(0, 200) });
  }
});

// ── 执行：复制落盘 → finalizeBundle（与上传同一函数）────────────────
router.post('/scan', async (req, res) => {
  const results = [];
  try {
    const body = req.body || {};
    const check = assetPathKit.assertSafeSourceDir(body.sourceDir);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    const abs = check.abs;
    const target = readTarget(body);
    // 零件库默认跳过纹理压缩（Kenney colormap 是共享图集，量化会出色带）
    const compressTextures = readBool(body.compressTextures, target === 'part' ? false : true);
    const variants = readBool(body.variants, true);

    const packs = [];
    if (Array.isArray(body.packs) && body.packs.length) {
      for (const p of body.packs) {
        const sub = path.resolve(abs, String(p));
        const ok = assetPathKit.assertSafeSourceDir(sub);
        if (!ok.ok) return res.status(400).json({ success: false, error: `${p}: ${ok.error}` });
        if (!ok.abs.startsWith(abs + path.sep)) {
          return res.status(400).json({ success: false, error: `非法子目录: ${p}` });
        }
        packs.push({ abs: ok.abs, dirName: path.basename(ok.abs) });
      }
    } else if (readBool(body.splitSubdirs, false)) {
      // 根目录的每个 kit 各成一个包（Kenney 布局：kit/Models/GLB format/*.glb）
      for (const d of listPackDirsDeep(abs)) packs.push({ abs: d.abs, dirName: d.name });
      if (!packs.length) packs.push({ abs, dirName: path.basename(abs) });
    } else {
      packs.push({ abs, dirName: path.basename(abs) });
    }

    for (const p of packs) {
      const listed = assetPathKit.listSourceFiles(p.abs);
      if (!listed.files.length) { results.push({ dirName: p.dirName, skipped: '无支持的文件' }); continue; }
      // 格式去重：同一零件的 GLB/glTF/OBJ 副本只留一个（GLB 优先），
      // 否则三者 part_key 相同 → UNIQUE(library_id, part_key) 冲突后写的会覆盖先写的，
      // 实测导致 108 个零件全部被 .obj 覆盖（本项目 OBJ 是 phase2 占位，渲不出来）。
      const canon = assetPathKit.selectCanonicalFiles(listed.files, {
        rootDir: p.abs,
        readRefs: abs => classifier.collectExternalRefs(abs),
      });
      if (canon.keep.size > MAX_FILES) {
        results.push({ dirName: p.dirName, skipped: `文件数 ${canon.keep.size} 超上限 ${MAX_FILES}` }); continue;
      }
      let bytes = 0;
      for (const rel of listed.files) { try { bytes += fs.statSync(path.join(p.abs, rel)).size; } catch (e) { /* ignore */ } }
      let keepBytes = 0;
      for (const n of canon.keep) {
        const rel = canon.rawOf ? (canon.rawOf.get(n) || n) : n;
        try { keepBytes += fs.statSync(path.join(p.abs, rel)).size; } catch (e) { /* ignore */ }
      }
      if (keepBytes > MAX_TOTAL_BYTES) {
        results.push({ dirName: p.dirName, skipped: `体积 ${(keepBytes / 1048576).toFixed(1)}MB 超上限 500MB` }); continue;
      }

      const bundleName = 'bundle-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const bundleDir = path.join(UPLOAD_ROOT, bundleName);
      await fsp.mkdir(bundleDir, { recursive: true });
      const copied = assetPathKit.copyTree(p.abs, bundleDir, { keep: canon.keep });
      if (!copied.length) {
        await fsp.rm(bundleDir, { recursive: true, force: true });
        results.push({ dirName: p.dirName, skipped: '复制后无有效文件' }); continue;
      }

      const r = await finalizeBundle(bundleName, target, {
        sourceRef: p.dirName,
        libraryName: p.dirName,
        compressTextures,
        variants,
        licenseInfo: assetPathKit.readLicenseInfo(p.abs),
        status: body.status === 'pending_review' ? 'pending_review' : 'active',
      });
      results.push({
        dirName: p.dirName, bundleName, fileCount: copied.length,
        droppedDuplicates: canon.dropped.length,
        modelCount: r.modelCount, target, library: r.library,
        warnings: (r.models || []).flatMap(m => m.warnings || []).slice(0, 15),
      });
    }

    res.json({
      success: true, target, packCount: packs.length,
      imported: results.filter(r => !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      packs: results,
    });
  } catch (error) {
    console.error('❌ 扫描入库失败:', error);
    res.status(500).json({ success: false, error: '扫描入库失败', details: String(error.message || error).slice(0, 200) });
  }
});

module.exports = router;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
