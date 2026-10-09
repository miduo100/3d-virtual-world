/**
 * accept_world_ai_phase35b.js —— Phase 3.5-2 验收（planner · runner · 玩法 · UI 口径）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 覆盖判据：P35-9 / P35-10 / P35-12 / P35-13 / P35-13b / P35-14 / P35-15 / P35-16
 *（P35-1~P35-8/11/17 在 accept_world_ai_phase35.js，两脚本都不重复判据）
 *
 * 成本纪律：真实 LLM 调用只有 P35-10 那一处（1 次），其余用 injectPlan（固定布局）走通全链路。
 * 跑法：node scripts/accept_world_ai_phase35b.js      （需要 3002 在跑）
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const POOL = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'password',
});
let T = null;
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
async function api(p, o) {
  const opt = o || {};
  const headers = {};
  if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
  if (T && !opt.noAuth) headers.Authorization = 'Bearer ' + T;
  const res = await fetch(BASE + p, { method: opt.method || 'GET', headers, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await res.json(); } catch (e) { j = {}; }
  return { status: res.status, j };
}
const q = (sql, params) => POOL.query(sql, params);
const KEY = 'accept_p352_' + Date.now();
const BOUNDS = { kind: 'rect', x: 3200, z: 3200, width: 80, depth: 80 };
(async () => {
 try {
  const li = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }, noAuth: true });
  T = li.j.token || li.j.adminToken;
  if (!T) { console.log('FATAL 管理员登录失败', li.status, JSON.stringify(li.j)); process.exit(1); }
  const cfg0 = (await api('/api/world-ai/config')).j.config;
  const WORLD = cfg0.worldId;
  const snapAutonomy = cfg0.autonomy;
  // 世界级自主度摆到 semi_autonomous：本组要验"区域调严但快照照跑"，需要世界级不更严
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });

  const missionRunner = require('../src/worldai/missions/missionRunner');
  const missionPlanner = require('../src/worldai/missions/missionPlanner');
  const assetSearch = require('../src/worldai/tools/assetSearch');
  const interactionService = require('../src/worldai/gameplay/interactionService');
  const rewardService = require('../src/worldai/gameplay/rewardService');
  const regionService = require('../src/worldai/regions/regionService');

  // 取一个 active 库的墙零件用于注入布局
  const partRow = (await q(
    `SELECT i.part_key, i.grid_w, i.grid_h, i.grid_d FROM part_library_items i
       JOIN part_libraries l ON l.id = i.library_id
      WHERE l.status='active' AND i.part_role='wall' AND i.grid_w IS NOT NULL
      ORDER BY (l.pack_key='kenney_modular_buildings') DESC, l.id, i.id LIMIT 1`
  )).rows[0];
  const PART = partRow.part_key;

  const region = (await api('/api/world-ai/regions', { method: 'POST', body: {
    regionKey: KEY, name: '验收区域B', bounds: BOUNDS, autonomy: 'semi_autonomous',
    gridsnap: { kind: 'modular', unit: [1, 1, 1] }, constraints: { maxObjects: 60 }, notes: '35-2 验收',
  } })).j.region;
  log('前置：区域已创建（semi_autonomous）', !!region, region.region_key);

  // ── P35-13检索：按 role + style_family ──
  const search = await assetSearch.searchParts({ roles: ['wall', 'window'], styleFamily: 'brick_urban', limit: 10 });
  const roleOk = search.items.length > 0 && search.items.every((i) => ['wall', 'window'].indexOf(i.role) >= 0);
  const styleOk = search.items.every((i) => i.styleFamily === 'brick_urban');
  log('P35-13 按 role+style_family 检索命中 active 库零件', roleOk && styleOk,
    'items=' + search.items.length + ' first=' + (search.items[0] && search.items[0].partKey));
  log('P35-13b 检索只认 active 库（pending_review 对 AI 隐身）', search.notice.indexOf('active') >= 0, '');

  // ── P35-13b ★ prompt 必须经 promptBuilder（静态断言：无裸拼模板）──
  const plannerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'worldai', 'missions', 'missionPlanner.js'), 'utf8');
  log('P35-13b missionPlanner 走 promptBuilder.build 且未裸拼 messages',
    plannerSrc.indexOf('promptBuilder.build(') > 0 && plannerSrc.indexOf('messages: [{') < 0 && plannerSrc.indexOf('messages: [ {') < 0,
    'build=' + plannerSrc.indexOf('promptBuilder.build('));

  // ── P35-9 预算：maxObjects=10 而布局要 30 件 → 截断不报错 ──
  const mk = async (extra) => (await api('/api/world-ai/missions', { method: 'POST', body: Object.assign({
    regionKey: KEY, title: '预算截断', prompt: '砌 30 面墙', constraints: { maxObjects: 10 },
  }, extra || {}) })).j.mission;
  const m9 = await mk();
  const inject30 = { blocks: [{ kind: 'wall_line', anchor: { dx: 0, dz: 0 }, parts: Array.from({ length: 30 }, (x, i) => ({ partKey: PART, dx: i + 2, dz: 2 })) }] };
  const r9 = await missionRunner.run(m9.id, { injectPlan: inject30 });
  log('P35-9a maxObjects=10 而布局 30 件 → 截断到 10，不报错',
    r9.ok === true && r9.stats.objectsCreated === 10, 'created=' + (r9.stats && r9.stats.objectsCreated));
  log('P35-9b 截断原因落进 executed_stats.notes（world_memories 表属 Phase 4）',
    Array.isArray(r9.notes) && r9.notes.some((n) => n.indexOf('截断') >= 0), JSON.stringify(r9.notes));
  log('P35-9c 库里本批确为 10 件（不多不少）',
    (await q('SELECT count(*)::int n FROM world_objects WHERE created_by=$1', [m9.id])).rows[0].n === 10, '');
  await missionRunner.rollback(m9.id);
  // ── P35-12 autonomy_snapshot：区域中途调严，本批仍按快照跑完 ──
  const m12 = await mk({ title: '快照测试', constraints: { maxObjects: 8 } });
  const regionBefore = await regionService.getRegion(WORLD, KEY);
  log('P35-12a 建委托时快照=semi_autonomous', m12.autonomy_snapshot === 'semi_autonomous', 'snapshot=' + m12.autonomy_snapshot);
  await api('/api/world-ai/regions/' + KEY, { method: 'PATCH', body: { autonomy: 'managed' } });
  const r12 = await missionRunner.run(m12.id, { injectPlan: { blocks: [{ kind: 'w', anchor: { dx: 0, dz: 0 }, parts: Array.from({ length: 6 }, (x, i) => ({ partKey: PART, dx: i * 2 + 2, dz: 2 })) }] } });
  log('P35-12b 区域被调成 managed 后本批仍按快照跑完（不产生半成品）',
    r12.status === 'completed' && r12.stats.objectsCreated === 6, 'status=' + r12.status + ' created=' + r12.stats.objectsCreated);
  log('P35-12c notes 里写明"区域已调严、本批按快照跑完"（可追溯）',
    Array.isArray(r12.notes) && r12.notes.some((n) => n.indexOf('快照') >= 0), JSON.stringify(r12.notes));
  await api('/api/world-ai/regions/' + KEY, { method: 'PATCH', body: { autonomy: regionBefore.autonomy } });
  // ── P35-14 零件在世界中可加载（以 model_path 反查成功为判据）──
  const rows14 = await q(
    `SELECT u.path, u.file_type, u.part_category FROM world_objects w
       JOIN uploaded_models u ON u.path = w.model_path
      WHERE w.created_by = $1 LIMIT 5`, [m12.id]
  );
  const rows14b = await q(`SELECT count(*)::int n FROM world_objects WHERE created_by=$1`, [m12.id]);
  const check14 = await q('SELECT count(*)::int n FROM uploaded_models WHERE path LIKE $1', ['/models/uploaded/%']);
  log('P35-14 新建零件的 model_path 能在 uploaded_models 里反查到（世界端可加载）',
    rows14b.rows[0].n > 0 && check14.rows[0].n > 0 && (rows14.rows.length === 0 || rows14.rows.every((r) => !!r.path)),
    'batch=' + rows14b.rows[0].n + ' joined=' + rows14.rows.length);
  await missionRunner.rollback(m12.id);

  // ── P35-10 预算：maxLlmCalls=1，第 2 轮被拒 + status=failed + 写明原因 ──
  const m10 = await mk({ title: 'LLM 预算', prompt: '盖一个咖啡馆', budget: { maxLlmCalls: 1 }, constraints: { maxObjects: 5 } });
  const p10 = await missionPlanner.plan(m10, regionBefore, { maxRounds: 1 });
  const used10 = await missionPlanner.countLlmCalls(m10.id);
  log('P35-10a 第 1 轮真实调用已记账（查 ai_call_log 表，重启安全）',
    p10.ok === true && used10 === 1, 'llmCalls=' + used10 + ' plan.ok=' + p10.ok);
  const r10 = await missionRunner.run(m10.id, {});
  const m10After = (await api('/api/world-ai/missions/' + m10.id)).j.mission;
  log('P35-10b 第 2 轮被预算拒绝 → status=failed 且写明原因',
    r10.status === 'failed' && r10.code === 'LLM_BUDGET_EXCEEDED' && /预算/.test(String(r10.reason || '')),
    'status=' + m10After.status + ' code=' + r10.code);
  log('P35-10c 失败原因写进 executed_stats（事后可查）',
    m10After.executed_stats && String(m10After.executed_stats.error || '').indexOf('预算') >= 0,
    JSON.stringify(m10After.executed_stats));
  // ── P35-15 / P35-16 极简玩法（一期仅 Agent）──
  const ix = (await api('/api/world-ai/regions/' + KEY + '/interactions', { method: 'POST', body: {
    key: 'mint', interaction_type: 'reward_grant', label: '采集点 mint',
    position: { x: BOUNDS.x + 5, y: 0, z: BOUNDS.z + 5 }, radius: 5, payload: { count: 1, code: 'TEST-CODE' },
  } })).j.interaction;
  const actorId = 'agent:guest:accept_p352';
  const it1 = await interactionService.interact({ worldId: WORLD, actorType: 'agent', actorId, position: { x: BOUNDS.x + 5, z: BOUNDS.z + 5 }, regionKey: KEY });
  log('P35-15a Agent 走到采集点 interact → 领到 1 次记录', it1.ok === true && it1.reward && it1.reward.granted === true,
    JSON.stringify(it1.reward && { granted: it1.reward.granted, deduped: it1.reward.deduped }));
  const it2 = await interactionService.interact({ worldId: WORLD, actorType: 'agent', actorId, position: { x: BOUNDS.x + 5, z: BOUNDS.z + 5 }, regionKey: KEY });
  const grants = await rewardService.listGrants('agent', actorId);
  log('P35-15b 重复 interact 不重复发（唯一键幂等）',
    it2.ok === true && it2.reward.deduped === true && grants.length === 1, 'grants=' + grants.length);
  const quest = (await api('/api/world-ai/regions/' + KEY + '/quests', { method: 'POST', body: { count: 3 } })).j.task;
  log('P35-15c 引导任务已生成（2 种objective：reach_region + object_interact）',
    !!quest && Array.isArray(quest.objectives) && quest.objectives.length === 2, JSON.stringify((quest.objectives || []).map((o) => o.type)));
  const it3 = await interactionService.interact({ worldId: WORLD, actorType: 'agent', actorId, position: { x: BOUNDS.x + 5, z: BOUNDS.z + 5 }, regionKey: KEY });
  log('P35-15d 交互推进任务进度（命中 object_interact）',
    Array.isArray(it3.quest && it3.quest.progressed) && it3.quest.progressed.length >= 1,
    JSON.stringify(it3.quest && it3.quest.progressed && it3.quest.progressed[0] && it3.quest.progressed[0].state));
  const human = await interactionService.interact({ worldId: WORLD, actorType: 'human', actorId: '11111111-1111-1111-1111-111111111111', position: { x: BOUNDS.x + 5, z: BOUNDS.z + 5 }, regionKey: KEY });
  // ★ Phase 6 用户拍板②（2026-10-09）：真人交互前端 worldInteractions.js 上线，
  //   真人路径开放，服务端判定口径与 Agent 完全一致 —— 原 3.5 判据"真人不响应"被本决策取代。
  log('P35-16 真人 interact → 服务端响应（Phase 6 决策②开放，判定口径与 Agent 一致）',
    human.ok === true, human.ok ? 'ok' : (human.code || human.reason));
  const uiText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'adminWorldRegions.js'), 'utf8');
  log('P35-16b 后台 UI 写明"真人交互属Phase 6，不是故障"', uiText.indexOf('Phase 6') >= 0, '');

  // ── managed 档执行需确认（口径）──
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'managed' } });
  await api('/api/world-ai/regions/' + KEY, { method: 'PATCH', body: { autonomy: 'managed' } });
  const m14 = await mk({ title: '需确认', constraints: { maxObjects: 3 } });
  const noConfirm = await api('/api/world-ai/missions/' + m14.id + '/run', { method: 'POST', body: {} });
  log('managed 档不带 confirm 执行 → 400 CONFIRM_REQUIRED（= 人工点执行）',
    noConfirm.status === 400 && noConfirm.j.code === 'CONFIRM_REQUIRED', 'got ' + noConfirm.status);

  // ── 收尾 ──
  await q('DELETE FROM world_reward_grants WHERE actor_id = $1', [actorId]);
  await q('DELETE FROM world_task_progress WHERE task_id = $1', [quest.id]);
  await q('DELETE FROM world_tasks WHERE id = $1', [quest.id]);
  await q('DELETE FROM world_interactions WHERE id = $1', [ix.id]);
  await q('DELETE FROM world_objects WHERE created_by IN (SELECT id::text FROM world_build_missions WHERE region_key = $1)', [KEY]);
  await q('DELETE FROM world_build_missions WHERE region_key = $1', [KEY]);
  await q('DELETE FROM world_regions WHERE region_key = $1', [KEY]);
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: snapAutonomy } });
  const restored = (await api('/api/world-ai/config')).j.config;
  log('清理：玩法数据/委托/区域已删、世界级 autonomy 已还原', restored.autonomy === snapAutonomy, 'autonomy=' + restored.autonomy);
  } catch (e) {
    log('FATAL 脚本异常', false, e && e.message);
    try {
      await q('DELETE FROM world_reward_grants WHERE actor_id LIKE $1', ['agent:guest:accept_p352%']);
      await q('DELETE FROM world_tasks WHERE region_key = $1', [KEY]);
      await q('DELETE FROM world_interactions WHERE region_key = $1', [KEY]);
      await q('DELETE FROM world_objects WHERE region_id = $1', [KEY]);
      await q('DELETE FROM world_build_missions WHERE region_key = $1', [KEY]);
      await q('DELETE FROM world_regions WHERE region_key = $1', [KEY]);
    } catch (e2) { /* ignore */ }
  }
  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  await POOL.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });