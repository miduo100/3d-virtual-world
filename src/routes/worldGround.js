/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 地块（地面）配置管理路由
 * GET /api/world/ground-config  读取地块配置
 * PUT /api/world/ground-config  保存地块配置（system_config 表）
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

// 默认主地块配置：2000×2000，与主场景 CONFIG.WORLD_SIZE*2 一致
const DEFAULT_GROUND = { width: 2000, depth: 2000, gridSize: 100, color: '#2d5016' };

// GET /api/world/ground-config
router.get('/ground-config', async (req, res) => {
  try {
    const result = await query(
      "SELECT config_value FROM system_config WHERE config_key = 'world_ground_config'"
    );
    if (result.rows.length > 0) {
      try {
        const cfg = JSON.parse(result.rows[0].config_value);
        // 与默认值合并，避免旧配置缺少字段
        return res.json({ success: true, config: { ...DEFAULT_GROUND, ...cfg } });
      } catch (e) {
        console.warn('⚠️ 地块配置解析失败，使用默认配置:', e.message);
      }
    }
    res.json({ success: true, config: DEFAULT_GROUND });
  } catch (error) {
    console.error('获取地块配置失败:', error);
    res.status(500).json({ success: false, message: '获取地块配置失败' });
  }
});

// PUT /api/world/ground-config
router.put('/ground-config', async (req, res) => {
  try {
    const body = req.body || {};
    const width    = clampNum(body.width, 10, 10000, DEFAULT_GROUND.width);
    const depth    = clampNum(body.depth, 10, 10000, DEFAULT_GROUND.depth);
    const gridSize = clampInt(body.gridSize, 1, 500, DEFAULT_GROUND.gridSize);
    const color    = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : DEFAULT_GROUND.color;

    const config = { width, depth, gridSize, color };

    await query(
      `INSERT INTO system_config (config_key, config_value, description)
       VALUES ('world_ground_config', $1, '世界主地块大小配置')
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(config)]
    );

    console.log('✅ 地块配置保存成功:', config);
    res.json({ success: true, config });
  } catch (error) {
    console.error('保存地块配置失败:', error);
    res.status(500).json({ success: false, message: '保存地块配置失败' });
  }
});

function clampNum(v, min, max, def) {
  const n = parseFloat(v);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

module.exports = router;
