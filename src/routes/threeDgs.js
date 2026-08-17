/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 3D高斯泼溅场景 - 公开只读文件列表接口
 * 供 world_editor.html 左侧"高斯"按钮展示 public/scenes/3dgs 目录下的高斯文件
 * 仅提供只读列表，不涉及文件写入/注册，无需管理员认证
 */
const express = require('express');
const path = require('path');
const fsSync = require('fs');
const { query } = require('../database/db');

const router = express.Router();

const SCENES_3DGS_DIR = path.join(__dirname, '../../public/scenes/3dgs');
const SUPPORTED_EXTS = ['.rad', '.ply', '.spz', '.splat', '.ksplat'];
const THUMB_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// 递归扫描目录，收集所有 3DGS 文件相对路径
function scanDir3dgs(baseDir, relDir, result) {
  let entries;
  try {
    entries = fsSync.readdirSync(path.join(baseDir, relDir), { withFileTypes: true });
  } catch (e) {
    return result;
  }
  for (const entry of entries) {
    const entryRel = relDir ? relDir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      scanDir3dgs(baseDir, entryRel, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTS.includes(ext)) {
        result.push(entryRel);
      }
    }
  }
  return result;
}

// 读取数据库中的场景注册信息（表不存在/未连接时降级为空映射，不破坏公开接口）
async function loadRegisteredScenes() {
  try {
    const result = await query('SELECT id, scene_name, rad_file_url, thumbnail_url FROM scene_3dgs');
    const map = {};
    for (const row of result.rows) {
      if (row.rad_file_url) map[row.rad_file_url] = row;
    }
    return map;
  } catch (e) {
    console.warn('[threeDgs] 数据库未就绪，跳过场景名称关联:', e.message);
    return {};
  }
}

// GET /api/three-dgs/list - 列出高斯场景库文件
router.get('/list', async (req, res) => {
  try {
    if (!fsSync.existsSync(SCENES_3DGS_DIR)) {
      fsSync.mkdirSync(SCENES_3DGS_DIR, { recursive: true });
      return res.json({ success: true, files: [], directory: '/scenes/3dgs' });
    }
    const relPaths = scanDir3dgs(SCENES_3DGS_DIR, '', []);
    const registeredMap = await loadRegisteredScenes();
    const files = relPaths.map(relPath => {
      const safeRel = relPath.replace(/\\/g, '/');
      const absPath = path.join(SCENES_3DGS_DIR, relPath);
      let stat = null;
      try { stat = fsSync.statSync(absPath); } catch (e) { /* ignore */ }
      const fileUrl = '/scenes/3dgs/' + safeRel;
      // 检测同名缩略图（同路径不同扩展名，如 foo.jpg 对应 foo.rad）
      let autoThumbnail = null;
      const nameNoExt = safeRel.replace(/\.[^.]+$/, '');
      for (const imgExt of THUMB_EXTS) {
        if (fsSync.existsSync(path.join(SCENES_3DGS_DIR, nameNoExt + imgExt))) {
          autoThumbnail = '/scenes/3dgs/' + nameNoExt + imgExt;
          break;
        }
      }
      const dir = safeRel.includes('/') ? safeRel.substring(0, safeRel.lastIndexOf('/')) : '';
      const regInfo = registeredMap[fileUrl];
      return {
        filename: path.basename(safeRel),
        relative_path: safeRel,
        dir: dir,
        url: fileUrl,
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtime.toISOString() : null,
        ext: path.extname(safeRel).toLowerCase(),
        auto_thumbnail: autoThumbnail,
        registered: !!regInfo,
        scene_id: regInfo ? regInfo.id : null,
        scene_name: regInfo ? regInfo.scene_name : null,
        db_thumbnail_url: regInfo ? regInfo.thumbnail_url : null
      };
    });
    // 已注册（有名称）的优先，其余按修改时间倒序（新文件在前）
    files.sort((a, b) => {
      if (!!a.registered !== !!b.registered) return a.registered ? -1 : 1;
      return (b.mtime || '').localeCompare(a.mtime || '');
    });
    res.json({ success: true, files: files, directory: '/scenes/3dgs' });
  } catch (e) {
    console.error('[threeDgs] 扫描目录失败:', e);
    res.status(500).json({ success: false, error: '扫描失败: ' + e.message });
  }
});

module.exports = router;
