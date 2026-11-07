/**
 * templateRunner —— 「模板规划」路径的委托执行器（M1-7 · 灰度接线）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 链路：
 *   委托(constraints.planMode='template')
 *     → templatePlanner.planTemplates（LLM 只输出意图：哪些模板、放哪、朝哪）
 *     → validateIntent（坐标/尺寸/预算/布局合法性，非法就把原因喂回重试）
 *     → intentExecutor.executeIntent（逐条翻译成工具层动词）
 *     → missionTools.execute → journal.batchCreate（唯一写库路径）
 *
 * 与 runnerIntegration（assemblyMode='solver'）的区别：
 *   solver 路径的模板是**事先指定**的（constraints.template），一单一栋；
 *   本路径让 LLM 自己选模板、自己排布，因此能出"一座村"而不只是一栋房。
 *
 * ★ 失败不回落 legacy（与 M1-4 同口径）：回落会让「AI 说建了但实际走了旧算法」
 *   这种事重新出现，排查成本远高于一次明确失败。
 * ★ 默认路径不变：missionRunner 只在 constraints.planMode==='template' 时进来。
 */
'use strict';

const terrainGround = require('../assembly/terrainGround');

/** 状态写回（可注入，验收时不碰数据库） */
async function defaultPersist(missionId, status, extra) {
  const missionService = require('./missionService');
  return missionService.setStatus(missionId, status, extra);
}

/**
 * @param {object} mission world_build_missions 行
 * @param {object} region  区域行（含 bounds / gridsnap）
 * @param {object} [opts]  { started, notes, planTemplates, executeIntent, persist, chat, maxRounds }
 */
async function run(mission, region, opts) {
  const o = opts || {};
  const started = o.started || Date.now();
  const notes = Array.isArray(o.notes) ? o.notes.slice() : [];
  const persist = typeof o.persist === 'function' ? o.persist : defaultPersist;
  const planFn = o.planTemplates || require('./templatePlanner').planTemplates;
  const execFn = o.executeIntent || require('./intentExecutor').executeIntent;

  const c = (mission && mission.constraints) || {};
  const stats = {
    mode: 'template',
    planMode: 'template',
    objectsCreated: 0, deduped: 0, skippedByCollision: 0, denied: 0, failed: 0,
    llmCalls: 0, wallClockMs: 0, notes,
    buildings: 0, roads: 0, props: 0, pieces: 0,
    template: { rounds: 0, contractTokens: null },
  };

  async function fail(code, stage, reason, extra) {
    stats.wallClockMs = Date.now() - started;
    stats.error = { code, stage, reason: String(reason || '').slice(0, 400) };
    Object.assign(stats, extra || {});
    await persist(mission.id, 'failed', { stats });
    return { ok: false, status: 'failed', code: 'TEMPLATE_PLAN_FAILED', innerCode: code, stage, reason: stats.error.reason, stats };
  }

  try {
    // ── 1) 区域 / 预算 ──
    if (!region || !region.bounds) return await fail('REGION_INVALID', 'region', '区域缺少 bounds');

    const maxObjects = Number(c.max_objects) > 0 ? Number(c.max_objects) : 0;

    // ── 2) 地面（整块区域采一次；村庄尺度起伏要在可接受范围）──
    let groundY = 0;
    try {
      const b = region.bounds;
      const g = await terrainGround.underFootprint(
        Number(b.x) + Number(b.width) / 2,
        Number(b.z) + Number(b.depth) / 2,
        Number(b.width) || 0, Number(b.depth) || 0
      );
      groundY = Number(g.baseY) || 0;
      if (g.hasTerrain) notes.push(`地面基准 y=${groundY}（区域起伏 ${g.span}m）`);
    } catch (e) {
      notes.push('地形采样失败，按 y=0 处理：' + String((e && e.message) || e).slice(0, 120));
    }

    // ── 3) 规划（LLM 只出意图）──
    const planned = await planFn(mission, region, {
      maxObjects,
      maxRounds: o.maxRounds,
      chat: o.chat,          // 可注入假模型（验收用）
    });
    stats.llmCalls = Number(planned.rounds) || 0;
    stats.template.rounds = Number(planned.rounds) || 0;
    stats.template.contractTokens = planned.contractTokens == null ? null : planned.contractTokens;
    if (!planned.ok) {
      return await fail(planned.code || 'PLAN_FAILED', 'plan', planned.reason, { planHint: planned.hints || null });
    }
    stats.buildings = planned.stats.buildings;
    stats.roads = planned.stats.roads;
    stats.props = planned.stats.props;
    stats.pieces = planned.stats.pieces;
    if (Array.isArray(planned.notes) && planned.notes.length) notes.push.apply(notes, planned.notes);
    notes.push('规划：' + planned.stats.buildings + ' 栋 / ' + planned.stats.roads + ' 条路 / '
      + planned.stats.props + ' 组道具，约 ' + planned.stats.pieces + ' 件');

    // ── 4) 执行（全部经工具层）──
    const ctx = {
      worldId: mission.world_id,
      regionKey: mission.region_key,
      region,
      missionId: String(mission.id),
      effectiveAutonomy: mission.autonomy_snapshot,
      approvedRisks: [],
      spawnPoint: { x: 0, y: 0.05, z: 0 },
      protectedSpawnRadius: 0,
      groundY,
      maxObjects,
    };
    const ex = await execFn(planned.plan, ctx);
    stats.objectsCreated = ex.calls.length ? (await countObjects(mission.id)) : 0;
    stats.toolCalls = ex.calls.length;
    const bad = (ex.calls || []).filter((x) => !x.ok);
    stats.failed = bad.length;
    if (bad.length) {
      notes.push('工具调用失败 ' + bad.length + ' 条：'
        + bad.slice(0, 5).map((x) => x.verb + '/' + x.code).join(', '));
    }

    stats.wallClockMs = Date.now() - started;
    const okRun = stats.objectsCreated > 0;
    await persist(mission.id, okRun ? 'completed' : 'failed', { stats });
    return {
      ok: okRun,
      status: okRun ? 'completed' : 'failed',
      code: okRun ? null : 'TEMPLATE_BUILD_EMPTY',
      stats,
      notes,
      plan: planned.plan,
    };
  } catch (e) {
    // 未捕获异常也必须写明确失败码，绝不把异常抛给上层（否则区域会被永久占成 REGION_BUSY）
    stats.wallClockMs = Date.now() - started;
    stats.error = { code: 'UNCAUGHT', stage: 'uncaught', reason: String((e && e.message) || e).slice(0, 400) };
    try { await persist(mission.id, 'failed', { stats }); } catch (e2) { /* 连状态都写不进就只能保证不抛 */ }
    return { ok: false, status: 'failed', code: 'TEMPLATE_PLAN_FAILED', innerCode: 'UNCAUGHT', stage: 'uncaught', reason: stats.error.reason, stats };
  }
}

/** 本批实际落了多少件（防「以为建了其实没建」） */
async function countObjects(missionId) {
  try {
    const { query } = require('../../database/db');
    const r = await query(
      `SELECT count(*)::int n FROM world_objects WHERE created_by=$1 AND origin='ai'`,
      [String(missionId)]
    );
    return r.rows[0].n;
  } catch (e) {
    return 0;
  }
}

module.exports = { run };
