/**
 * accept_b2_followup.js —— 队列14 B2「增量补充」判据（1 次管理员登录）
 * B2-1 followup 创建新委托且 prompt 注入【增量补充】+【区域内已有 AI 资产】清单
 * B2-2 已有资产按零件名计数（name×n）
 * B2-3 空补充要求 → 400 PROMPT_REQUIRED
 * B2-4 新委托继承原委托 constraints，autonomy_snapshot 取区域当前值
 */
const BASE = 'http://localhost:3002';
const results = [];
const report = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —— ' + detail : '')); };
const TS = Date.now();
const REGION_KEY = 'accept_b2_' + TS;

(async () => {
  // 登录
  const lr = await fetch(BASE + '/api/admin-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }) });
  const lj = await lr.json();
  if (!lj.token) { console.error('FATAL 登录失败：' + JSON.stringify(lj).slice(0, 200)); process.exit(2); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };

  // 建区域 + 委托
  const cr = await (await fetch(BASE + '/api/world-ai/regions', { method: 'POST', headers: H, body: JSON.stringify({ regionKey: REGION_KEY, name: 'B2验收区', bounds: { kind: 'rect', x: 8000, z: 8000, width: 40, depth: 40 }, autonomy: 'managed' }) })).json();
  if (!cr.success) { console.error('FATAL 建区域失败：' + JSON.stringify(cr).slice(0, 200)); process.exit(2); }
  const cm = await (await fetch(BASE + '/api/world-ai/missions', { method: 'POST', headers: H, body: JSON.stringify({ regionKey: REGION_KEY, title: 'B2 原始', prompt: '用零件库搭一个森林', constraints: { max_objects: 40 } }) })).json();
  if (!cm.success) { console.error('FATAL 建委托失败：' + JSON.stringify(cm).slice(0, 200)); process.exit(2); }
  const mid = cm.mission.id;

  // 模拟"上一批已建"：直接插 2 个 AI 对象（name=零件名）
  const { Pool } = require('pg');
  require('dotenv').config();
  const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'virtual_world' });
  await pool.query(
    `INSERT INTO world_objects (name, type, position_x, position_y, position_z, origin, model_path)
     VALUES ('tree_pine','uploaded_model',8005,0,8005,'ai','/models/uploaded/x.glb'),
            ('tree_pine','uploaded_model',8012,0,8012,'ai','/models/uploaded/x.glb')`
  );

  // B2-3 空要求 → 400
  const e400 = await fetch(BASE + '/api/world-ai/missions/' + mid + '/followup', { method: 'POST', headers: H, body: JSON.stringify({ prompt: '' }) });
  const e400j = await e400.json();
  report('B2-3 空补充要求 → 400 PROMPT_REQUIRED', e400.status === 400 && e400j.code === 'PROMPT_REQUIRED', 'status=' + e400.status + ' code=' + e400j.code);

  // B2-1/B2-2 正常 followup
  const fr = await fetch(BASE + '/api/world-ai/missions/' + mid + '/followup', { method: 'POST', headers: H, body: JSON.stringify({ prompt: '再加 10 棵，增加几种不同的树' }) });
  const fj = await fr.json();
  report('B2-1 followup 200 且新委托 prompt 注入清单', fr.status === 200 && fj.success
    && String(fj.mission.prompt).includes('【增量补充】再加 10 棵')
    && String(fj.mission.prompt).includes('【区域内已有 AI 资产】')
    && String(fj.mission.prompt).includes('tree_pine×2'), 'prompt 前 160 字=' + String(fj.mission.prompt || '').slice(0, 160).replace(/\n/g, '⏎'));
  report('B2-2 已有资产按零件名计数', (fj.existingAssets || []).some((x) => x.name === 'tree_pine' && x.n === 2), JSON.stringify(fj.existingAssets || []).slice(0, 120));
  report('B2-4 继承 constraints 且 snapshot=区域当前(managed)', JSON.stringify(fj.mission.constraints || {}).includes('max_objects') && fj.mission.autonomy_snapshot === 'managed', 'snapshot=' + fj.mission.autonomy_snapshot);

  // 清理
  await pool.query("DELETE FROM world_objects WHERE origin='ai' AND position_x BETWEEN 7990 AND 8050 AND position_z BETWEEN 7990 AND 8050");
  await pool.query('DELETE FROM world_build_missions WHERE region_key=$1', [REGION_KEY]);
  await pool.query('DELETE FROM world_regions WHERE region_key=$1', [REGION_KEY]);
  await pool.end();
  console.log('清理完成');

  const fails = results.filter((x) => !x).length;
  console.log('\n共 ' + results.length + ' 条：PASS ' + (results.length - fails) + ' / FAIL ' + fails);
  console.log(fails === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
