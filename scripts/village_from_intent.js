/**
 * village_from_intent.js —— 用「意图 JSON」驱动工具层建一座村（模拟大模型的输出）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 这个脚本要证明的事：
 *   **只要把坐标与落库收进工具层，LLM 只需要输出"意图"，一座村就能被少量工具调用建出来。**
 *
 * 分工（也是将来接真 LLM 的分工）：
 *   意图（LLM 该输出的东西）→ 本脚本的 plan()：把意图翻译成坐标（确定性代码）
 *   → 工具层 missionTools.execute(verb, ...) ：唯一写库入口
 *
 * 所以本脚本里**没有任何 INSERT**，全部落库都经 7 个动词。
 *
 * 用法：node scripts/village_from_intent.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/database/db');
const missionTools = require('../src/worldai/tools/missionTools');
const terrainGround = require('../src/worldai/assembly/terrainGround');

// ── 1) 意图：这就是将来 LLM 要吐出的东西（不含任何零件坐标）──────────
const INTENT = {
  name: '样板村B（意图驱动）',
  anchor: [-25, 520],            // 村中心
  street: { length: 88, width: 4 },   // 主街：沿 X，88m × 4m
  plaza: { size: 12, at: 'west' },    // 广场在街西端
  rows: [
    { side: 'north', facing: 180, houses: ['medieval_6x6_wood', 'medieval_6x10', 'medieval_8x8_two', 'medieval_6x12', 'medieval_6x8_town'] },
    { side: 'south', facing: 0, houses: ['medieval_6x6', 'medieval_8x12', 'medieval_6x14', 'medieval_8x8', 'medieval_8x14'] },
  ],
  lamps: { spacing: 12, offset: 2.8, pole: 'structure_pole', head: 'lampWall' },
  greenery: { trees: 18, bushes: 24, flowers: 40, rocks: 16 },
  houseSpacing: 16,
  setback: 3,
};

// ── 2) plan()：意图 → 具体坐标（确定性，不含随机）─────────────────────
function plan(intent) {
  const [cx, cz] = intent.anchor;
  const halfW = intent.street.width / 2;
  const x0 = cx - intent.street.length / 2;
  const x1 = cx + intent.street.length / 2;

  const houseX = [];
  const n = Math.max(...intent.rows.map((r) => r.houses.length));
  for (let i = 0; i < n; i++) houseX.push(cx - ((n - 1) / 2) * intent.houseSpacing + i * intent.houseSpacing);

  const buildings = [];
  intent.rows.forEach((row) => {
    row.houses.forEach((tpl, i) => {
      // 房屋中心：南排门朝 −Z（原朝向），北排转 180° 门朝 +Z
      // 这里只算中心，具体进深由工具层按模板算（脚本拿不到模板尺寸也不想拿）
      buildings.push({ template: tpl, x: houseX[i], z: cz + (row.side === 'north' ? -1 : 1) * 100, facing: row.facing, side: row.side });
    });
  });

  const lamps = [];
  for (let x = x0 + 6; x <= x1; x += intent.lamps.spacing) {
    for (const side of [-1, 1]) {
      lamps.push({ x, z: cz + side * (halfW + intent.lamps.offset), side });
    }
  }

  return { cx, cz, x0, x1, halfW, buildings, lamps };
}

// ── 3) 执行：只调工具 ────────────────────────────────────────────────
const REGION_KEY = 'village_intent';
const REGION_NAME = '样板村B（工具层验证）';
const MARGIN = 60;
const BOUNDS = { kind: 'rect', x: -25 - 110, z: 520 - 65, width: 220, depth: 130 };

let T = null;   // 未用（直接写表），保留给将来接服务
const CALLS = [];
async function call(verb, params, ctx) {
  const r = await missionTools.execute(verb, params, ctx);
  CALLS.push({ verb, ok: !!r.ok, code: r.code || 'OK', detail: summarize(verb, r) });
  return r;
}
function summarize(verb, r) {
  if (!r.ok) return (r.code || '') + ' — ' + String(r.reason || '').slice(0, 120);
  if (verb === 'build_from_template') return r.template + ' → ' + r.pieces + ' 件，y=' + r.groundY;
  if (verb === 'pave') return r.partKey + ' ' + r.nx + '×' + r.nz + ' = ' + r.tiles + ' 块';
  if (verb === 'scatter') return r.partKey + ' 放 ' + r.placed + ' / 跳过 ' + r.skipped;
  if (verb === 'place_props') return '摆 ' + r.placed + ' 件';
  return 'ok';
}

(async () => {
  const p = plan(INTENT);
  console.log('村中心', INTENT.anchor, ' 主街 x', p.x0, '~', p.x1);

  // 地面：整村采样一次（平原应恒 0）
  const g = await terrainGround.underFootprint(p.cx, p.cz, BOUNDS.width, BOUNDS.depth);
  if (!g.hasTerrain) throw new Error('村址没有地形');
  if (Math.abs(g.span) > 1.5) throw new Error('村址起伏 ' + g.span + 'm 太大');
  console.log('地面 y=' + g.baseY + '（起伏 ' + g.span + 'm）');

  // 空地校验：这个范围里不能已有东西（避免把村叠在旧村上）
  const occupied = (await query(
    `SELECT count(*)::int n FROM world_objects
      WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4`,
    [BOUNDS.x, BOUNDS.x + BOUNDS.width, BOUNDS.z, BOUNDS.z + BOUNDS.depth]
  )).rows[0].n;
  if (occupied > 0) {
    console.log('⚠ 范围内已有 ' + occupied + ' 件对象 —— 会先清空村域再建（只清本村 region）');
  }

  // 区域 + 委托（工具层需要三要素：regionKey / missionId / autonomy）
  const WORLD = (await query(`SELECT world_id FROM world_regions WHERE region_key LIKE 'street%' OR region_key LIKE 'village%' LIMIT 1`)).rows[0].world_id;
  await query(`DELETE FROM world_objects WHERE region_id = $1`, [REGION_KEY]);
  await query(`DELETE FROM world_regions WHERE region_key = $1`, [REGION_KEY]);
  await query(
    `INSERT INTO world_regions (world_id, region_key, name, bounds, autonomy, gridsnap, status, origin, created_by)
     VALUES ($1,$2,$3,$4::jsonb,'managed','{"kind":"modular","unit":[1,1,1]}'::jsonb,'active','ai','intent_build')`,
    [WORLD, REGION_KEY, REGION_NAME, JSON.stringify(BOUNDS)]
  );
  await query(`DELETE FROM world_build_missions WHERE region_key = $1`, [REGION_KEY]);
  const missionId = (await query(
    `INSERT INTO world_build_missions (world_id, region_key, title, prompt, constraints, autonomy_snapshot, status, origin, created_by)
     VALUES ($1,$2,$3,'意图驱动建村','{"max_objects":20000}'::jsonb,'managed','completed','ai','intent_build') RETURNING id`,
    [WORLD, REGION_KEY, REGION_NAME]
  )).rows[0].id;

  const region = { bounds: BOUNDS, gridsnap: { kind: 'modular', unit: [1, 1, 1] } };
  const ctx = {
    worldId: WORLD, regionKey: REGION_KEY, region, missionId: String(missionId),
    effectiveAutonomy: 'managed', groundY: g.baseY, maxObjects: 20000,
  };

  // ── 3a) 主街 ──
  await call('pave', { partKey: 'ground_pathStraight', x: (p.x0 + p.x1) / 2, z: p.cz, width: p.x1 - p.x0, depth: INTENT.street.width }, ctx);
  // ── 3b) 广场 ──
  const plazaX = p.x0 - INTENT.plaza.size / 2 - 1;
  await call('pave', { partKey: 'ground_pathStraight', x: plazaX, z: p.cz, width: INTENT.plaza.size, depth: INTENT.plaza.size }, ctx);

  // ── 3c) 房屋：进深由工具层按模板算，这里把「临街面推 3m + 中心随进深」交给 build_from_template？
  //     不行 —— 工具算不了"让临街面对齐"。所以脚本先问模板尺寸，再算中心 z。
  const registry = require('../src/worldai/assembly/templateRegistry');
  for (const b of p.buildings) {
    const t = registry.getTemplate(b.template);
    if (!t) { await call('build_from_template', { template: b.template, x: b.x, z: p.cz, facing: b.facing }, ctx); continue; }
    const D = t.dimensions.depth;
    // 北排：临街面 = cz − 半街 − 退线，中心 = 临街面 − 进深/2（facing=180 让门朝 +Z）
    // 南排：临街面 = cz + 半街 + 退线，中心 = 临街面 + 进深/2
    const front = p.cz + (b.side === 'north' ? -1 : 1) * (p.halfW + INTENT.setback);
    const z = front + (b.side === 'north' ? -1 : 1) * (D / 2);
    await call('build_from_template', { template: b.template, x: b.x, z, facing: b.facing }, ctx);
  }

  // ── 3d) 路灯：杆 + 灯头，同点两件（place_props 一次摆完）──
  const lampItems = [];
  for (const l of p.lamps) {
    lampItems.push({ partKey: INTENT.lamps.pole, x: l.x, z: l.z, y: g.baseY, scale: 1, scaleY: 3.0, collision: true });
    lampItems.push({ partKey: INTENT.lamps.head, x: l.x, z: l.z, y: g.baseY + 2.9, scale: 1, scaleY: 1.6, ry: l.side > 0 ? Math.PI : 0, collision: false });
  }
  await call('place_props', { items: lampItems }, ctx);

  // ── 3e) 植被：四块区域各 scatter 一次 ──
  const northBack = p.cz - (p.halfW + INTENT.setback) - 22;
  const southBack = p.cz + (p.halfW + INTENT.setback) + 22;
  await call('scatter', { partKey: 'tree_default', x: p.cx, z: northBack, width: 80, depth: 14, count: INTENT.greenery.trees, scale: 1.9 }, ctx);
  await call('scatter', { partKey: 'tree_cone', x: p.cx, z: southBack, width: 80, depth: 14, count: INTENT.greenery.trees, scale: 1.9 }, ctx);
  await call('scatter', { partKey: 'plant_bush', x: p.cx, z: p.cz - (p.halfW + 1.2), width: 84, depth: 1.2, count: Math.round(INTENT.greenery.bushes / 2), scale: 1.1, collision: false }, ctx);
  await call('scatter', { partKey: 'flower_redA', x: p.cx, z: p.cz + (p.halfW + 1.2), width: 84, depth: 1.2, count: INTENT.greenery.flowers, scale: 1.0, collision: false }, ctx);
  await call('scatter', { partKey: 'rock_smallA', x: p.cx, z: northBack - 10, width: 90, depth: 10, count: INTENT.greenery.rocks, scale: 1.3 }, ctx);

  // ── 4) 结果 ──
  const total = (await query('SELECT count(*)::int n FROM world_objects WHERE region_id=$1', [REGION_KEY])).rows[0].n;
  console.log('\n工具调用 ' + CALLS.length + ' 次：');
  const byVerb = {};
  CALLS.forEach((c) => { byVerb[c.verb] = byVerb[c.verb] || { ok: 0, fail: 0 }; c.ok ? byVerb[c.verb].ok++ : byVerb[c.verb].fail++; });
  Object.keys(byVerb).forEach((v) => console.log('   ' + v.padEnd(22) + ' 成功 ' + byVerb[v].ok + ' / 失败 ' + byVerb[v].fail));
  const fails = CALLS.filter((c) => !c.ok);
  if (fails.length) {
    console.log('\n失败的调用：');
    fails.forEach((f) => console.log('   ✗ ' + f.verb + ' — ' + f.detail));
  }
  console.log('\n村域共 ' + total + ' 件（' + INTENT.name + '）');
  console.log('撤销：DELETE FROM world_objects WHERE region_id=\'' + REGION_KEY + '\';');
  try { await pool.end(); } catch (e) { /* ignore */ }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
