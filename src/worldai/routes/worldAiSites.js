/**
 * worldAiSites —— 只读选址端点（AI 世界大脑 · 双入口简化 · 第 1 期）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * GET /api/world-ai/sites/find?width=&depth=&near=&limit=
 * 返回互不重叠、位于平地、不压已有对象/区域/出生点的候选矩形（左上角 x/z）。
 *
 * ★ 纯只读：不写库、不建区域、不调用 LLM。前端拿到坐标后才决定要不要落库。
 * ★ 排除规则（2026-11-07 实测坐实）：
 *    - 已有区域矩形（外扩 20m）
 *    - world_objects 占用（含 1136 件人工资产，分布 x[-1199,5309] z[-1126,5287]）
 *    - 出生点 60m 半径（system_config.world_spawn_point = -26.32, 12.56）
 *    - 非平地地形：平地 terrains.id=1 (0,0) 2000x2000 heightScale=0；
 *      山地 id=14 (5000,5000) 6000x6000 heightScale=60 必须排除，否则房子半埋
 * ★ findSites 是纯函数，判据脚本可直接 require 后调用，不依赖服务与数据库。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const { authenticateAdminToken } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const regionService = require('../regions/regionService');

const EDGE = 20;            // 与已有区域的最小间隔（米）
const SPAWN_RADIUS = 60;    // 出生点保护半径
const STEP = 60;            // 扫描网格步长
const SCAN_PAD = 1200;      // 对象查询范围（覆盖平地 2000x2000 + 余量）

router.use(authenticateAdminToken);

function rect(x0, z0, x1, z1, extra) {
  return Object.assign({ x0: x0, z0: z0, x1: x1, z1: z1 }, extra || {});
}
function intersects(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}
function distToRect(px, pz, r) {
  const dx = Math.max(r.x0 - px, 0, px - r.x1);
  const dz = Math.max(r.z0 - pz, 0, pz - r.z1);
  return Math.sqrt(dx * dx + dz * dz);
}
function terrainRect(t) {
  const w = Number(t.width) || 0, d = Number(t.depth) || 0;
  const x = Number(t.pos_x) || 0, z = Number(t.pos_z) || 0;
  return rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2,
    { id: t.id, name: t.name, hs: Number(t.hs) || 0 });
}
/** world_regions.bounds 可能是 x/z/width/depth，也可能带 minX/maxX 冗余列 */
function regionRect(g) {
  const b = (g && g.bounds) || {};
  const x0 = Number(b.minX != null ? b.minX : b.x);
  const z0 = Number(b.minZ != null ? b.minZ : b.z);
  const x1 = Number(b.maxX != null ? b.maxX : x0 + (Number(b.width) || 0));
  const z1 = Number(b.maxZ != null ? b.maxZ : z0 + (Number(b.depth) || 0));
  if (![x0, z0, x1, z1].every(isFinite) || x1 <= x0 || z1 <= z0) return null;
  return rect(x0 - EDGE, z0 - EDGE, x1 + EDGE, z1 + EDGE);
}

/**
 * 纯函数：在平地上找互不重叠的空矩形。
 * @param data {flats, blocked, regions, objects:[{x,z}], spawn:{x,z}}
 * @param opts {width, depth, near:{x,z}, limit}
 * @returns {{sites:Array, scanned:Number, total:Number}}
 */
function findSites(data, opts) {
  const o = opts || {};
  const w = Math.max(20, Number(o.width) || 180);
  const d = Math.max(20, Number(o.depth) || 120);
  const limit = Math.min(20, Math.max(1, Number(o.limit) || 1));
  const near = o.near || { x: 0, z: 0 };
  const flats = (data.flats || []).length
    ? data.flats
    : [rect(-800, -800, 800, 800, { id: 0, name: '兜底平地', hs: 0 })];
  const blocked = data.blocked || [];
  const regions = (data.regions || []).filter(Boolean);
  const objects = data.objects || [];
  const spawn = data.spawn || near;

  const cands = [];
  let scanned = 0;
  for (let fi = 0; fi < flats.length; fi++) {
    const f = flats[fi];
    const minX = f.x0 + w / 2 + EDGE, maxX = f.x1 - w / 2 - EDGE;
    const minZ = f.z0 + d / 2 + EDGE, maxZ = f.z1 - d / 2 - EDGE;
    if (minX > maxX || minZ > maxZ) continue;
    for (let cx = minX; cx <= maxX; cx += STEP) {
      for (let cz = minZ; cz <= maxZ; cz += STEP) {
        scanned++;
        const r = rect(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
        if (blocked.some(function (b) { return intersects(r, b); })) continue;
        if (regions.some(function (b) { return intersects(r, b); })) continue;
        if (distToRect(spawn.x, spawn.z, r) < SPAWN_RADIUS) continue;
        let occupied = false;
        for (let i = 0; i < objects.length; i++) {
          const p = objects[i];
          if (p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1) { occupied = true; break; }
        }
        if (occupied) continue;
        cands.push({
          x: Math.round(r.x0 * 1000) / 1000,
          z: Math.round(r.z0 * 1000) / 1000,
          width: w, depth: d, flat: true, conflicts: 0,
          terrain: f.name || '平地',
          distance: Math.round(Math.sqrt((cx - near.x) ** 2 + (cz - near.z) ** 2)),
        });
      }
    }
  }
  cands.sort(function (a, b) { return a.distance - b.distance; });

  // 相邻网格点会互相重叠：按距离取，跳过与已选矩形相交的候选。
  // 这样一次请求 limit=N 就能直接给世界建设的 N 个片区用（第 2 期无需改后端）。
  const picked = [];
  for (let i = 0; i < cands.length && picked.length < limit; i++) {
    const c = cands[i];
    const r = rect(c.x, c.z, c.x + c.width, c.z + c.depth);
    if (picked.some(function (p) {
      return intersects(r, rect(p.x, p.z, p.x + p.width, p.z + p.depth));
    })) continue;
    picked.push(c);
  }
  return { sites: picked, scanned: scanned, total: cands.length };
}

router.get('/find', async function (req, res) {
  try {
    const width = Math.max(20, Math.min(600, Number(req.query.width) || 180));
    const depth = Math.max(20, Math.min(600, Number(req.query.depth) || 120));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 1));
    const worldId = (await worldAiConfig.getConfig()).world_id;

    const [tr, regs, objs, spawnRow] = await Promise.all([
      query("SELECT id,name,pos_x,pos_z,width,depth,COALESCE((params->>'heightScale')::numeric,0) AS hs FROM terrains WHERE is_active = true"),
      regionService.listRegions(worldId),
      query('SELECT position_x AS x, position_z AS z FROM world_objects WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4',
        [-SCAN_PAD, SCAN_PAD, -SCAN_PAD, SCAN_PAD]),
      query("SELECT config_value FROM system_config WHERE config_key = 'world_spawn_point' LIMIT 1"),
    ]);

    const terrains = (tr.rows || []).map(terrainRect);
    const flats = terrains.filter(function (t) { return t.hs === 0; });
    const blocked = terrains.filter(function (t) { return t.hs > 0; });

    let spawn = { x: 0, z: 0 };
    try {
      const v = JSON.parse(spawnRow.rows[0].config_value);
      spawn = { x: Number(v.position.x) || 0, z: Number(v.position.z) || 0 };
    } catch (e) { /* 配置缺失回退原点 */ }

    let near = spawn;
    const nq = String(req.query.near || 'auto');
    if (nq !== 'auto' && nq !== 'spawn') {
      const parts = nq.split(',').map(Number);
      if (parts.length === 2 && parts.every(isFinite)) near = { x: parts[0], z: parts[1] };
    }

    const found = findSites({
      flats: flats,
      blocked: blocked,
      regions: (regs || []).map(regionRect),
      objects: (objs.rows || []).map(function (r) { return { x: Number(r.x), z: Number(r.z) }; }),
      spawn: spawn,
    }, { width: width, depth: depth, limit: limit, near: near });

    res.json({
      success: true,
      sites: found.sites,
      origin: near,
      spawn: spawn,
      scanned: found.scanned,
      available: found.total,
      reason: found.sites.length ? null : '平地内没有满足条件的空地（已有区域 / 已有对象 / 出生点保护）',
    });
  } catch (e) {
    console.error('[world-ai] 选址失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
module.exports.findSites = findSites;
module.exports.regionRect = regionRect;
