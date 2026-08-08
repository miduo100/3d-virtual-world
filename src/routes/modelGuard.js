/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 远程模型守卫 API
 *
 * GET  /api/model-guard/config        公开接口 - 获取当前阈值配置
 * PUT  /api/admin/model-guard/config  管理接口 - 更新阈值（需认证）
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/configService');

// 默认值常量
const DEFAULTS = {
  max_file_size: 10,
  max_triangles: 50000,
  max_vertices: 30000,
  max_mesh_count: 20,
  enabled: false,
  show_warning: true,
  placeholder_style: 'stickman',
  // 角色动画模式：retarget = 现有重定向（省资源），self_contained = 自包含包（高保真）
  character_bundle_mode: 'retarget',
  // 动画守卫开关与阈值
  anim_guard_enabled: true,
  anim_max_file_size: 5,
  // 默认 1000：Mixamo 等全骨骼平台动画 195~300 条轨道属常态，200 会误伤
  anim_max_tracks: 1000,
  anim_max_keyframes: 20000,
  anim_max_duration: 30,
  anim_max_meshes: 10,
  anim_total_max_size: 30,
  anim_guard_remote_only: true
};

// 允许范围检查 [min, max]
const RANGES = {
  max_file_size: [1, 500],
  max_triangles: [1000, 10000000],
  max_vertices: [500, 5000000],
  max_mesh_count: [1, 1000],
  anim_max_file_size: [1, 500],
  anim_max_tracks: [10, 5000],
  anim_max_keyframes: [100, 1000000],
  anim_max_duration: [1, 600],
  anim_max_meshes: [0, 500],
  anim_total_max_size: [1, 500]
};

// 字符串枚举校验
const ENUMS = {
  character_bundle_mode: ['retarget', 'self_contained']
};

function toKey(key) {
  return 'model_guard.' + key;
}

// ===== GET /api/model-guard/config =====
router.get('/config', async (req, res) => {
  try {
    const config = {};
    for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
      const value = await configService.getConfig(toKey(key));

      if (typeof defaultValue === 'boolean') {
        config[key] = value === 'true' || value === true;
      } else if (typeof defaultValue === 'number') {
        const n = parseInt(value, 10);
        config[key] = Number.isFinite(n) ? n : defaultValue;
      } else {
        config[key] = value || defaultValue;
      }
    }

    console.log('[ModelGuard] 配置已发送:', JSON.stringify(config));
    res.json({ success: true, config });
  } catch (error) {
    console.error('[ModelGuard] 获取配置失败:', error);
    res.json({ success: true, config: DEFAULTS });
  }
});

// ===== PUT /api/admin/model-guard/config =====
const { authenticateAdminToken } = require('../middleware/adminAuth');

router.put('/config', authenticateAdminToken, async (req, res) => {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: '无效的配置格式' });
    }

    const results = [];
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    for (const [key, rawValue] of Object.entries(config)) {
      if (!(key in DEFAULTS)) {
        results.push({ key, success: false, error: '不允许的配置项' });
        continue;
      }

      let finalValue = rawValue;
      const expectedType = typeof DEFAULTS[key];

      if (expectedType === 'number') {
        const n = parseInt(rawValue, 10);
        if (!Number.isFinite(n)) {
          results.push({ key, success: false, error: '必须是数字' });
          continue;
        }

        const range = RANGES[key];
        if (range && (n < range[0] || n > range[1])) {
          results.push({ key, success: false, error: '超出允许范围(' + range[0] + '-' + range[1] + ')' });
          continue;
        }
        finalValue = String(n);
      } else if (expectedType === 'boolean') {
        finalValue = Boolean(rawValue).toString();
      } else {
        finalValue = String(rawValue);
      }

      // 枚举校验（如 character_bundle_mode）
      const enumValues = ENUMS[key];
      if (enumValues && !enumValues.includes(finalValue)) {
        results.push({ key, success: false, error: '必须是: ' + enumValues.join('/') });
        continue;
      }

      await configService.setConfig(toKey(key), finalValue, req.user?.id || null, ipAddress);
      results.push({ key, success: true });
    }

    console.log('[ModelGuard] 管理员 ' + (req.user?.username || 'unknown') + ' 更新了模型守卫配置');
    res.json({
      success: true,
      message: '配置已保存，立即生效',
      results
    });
  } catch (error) {
    console.error('[ModelGuard] 更新失败:', error);
    res.status(500).json({ error: '更新失败: ' + error.message });
  }
});

module.exports = router;
