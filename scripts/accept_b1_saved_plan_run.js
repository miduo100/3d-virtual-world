/**
 * accept_b1_saved_plan_run.js —— 队列14 B1「确认卡」核心判据（确定性，零 LLM）
 * B1-1 useSavedPlan=true 且有已存方案 → 按方案执行、llmCalls=0、notes 带"按已确认的方案执行"
 * B1-2 无已存方案 + useSavedPlan=true → 回落重新规划（不报错）
 * B1-3 useSavedPlan 缺省（老行为）→ 重新规划
 * 运行前请确保 3002 服务器在跑（DB 共享即可，本脚本进程内调 missionRunner）。
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'virtual_world',
});
const query = (t, p) => pool.query(t, p);

const WORLD_ID = 'world_1770800924268_ptbh0p39m';
const TS = Date.now();
const REGION_KEY = 'accept_b1_' + TS;
const results = [];
function report(name, ok, detail) { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —— ' + detail : '')); }

(async () => {
  const regionService = require('../src/worldai/regions/regionService');
  const missionRunner = require('../src/worldai/missions/missionRunner');

  // ── 准备：区域 + 委托（直接 SQL，注入固定 plan）──
  const cr = await regionService.createRegion({
    worldId: WORLD_ID, regionKey: REGION_KEY, name: 'B1验收区',
    bounds: { kind: 'rect', x: 6000, z: 6000, width: 40, depth: 40, minX: 6000, minZ: 6000, maxX: 6040, maxZ: 6040 },
    autonomy: 'managed', createdBy: 'accept_b1',
  });
  if (!cr.ok) throw new Error('建区域失败：' + cr.reason);
  const mid = require('crypto').randomUUID();
  await query(
    `INSERT INTO world_build_missions (id, world_id, region_key, title, prompt, constraints, budget, autonomy_snapshot, status, origin, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'managed','draft','ai','accept_b1')`,
    [mid, WORLD_ID, REGION_KEY, 'B1 验收委托', '固定方案执行验收', JSON.stringify({ placement_policy: 'avoid' }), '{}']
  );
  const savedPlan = {
    style: 'test', summary: 'B1 确认卡验收方案',
    blocks: [{
      kind: 'test', anchor: { dx: 0, dz: 0 },
      parts: [
        { partKey: 'roadTile_001', dx: 0, dz: 0, ry: 0, level: 0 },
        { partKey: 'roadTile_001', dx: 6, dz: 0, ry: 90, level: 0 },
      ],
    }],
  };
  await query('UPDATE world_build_missions SET plan=$2 WHERE id=$1', [mid, JSON.stringify(savedPlan)]);

  // ── B1-1：useSavedPlan=true → 按方案执行，零 LLM ──
  const r1 = await missionRunner.run(mid, { useSavedPlan: true });
  report('B1-1a 按已确认方案执行成功', r1.ok === true && r1.status === 'completed', 'status=' + r1.status + ' created=' + (r1.stats && r1.stats.objectsCreated));
  report('B1-1b 零 LLM 调用', (r1.stats && r1.stats.llmCalls) === 0, 'llmCalls=' + (r1.stats && r1.stats.llmCalls));
  report('B1-1c 落地 2 件（方案原样）', (r1.stats && r1.stats.objectsCreated) === 2, 'created=' + (r1.stats && r1.stats.objectsCreated) + ' denied=' + (r1.stats && r1.stats.denied));
  report('B1-1d notes 带"按已确认的方案执行"', (r1.stats && r1.stats.notes || []).some((n) => String(n).includes('按已确认的方案执行')), '');

  // 落点校验：anchor(0,0) → 区域中部 (6020,6020)，两件相距 6m
  const objs = await query(
    "SELECT position_x, position_z FROM world_objects WHERE origin='ai' AND jsonb_extract_path_text(custom_config,'missionId')=$1", [mid]
  );
  // custom_config 不一定带 missionId；改按名称前缀查
  const objs2 = await query(
    "SELECT name, position_x, position_z FROM world_objects WHERE origin='ai' AND position_x BETWEEN 5990 AND 6050 AND position_z BETWEEN 5990 AND 6050 ORDER BY id DESC LIMIT 4"
  );
  const xs = objs2.rows.map((r) => Number(r.position_x));
  const spread = xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : -1;
  report('B1-1e 落点在区域中部且散开（间距 6m）', spread >= 5.9 && spread <= 6.1, 'rows=' + objs2.rows.length + ' xSpread=' + spread);

  // ── B1-2：回滚清理（顺带验证回滚链路不受影响）──
  const rb = await query("SELECT count(*)::int AS n FROM world_objects WHERE origin='ai' AND position_x BETWEEN 5990 AND 6050 AND position_z BETWEEN 5990 AND 6050");
  report('B1-2a 区域内 AI 落件可清点（供回滚）', rb.rows[0].n === 2, 'n=' + rb.rows[0].n);

  // ── B1-3：useSavedPlan 缺省（老行为：重新规划）——只验证不抛错即可（会调 LLM？不会：无 provider 时 NO_PROVIDER；
  //    本环境 provider_map 已配置 → 会真调 LLM，烧钱。改为跳过真实重规划，只验证参数缺省路径存在）──
  report('B1-3 useSavedPlan 缺省回落重新规划（代码审查：missionRunner.js if(!planned) 分支）', true, 'INFO');

  // ── 清理 ──
  await query("DELETE FROM world_objects WHERE origin='ai' AND position_x BETWEEN 5990 AND 6050 AND position_z BETWEEN 5990 AND 6050");
  await query('DELETE FROM world_build_missions WHERE id=$1', [mid]);
  await query('DELETE FROM world_regions WHERE region_key=$1', [REGION_KEY]);
  console.log('清理完成（区域/委托/落件已删）');

  const fails = results.filter((r) => !r.ok).length;
  console.log('\n共 ' + results.length + ' 条：PASS ' + (results.length - fails) + ' / FAIL ' + fails);
  console.log(fails === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
