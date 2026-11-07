/**
 * run_real_llm_village.js —— 跑一次「整村」真实 LLM 委托（M1-7 第 3 步验证）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 与 run_real_llm_mission.js 的区别：那个只建一栋（验证"能不能按契约说话"），
 * 这个要模型**自己规划 10 栋 + 主街 + 植被** —— 检验的是规划能力，不是执行能力。
 *
 * 之前那座 1039 件的村是脚本模拟意图建的（意图是我手写的）。
 * 这次意图完全由模型给，我只做校验与执行。
 *
 * 花费：1~3 次调用，约 2~6k tokens。结果保留在世界里。
 * 用法：node scripts/run_real_llm_village.js
 */
'use strict';

const { pool, query } = require('../src/database/db');
const templatePlanner = require('../src/worldai/missions/templatePlanner');
const intentExecutor = require('../src/worldai/missions/intentExecutor');
const terrainGround = require('../src/worldai/assembly/terrainGround');

const REGION_KEY = 'llm_village_' + Date.now();
const W = 220, D = 130;
const PROMPT = '在这片空地上建一个小村庄：一条主街，街道两侧各排五栋房子，房屋大小错落、风格统一；'
  + '街边种些树，村口留一块小广场。';

/** 找一块 W×D 的空地（远离已有对象） */
async function findSite() {
  for (let x = 500; x <= 900; x += 20) {
    for (let z = 200; z <= 900; z += 20) {
      const n = (await query(
        `SELECT count(*)::int n FROM world_objects
          WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4`,
        [x - W / 2, x + W / 2, z - D / 2, z + D / 2]
      )).rows[0].n;
      if (n === 0) return { x, z };
    }
  }
  return null;
}

(async () => {
  const site = await findSite();
  if (!site) throw new Error(W + '×' + D + ' 找不到空地');
  const BOUNDS = { kind: 'rect', x: site.x - W / 2, z: site.z - D / 2, width: W, depth: D };
  const g = await terrainGround.underFootprint(site.x, site.z, W, D);
  console.log('场地中心 (' + site.x + ',' + site.z + ')  地面 y=' + g.baseY + '（起伏 ' + g.span + 'm）');
  if (Math.abs(g.span) > 1.5) throw new Error('场地起伏太大');

  const WORLD = (await query('SELECT world_id FROM world_regions LIMIT 1')).rows[0].world_id;
  await query(`DELETE FROM world_objects WHERE region_id=$1`, [REGION_KEY]);
  await query(`DELETE FROM world_regions WHERE region_key=$1`, [REGION_KEY]);
  await query(
    `INSERT INTO world_regions (world_id, region_key, name, bounds, autonomy, gridsnap, status, origin, created_by)
     VALUES ($1,$2,'真实 LLM 建整村',$3::jsonb,'managed','{"kind":"modular","unit":[1,1,1]}'::jsonb,'active','ai','llm_village')`,
    [WORLD, REGION_KEY, JSON.stringify(BOUNDS)]
  );
  const missionId = (await query(
    `INSERT INTO world_build_missions (world_id, region_key, title, prompt, constraints, autonomy_snapshot, status, origin, created_by)
     VALUES ($1,$2,'真实 LLM 建整村',$3,'{"max_objects":3000}'::jsonb,'managed','draft','ai','llm_village') RETURNING id`,
    [WORLD, REGION_KEY, PROMPT]
  )).rows[0].id;
  console.log('委托 ' + missionId);
  console.log('提示词：' + PROMPT);

  const mission = { id: missionId, world_id: WORLD, region_key: REGION_KEY, prompt: PROMPT, constraints: { max_objects: 3000 } };
  const region = { bounds: BOUNDS };

  const t0 = Date.now();
  let r;
  try {
    r = await templatePlanner.planTemplates(mission, region, {
      maxObjects: 3000,
      maxRounds: Math.max(1, Number(process.env.MAX_ROUNDS) || 3),
    });
  } catch (e) {
    console.log('\n✗ 调用失败：' + (e && e.message));
    try { await pool.end(); } catch (e2) { /* ignore */ }
    process.exit(2);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const tok = (await query(
    'SELECT count(*)::int n, coalesce(sum(total_tokens),0)::int t FROM ai_call_log WHERE mission_id=$1', [String(missionId)]
  )).rows[0];

  console.log('\n== 模型返回 ==');
  console.log('  耗时 ' + secs + 's  轮次 ' + r.rounds + '  契约 ' + r.contractTokens + ' tokens');
  console.log('  实际账单 ' + tok.n + ' 次调用 / ' + tok.t + ' tokens');
  if (!r.ok) {
    console.log('  结果：**失败** ' + r.code + ' — ' + r.reason);
    console.log('  ★ 这是真实模型在整村规划上的失败，说明契约还要加强（不是脚本 bug）');
    if (r.lastRaw) console.log('  模型最后一版原文：\n' + r.lastRaw);
    try { await pool.end(); } catch (e) { /* ignore */ }
    process.exit(3);
  }
  console.log('  建筑 ' + r.stats.buildings + ' 栋 / 路 ' + r.stats.roads + ' 条 / 道具 ' + r.stats.props + ' 组 / 估 ' + r.stats.pieces + ' 件');
  r.plan.buildings.forEach((b) => console.log('    · ' + b.template.padEnd(22) + ' (' + b.x + ',' + b.z + ') facing=' + b.facing));
  if (r.plan.roads.length) r.plan.roads.forEach((x) => console.log('    · road (' + x.x + ',' + x.z + ') ' + x.width + '×' + x.depth + 'm'));
  if (r.plan.props.length) r.plan.props.forEach((x) => console.log('    · ' + x.partKey + ' ×' + x.count + ' @(' + x.x + ',' + x.z + ')'));

  // 执行
  const ctx = {
    worldId: WORLD, regionKey: REGION_KEY,
    region: { bounds: BOUNDS, gridsnap: { kind: 'modular', unit: [1, 1, 1] } },
    missionId: String(missionId), effectiveAutonomy: 'managed',
    groundY: g.baseY, maxObjects: 3000,
  };
  const ex = await intentExecutor.executeIntent(r.plan, ctx);
  const agg = (await query(
    `SELECT count(*)::int n, round(min(position_x)::numeric)::int x0, round(max(position_x)::numeric)::int x1,
            round(min(position_z)::numeric)::int z0, round(max(position_z)::numeric)::int z1
       FROM world_objects WHERE region_id=$1`, [REGION_KEY]
  )).rows[0];

  console.log('\n== 执行 ==');
  console.log('  工具调用 ' + ex.calls.length + ' 次，落库 ' + agg.n + ' 件');
  ex.calls.filter((c) => !c.ok).forEach((c) => console.log('   ✗ ' + c.verb + ' ' + c.label + ' → ' + c.code));
  console.log('  范围 x[' + agg.x0 + ',' + agg.x1 + '] z[' + agg.z0 + ',' + agg.z1 + ']');
  console.log('\n撤销：DELETE FROM world_objects WHERE region_id=\'' + REGION_KEY + '\';');
  try { await pool.end(); } catch (e) { /* ignore */ }
  process.exit(ex.ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
