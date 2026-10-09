/**
 * optimizer —— 5 条确定性优化规则 + 信号 → 候选动词（AI World Brain · Phase 7 · 分册 §12.2 · 判据 P6-4/5/6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：分册 §12.2 的 5 条规则表 + 主文档 §I.1 的 OPTIMIZE 段 + §I.6 开发注意事项第 3 条
 *   「5 条优化规则是确定性代码先行 —— 统计判定不经过 LLM；LLM 只在规则命中后选择动作」。
 *
 * ★ 四条纪律（红线）：
 *   1) 规则先行，LLM 可选：全部判定是确定性代码；configs.schedule.optimize.llm_interpret=true
 *      时才走一次 LLM 解读（只写 memory，绝不拦截执行；默认关 = 用户 2026-10-09 决策）。
 *   2) 执行必走 executor（统一守卫/预算/账本/审批/幂等），动词内部零守卫。
 *   3) R4 删除类永不自动：只提交 high 风险审批（P6-6），删除由人批。
 *   4) 指标只从 world_metrics_daily 读（§H.6 聚合优先）；任务参与率读事件流（无日聚合口径）。
 *
 * 阈值全部读 configs.schedule.optimize（后台可调），缺项回落 DEFAULTS：
 *   baselineDays 7 / hotFactor 2.5 / densityPer1000m2 3 / gapMinutes 5 / minSamples 20 / maxActionsPerCycle 2
 */
'use strict';

const { query } = require('../../database/db');
// ★ 类型纪律：world_objects.region_id 是 VARCHAR（存 region_key），world_metrics_daily.region_id 才是 UUID
const worldAiConfig = require('../config');
const experiment = require('./experiment');

const DEFAULTS = {
  baselineDays: 7,
  hotFactor: 2.5,          // §12.2 R2：热度 > 基线 2.5 倍
  densityPer1000m2: 3,      // R4：每 1000m² AI 对象数超阈值 = 内容过剩
  gapMinutes: 5,           // R5：新实体 5 分钟无交互
  minSamples: 20,          // R3：完成率下滑的最小样本
  maxActionsPerCycle: 2,   // 每轮最多动手的信号数（其余 skipped，防一次性大规模改动）
  llmInterpret: false,     // LLM 解读默认关
};

const RULES = ['R1', 'R2', 'R3', 'R4', 'R5'];

async function params(worldId) {
  try {
    const cfg = await worldAiConfig.getConfig(worldId);
    const sched = (cfg && typeof cfg.schedule === 'object' && cfg.schedule) ? cfg.schedule : {};
    const raw = (sched.optimize && typeof sched.optimize === 'object') ? sched.optimize : {};
    const out = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'llmInterpret') { if (raw[k] === true) out[k] = true; continue; }
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

// ────────────────────────────── 基础取数 ──────────────────────────────

async function loadRegions(worldId) {
  const r = await query(
    `SELECT id, region_key, name, purpose, bounds, status FROM world_regions
      WHERE world_id = $1 AND status <> 'sealed' ORDER BY created_at ASC LIMIT 40`, [String(worldId)]);
  return r.rows || [];
}

function areaOf(bounds) {
  const b = bounds || {};
  const minX = Number(b.minX !== undefined ? b.minX : b.x);
  const minZ = Number(b.minZ !== undefined ? b.minZ : b.z);
  const w = Number(b.width !== undefined ? b.width : (Number(b.maxX !== undefined ? b.maxX : 0) - minX));
  const d = Number(b.depth !== undefined ? b.depth : (Number(b.maxZ !== undefined ? b.maxZ : 0) - minZ));
  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(w) || !Number.isFinite(d)) return 1;
  return Math.max(1, Math.abs(w * d));
}

function centerOf(bounds) {
  const b = bounds || {};
  const minX = Number(b.minX !== undefined ? b.minX : (b.x || 0));
  const minZ = Number(b.minZ !== undefined ? b.minZ : (b.z || 0));
  const w = Number(b.width !== undefined ? b.width : 0);
  const d = Number(b.depth !== undefined ? b.depth : 0);
  return { x: minX + w / 2, z: minZ + d / 2 };
}

/** 某区域的窗口指标和（区域行 region_id = world_regions.id 的 UUID） */
async function regionMetric(worldId, regionId, metricKey, fromDay, toDay) {
  return experiment.metricSeries(worldId, regionId, metricKey, fromDay, toDay);
}

function windowDays(cfgP, offsetDays) {
  const now = Date.now() - (offsetDays || 0) * 86400000;
  return { from: experiment.dayStr(now - cfgP.baselineDays * 86400000), to: experiment.dayStr(now) };
}

/** 任务参与率（领取数 / 完成数）——事件流口径，无日聚合 */
async function taskParticipation(worldId, fromIso, toIso) {
  const r = await query(
    `SELECT count(*) FILTER (WHERE type='task_claimed')::int AS claimed,
            count(*) FILTER (WHERE type='task_completed')::int AS completed
       FROM world_events
      WHERE world_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,
    [String(worldId), String(fromIso), String(toIso)]
  );
  const row = r.rows[0] || {};
  const claimed = row.claimed || 0;
  const completed = row.completed || 0;
  return { claimed, completed, rate: claimed > 0 ? completed / claimed : null };
}
// ────────────────────────────── 5 条规则（分册 §12.2）──────────────────────────────

/** R1 冷区激活：区域 visits=0 且 dwell=0 → 建地标 + 引导任务 */
async function ruleR1(worldId, cfgP, regions) {
  const out = [];
  const w = windowDays(cfgP, 0);
  for (const region of regions) {
    const visits = await regionMetric(worldId, region.id, 'visits', w.from, w.to);
    const dwell = await regionMetric(worldId, region.id, 'dwell_sec', w.from, w.to);
    if (visits.sum > 0 || dwell.sum > 0) continue;
    const c = centerOf(region.bounds);
    out.push({
      rule: 'R1', regionKey: region.region_key, regionId: region.id, metricKey: 'visits',
      reason: '冷区：' + cfgP.baselineDays + ' 天内 visits=' + visits.sum + '、dwell=' + dwell.sum + ' 秒',
      hypothesis: '在冷区「' + region.name + '」建地标 + 引导任务，可提升访问量',
      evidence: { visits: visits.sum, dwell: dwell.sum, days: visits.days },
      candidates: [landmarkCandidate(region, c, '冷区激活地标'), guideTaskCandidate(region, c, '冷区激活引导')],
    });
  }
  return out;
}

/** R2 高峰减压：热度 > 基线 2.5 倍 → 增 NPC ×2 */
async function ruleR2(worldId, cfgP, regions) {
  if (regions.length < 2) return [];
  const w = windowDays(cfgP, 0);
  const per = [];
  for (const region of regions) {
    const v = await regionMetric(worldId, region.id, 'visits', w.from, w.to);
    per.push({ region, visits: v.sum });
  }
  const active = per.filter((x) => x.visits > 0);
  if (active.length < 2) return [];
  const avg = active.reduce((s, x) => s + x.visits, 0) / active.length;
  const out = [];
  for (const x of per) {
    if (x.visits <= avg * cfgP.hotFactor) continue;
    const c = centerOf(x.region.bounds);
    out.push({
      rule: 'R2', regionKey: x.region.region_key, regionId: x.region.id, metricKey: 'visits',
      reason: '高峰：访问 ' + x.visits + ' > 基线 ' + avg.toFixed(1) + ' × ' + cfgP.hotFactor,
      hypothesis: '在高峰区域增 2 个 NPC 分散人流',
      evidence: { visits: x.visits, baselineAvg: Number(avg.toFixed(2)), factor: cfgP.hotFactor },
      candidates: [
        { tool: 'create_npc', params: { name: '区域引导员·' + x.region.name, x: c.x, z: c.z, description: '高峰减压：引导人流' } },
        { tool: 'create_npc', params: { name: '区域讲解员·' + x.region.name, x: c.x + 6, z: c.z, description: '高峰减压：讲解与分流' } },
      ],
    });
  }
  return out;
}

/** R3 参与率下滑：完成率 < 基线 60% 且样本 ≥N → 改难度/奖励（必须可回滚） */
async function ruleR3(worldId, cfgP) {
  const now = Date.now();
  const recent = await taskParticipation(worldId,
    new Date(now - cfgP.baselineDays * 86400000).toISOString(), new Date(now).toISOString());
  const prior = await taskParticipation(worldId,
    new Date(now - cfgP.baselineDays * 2 * 86400000).toISOString(),
    new Date(now - cfgP.baselineDays * 86400000).toISOString());
  if (recent.claimed < cfgP.minSamples) return [];
  if (recent.rate === null || prior.rate === null) return [];
  if (!(recent.rate < prior.rate * 0.6)) return [];
  const rows = (await query(
    `SELECT t.id, t.title, t.reward,
            count(*) FILTER (WHERE e.type='task_claimed')::int AS claimed,
            count(*) FILTER (WHERE e.type='task_completed')::int AS completed
       FROM world_events e JOIN world_tasks t ON t.id::text = e.target_id
      WHERE e.world_id=$1 AND e.created_at >= $2::timestamptz
      GROUP BY t.id, t.title, t.reward
     HAVING count(*) FILTER (WHERE e.type='task_claimed') > 0
      ORDER BY count(*) FILTER (WHERE e.type='task_completed') ASC, claimed DESC
      LIMIT 1`,
    [String(worldId), new Date(now - cfgP.baselineDays * 86400000).toISOString()]
  )).rows || [];
  if (!rows.length) return [];
  const t = rows[0];
  const reward = (t.reward && typeof t.reward === 'object') ? t.reward : { type: 'reward_codes', count: 1 };
  const easier = Object.assign({}, reward, { count: (Number(reward.count) || 1) + 1 });
  return [{
    rule: 'R3', regionKey: '(全局)', regionId: null, metricKey: 'task_completion',
    reason: '参与率下滑：完成率 ' + (recent.rate * 100).toFixed(1) + '% < 基线 ' + (prior.rate * 100).toFixed(1) + '% 的 60%（样本 ' + recent.claimed + '）',
    hypothesis: '把任务「' + String(t.title).slice(0, 30) + '」奖励提高一档，可提升完成率',
    evidence: { recentRate: Number(recent.rate.toFixed(4)), priorRate: Number(prior.rate.toFixed(4)), claimed: recent.claimed, taskId: String(t.id) },
    candidates: [{
      tool: 'modify_task',
      params: { taskId: String(t.id), reward: easier, description: '（R3 参与率修复）奖励已提高一档：' + String(t.title).slice(0, 60) },
    }],
  }];
}
/** R4 内容过剩：密度超阈值且访问低 → 提交 3 个删除的 high 风险审批（永不自动删） */
async function ruleR4(worldId, cfgP, regions) {
  const out = [];
  const w = windowDays(cfgP, 0);
  for (const region of regions) {
    const area = areaOf(region.bounds);
    const objects = (await query(
      `SELECT count(*)::int AS n FROM world_objects WHERE region_id = $1 AND origin = 'ai'`,
      [region.region_key])).rows[0].n;
    const density = (objects / area) * 1000;
    if (density < cfgP.densityPer1000m2) continue;
    const visits = await regionMetric(worldId, region.id, 'visits', w.from, w.to);
    const cold = (await query(
      `SELECT o.id FROM world_objects o
        WHERE o.region_id = $1 AND o.origin='ai' AND o.is_locked = false
          AND o.type NOT IN ('portal','ad_slot')
        ORDER BY o.id ASC LIMIT 3`, [region.region_key])).rows || [];
    if (cold.length < 3) continue;                 // 不足 3 个不凑数
    out.push({
      rule: 'R4', regionKey: region.region_key, regionId: region.id, metricKey: 'visits',
      reason: '内容过剩：密度 ' + density.toFixed(1) + '/1000m²（阈值 ' + cfgP.densityPer1000m2 + '）、访问仅 ' + visits.sum,
      hypothesis: '移除该区域 3 个最冷 AI 对象以缓解密度（删除类需人工审批，不自动执行）',
      evidence: { objects, area: Math.round(area), density: Number(density.toFixed(2)), visits: visits.sum },
      approvalOnly: true,
      candidates: cold.map((o) => ({
        tool: 'delete_object',
        params: { objectId: Number(o.id), reason: 'R4 内容过剩：区域内最冷 AI 对象' },
      })),
    });
  }
  return out;
}

/** R5 引导缺口：新实体 N 分钟无交互 → 附近建地标 + 引导任务 */
async function ruleR5(worldId, cfgP) {
  const rows = (await query(
    `SELECT e.id, e.name, e.region_key,
            (SELECT count(*) FROM world_events ev WHERE ev.world_id = e.world_id AND ev.entity_id = e.id
               AND ev.type='object_interact')::int AS interacts
       FROM world_entities e
      WHERE e.world_id = $1 AND e.created_at > NOW() - ($2::int * INTERVAL '1 minute')
      ORDER BY e.created_at DESC LIMIT 10`,
    [String(worldId), Math.max(1, Math.floor(cfgP.gapMinutes))]
  )).rows || [];
  const out = [];
  for (const e of rows) {
    if (e.interacts > 0) continue;
    const key = e.region_key ? String(e.region_key) : '';
    const region = (await query(
      `SELECT id, region_key, name, bounds FROM world_regions WHERE region_key=$1 LIMIT 1`, [key])).rows[0];
    if (!region) continue;
    const c = centerOf(region.bounds);
    out.push({
      rule: 'R5', regionKey: region.region_key, regionId: region.id, metricKey: 'visits',
      reason: '引导缺口：新实体「' + String(e.name).slice(0, 24) + '」已建 ' + cfgP.gapMinutes + ' 分钟，交互 0 次',
      hypothesis: '在其所在区域补地标与引导任务，提高被看见与被使用的概率',
      evidence: { entityId: String(e.id), interacts: e.interacts },
      candidates: [landmarkCandidate(region, c, '引导地标'), guideTaskCandidate(region, c, '引导任务')],
    });
  }
  return out;
}

/** 地标候选（固定 procedural：小体量、确定性能建成） */
function landmarkCandidate(region, c, prefix) {
  return {
    tool: 'create_procedural_building',
    params: {
      regionId: region.region_key,
      x: Number(c.x.toFixed(2)), z: Number(c.z.toFixed(2)),
      spec: {
        buildingType: 'landmark', purpose: 'landmark', entityType: 'prop',
        name: (prefix || '地标') + '·' + region.name,
        footprint: { width: 4, depth: 4 },
        levels: [{ floors: 1, heightPerFloor: 4.5 }],
        style: { roofStyle: 'pyramid' },
        budget: { maxTriangles: 3000, maxComponents: 30 },
        seed: 20261007,
      },
    },
  };
}

/** 引导任务候选（reach_region 目标，公开可见） */
function guideTaskCandidate(region, c, prefix) {
  return {
    tool: 'create_task',
    params: {
      title: (prefix || '引导') + '：到「' + region.name + '」看看',
      description: '这里最近有新变化，走进来看看（引导任务，由 World AI 按优化规则发布）',
      objectives: [{ type: 'reach_region', regionKey: region.region_key, count: 1 }],
      regionKey: region.region_key,
      questType: 'side', visibility: 'public',
      reward: { type: 'reward_codes', count: 1 },
    },
  };
}
// ────────────────────────────── 信号 → 执行 ──────────────────────────────

/** 探测全部 5 条规则的命中信号（纯读，零 LLM） */
async function detectSignals(worldId, cfgP) {
  const regions = await loadRegions(worldId);
  const signals = [];
  signals.push(...await ruleR1(worldId, cfgP, regions));
  signals.push(...await ruleR2(worldId, cfgP, regions));
  signals.push(...await ruleR3(worldId, cfgP));
  signals.push(...await ruleR4(worldId, cfgP, regions));
  signals.push(...await ruleR5(worldId, cfgP));
  return signals;
}

/**
 * 执行一个信号：先开实验（过冷却）→ 候选动词逐个走 executor → 把 execution 登记为变更 step。
 * approvalOnly（R4）：**不开实验、不自动执行删除**，只让 executor 产出 high 风险审批。
 */
async function applySignal(worldId, sig) {
  const executor = require('../runtime/executor');
  const steps = [];
  if (sig.approvalOnly) {
    for (const cand of sig.candidates) {
      const r = await executor.execute(cand.tool, cand.params, {
        worldId, regionKey: sig.regionKey, actor: 'world_ai:optimizer', reason: sig.rule + ' ' + sig.reason,
      });
      steps.push(experiment.toChangeStep(cand.tool, cand.params, r));
    }
    await writeMemory(worldId, sig, 'R4 已提交 ' + steps.length + ' 个删除审批（不自动删除，等人工）');
    return { rule: sig.rule, regionKey: sig.regionKey, approvalOnly: true, steps };
  }
  const exp = await experiment.start({
    worldId, regionKey: sig.regionKey, regionId: sig.regionId, rule: sig.rule,
    metricKey: sig.metricKey, hypothesis: sig.hypothesis, changeSteps: [],
  });
  if (!exp.ok) return { skipped: true, rule: sig.rule, regionKey: sig.regionKey, code: exp.code, reason: exp.reason };
  for (const cand of sig.candidates) {
    const r = await executor.execute(cand.tool, cand.params, {
      worldId, regionKey: sig.regionKey, actor: 'world_ai:optimizer', reason: sig.rule + ' ' + sig.reason,
    });
    steps.push(experiment.toChangeStep(cand.tool, cand.params, r));
  }
  await query(`UPDATE world_ai_experiments SET change_steps = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [exp.experiment.id, JSON.stringify(steps)]);
  await writeMemory(worldId, sig, '已按 ' + sig.rule + ' 执行候选动作 ' + steps.length + ' 步，进入 ' +
    exp.params.experimentDays + ' 天 A/B 观察窗（基线 ' + Number(exp.baseline.avg.toFixed(2)) + '）');
  return {
    rule: sig.rule, regionKey: sig.regionKey, experimentId: String(exp.experiment.id),
    metricKey: sig.metricKey, baseline: Number(exp.baseline.avg.toFixed(2)), steps,
  };
}

async function writeMemory(worldId, sig, content) {
  try {
    await require('../memory/memoryService').write({
      worldId: String(worldId), scope: 'world', kind: 'decision', source: 'planner',
      subject_id: 'optimize:' + sig.regionKey, importance: 3,
      tags: ['optimize', String(sig.rule).toLowerCase()],
      content: '优化规则 ' + sig.rule + ' @' + sig.regionKey + '：' + content,
    });
  } catch (e) { /* 记忆失败不阻断优化 */ }
}

/** LLM 解读（可选增强，默认关；**只写 memory，绝不拦截执行**，§12.2「LLM 只是解释与选择」） */
async function llmInterpret(worldId, signals) {
  try {
    const llmClient = require('../../services/llmClient');
    const promptBuilder = require('../llm/promptBuilder');
    const cfg = await worldAiConfig.getConfig(worldId);
    const list = signals.map((s) => '- ' + s.rule + ' @' + s.regionKey + '：' + s.reason).join('\n');
    const built = promptBuilder.build({
      purpose: 'summary',
      ctx: {
        world: { name: '（优化轮信号解释）', stats: {} },
        task: { prompt: '以下是优化规则的确定性命中信号。请用中文简要解释每条「为什么出现」，并给一句建议。只解释，不下单。\n' + list },
        memories: [], parts: [], tools: [], allowedTools: [], history: [],
        contextWindowTokens: cfg ? cfg.context_window_tokens : null,
      },
    });
    const r = await llmClient.chat({
      providerId: cfg ? cfg.provider_id : null, model: cfg ? cfg.model : null,
      purpose: 'summary', caller: 'world_ai:optimizer', messages: built.messages,
    });
    if (r && r.ok && r.content) {
      await require('../memory/memoryService').write({
        worldId: String(worldId), scope: 'world', kind: 'metric_digest', source: 'planner',
        subject_id: 'optimize', importance: 2, content: String(r.content).slice(0, 2000),
      });
      return { ok: true, interpreted: true };
    }
    return { ok: false, interpreted: false, reason: 'LLM 未返回内容（不拦截执行）' };
  } catch (e) {
    return { ok: false, interpreted: false, reason: String(e && e.message).slice(0, 200) };
  }
}

/**
 * 一轮优化（tick_optimize 调用）：
 *   ①到期的 A/B 实验先判定 → ②5 条规则探测信号 → ③按 maxActionsPerCycle 动手 → ④（可选）LLM 解读。
 * 熔断计数：本轮抛异常记一次失败（连续 3 轮 → error + enabled=false，P6-3）。
 */
async function runOptimizeCycle(worldId, opts) {
  const o = opts || {};
  const cfgP = await params(worldId);
  const out = { ok: true, rule_hits: [], applied: [], skipped: [], evaluated: null, llmInterpret: null };
  try {
    out.evaluated = await experiment.evaluateDue(worldId, o.forceEvaluate ? { force: true } : {});
    const signals = await detectSignals(worldId, cfgP);
    out.rule_hits = signals.map((s) => ({
      rule: s.rule, regionKey: s.regionKey, reason: s.reason, candidates: s.candidates.length, approvalOnly: !!s.approvalOnly,
    }));
    let acted = 0;
    for (const sig of signals) {
      if (acted >= cfgP.maxActionsPerCycle) {
        out.skipped.push({ rule: sig.rule, regionKey: sig.regionKey, code: 'CYCLE_BUDGET',
          reason: '本轮动手预算已用完（maxActionsPerCycle=' + cfgP.maxActionsPerCycle + '），下一轮继续' });
        continue;
      }
      const r = await applySignal(worldId, sig);
      if (r.skipped) out.skipped.push(r);
      else { out.applied.push(r); acted += 1; }
    }
    if (cfgP.llmInterpret && signals.length) out.llmInterpret = await llmInterpret(worldId, signals);
    return out;
  } catch (e) {
    await require('../runtime/circuitBreaker').record(worldId, { ok: false, kind: 'optimize', reason: e && e.message });
    return { ok: false, code: 'OPTIMIZE_FAILED', reason: String(e && e.message).slice(0, 300), applied: out.applied, skipped: out.skipped };
  } finally {
    if (out.ok) await require('../runtime/circuitBreaker').record(worldId, { ok: true, kind: 'optimize' });
  }
}

module.exports = {
  RULES, DEFAULTS, params, loadRegions, detectSignals, applySignal,
  runOptimizeCycle, llmInterpret, ruleR1, ruleR2, ruleR3, ruleR4, ruleR5,
};