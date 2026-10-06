/**
 * 零件库管理 + 零件检索（Phase 1）
 *
 * 供零件库独立主页面使用：
 *   GET  /api/part-library/libraries            库列表（库卡片网格）
 *   GET  /api/part-library/libraries/:id        库详情（含零件网格数据）
 *   GET  /api/part-library/libraries/:id/spec   零件说明书 JSON（F.6.6，World AI 的装配输入）
 *   PUT  /api/part-library/libraries/:id        编辑元信息
 *   POST /api/part-library/libraries/:id/status 归档 / 恢复 / 核验
 *   GET  /api/part-library/search               零件检索（页内唯一入口，人机共用逻辑）
 *   GET  /api/part-library/facets              筛选选项（角色 / 风格）
 *   GET  /api/part-library/split               资产拆分（上传模型页顶部提示用）
 */
const express = require('express');
const { pool } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');

const router = express.Router();
router.use(authenticateAdminToken);

const STATUSES = ['active', 'archived', 'pending_review', 'rejected'];
// 模数必须保留 4 位小数：Kenney modular-buildings 层高是 0.625m，
// 四舍五入成 0.63 会让 World AI 拼楼算错层高（差 8mm/层 → 3 层差 1.6cm）。
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const r4 = n => Math.round(Number(n || 0) * 10000) / 10000;

// ── 库列表 ─────────────────────────────────────────────────────────
router.get('/libraries', async (req, res) => {
  try {
    const includeArchived = String(req.query.includeArchived || '') === '1';
    const r = await pool.query(
      `SELECT l.id, l.pack_key, l.display_name, l.style_family, l.description,
              l.source_type, l.source_ref, l.license_info, l.cover_image, l.status,
              l.priority, l.stats, l.created_at, l.updated_at, l.reviewed_at,
              a.username AS reviewed_by_name,
              (SELECT COUNT(*)::int FROM part_library_items i WHERE i.library_id = l.id) AS item_count,
              (SELECT COUNT(*)::int FROM part_library_items i
                WHERE i.library_id = l.id AND i.thumbnail IS NOT NULL) AS thumb_count
         FROM part_libraries l
         LEFT JOIN admin_users a ON a.id = l.reviewed_by
        WHERE ($1::boolean OR l.status <> 'archived')
        ORDER BY l.status ASC, l.priority ASC, l.display_name ASC`,
      [includeArchived]
    );
    const totals = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM part_libraries WHERE status='active') AS active_libs,
              (SELECT COUNT(*)::int FROM part_libraries WHERE status='pending_review') AS pending_libs,
              (SELECT COUNT(*)::int FROM part_libraries WHERE status='archived') AS archived_libs,
              (SELECT COUNT(*)::int FROM part_library_items) AS total_items,
              (SELECT COALESCE(SUM((metadata->>'tris')::bigint),0) FROM part_library_items) AS total_tris`
    );
    res.json({ success: true, libraries: r.rows, totals: totals.rows[0] });
  } catch (error) {
    console.error('❌ 零件库列表失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 库详情 ─────────────────────────────────────────────────────────
router.get('/libraries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'id 非法' });
    const lib = await pool.query('SELECT * FROM part_libraries WHERE id = $1', [id]);
    if (!lib.rows.length) return res.status(404).json({ success: false, error: '库不存在' });

    const roles = await pool.query(
      `SELECT part_role, COUNT(*)::int AS n FROM part_library_items
        WHERE library_id = $1 GROUP BY part_role ORDER BY n DESC`, [id]);
    const items = await pool.query(
      `SELECT i.id, i.model_id, i.part_key, i.part_role, i.part_subtype,
              i.grid_w, i.grid_h, i.grid_d, i.collidable, i.repeat_allowed,
              i.stack_rule, i.lod_policy, i.thumbnail,
              i.metadata->>'tris' AS tris, i.metadata->>'mats' AS mats,
              u.file_name, u.path AS model_path
         FROM part_library_items i
         JOIN uploaded_models u ON u.id = i.model_id
        WHERE i.library_id = $1
        ORDER BY i.part_role, i.part_key LIMIT 200`, [id]);
    res.json({
      success: true,
      library: lib.rows[0],
      roleCount: Object.fromEntries(roles.rows.map(r => [r.part_role, r.n])),
      items: items.rows,
    });
  } catch (error) {
    console.error('❌ 零件库详情失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 编辑元信息 ─────────────────────────────────────────────────────
router.put('/libraries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'id 非法' });
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE part_libraries SET
         display_name = COALESCE($1, display_name),
         style_family = COALESCE($2, style_family),
         description  = COALESCE($3, description),
         priority     = COALESCE($4, priority),
         updated_at   = NOW()
       WHERE id = $5 RETURNING *`,
      [
        b.displayName ? String(b.displayName).slice(0, 120) : null,
        b.styleFamily ? String(b.styleFamily).slice(0, 60) : null,
        b.description !== undefined ? String(b.description).slice(0, 2000) : null,
        Number.isInteger(b.priority) ? b.priority : null,
        id,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '库不存在' });
    res.json({ success: true, library: r.rows[0] });
  } catch (error) {
    console.error('❌ 零件库更新失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 状态：归档 / 恢复 / 核验 ───────────────────────────────────────
router.post('/libraries/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'id 非法' });
    const s = String((req.body && req.body.status) || '');
    if (!STATUSES.includes(s)) return res.status(400).json({ success: false, error: '状态非法' });
    const adminId = (req.adminUser && (req.adminUser.adminUserId || req.adminUser.id)) || null;
    const r = await pool.query(
      `UPDATE part_libraries
          SET status = $1, reviewed_at = NOW(), updated_at = NOW(),
              reviewed_by = COALESCE($2, reviewed_by)
        WHERE id = $3 RETURNING *`,
      [s, adminId, id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '库不存在' });
    res.json({ success: true, library: r.rows[0] });
  } catch (error) {
    console.error('❌ 零件库状态更新失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 零件检索（页内唯一入口；与 World AI 的 partSearch 同一套逻辑）──
router.get('/search', async (req, res) => {
  try {
    const q = req.query || {};
    const limit = Math.min(parseInt(q.limit, 10) || 60, 200);
    const where = ["i.library_id IS NOT NULL"];
    const params = [];
    // ⚠️ 参数与占位符必须成对登记：params 只装**值**，where 只装 SQL 片段。
    // 此前各过滤条件把 SQL 片段 push 进了 params（值从未入列），导致 $1 被 limit 顶替：
    // 关键字永远匹配不到（ILIKE '60'），role/style/gridW 也一并失效。
    const ph = () => `$${params.length + 1}`;
    if (String(q.includeInactive || '') !== '1') where.push("l.status = 'active'");
    if (q.role) { const p = ph(); params.push(String(q.role).slice(0, 40)); where.push(`i.part_role = ${p}`); }
    if (q.style) { const p = ph(); params.push(String(q.style).slice(0, 60)); where.push(`l.style_family = ${p}`); }
    if (q.packKey) { const p = ph(); params.push(String(q.packKey).slice(0, 60)); where.push(`l.pack_key = ${p}`); }
    const gw = parseFloat(q.gridW);
    if (Number.isFinite(gw)) {
      const p = ph(); params.push(gw);
      where.push(`ABS(COALESCE(i.grid_w,0) - ${p}) < 0.51`);
    }
    if (q.q) {
      const p = ph(); params.push('%' + String(q.q).slice(0, 80) + '%');
      where.push(`(i.part_key ILIKE ${p} OR i.part_subtype ILIKE ${p})`);
    }

    // 排序：
    //  · 有筛选条件 → 按库名 + 角色 + 键名（可预期）
    //  · 无筛选条件 → **结构件优先**。此前纯按库名字母序，`kenney 3d road tiles` 永远第一
    //    → 点「刷新」后首屏 120 张全是地砖（roadTile_001…），用户会以为页面坏了。
    //    这里只调顺序，不隐藏任何零件；road/ground 仍在结果里（排在后面）。
    const filtered = !!(q.role || q.style || q.packKey || q.q || Number.isFinite(gw));
    const roleRank = `CASE i.part_role
      WHEN 'wall' THEN 1 WHEN 'window' THEN 2 WHEN 'door' THEN 3 WHEN 'column' THEN 4
      WHEN 'roof' THEN 5 WHEN 'cornice' THEN 6 WHEN 'awning' THEN 7 WHEN 'stairs' THEN 8
      WHEN 'railing' THEN 9 WHEN 'floor' THEN 10 WHEN 'prop' THEN 11 WHEN 'nature' THEN 12
      WHEN 'ground' THEN 13 WHEN 'road' THEN 14 ELSE 20 END`;
    const orderBy = filtered
      ? 'l.display_name, i.part_role, i.part_key'
      : `${roleRank}, l.display_name, i.part_key`;
    params.push(limit);
    const r = await pool.query(
      `SELECT i.id, i.library_id, i.model_id, i.part_key, i.part_role, i.part_subtype,
              i.grid_w, i.grid_h, i.grid_d, i.collidable, i.repeat_allowed,
              i.stack_rule, i.lod_policy, i.thumbnail,
              i.metadata->>'tris' AS tris, i.metadata->>'mats' AS mats,
              i.metadata->>'externalTextures' AS external_textures,
              l.pack_key, l.display_name AS library_name, l.style_family,
              l.status AS library_status, u.file_name, u.path AS model_path,
              COUNT(*) OVER() AS total          -- ★真实命中总数（不受 limit 影响）
         FROM part_library_items i
         JOIN part_libraries l ON l.id = i.library_id
         JOIN uploaded_models u ON u.id = i.model_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.length}`,
      params
    );
    // ⚠ count = 本次返回条数（被 limit 截断）；total = 真实命中数。
    //   此前把 count 当"命中数"报给前端，空条件时页面显示「命中 120 个」，实际有 2,143 件。
    const total = r.rows.length ? Number(r.rows[0].total) : 0;
    res.json({ success: true, count: r.rows.length, total, limit, truncated: total > r.rows.length, items: r.rows });
  } catch (error) {
    console.error('❌ 零件检索失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 零件说明书 JSON（F.6.6）= World AI 的装配输入 ──────────────────
// ⚠ 必须挂在 /libraries/:id 之后不影响：Express 按整段路径匹配，/libraries/5/spec 不会命中 /libraries/:id
router.get('/libraries/:id/spec', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'id 非法' });
    const lib = await pool.query('SELECT * FROM part_libraries WHERE id = $1', [id]);
    if (!lib.rows.length) return res.status(404).json({ success: false, error: '库不存在' });
    const L = lib.rows[0];

    const items = await pool.query(
      `SELECT i.part_key, i.part_role, i.part_subtype, i.grid_w, i.grid_h, i.grid_d,
              i.collidable, i.stack_rule, i.lod_policy, i.thumbnail,
              i.metadata->>'tris' AS tris, u.path AS model_path, u.file_name
         FROM part_library_items i
         JOIN uploaded_models u ON u.id = i.model_id
        WHERE i.library_id = $1
        ORDER BY i.part_role, i.part_key`, [id]);

    // 模数系统 = 出现次数最多的 (w,h,d) 组合（Kenney 模数化体系全库同一模数）
    const gridCount = new Map();
    for (const it of items.rows) {
      if (!(Number(it.grid_w) > 0)) continue;
      const k = `${r4(it.grid_w)} x ${r4(it.grid_h)} x ${r4(it.grid_d)}`;
      gridCount.set(k, (gridCount.get(k) || 0) + 1);
    }
    const topGrid = [...gridCount.entries()].sort((a, b) => b[1] - a[1])[0];
    const roles = {};
    for (const it of items.rows) {
      const r = (roles[it.part_role] = roles[it.part_role] || { count: 0, collidable: it.collidable, variants: [] });
      r.count++;
      if (r.variants.length < 80) r.variants.push(it.part_key);
    }
    const byFormat = {};
    for (const it of items.rows) {
      const e = (String(it.model_path).match(/\.(\w+)$/) || [])[1] || '?';
      byFormat[e] = (byFormat[e] || 0) + 1;
    }

    const spec = {
      packKey: L.pack_key,
      displayName: L.display_name,
      styleFamily: L.style_family,
      license: L.license_info || null,
      status: L.status,
      gridSystem: topGrid ? {
        moduleW: r4(Number(String(topGrid[0]).split(' x ')[0])),
        floorH: r4(Number(String(topGrid[0]).split(' x ')[1])),
        depth: r4(Number(String(topGrid[0]).split(' x ')[2])),
        unit: 'm', dominant: topGrid[0], dominantRatio: r2(topGrid[1] / Math.max(1, items.rows.length)),
        distinct: gridCount.size,
      } : null,
      roles,
      totals: {
        parts: items.rows.length,
        totalTris: items.rows.reduce((s, x) => s + (Number(x.tris) || 0), 0),
        byFormat,
        thumbnailCount: items.rows.filter(x => x.thumbnail).length,
      },
      rules: [
        '同一 part_role 的零件必须用同一材质预设，逐件调色会导致合批失效（custom_config 非空即否决合批）',
        '角柱类零件 stack_rule=vertical，可按 Bottom/Center/…/Top 堆叠',
        'repeat 阵列时必须使用完全相同的 part_key 与参数，否则批次分裂',
        '每个 part_role 至少 80% 的零件应来自 primary 库，跨库超 20% 会输出风格警告',
        '窗/檐/屋顶 collidable=false（可贴墙不挡路）；墙/门/柱 collidable=true',
      ],
      items: items.rows.map(x => ({
        partKey: x.part_key, role: x.part_role, subtype: x.part_subtype,
        grid: [r4(x.grid_w), r4(x.grid_h), r4(x.grid_d)], tris: Number(x.tris) || 0,
        collidable: x.collidable, stackRule: x.stack_rule, lodPolicy: x.lod_policy,
        thumbnail: x.thumbnail, modelPath: x.model_path,
      })),
    };
    res.json({ success: true, spec });
  } catch (error) {
    console.error('❌ 零件说明书生成失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 筛选选项 ───────────────────────────────────────────────────────
router.get('/facets', async (req, res) => {
  try {
    const roles = await pool.query(
      `SELECT i.part_role, COUNT(*)::int AS n FROM part_library_items i
         JOIN part_libraries l ON l.id = i.library_id
        WHERE l.status = 'active' GROUP BY i.part_role ORDER BY n DESC`);
    const styles = await pool.query(
      `SELECT style_family, COUNT(*)::int AS n FROM part_libraries
        WHERE status = 'active' AND style_family IS NOT NULL
        GROUP BY style_family ORDER BY n DESC`);
    res.json({ success: true, roles: roles.rows, styles: styles.rows });
  } catch (error) {
    console.error('❌ 筛选选项失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

// ── 资产拆分（上传模型页顶部提示：零件不进此列表）─────────────────
router.get('/split', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE part_category = 'model')::int AS model_count,
              COUNT(*) FILTER (WHERE part_category = 'part')::int  AS part_count,
              COUNT(*)::int AS total_count
         FROM uploaded_models`
    );
    res.json({ success: true, ...r.rows[0] });
  } catch (error) {
    console.error('❌ 资产拆分统计失败:', error);
    res.status(500).json({ success: false, error: String(error.message || error).slice(0, 200) });
  }
});

module.exports = router;
