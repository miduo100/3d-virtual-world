/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundAssetsRoute.js —— 声音资产清单 + 引用明细
 *
 * 为什么要单独拆：assets 这个接口要扫目录、还要遍历 7 类引用来源，
 *   写在 soundScenes.js 里会把那个文件顶过 500 行红线（项目规范：>500 只能引用不能加业务）。
 *
 * 返回的每个资产带两个字段：
 *   used  引用次数（老字段，保留兼容）
 *   refs  引用明细数组，每条 { g: 分组, k: 具体位置, t: 补充说明 }
 *         分组 g：anim 角色动作 / weapon 武器音效 / object 模型声源 / region 区域铺底
 *                 pad 环境声景点位 / weather 天气声音 / music 场景背景音
 *         具体位置 k：anim/weapon 是动作键（idle/walk…），weather 是 wind/rain…，
 *                     pad 是点位 id，object 是物件 id
 *         补充说明 t：模板名 / 物件名 / 坐标 等，前端拼成一句人话
 *
 * 有了 refs，「声音资产」那一栏就能说清每个文件归谁用：
 *   属于角色动作 → 具体是待机还是跑步；属于环境声景 → 具体是哪个坐标的点位。
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');
const soundPads = require('./soundPads');

const router = express.Router();

function asJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/** 一个文件可能同时被多处引用：urls 变体池要全收 */
function collectUrls(v) {
  var out = [];
  if (!v) return out;
  if (typeof v === 'string') { if (v) out.push(v); return out; }
  if (Array.isArray(v)) { v.forEach(function (x) { if (typeof x === 'string' && x) out.push(x); }); return out; }
  if (typeof v === 'object') {
    if (Array.isArray(v.urls)) v.urls.forEach(function (x) { if (typeof x === 'string' && x) out.push(x); });
    else if (typeof v.url === 'string' && v.url) out.push(v.url);
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const dir = path.join(__dirname, '../../public/uploads/character-templates/sounds');

    var files = [];
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir)
        .filter(f => /\.(mp3|ogg|wav|m4a|aac)$/i.test(f))
        .map(f => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, url: '/uploads/character-templates/sounds/' + f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    }

    // 引用明细：fileName → [{ g, k, t }]
    const refs = {};
    const add = (url, g, k, t) => {
      if (!url || typeof url !== 'string') return;
      const name = url.split('/').pop();
      if (!name) return;
      if (!refs[name]) refs[name] = [];
      // 同一个文件同一处引用只记一次
      if (!refs[name].some(function (r) { return r.g === g && r.k === k; })) {
        refs[name].push({ g: g, k: String(k), t: t == null ? '' : String(t) });
      }
    };

    // ① 角色动作 + 武器音效（按模板）
    const tpl = await query('SELECT id, name, anim_sounds, weapon_sounds FROM character_templates');
    tpl.rows.forEach(row => {
      const anim = asJson(row.anim_sounds) || {};
      const wpn = asJson(row.weapon_sounds) || {};
      Object.keys(anim).forEach(k => {
        collectUrls(anim[k]).forEach(u => add(u, 'anim', k, row.name));
      });
      Object.keys(wpn).forEach(k => {
        collectUrls(wpn[k]).forEach(u => add(u, 'weapon', k, row.name));
      });
    });

    // ② 模型声源（按物件）
    const objs = await query("SELECT id, name, custom_config->'audio' AS audio FROM world_objects WHERE (custom_config->'audio') IS NOT NULL");
    objs.rows.forEach(row => {
      const a = asJson(row.audio);
      if (a) add(a.url, 'object', row.id, row.name);
    });

    // ③ 区域铺底（旧的 world_regions.gameplay.audio）
    const regs = await query("SELECT id, name, gameplay->'audio' AS audio FROM world_regions WHERE (gameplay->'audio') IS NOT NULL");
    regs.rows.forEach(row => {
      const a = asJson(row.audio);
      if (a) add(a.url, 'region', row.id, row.name);
    });

    // ④ 环境声景点位（坐标）
    const pads = await soundPads.readPads();
    pads.forEach(p => {
      if (!p || !p.url) return;
      add(p.url, 'pad', p.id, '(' + p.x + ', ' + p.y + ', ' + p.z + ') 半径 ' + p.radius + 'm');
    });

    // ⑤ 天气声音（当前用的 + 候选池里的都算引用）
    const wa = await query("SELECT config_value FROM system_config WHERE config_key = 'audio_weather'");
    const waCfg = wa.rows.length ? asJson(wa.rows[0].config_value) : null;
    if (waCfg && typeof waCfg === 'object') {
      ['wind', 'rain', 'snow', 'fog', 'thunder'].forEach(k => {
        const c = waCfg[k];
        if (!c) return;
        // 中文标签前端会自己翻，这里不再重复带 key
        if (c.url) add(c.url, 'weather', k, '');
        (c.candidates || []).forEach(u => add(u, 'weather', k, ''));
      });
    }

    // ⑥ 场景背景音
    const mu = await query("SELECT config_value FROM system_config WHERE config_key = 'ambient_music'");
    const muCfg = mu.rows.length ? asJson(mu.rows[0].config_value) : null;
    if (muCfg && muCfg.url) add(muCfg.url, 'music', 'music', muCfg.mode === 'once' ? '播一次' : '循环');

    const assets = files.map(f => Object.assign({}, f, {
      used: (refs[f.name] || []).length,
      refs: refs[f.name] || []
    }));
    res.json({ success: true, assets, total: assets.length });
  } catch (e) {
    console.error('[soundAssetsRoute] 资产清单失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
