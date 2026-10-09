/**
 * accept_world_ai_phase6 —— Phase 6 验收（判据 P5-1 ~ P5-14）
 * AI World Brain · Phase 6 · AI Gameplay（任务 · 活动 · 交互点 · 经济）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 运行：node scripts/accept_world_ai_phase6.js
 * 前置：本地 3002 已重启（新迁移 add_world_tasks_p6/add_world_activities/add_wallets 已执行）。
 * 口径：LLM 零调用；确定性数据走 HTTP + 管理员 token；进程内 executor 显式传 worldId；
 *       并发判据（P5-12）用进程内 Promise.all（HTTP 双请求会被 undici pipelining 串行化）。
 * 自带开工清扫/收尾还原，可安全重跑（测试数据一律 accept_p6 前缀；事件按 actor 前缀全量清，不带时间过滤）。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const P = 'accept_p6';
const REGION = P + '_main';

let pass = 0, fail = 0;
function log(name, ok, note) {
  if (ok) { pass++; console.log('PASS  ' + name + (note ? '  —— ' + note : '')); }
  else { fail++; console.log('FAIL  ' + name + (note ? '  —— ' + note : '')); }
}
function FATAL(msg) { console.log('FATAL ' + msg); finish(); process.exit(1); }

async function api(p, opts) {
  const o = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (T && !o.noAuth) headers['Authorization'] = 'Bearer ' + T;
  const r = await fetch(BASE + p, { method: o.method || 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* 空 body */ }
  return { status: r.status, j: j || {} };
}

const { query, pool } = require('../src/database/db');
let T = null, W = null;
let humanId = null, humanJwt = null, npcId = null, poolId = null;
const box = { tasks: {}, activities: {}, shops: {}, items: {}, events: [] };
const snap = {};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ════════════════ 清扫（开工 + 收尾各一次，幂等；事件按 actor 前缀全量清）════════════════
async function cleanup() {
  try {
    const acts = (await query(`SELECT id FROM world_activities WHERE title LIKE $1 OR world_id=$2 AND created_by LIKE $3`, [P + '%', W || '', 'activity:' + P + '%'])).rows.map(r => r.id);
    if (acts.length) {
      await query(`DELETE FROM world_reward_grants WHERE interaction_key = ANY($1)`,
        [acts.map(a => 'activity:' + a)]);
    }
    await query(`DELETE FROM world_activities WHERE title LIKE $1`, [P + '%']);           // participants 级联
    await query(`DELETE FROM world_task_progress WHERE actor_id LIKE $1`, [P + '%']);
    const taskIds = (await query(`SELECT id FROM world_tasks WHERE title LIKE $1`, [P + '%'])).rows.map(r => String(r.id));
    await query(`DELETE FROM world_tasks WHERE title LIKE $1`, [P + '%']);
    await query(`DELETE FROM world_reward_grants WHERE actor_id LIKE $1 OR interaction_key LIKE $1`, [P + '%']);
    await query(`DELETE FROM player_inventory WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1 OR email LIKE $1)`, [P + '%']);
    await query(`DELETE FROM wallet_transactions WHERE owner_id IN (SELECT id FROM users WHERE username LIKE $1 OR email LIKE $1)`, [P + '%']);
    await query(`DELETE FROM wallets WHERE owner_id IN (SELECT id FROM users WHERE username LIKE $1 OR email LIKE $1)`, [P + '%']);
    await query(`DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username LIKE $1 OR email LIKE $1)`, [P + '%']);
    await query(`DELETE FROM shop_items WHERE shop_id IN (SELECT id FROM shops WHERE shop_name LIKE $1)`, [P + '%']);
    await query(`DELETE FROM shops WHERE shop_name LIKE $1`, [P + '%']);
    await query(`DELETE FROM reward_codes WHERE pool_id IN (SELECT id FROM reward_pools WHERE pool_name LIKE $1)`, [P + '%']);
    await query(`DELETE FROM reward_pools WHERE pool_name LIKE $1`, [P + '%']);
    await query(`DELETE FROM npc_chat_history WHERE player_id LIKE $1 OR npc_id IN (SELECT id FROM npcs WHERE name LIKE $1)`, [P + '%']);
    await query(`DELETE FROM npcs WHERE name LIKE $1`, [P + '%']);
    await query(`DELETE FROM world_interactions WHERE key LIKE $1`, [P + '%']);
    await query(`DELETE FROM world_objects WHERE name LIKE $1 OR created_by LIKE $2 OR region_id=$3`, [P + '%', 'activity:' + P + '%', REGION]);
    await query(`DELETE FROM world_chat_log WHERE sender_id LIKE $1 OR message LIKE $1`, [P + '%']);
    // ★ 事件清理不带 created_at 过滤（FATAL 中断轮的清理不会跑——Phase 5 教训）
    await query(`DELETE FROM world_events WHERE actor_id LIKE $1 OR target_id = ANY($2::text[])`,
      [P + '%', acts.concat(taskIds).map(String)]);
    await query(`DELETE FROM world_events WHERE actor_id='world_ai' AND payload->>'action' IN ('announced') AND created_at > NOW() - INTERVAL '1 day'`, []);
    const ex = (await query(`SELECT id, approval_id FROM world_tool_executions WHERE actor LIKE $1`, [P + '%'])).rows;
    if (ex.length) {
      await query(`DELETE FROM world_approvals WHERE id = ANY($1::uuid[])`, [ex.map(r => r.approval_id).filter(Boolean)]);
      await query(`DELETE FROM world_tool_executions WHERE id = ANY($1::bigint[])`, [ex.map(r => r.id)]);
    }
    await query(`DELETE FROM users WHERE username LIKE $1 OR email LIKE $1`, [P + '%']);
    await query(`DELETE FROM world_regions WHERE region_key = $1`, [REGION]);
  } catch (e) { console.log('  (cleanup warn)', e.message); }
}

async function restore() {
  try {
    if (snap.riskPolicy !== undefined) await api('/api/world-ai/config', { method: 'PUT', body: { risk_policy: snap.riskPolicy } });
  } catch (e) { console.log('  (restore warn)', e.message); }
}

function finish() {
  restore().then(() => cleanup()).then(() => {
    console.log('\n===== Phase 6 验收结果：' + pass + ' PASS / ' + fail + ' FAIL =====');
    console.log(fail === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
    try { require('../src/database/db').pool ? pool.end().then(() => process.exit(fail ? 1 : 0)) : process.exit(fail ? 1 : 0); }
    catch (e) { process.exit(fail ? 1 : 0); }
  }).catch(() => process.exit(fail ? 1 : 0));
}

// ════════════════ 主流程 ════════════════
(async () => {
  const li = await api('/api/admin-auth/login', { method: 'POST', noAuth: true, body: ADMIN });
  T = (li.j && (li.j.token || li.j.adminToken)) || null;
  if (!T) FATAL('管理员登录失败 status=' + li.status);
  const cfg0 = (await api('/api/world-ai/config')).j.config;
  W = cfg0.worldId; if (!W || W.indexOf('accept') >= 0) FATAL('worldId 异常：' + W);
  snap.riskPolicy = cfg0.riskPolicy;

  await cleanup();

  // ── 夹具：真人用户 / NPC / 奖励池（3 码）/ 测试区域 ──
  humanId = (await query(
    `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'accept_p6_no_login') RETURNING id`,
    [P + '_user', P + '_user@test.local'])).rows[0].id;
  humanJwt = jwt.sign({ userId: humanId, username: P + '_user' }, process.env.JWT_SECRET, { expiresIn: '2h' });
  npcId = (await query(
    `INSERT INTO npcs (name, position) VALUES ($1, $2::jsonb) RETURNING id`,
    [P + '_elder', JSON.stringify({ x: 220, y: 0, z: 220 })])).rows[0].id;
  poolId = (await query(`INSERT INTO reward_pools (pool_name, description) VALUES ($1,'Phase6 验收池') RETURNING id`, [P + '_pool'])).rows[0].id;
  for (let i = 1; i <= 5; i++) {
    await query(`INSERT INTO reward_codes (pool_id, code, reward_name) VALUES ($1,$2,$3)`,
      [poolId, P + '_code_' + i, 'Phase6 奖励 ' + i]);
  }
  // 区域：bounds 覆盖 (200~240)，远离出生点(-26,12.5)（spawn 保护 30m 外）
  await query(
    `INSERT INTO world_regions (region_key, world_id, name, bounds, autonomy, status, origin, created_by)
     VALUES ($1,$2,$3,$4::jsonb,'managed','active','ai','accept_p6') ON CONFLICT (region_key) DO NOTHING`,
    [REGION, W, P + ' 区域', JSON.stringify({ kind: 'rect', minX: 200, maxX: 240, minZ: 200, maxZ: 240 })]);

  const executor = require('../src/worldai/runtime/executor');
  const eventLog = require('../src/worldai/perception/eventLog');
  const taskService = require('../src/worldai/gameplay/taskService');
  const activityService = require('../src/worldai/gameplay/activityService');

  // ═══ P5-1 create_task → world_tasks 1 行 status='published' ═══
  const r1 = await executor.execute('create_task', {
    title: P + '_task_agent',
    objectives: [
      { type: 'reach_region', regionKey: REGION, count: 1 },
      { type: 'object_interact', key: 'reward_grant:' + P + '_mint', count: 1 },
    ],
    visibility: 'agent_only',
    reward: { type: 'reward_codes', poolKey: P + '_pool', count: 1 },
  }, { worldId: W, actor: P });
  log('P5-1 create_task 执行成功', r1.ok === true, JSON.stringify(r1.result || r1));
  const t1 = r1.ok ? (await query(`SELECT * FROM world_tasks WHERE id=$1`, [r1.result.taskId])).rows[0] : null;
  log('P5-1 world_tasks 1 行且 status=published', !!t1 && t1.status === 'published', t1 && t1.status);
  box.tasks.agent = r1.result && r1.result.taskId;

  // ═══ P5-2 Agent claim → progress 1 行（UNIQUE 防重复领）═══
  const c1 = await api('/api/world-ai/gameplay/tasks/' + box.tasks.agent + '/claim', { method: 'POST', body: { actorType: 'agent', actorId: P + '_agent' } });
  log('P5-2 首次 claim 成功', c1.status === 200 && c1.j.ok === true && !!c1.j.progress, JSON.stringify(c1.j).slice(0, 120));
  const t1b = (await query(`SELECT status FROM world_tasks WHERE id=$1`, [box.tasks.agent])).rows[0];
  log('P5-2 published → active（首个 actor 领取）', t1b && t1b.status === 'active', t1b && t1b.status);
  const c2 = await api('/api/world-ai/gameplay/tasks/' + box.tasks.agent + '/claim', { method: 'POST', body: { actorType: 'agent', actorId: P + '_agent' } });
  log('P5-2 重复 claim 被 UNIQUE 幂等（deduped）', c2.status === 200 && c2.j.ok === true && c2.j.deduped === true, JSON.stringify(c2.j).slice(0, 100));

  // ═══ P5-3 Agent 进入目标 region → 事件流 → 目标 1 自动推进（零 LLM）═══
  // 真实链路：agentPresenceBridge 埋点 → eventLog.trackRegionPresence → setImmediate → taskService
  await eventLog.trackRegionPresence(W, P + '_conn', P + '_agent', { x: 210, z: 210 });
  await sleep(2500);
  const p3 = await api('/api/world-ai/gameplay/tasks/' + box.tasks.agent + '/progress/' + P + '_agent');
  const st3 = p3.j.progress || {};
  log('P5-3 目标 1(reach_region) 自动推进', Number(st3.objective_index) >= 1,
    'objective_index=' + st3.objective_index);

  // ═══ P5-4 真人全链路：talk_to 达成 → completed → 发奖 → player_inventory 1 行（方案 A 真人直发）═══
  const r4 = await executor.execute('create_task', {
    title: P + '_task_human',
    objectives: [{ type: 'talk_to', targetType: 'npc', targetId: String(npcId), count: 1 }],
    visibility: 'human_only',
    reward: { type: 'reward_codes', poolKey: P + '_pool', count: 1 },
  }, { worldId: W, actor: P });
  box.tasks.human = r4.ok && r4.result.taskId;
  log('P5-4 前置：真人任务创建', !!box.tasks.human, r4.reason || '');
  const c4 = await api('/api/world-ai/gameplay/tasks/' + box.tasks.human + '/claim', { method: 'POST', body: { actorType: 'human', actorId: humanId } });
  log('P5-4 前置：真人 claim', c4.j.ok === true, JSON.stringify(c4.j).slice(0, 100));
  // 模拟真人-NPC 对话已发生（真实链路 = /api/npc/:id/chat 落 npc_chat_history；不走真 AI 零成本）
  await query(`INSERT INTO npc_chat_history (npc_id, player_id, player_name, role, content) VALUES ($1,$2,$3,'user','accept_p6 你好')`,
    [npcId, humanId, P + '_user']);
  const e4 = await api('/api/world-ai/gameplay/tasks/evaluate', { method: 'POST', body: { actorType: 'human', actorId: humanId } });
  const r4res = (e4.j.results || [])[0] || {};
  log('P5-4 talk_to 达成 → 任务 completed', r4res.done === true, JSON.stringify(r4res).slice(0, 140));
  const invRows = await query(`SELECT * FROM player_inventory WHERE user_id=$1`, [humanId]);
  const codeRow4 = await query(`SELECT claimed_by FROM reward_codes WHERE code=$1`, [P + '_code_1']);
  log('P5-4 rewardService 发奖 → player_inventory 1 行（真人直发）',
    invRows.rows.length === 1 && String(codeRow4.rows[0].claimed_by) === String(humanId),
    'inventory=' + invRows.rows.length);

  // ═══ P5-5 重复完成同一 reward → 幂等不重复发 ═══
  await api('/api/world-ai/gameplay/tasks/evaluate', { method: 'POST', body: { actorType: 'human', actorId: humanId } });
  const invRows5 = await query(`SELECT count(*)::int AS n FROM player_inventory WHERE user_id=$1`, [humanId]);
  const grant5 = await query(`SELECT reward_granted FROM world_task_progress WHERE task_id=$1 AND actor_id=$2`, [box.tasks.human, humanId]);
  log('P5-5 重复评估不重复发奖', invRows5.rows[0].n === 1 && grant5.rows[0].reward_granted === true,
    'inventory=' + invRows5.rows[0].n);

  // ═══ P5-6 6 种 objective 判定器逐个单测（含"不同目标去重"）═══
  // 6a reach_region（P5-3 已走真实链路，这里补判定器直测）
  await eventLog.log({ type: 'entity_enter_region', actorType: 'agent', actorId: P + '_ev', targetId: REGION, payload: { regionKey: REGION } });
  const ev = require('../src/worldai/gameplay/objectiveEvaluator');
  const u6a = await ev.evaluate({ objective: { type: 'reach_region', regionKey: REGION }, actorType: 'agent', actorId: P + '_ev', since: new Date(Date.now() - 60000) });
  log('P5-6a reach_region 判定器', u6a.done === true, 'hits=' + u6a.hits);
  // 6b reach_position
  await eventLog.log({ type: 'chat', actorType: 'agent', actorId: P + '_ev', x: 215, z: 216, payload: { len: 1 } });
  const u6b = await ev.evaluate({ objective: { type: 'reach_position', x: 215, z: 215, radius: 3 }, actorType: 'agent', actorId: P + '_ev', since: new Date(Date.now() - 60000) });
  log('P5-6b reach_position 判定器', u6b.done === true, 'hits=' + u6b.hits);
  // 6c talk_to distinct：2 个不同 NPC 完成；同一 NPC 两次不算 2
  const npc2 = (await query(`INSERT INTO npcs (name, position) VALUES ($1,'{}'::jsonb) RETURNING id`, [P + '_elder2'])).rows[0].id;
  for (const n of [npcId, npc2]) {
    await query(`INSERT INTO npc_chat_history (npc_id, player_id, player_name, role, content) VALUES ($1,$2,$3,'user','hi')`, [n, P + '_talker', P + '_talker']);
  }
  await query(`INSERT INTO npc_chat_history (npc_id, player_id, player_name, role, content) VALUES ($1,$2,$3,'user','hi again')`, [npcId, P + '_talker', P + '_talker']);
  const u6c = await ev.evaluate({ objective: { type: 'talk_to', targetType: 'npc', distinctCount: 2 }, actorType: 'human', actorId: P + '_talker', since: new Date(Date.now() - 60000) });
  log('P5-6c talk_to 不同目标去重（2 个 NPC 达成 / 同一 NPC 重复不算）', u6c.done === true && u6c.hits === 2, 'hits=' + u6c.hits);
  const u6c2 = await ev.evaluate({ objective: { type: 'talk_to', targetType: 'npc', targetId: String(npcId), count: 2 }, actorType: 'human', actorId: P + '_talker', since: new Date(Date.now() - 60000) });
  log('P5-6c2 talk_to 指定单目标 count=2', u6c2.done === true, 'hits=' + u6c2.hits);
  // 6d object_interact
  await eventLog.log({ type: 'object_interact', actorType: 'agent', actorId: P + '_ev', targetId: 'reward_grant:k1', payload: { interactionKey: 'reward_grant:k1' } });
  await eventLog.log({ type: 'object_interact', actorType: 'agent', actorId: P + '_ev', targetId: 'reward_grant:k2', payload: { interactionKey: 'reward_grant:k2' } });
  const u6d = await ev.evaluate({ objective: { type: 'object_interact', distinct: true, count: 2 }, actorType: 'agent', actorId: P + '_ev', since: new Date(Date.now() - 60000) });
  log('P5-6d object_interact distinct 判定器', u6d.done === true && u6d.hits === 2, 'hits=' + u6d.hits);
  // 6e object_exists
  const bj = require('../src/worldai/journal/batchJournal');
  await bj.createObject({ type: 'geometry_building', name: P + '_treasure_a', position_x: 205, position_z: 205 }, { regionKey: REGION, missionId: P + '_fixture', effectiveAutonomy: 'managed' });
  await bj.createObject({ type: 'geometry_building', name: P + '_treasure_b', position_x: 206, position_z: 205 }, { regionKey: REGION, missionId: P + '_fixture', effectiveAutonomy: 'managed' });
  const u6e = await ev.evaluate({ objective: { type: 'object_exists', tag: P + '_treasure', min: 2 }, actorType: 'agent', actorId: P + '_ev' });
  log('P5-6e object_exists 判定器', u6e.done === true, 'hits=' + u6e.hits);
  // 6f chat_contains
  await query(`INSERT INTO world_chat_log (sender_type, sender_id, sender_name, message) VALUES ('agent',$1,$2,'欢迎来到 accept_p6 宝藏之夜')`, [P + '_chatter', P + '_chatter']);
  const u6f = await ev.evaluate({ objective: { type: 'chat_contains', keywords: ['宝藏之夜'], min: 1 }, actorType: 'agent', actorId: P + '_chatter' });
  log('P5-6f chat_contains 判定器', u6f.done === true, 'hits=' + u6f.hits);
  // 白名单外类型拒绝
  const u6g = await ev.evaluate({ objective: { type: 'fly_to_moon' }, actorType: 'agent', actorId: P + '_ev' });
  log('P5-6g 白名单外 objective 被拒', u6g.ok === false, u6g.reason || '');

  // ═══ 补完 Agent 任务（object_interact 交互点 → Agent 登记发码 → 真人凭码 redeem：方案 A 闭环）═══
  await query(
    `INSERT INTO world_interactions (world_id, interaction_type, key, label, position, radius, payload, origin)
     VALUES ($1,'reward_grant',$2,$3,$4::jsonb,5,$5::jsonb,'ai') ON CONFLICT (world_id, interaction_type, key) DO NOTHING`,
    [W, P + '_mint', P + '_采集点', JSON.stringify({ x: 210, z: 210 }),
      JSON.stringify({ poolKey: P + '_pool' })]);
  const interactionService = require('../src/worldai/gameplay/interactionService');
  const ir = await interactionService.interact({ actorType: 'agent', actorId: P + '_agent', position: { x: 210, z: 210 }, worldId: W });
  log('P6-Agent interact：奖励登记并预留兑换码', ir.ok === true && ir.reward && ir.reward.ok === true && !!ir.reward.code,
    JSON.stringify({ granted: ir.reward && ir.reward.granted, code: ir.reward && ir.reward.code }));
  const p3b = await api('/api/world-ai/gameplay/tasks/' + box.tasks.agent + '/progress/' + P + '_agent');
  log('P6-Agent 任务完成（目标 2 object_interact 推进）', Number((p3b.j.progress || {}).objective_index) >= 2,
    'objective_index=' + (p3b.j.progress || {}).objective_index);
  const agentCode = (await query(
    `SELECT code FROM world_reward_grants WHERE actor_id=$1 AND interaction_key LIKE 'task:%' AND code IS NOT NULL LIMIT 1`,
    [P + '_agent'])).rows[0];
  log('P6-Agent 任务结算发码（world_reward_grants.code）', !!agentCode, agentCode && agentCode.code);
  const rd = await fetch(BASE + '/api/inventory/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + humanJwt },
    body: JSON.stringify({ code: agentCode && agentCode.code }),
  });
  const rdj = await rd.json();
  const invAfterRedeem = await query(`SELECT count(*)::int AS n FROM player_inventory WHERE user_id=$1`, [humanId]);
  log('P6-方案A闭环：真人凭 Agent 赠码 redeem → 背包 2 行',
    rd.status === 200 && rdj.message && invAfterRedeem.rows[0].n === 2,
    'inventory=' + invAfterRedeem.rows[0].n + ' msg=' + rdj.message);
  const rd2 = await fetch(BASE + '/api/inventory/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + humanJwt },
    body: JSON.stringify({ code: agentCode && agentCode.code }),
  });
  log('P6-方案A闭环：重复兑换幂等（deduped）', rd2.status === 200 && rd2.json && (await rd2.json()).deduped === true, '');

  // ═══ P5-7 create_event（medium）→ approvals → 批准 → scheduled → announced ═══
  await api('/api/world-ai/config', { method: 'PUT', body: { risk_policy: { low: 'auto', medium: 'approve', high: 'approve' } } });
  await sleep(300);
  const r7 = await executor.execute('create_event', {
    title: P + '_event', kind: 'treasure_hunt', regionKey: REGION,
    reward: { type: 'reward_codes', poolKey: P + '_pool', count: 1 },
    gameplayParams: { spawn: { count: 2, x: 210, z: 210, spread: 8 } },
    winWhen: [{ event: 'object_interact', count: 2 }],
  }, { worldId: W, actor: P });
  log('P5-7 medium 风险 → AWAITING_APPROVAL（不落库执行）',
    r7.ok === false && r7.code === 'AWAITING_APPROVAL' && !!r7.approvalId,
    JSON.stringify({ code: r7.code, approvalId: r7.approvalId }));
  const apRow = r7.approvalId ? (await query(`SELECT decision FROM world_approvals WHERE id=$1`, [r7.approvalId])).rows[0] : null;
  log('P5-7 world_approvals 1 行 pending', apRow && apRow.decision === 'pending', apRow && apRow.decision);
  const ap7 = await api('/api/world-ai/approvals/' + r7.approvalId + '/approve', { method: 'POST', body: { comment: 'accept_p6' } });
  log('P5-7 批准 → 执行成功', ap7.status === 200 && ap7.j.success === true, JSON.stringify(ap7.j).slice(0, 120));
  // 立刻还原 risk_policy（medium→auto），否则后续 create_shop 等 medium 工具也会进审批链
  await api('/api/world-ai/config', { method: 'PUT', body: { risk_policy: snap.riskPolicy } });
  box.activities.main = ap7.j.execution && ap7.j.execution.result && ap7.j.execution.result.activityId;
  const a7 = box.activities.main ? await api('/api/world-ai/gameplay/activities/' + box.activities.main) : { j: {} };
  log('P5-7 活动落库 status=scheduled', a7.j.activity && a7.j.activity.status === 'scheduled', a7.j.activity && a7.j.activity.status);
  const an7 = await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/announce', { method: 'POST', body: {} });
  const a7b = await api('/api/world-ai/gameplay/activities/' + box.activities.main);
  log('P5-7 announce → announced（steward 关，只断言状态）', a7b.j.activity && a7b.j.activity.status === 'announced', a7b.j.activity && a7b.j.activity.status);

  // ═══ P5-8 running → winWhen → settling → finished → 排名 + 幂等发奖 ═══
  const s8 = await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/start', { method: 'POST', body: {} });
  const spawned = (s8.j.spawnedIds || []);
  log('P5-8 start → running + spawn 2 物件（batchJournal）', s8.j.ok === true && spawned.length === 2, 'spawned=' + spawned.length);
  await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/join', { method: 'POST', body: { actorType: 'agent', actorId: P + '_agent' } });
  await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/join', { method: 'POST', body: { actorType: 'agent', actorId: P + '_agent2' } });
  // 事件 + 记分：两个 actor 各交互一次 spawn 物件
  await eventLog.log({ type: 'object_interact', actorType: 'agent', actorId: P + '_agent', worldObjectId: spawned[0], targetId: String(spawned[0]), payload: { objectTag: 'treasure' } });
  await eventLog.log({ type: 'object_interact', actorType: 'agent', actorId: P + '_agent2', worldObjectId: spawned[1], targetId: String(spawned[1]), payload: { objectTag: 'treasure' } });
  await activityService.bumpScore(box.activities.main, P + '_agent', 1);
  await activityService.bumpScore(box.activities.main, P + '_agent2', 1);
  const tk8 = await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/tick', { method: 'POST', body: {} });
  const a8 = await api('/api/world-ai/gameplay/activities/' + box.activities.main);
  const act8 = a8.j.activity || {};
  log('P5-8 winWhen 达成 → settling → finished + 排名', tk8.j.settled === true && act8.status === 'finished'
    && act8.result && Array.isArray(act8.result.ranking) && act8.result.ranking.length === 2,
    JSON.stringify({ status: act8.status, ranking: act8.result && act8.result.ranking }).slice(0, 160));
  const grants8 = await query(`SELECT count(*)::int AS n FROM world_reward_grants WHERE interaction_key=$1`, ['activity:' + box.activities.main]);
  log('P5-8 排名发奖 2 人（池内码）', grants8.rows[0].n === 2, 'grants=' + grants8.rows[0].n);
  const st82 = await api('/api/world-ai/gameplay/activities/' + box.activities.main + '/settle', { method: 'POST', body: {} });
  const grants82 = await query(`SELECT count(*)::int AS n FROM world_reward_grants WHERE interaction_key=$1`, ['activity:' + box.activities.main]);
  log('P5-8 重复结算幂等（不重复发奖）', st82.j.deduped === true && grants82.rows[0].n === 2, 'grants=' + grants82.rows[0].n);

  // ═══ P5-9 活动结束自动清场：spawned_object_ids 全删（事务）═══
  const left9 = await query(`SELECT count(*)::int AS n FROM world_objects WHERE id = ANY($1::int[])`, [spawned]);
  log('P5-9 spawned_object_ids 全部删除', left9.rows[0].n === 0, 'left=' + left9.rows[0].n);

  // ═══ P5-10/11/12 economy ═══
  const r10 = await executor.execute('create_shop', {
    name: P + '_shop', x: 205, z: 205, merchantUserId: humanId,
    items: [{ name: P + '_sword', price: 5, quantity: 1 }],
  }, { worldId: W, actor: P });
  log('P5-10 前置：create_shop 工具', r10.ok === true && r10.result && r10.result.itemIds.length === 1, JSON.stringify(r10.result || r10).slice(0, 120));
  box.items.sword = r10.result && r10.result.itemIds[0];
  const dep = await api('/api/world-ai/gameplay/wallets/deposit', { method: 'POST', body: { ownerType: 'user', ownerId: humanId, amount: 100, idempotencyKey: P + '_dep1' } });
  log('P5-10 前置：充值 100（幂等键）', dep.j.ok === true && dep.j.balance === 100, 'balance=' + dep.j.balance);
  const buy10 = await fetch(BASE + '/api/shop/purchase', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + humanJwt },
    body: JSON.stringify({ shopItemId: box.items.sword, quantity: 1 }),
  });
  const buy10j = await buy10.json();
  const ord10 = await query(`SELECT count(*)::int AS n FROM orders WHERE buyer_id=$1`, [humanId]);
  const stock10 = await query(`SELECT quantity FROM shop_items WHERE id=$1`, [box.items.sword]);
  const bal10 = await api('/api/world-ai/gameplay/wallets/user/' + humanId);
  log('P5-10 buy → 200 + orders 1 行 + 库存 0 + 余额 95',
    buy10.status === 200 && ord10.rows[0].n === 1 && Number(stock10.rows[0].quantity) === 0 && bal10.j.balance === 95,
    JSON.stringify({ order: ord10.rows[0].n, stock: stock10.rows[0].quantity, balance: bal10.j.balance }));
  // P5-11 负数 quantity → 400
  const buy11 = await fetch(BASE + '/api/shop/purchase', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + humanJwt },
    body: JSON.stringify({ shopItemId: box.items.sword, quantity: -1 }),
  });
  log('P5-11 负数 quantity → 400', buy11.status === 400, 'status=' + buy11.status);
  // P5-12 并发双 purchase 只成功一次（进程内 Promise.all）
  const r12 = await executor.execute('create_shop', {
    name: P + '_shop2', x: 205, z: 205, merchantUserId: humanId,
    items: [{ name: P + '_last', price: 1, quantity: 1 }],
  }, { worldId: W, actor: P });
  const purchaseService = require('../src/services/purchaseService');
  const [b1, b2] = await Promise.all([
    purchaseService.buy({ buyerId: humanId, shopItemId: r12.result.itemIds[0], quantity: 1 }),
    purchaseService.buy({ buyerId: humanId, shopItemId: r12.result.itemIds[0], quantity: 1 }),
  ]);
  const wins = [b1, b2].filter((x) => x.ok === true).length;
  const stock12 = await query(`SELECT quantity FROM shop_items WHERE id=$1`, [r12.result.itemIds[0]]);
  const ord12 = await query(`SELECT count(*)::int AS n FROM orders WHERE shop_item_id=$1`, [r12.result.itemIds[0]]);
  log('P5-12 并发双 purchase 只成功一次（不超卖）', wins === 1 && Number(stock12.rows[0].quantity) === 0 && ord12.rows[0].n === 1,
    JSON.stringify({ wins, stock: stock12.rows[0].quantity, orders: ord12.rows[0].n }));

  // ═══ P5-13 外部 Agent 对 NPC/商店/任务零写权限（scope_denied 红线不破）═══
  const agentJwt = jwt.sign({ sub: P + '_fake', agentId: P + '_fake' }, process.env.AGENT_JWT_SECRET || process.env.JWT_SECRET, { expiresIn: '10m', jwtid: P + '_j' });
  const p13a = await fetch(BASE + '/api/gameplay/tasks/' + box.tasks.agent + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + agentJwt }, body: '{}' });
  const p13b = await fetch(BASE + '/api/shop/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + agentJwt }, body: JSON.stringify({ shopItemId: box.items.sword, quantity: 1 }) });
  log('P5-13 Agent JWT 打真人/商店写口被拒（401/403）', [401, 403].indexOf(p13a.status) >= 0 && [401, 403].indexOf(p13b.status) >= 0,
    'claim=' + p13a.status + ' purchase=' + p13b.status);
  const caps = await api('/api/agent/v1/capabilities', { noAuth: true });
  const actions = (caps.j.actions || caps.j.capabilities && caps.j.capabilities.actions || []);
  log('P5-13 capabilities.actions 仍 8 项（一行未动）', actions.length === 8, 'actions=' + actions.length);

  finish();
})().catch((e) => { console.log('FATAL 异常:', e && e.stack || e); try { finish(); } catch (e2) { process.exit(1); } });
