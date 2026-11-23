/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 互联网免费模型库路由（世界编辑器「🌐 互联网免费模型库」面板的服务端）
 * ------------------------------------------------------------------
 * 单件：
 *   GET  /api/free-assets/providers          → 资产源白名单（公开读）
 *   GET  /api/free-assets/search             → 搜索代理（仅给不支持 CORS 的源用；polyfork 前端直连）
 *   POST /api/free-assets/import             → 下载入库（管理员）
 * 成套场景（2026-11-12 新增，解决"一个个摆太麻烦"）：
 *   GET  /api/free-assets/kits               → 套件列表（公开读，无 key）
 *   GET  /api/free-assets/kits/:id           → 套件详情 + layout（layout 需要 API key）
 *   POST /api/free-assets/import-kit         → 整套导入：下载用到的零件 + 批量写 world_objects（管理员）
 *   GET  /api/free-assets/key-status         → 是否已配置 API key（只回布尔 + 尾号）
 *   PUT  /api/free-assets/key                → 保存 API key（管理员）
 *
 * 安全设计（延续既有红线）：
 *   1. **只接受 {provider, id / kitId}**，URL 由 services/freeAssetProviders 拼接 → 无 SSRF 面；
 *   2. GLB magic 校验 + 单文件 20MB + 20s 超时 + 原子写盘；
 *   3. API key 只在本进程内使用，绝不下发前端；
 *   4. 批量导入有硬上限（见 KIT_LIMITS），一次请求不会无限拉取。
 */
const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const router = express.Router();
const { pool } = require('../database/db');
const providers = require('../services/freeAssetProviders');
const kits = require('../services/polyforkKits');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const FETCH_TIMEOUT_MS = 20000;
const GLB_MAGIC = 0x46546c67; // 'glTF'

const LIST_CACHE_MS = 10 * 60 * 1000;
const listCache = new Map();   // key → { at, data }

function log(...args) {
  console.log('[free-assets]', ...args);
}

function cacheGet(key) {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_CACHE_MS) return hit.data;
  return null;
}
function cacheSet(key, data) {
  listCache.set(key, { at: Date.now(), data });
  if (listCache.size > 200) listCache.delete(listCache.keys().next().value);
}

/** 带超时的 JSON 拉取；key 有就带 Authorization */
async function fetchJson(url, apiKey) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': 'virtual-world/1.0 (+free-asset-kit)' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const r = await fetch(url, { signal: ac.signal, headers });
    if (!r.ok) {
      const err = new Error('上游 HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ============================ 基础接口 ============================ */

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

    const j = await fetchJson(u.toString());
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

/* ======================= 下载入库（单件核心，复用） ======================= */

/**
 * 把第三方 CDN 上的单个 GLB 落到 public/<saveDir>/<id>.glb，并写一行 uploaded_models。
 * 幂等：本地已有则直接复用，秒回。
 * @returns {Promise<{webPath,size,reused,modelId}>}
 */
async function ensureLocalGlb(provider, assetId, title) {
  const dirFs = path.join(PUBLIC_DIR, provider.saveDir);
  const absFile = path.join(dirFs, assetId + '.glb');
  const webPath = '/' + provider.saveDir.replace(/\\/g, '/') + '/' + assetId + '.glb';

  const built = providers.buildAssetUrl(provider.id, assetId);
  if (!built.ok) {
    const err = new Error(built.message);
    err.code = built.code;
    throw err;
  }

  let bytes = 0;
  let reused = false;

  const stat = await fsp.stat(absFile).catch(() => null);
  if (stat && stat.size > 4) {
    bytes = stat.size;
    reused = true;
  } else {
    /**
     * 下载带重试（2026-11-18 加）：
     * 对方 CDN 单请求 TTFB 约 1.3s，并发 3 时偶发超时/断流，原先一次失败就丢件，
     * 且失败只进 partErrors 不提示 —— 实测 Chronos Hearth 61 件静默丢了 2 件。
     */
    let buf = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(built.url, {
          signal: ac.signal,
          headers: { 'User-Agent': 'virtual-world/1.0 (+free-asset-import)' }
        });
        if (!r.ok) {
          const err = new Error('下载失败 HTTP ' + r.status);
          err.status = r.status === 404 ? 404 : 502;
          throw err;
        }
        const len = parseInt(r.headers.get('content-length') || '0', 10);
        if (len && len > provider.maxBytes) {
          const err = new Error('文件过大（' + len + ' 字节），上限 ' + provider.maxBytes);
          err.status = 413;
          throw err;
        }
        buf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        lastErr = e;
        // 体积超限 / 404 不重试（重试也没用）
        if (e && (e.status === 413 || e.status === 404)) break;
      } finally {
        clearTimeout(timer);
      }
      if (buf) break;
      if (attempt < 2) await new Promise((rs) => setTimeout(rs, 600 * (attempt + 1)));
    }
    if (!buf) throw lastErr || new Error('下载失败（重试 3 次仍失败）');

    if (buf.length < 12 || buf.length > provider.maxBytes) {
      const err = new Error('文件体积异常：' + buf.length + ' 字节');
      err.status = 413;
      throw err;
    }
    if (buf.readUInt32LE(0) !== GLB_MAGIC) {
      const err = new Error('不是合法的 GLB 文件（magic 不匹配）');
      err.status = 415;
      throw err;
    }

    await fsp.mkdir(dirFs, { recursive: true });
    const tmp = absFile + '.part';
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, absFile);
    bytes = buf.length;
  }

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
        [fileName, fileName, webPath, bytes, title || assetId, 'source:' + provider.id + ':' + assetId]
      );
      modelId = ins.rows[0].id;
    } catch (e) {
      if (e && e.code === '42703') {
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

  return { webPath, size: bytes, reused, modelId };
}

/**
 * 反查「跨套件零件」的真实资产 id（2026-11-18 新增）
 * ------------------------------------------------------------------
 * layout 每行只写短键（`grass-tuft` / `pine-tree-young`）。同一个 kit 的短键能在
 * kit.parts 里查到 id，但**跨 kit 借用的零件查不到** —— Chronos Hearth 的整片草地、
 * 松树、石头其实来自 Nature & Forest kit，kit.parts 里没有它们。
 * 原先代码直接拿短键当 id 拼 `/cdn/grass-tuft.glb`，必然 404，且失败被静默吞掉，
 * 结果 1073 个摆放点只落下 414 个（整层植被全丢）。
 *
 * 这里用官方搜索接口反查，并且**只认唯一命中**：
 *   - id 直接以 `短键-` 开头（grass-tuft-a40a08）→ 认；
 *   - 或候选标题的词集被短键词集完全包含（Young Pine ⊆ pine/tree/young）→ 认；
 * 多个候选（例如 rock-small 会同时命中珊瑚礁的礁石）一律放弃，宁可少抓也不错抓。
 */
async function resolveForeignPart(shortKey) {
  const key = String(shortKey || '').trim().toLowerCase();
  const words = key.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return '';

  // 域名白名单与 download 白名单同源（providers 里只允许 polyfork.dev）
  const url = 'https://polyfork.dev/api/assets?q=' +
    encodeURIComponent(words.join(' ')) + '&per_page=20&fields=compact';

  let j;
  try {
    j = await fetchJson(url);
  } catch (e) {
    return '';
  }

  const keySet = new Set(words);
  const hits = ((j && j.assets) || []).filter((a) => {
    if (!a || !a.id || a.class === 'terrain') return false;
    if (String(a.id).startsWith(key + '-')) return true;
    const tw = String(a.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!tw.length) return false;
    return tw.every((w) => keySet.has(w));
  });

  const uniq = Array.from(new Set(hits.map((a) => a.id)));
  return uniq.length === 1 ? uniq[0] : '';
}

/**
 * 批量反查跨套件零件（2026-11-18 新增，比单件猜稳得多）
 * ------------------------------------------------------------------
 * 单件按标题猜风险高：`rock-small` 在 4 个 kit 里都有 Small Rock，
 * `grass-tuft` 在 3 个 kit 里都有 —— 猜错就是把别的 kit 的石头塞进来。
 *
 * 这里的做法：
 *   1) 把每个短键搜一遍，只统计「看起来就是这个零件」的候选（id 前缀或标题词集包含）；
 *   2) 按候选所属 kit 投票，选出票数最多的那个 —— 一次导入借的通常就是同一个 kit
 *      （Chronos Hearth 的草地/松树/石头全部来自 nature-forest-kit-f29d6a）；
 *   3) 拉那个 kit 的 parts，用它的 key→id 做**精确映射**，一次性解决全部短键。
 * 拉不到就返回空表，交由调用方按单件兜底（宁可缺件也不乱抓）。
 */
async function resolveForeignParts(shortKeys, apiKey) {
  const out = {};
  const keys = (Array.isArray(shortKeys) ? shortKeys : []).filter(Boolean);
  if (!keys.length) return out;

  const wordsOf = (k) => String(k).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  const searchOne = async (k) => {
    const words = wordsOf(k);
    if (!words.length) return [];
    try {
      const j = await fetchJson('https://polyfork.dev/api/assets?q=' +
        encodeURIComponent(words.join(' ')) + '&per_page=20&fields=compact');
      return ((j && j.assets) || []).filter((a) => a && a.id && a.class !== 'terrain');
    } catch (e) {
      return [];
    }
  };

  const lists = [];
  for (let i = 0; i < keys.length; i += 4) {
    const batch = keys.slice(i, i + 4);
    const got = await Promise.all(batch.map(async (k) => [k, await searchOne(k)]));
    lists.push(...got);
  }

  const votes = new Map();
  for (const [k, list] of lists) {
    const keySet = new Set(wordsOf(k));
    const near = list.filter((a) => {
      if (String(a.id).startsWith(k + '-')) return true;
      const tw = wordsOf(a.title);
      return tw.length > 0 && tw.every((w) => keySet.has(w));
    });
    for (const a of near) {
      if (!a.kit) continue;
      votes.set(a.kit, (votes.get(a.kit) || 0) + 1);
    }
  }

  let bestKit = '';
  let bestN = 0;
  for (const [kitId, n] of votes) {
    if (n > bestN) { bestN = n; bestKit = kitId; }
  }
  if (!bestKit || bestN < Math.min(2, keys.length)) return out;

  // 拉来源 kit 的 parts（命中缓存就复用，避免重复请求）
  let srcParts = null;
  const ck = 'kit:polyfork:' + bestKit + ':' + (apiKey ? 'k' : 'n');
  const cached = cacheGet(ck);
  if (cached && Array.isArray(cached.parts)) srcParts = cached.parts;
  else {
    try {
      const built = providers.buildKitUrl('polyfork', bestKit);
      if (built.ok) {
        const j = await fetchJson(built.url, apiKey);
        srcParts = (j.parts || []).map((a) => ({ key: a.key || a.id, id: a.id }));
      }
    } catch (e) {
      srcParts = null;
    }
  }
  if (!srcParts || !srcParts.length) return out;

  const keyToId = {};
  srcParts.forEach((a) => { if (a && a.key && a.id) keyToId[a.key] = a.id; });

  for (const k of keys) {
    if (keyToId[k]) { out[k] = keyToId[k]; continue; }
    // 兜底：短键前缀唯一命中的候选
    const list = (lists.find((x) => x[0] === k) || [])[1] || [];
    const pre = list.filter((a) => String(a.id).startsWith(k + '-'));
    if (pre.length === 1) out[k] = pre[0].id;
  }
  return out;
}

/** 下载入库：单个 GLB → 本地 + uploaded_models（原有行为不变） */
router.post('/import', async (req, res) => {
  try {
    const built = providers.buildAssetUrl(req.body && req.body.provider, req.body && req.body.id);
    if (!built.ok) return res.status(400).json({ success: false, code: built.code, error: built.message });

    const { provider, assetId } = built;
    const title = String((req.body && req.body.title) || assetId).slice(0, 100);

    const r = await ensureLocalGlb(provider, assetId, title);
    if (r.reused) log('已存在，复用本地副本:', r.webPath);

    res.json({
      success: true,
      provider: provider.id,
      assetId,
      path: r.webPath,
      size: r.size,
      modelId: r.modelId,
      reused: r.reused
    });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    if (status >= 500) console.error('[free-assets] 入库失败:', e);
    res.status(status).json({ success: false, code: e && e.code, error: String(e && e.message || e) });
  }
});

/* ============================ 成套场景（kit） ============================ */

/**
 * 套件列表。公开可读（无 key）：给的是「有哪些成套场景、各多少件/多少摆放点」。
 */
router.get('/kits', async (req, res) => {
  try {
    const built = providers.buildKitsListUrl(req.query.provider);
    if (!built.ok) return res.status(400).json({ success: false, code: built.code, error: built.message });

    const cacheKey = 'kits:' + built.provider.id;
    let data = cacheGet(cacheKey);
    if (!data) {
      const j = await fetchJson(built.url);
      data = (j.kits || []).map((k) => ({
        id: k.id,
        title: k.title || k.id,
        status: k.status || '',
        partsPublished: k.parts_published || 0,
        partsPlanned: k.parts_planned || 0,
        placements: (k.composition && k.composition.placements) || 0,
        distinctParts: (k.composition && k.composition.distinct_parts) || 0,
        page: k.page || ''
      }));
      cacheSet(cacheKey, data);
    }
    res.json({ success: true, provider: built.provider.id, total: data.length, kits: data });
  } catch (e) {
    res.status(502).json({ success: false, error: '拉取套件列表失败：' + String(e && e.message || e) });
  }
});

/**
 * 套件详情。
 * - 无 key：返回 parts（可用零件）+ composition（有多少摆放点）+ layout:null + needsKey:true
 * - 有 key：额外返回 layout（整场景摆放关系）
 * 封面图取第一个零件的 thumbnail（官方列表接口不给 kit 封面）。
 */
router.get('/kits/:id', async (req, res) => {
  try {
    const built = providers.buildKitUrl(req.query.provider || 'polyfork', req.params.id);
    if (!built.ok) return res.status(400).json({ success: false, code: built.code, error: built.message });

    const p = built.provider;
    const apiKey = await providers.resolveApiKey(p.id);
    const cacheKey = 'kit:' + p.id + ':' + built.kitId + ':' + (apiKey ? 'k' : 'n');
    let data = cacheGet(cacheKey);

    if (!data) {
      const j = await fetchJson(built.url, apiKey);
      const parts = (j.parts || []).map((a) => ({
        id: a.id,
        key: a.key || a.id,   // 短键：layout 的 part 字段用的就是它
        title: a.title || a.id,
        cls: a.class || '',
        tris: a.triangles || 0,
        size: a.size_m || null,
        thumb: typeof a.thumbnail === 'string' ? a.thumbnail : ''
      }));
      const layout = Array.isArray(j.layout) ? j.layout : null;
      data = {
        id: j.id,
        title: j.title || j.id,
        status: j.status || '',
        page: j.page || '',
        partsPublished: j.parts_published || parts.length,
        composition: j.composition || null,
        usage: j.usage || null,
        parts,
        layout,
        hasKey: !!apiKey,
        // 有摆放点数据但拿不到 layout = 后端没配 key（不是对方不给我们）
        needsKey: !layout && !!(j.composition && j.composition.placements)
      };
      cacheSet(cacheKey, data);
    }
    res.json({ success: true, kit: data });
  } catch (e) {
    const status = e && e.status === 404 ? 404 : 502;
    res.status(status).json({ success: false, error: '拉取套件详情失败：' + String(e && e.message || e) });
  }
});

/**
 * 整套导入：按 layout 把整块场景写进 world_objects。
 * 流程：取 layout（要 key）→ 下载 layout 里真正用到的零件 → 一次性批量插入 → 返回统计。
 *
 * body: {
 *   provider?: 'polyfork',
 *   id: kitId,
 *   x, y, z: 落点基准（kit 的 0,0,0 搬到这里；默认 0,0,0）
 *   rotateDeg?: 整场景绕 Y 轴再转多少度
 *   hasCollision?: 是否给这些对象加碰撞（默认 false）
 *   namePrefix?: 对象名前缀
 *   dryRun?: 只算不写（预览：会返回 rows 数量与零件清单，不下载不入库）
 * }
 */
router.post('/import-kit', async (req, res) => {
  const body = req.body || {};
  try {
    const built = providers.buildKitUrl(body.provider || 'polyfork', body.id);
    if (!built.ok) return res.status(400).json({ success: false, code: built.code, error: built.message });
    const p = built.provider;

    const apiKey = await providers.resolveApiKey(p.id);
    if (!apiKey) {
      return res.status(409).json({
        success: false,
        code: 'NEED_KEY',
        error: '整套导入需要 Polyfork 的免费账号 API key（对方把 layout 只给已登录账号）',
        hint: '在 polyfork.dev/account 注册（邮箱即可）创建 key，然后在本面板「套件 API key」里粘贴保存。'
      });
    }

    const kit = await fetchJson(built.url, apiKey);
    const layout = Array.isArray(kit.layout) ? kit.layout : null;
    if (!layout || !layout.length) {
      return res.status(409).json({
        success: false,
        code: 'NO_LAYOUT',
        error: '这个套件没有提供场景布局（可能仍在上架中），只能按单件使用'
      });
    }
    if (layout.length > providers.KIT_LIMITS.maxPlacements) {
      return res.status(413).json({
        success: false,
        code: 'TOO_MANY_PLACEMENTS',
        error: '该套件摆放点 ' + layout.length + ' 个，超过上限 ' + providers.KIT_LIMITS.maxPlacements
      });
    }

    /**
     * ⚠️ 关键口径（2026-11-12 实测踩到）：
     * layout 每行的 `part` 是**短键**（`anvil` / `barn` / `grass-terrain-blob`），
     * 不是 CDN 上的资产 id（`anvil-1286cb`）。短键 → id 的映射在 kit.parts[].key，
     * 不翻译就会拿 `https://polyfork.dev/cdn/anvil.glb` 去下载，34 个零件全 404。
     */
    const keyToId = {};
    const titleByKey = {};
    (kit.parts || []).forEach((a) => {
      const k = a.key || a.id;
      if (!k) return;
      if (a.key) keyToId[a.key] = a.id;
      titleByKey[k] = a.title || a.id;
      if (a.id) titleByKey[a.id] = a.title || a.id;
    });

    /**
     * 2026-11-18 修「导入缺件」根因：
     * 原先下载集合 = usedPartIds(layout)，也就是**只下这套场景摆过的那几件**。
     * Chronos Hearth 实测：kit 共 61 件，layout 只摆了 60 件 → 素材库永远缺件，
     * 而且地形（class=terrain）被 usedPartIds 整体滤掉 → 导入后整块地面消失。
     *
     * 新口径：
     *   1) 主集合 = kit.parts 全量（这套零件有多少下多少，哪怕这张摆法没用到）；
     *   2) 附加 = layout 里引用了、但不在本 kit 零件表的短键（跨 kit 借用，例：
     *      Chronos Hearth 的草地/松树/石头来自 Nature & Forest kit）→ 先按短键
     *      猜 id，猜不到的走 resolveForeignPart 去官方搜索反查。
     */
    const usedKeys = kits.usedPartIds(layout);

    // 注意：这里拿的是官方原始 JSON，字段名是 `class` 不是 `cls`
    // （/kits/:id 那个接口才把它映射成 cls）。写成 a.cls 会让地形认不出来，
    // 导致 layout 的 _terrain 行仍然被跳过 —— 2026-11-18 实测踩到。
    const kitAll = (kit.parts || [])
      .map((a) => ({ key: a.key || a.id, id: a.id, title: a.title || a.id, cls: a.cls || a.class || '' }))
      .filter((a) => a && a.id);

    const kitKeySet = new Set(kitAll.map((a) => a.key));
    const foreignKeys = usedKeys.filter((k) => !kitKeySet.has(k));
    const includeForeign = body.includeForeign !== false;   // 默认要：缺植被等于缺半个场景

    if (kitAll.length + foreignKeys.length > providers.KIT_LIMITS.maxDistinctParts) {
      return res.status(413).json({
        success: false,
        code: 'TOO_MANY_PARTS',
        error: '该套件共 ' + (kitAll.length + foreignKeys.length) + ' 个零件，超过上限 ' + providers.KIT_LIMITS.maxDistinctParts
      });
    }

    // 跨 kit 零件：先试「短键直接当 id」，解析不出来的留给下载阶段再查
    const parts = kitAll.concat(
      (includeForeign ? foreignKeys : []).map((k) => ({
        key: k,
        id: keyToId[k] || '',
        title: titleByKey[k] || k,
        cls: '',
        foreign: true
      }))
    );
    let unresolvedKeys = parts.filter((x) => !x.id).map((x) => x.key);

    // 地形：kit 里 class=terrain 的那一件，挂到 `__terrain` 别名上。
    // 转换器遇到 layout 的 `_terrain` 行时用它把地面真正摆出来（否则整套是悬空的）。
    const terrainPart = parts.find((x) => x.cls === 'terrain');
    if (terrainPart) titleByKey.__terrain = terrainPart.title || '地形';

    const base = {
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      z: Number(body.z) || 0,
      rotateDeg: Number(body.rotateDeg) || 0,
      titleById: titleByKey,
      hasCollision: body.hasCollision === true,
      namePrefix: String(body.namePrefix || '')
    };

    /**
     * 离地补偿（2026-11-18 修）
     * ------------------------------------------------------------
     * 有些 kit 自带「架空地板」（Office 的地板砖在 y=-0.2、地毯在 y=0），
     * 直接落到世界 y=0 的平地上，地板砖整块埋进地面 —— 运行时只看得到草地，
     * 表现为「这套少了一大半零件」（实测 305 块地板砖全埋、307 块地毯共面）。
     * 编辑器没有世界地面，所以编辑器里看不出问题。
     *
     * 这里按 layout 里最低的负高度整体上抬，但最多抬 1m：
     * 目的是补平「薄薄一层地板埋地下」，而不是把带地下室的 kit 整体托起来。
     */
    let minLayoutY = 0;
    layout.forEach((r) => {
      const p = String(r.part || '');
      if (p.charAt(0) === '_') return;        // 地形行的 y 是内部参数，不参与
      const y = Number(r.y);
      if (Number.isFinite(y) && y < minLayoutY) minLayoutY = y;
    });
    const groundLift = minLayoutY < 0 ? Math.min(-minLayoutY, 1) : 0;
    if (groundLift > 0) {
      base.y += groundLift;
      log('离地补偿: layout 最低点 ' + minLayoutY.toFixed(3) + 'm，整组上抬 ' + groundLift.toFixed(3) + 'm');
    }

    const dryRun = body.dryRun === true;

    if (dryRun) {
      const pending = {};
      parts.forEach((x) => { pending[x.key] = 'PENDING'; });
      if (terrainPart) pending.__terrain = 'PENDING';
      const preview = kits.toWorldObjects(layout, Object.assign({}, base, { pathById: pending }));
      return res.json({
        success: true,
        dryRun: true,
        kit: { id: kit.id, title: kit.title },
        placements: layout.length,
        distinctParts: parts.length,
        willCreate: preview.rows.length,
        skipped: preview.stats.skipped,
        unresolvedKeys,
        hasTerrain: !!terrainPart,
        foreignParts: parts.filter((x) => x.foreign).map((x) => x.key),
        parts: parts.map((x) => ({ key: x.key, id: x.id, title: x.title, cls: x.cls }))
      });
    }

    /* ---- 1. 下载零件：kit 全量 + 跨套件借用（并发 3，幂等复用） ---- */
    // 跨套件零件先批量反查（锁定来源 kit 做精确映射），比下载时逐件瞎猜稳
    const needResolve = parts.filter((x) => x.foreign && !x.id).map((x) => x.key);
    if (needResolve.length) {
      const resolvedMap = await resolveForeignParts(needResolve, apiKey);
      let hit = 0;
      parts.forEach((x) => {
        if (x.foreign && !x.id && resolvedMap[x.key]) { x.id = resolvedMap[x.key]; hit++; }
      });
      unresolvedKeys = parts.filter((x) => !x.id).map((x) => x.key);
      log('跨套件零件反查:', hit + '/' + needResolve.length, hit < needResolve.length ? ('未解析: ' + unresolvedKeys.join(',')) : '');
    }

    // pathById 用**短键**做 key，因为转换器拿到的是 layout 行里的 part 值
    const pathById = {};
    const models = [];
    const partErrors = [];
    let cursor = 0;

    async function worker() {
      while (cursor < parts.length) {
        const item = parts[cursor++];
        try {
          // 跨套件零件只有短键，没有 id：先反查，查不到就明确报错（不再静默 404）
          if (!item.id) {
            item.id = await resolveForeignPart(item.key);
            if (!item.id) throw new Error('跨套件零件反查不到资产 id');
          }
          const r = await ensureLocalGlb(p, item.id, item.title);
          pathById[item.key] = r.webPath;
          models.push({ key: item.key, id: item.id, path: r.webPath, size: r.size, reused: r.reused, foreign: !!item.foreign });
        } catch (e) {
          partErrors.push({ key: item.key, id: item.id || '', error: String(e && e.message || e) });
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(providers.KIT_LIMITS.downloadConcurrency, parts.length) }, worker)
    );

    // 地形路径回填到别名（下载失败则保持 undefined → 转换器照旧跳过 _terrain 行）
    if (terrainPart && pathById[terrainPart.key]) {
      pathById.__terrain = pathById[terrainPart.key];
    }

    if (!models.length) {
      const first = partErrors[0];
      return res.status(502).json({
        success: false,
        code: 'PARTS_DOWNLOAD_FAILED',
        error: '所有零件都下载失败，未写入任何对象' +
          (first ? '（首个失败：' + first.id + ' → ' + first.error + '）' : ''),
        partErrors: partErrors.slice(0, 20),
        unresolvedKeys
      });
    }

    /* ---- 2. 生成世界对象行 ---- */
    const conv = kits.toWorldObjects(layout, Object.assign({}, base, { pathById }));
    if (!conv.rows.length) {
      return res.status(422).json({
        success: false,
        code: 'NO_ROWS',
        error: '布局没有可用摆放点（零件未下载成功或布局字段异常）',
        stats: conv.stats,
        partErrors: partErrors.slice(0, 20)
      });
    }

    /* ---- 3. 一次批量插入 ---- */
    const rows = conv.rows;
    const col = (k) => rows.map((r) => r[k]);
    const sqlWithCollision = `
      INSERT INTO world_objects
        (type, name, model_path, model_type,
         position_x, position_y, position_z,
         rotation_x, rotation_y, rotation_z,
         scale_x, scale_y, scale_z, has_collision, created_at, updated_at)
      SELECT t.type, t.name, t.model_path, t.model_type,
             t.px, t.py, t.pz, t.rx, t.ry, t.rz, t.sx, t.sy, t.sz, t.col, NOW(), NOW()
      FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[],
                  $5::float8[], $6::float8[], $7::float8[],
                  $8::float8[], $9::float8[], $10::float8[],
                  $11::float8[], $12::float8[], $13::float8[],
                  $14::boolean[])
        AS t(type, name, model_path, model_type, px, py, pz, rx, ry, rz, sx, sy, sz, col)
      RETURNING id`;
    const params = [
      col('type'), col('name'), col('model_path'), col('model_type'),
      col('position_x'), col('position_y'), col('position_z'),
      col('rotation_x'), col('rotation_y'), col('rotation_z'),
      col('scale_x'), col('scale_y'), col('scale_z'),
      col('has_collision')
    ];

    let ids = [];
    try {
      const ins = await pool.query(sqlWithCollision, params);
      ids = ins.rows.map((r) => r.id);
    } catch (e) {
      if (e && e.code === '42703') {
        // 老库没有 has_collision 列：去掉它重试一次（与既有插入逻辑的兜底风格一致）
        const sqlNoCol = `
          INSERT INTO world_objects
            (type, name, model_path, model_type,
             position_x, position_y, position_z,
             rotation_x, rotation_y, rotation_z,
             scale_x, scale_y, scale_z, created_at, updated_at)
          SELECT t.type, t.name, t.model_path, t.model_type,
                 t.px, t.py, t.pz, t.rx, t.ry, t.rz, t.sx, t.sy, t.sz, NOW(), NOW()
          FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[],
                      $5::float8[], $6::float8[], $7::float8[],
                      $8::float8[], $9::float8[], $10::float8[],
                      $11::float8[], $12::float8[], $13::float8[])
            AS t(type, name, model_path, model_type, px, py, pz, rx, ry, rz, sx, sy, sz)
          RETURNING id`;
        const ins2 = await pool.query(sqlNoCol, params.slice(0, 13));
        ids = ins2.rows.map((r) => r.id);
      } else {
        throw e;
      }
    }

    // 【2026-11-12】整套导入自动归入一个编组：
    // 原先 300+ 个零件平铺在对象列表里，完全没法看。现在导入完成即建组，
    // 编辑器重载后这批对象会作为一个可折叠的「组」出现。
    // 失败不影响导入本身（比如迁移没跑、表不存在）。
    let groupId = null;
    let groupName = null;
    try {
      if (ids.length >= 2) {
        groupName = String((kit.title || '套件') + ' × ' + ids.length).slice(0, 120);
        const gres = await pool.query(
          `INSERT INTO world_object_groups (world_id, name)
           VALUES ((SELECT world_id FROM world_objects WHERE id = $1), $2)
           RETURNING id`,
          [ids[0], groupName]
        );
        groupId = gres.rows[0].id;
        await pool.query(
          'UPDATE world_objects SET group_id = $1, updated_at = NOW() WHERE id = ANY($2::int[])',
          [groupId, ids]
        );
      }
    } catch (e) {
      console.warn('[free-assets] 自动编组失败（不影响导入）:', e && e.message);
      groupId = null;
      groupName = null;
    }

    log('整套导入完成:', kit.title, '摆放点', ids.length, '零件', models.length,
      '失败', partErrors.length, '地形', terrainPart && pathById.__terrain ? '有' : '无');
    res.json({
      success: true,
      kit: { id: kit.id, title: kit.title, page: kit.page || '' },
      created: ids.length,
      createdIds: ids,          // 新建对象 id（前端可用于聚焦/选中单个）
      groupId: groupId,         // 自动创建的编组 id（编辑器的对象列表会以组的形式展示）
      groupName: groupName,
      firstId: ids[0] || null,
      placements: layout.length,
      distinctParts: parts.length,
      downloaded: models.length,
      failed: partErrors.length,
      hasTerrain: !!(terrainPart && pathById.__terrain),
      foreignParts: parts.filter((x) => x.foreign).map((x) => x.key),
      models,
      skipped: conv.stats.skipped,
      partErrors: partErrors.slice(0, 20),
      unresolvedKeys,
      complete: partErrors.length === 0,
      note: partErrors.length
        ? '⚠️ 有 ' + partErrors.length + ' 个零件下载失败，素材库/场景会缺件（详见 partErrors），可再导入一次补齐'
        : '零件已全部下载完整（含地形与跨套件借用件）；逐件参数（params）差异未回放；碰撞默认关闭'
    });
  } catch (e) {
    const status = e && e.status ? (e.status === 404 ? 404 : 502) : 500;
    console.error('[free-assets] 整套导入失败:', e);
    res.status(status).json({ success: false, error: String(e && e.message || e) });
  }
});

/* ============================ API key 管理 ============================ */

/** 是否已配置 key（只回布尔与尾 4 位，绝不下发 key 本体） */
router.get('/key-status', async (req, res) => {
  try {
    const id = String(req.query.provider || 'polyfork');
    const key = await providers.resolveApiKey(id);
    res.json({
      success: true,
      provider: id,
      configured: !!key,
      tail: key ? key.slice(-4) : '',
      fromEnv: !!(providers.getProvider(id) && process.env[providers.getProvider(id).keyEnv])
    });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

/** 保存 key（管理员；走 apiWriteGuard 的 admin 策略） */
router.put('/key', async (req, res) => {
  try {
    const id = String((req.body && req.body.provider) || 'polyfork');
    const p = providers.getProvider(id);
    if (!p || !p.keyConfigKey) return res.status(400).json({ success: false, error: '该资产源不需要 key' });

    const key = String((req.body && req.body.key) || '').trim();
    if (!key) return res.status(400).json({ success: false, error: 'key 不能为空' });
    if (key.length < 8 || key.length > 200) return res.status(400).json({ success: false, error: 'key 长度异常' });

    const configService = require('../services/configService');
    await configService.setConfig(p.keyConfigKey, key);

    // 配好 key 之后 kit 详情缓存要失效，否则还回上一次"没有 layout"的结果
    for (const k of Array.from(listCache.keys())) {
      if (k.indexOf('kit:') === 0) listCache.delete(k);
    }

    log('已更新 API key（' + id + '，尾号 ' + key.slice(-4) + '）');
    res.json({ success: true, configured: true, tail: key.slice(-4) });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

module.exports = router;
