/**
 * missionRunner —— 执行编排：校验 → 逐件 place → 记账 → 验证 → 写 stats（Phase 3.5-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单 + 判据 P35-9/10/12。
 *
 * ★ 三条关键口径：
 *   1) **autonomy 用 mission.autonomy_snapshot，不读区域当前值**（判据 P35-12）：
 *      管理员中途把区域调严，本批仍按快照跑完 —— 否则会留下"建了一半"的半成品，
 *      而且事后无法判定该保留哪一部分（§C.3㉑ 故意冗余的理由）。
 *   2) 坐标由本层用 gridsnap 决定（LLM 只给相对偏移）；place_part 仍会再过一次
 *      围栏 + 占位预检（纵深防御：planner 算过了不等于可以直接写库）。
 *   3) 重跑按 created_by 去重（batchJournal.findExisting），中断后重跑不产生重复对象。
 *
 * 本阶段 world_memories 表尚未建（属 Phase 4/6），故"记 memory"落在
 * executed_stats.notes[] 里 —— 语义等价、可查，且不需要提前建表。
 */
'use strict';

const { query, pool } = require('../../database/db');
const missionService = require('./missionService');
const missionPlanner = require('./missionPlanner');
const missionTools = require('../tools/missionTools');
const journal = require('../journal/batchJournal');
const gridsnap = require('../regions/gridsnap');
const regionService = require('../regions/regionService');

function num(v, def) { const n = Number(v); return isFinite(n) ? n : def; }

/**
 * 3.5-3 P35-20：同区域并发写闸门（写在 runner 自己文件里，不进 missionTools）。
 *
 * ★ 为什么不能只用"单条 UPDATE + NOT EXISTS"：两条并发 claim 的目标行**不同**（各自改自己的
 *   委托行），NOT EXISTS 子查询读对方的行却不加锁 —— READ COMMITTED 下两个事务的快照都
 *   可能取在对方提交之前 → 双双看到 draft → 双双成功（实测复现：首跑过、复跑双双 completed）。
 *   所以必须先拿**区域级 advisory 事务锁**串行化两个 claim，再做检查 + 占位。
 *
 * 被拒方保持原状态（draft），返回 code='REGION_BUSY' 由路由映射 409 —— 不是硬失败。
 */
async function claimRegionForRun(mission) {
  const lockKey = String(mission.world_id) + ':' + String(mission.region_key);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    const busy = await client.query(
      `SELECT id, status FROM world_build_missions
        WHERE world_id = $1 AND region_key = $2 AND id <> $3 AND status IN ('running','queued')
        LIMIT 1`,
      [String(mission.world_id), String(mission.region_key), String(mission.id)]
    );
    if (busy.rows.length) {
      await client.query('ROLLBACK');
      const b = busy.rows[0];
      return {
        ok: false, code: 'REGION_BUSY', busyMissionId: String(b.id),
        reason: '同一区域已有正在执行/排队的建设委托（#' + b.id + ' ' + b.status + '）'
          + '；并发写同一区域会产生重叠资产，先等它完成或回滚后再执行本委托',
      };
    }
    const upd = await client.query(
      `UPDATE world_build_missions SET status = 'running', started_at = COALESCE(started_at, NOW())
        WHERE id = $1 RETURNING id`,
      [String(mission.id)]
    );
    await client.query('COMMIT');
    if (upd.rows.length) return { ok: true };
    return { ok: false, code: 'MISSION_NOT_FOUND', reason: '委托不存在：' + mission.id };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    throw e;
  } finally {
    client.release();
  }
}

/** 相对偏移 → 绝对坐标（吸附后） */
function absoluteOf(region, block, part) {
  const b = region.bounds || {};
  const minX = num(b.minX, num(b.x, 0));
  const minZ = num(b.minZ, num(b.z, 0));
  const maxX = num(b.maxX, minX + num(b.width, 0));
  const maxZ = num(b.maxZ, minZ + num(b.depth, 0));
  // ★ 模型经常把 block.anchor 写成 (0,0) → 整块落点贴在区域角点 → 距边 0 < 半足迹
  //   → 全部 OUT_OF_BOUNDS、0 件落地（实测 3 连）。anchor 缺省/为 0 时默认放区域【中部】
  //   （否则所有委托都钳到同一个角点，历次 AI 资产在角落堆成密簇，换位螺旋全灭——实测"换位4建了1"）；
  //   非零 anchor 钳进区域内侧（留 3m 边距）。零件最终落点仍走 boundsGuard，围栏红线不变。
  const margin = 3;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const anchorDx = num(block.anchor && block.anchor.dx, 0);
  const anchorDz = num(block.anchor && block.anchor.dz, 0);
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const rawX = (anchorDx === 0 && anchorDz === 0) ? midX : minX + anchorDx;
  const rawZ = (anchorDx === 0 && anchorDz === 0) ? midZ : minZ + anchorDz;
  const baseX = clamp(rawX, minX + margin, Math.max(minX + margin, maxX - margin));
  const baseZ = clamp(rawZ, minZ + margin, Math.max(minZ + margin, maxZ - margin));
  const unit = Array.isArray(part.grid) && part.grid.length === 3 && part.grid[0] > 0 ? part.grid : gridsnap.unitOf(region.gridsnap);
  const snapped = gridsnap.snap({ x: baseX + num(part.dx, 0), z: baseZ + num(part.dz, 0), y: 0 }, unit, part.level);
  return { x: snapped.x, y: snapped.y, z: snapped.z, unit };
}
/**
 * 执行一个委托。
 * @param {string} missionId
 * @param {object} opts { injectPlan?, provider?, contextWindowTokens?, dryRun? }
 * @returns {Promise<{ok, status, stats, plan?, code?, reason?}>}
 */
async function run(missionId, opts) {
  const o = opts || {};
  const mission = await missionService.getMission(missionId);
  if (!mission) return { ok: false, code: 'MISSION_NOT_FOUND', reason: '委托不存在：' + missionId };
  if (mission.status === 'rolled_back') return { ok: false, code: 'MISSION_ROLLED_BACK', reason: '本批已回滚，不能再跑' };

  const region = await regionService.getRegion(mission.world_id, mission.region_key);
  if (!region) return { ok: false, code: 'REGION_NOT_FOUND', reason: '区域不存在：' + mission.region_key };

  // ★ 自主度一律用快照（P35-12）
  const snapshot = mission.autonomy_snapshot;
  const notes = [];
  if (region.autonomy !== snapshot) {
    notes.push('区域自主度已从 ' + snapshot + ' 调整为 ' + region.autonomy + '；本批仍按建委托时的快照 ' + snapshot + ' 跑完（§C.3⑑ 故意冗余）');
  }

  // 3.5-3 P35-20：原子占位（取代原先无条件 setStatus('running')——并发下两个都会过）
  const claim = await claimRegionForRun(mission);
  if (!claim.ok) return { ok: false, code: claim.code, reason: claim.reason, busyMissionId: claim.busyMissionId };
  const started = Date.now();

  // 1) 布局提案（预算闸门在 planner 内，查 ai_call_log 表）
  // ★ B1 确认卡：useSavedPlan=true 时直接用"生成方案"保存并经管理员确认的那份方案，
  //   绝不重新规划（否则确认卡看的是 A、建的却是 B，确认语义失效）。无已存方案时回落重新规划。
  let planned;
  const savedPlan = mission.plan && Array.isArray(mission.plan.blocks) ? mission.plan : null;
  if (o.useSavedPlan && savedPlan) {
    const parts = savedPlan.blocks.reduce((s, b) => s + ((b.parts || []).length), 0);
    planned = {
      ok: true, plan: savedPlan, rounds: 0, savedPlan: true,
      llmCalls: 0,
      stats: { blocks: savedPlan.blocks.length, parts, dropped: {} },
    };
    notes.push('本批按已确认的方案执行（未重新规划）');
  } else {
    planned = null;
  }
  if (!planned) {
    try {
      planned = await missionPlanner.plan(mission, region, o);
    } catch (e) {
      await missionService.setStatus(mission.id, 'failed', { stats: { error: String(e && e.message).slice(0, 300) } });
      return { ok: false, status: 'failed', code: 'PLANNER_FAILED', reason: String(e && e.message).slice(0, 300) };
    }
  }
  if (!planned.ok) {
    // P35-10：第 2 轮被预算拒绝 → status=failed 且写明原因
    await missionService.setStatus(mission.id, 'failed', { stats: { llmCalls: planned.llmCalls || 0, error: planned.reason } });
    return { ok: false, status: 'failed', code: planned.code, reason: planned.reason, llmCalls: planned.llmCalls || 0 };
  }
  await missionService.savePlan(mission.id, planned.plan);
  if (planned.plan && planned.plan.intentGap) {
    notes.push('⚠ 意图差距（重试后仍未完全达标，建议追加委托或调整表述）：' + planned.plan.intentGap);
  }
  if (planned.truncated) {
    notes.push('零件数超过 constraints.max_objects，已截断到预算内（不报错，判据 P35-9）：' + JSON.stringify(planned.stats.dropped));
  }
  // 3.5-3 P35-22：换家原因并入 executed_stats.notes（可追溯）
  if (Array.isArray(planned.fallbackNotes) && planned.fallbackNotes.length) notes.push(...planned.fallbackNotes);

  // 2) 预演模式：只算不写（后台"预览"用）
  if (o.dryRun) {
    const preview = [];
    for (const block of planned.plan.blocks || []) {
      for (const part of block.parts || []) {
        const abs = absoluteOf(region, block, part);
        preview.push({ partKey: part.partKey, role: part.role, x: abs.x, y: abs.y, z: abs.z, ry: part.ry });
      }
    }
    return { ok: true, status: 'planned', dryRun: true, stats: planned.stats, preview, notes };
  }

  // 3) 逐件执行（place_part 内部再过一次围栏 + 占位预检 + 守卫）
  const ctx = {
    worldId: mission.world_id,
    regionKey: mission.region_key,
    region,
    missionId: String(mission.id),
    effectiveAutonomy: snapshot,          // ★ 快照，不是区域当前值
    approvedRisks: [],
    spawnPoint: { x: 0, y: 0.05, z: 0 },
    protectedSpawnRadius: 0,              // 围栏已在区域层校验，这里不再叠加出生点半径（区域本就该由管理员选）
  };
  const stats = {
    objectsCreated: 0, deduped: 0, skippedByCollision: 0, denied: 0, failed: 0,
    trisAdded: 0, llmCalls: planned.llmCalls || 0, notes,
  };
  const deniedSamples = [];
  for (const block of planned.plan.blocks || []) {
    for (const part of block.parts || []) {
      const abs = absoluteOf(region, block, part);
      const r = await missionTools.execute('place_part', {
        partKey: part.partKey, x: abs.x, z: abs.z, ry: part.ry, level: part.level,
      }, ctx);
      if (r.ok) {
        if (r.deduped) stats.deduped++;
        else stats.objectsCreated++;
        if (r.skippedByCollision) stats.skippedByCollision++;
        const tris = part.modelTris || null;
        if (tris) stats.trisAdded += Number(tris) || 0;
      } else if (r.skipped) {
        stats.skippedByCollision++;
      } else if (r.code === 'OUT_OF_BOUNDS' || r.code === 'NEVER_TOUCH_TYPE' || r.code === 'HUMAN_ASSET_PROTECTED') {
        stats.denied++;
        if (deniedSamples.length < 5) deniedSamples.push({ partKey: part.partKey, code: r.code });
      } else {
        stats.failed++;
      }
    }
  }
  if (deniedSamples.length) notes.push('被守卫拒绝的部件（前 5 条）：' + JSON.stringify(deniedSamples));

  // 4) 验证：库里实际有多少本批对象（防止"以为建了其实没建"）
  const objects = await journal.listBatchObjects(mission.id);
  stats.objectsInBatch = objects.length;
  stats.wallClockMs = Date.now() - started;
  const status = stats.failed > 0 && stats.objectsCreated === 0 ? 'failed' : 'completed';
  await missionService.setStatus(mission.id, status, { stats });

  return { ok: status === 'completed', status, stats, plan: planned.plan, notes };
}
/** 回滚（判据 P35-11 的一键入口；与路由共用同一实现） */
async function rollback(missionId) {
  const mission = await missionService.getMission(missionId);
  if (!mission) return { ok: false, code: 'MISSION_NOT_FOUND', reason: '委托不存在：' + missionId };
  const before = await journal.countBatchObjects(mission.id);
  const r = await journal.rollbackBatch(mission.id, { regionKey: mission.region_key });
  const stats = Object.assign({}, mission.executed_stats, { rolledBackObjects: r.deleted, rolledBackFrom: before });
  await missionService.setStatus(mission.id, 'rolled_back', { stats });
  return { ok: true, before, rolledBack: r.deleted, ids: r.ids };
}

module.exports = { run, rollback, absoluteOf };