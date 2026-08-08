/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码库路由
 * 提供代码块的增删改查。加入世界时，前端把块的 code 写入 world_objects.threejs_code，
 * 玩家端 world.js 的 addThreeJSModel 即可渲染，无需改动 world.js 大文件核心逻辑。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');

// GET /api/threejs-blocks  列表（公开读，供世界编辑器面板使用）
router.get('/', async (req, res) => {
  try {
    const { search = '', tag = '', limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }
    if (tag) {
      params.push(tag);
      conditions.push(`$${params.length} = ANY(tags)`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const data = await query(
      `SELECT id, name, description, tags, thumbnail_url, created_at, char_length(code) AS code_length
       FROM threejs_code_blocks ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const countRes = await query(`SELECT COUNT(*) FROM threejs_code_blocks ${where}`, params);
    res.json({ success: true, blocks: data.rows, total: parseInt(countRes.rows[0].count) });
  } catch (e) {
    console.error('获取Three.js代码块列表失败:', e);
    res.status(500).json({ success: false, error: '获取列表失败' });
  }
});

// GET /api/threejs-blocks/:id  单个（含完整 code，供渲染/编辑）
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM threejs_code_blocks WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: '代码块不存在' });
    res.json({ success: true, block: result.rows[0] });
  } catch (e) {
    console.error('获取Three.js代码块失败:', e);
    res.status(500).json({ success: false, error: '获取失败' });
  }
});

// POST /api/threejs-blocks  新增
router.post('/', authenticateAdminToken, async (req, res) => {
  try {
    const { name, description = '', code, raw_code = '', clean_options = {}, tags = [],
            source_type = 'paste', auto_fixes = [], import_status = 'ok' } = req.body;
    if (!name) return res.status(400).json({ success: false, error: '名称不能为空' });
    if (!code || !code.trim()) return res.status(400).json({ success: false, error: '代码不能为空' });
    const tagsArr = Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []);
    const cleanOpts = (typeof clean_options === 'object' && clean_options) ? clean_options : {};
    const fixesArr = Array.isArray(auto_fixes) ? auto_fixes : [];
    const result = await query(
      `INSERT INTO threejs_code_blocks (name, description, code, raw_code, clean_options, tags, source_type, auto_fixes, import_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, description, code, raw_code || code, JSON.stringify(cleanOpts), tagsArr, source_type, JSON.stringify(fixesArr), import_status]
    );
    res.json({ success: true, block: result.rows[0] });
  } catch (e) {
    console.error('保存Three.js代码块失败:', e);
    res.status(500).json({ success: false, error: '保存失败: ' + e.message });
  }
});

// PUT /api/threejs-blocks/:id  编辑
router.put('/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, code, raw_code, clean_options, tags, source_type, auto_fixes, import_status } = req.body;
    const exist = await query('SELECT id FROM threejs_code_blocks WHERE id=$1', [id]);
    if (!exist.rows.length) return res.status(404).json({ success: false, error: '代码块不存在' });
    const cur = exist.rows[0];
    const newName = name !== undefined ? name : cur.name;
    const newDesc = description !== undefined ? description : cur.description;
    const newCode = code !== undefined ? code : cur.code;
    const newRaw = raw_code !== undefined ? raw_code : cur.raw_code;
    const newOpts = clean_options !== undefined ? clean_options : cur.clean_options;
    const newTags = tags !== undefined
      ? (Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean))
      : cur.tags;
    const newSourceType = source_type !== undefined ? source_type : (cur.source_type || 'paste');
    const newAutoFixes = auto_fixes !== undefined ? (Array.isArray(auto_fixes) ? auto_fixes : []) : (cur.auto_fixes || []);
    const newImportStatus = import_status !== undefined ? import_status : (cur.import_status || 'ok');
    const result = await query(
      `UPDATE threejs_code_blocks
       SET name=$1, description=$2, code=$3, raw_code=$4, clean_options=$5, tags=$6,
           source_type=$7, auto_fixes=$8, import_status=$9, updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 RETURNING *`,
      [newName, newDesc, newCode, newRaw,
       JSON.stringify(typeof newOpts === 'object' ? newOpts : {}), newTags,
       newSourceType, JSON.stringify(Array.isArray(newAutoFixes) ? newAutoFixes : []),
       newImportStatus, id]
    );
    res.json({ success: true, block: result.rows[0] });
  } catch (e) {
    console.error('更新Three.js代码块失败:', e);
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// DELETE /api/threejs-blocks/:id  删除
router.delete('/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM threejs_code_blocks WHERE id=$1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: '代码块不存在' });
    res.json({ success: true });
  } catch (e) {
    console.error('删除Three.js代码块失败:', e);
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

module.exports = router;
