/**
 * accept_world_ai_phase35c.js —— Phase 3.5-3 验收（Agent interact 接线 + 并发/路由/fallback 判据）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 覆盖判据：
 *   P35-19 两区域 + 两不同 provider 并发 run → 产物 region_id 各自正确 / skippedByCollision 互不影响 / 两边 completed
 *   P35-20 同区域两委托并发 → 一个 409 REGION_BUSY（非硬失败）；被拒后重跑能完成
 *   P35-21 区域默认 B + 委托手选 A → 全部轮次 provider=A；create 响应 providerResolution.source='mission'；plan/tool_select 异家仍拒（P1-14）
 *   P35-22 注入一次 429 → 切备用家 → ai_call_log 两条不同 provider + executed_stats.notes 写明原因
 *   P35-23 Agent WS ACTION interact → reward 幂等（deduped）/ 引导任务推进
 *   P35-24 未知动作仍 unknown_action（白名单没有被顺手放宽）
 *
 * 成本纪律：全程零真实 LLM 调用 —— P35-21/22 用 fetch 桩（按 provider host 分流 429/200），
 * 429 与成功两种响应都由 llmClient 真实处理并落 ai_call_log（账本行为是真的，只有上游 HTTP 是桩）。
 * 跑法：node scripts/accept_world_ai_phase35c.js   （需要 3002 在跑新代码）
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const POOL = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'password',
});
const q = (sql, params) => POOL.query(sql, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = null;
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
const realFetch = global.fetch;
async function api(p, o) {
  const opt = o || {};
  const headers = {};
  if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
  if (T && !opt.noAuth) headers.Authorization = 'Bearer ' + T;
  const res = await realFetch(BASE + p, { method: opt.method || 'GET', headers, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await res.json(); } catch (e) { j = {}; }
  return { status: res.status, j };
}

// ── fetch 桩（只拦 LLM 上游，按 host → provider id 分流；其余请求透传真实 fetch）──
let STUB = null; // { hostMap:{host:pid}, behavior:{pid:'ok'|'429'}, planJson, calls:[] }
global.fetch = async function (url, opts) {
  if (STUB) {
    let host = ''; try { host = new URL(String(url)).host; } catch (e) { /* not a url */ }
    const pid = host && STUB.hostMap[host];
    if (pid) {
      STUB.calls.push({ pid, url: String(url).slice(0, 120) });
      const beh = STUB.behavior[pid];
      if (beh === '429') {
        return new Response(JSON.stringify({ error: { message: 'accept_35c stub: rate limited', code: 'rate_limit' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } });
      }
      if (beh === 'ok') {
        return new Response(JSON.stringify({
          id: 'stub', choices: [{ message: { role: 'assistant', content: STUB.planJson } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }
  return realFetch.call(this, url, opts);
};
function findHosts(obj, out) {
  if (!obj || typeof obj !== 'object' || out.length > 20) return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) { try { out.push(new URL(v).host); } catch (e) { /* skip */ } }
    else if (v && typeof v === 'object') findHosts(v, out);
  }
}
async function waitLedger(missionId, minRows, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await q('SELECT count(*)::int AS n FROM ai_call_log WHERE mission_id = $1', [String(missionId)]);
    if (r.rows[0].n >= minRows) return r.rows[0].n;
    if (Date.now() - t0 > (timeoutMs || 8000)) return r.rows[0].n;
    await sleep(300);
  }
}

const KEY = 'accept_p353_' + Date.now();
const R1 = KEY + '_r1', R2 = KEY + '_r2', R3 = KEY + '_r3', R5 = KEY + '_r5';
const makePlan = (PART) => JSON.stringify({
  style: 'accept_35c', summary: 'stub plan',
  blocks: [{ kind: 'wall_line', anchor: { dx: 0, dz: 0 }, parts: [
    { partKey: PART, dx: 4, dz: 4 }, { partKey: PART, dx: 10, dz: 4 }, { partKey: PART, dx: 16, dz: 4 },
  ] }],
});

(async () => {
  let agentEnabled0 = null;
  let ws = null;
  try {
    const li = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }, noAuth: true });
    T = li.j.token || li.j.adminToken;
    if (!T) { console.log('FATAL 管理员登录失败', li.status, JSON.stringify(li.j)); process.exit(1); }
    const cfg0 = (await api('/api/world-ai/config')).j.config;
    const WORLD = cfg0.worldId;
    const snapAutonomy = cfg0.autonomy;
    await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });

    const en0 = await q("SELECT config_value FROM system_config WHERE config_key='agent_enabled'");
    agentEnabled0 = en0.rows[0] && en0.rows[0].config_value;

    const missionRunner = require('../src/worldai/missions/missionRunner');
    const missionPlanner = require('../src/worldai/missions/missionPlanner');
    const regionService = require('../src/worldai/regions/regionService');
    const providerRouter = require('../src/worldai/llm/providerRouter');
    const providerService = require('../src/services/aiProviderService');
    const resolver = require('../src/services/llmProviderResolver');

    // 候选链前两家作为 A/B（真实解密口径）
    const cands = await resolver.candidates('plan');
    if (!cands || cands.length < 2) { console.log('FATAL 需要两家可用 provider 做并发/覆盖/fallback 判据'); process.exit(1); }
    const A = Number(cands[0].id), B = Number(cands[1].id);
    const hostMap = {};
    for (const c of [cands[0], cands[1]]) {
      const full = await providerService.getProvider(Number(c.id), true);
      const hs = []; findHosts(full, hs);
      hs.forEach((h) => { hostMap[h] = Number(c.id); });
    }
    log('前置：候选链前两家 provider 可用（A=' + A + ' B=' + B + '）',
      Object.keys(hostMap).length >= 2 || (A > 0 && B > 0), 'hosts=' + Object.keys(hostMap).join(','));

    const partRow = (await q(
      `SELECT i.part_key FROM part_library_items i JOIN part_libraries l ON l.id = i.library_id
        WHERE l.status='active' AND i.part_role='wall' ORDER BY l.id, i.id LIMIT 1`)).rows[0];
    const PART = partRow.part_key;
    const mkRegion = async (rk, bounds, extra) => (await api('/api/world-ai/regions', { method: 'POST', body: Object.assign({
      regionKey: rk, name: '验收区域 ' + rk.slice(-2), bounds, autonomy: 'semi_autonomous',
      gridsnap: { kind: 'modular', unit: [1, 1, 1] }, constraints: { maxObjects: 6 }, notes: '35-3 验收',
    }, extra || {}) })).j.region;
    const mkMission = async (body) => (await api('/api/world-ai/missions', { method: 'POST', body })).j;

    // ══ P35-19 两区域 + 两 provider 并发 ══
    await mkRegion(R1, { x: 6400, z: 6400, width: 80, depth: 80 });
    await mkRegion(R2, { x: 6600, z: 6600, width: 80, depth: 80 });
    const m1 = await mkMission({ regionKey: R1, title: '并行A', prompt: '砌墙', providerId: A, constraints: { maxObjects: 4 } });
    const m2 = await mkMission({ regionKey: R2, title: '并行B', prompt: '砌墙', providerId: B, constraints: { maxObjects: 4 } });
    log('P35-19a 两委托分别绑定不同 provider', Number(m1.mission.provider_id) === A && Number(m2.mission.provider_id) === B,
      'm1=' + m1.mission.provider_id + ' m2=' + m2.mission.provider_id);
    const inj = { blocks: [{ kind: 'w', anchor: { dx: 0, dz: 0 }, parts: [
      { partKey: PART, dx: 4, dz: 4 }, { partKey: PART, dx: 10, dz: 4 }, { partKey: PART, dx: 16, dz: 4 }] }] };
    const t0 = Date.now();
    const both = await Promise.all([
      missionRunner.run(m1.mission.id, { injectPlan: JSON.parse(JSON.stringify(inj)) }),
      missionRunner.run(m2.mission.id, { injectPlan: JSON.parse(JSON.stringify(inj)) }),
    ]);
    const r1 = both[0], r2 = both[1];
    log('P35-19b 并发 run 两边都 completed（同进程暴露竞态）',
      r1.ok === true && r1.status === 'completed' && r2.ok === true && r2.status === 'completed',
      'r1=' + r1.status + ' r2=' + r2.status + ' wall=' + (Date.now() - t0) + 'ms');
    log('P35-19c 产物各落各的 region_id（互不串区）',
      (await q('SELECT count(*)::int n FROM world_objects WHERE created_by=$1 AND region_id=$2', [String(m1.mission.id), R1])).rows[0].n === 3
      && (await q('SELECT count(*)::int n FROM world_objects WHERE created_by=$1 AND region_id=$2', [String(m2.mission.id), R2])).rows[0].n === 3, '');
    log('P35-19d skippedByCollision 互不影响（两边都 0）',
      r1.stats.skippedByCollision === 0 && r2.stats.skippedByCollision === 0,
      JSON.stringify([r1.stats.skippedByCollision, r2.stats.skippedByCollision]));
    await missionRunner.rollback(m1.mission.id);
    await missionRunner.rollback(m2.mission.id);

    // ══ P35-20 同区域并发写 ══
    const m3 = await mkMission({ regionKey: R1, title: '并发甲', prompt: '砌墙', constraints: { maxObjects: 4 } });
    const m4 = await mkMission({ regionKey: R1, title: '并发乙', prompt: '砌墙', constraints: { maxObjects: 4 } });
    const bothSame = await Promise.all([
      missionRunner.run(m3.mission.id, { injectPlan: JSON.parse(JSON.stringify(inj)) }),
      missionRunner.run(m4.mission.id, { injectPlan: JSON.parse(JSON.stringify(inj)) }),
    ]);
    const done = bothSame.filter((r) => r.ok && r.status === 'completed');
    const busy = bothSame.filter((r) => !r.ok && r.code === 'REGION_BUSY');
    log('P35-20a 同区域两委托并发：恰好一个完成、一个 REGION_BUSY（原子占位，非硬失败）',
      done.length === 1 && busy.length === 1,
      'done=' + done.length + ' busy=' + busy.length + ' codes=' + bothSame.map((r) => r.code || r.status).join('|'));
    // ★ 适配：被拒方按 P35-20a 实际结果判定（先前硬编码 m4 属时序运气）
    const rejectedMission = (bothSame[0] && bothSame[0].code === 'REGION_BUSY') ? m3.mission : m4.mission;
    const m4row = (await api('/api/world-ai/missions/' + rejectedMission.id)).j.mission;
    log('P35-20b 被拒方未留下 running 半成品（状态非 running/failed）',
      ['draft', 'queued'].indexOf(m4row.status) >= 0, 'status=' + m4row.status);
    // 路由层 409：造一个"在途占用"（把乙置 running，等价于正在执行的委托的真实状态），
    // 再走 HTTP run 甲 → 必须拿到 409。
    // ★ 测试注记：首版用"两条并发 HTTP run"造并发，但 undici 同源连接 pipelining=1 会把
    //   两条请求串行化（各自完整跑完，双双 200）——那是测试通道的串行化，不是产品闸门失效；
    //   进程内并发（P35-20a）与服务端原子 SQL 才是权威口径。
    const mA = await mkMission({ regionKey: R1, title: '路由甲', prompt: '砌墙', constraints: { maxObjects: 4 } });
    const mB = await mkMission({ regionKey: R1, title: '路由乙', prompt: '砌墙', constraints: { maxObjects: 4 } });
    await q("UPDATE world_build_missions SET status='running', started_at=NOW() WHERE id=$1", [String(mB.mission.id)]);
    const routeBusy = await api('/api/world-ai/missions/' + mA.mission.id + '/run', { method: 'POST', body: { injectPlan: inj } });
    log('P35-20c 路由把 REGION_BUSY 映射为 409',
      routeBusy.status === 409 && routeBusy.j.code === 'REGION_BUSY', 'got ' + routeBusy.status + ' ' + (routeBusy.j.code || ''));
    await q("UPDATE world_build_missions SET status='draft' WHERE id=$1", [String(mB.mission.id)]);
    await missionRunner.rollback(mA.mission.id);
    await missionRunner.rollback(mB.mission.id);
    const m4retry = await missionRunner.run(m4.mission.id, { injectPlan: JSON.parse(JSON.stringify(inj)) });
    log('P35-20d 被拒方在占用者结束后重跑可完成', m4retry.ok === true && m4retry.status === 'completed', 'status=' + m4retry.status);
    await missionRunner.rollback(m3.mission.id);
    await missionRunner.rollback(m4.mission.id);

    // ══ P35-21 委托级 provider 覆盖（fetch 桩：A/B 都返回 200 计划；断言账本只落在 A）══
    await mkRegion(R3, { x: 6800, z: 6800, width: 80, depth: 80 }, { preferredProviderId: B });
    const m5 = await mkMission({ regionKey: R3, title: '手选A', prompt: '砌墙', providerId: A, constraints: { maxObjects: 4 } });
    log('P35-21a create 响应 providerResolution.source=mission（委托手选优先于区域默认）',
      m5.providerResolution && m5.providerResolution.source === 'mission',
      'source=' + (m5.providerResolution && m5.providerResolution.source));
    const m5row = (await api('/api/world-ai/missions/' + m5.mission.id)).j.mission;
    log('P35-21b provider_resolution.plan.providerId=A', m5row.provider_resolution && Number(m5row.provider_resolution.plan && m5row.provider_resolution.plan.providerId) === A,
      JSON.stringify(m5row.provider_resolution && m5row.provider_resolution.plan));
    const regionR3 = await regionService.getRegion(WORLD, R3);
    STUB = { hostMap, behavior: { [A]: 'ok', [B]: 'ok' }, planJson: makePlan(PART), calls: [] };
    const p5 = await missionPlanner.plan(m5row, regionR3, { maxRounds: 1 });
    const n5 = await waitLedger(m5.mission.id, 1, 8000);
    const rows5 = (await q('SELECT provider_id, ok FROM ai_call_log WHERE mission_id=$1', [String(m5.mission.id)])).rows;
    log('P35-21c 该委托全部轮次发往 A（账本 provider_id 全=A，且确实调了 A）',
      p5.ok === true && n5 >= 1 && rows5.length > 0 && rows5.every((r) => Number(r.provider_id) === A),
      'rows=' + JSON.stringify(rows5.map((r) => r.provider_id + ':' + r.ok)));
    log('P35-21d B 从未被调用（覆盖生效，不落回区域默认）', STUB.calls.every((c) => c.pid === A), 'calls=' + JSON.stringify(STUB.calls.map((c) => c.pid)));
    const vm = providerRouter.validateProviderMap({ plan: A, tool_select: B });
    log('P35-21e provider_map plan/tool_select 异家仍被 400 拒（P1-14 口径未松动）',
      vm.ok === false && /同一家/.test(vm.error || ''), '');
    STUB = null;
    await missionRunner.rollback(m5.mission.id);

    // ══ P35-22 fallback：注入一次 429 → 切备用家 ══
    const m6 = await mkMission({ regionKey: R3, title: 'fallback', prompt: '砌墙', providerId: A, constraints: { maxObjects: 4 } });
    STUB = { hostMap, behavior: { [A]: '429', [B]: 'ok' }, planJson: makePlan(PART), calls: [] };
    const r6 = await missionRunner.run(m6.mission.id, {});
    const n6 = await waitLedger(m6.mission.id, 2, 10000);
    const rows6 = (await q('SELECT provider_id, ok FROM ai_call_log WHERE mission_id=$1 ORDER BY id', [String(m6.mission.id)])).rows;
    const pids = [...new Set(rows6.map((r) => Number(r.provider_id)))];
    log('P35-22a A 持续 429 → 切 B 完成本批', r6.ok === true && r6.status === 'completed' && r6.stats.objectsCreated === 3,
      'status=' + r6.status + ' created=' + (r6.stats && r6.stats.objectsCreated));
    log('P35-22b ai_call_log 出现两条不同 provider（A 失败 + B 成功，两次调用都落账）',
      pids.indexOf(A) >= 0 && pids.indexOf(B) >= 0 && rows6.some((r) => Number(r.provider_id) === A && r.ok === false) && rows6.some((r) => Number(r.provider_id) === B && r.ok === true),
      'rows=' + JSON.stringify(rows6.map((r) => r.provider_id + ':' + r.ok)) + ' ledgerN=' + n6);
    const m6after = (await api('/api/world-ai/missions/' + m6.mission.id)).j.mission;
    const notes6 = (m6after.executed_stats && m6after.executed_stats.notes) || [];
    log('P35-22c executed_stats.notes 写明换家原因（可追溯）',
      notes6.some((s) => String(s).indexOf('切换厂商') >= 0 && String(s).indexOf('ai_call_log') >= 0),
      JSON.stringify(notes6).slice(0, 220));
    log('P35-22d 只跨家一次（非 best-of-N：A 侧最多 2 次尝试=内部退避1次，B 侧 1 次）',
      rows6.filter((r) => Number(r.provider_id) === A).length <= 2 && rows6.filter((r) => Number(r.provider_id) === B).length === 1,
      'A=' + rows6.filter((r) => Number(r.provider_id) === A).length + ' B=' + rows6.filter((r) => Number(r.provider_id) === B).length);
    STUB = null;
    await missionRunner.rollback(m6.mission.id);

    // ══ P35-23 / P35-24：Agent WS ACTION interact ══
    await api('/api/agent/v1/admin/config', { method: 'PUT', body: { agent_enabled: true } });
    const sp = JSON.parse((await q("SELECT config_value FROM system_config WHERE config_key='world_spawn_point'")).rows[0].config_value).position;
    await mkRegion(R5, { x: Math.round(sp.x) - 40, z: Math.round(sp.z) - 40, width: 80, depth: 80 });
    const ix = (await api('/api/world-ai/regions/' + R5 + '/interactions', { method: 'POST', body: {
      key: 'mint', interaction_type: 'reward_grant', label: '采集点 mint',
      position: { x: sp.x, y: 0, z: sp.z }, radius: 10, payload: { count: 1, code: 'ACCEPT-35C' },
    } })).j.interaction;
    const quest = (await api('/api/world-ai/regions/' + R5 + '/quests', { method: 'POST', body: { count: 2, interactionKey: 'reward_grant:mint' } })).j.task;

    const gs = await api('/api/agent/v1/guest/session', { method: 'POST', body: {}, noAuth: true });
    log('P35-23a 游客会话已签发（公开临时票）', gs.status === 200 && !!gs.j.token, 'tier=' + gs.j.tier);
    const wsUrl = BASE.replace(/^http/, 'ws') + '/ws/agent?token=' + encodeURIComponent(gs.j.token);
    ws = new WebSocket(wsUrl);
    const inbox = [];
    ws.addEventListener('message', (ev) => { try { inbox.push(JSON.parse(ev.data)); } catch (e) { /* ignore */ } });
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('WS READY 超时')), 8000); ws.addEventListener('open', () => { /* wait msg */ }); const iv = setInterval(() => { if (inbox.some((m) => m.type === 'READY')) { clearInterval(iv); clearTimeout(t); res(); } }, 100); });
    const waitMsg = async (type, timeoutMs) => {
      const t0 = Date.now();
      for (;;) {
        const m = inbox.find((x) => x.type === type && (type !== 'ACTION_COMPLETED' || x.payload.requestId === currentReq));
        if (m) return m;
        if (Date.now() - t0 > (timeoutMs || 8000)) return null;
        await sleep(100);
      }
    };
    let currentReq = 'ia1';
    ws.send(JSON.stringify({ type: 'ACTION', payload: { action: 'interact', requestId: currentReq, interactionKey: 'mint' } }));
    const a1 = await waitMsg('ACTION_COMPLETED', 8000);
    const res1 = a1 && a1.payload && a1.payload.result;
    log('P35-23b WS ACTION interact → 命中交互点并登记奖励（granted）',
      !!a1 && res1 && res1.reward && res1.reward.granted === true,
      JSON.stringify(res1 && res1.reward));
    await sleep(2300); // 游客 interact 限频 1 次/2s
    currentReq = 'ia2';
    ws.send(JSON.stringify({ type: 'ACTION', payload: { action: 'interact', requestId: currentReq, interactionKey: 'mint' } }));
    const a2 = await waitMsg('ACTION_COMPLETED', 8000);
    const res2 = a2 && a2.payload && a2.payload.result;
    const actorId = gs.j.agent && gs.j.agent.id;
    // ★ Phase 6 适配：任务（count=2）在第 2 次 interact 达成 → 任务结算追加一笔 'task:<id>' 登记是合法新行为；
    //   幂等口径收窄到"同一交互点只有 1 条登记"
    const grantsN = actorId ? (await q(`SELECT count(*)::int n FROM world_reward_grants WHERE actor_id=$1 AND interaction_key='reward_grant:mint'`, [actorId])).rows[0].n : -1;
    log('P35-23c 重复 interact → reward.deduped=true 且同一交互点只有 1 条登记（幂等）',
      !!a2 && res2 && res2.reward && res2.reward.deduped === true && grantsN === 1,
      'deduped=' + (res2 && res2.reward && res2.reward.deduped) + ' grants=' + grantsN);
    log('P35-23d interact 推进引导任务（object_interact）',
      !!a2 && Array.isArray(res2 && res2.quest && res2.quest.progressed) && res2.quest.progressed.length >= 1
        && res2.quest.progressed[0].type === 'object_interact',
      JSON.stringify(res2 && res2.quest && res2.quest.progressed && res2.quest.progressed[0] && res2.quest.progressed[0].state).slice(0, 140));
    // P35-24 未知动作仍被拦
    currentReq = 'ix1';
    ws.send(JSON.stringify({ type: 'ACTION', payload: { action: 'dance', requestId: currentReq } }));
    const rej1 = await waitMsg('ACTION_REJECTED', 6000);
    log('P35-24 未知动作仍 unknown_action（白名单没有被放宽）',
      !!rej1 && rej1.payload.code === 'unknown_action' && /可用动作/.test(rej1.payload.reason || ''), rej1 && rej1.payload.code);
    try { ws.close(); } catch (e) { /* ignore */ }

    // ── 收尾 ──
    for (const rk of [R1, R2, R3, R5]) {
      await q('DELETE FROM world_objects WHERE region_id = $1', [rk]);
      await q('DELETE FROM world_build_missions WHERE region_key = $1', [rk]);
      await q('DELETE FROM world_reward_grants WHERE region_key = $1', [rk]);
      await q('DELETE FROM world_task_progress WHERE task_id IN (SELECT id FROM world_tasks WHERE region_key=$1)', [rk]);
      await q('DELETE FROM world_tasks WHERE region_key = $1', [rk]);
      await q('DELETE FROM world_interactions WHERE region_key = $1', [rk]);
      await q('DELETE FROM world_regions WHERE region_key = $1', [rk]);
    }
    await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: snapAutonomy } });
    if (agentEnabled0 !== null) {
      await api('/api/agent/v1/admin/config', { method: 'PUT', body: { agent_enabled: String(agentEnabled0) === 'true' } });
    }
    const restored = (await api('/api/world-ai/config')).j.config;
    log('收尾：区域/玩法数据已清、世界级 autonomy 与 agent_enabled 已还原',
      restored.autonomy === snapAutonomy, 'autonomy=' + restored.autonomy + ' agent_enabled0=' + agentEnabled0);
  } catch (e) {
    log('FATAL 脚本异常', false, e && e.message);
    try {
      for (const rk of [R1, R2, R3, R5]) {
        await q('DELETE FROM world_objects WHERE region_id = $1', [rk]);
        await q('DELETE FROM world_build_missions WHERE region_key = $1', [rk]);
        await q('DELETE FROM world_reward_grants WHERE region_key = $1', [rk]);
        await q('DELETE FROM world_task_progress WHERE task_id IN (SELECT id FROM world_tasks WHERE region_key=$1)', [rk]);
        await q('DELETE FROM world_tasks WHERE region_key = $1', [rk]);
        await q('DELETE FROM world_interactions WHERE region_key = $1', [rk]);
        await q('DELETE FROM world_regions WHERE region_key = $1', [rk]);
      }
    } catch (e2) { /* ignore */ }
  }
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  await POOL.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
