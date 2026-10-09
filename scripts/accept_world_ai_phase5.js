/**
 * accept_world_ai_phase5 —— Phase 5 验收（判据 P4-1 ~ P4-17）
 * AI World Brain · Phase 5 · AI Building（Building Spec · SpecCompiler · World Entity · 零件装配 · Steward）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 运行：node scripts/accept_world_ai_phase5.js
 * 前置：本地 3002 已启动（新迁移 add_world_entities 已执行，服务器已重启加载新代码）。
 * 口径：LLM 零调用；确定性数据走 HTTP + 管理员 token；进程内执行器显式传 worldId。
 * 自带"开工清扫/收尾还原"，可安全重跑（测试数据一律 accept_p5 前缀）。
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const WS_BASE = (process.env.ACCEPT_WS || 'ws://127.0.0.1:3002');
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const ACTOR = 'accept_p5';
const REGION = 'accept_p5_main';

let pass = 0, fail = 0;
function log(name, ok, note) {
  if (ok) { pass++; console.log('PASS  ' + name + (note ? '  —— ' + note : '')); }
  else { fail++; console.log('FAIL  ' + name + (note ? '  —— ' + note : '')); }
}

async function api(p, opts) {
  const o = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (T && !o.noAuth) headers['Authorization'] = 'Bearer ' + T;
  const r = await fetch(BASE + p, { method: o.method || 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* 空 body */ }
  return { status: r.status, j };
}

const { query } = require('../src/database/db');
let T = null;
let W = null;
let testStart = new Date();
const snap = {};
const flags = { createdSteward: false };

// ════════════════ 清扫（开工 + 收尾各一次，幂等） ════════════════
async function cleanup() {
  try {
    const apIds = (await query(
      `SELECT DISTINCT approval_id FROM world_tool_executions WHERE world_id=$1 AND actor=$2 AND approval_id IS NOT NULL`,
      [W, ACTOR])).rows.map((r) => r.approval_id);
    if (apIds.length) await query(`DELETE FROM world_approvals WHERE id = ANY($1::uuid[])`, [apIds]);
    await query(`DELETE FROM world_tool_executions WHERE world_id=$1 AND actor=$2`, [W, ACTOR]);
    await query(`DELETE FROM world_entities WHERE name LIKE 'accept_p5%'`, []);          // parts/interactions 级联
    await query(`DELETE FROM world_objects WHERE name LIKE 'accept_p5%' OR region_id=$1`, [REGION]);
    await query(`DELETE FROM geometry_buildings WHERE description LIKE 'World AI%' AND created_at >= $1`, [testStart]);
    await query(`DELETE FROM npcs WHERE name LIKE 'accept_p5%'`, []);
    await query(`DELETE FROM world_tasks WHERE title LIKE 'accept_p5%'`, []);
    await query(`DELETE FROM world_interactions WHERE key LIKE 'accept_p5%'`, []);
    await query(`DELETE FROM world_memories WHERE subject_id LIKE 'asset_gap:accept_p5%' OR content LIKE '%accept_p5%'`, []);
    // ★ 不带 created_at 过滤：actor 前缀即测试命名空间（中途 FATAL 的轮次收尾没跑，
    //   带 created_at 过滤会留下历史轮次残骸，挤爆 phase4 的 P3-13 游标断言——已踩）
    await query(`DELETE FROM world_events WHERE actor_id LIKE 'accept_p5%'`, []);
    await query(`DELETE FROM world_regions WHERE region_key LIKE 'accept_p5%'`, []);
    if (flags.createdSteward) {
      try { await query(`DELETE FROM agents WHERE name = 'world_steward'`, []); } catch (e) { /* 级联清 session */ }
    }
  } catch (e) { console.log('  (cleanup warn)', e.message); }
}

async function restore() {
  try {
    if (snap.autonomy !== undefined) await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: snap.autonomy } });
    if (snap.stewardEnabled !== undefined && snap.stewardEnabled !== true) await api('/api/world-ai/build/steward/enabled', { method: 'PUT', body: { enabled: false } });
    if (snap.agentEnabled !== undefined && snap.agentEnabled !== true) await api('/api/agent/v1/admin/config', { method: 'PUT', body: { agent_enabled: false } });
  } catch (e) { console.log('  (restore warn)', e.message); }
}

// ════════════════ 节点侧工具（不依赖服务器进程） ════════════════
function loadNodeSide() {
  const geometryBuilder = require('../src/services/geometryBuilder');
  const buildingSpec = require('../src/worldai/builder/buildingSpec');
  const THREE = require('three');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'geometryRenderer.js'), 'utf8');
  const GeometryRenderer = new Function('THREE', 'window', src + '\nreturn GeometryRenderer;')(THREE, undefined);
  return { geometryBuilder, buildingSpec, THREE, GeometryRenderer };
}

function wsConnect(url) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const box = { ws, messages: [], waiters: [] };
    ws.on('message', (d) => {
      let m = null; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      box.messages.push(m);
      box.waiters = box.waiters.filter((w) => !w(m));
    });
    ws.on('open', () => resolve(box));
    ws.on('error', reject);
  });
}
function waitFor(box, pred, ms) {
  const hit = box.messages.find(pred);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('waitFor 超时')), ms || 8000);
    box.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

// ════════════════ 主流程 ════════════════
(async () => {
  const li = await api('/api/admin-auth/login', { method: 'POST', noAuth: true, body: ADMIN });
  T = (li.j && (li.j.token || li.j.adminToken)) || null;
  if (!T) { console.log('FATAL 登录失败', li.status); process.exit(1); }
  const cfg0 = (await api('/api/world-ai/config')).j.config;
  W = cfg0.worldId;
  snap.autonomy = cfg0.autonomy;
  // agent 总闸与 steward 总闸的运行前值（收尾还原；红线 6）
  try { snap.agentEnabled = ((await api('/api/agent/v1/admin/config')).j.config || {}).agentEnabled; } catch (e) { snap.agentEnabled = undefined; }
  try { snap.stewardEnabled = ((await api('/api/world-ai/build/steward')).j.steward || {}).enabled; } catch (e) { snap.stewardEnabled = undefined; }
  await cleanup();
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });

  const E = (extra) => Object.assign({ worldId: W, actor: ACTOR }, extra || {});
  const execOne = async (tool, params, extraCtx) => require('../src/worldai/runtime/executor').execute(tool, params, E(extraCtx));
  const node = loadNodeSide();
  node.assetValidator = require('../src/worldai/builder/assetValidator');
  const getEnt = async (id) => (id ? require('../src/worldai/builder/entityAssembler').getEntity(W, id) : null);
  const round2 = (v) => Math.round(Number(v) * 100) / 100;

  // ── 开工前置：注册表 + 区域 ─────────────────────────────────────────
  require('../src/worldai/runtime/executor').ensureLoaded();
  const verbRegistry = require('../src/worldai/tools/verbRegistry');

  const cr = await execOne('create_area', {
    regionKey: REGION, name: 'accept_p5 区域', bounds: { x: 450, z: 450, width: 300, depth: 300 }, autonomy: 'semi_autonomous',
  });
  log('P5-前置 create_area', cr.ok, cr.ok ? REGION : (cr.code + ' ' + cr.reason));

  // ── A. P4-1 / P4-2 确定性（节点侧）────────────────────────────────
  {
    const spec1 = node.buildingSpec.withDefaults({ buildingType: 'accept_p5_det', name: 'accept_p5_det', footprint: { width: 8, depth: 6 }, levels: [{ floors: 2, heightPerFloor: 3.5 }], style: { roofStyle: 'gable', glazing: 'ribbed' }, seed: 20261009 });
    const a1 = JSON.stringify(node.geometryBuilder.buildFromSpec(spec1));
    const a2 = JSON.stringify(node.geometryBuilder.buildFromSpec(node.buildingSpec.withDefaults(spec1)));
    log('P4-1 同 seed 两次逐字节相同', a1 === a2 && a1.length > 100, 'len=' + a1.length);
    const spec2 = JSON.parse(JSON.stringify(spec1)); spec2.seed = 777;
    const a3 = JSON.stringify(node.geometryBuilder.buildFromSpec(node.buildingSpec.withDefaults(spec2)));
    log('P4-2 换 seed 结果不同', a1 !== a3, 'len3=' + a3.length);
  }

  // ── B. P4-11 / P4-12 geometryRenderer 修复（节点侧真实渲染）───────
  {
    const g = node.GeometryRenderer.renderFromComponents([
      { type: 'cone', radiusBottom: 3, radiusTop: 0.5, height: 2, radialSegments: 4 },
    ], node.THREE);
    const coneMesh = g.children[0];
    const cp = coneMesh && coneMesh.geometry.parameters;
    log('P4-11 cone radiusBottom/radiusTop 生效',
      cp && round2(cp.radiusBottom) === 3 && round2(cp.radiusTop) === 0.5,
      cp ? 'radiusBottom=' + cp.radiusBottom + ' radiusTop=' + cp.radiusTop : 'no params');

    const gt = node.GeometryRenderer.renderFromComponents([{ type: 'torus', radius: 1, tube: 0.2 }], node.THREE);
    const isTorus = gt.children[0] && gt.children[0].geometry instanceof node.THREE.TorusGeometry;
    const well = node.geometryBuilder.generateBuilding('well', {});
    const wellHasTorus = well.components.some((c) => c.type === 'torus');
    const wellRendered = node.GeometryRenderer.renderFromComponents(well.components, node.THREE);
    const wellTorusMesh = wellRendered.children.some((m) => m.geometry instanceof node.THREE.TorusGeometry);
    log('P4-12 torus 不再被丢弃（well 井口出现）', isTorus && wellHasTorus && wellTorusMesh,
      'well.components=' + well.components.length + ' torusMesh=' + wellTorusMesh);
  }

  // ── C. P4-15 注册表级硬约束 ───────────────────────────────────────
  {
    const names = verbRegistry.toLLM().map((d) => d.name);
    const badHit = ['threejs_code', 'upload', 'raw_sql', 'eval'].filter((f) => names.some((n) => n.indexOf(f) >= 0));
    log('P4-15 tools 搜不到 threejs_code/upload/raw_sql/eval',
      badHit.length === 0 && !verbRegistry.has('threejs_code.create') && !verbRegistry.has('upload_model')
        && !verbRegistry.has('raw_sql') && !verbRegistry.has('eval')
        && verbRegistry.has('create_building') && verbRegistry.has('remove_building') && verbRegistry.has('search_assets'),
      'size=' + verbRegistry.size() + ' bad=' + JSON.stringify(badHit));
  }

  // ── D. P4-9 / P4-10 AssetValidator DENY（executor 校验层之后）─────
  {
    const big = await execOne('create_building', {
      spec: { name: 'accept_p5_big', buildingType: 'wall_bomb', parts: [{ templateId: 'box_primitive', params: { width: 1, height: 1, depth: 1 }, repeat: { axis: 'x', count: 500, step: 1 } }] },
      regionId: REGION, x: 460, z: 460,
    });
    log('P4-9 components 500 > 400 → DENY + 结构化错误',
      big.ok === false && big.code === 'ASSET_VALIDATOR_DENY' && Array.isArray(big.errors) && big.errors.length > 0,
      big.code + ' errors=' + (big.errors ? big.errors.map((e) => e.path + ':' + e.message).join('; ').slice(0, 120) : ''));

    // P4-10（节点侧直测 validator）：executor 级管线已被 P4-9 证明（preValidate 挂点 + 落账本）；
    // geometryBuilder 的 22 模板没有高面数图元（sphere/torus 非模板），60k 场景只能由图元面数构造。
    const heavy = node.assetValidator.validateComponents(
      Array.from({ length: 11 }, () => ({ type: 'sphere', radius: 1, radialSegments: 64, heightSegments: 48 })), {});
    log('P4-10 预估三角面 > 60k → DENY',
      heavy.ok === false && heavy.errors.length > 0 && heavy.stats.tris > 60000,
      'tris=' + heavy.stats.tris);
    const denied = (await query(`SELECT count(*)::int AS n FROM world_tool_executions WHERE actor=$1 AND status='denied' AND tool_name='create_building'`, [ACTOR])).rows[0].n;
    log('P4-9b DENY 也落账本（denied 行；P4-10 为节点侧直测不落账本）', denied >= 1, 'denied=' + denied);
  }

  // ── E. P4-3 资产路径 ──────────────────────────────────────────────
  let hallEntityId = null;
  {
    await query(
      `INSERT INTO uploaded_models (file_name, saved_file_name, path, file_type, file_size, tags, category, description)
       VALUES ('accept_p5_city_hall.glb','accept_p5_city_hall.glb','/models/uploaded/accept_p5/city_hall.glb','glb',1024, ARRAY['civic','government']::text[], 'uploaded','accept_p5 测试资产')
       ON CONFLICT DO NOTHING`, []);
    const r = await execOne('create_building', {
      spec: { buildingType: '市政厅', name: 'accept_p5_hall', footprint: { width: 10, depth: 8 } },
      regionId: REGION, x: 500, z: 500,
    });
    const ent = r.ok ? await getEnt(r.result.entityId) : null;
    const visualMode = ent && ent.visual && ent.visual.mode;
    const mainPart = ent && (ent.parts || []).find((p) => p.partKey === 'main');
    log('P4-3 库中有匹配 → asset 路径（uploaded_model）',
      r.ok && r.result.strategy === 'asset' && visualMode === 'asset' && mainPart && mainPart.objectType === 'uploaded_model',
      r.ok ? 'strategy=' + r.result.strategy + ' path=' + (mainPart && mainPart.modelPath) : r.code + ' ' + r.reason);
    hallEntityId = r.ok ? r.result.entityId : null;
  }

  // ── F. P4-4 / P4-5 / P4-6 程序化降级 + 契约 + 世界可加载 ──────────
  let hutEntityId = null;
  {
    const r = await execOne('create_building', {
      spec: { buildingType: 'accept_p5_zzz', name: 'accept_p5_hut', footprint: { width: 6, depth: 6 }, levels: [{ floors: 1, heightPerFloor: 3.2 }] },
      regionId: REGION, x: 520, z: 520,
    });
    const mem = r.ok ? (await query(`SELECT * FROM world_memories WHERE content LIKE '%accept_p5_zzz%' AND subject_id LIKE 'asset_gap:%' AND created_at >= $1::timestamptz LIMIT 1`, [testStart.toISOString()])).rows[0] : null;
    log('P4-4 无匹配 → 降级 procedural + memory(缺少 X 类资产)',
      r.ok && r.result.strategy === 'procedural' && !!mem,
      r.ok ? 'strategy=' + r.result.strategy + ' memory=' + (mem ? 'Y' : 'N') : r.code + ' ' + r.reason);
    hutEntityId = r.ok ? r.result.entityId : null;

    const entHut = r.ok ? await getEnt(hutEntityId) : null;
    const part = entHut && (entHut.parts || [])[0];
    const mp = part && part.modelPath || '';
    const gidOk = /^geometry_building:\d+$/.test(mp);
    const wo = gidOk ? (await query(`SELECT * FROM world_objects WHERE entity_id=$1 AND model_path=$2`, [hutEntityId, mp])).rows : [];
    log('P4-5 geometry_buildings 1 行 + world_objects 1 行 + model_path=geometry_building:<id>',
      gidOk && wo.length === 1 && wo[0].type === 'geometry_building' && wo[0].origin === 'ai',
      'model_path=' + mp);

    const gid = gidOk ? mp.split(':')[1] : '0';
    const h = await api('/api/geometry-building/' + gid);
    const comps = h.j && h.j.building && h.j.building.geometry_data && h.j.building.geometry_data.components;
    log('P4-6 世界可加载（model_path 反查成功）',
      h.status === 200 && Array.isArray(comps) && comps.length > 0,
      'GET /api/geometry-building/' + gid + ' → ' + h.status + ' components=' + (comps ? comps.length : 'N/A'));
  }

  // ── G. P4-7 assemble_building 20 面墙 + 幂等 ─────────────────────
  let wallEntityId = null;
  {
    const partsSpec = [{ partKey: 'wall_south', partRole: 'wall', templateId: 'box_primitive', params: { width: 1, height: 2, depth: 0.3 }, repeat: { axis: 'x', count: 20, step: 1 } }];
    const r1 = await execOne('assemble_building', { name: 'accept_p5_wall', regionId: REGION, x: 600, z: 600, parts: partsSpec });
    wallEntityId = r1.ok ? r1.result.entityId : null;
    const cnt1 = wallEntityId ? (await query(`SELECT count(*)::int AS n FROM world_entity_parts WHERE entity_id=$1`, [wallEntityId])).rows[0].n : -1;
    const wo1 = wallEntityId ? (await query(`SELECT count(*)::int AS n FROM world_objects WHERE entity_id=$1`, [wallEntityId])).rows[0].n : -1;
    log('P4-7a 20 面墙 → world_objects 20 + parts 20',
      r1.ok && cnt1 === 20 && wo1 === 20 && (r1.result.objects === 20),
      r1.ok ? 'objects=' + wo1 + ' parts=' + cnt1 : r1.code + ' ' + r1.reason);
    const r2 = await execOne('assemble_building', { name: 'accept_p5_wall', regionId: REGION, x: 600, z: 600, parts: partsSpec });
    const cnt2 = r2.ok ? (await query(`SELECT count(*)::int AS n FROM world_entity_parts WHERE entity_id=$1`, [r2.result.entityId])).rows[0].n : -1;
    log('P4-7b 重跑幂等（UNIQUE 不重复）',
      r2.ok && r2.result.entityId === wallEntityId && r2.deduped === true && cnt2 === 20,
      r2.ok ? 'deduped=' + r2.deduped + ' parts=' + cnt2 : r2.code);

    // modify_building 冒烟（medium；不属于判据，但注册了就要能用）
    if (wallEntityId) {
      const mv = await execOne('modify_building', { entityId: wallEntityId, patch: { dx: 2, dz: 1 } });
      log('P4-7c modify_building 整体平移（20 部件）', mv.ok && mv.result.moved === 20, mv.ok ? 'moved=' + mv.result.moved : mv.code + ' ' + mv.reason);
    }
  }

  // ── H. P4-13 npc/interaction/quest → 实体六段被更新 ───────────────
  {
    const npc = await execOne('create_npc', { name: 'accept_p5_npc', role: 'mayor', entityId: wallEntityId, x: 602, y: 0, z: 602, avatarEmoji: '🧑‍💼', systemPrompt: 'accept_p5 测试 NPC' });
    const it = await execOne('create_interaction', { entityId: wallEntityId, interactionType: 'reward_grant', key: 'accept_p5_mint', label: 'accept_p5 采集点', radius: 3, x: 600, z: 602, payload: { poolKey: 'accept_p5_pool', count: 1 } });
    const q = await execOne('create_quest', { title: 'accept_p5_quest', entityId: wallEntityId, regionKey: REGION, questType: 'side', objectives: [{ type: 'object_interact', key: 'reward_grant:accept_p5_mint', count: 1 }], reward: { type: 'reward_codes', count: 1 } });
    const gp = await execOne('update_entity_gameplay', { entityId: wallEntityId, rewardPoolKey: 'accept_p5_pool', importance: 3 });
    const ent = wallEntityId ? await require('../src/worldai/builder/entityAssembler').getEntity(W, wallEntityId) : null;
    log('P4-13 create_npc/interaction/quest → npc_refs/gameplay 更新',
      npc.ok && it.ok && q.ok && gp.ok && ent
        && Array.isArray(ent.npcRefs) && ent.npcRefs.length >= 1 && ent.npcRefs[0].role === 'mayor'
        && Array.isArray(ent.gameplay.questIds) && ent.gameplay.questIds.indexOf(q.result.taskId) >= 0
        && ent.gameplay.rewardPoolKey === 'accept_p5_pool',
      npc.ok && it.ok && q.ok ? 'npcRefs=' + ent.npcRefs.length + ' questIds=' + ent.gameplay.questIds.length : JSON.stringify({ npc: npc.code, it: it.code, q: q.code, gp: gp.code }));
    global.__acceptP5 = { npcId: npc.result && npc.result.npcId, taskId: q.result && q.result.taskId };
  }

  // ── I. P4-14 六段完整实体（HTTP）────────────────────────────────
  {
    const h = await api('/api/world-ai/build/entities/' + wallEntityId);
    const e = h.j && h.j.entity;
    const sixOk = e && e.visual && e.physical && Array.isArray(e.interactions) && Array.isArray(e.npcRefs)
      && e.gameplay && e.data && e.data.origin === 'ai' && e.data.specHash;
    log('P4-14 完整实体六段（visual/physical/interactions/npcRefs/gameplay/data）',
      h.status === 200 && sixOk && e.interactions.length >= 1 && e.npcRefs.length >= 1 && (e.gameplay.questIds || []).length >= 1,
      h.status === 200 ? 'interactions=' + e.interactions.length + ' npcRefs=' + e.npcRefs.length : 'HTTP ' + h.status);
  }

  // ── J. P4-8 remove_building 事务原子 ─────────────────────────────
  {
    // J1：注入非法部件（human 对象挂在实体上）→ 删除必须整体回滚
    const humanObj = (await query(`SELECT id FROM world_objects WHERE origin='human' AND name NOT LIKE 'accept_p5%' LIMIT 1`)).rows[0];
    if (humanObj) {
      await query(`INSERT INTO world_entity_parts (entity_id, world_object_id, part_key, part_role) VALUES ($1,$2,'accept_p5_evil','prop') ON CONFLICT DO NOTHING`, [wallEntityId, humanObj.id]);
    }
    const first = await execOne('remove_building', { entityId: wallEntityId, reason: 'accept_p5 验收删除' });
    log('P4-8a high 风险 → AWAITING_APPROVAL（不可降级）',
      first.ok === false && first.code === 'AWAITING_APPROVAL' && !!first.approvalId,
      first.code + ' approvalId=' + (first.approvalId || 'N/A'));

    let rollbackOk = false, rbNote = '';
    if (first.approvalId && humanObj) {
      const ap = await api('/api/world-ai/approvals/' + first.approvalId + '/approve', { method: 'POST', body: { comment: 'accept_p5' } });
      const cntAfter = (await query(`SELECT count(*)::int AS n FROM world_objects WHERE entity_id=$1`, [wallEntityId])).rows[0].n;
      const entAfter = (await query(`SELECT count(*)::int AS n FROM world_entities WHERE id=$1`, [wallEntityId])).rows[0].n;
      rollbackOk = ap.status === 200 && cntAfter === 20 && entAfter === 1;
      rbNote = 'approve ok=' + ap.j.success + ' objects=' + cntAfter + ' entity=' + entAfter;
    }
    log('P4-8b 任一部件守卫拒绝 → 整体回滚（0 删除）', rollbackOk, rbNote);

    // J2：移除非法部件 → 再走审批 → 事务删 20+1+20+交互点
    await query(`DELETE FROM world_entity_parts WHERE entity_id=$1 AND part_key='accept_p5_evil'`, [wallEntityId]);
    const second = await execOne('remove_building', { entityId: wallEntityId, reason: 'accept_p5 验收删除#2' });
    let removedOk = false, rmNote = second.code || '';
    if (second.approvalId) {
      const ap2 = await api('/api/world-ai/approvals/' + second.approvalId + '/approve', { method: 'POST', body: { comment: 'accept_p5' } });
      const woAfter = (await query(`SELECT count(*)::int AS n FROM world_objects WHERE entity_id=$1`, [wallEntityId])).rows[0].n;
      const entAfter = (await query(`SELECT count(*)::int AS n FROM world_entities WHERE id=$1`, [wallEntityId])).rows[0].n;
      const partAfter = (await query(`SELECT count(*)::int AS n FROM world_entity_parts WHERE entity_id=$1`, [wallEntityId])).rows[0].n;
      const itAfter = (await query(`SELECT count(*)::int AS n FROM world_interactions WHERE entity_id=$1`, [wallEntityId])).rows[0].n;
      removedOk = ap2.status === 200 && ap2.j.success === true && woAfter === 0 && entAfter === 0 && partAfter === 0 && itAfter === 0;
      rmNote = 'objects=' + woAfter + ' entity=' + entAfter + ' parts=' + partAfter + ' interactions=' + itAfter;
    }
    log('P4-8c remove_building(entityId) 事务删 20+1+20+交互点', removedOk, rmNote);
    const again = wallEntityId ? await execOne('remove_building', { entityId: wallEntityId }) : { ok: false, code: 'SKIP' };
    log('P4-8d 幂等：实体已删 → ENTITY_NOT_FOUND', again.ok === false && again.code === 'ENTITY_NOT_FOUND', again.code);
  }

  // ── K. 事件流（entity_created 走唯一写入器）──────────────────────
  {
    const ev = (await query(`SELECT count(*)::int AS n FROM world_events WHERE actor_id=$1 AND type='entity_created'`, [ACTOR])).rows[0].n;
    const ev2 = (await query(`SELECT count(*)::int AS n FROM world_events WHERE actor_id=$1 AND type='entity_removed'`, [ACTOR])).rows[0].n;
    log('P5-事件 entity_created/entity_removed 落 world_events（唯一写入器）', ev >= 3 && ev2 >= 1, 'created=' + ev + ' removed=' + ev2);
  }

  // ── L. P4-16 Steward（开启时：进场 → players+1 → say → 30m CHAT）──
  try {
    const gate0 = await api('/api/world-ai/build/steward');
    log('P4-16-0 steward 总闸默认关', gate0.status === 200 && gate0.j.steward && gate0.j.steward.enabled === false, 'enabled=' + gate0.j.steward.enabled);
    const denyCreate = await api('/api/world-ai/build/steward', { method: 'POST', body: {} });
    log('P4-16-0b 总闸关闭时创建被拒（400 + 可读 reason）',
      denyCreate.status === 400 && denyCreate.j.code === 'STEWARD_DISABLED', denyCreate.j.code || ('HTTP ' + denyCreate.status));

    await api('/api/agent/v1/admin/config', { method: 'PUT', body: { agent_enabled: true } });
    await api('/api/world-ai/build/steward/enabled', { method: 'PUT', body: { enabled: true } });
    const created = await api('/api/world-ai/build/steward', { method: 'POST', body: { avatarConfig: {} } });
    const key = created.j && created.j.apiKey && created.j.apiKey.key;
    flags.createdSteward = !!(created.j && created.j.created);
    log('P4-16-1 steward 创建（agents 表复用，零新机制）', created.status === 200 && created.j.success && !!key, 'created=' + created.j.created + ' agentId=' + (created.j.agent || {}).id);

    // 出生点（观察者贴它站，保证与 steward ≤30m）
    const sp = (await query(`SELECT config_value FROM system_config WHERE config_key='world_spawn_point' LIMIT 1`)).rows[0];
    const spRaw = sp ? JSON.parse(sp.config_value) : { x: 0, y: 0, z: 0 };
    const spawn = (spRaw && spRaw.position) ? spRaw.position : spRaw;   // 配置形状是 {position:{x,y,z},...}

    const obs = await wsConnect(WS_BASE + '/');
    obs.ws.send(JSON.stringify({ type: 'PLAYER_JOIN', payload: { characterId: 'accept_p5_obs', characterName: 'accept_p5_obs', position: { x: spawn.x, y: spawn.y, z: spawn.z }, isGuest: true } }));

    const sess = await api('/api/agent/v1/session', { method: 'POST', noAuth: true, headers: { Authorization: 'Bearer ' + key } });
    const token = sess.j && sess.j.token;
    const stewardWs = await wsConnect(WS_BASE + '/ws/agent?token=' + encodeURIComponent(token));
    const ready = await waitFor(stewardWs, (m) => m.type === 'READY', 8000);
    const seenJoin = await waitFor(obs, (m) => m.type === 'PLAYER_JOINED' && /steward/i.test(JSON.stringify(m.payload || {})), 8000).catch(() => null);
    log('P4-16-2 steward 进场 → 真人侧 players.size+1（收到 PLAYER_JOINED）', !!ready && !!seenJoin, seenJoin ? 'joined=' + (seenJoin.payload.characterName || seenJoin.payload.characterId) : 'no PLAYER_JOINED');

    stewardWs.ws.send(JSON.stringify({ type: 'ACTION', payload: { action: 'say', requestId: 'p5say', message: 'accept_p5_steward_hello' } }));
    const chat = await waitFor(obs, (m) => m.type === 'CHAT' && String((m.payload || {}).message || '').indexOf('accept_p5_steward_hello') >= 0, 8000).catch(() => null);
    log('P4-16-3 steward say → 30m 内真人收到 CHAT', !!chat,
      chat ? 'msg=' + chat.payload.message : 'no CHAT; stewardMsgs=' + stewardWs.messages.map((m) => m.type + ':' + JSON.stringify(m.payload || {}).slice(0, 80)).join(' | ').slice(0, 400));
    obs.ws.close(); stewardWs.ws.close();
  } catch (e) {
    log('P4-16 steward E2E', false, 'EXCEPTION: ' + String(e.message).slice(0, 160));
  }

  // ── 收尾 ─────────────────────────────────────────────────────────
  await restore();
  await cleanup();
  console.log('\n===== accept_world_ai_phase5: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
