/**
 * run_real_llm_mission.js —— 跑**一次真实 LLM 委托**（M1-7 第 2 步验证）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 目的：前面 13 条判据全是用「假模型」测的（解析/校验/重试逻辑）。
 *       这次真调一次，看模型能不能按 353 token 的模板契约说出合法意图。
 *
 * 花费控制：只建一栋 6×6 + 一条短街 + 几棵树；最多 2 轮（失败即停）。
 * 结果**保留**在世界里，方便进去看；脚本末尾打印 region_key 与撤销 SQL。
 *
 * 用法：node scripts/run_real_llm_mission.js
 */
'use strict';

const { pool, query } = require('../src/database/db');
const templatePlanner = require('../src/worldai/missions/templatePlanner');
const intentExecutor = require('../src/worldai/missions/intentExecutor');
const terrainGround = require('../src/worldai/assembly/terrainGround');

const REGION_KEY = 'llm_real_' + Date.now();
const PROMPT = '在村子东边的空地上建一栋小屋，屋子前面修一小段路，再种几棵树。';

/** 找一块 60×60 的空地（平原内、远离已有对象） */
async function findSite() {
  for (let x = 400; x <= 900; x += 40) {
    for (let z = 400; z <= 900; z += 40) {
      const n = (await query(
        `SELECT count(*)::int n FROM world_objects
          WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4`,
        [x - 35, x + 35, z - 35, z + 35]
      )).rows[0].n;
      if (n === 0) return { x, z };
    }
  }
  return null;
}

(async () => {
  const site = await findSite();
  if (!site) throw new Error('平原里找不到 60×60 空地');
  const BOUNDS = { kind: 'rect', x: site.x - 30, z: site.z - 30, width: 60, depth: 60 };
  const g = await terrainGround.underFootprint(site.x, site.z, 60, 60);
  console.log('场地中心 (' + site.x + ',' + site.z + ')  地面 y=' + g.baseY + '（起伏 ' + g.span + 'm）');

  const WORLD = (await query('SELECT world_id FROM world_regions LIMIT 1')).rows[0].world_id;
  await query(`DELETE FROM world_objects WHERE region_id=$1`, [REGION_KEY]);
  await query(`DELETE FROM world_regions WHERE region_key=$1`, [REGION_KEY]);
  await query(
    `INSERT INTO world_regions (world_id, region_key, name, bounds, autonomy, gridsnap, status, origin, created_by)
     VALUES ($1,$2,'真实 LLM 委托验证',$3::jsonb,'managed','{"kind":"modular","unit":[1,1,1]}'::jsonb,'active','ai','llm_real')`,
    [WORLD, REGION_KEY, JSON.stringify(BOUNDS)]
  );
  const missionId = (await query(
    `INSERT INTO world_build_missions (world_id, region_key, title, prompt, constraints, autonomy_snapshot, status, origin, created_by)
     VALUES ($1,$2,'真实 LLM 建一栋小屋',$3,'{"max_objects":2000}'::jsonb,'managed','draft','ai','llm_real') RETURNING id`,
    [WORLD, REGION_KEY, PROMPT]
  )).rows[0].id;
  console.log('委托 ' + missionId);
  console.log('提示词：' + PROMPT);

  const mission = { id: missionId, world_id: WORLD, region_key: REGION_KEY, prompt: PROMPT, constraints: { max_objects: 2000 } };
  const region = { bounds: BOUNDS };

  const t0 = Date.now();
  let r;
  try {
    r = await templatePlanner.planTemplates(mission, region, { maxObjects: 2000, maxRounds: 2 });
  } catch (e) {
    console.log('\n✗ 调用失败：' + (e && e.message));
    console.log('（可能是网络/密钥/提供商不可达；这条不算模型能力结论）');
    try { await pool.end(); } catch (e2) { /* ignore */ }
    process.exit(2);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // token 用量（ai_call_log 里本轮记的）
  const logs = (await query(
    `SELECT model, prompt_tokens, completion_tokens, total_tokens, status, created_at
       FROM ai_call_log WHERE mission_id=$1 ORDER BY id DESC LIMIT 5`, [String(missionId)]
  ).catch(() => ({ rows: [] }))).rows;
  const tokSum = logs.reduce((a, x) => a + (Number(x.total_tokens) || 0), 0);

  console.log('\n== 模型返回 ==');
  console.log('  耗时 ' + secs + 's  轮次 ' + r.rounds + '  契约 ' + r.contractTokens + ' tokens');
  console.log('  token 用量 ≈ ' + tokSum + (logs.length ? ('（' + logs.length + ' 次调用：' + logs.map((x) => (x.model || '?') + '/' + (x.total_tokens || '?')).join(', ') + '）') : ''));
  if (!r.ok) {
    console.log('  结果：失败 ' + r.code + ' — ' + r.reason);
    console.log('  ★ 这是一次真实的模型失败，请据此判断契约是否还需要改');
    try { await pool.end(); } catch (e) { /* ignore */ }
    process.exit(3);
  }
  console.log('  意图：' + JSON.stringify(r.plan));
  console.log('  统计：建筑 ' + r.stats.buildings + ' / 路 ' + r.stats.roads + ' / 道具 ' + r.stats.props + ' / 估 ' + r.stats.pieces + ' 件');

  // 执行
  const ctx = {
    worldId: WORLD, regionKey: REGION_KEY,
    region: { bounds: BOUNDS, gridsnap: { kind: 'modular', unit: [1, 1, 1] } },
    missionId: String(missionId), effectiveAutonomy: 'managed',
    groundY: g.baseY, maxObjects: 2000,
  };
  const ex = await intentExecutor.executeIntent(r.plan, ctx);
  const rows = (await query('SELECT count(*)::int n FROM world_objects WHERE region_id=$1', [REGION_KEY])).rows[0].n;
  const bbox = (await query(
    `SELECT round(min(position_x)::numeric)::int x0, round(max(position_x)::numeric)::int x1,
            round(min(position_z)::numeric)::int z0, round(max(position_z)::numeric)::int z1
       FROM world_objects WHERE region_id=$1`, [REGION_KEY]
  )).rows[0];

  console.log('\n== 执行 ==');
  console.log('  工具调用 ' + ex.calls.length + ' 次，落库 ' + rows + ' 件');
  ex.calls.forEach((c) => console.log('   ' + (c.ok ? '✓' : '✗') + ' ' + c.verb + '  ' + c.label + '  ' + c.code));
  console.log('  范围 x[' + bbox.x0 + ',' + bbox.x1 + '] z[' + bbox.z0 + ',' + bbox.z1 + ']');
  console.log('\n撤销：DELETE FROM world_objects WHERE region_id=\'' + REGION_KEY + '\';');
  try { await pool.end(); } catch (e) { /* ignore */ }
  process.exit(ex.ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
