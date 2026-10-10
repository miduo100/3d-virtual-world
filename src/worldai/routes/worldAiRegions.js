/**
 * worldAiRegions 路由（/api/world-ai 下的第二个 router）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Phase 3.5-1（队列第3 项）：区域 CRUD + 建设委托 + 工具执行口。
 * 全部管理端点走 authenticateAdminToken（与 2a 的 worldAi.js 一致；那个文件本次不动，
 * 同一前缀挂第二个 router 是 Express 允许的，不必为"合并"去改既有文件）。
 *
 * ★ POST /missions/:id/tools/execute 是给 UI/验收用的**受控工具口**：
 *   它只透传 missionTools.execute(verb, params, ctx)，不暴露动词内部实现——
 *   绕过它就等于绕过 ownershipGuard，而守卫在 journal 层还会再查一次（纵深防御）。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const { authenticateAdminToken, logAdminAction } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const regionService = require('../regions/regionService');
const missionService = require('../missions/missionService');
const missionPlanner = require('../missions/missionPlanner');
const missionRunner = require('../missions/missionRunner');
const missionTools = require('../tools/missionTools');
const interactionService = require('../gameplay/interactionService');
const microQuestService = require('../gameplay/microQuestService');
const journal = require('../journal/batchJournal');

router.use(authenticateAdminToken);

/** 组 ctx：区域 + 有效自主度 + 出生点保护参数（守卫与围栏都要） */
async function buildCtx(worldId, regionKey, mission) {
  const region = await regionService.getRegion(worldId, regionKey);
  const eff = await regionService.effectiveAutonomyOf(worldId, regionKey);
  let spawnPoint = { x: 0, y: 0.05, z: 0 };
  let radius = 30;
  try {
    const r = await worldAiConfig.getConfig(worldId);
    const b = (r && r.budget) || {};
    if (isFinite(Number(b.protectedSpawnRadius))) radius = Number(b.protectedSpawnRadius);
    if (b.spawnPoint && typeof b.spawnPoint === 'object') spawnPoint = b.spawnPoint;
  } catch (e) { /* 配置缺失用兜底 */ }
  return {
    worldId: String(worldId),
    regionKey: String(regionKey),
    region: region || {},
    missionId: mission ? String(mission.id) : null,
    autonomy: eff.regionAutonomy,
    effectiveAutonomy: eff.effective,
    spawnPoint,
    protectedSpawnRadius: radius,
    approvedRisks: [],
  };
}

// ── 区域 ───────────────────────────────────────────────
router.get('/regions', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    res.json({ success: true, regions: await regionService.listRegions(worldId) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/regions', async (req, res) => {
  const b = req.body || {};
  try {
    const worldId = b.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await regionService.createRegion(Object.assign({}, b, { worldId, createdBy: req.adminUser.username }));
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    await logAdminAction(req.adminUser.id, 'world_ai_region_create', 'world_regions', r.region.region_key, JSON.stringify({ autonomy: r.region.autonomy }), req.ip);
    res.json({ success: true, region: r.region });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 区域详情（adminWorldRegions「执行」按钮的自主度预检走这里；此前缺失 → 前端 404 "Not found"）
router.get('/regions/:regionKey', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    const region = await regionService.getRegion(worldId, req.params.regionKey);
    if (!region) return res.status(404).json({ success: false, error: '区域不存在', code: 'REGION_NOT_FOUND' });
    const eff = await regionService.effectiveAutonomyOf(worldId, req.params.regionKey);
    res.json({ success: true, region, effectiveAutonomy: eff.effective });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/regions/:regionKey/assets', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await regionService.existingAssets(worldId, req.params.regionKey);
    if (!r.ok) return res.status(404).json({ success: false, error: r.reason, code: r.code });
    res.json({ success: true, assets: r });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/regions/:regionKey', async (req, res) => {
  const b = req.body || {};
  try {
    const worldId = b.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await regionService.setAutonomy(worldId, req.params.regionKey, b.autonomy, b.notes);
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    const eff = await regionService.effectiveAutonomyOf(worldId, req.params.regionKey);
    res.json({ success: true, region: r.region, effectiveAutonomy: eff.effective });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/regions/:regionKey', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await regionService.deleteRegion(worldId, req.params.regionKey);
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    res.json({ success: true, deleted: r.deleted });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
// ── 建设委托 ────────────────────────────────────────────
router.post('/missions', async (req, res) => {
  const b = req.body || {};
  try {
    const worldId = b.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await missionService.createMission(Object.assign({}, b, { worldId, createdBy: req.adminUser.username }));
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    await logAdminAction(req.adminUser.id, 'world_ai_mission_create', 'world_build_missions', r.mission.id, JSON.stringify({ region: r.mission.region_key, provider: r.mission.provider_id }), req.ip);
    res.json({ success: true, mission: r.mission, autonomySnapshot: r.autonomySnapshot, providerResolution: r.providerResolution });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// B2 增量补充（队列14）：基于既有委托追加"再来一批"——新委托 prompt 自动注入
// 区域内已有 AI 资产清单（按零件名计数），AI 只补差距（数量/种类），不重复已有组合。
router.post('/missions/:id/followup', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    const addendum = String((req.body || {}).prompt || '').trim();
    if (!addendum) return res.status(400).json({ success: false, error: '必须写补充要求（如：再加 20 棵、增加几种树）', code: 'PROMPT_REQUIRED' });
    const region = await regionService.getRegion(m.world_id, m.region_key);
    if (!region) return res.status(404).json({ success: false, error: '区域不存在', code: 'REGION_NOT_FOUND' });
    const b = region.bounds || {};
    const minX = Number(b.minX != null ? b.minX : b.x) || 0;
    const minZ = Number(b.minZ != null ? b.minZ : b.z) || 0;
    const maxX = Number(b.maxX != null ? b.maxX : minX + (Number(b.width) || 0));
    const maxZ = Number(b.maxZ != null ? b.maxZ : minZ + (Number(b.depth) || 0));
    const exist = await query(
      `SELECT name, count(*)::int AS n FROM world_objects
        WHERE origin='ai' AND position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4 AND name IS NOT NULL
        GROUP BY name ORDER BY n DESC LIMIT 20`,
      [minX, maxX, minZ, maxZ]
    );
    const existTxt = exist.rows.map((r) => r.name + '×' + r.n).join('、') || '（区域内暂无 AI 资产）';
    const composed = '【增量补充】' + addendum
      + '\n【最初需求】' + String(m.prompt || '')
      + '\n【区域内已有 AI 资产】' + existTxt
      + '\n【补充纪律】只补差距：数量不足补数量、种类单一补种类；已有组合（同零件同位置）绝不重复；若已完全满足就输出空 blocks 数组。';
    const r = await missionService.createMission({
      worldId: m.world_id, regionKey: m.region_key,
      title: ('补充：' + addendum).slice(0, 30),
      prompt: composed,
      constraints: m.constraints || {}, budget: m.budget || {},
      createdBy: req.adminUser.username,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    await logAdminAction(req.adminUser.id, 'world_ai_mission_followup', 'world_build_missions', r.mission.id, JSON.stringify({ from: m.id }), req.ip);
    res.json({ success: true, mission: r.mission, autonomySnapshot: r.autonomySnapshot, existingAssets: exist.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/missions', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    res.json({ success: true, missions: await missionService.listMissions(worldId, req.query.regionKey) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/missions/:id', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    const objects = await journal.listBatchObjects(m.id);
    res.json({ success: true, mission: m, objects });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/missions/:id/rollback', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    const r = await missionRunner.rollback(req.params.id);
    await logAdminAction(req.adminUser.id, 'world_ai_mission_rollback', 'world_build_missions', req.params.id, JSON.stringify({ before: r.before, deleted: r.rolledBack }), req.ip);
    res.json({ success: true, before: r.before, rolledBack: r.rolledBack, ids: r.ids });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 排队：把委托交给 Runtime 自动执行（Phase 2b 调度最小闭环）。
// queued = 管理员显式批准自动执行；每次 tick 取最旧一条 queued 跑。
router.post('/missions/:id/queue', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    if (['completed', 'rolled_back', 'queued'].indexOf(m.status) >= 0) {
      return res.status(400).json({ success: false, code: 'QUEUE_NOT_ALLOWED', error: '当前状态 ' + m.status + ' 不能排队（completed/rolled_back 不可再跑；已在排队则无需重复）' });
    }
    const r = await missionService.setStatus(m.id, 'queued');
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    await logAdminAction(req.adminUser.id, 'world_ai_mission_queue', 'world_build_missions', m.id, JSON.stringify({ from: m.status }), req.ip);
    res.json({ success: true, mission: r.mission });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 预览：生成布局但不落库（后台「生成方案」按钮；人工可编辑后再执行）
router.post('/missions/:id/plan', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    const region = await regionService.getRegion(m.world_id, m.region_key);
    const r = await missionPlanner.plan(m, region, req.body || {});
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    if (r.plan) await missionService.savePlan(m.id, r.plan);
    res.json({ success: true, plan: r.plan, stats: r.stats, rounds: r.rounds, llmCalls: r.llmCalls });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 执行：managed 档需显式 confirm（= 人工点执行）；②③ 档自动执行
router.post('/missions/:id/run', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    const eff = await regionService.effectiveAutonomyOf(m.world_id, m.region_key);
    if (eff.effective === 'managed' && !(req.body || {}).confirm) {
      return res.status(400).json({
        success: false, code: 'CONFIRM_REQUIRED',
        error: '当前有效自主度是 managed（只按明确下达的委托干活）→ 必须由管理员点「执行」确认；semi_autonomous / autonomous 才自动执行',
      });
    }
    const r = await missionRunner.run(m.id, { injectPlan: (req.body || {}).injectPlan || null, useSavedPlan: !!(req.body || {}).useSavedPlan });
    // 3.5-3 P35-20：同区域并发被闸门拒绝 → 409（非硬失败；被拒方保持原状态可重跑）
    if (r.code === 'REGION_BUSY') return res.status(409).json(Object.assign({}, r, { success: false }));
    await logAdminAction(req.adminUser.id, 'world_ai_mission_run', 'world_build_missions', m.id, JSON.stringify({ status: r.status, created: r.stats && r.stats.objectsCreated }), req.ip);
    res.json(Object.assign({}, r, { success: !!r.ok }));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 极简玩法（Phase 3.5-2）────────────────────────────────────────
// ★ 一期仅 Agent 侧：真人 interact 服务端不响应（判据 P35-16），后台 UI 需写明，避免被当成故障。
router.post('/regions/:regionKey/interactions', async (req, res) => {
  try {
    const b = req.body || {};
    const worldId = b.worldId || (await worldAiConfig.getConfig()).world_id;
    const key = String(b.key || '').trim();
    if (!key) return res.status(400).json({ success: false, error: '必须给 key（同区域内唯一）' });
    const p = b.position || {};
    const r = await query(
      `INSERT INTO world_interactions (world_id, region_key, interaction_type, key, label, position, radius, payload, grants, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ai')
       ON CONFLICT (world_id, interaction_type, key) DO UPDATE
         SET label = EXCLUDED.label, position = EXCLUDED.position, radius = EXCLUDED.radius, payload = EXCLUDED.payload
       RETURNING *`,
      [worldId, req.params.regionKey, String(b.interaction_type || 'reward_grant'), key, b.label || '采集点',
        JSON.stringify({ x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 }),
        Math.min(Number(b.radius) || 3, 30), JSON.stringify(b.payload || {}), JSON.stringify(b.grants || null)]
    );
    res.json({ success: true, interaction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/interactions/interact', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await interactionService.interact({
      worldId: b.worldId, actorType: b.actorType || 'agent', actorId: b.actorId,
      position: b.position, interactionKey: b.interactionKey, regionKey: b.regionKey,
    });
    res.json(Object.assign({}, r, { success: !!r.ok }));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/regions/:regionKey/quests', async (req, res) => {
  try {
    const b = req.body || {};
    const worldId = b.worldId || (await worldAiConfig.getConfig()).world_id;
    const r = await microQuestService.createForRegion(Object.assign({}, b, { worldId, regionKey: req.params.regionKey }));
    if (!r.ok) return res.status(400).json({ success: false, error: r.reason, code: r.code });
    res.json({ success: true, task: r.task, existed: !!r.existed });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/quests', async (req, res) => {
  try {
    const worldId = req.query.worldId || (await worldAiConfig.getConfig()).world_id;
    res.json({ success: true, tasks: await microQuestService.listTasks(worldId, req.query.regionKey) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** 受控工具口：只透传 missionTools.execute，不暴露动词实现（P35-6 的结构依据） */
router.post('/missions/:id/tools/execute', async (req, res) => {
  const b = req.body || {};
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '委托不存在' });
    if (m.status === 'rolled_back') {
      return res.status(400).json({ success: false, code: 'MISSION_ROLLED_BACK', error: '本批已回滚，不能继续写入' });
    }
    const ctx = await buildCtx(m.world_id, m.region_key, m);
    const result = await missionTools.execute(b.verb, b.params || {}, ctx);
    res.json(Object.assign({ success: true, verb: b.verb }, result, { success: !!result.ok }));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
module.exports.buildCtx = buildCtx;