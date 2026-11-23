/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundPads.js —— ③ 环境声景的「声音点位」存取
 *
 * 为什么拆出来：soundScenes.js 加完点位已经 506 行，超项目 500 行红线。
 * 本模块只管一件事：把「声音 + 坐标 + 可听半径 + 音量」这份列表读出来 / 整体写回去。
 *
 * 为什么是点位而不是区域：
 *   world_regions 里那 17 条全是 AI 建楼的占地框（60×60 之类，名字是「体检楼/验收别墅」），
 *   给它们挂环境声等于给建筑挂声音，概念是错的。
 *   环境声真正要的是「一段声音 + 它自己的坐标 + 可听半径」，而且同一个声音要能放在多个位置
 *   （同一段鸟叫，林子里放三处），所以主键是点位，不是声音，也不是区域。
 *
 * 存储：system_config['ambient_pads']（JSONB 数组），与 audio_weather 同表同套路，零建表。
 * 单条结构：{ id, name, url, x, y, z, radius, volume, loop, fadeIn, enabled }
 *
 * 挂载（soundScenes.js，必须在 authenticateAdminToken 之后，点位是后台功能）：
 *   router.use(require('./soundPads').router)
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

const KEY = 'ambient_pads';
const MAX_PADS = 300;

function asJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/**
 * 单条点位归一化：半径 1~2000 米、音量 0~1、淡入 0.2~10 秒，超界一律夹紧而不是报错
 * y 是高度，参与三维距离计算（树冠上的鸟叫、地下室的回声都靠它）
 */
function normPad(p, i) {
  const num = (v, dflt) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  };
  return {
    id: String(p.id || ('pad_' + Date.now() + '_' + i)),
    name: String(p.name || '').slice(0, 80),
    url: String(p.url || '').slice(0, 500),
    x: num(p.x, 0),
    y: num(p.y, 0),
    z: num(p.z, 0),
    radius: Math.max(1, Math.min(2000, num(p.radius, 30))),
    volume: Math.max(0, Math.min(1, num(p.volume, 0.5))),
    loop: p.loop !== false,
    fadeIn: Math.max(0.2, Math.min(10, num(p.fadeIn, 2))),
    enabled: p.enabled !== false
  };
}

/** 给 /ambience（公开）和 /assets（引用计数）复用 */
async function readPads() {
  const r = await query(`SELECT config_value FROM system_config WHERE config_key = '${KEY}'`);
  const v = r.rows.length ? asJson(r.rows[0].config_value) : null;
  return Array.isArray(v) ? v : [];
}

router.get('/', async (req, res) => {
  try {
    res.json({ success: true, pads: await readPads() });
  } catch (e) {
    console.error('[soundPads] 读取失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 整体替换：前端每次保存把整份列表送上来，省掉单条增删改三套接口
router.put('/', async (req, res) => {
  try {
    let pads = req.body ? req.body.pads : null;
    if (typeof pads === 'string') pads = asJson(pads);
    if (!Array.isArray(pads)) {
      return res.status(400).json({ success: false, error: 'pads 必须是数组' });
    }
    if (pads.length > MAX_PADS) {
      return res.status(400).json({ success: false, error: '一条世界最多 ' + MAX_PADS + ' 个声音点位' });
    }
    const badIdx = pads.findIndex((p) => !p || typeof p !== 'object' || !p.url);
    if (badIdx >= 0) {
      return res.status(400).json({ success: false, error: '第 ' + (badIdx + 1) + ' 条没有选声音' });
    }
    const norm = pads.map(normPad);
    await query(`
      INSERT INTO system_config (config_key, config_value, description, updated_at)
      VALUES ('${KEY}', $1, '环境声点位（声音 + 坐标 + 可听半径 + 音量）', NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()
    `, [JSON.stringify(norm)]);
    res.json({ success: true, pads: norm });
  } catch (e) {
    console.error('[soundPads] 保存失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { router, readPads, normPad };
