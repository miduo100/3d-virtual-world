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
const { authenticateAdminToken, logAdminAction } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const regionService = require('../regions/regionService');
const missionService = require('../missions/missionService');
const missionTools = require('../tools/missionTools');
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
    const before = await journal.countBatchObjects(m.id);
    const r = await journal.rollbackBatch(m.id, { regionKey: m.region_key });
    await missionService.setStatus(m.id, 'rolled_back', { stats: Object.assign({}, m.executed_stats, { rolledBackObjects: r.deleted }) });
    await logAdminAction(req.adminUser.id, 'world_ai_mission_rollback', 'world_build_missions', m.id, JSON.stringify({ before, deleted: r.deleted }), req.ip);
    res.json({ success: true, before, rolledBack: r.deleted, ids: r.ids });
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