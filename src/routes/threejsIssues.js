/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 问题库「词条配置」路由（2026-09-24）
 *
 * 设计意图：把"清单型"规则的数据（内置加载器白名单 / 已删除 API 清单 / 灯光类名 /
 * 允许的外链域名 / 阈值 / 规则启停）从代码里抽出来，存到 system_config，
 * 后台可视化增删，改完立即对预览与离线体检生效——不需要改代码、不需要发版。
 *
 * GET  /api/threejs-issues/config   公开读（前端世界/预览/CLI 都要用）
 * PUT  /api/threejs-issues/config   管理员写（authenticateAdminToken）
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');

const CONFIG_KEY = 'threejs_issue_config';
const MAX_ARRAY = 300;    // 单个清单最多条目数
const MAX_ITEM_LEN = 120; // 单条目最大长度

// 允许的键与类型（不在表内的键一律丢弃，防脏数据）
const SHAPE = {
  loaders: 'stringArray',
  deadApi: 'stringArray',
  lights: 'stringArray',
  externalHostsAllow: 'stringArray',
  rulesDisabled: 'stringArray',
  notes: 'string'
};
const THRESHOLD_RANGES = {
  bigGeometry: [10, 100000],   // 几何参数大于该值 → 提示尺寸超标
  bigDimension: [1, 5000],     // 世界侧自动缩小阈值（米）
  timers: [1, 100],            // setInterval 数量阈值
  minObjectDim: [0.01, 10]     // 世界侧最小可见尺寸（米）：小于该值自动放大到 1m
};

function sanitizeArray(arr) {
  if (!Array.isArray(arr)) return undefined;
  return arr
    .filter(function (x) { return typeof x === 'string' && x.trim(); })
    .map(function (x) { return x.trim().slice(0, MAX_ITEM_LEN); })
    .slice(0, MAX_ARRAY);
}

function sanitizeConfig(input) {
  const out = {};
  const dropped = [];
  if (!input || typeof input !== 'object') return { config: out, dropped: ['<非对象>'] };

  Object.keys(input).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(SHAPE, k)) {
      if (SHAPE[k] === 'stringArray') {
        const v = sanitizeArray(input[k]);
        if (v) out[k] = v;
      } else if (typeof input[k] === 'string') {
        out[k] = input[k].slice(0, 2000);
      }
      return;
    }
    if (k === 'thresholds') {
      const t = input[k];
      if (t && typeof t === 'object') {
        const tt = {};
        Object.keys(THRESHOLD_RANGES).forEach(function (tk) {
          const num = Number(t[tk]);
          if (Number.isFinite(num)) {
            const r = THRESHOLD_RANGES[tk];
            tt[tk] = Math.min(Math.max(num, r[0]), r[1]);
          }
        });
        out.thresholds = tt;
      }
      return;
    }
    dropped.push(k);
  });

  if (out.rulesDisabled) {
    out.rulesDisabled = out.rulesDisabled.filter(function (id) { return /^ISS-\d{4}$/.test(id); });
  }
  return { config: out, dropped: dropped };
}

async function readSaved() {
  const r = await query('SELECT config_value, updated_at FROM system_config WHERE config_key=$1', [CONFIG_KEY]);
  if (!r.rows.length || !r.rows[0].config_value) return { config: null, updatedAt: null };
  try {
    return { config: JSON.parse(r.rows[0].config_value), updatedAt: r.rows[0].updated_at };
  } catch (e) {
    console.warn('[threejs-issues] 配置 JSON 解析失败，按未配置处理:', e.message);
    return { config: null, updatedAt: null, parseError: true };
  }
}

// 公开读：前端（世界/预览/后台）与离线体检共用
router.get('/config', async (req, res) => {
  try {
    const saved = await readSaved();
    res.json({ success: true, config: saved.config, updatedAt: saved.updatedAt });
  } catch (e) {
    console.error('读取 Three.js 问题库配置失败:', e);
    res.status(500).json({ success: false, error: '读取配置失败' });
  }
});

// 管理员写
router.put('/config', authenticateAdminToken, async (req, res) => {
  try {
    const { config, dropped } = sanitizeConfig(req.body && req.body.config);
    if (dropped && dropped.length) console.warn('[threejs-issues] 忽略未知配置键:', dropped.join(', '));
    const json = JSON.stringify(config);
    await query(
      `INSERT INTO system_config (config_key, config_value, description, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (config_key) DO UPDATE SET config_value=$2, description=$3, updated_at=CURRENT_TIMESTAMP`,
      [CONFIG_KEY, json, 'Three.js 问题库词条配置（后台可视化维护）']
    );
    if (typeof logAdminAction === 'function') {
      try { await logAdminAction(req, 'update_threejs_issue_config', { keys: Object.keys(config) }); } catch (e) {}
    }
    res.json({ success: true, config: config, dropped: dropped || [] });
  } catch (e) {
    console.error('保存 Three.js 问题库配置失败:', e);
    res.status(500).json({ success: false, error: '保存配置失败: ' + e.message });
  }
});

module.exports = router;
