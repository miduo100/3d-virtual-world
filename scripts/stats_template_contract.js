/**
 * stats_template_contract.js —— 模板契约的**成功率/成本统计**（M1-7 判据要的数据）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么要这个：单个案例跑通不等于稳定。文档记录的旧契约失败率约 11%，
 * 新契约到底多少必须实测 —— 不能拿"契约 562 token"冒充"成功率提升"。
 *
 * 做法：10 种不同诉求 × N 轮，各自建临时委托 → missionRunner.run（走 planMode='template'）
 * → 记录 status / 失败码 / 轮次 / token / 件数 → 汇总 → 清理。
 *
 * 用法：node scripts/stats_template_contract.js [每个诉求跑几次，默认 2]
 * 花费：约 1.7~5k tokens/次（视轮次）。默认 20 次约 3~7 万 tokens。
 */
'use strict';

const { pool, query } = require('../src/database/db');
const missionRunner = require('../src/worldai/missions/missionRunner');

const ROUNDS = Math.max(1, Number(process.argv[2]) || 2);
/** 只跑指定诉求（1 基序号，逗号分隔）：node scripts/stats_template_contract.js 3 7,8 */
const ONLY = String(process.argv[3] || '').split(',').map((x) => Number(x) - 1).filter((i) => i >= 0);
const REGION_KEY = 'stats_tpl_' + Date.now();
const W = 140, D = 100;
const MAX_OBJ = 1500;

/** 10 种诉求：从一两栋到小村，措辞自然（不写模板名，让模型自己选） */
const ALL_PROMPTS = [
  '建一栋 6x6 的小屋',
  '建两栋并排的房子，中间留条小巷',
  '建一个小村庄，一条主街，两侧各三栋房',
  '建三栋房和一条街，街边种些树',
  '盖一座 8x8 的两层砖房，门前修一小段路',
  '建一个带广场的小村落，广场放在街的西端',
  '沿街建五栋房子，大小错落一些',
  '建两栋房，一栋大点一栋小点，中间一条路',
  '建一座会堂和两栋民居，围成一个小院',
  '在这片空地上建四栋房子，排成两排',
];
const PROMPTS = ONLY.length ? ONLY.map((i) => ALL_PROMPTS[i]).filter(Boolean) : ALL_PROMPTS;

async function findSite() {
  for (let x = 200; x <= 900; x += 20) {
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
  if (!site) throw new Error('找不到 ' + W + '×' + D + ' 空地');
  const BOUNDS = { kind: 'rect', x: site.x - W / 2, z: site.z - D / 2, width: W, depth: D };
  const WORLD = (await query('SELECT world_id FROM world_regions LIMIT 1')).rows[0].world_id;

  await query(`DELETE FROM world_objects WHERE region_id=$1`, [REGION_KEY]);
  await query(`DELETE FROM world_regions WHERE region_key=$1`, [REGION_KEY]);
  await query(
    `INSERT INTO world_regions (world_id, region_key, name, bounds, autonomy, gridsnap, status, origin, created_by)
     VALUES ($1,$2,'模板契约统计',$3::jsonb,'managed','{"kind":"modular","unit":[1,1,1]}'::jsonb,'active','ai','stats')`,
    [WORLD, REGION_KEY, JSON.stringify(BOUNDS)]
  );
  console.log('场地 (' + site.x + ',' + site.z + ')  诉求 ' + PROMPTS.length + ' 种 × ' + ROUNDS + ' 轮 = '
    + (PROMPTS.length * ROUNDS) + ' 次\n');

  const results = [];
  const t0 = Date.now();
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < PROMPTS.length; i++) {
      const prompt = PROMPTS[i];
      // 每次一个干净委托（保留区域，清掉上次的物件与委托）
      await query(`DELETE FROM world_objects WHERE region_id=$1`, [REGION_KEY]);
      await query(`DELETE FROM world_build_missions WHERE region_key=$1`, [REGION_KEY]);
      const mid = (await query(
        `INSERT INTO world_build_missions (world_id, region_key, title, prompt, constraints, autonomy_snapshot, status, origin, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,'managed','draft','ai','stats') RETURNING id`,
        [WORLD, REGION_KEY, '统计 ' + (r + 1) + '-' + (i + 1), prompt,
          JSON.stringify({ planMode: 'template', max_objects: MAX_OBJ })]
      )).rows[0].id;

      const started = Date.now();
      let run;
      try {
        run = await missionRunner.run(mid);
      } catch (e) {
        run = { ok: false, status: 'threw', reason: String(e && e.message) };
      }
      const secs = Math.round((Date.now() - started) / 1000);
      const st = (await query('SELECT executed_stats FROM world_build_missions WHERE id=$1::uuid', [mid]))
        .rows[0].executed_stats || {};
      const tok = (await query(
        'SELECT count(*)::int n, coalesce(sum(total_tokens),0)::int t FROM ai_call_log WHERE mission_id=$1',
        [String(mid)]
      )).rows[0];

      const rec = {
        prompt, ok: !!(run && run.ok), status: (run && run.status) || '?',
        code: (st.error && st.error.code) || (run && run.innerCode) || '',
        reason: (st.error && st.error.reason) || (run && run.reason) || '',
        intent: st.planIntent || '',
        rounds: Number(st.llmCalls) || 0,
        tokens: tok.t, calls: tok.n,
        pieces: Number(st.objectsCreated) || 0,
        buildings: Number(st.buildings) || 0,
        roads: Number(st.roads) || 0,
        secs,
      };
      results.push(rec);
      console.log((rec.ok ? '✓' : '✗') + ' ' + (i + 1) + '/' + PROMPTS.length + ' r' + (r + 1)
        + '  ' + (rec.ok ? (rec.buildings + ' 栋 / ' + rec.roads + ' 路 / ' + rec.pieces + ' 件')
          : (rec.code || rec.status))
        + '  轮次 ' + rec.rounds + ' · ' + rec.tokens + ' tok · ' + rec.secs + 's  「' + prompt.slice(0, 18) + '…」'
        + (rec.ok ? '' : '\n     原因：' + String(rec.reason).slice(0, 250)
          + (rec.intent ? '\n     意图：' + String(rec.intent).slice(0, 900) : '')));
    }
  }

  // ── 汇总 ──
  const n = results.length;
  const ok = results.filter((x) => x.ok).length;
  const avg = (f) => (n ? (results.reduce((a, x) => a + f(x), 0) / n) : 0);
  const failCodes = {};
  results.filter((x) => !x.ok).forEach((x) => { failCodes[x.code || 'UNKNOWN'] = (failCodes[x.code || 'UNKNOWN'] || 0) + 1; });
  const roundHist = {};
  results.forEach((x) => { roundHist[x.rounds] = (roundHist[x.rounds] || 0) + 1; });

  console.log('\n===== 汇总 =====');
  console.log('  次数 ' + n + '  成功 ' + ok + '  失败 ' + (n - ok) + '  → 成功率 '
    + (n ? Math.round((ok / n) * 100) : 0) + '%  （失败率 ' + (n ? Math.round(((n - ok) / n) * 100) : 0) + '%）');
  console.log('  平均轮次 ' + avg((x) => x.rounds).toFixed(2) + '（分布 ' + JSON.stringify(roundHist) + '）');
  console.log('  平均 token ' + Math.round(avg((x) => x.tokens)) + '  合计 ' + results.reduce((a, x) => a + x.tokens, 0));
  console.log('  平均耗时 ' + Math.round(avg((x) => x.secs)) + 's  总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  console.log('  失败码分布 ' + (Object.keys(failCodes).length ? JSON.stringify(failCodes) : '（无失败）'));
  console.log('  对照：旧契约文档记录失败率约 11%（同一模型 qwen-plus）');

  // ── 清理 ──
  await query(`DELETE FROM world_objects WHERE region_id=$1`, [REGION_KEY]);
  await query(`DELETE FROM world_build_missions WHERE region_key=$1`, [REGION_KEY]);
  await query(`DELETE FROM world_regions WHERE region_key=$1`, [REGION_KEY]);
  console.log('  已清理临时区域与委托');
  try { await pool.end(); } catch (e) { /* ignore */ }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
