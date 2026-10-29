/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 互联网免费模型库路由（世界编辑器「🌐 互联网免费模型库」面板的服务端）
 * ------------------------------------------------------------------
 * GET  /api/free-assets/providers          → 资产源白名单（公开读）
 * GET  /api/free-assets/search             → 搜索代理（仅给不支持 CORS 的源用；polyfork 前端直连）
 * POST /api/free-assets/import             → 下载入库（管理员；见 apiWriteGuard 挂载策略）
 *
 * 安全设计：
 *   1. **只接受 {provider, id}**，下载 URL 由 services/freeAssetProviders 拼接 → 无 SSRF 面；
 *   2. GLB magic 校验 + 单文件 20MB + 20s 超时；
 *   3. 落盘走「临时文件 → rename」原子写，中途失败不留半截文件；
 *   4. 不做任何批量抓取（一次请求只处理一件），符合第三方"逐件热链"的许可口径。
 */
const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const router = express.Router();
const { pool } = require('../database/db');
const providers = require('../services/freeAssetProviders');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const FETCH_TIMEOUT_MS = 20000;
const GLB_MAGIC = 0x46546c67; // 'glTF'

function log(...args) {
  console.log('[free-assets]', ...args);
}

/** 公开：资产源列表（前端下拉框） */
router.get('/providers', (req, res) => {
  res.json({ success: true, providers: providers.listPublic() });
});

/**
 * 搜索代理（默认不用；只有 corsDirect=false 的源才会走这里）
 * 只透传白名单字段，避免把第三方数据结构硬编码到前端。
 */
router.get('/search', async (req, res) => {
  try {
    const p = providers.getProvider(req.query.provider);
    if (!p) return res.status(400).json({ success: false, error: '未知资产源' });
    if (!p.searchApi) return res.status(400).json({ success: false, error: '该源不支持搜索代理' });

    const u = new URL(p.searchApi);
    u.searchParams.set('free', '1');
    u.searchParams.set('per_page', String(Math.min(48, Math.max(1, parseInt(req.query.perPage, 10) || 24))));
    u.searchParams.set('page', String(Math.max(1, parseInt(req.query.page, 10) || 1)));
    if (req.query.q) u.searchParams.set('q', String(req.query.q).slice(0, 80));
    if (req.query.cls) u.searchParams.set('class', String(req.query.cls).slice(0, 30));
    u.searchParams.set('sort', 'latest');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let j;
    try {
      const r = await fetch(u.toString(), { signal: ac.signal });
      if (!r.ok) return res.status(502).json({ success: false, error: '上游搜索失败 HTTP ' + r.status });
      j = await r.json();
    } finally {
      clearTimeout(timer);
    }
    const items = (j.assets || []).map((a) => ({
      id: a.id,
      title: a.title || a.id,
      thumb: typeof a.thumbnail === 'string' ? a.thumbnail : '',
      tris: a.triangles || 0,
      cls: a.class || '',
      hasRig: !!a.has_rig,
      size: a.size_m || null
    }));
    res.json({ success: true, total: j.total || items.length, items, coverage: j.coverage || null });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

/**
 * 下载入库：把第三方 CDN 上的单个 GLB 保存到本世界 public/models/uploaded/free/<provider>/
 * 并写一行 uploaded_models（之后它就出现在「📂 已上传模型」里，可走本地 LOD/合批/零件库）。
 */
router.post('/import', async (req, res) => {
  try {
    const built = providers.buildAssetUrl(req.body && req.body.provider, req.body && req.body.id);
    if (!built.ok) return res.status(400).json({ success: false, code: built.code, error: built.message });

    const { provider, assetId, url } = built;
    const title = String((req.body && req.body.title) || assetId).slice(0, 100);

    const dirFs = path.join(PUBLIC_DIR, provider.saveDir);
    const absFile = path.join(dirFs, assetId + '.glb');
    const webPath = '/' + provider.saveDir.replace(/\\/g, '/') + '/' + assetId + '.glb';

    let bytes = 0;
    let reused = false;

    const stat = await fsp.stat(absFile).catch(() => null);
    if (stat && stat.size > 4) {
      bytes = stat.size;
      reused = true;
      log('已存在，复用本地副本:', webPath);
    } else {
      // ---- 1. 下载（限时 + 限体积） ----
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      let buf;
      try {
        const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'virtual-world/1.0 (+free-asset-import)' } });
        if (!r.ok) {
          return res.status(502).json({ success: false, error: '下载失败 HTTP ' + r.status });
        }
        const len = parseInt(r.headers.get('content-length') || '0', 10);
        if (len && len > provider.maxBytes) {
          return res.status(413).json({ success: false, error: '文件过大（' + len + ' 字节），上限 ' + provider.maxBytes });
        }
        buf = Buffer.from(await r.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }

      if (buf.length < 12 || buf.length > provider.maxBytes) {
        return res.status(413).json({ success: false, error: '文件体积异常：' + buf.length + ' 字节' });
      }
      if (buf.readUInt32LE(0) !== GLB_MAGIC) {
        return res.status(415).json({ success: false, error: '不是合法的 GLB 文件（magic 不匹配）' });
      }

      // ---- 2. 原子写盘 ----
      await fsp.mkdir(dirFs, { recursive: true });
      const tmp = absFile + '.part';
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, absFile);
      bytes = buf.length;
      log('下载完成:', url, '→', webPath, bytes + 'B');
    }

    // ---- 3. 入库（file_type 用 glb；display_name 列在旧库可能不存在 → 二次兜底） ----
    const fileName = provider.id + '-' + assetId + '.glb';
    let modelId = null;
    const existing = await pool.query('SELECT id FROM uploaded_models WHERE path = $1 LIMIT 1', [webPath]).catch(() => null);
    if (existing && existing.rows.length) {
      modelId = existing.rows[0].id;
    } else {
      try {
        const ins = await pool.query(
          `INSERT INTO uploaded_models (file_name, saved_file_name, path, file_type, file_size, display_name, description, created_at)
           VALUES ($1, $2, $3, 'glb', $4, $5, $6, NOW()) RETURNING id`,
          [fileName, fileName, webPath, bytes, title, 'source:' + provider.id + ':' + assetId]
        );
        modelId = ins.rows[0].id;
      } catch (e) {
        if (e && e.code === '42703') {
          // 旧库没有 display_name 列
          const ins2 = await pool.query(
            `INSERT INTO uploaded_models (file_name, saved_file_name, path, file_type, file_size, description, created_at)
             VALUES ($1, $2, $3, 'glb', $4, $5, NOW()) RETURNING id`,
            [fileName, fileName, webPath, bytes, 'source:' + provider.id + ':' + assetId]
          );
          modelId = ins2.rows[0].id;
        } else {
          throw e;
        }
      }
    }

    res.json({
      success: true,
      provider: provider.id,
      assetId,
      path: webPath,
      size: bytes,
      modelId,
      reused
    });
  } catch (e) {
    console.error('[free-assets] 入库失败:', e);
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

module.exports = router;
