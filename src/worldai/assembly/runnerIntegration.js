/**
 * runnerIntegration —— solver 路径的执行编排（M1-4 灰度接入）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么单独一个文件：missionRunner.js 已有 218 行（§K：>500 行只允许 ≤3 行接线），
 * 所以 runner 里只加「模式判断 + 转交」两行，全部功能逻辑落在这里。
 *
 * ★ 灰度纪律（判据 M1-4-1 / M1-4-3）：
 *   ① 默认 legacy —— 只有委托 constraints.assemblyMode === 'solver' 才会走到本文件；
 *   ② 本文件失败**绝不静默回落 legacy**：回落会让「新路径从来没成功过」这件事永远查不出来。
 *      失败一律 code=ASSEMBLY_SOLVER_FAILED + stage + innerCode，并把 error 写进 executed_stats。
 *   ③ 写世界只有一条路：missionTools.execute('place_part')。本文件不写任何 INSERT。
 *
 * ★ 接缝保护（关键，别顺手改）：
 *   place_part 会按「零件自身模数」二次吸附坐标。2m 墙件若按 2m 格吸附，
 *   x=-3 会被吸到 -4 → 整圈墙平移错位、接缝全乱。所以这里传 snapUnit=[0.05,1,0.05]：
 *   x/z 细格（0.05m 能整除 2m / 1m / 0.5m 所有实测模数），y 仍按 1m 格 → level 语义=米。
 *   同理传 ignoreSelfBatch：同一栋楼的件本来就是贴合设计的，互判碰撞会被「换位」挪歪。
 *
 * ★ 本轮已知能力缺口（不是 bug，是参数不存在）：
 *   place_part 的参数白名单里没有 scale_*，山墙的垂直拉伸（scaleY≠1）落不了库。
 *   本轮硬边界不允许改 missionTools.js，故按「未拉伸」落地，并在 stats.scalePending 与 notes 里写明。
 */
'use strict';

const registry = require('./templateRegistry');
const solver = require('./solver');
const adapter = require('./adapter');

/** 细格吸附：保住求解器算出的坐标（详见文件头「接缝保护」） */
const SNAP_UNIT = [0.05, 1, 0.05];

/** 与 missionRunner 同口径的「被守卫拒绝」失败码 */
const DENY_CODES = ['OUT_OF_BOUNDS', 'NEVER_TOUCH_TYPE', 'HUMAN_ASSET_PROTECTED'];

/** 默认状态写回（惰性 require：验收注入 onStats 时不加载数据库） */
async function defaultPersist(missionId, status, extra) {
  const missionService = require('../missions/missionService');
  return missionService.setStatus(missionId, status, extra);
}

/**
 * 以 solver 路径执行一个建设委托。
 * @param {object} mission world_build_missions 行（含 constraints / autonomy_snapshot）
 * @param {object} region  区域行（含 bounds / gridsnap）
 * @param {object} [opts]  { started, notes, dryRun, partResolver, tools, onStats, listObjects }
 * @returns {Promise<{ok:boolean, status?:string, code?:string, reason?:string, stats?:object, assembly?:object}>}
 */
/**
 * ★ 总兜底（防线）：异常绝不允许冒到 missionRunner。
 *   原因很硬：missionRunner 的 solver 分支没有 try/catch（那里只允许 3 行接线），
 *   而 claimRegionForRun 早已把委托置为 running 并提交。异常一旦外泄，路由只会回 500，
 *   委托停在 running —— 而 claimRegionForRun 的忙判断是 status IN ('running','queued')，
 *   于是**这个区域之后所有委托都会 409 REGION_BUSY**，只能手工改库才能解开。
 *   所以这里宁可牺牲异常堆栈，也要把状态落成 failed 并返回可读 code。
 *
 * @param {object} mission
 * @param {object} region
 * @param {object} [opts]
 */
async function run(mission, region, opts) {
  const o = opts || {};
  // 进度计数放在外层：中途抛异常时还能报出「已经落了几个」，不至于把台账全丢掉
  const progress = {
    objectsCreated: 0, deduped: 0, skippedByCollision: 0, denied: 0, failed: 0,
  };
  try {
    return await runInner(mission, region, o, progress);
  } catch (e) {
    // reason 只放人能读的一句话；堆栈另存 error.stack（写进 executed_stats 备查，不塞进 reason）
    const reason = 'solver 路径未捕获异常：' + String((e && e.message) || e).slice(0, 200);
    const stats = {
      objectsCreated: progress.objectsCreated, deduped: progress.deduped,
      skippedByCollision: progress.skippedByCollision, denied: progress.denied, failed: progress.failed + 1,
      llmCalls: 0, wallClockMs: Date.now() - (o.started || Date.now()),
      notes: (Array.isArray(o.notes) ? o.notes.slice() : []).concat(['★ 未捕获异常，见 executed_stats.error.reason']),
      mode: 'solver',
      error: { code: 'UNCAUGHT', stage: 'uncaught', reason, stack: String((e && e.stack) || '').slice(0, 800) },
      assembly: { templateId: null, stage: 'uncaught', error: { code: 'UNCAUGHT', reason } },
    };
    try {
      const persist = typeof o.onStats === 'function' ? o.onStats : defaultPersist;
      await persist(mission && mission.id, 'failed', { stats });
    } catch (e2) {
      // 连状态都写不进去（DB 不可用）——这时只能保证「不把异常抛给上层」
    }
    return {
      ok: false, status: 'failed', code: 'ASSEMBLY_SOLVER_FAILED', stage: 'uncaught',
      innerCode: 'UNCAUGHT', reason, stats,
    };
  }
}

async function runInner(mission, region, opts, progress) {
  const o = opts || {};
  const started = o.started || Date.now();
  const notes = Array.isArray(o.notes) ? o.notes.slice() : [];
  const persist = typeof o.onStats === 'function' ? o.onStats : defaultPersist;
  const c = (mission && mission.constraints) || {};
  const templateId = c.template || c.templateId || c.template_id || null;

  /** 失败出口：写 failed + error 进 executed_stats，然后明确返回，不回落 legacy */
  async function stop(innerCode, stage, reason, hint, extra) {
    const assembly = Object.assign(adapter.assemblyStatsOf(null, {
      templateId, stage, error: { code: innerCode, reason },
    }), extra || {});
    const stats = {
      objectsCreated: progress.objectsCreated, deduped: progress.deduped,
      skippedByCollision: progress.skippedByCollision, denied: progress.denied, failed: progress.failed,
      llmCalls: 0, wallClockMs: Date.now() - started, notes,
      mode: 'solver', error: { code: innerCode, stage, reason }, assembly,
    };
    await persist(mission.id, 'failed', { stats });
    return { ok: false, status: 'failed', code: 'ASSEMBLY_SOLVER_FAILED', stage, innerCode, reason, hint: hint || null, stats };
  }

  // ── 1) 模板 → spec ────────────────────────────────────────────────
  if (!templateId) {
    return stop('TEMPLATE_REQUIRED', 'template',
      '走 solver 路径必须在委托 constraints 里指定 template（模板 id）',
      '可用模板：' + registry.listTemplates().map((t) => t.id).join(', '));
  }
  const built = registry.buildSpec(templateId, {
    width: c.width, depth: c.depth, wallHeight: c.wallHeight,
  });
  if (!built.ok) {
    return stop(built.code, 'buildSpec', built.reason,
      '尺寸必须服从模数：模板里 dimensions / 允许尺寸集合是唯一合法取值（M1 文档 R1）');
  }
  const spec = built.spec;

  // ── 2) 件信息（外部注入优先，否则走 adapter 只读库）──────────────────
  let resolver = typeof o.partResolver === 'function' ? o.partResolver : null;
  if (!resolver) {
    const keys = Object.values(spec.parts || {}).filter((k) => typeof k === 'string' && k);
    let resolved;
    try {
      resolved = await adapter.resolvePartsFromDb(keys, spec.pack);
    } catch (e) {
      return stop('PART_QUERY_FAILED', 'partResolver', '查询零件库失败：' + String((e && e.message) || e).slice(0, 200),
        '确认数据库可连通、part_library_items / part_libraries / uploaded_models 表结构未变');
    }
    if (!resolved.ok) {
      return stop('PART_MISSING', 'partResolver', '零件库缺件：' + resolved.missing.join(', '),
        '检查模板 pack_key 与 part_key 是否匹配，库 status 是否为 active');
    }
    resolver = adapter.makeResolver(resolved.partMap);
  }

  // ── 3) 求解 ──────────────────────────────────────────────────────
  const solved = await solver.solve(spec, { partResolver: resolver, policy: c.assemblyPolicy });
  if (!solved.ok) {
    return stop(solved.code, 'solve', solved.reason, solved.hint, { missing: solved.missing || null });
  }

  // ── 3b) 预算闸门（与 legacy 的 max_objects 同口径，但**不截断**）────────
  // legacy 交给 planner 按 P35-9 截断；solver 的件数由模板决定，截断会把楼建残
  // （缺一面墙 / 少一排屋顶），所以这里选择明确失败，让管理员换小模板或抬预算。
  const maxObjects = Number(c.max_objects) > 0 ? Number(c.max_objects) : 0;
  if (maxObjects > 0 && solved.stats.pieceCount > maxObjects) {
    return stop('ASSEMBLY_EXCEEDS_BUDGET', 'budget',
      `模板 ${templateId} 需要 ${solved.stats.pieceCount} 件，超过委托预算 constraints.max_objects=${maxObjects}`,
      '抬 max_objects，或换更小的模板；solver 不做截断（截断会缺墙少顶，破坏建筑完整性）',
      { pieceCount: solved.stats.pieceCount, maxObjects });
  }

  // ── 4) 局部坐标 → 世界坐标 ────────────────────────────────────────
  const objects = adapter.placementsToWorldObjects(solved.parts, { region });
  const scalePending = objects.filter((p) => Math.abs(p.scaleY - 1) > 1e-9).length;
  if (scalePending) {
    notes.push(`有 ${scalePending} 件需要垂直拉伸（scale_y≠1，山墙填屋脊）：place_part 没有 scale 参数，`
      + '本轮按未拉伸落地 —— 已记入 stats.scalePending，需在 missionTools 增加 scale 白名单后补写');
  }
  notes.push(...solved.notes);

  // 预演：只算不写（与 legacy 的 dryRun 语义一致：不落库、不改状态）
  if (o.dryRun) {
    return {
      ok: true, status: 'planned', dryRun: true, mode: 'solver',
      placements: objects, notes,
      stats: Object.assign(adapter.assemblyStatsOf(solved, { plannedParts: objects.length, scalePending }), { dryRun: true }),
    };
  }

  // ── 5) 落位（唯一写库路径：place_part）─────────────────────────────
  const tools = o.tools || require('../tools/missionTools');
  const ctx = {
    worldId: mission.world_id,
    regionKey: mission.region_key,
    region,
    missionId: String(mission.id),
    effectiveAutonomy: mission.autonomy_snapshot,
    approvedRisks: [],
    spawnPoint: { x: 0, y: 0.05, z: 0 },
    protectedSpawnRadius: 0,
    snapUnit: SNAP_UNIT,      // ★ 保接缝，见文件头
    ignoreSelfBatch: true,    // ★ 同栋设计内贴合，不互判碰撞
  };

  // ★ 直接用外层 progress 对象计数：中途抛异常时，兜底还能报出已经落了几个
  const stats = progress;
  stats.llmCalls = 0;
  stats.notes = notes;
  stats.mode = 'solver';
  const deniedSamples = [];
  for (const p of objects) {
    let r;
    try {
      r = await tools.execute('place_part', { partKey: p.partKey, x: p.x, z: p.z, ry: p.ry, level: p.level }, ctx);
    } catch (e) {
      stats.failed++;
      continue;
    }
    if (r && r.ok) {
      if (r.deduped) stats.deduped++;
      else stats.objectsCreated++;
      if (r.skippedByCollision) stats.skippedByCollision++;
    } else if (r && r.skipped) {
      stats.skippedByCollision++;
    } else if (r && DENY_CODES.indexOf(r.code) >= 0) {
      stats.denied++;
      if (deniedSamples.length < 5) deniedSamples.push({ partKey: p.partKey, code: r.code });
    } else {
      stats.failed++;
      if (deniedSamples.length < 5) deniedSamples.push({ partKey: p.partKey, code: (r && r.code) || 'UNKNOWN' });
    }
  }
  if (deniedSamples.length) notes.push('落位异常样本（前 5 条）：' + JSON.stringify(deniedSamples));

  // ── 6) 记账：库里实际有多少本批对象（防「以为建了其实没建」）────────────
  if (typeof o.listObjects === 'function') {
    try {
      const list = await o.listObjects(mission.id);
      stats.objectsInBatch = Array.isArray(list) ? list.length : 0;
    } catch (e) {
      notes.push('回查本批对象失败（不影响已落库结果）：' + String((e && e.message) || e).slice(0, 200));
    }
  }
  stats.wallClockMs = Date.now() - started;
  stats.assembly = adapter.assemblyStatsOf(solved, {
    scalePending,
    objectsCreated: stats.objectsCreated,
    deduped: stats.deduped,
    plannedParts: objects.length,
  });

  const status = stats.failed > 0 && stats.objectsCreated === 0 ? 'failed' : 'completed';
  await persist(mission.id, status, { stats });
  return { ok: status === 'completed', status, stats, notes, assembly: stats.assembly };
}

module.exports = { run, SNAP_UNIT, DENY_CODES };
