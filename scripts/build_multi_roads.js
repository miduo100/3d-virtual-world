'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const { query } = require('../src/database/db');
const regionService = require('../src/worldai/regions/regionService');
const missionService = require('../src/worldai/missions/missionService');
const missionRunner = require('../src/worldai/missions/missionRunner');
const args = process.argv.slice(2);
const KEEP = args.some(function (a) { return a === '--keep'; });
const AT = (function () {
  const a = args.filter(function (x) { return x.indexOf('--at=') === 0; })[0];
  if (!a) return { x: -260, z: 60 };
  const p = a.slice(5).split(',').map(Number);
  return { x: isFinite(p[0]) ? p[0] : -260, z: isFinite(p[1]) ? p[1] : 60 };
})();
const RECIPES = [
  { key: 'asphalt_brick', label: '沥青砖路 brick_urban 1m', size: 1, tiles: ['road_asphalt_center', 'road_asphalt_pavement', 'road_asphalt_damaged'] },
  { key: 'redbrick', label: '红砖地路 2m方砖', size: 2, tiles: ['Floor_RedBrick', 'Floor_Brick', 'Floor_Inset'] },
  { key: 'stone_bridge', label: '石板桥面路 1m', size: 1, tiles: ['bridge_stone', 'bridge_center_stone', 'bridge_side_stone'] },
  { key: 'wood_bridge', label: '木栈道路 1m', size: 1, tiles: ['bridge_wood', 'bridge_center_wood', 'bridge_side_wood'] },
  { key: 'grass_path', label: '草地小路 1m', size: 1, tiles: ['ground_grass', 'patch_grass', 'ground_pathCorner'] },
  { key: 'dirt_path', label: '泥土小路 1m', size: 1, tiles: ['patch_dirt', 'ground_grass', 'ground_pathBend'] },
  { key: 'sidewalk', label: '人行道路 3m板', size: 3, tiles: ['Sidewalk_NoCurb_3m', 'Sidewalk_Corner_Flat_3m'] },
  { key: 'roadtile', label: '拼装路面砖 3m minimal', size: 3, tiles: ['roadTile_001', 'roadTile_002', 'roadTile_003', 'roadTile_004', 'roadTile_005', 'roadTile_006'] },
];
const r1 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
function measure(pts, tileLen) {
  const s = pts.slice().sort(function (a, b) { return (a.x - b.x) || (a.z - b.z); });
  const gaps = []; let poly = 0;
  for (let i = 1; i < s.length; i++) { const d = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z); gaps.push(r1(d)); poly += d; }
  return { count: s.length, span: r1(Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].z - s[0].z)), polyline: r1(poly), minGap: gaps.length ? Math.min.apply(null, gaps) : 0, maxGap: gaps.length ? Math.max.apply(null, gaps) : 0 };
}
(async function main() {
  const GAP = 34, LEN = 20;
  const total = RECIPES.length, width = 46, depth = GAP * total + 20;
  console.log('\n===== 批量铺路：' + total + ' 条 x ' + LEN + ' 米，每条换一个零件族 =====');
  console.log('区域 X ' + AT.x + '~' + (AT.x + width) + ' / Z ' + AT.z + '~' + (AT.z + depth) + '\n');
  const REGION_KEY = 'roads_' + Date.now().toString(36);
  const report = [];
  try {
    const rg = await regionService.createRegion({ regionKey: REGION_KEY, name: '批量铺路区', worldId: '', autonomy: 'autonomous', bounds: { x: AT.x, z: AT.z, width: width, depth: depth, kind: 'rect' }, notes: 'build_multi_roads' });
    if (!rg.ok) throw new Error('建区域失败 ' + rg.code + ' ' + rg.reason);
    for (let i = 0; i < total; i++) {
      const rec = RECIPES[i];
      const zLine = AT.z + 10 + i * GAP;
      const xStart = AT.x + (width - LEN) / 2;
      const spec = { kind: rec.key, mode: 'recipe', recipe: 'path', footprint: { w: LEN, d: rec.size }, anchor: { dx: r1(xStart - AT.x), dz: r1(zLine - AT.z) }, spec: { waypoints: [{ dx: 0, dz: 0 }, { dx: LEN, dz: 0 }], width: rec.size, tile: rec.tiles } };
      const ms = await missionService.createMission({ regionKey: REGION_KEY, prompt: '铺一条 ' + LEN + ' 米长的' + rec.label, createdBy: 'build_multi_roads', worldId: '', constraints: { max_objects: 80, placement_policy: 'avoid' } });
      if (!ms.ok) { console.log((i + 1) + ') ' + rec.key + ' 建委托失败 ' + ms.code); continue; }
      // injectPlan：走完整校验 + recipe 展开（useSavedPlan 是"B1 已确认的成品方案"路径，
      // 期望 plan 里已带 parts，骨架方案会被 runner 当成空块 → 0 件）
      const run = await missionRunner.run(ms.mission.id, { injectPlan: { blocks: [spec] } });
      const objs = await query('SELECT name, position_x, position_z FROM world_objects WHERE created_by = $1 ORDER BY id', [ms.mission.id]);
      const byKey = {};
      for (const o of objs.rows) { const k = String(o.name); (byKey[k] = byKey[k] || []).push({ x: Number(o.position_x), z: Number(o.position_z) }); }
      const usedKeys = Object.keys(byKey);
      // ★ 测量口径：一条路就是一次委托的全部落件（多零件轮换后点分散在多个 partKey 下，
      //   按 partKey 分组测会只测到其中 1/N 的点 → 跨度偏小误判 FAIL）
      const pts = objs.rows.map(function (o) { return { x: Number(o.position_x), z: Number(o.position_z) }; });
      const m = pts.length ? measure(pts, rec.size) : null;
      const dev = m ? Math.abs(m.span - LEN) : null;
      report.push({ rec: rec, xStart: xStart, zLine: zLine, usedKeys: usedKeys, m: m, dev: dev, runOk: run.ok });
      console.log('[' + (i + 1) + '] ' + rec.label);
      console.log('    配方 ' + rec.tiles.join(' / '));
      console.log('    实际 ' + (usedKeys.map(function (k) { return k + 'x' + byKey[k].length; }).join(', ') || '(无)'));
      if (m) console.log('    落点 X ' + r1(pts[0].x) + '~' + r1(pts[pts.length - 1].x) + ' / Z=' + r1(pts[0].z) + '  =>  ' + m.count + ' 件, 跨度 ' + m.span + 'm, 间距 ' + m.minGap + '~' + m.maxGap + 'm, 偏差 ' + r1(dev) + 'm ' + (dev <= 0.5 ? '[OK]' : dev <= 1.5 ? '[warn]' : '[FAIL]'));
      else console.log('    未落件 runner ok=' + run.ok);
    }
    const allKeys = {};
    for (const r of report) r.usedKeys.forEach(function (k) { allKeys[k] = 1; });
    console.log('\n===== 汇总 =====');
    console.log('共用到 ' + Object.keys(allKeys).length + ' 种不同路面零件');
    console.log(Object.keys(allKeys).sort().join(', '));
  } catch (e) {
    console.error('[异常]', (e && e.stack) || e);
  } finally {
    if (!KEEP) {
      try {
        const mids = await query("SELECT id FROM world_build_missions WHERE region_key=$1", [REGION_KEY]);
        for (const m of mids.rows) await query("DELETE FROM world_objects WHERE created_by=$1 AND origin='ai'", [m.id]);
        await query('DELETE FROM world_build_missions WHERE region_key=$1', [REGION_KEY]);
        await query('DELETE FROM world_regions WHERE region_key=$1', [REGION_KEY]);
        console.log('[清理] 完成（加 --keep 可保留）');
      } catch (e) { console.log('清理失败：' + e.message); }
    } else console.log('\n[KEEP] 数据保留在区域 ' + REGION_KEY);
  }
  process.exit(0);
})();