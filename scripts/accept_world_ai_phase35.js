/**
 * accept_world_ai_phase35.js —— Phase 3.5-1 验收（区域 · 归属守卫 · 围栏 · 网格 · 批次日志）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 本轮覆盖判据（红线优先，§Phase 3.5 顺序纪律：P35-3/3b/4/5/6 最先写最先过）：
 *   P35-1 创建区域 + autonomy 未显式选择时拒绝
 *   P35-2 有效自主度 = 世界级 × 区域级取更严
 *   P35-3 ★ 人工资产 move/scale/rotate/delete 全部 DENY
 *   P35-3b ★ 无 missionId 的自主写仍受 autonomy 下限约束（v1.5 订正没被删掉）
 *   P35-4 ★ 撞人工资产 → 换位不覆盖，skippedByCollision 不计入 created
 *   P35-5 ★ placement_policy='replace' 参数不存在（白名单拒绝）
 *   P35-6 ★ 绕过 missionTools 直接调 journal 仍被守卫拦，落库 0 行
 *   P35-7 越界 place_part → DENY（不是事后清理）
 *   P35-8 网格对齐：20 个墙全部落在模数格点（误差 <1e-6）
 *   P35-17 existingAssets 返回区域内人工资产清单
 *
 * 跑法：node scripts/accept_world_ai_phase35.js     （需要 3002 在跑）
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const path = require('path');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const POOL = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'password',
});

let T = null, WORLD = null;
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
async function api(p, o) {
  const opt = o || {};
  const headers = Object.assign({}, opt.body ? { 'Content-Type': 'application/json' } : {});
  if (T && !opt.noAuth) headers.Authorization = 'Bearer ' + T;
  const res = await fetch(BASE + p, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
  let j = null;
  try { j = await res.json(); } catch (e) { j = {}; }
  return { status: res.status, j };
}
const q = (sql, params) => POOL.query(sql, params);
const REGION_KEY = 'accept_p351_' + Date.now();
(async () => {
  // ── 准备：管理员登录 + 世界级配置快照 ──
  const li = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }, noAuth: true });
  T = li.j.token || li.j.adminToken;
  if (!T) { console.log('FATAL 管理员登录失败', li.status, JSON.stringify(li.j)); process.exit(1); }
  const cfg0 = (await api('/api/world-ai/config')).j.config;
  WORLD = cfg0.worldId;
  const snapAutonomy = cfg0.autonomy;

  const guard = require('../src/worldai/tools/ownershipGuard');
  const missionTools = require('../src/worldai/tools/missionTools');
  const journal = require('../src/worldai/journal/batchJournal');
  const gridsnap = require('../src/worldai/regions/gridsnap');

  // 区域放在远离现有资产的空地（现有 world_objects 最大约 ±1200）
  const BOUNDS = { kind: 'rect', x: 3000, z: 3000, width: 80, depth: 80 };
  const GRID = { kind: 'modular', unit: [1, 1, 1] };
  // 取一个 active 库的墙零件（优先 modular-buildings：判据 P35-8 以它的1×0.63×1 模数为口径）
  const partRes = await q(
    `SELECT i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, l.id AS lib, l.pack_key
       FROM part_library_items i JOIN part_libraries l ON l.id = i.library_id
      WHERE l.status = 'active' AND i.part_role = 'wall' AND i.grid_w IS NOT NULL
      ORDER BY (l.pack_key = 'kenney_modular_buildings') DESC, l.id, i.id LIMIT 1`
  );
  if (!partRes.rows.length) { console.log('FATAL 找不到 active 库的墙零件（先跑 Phase 1 导入）'); process.exit(1); }
  const PART = partRes.rows[0];

  // 清掉历史失败跑遗留的孤儿 AI 对象（region_id 已不存在的）—— 避免污染行数类断言
  await q(`DELETE FROM world_objects WHERE origin = 'ai'
            AND (region_id IS NULL OR region_id NOT IN (SELECT region_key FROM world_regions))`);

  let missionId = null;
  try {
    // ── P35-1 创建区域 + autonomy 必填 ──
    const noAuto = await api('/api/world-ai/regions', { method: 'POST', body: { regionKey: REGION_KEY, name: '验收区域', bounds: BOUNDS } });
    log('P35-1a autonomy 缺失 → 400（UI 不预选，缺省即视为未做选择）', noAuto.status === 400 && noAuto.j.code === 'AUTONOMY_REQUIRED', 'got ' + noAuto.status + ' ' + noAuto.j.code);
    const badAuto = await api('/api/world-ai/regions', { method: 'POST', body: { regionKey: REGION_KEY, name: '验收区域', bounds: BOUNDS, autonomy: 'wild' } });
    log('P35-1b autonomy 非法值 → 400', badAuto.status === 400 && badAuto.j.code === 'AUTONOMY_INVALID', 'got ' + badAuto.status);
    const badBounds = await api('/api/world-ai/regions', { method: 'POST', body: { regionKey: REGION_KEY, name: 'x', bounds: { kind: 'rect', x: 0, z: 0 }, autonomy: 'managed' } });
    log('P35-1c bounds 缺宽深 → 400', badBounds.status === 400, 'got ' + badBounds.status);
    const cr = await api('/api/world-ai/regions', { method: 'POST', body: { regionKey: REGION_KEY, name: '验收区域', bounds: BOUNDS, autonomy: 'managed', gridsnap: GRID, constraints: { maxObjects: 50 }, notes: '验收用' } });
    const region = cr.j.region;
    log('P35-1d 创建成功且字段回填一致', cr.status === 200 && region.region_key === REGION_KEY && region.autonomy === 'managed'
      && region.bounds.width === BOUNDS.width && region.created_by === 'baseline_shot',
      JSON.stringify({ autonomy: region && region.autonomy, by: region && region.created_by }));
    log('P35-1e 列出区域含新区域', ((await api('/api/world-ai/regions')).j.regions || []).some((r) => r.region_key === REGION_KEY), '');
    const noAuthRegions = await api('/api/world-ai/regions', { noAuth: true });
    log('P35-1f 未鉴权 → 401', noAuthRegions.status === 401, 'got ' + noAuthRegions.status);
    // ── P35-2 有效自主度 = 世界级 × 区域级取更严 ──
    await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });
    const p2a = await api('/api/world-ai/regions/' + REGION_KEY, { method: 'PATCH', body: { autonomy: 'autonomous' } });
    log('P35-2a 世界=semi + 区域=autonomous → 有效semi_autonomous',
      p2a.j.effectiveAutonomy === 'semi_autonomous', 'got ' + p2a.j.effectiveAutonomy);
    await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'autonomous' } });
    const p2b = await api('/api/world-ai/regions/' + REGION_KEY, { method: 'PATCH', body: { autonomy: 'managed' } });
    log('P35-2b 世界=autonomous + 区域=managed → 有效 managed',
      p2b.j.effectiveAutonomy === 'managed', 'got ' + p2b.j.effectiveAutonomy);
    const noNotes = await api('/api/world-ai/regions', { method: 'POST', body: { regionKey: REGION_KEY + '_n', name: 'x', bounds: BOUNDS, autonomy: 'autonomous' } });
    log('P35-2c 选 autonomous 但没填授权理由 → 400（审计追溯，§I.3）',
      noNotes.status === 400 && noNotes.j.code === 'NOTES_REQUIRED', 'got ' + noNotes.status + ' ' + noNotes.j.code);

    // ── 造一个"管理员手建"的人工资产（origin=human，region_id 为 NULL，与现实一致）──
    const humanObj = await q(
      `INSERT INTO world_objects (type, name, model_path, position_x, position_y, position_z, origin)
       VALUES ('uploaded_model','人工资产_验收','/models/uploaded/none.glb',$1,0,$2,'human') RETURNING *`,
      [BOUNDS.x + 10, BOUNDS.z + 10]
    );
    const H = humanObj.rows[0];
    const humanCount0 = await q(`SELECT count(*)::int n FROM world_objects WHERE origin <> 'ai'`);

    // ── P35-3 ★ 人工资产：move/scale/rotate/delete 全部 DENY ──
    const ctxManaged = { worldId: WORLD, regionKey: REGION_KEY, region: { bounds: BOUNDS, gridsnap: GRID }, missionId: null, effectiveAutonomy: 'autonomous', spawnPoint: { x: -26, y: 9, z: 12 }, protectedSpawnRadius: 30 };
    const denyCodes = {};
    // move_object / delete_object 是3.5 仅有的两个动词 → 走 execute（受白名单约束）
    for (const [verb, params] of [
      ['move_object', { id: H.id, x: BOUNDS.x + 12, z: BOUNDS.z + 12 }],
      ['delete_object', { id: H.id }],
    ]) {
      const r = await missionTools.execute(verb, params, ctxManaged);
      denyCodes[verb] = r.code;
    }
    // move / scale / rotate 属 Phase 4 的动词（3.5 不开放）→ 直接对守卫断言：
    //   守卫词表里必须已含它们且对人工资产一律 DENY（判据要求"4 动词逐个断言"）
    for (const verb of ['move', 'scale', 'rotate']) {
      denyCodes[verb] = guard.check(verb, H, ctxManaged).code;
    }
    log('P35-3a 5 个动词对人工资产全部 DENY 且原因是 HUMAN_ASSET_PROTECTED',
      Object.keys(denyCodes).length === 5 && Object.keys(denyCodes).every((k) => denyCodes[k] === 'HUMAN_ASSET_PROTECTED'), JSON.stringify(denyCodes));
    const after = await q(`SELECT position_x, position_z FROM world_objects WHERE id = $1`, [H.id]);
    log('P35-3b 人工资产行未被改动（位置不变、仍存在）',
      after.rows.length === 1 && Math.abs(after.rows[0].position_x - H.position_x) < 1e-9, JSON.stringify(after.rows[0]));
    const guardNoOverride = guard.check('delete_object', H, Object.assign({}, ctxManaged, { force: true, approvedRisks: ['high'] }));
    log('P35-3c 传 force/approvedRisks 也救不了人工资产（守卫无override 参数）',
      guardNoOverride.allow === false && guardNoOverride.code === 'HUMAN_ASSET_PROTECTED', guardNoOverride.code);
    const portal = await q(`SELECT id FROM world_objects WHERE type IN ('portal','ad_slot') LIMIT 1`);
    if (portal.rows.length) {
      const pv = await q(`SELECT * FROM world_objects WHERE id=$1`, [portal.rows[0].id]);
      const vg = guard.check('delete_object', Object.assign({ origin: 'ai', region_id: REGION_KEY, created_by: 'x' }, pv.rows[0]), { regionKey: REGION_KEY, missionId: 'x' });
      log('P35-3d 传送门/广告位即使 origin=ai 也不许 AI 删（永不触碰类型）', vg.allow === false && vg.code === 'NEVER_TOUCH_TYPE', vg.code);
    } else { log('P35-3d 传送门/广告位红线（库里无样本，记 INFO）', true, 'no-sample'); }
    // ── 建委托（P35-3b 的前提：委托内写以 created_by 授权）──
    const cm = await api('/api/world-ai/missions', { method: 'POST', body: { regionKey: REGION_KEY, title: '验收委托', prompt: '砌一圈墙', constraints: { maxObjects: 60 } } });
    missionId = cm.j.mission && cm.j.mission.id;
    log('P35-3b0 创建委托并固化 autonomy_snapshot', cm.status === 200 && !!missionId && cm.j.mission.autonomy_snapshot === 'managed',
      'snapshot=' + (cm.j.mission && cm.j.mission.autonomy_snapshot));
    const ctxMission = { worldId: WORLD, regionKey: REGION_KEY, region: { bounds: BOUNDS, gridsnap: GRID }, missionId: missionId, effectiveAutonomy: 'managed', spawnPoint: { x: -26, y: 9, z: 12 }, protectedSpawnRadius: 30 };

    // ── P35-3b ★ 无missionId 的自主写仍受 autonomy 下限约束（v1.5 订正没被删）──
    const selfWrite = await journal.createObject({ type: 'uploaded_model', name: '自主写尝试', model_path: '/x.glb', position_x: BOUNDS.x + 30, position_z: BOUNDS.z + 30 }, ctxManaged);
    log('P35-3b1 effectiveAutonomy=autonomous 且无 missionId → 允许自主写（v1.5 订正：委托内写与自主写两条路都在）',
      selfWrite.ok === true, 'code=' + selfWrite.code + ' id=' + selfWrite.id);
    const selfWriteManaged = await journal.createObject({ type: 'uploaded_model', name: '自主写尝试2', model_path: '/x.glb', position_x: BOUNDS.x + 31, position_z: BOUNDS.z + 31 },
      { worldId: WORLD, regionKey: REGION_KEY, missionId: null, effectiveAutonomy: 'managed', region: { bounds: BOUNDS } });
    log('P35-3b2 effectiveAutonomy=managed 且无 missionId → DENY（MISSION_REQUIRED）',
      selfWriteManaged.ok === false && selfWriteManaged.code === 'MISSION_REQUIRED', selfWriteManaged.code);
    const gv = guard.check('place_part', { origin: 'ai', region_id: REGION_KEY, created_by: '', position_x: 1, position_z: 1 }, { regionKey: REGION_KEY, effectiveAutonomy: 'managed' });
    log('P35-3b3 守卫里"无委托自主写 ≥ semi_autonomous"这条判定仍存在且生效（managed → DENY）',
      gv.allow === false && gv.code === 'AUTONOMY_TOO_LOW', gv.code);
    if (selfWrite.ok) { await q(`DELETE FROM world_objects WHERE id=$1`, [selfWrite.id]); }
    const aiCount_b3 = await q(`SELECT count(*)::int n FROM world_objects WHERE origin='ai' AND region_id=$1`, [REGION_KEY]);

    // 顺带确认：semi_autonomous 下自主写是放行的（v1.5 订正不是"一律禁止自主写"）
    const gv2 = guard.check('place_part', { origin: 'ai', region_id: REGION_KEY, created_by: '', position_x: 1, position_z: 1 }, { regionKey: REGION_KEY, effectiveAutonomy: 'semi_autonomous' });
    log('P35-3b4 semi_autonomous 下自主写放行（两条路都在，不是把自主写整体禁掉）',
      gv2.allow === true, gv2.code);

    // ── P35-5 ★ placement_policy='replace' 参数不存在 ──
    const p5 = await missionTools.execute('place_part', { partKey: PART.part_key, x: BOUNDS.x + 2, z: BOUNDS.z + 2, placement_policy: 'replace' }, ctxMission);
    log('P35-5a placement_policy=replace → UNKNOWN_PARAM（不是"被拒绝"，是根本没这个参数）',
      p5.ok === false && p5.code === 'UNKNOWN_PARAM' && (p5.unknownParams || []).indexOf('placement_policy') >= 0, p5.code + ' ' + JSON.stringify(p5.unknownParams));
    const p5b = await missionTools.execute('place_part', { partKey: PART.part_key, x: BOUNDS.x + 2, z: BOUNDS.z + 2, placement_policy: 'avoid' }, ctxMission);
    log('P35-5b 连 avoid 也不接受：placement_policy 只存在于委托 constraints，不在动词参数里（schema 单一来源）',
      p5b.ok === false && p5b.code === 'UNKNOWN_PARAM', p5b.code);
    const missionToolsMod = require('../src/worldai/missions/missionService');
    log('P35-5c 委托 constraints 写 placement_policy=replace → PLACEMENT_POLICY_FORBIDDEN',
      missionToolsMod.sanitizeConstraints({ placement_policy: 'replace' }).code === 'PLACEMENT_POLICY_FORBIDDEN', '');
    log('P35-5d 委托 constraints 不写 placement_policy → 自动归一为 avoid',
      missionToolsMod.sanitizeConstraints({ maxObjects: 3 }).constraints.placement_policy === 'avoid', '');

    // ── P35-6 ★ 绕过 missionTools 直接调 journal：守卫再查一次 → 落库 0 行 ──
    const aiBefore = (await q(`SELECT count(*)::int n FROM world_objects WHERE origin='ai'`)).rows[0].n;
    const bypass1 = await journal.createObject({ type: 'uploaded_model', name: '绕过尝试', model_path: '/x.glb', position_x: BOUNDS.x + 40, position_z: BOUNDS.z + 40 },
      { worldId: WORLD, regionKey: null, missionId: missionId, effectiveAutonomy: 'managed' });
    const bypass2 = await journal.createObject({ type: 'uploaded_model', name: '绕过尝试2', model_path: '/x.glb', position_x: BOUNDS.x + 41, position_z: BOUNDS.z + 41 },
      { worldId: WORLD, regionKey: REGION_KEY, missionId: null, effectiveAutonomy: 'managed', region: { bounds: BOUNDS, gridsnap: GRID } });
    const aiAfter = (await q(`SELECT count(*)::int n FROM world_objects WHERE origin='ai'`)).rows[0].n;
    log('P35-6a 绕过 missionTools 直接调 journal 仍被拒（缺 regionKey / managed 无委托）',
      bypass1.ok === false && bypass2.ok === false, bypass1.code + '/' + bypass2.code);
    log('P35-6b 被拒的写入落库 0 行（origin=ai 行数不变）', aiAfter === aiBefore, aiBefore + '→' + aiAfter);
    const exported = Object.keys(missionTools);
    log('P35-6c missionTools 只导出 execute/白名单，不导出任何动词实现（结构上没有第二个入口）',
      exported.indexOf('execute') >= 0 && exported.every((k) => ['execute', 'PARAM_SCHEMA', 'VERBS', 'validateParams'].indexOf(k) >= 0), JSON.stringify(exported));
    // ── P35-4 ★撞人工资产 → 换位不覆盖 ──
    const before4 = (await q(`SELECT count(*)::int n FROM world_objects WHERE origin='ai' AND region_id=$1`, [REGION_KEY])).rows[0].n;
    const hit = await missionTools.execute('place_part', { partKey: PART.part_key, x: H.position_x, z: H.position_z }, ctxMission);
    const after4 = (await q(`SELECT count(*)::int n FROM world_objects WHERE origin='ai' AND region_id=$1`, [REGION_KEY])).rows[0].n;
    const humanStill = (await q(`SELECT count(*)::int n FROM world_objects WHERE id=$1`, [H.id])).rows[0].n;
    log('P35-4a 落点与人工资产相交 → 换位（relocated/skippedByCollision）而非覆盖',
      hit.ok === true && hit.relocated === true && hit.skippedByCollision === true && hit.humanBlocked === true,
      JSON.stringify({ ok: hit.ok, relocated: hit.relocated, humanBlocked: hit.humanBlocked }));
    log('P35-4b 人工资产没被删/没被改（仍在1 行）', humanStill === 1, 'rows=' + humanStill);
    log('P35-4c 换位后的落点与原落点不同且仍在区域内',
      hit.ok === true && Math.abs(hit.x - H.position_x) + Math.abs(hit.z - H.position_z) > 0
      && hit.x >= BOUNDS.x && hit.x <= BOUNDS.x + BOUNDS.width, 'at ' + hit.x + ',' + hit.z);
    const dup = await missionTools.execute('place_part', { partKey: PART.part_key, x: hit.x, z: hit.z }, ctxMission);
    log('P35-4d 重跑幂等：同委托+同落点不产生重复对象（deduped）',
      dup.ok === true && dup.deduped === true, 'deduped=' + dup.deduped);

    // ── P35-7 越界 place_part → DENY（不是事后清理）──
    const out1 = await missionTools.execute('place_part', { partKey: PART.part_key, x: BOUNDS.x - 20, z: BOUNDS.z + 5 }, ctxMission);
    const out2 = await missionTools.execute('place_part', { partKey: PART.part_key, x: BOUNDS.x + 5, z: BOUNDS.z + BOUNDS.depth + 20 }, ctxMission);
    log('P35-7a 围栏外落点 → OUT_OF_BOUNDS DENY（不换位、不事后清理）',
      out1.ok === false && out1.code === 'OUT_OF_BOUNDS' && out2.ok === false && out2.code === 'OUT_OF_BOUNDS',
      out1.code + '/' + out2.code);

    // ── P35-8 网格对齐：连放 20 个墙 ──
    const unit = gridsnap.unitOfPart(PART);
    const spots = [];
    for (let i = 0; i < 20; i++) {
      const r = await missionTools.execute('place_part', { partKey: PART.part_key, x: BOUNDS.x + 20.3 + i * 1.4, z: BOUNDS.z + 30.7 + i * 0.6 }, ctxMission);
      if (r.ok) spots.push(r);
    }
    const offGrid = spots.filter((s) => !gridsnap.isOnGrid(s.x, unit[0]) || !gridsnap.isOnGrid(s.z, unit[2]));
    const maxErr = spots.reduce((m, s) => Math.max(m,
      Math.abs(s.x / unit[0] - Math.round(s.x / unit[0])) * unit[0],
      Math.abs(s.z / unit[2] - Math.round(s.z / unit[2])) * unit[2]), 0);
    log('P35-8a 连放 20 个墙全部落在模数格点（' + unit.join('×') + '，误差 <1e-6）',
      spots.length === 20 && offGrid.length === 0 && maxErr < 1e-6, 'placed=' + spots.length + ' maxErr=' + maxErr);

    // ── P35-17 existingAssets ──
    const assets = (await api('/api/world-ai/regions/' + REGION_KEY + '/assets')).j.assets;
    log('P35-17 创建区域时能列出区域内人工资产（含 region_id 为 NULL 的手建资产）',
      assets && assets.humanCount >= 1 && assets.humanAssets.some((a) => a.id === H.id) && assets.notice.indexOf('只读') >= 0,
      'human=' + (assets && assets.humanCount) + ' ai=' + (assets && assets.aiCount));
    // ── 回滚（P35-11 的地基：唯一写库路径的批量删除）──
    const beforeRollback = await q(`SELECT count(*)::int n FROM world_objects`);
    const rb = (await api('/api/world-ai/missions/' + missionId + '/rollback', { method: 'POST', body: {} })).j;
    const afterRollback = await q(`SELECT count(*)::int n FROM world_objects`);
    const humanAfter = (await q(`SELECT count(*)::int n FROM world_objects WHERE origin <> 'ai'`)).rows[0].n;
    log('P35-11a 一键回滚删掉本批全部 AI 对象，人工资产零影响',
      rb && rb.rolledBack >= 20 && (beforeRollback.rows[0].n - afterRollback.rows[0].n) === rb.rolledBack
      && humanAfter === humanCount0.rows[0].n,
      'deleted=' + (rb && rb.rolledBack) + ' 人工行 ' + humanCount0.rows[0].n + '→' + humanAfter);
    log('P35-11b 回滚后委托状态=rolled_back', (await api('/api/world-ai/missions/' + missionId)).j.mission.status === 'rolled_back', '');
    const afterRb = await api('/api/world-ai/missions/' + missionId + '/tools/execute', { method: 'POST', body: { verb: 'place_part', params: { partKey: PART.part_key, x: BOUNDS.x + 3, z: BOUNDS.z + 3 } } });
    log('P35-11c 已回滚的委托不能再写（HTTP 口拦·MISSION_ROLLED_BACK）',
      afterRb.j.success === false && afterRb.j.code === 'MISSION_ROLLED_BACK', 'got ' + afterRb.status + ' ' + afterRb.j.code);
    const stillNone = await q(`SELECT count(*)::int n FROM world_objects WHERE created_by=$1`, [missionId]);
    log('P35-11d 回滚后本批行数确为 0（没有"删了又建"）', stillNone.rows[0].n === 0, 'rows=' + stillNone.rows[0].n);

    // ── 收尾：删人工测试资产 + 删区域 + 还原世界级自主度 ──
    await q(`DELETE FROM world_objects WHERE id = $1`, [H.id]);
    await q(`DELETE FROM world_build_missions WHERE id = $1`, [missionId]);
    await q(`DELETE FROM world_regions WHERE region_key = $1`, [REGION_KEY]);
    await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: snapAutonomy } });
    const restored = (await api('/api/world-ai/config')).j.config;
    log('清理：人工测试资产/区域/委托已删、世界级 autonomy 已还原', restored.autonomy === snapAutonomy,
      'autonomy=' + restored.autonomy);
  } catch (e) {
    log('FATAL 脚本异常', false, e && e.stack ? e.stack.split('\n')[0] : e);
    try {
      await q(`DELETE FROM world_objects WHERE name LIKE '人工资产_验收%'`);
      await q(`DELETE FROM world_regions WHERE region_key LIKE 'accept_p351_%'`);
    } catch (e2) { /* ignore */ }
  }

  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  await POOL.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });