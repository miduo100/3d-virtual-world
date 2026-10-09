/**
 * experiment —— A/B 实验与冷却（AI World Brain · Phase 7 · 分册 §12.3 · 判据 P6-4/5/7/8）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 参数（§12.3 原文，全部落库而不是内存 —— §H.10.5「重启安全」同纪律）：
 *   baseline 7 天 / 实验 3 天 / 同区域冷却 7 天 / 提升 ≥10% 固化 / ≤-10% 自动回滚 / ±10% 继续观察。
 *   样本不足 → 判「无结论」保持原状（宁可不做，不做错）。
 *
 * ★ 三条纪律：
 *   1) **回滚只走 toolJournal.rollback**（重放 change_steps 里每条 execution 的 undo 载荷），
 *      绝不手写逆 SQL（§3.4）；无 undo 载荷的执行如实记失败，不假装回滚。
 *   2) **冷却落库**：同区域 7 天内任何状态的历史行都占冷却（含 inconclusive —— 否则
 *      「样本不足 → 保持原状」会被无限重试刷屏）。
 *   3) **指标只从 world_metrics_daily 读**（§H.6 聚合优先，不扫原始事件轨迹）。
 */
'use strict';

const { query } = require('../../database/db');
const worldAiConfig = require('../config');

const DEFAULTS = {
  baselineDays: 7,
  experimentDays: 3,
  cooldownDays: 7,
  minSamples: 5,      // 样本不足 → inconclusive（§12.3「访问 < N」）
  improvePct: 10,     // ≥ +10% 固化
  worsenPct: -10,     // ≤ -10% 自动回滚
};

/** 参数读 configs.schedule.experiment（缺项回落 DEFAULTS；后台可调） */
async function params(worldId) {
  try {
    const cfg = await worldAiConfig.getConfig(worldId);
    const sched = (cfg && typeof cfg.schedule === 'object' && cfg.schedule) ? cfg.schedule : {};
    const raw = (sched.experiment && typeof sched.experiment === 'object') ? sched.experiment : {};
    const out = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function dayStr(d) { return new Date(d).toISOString().slice(0, 10); }

/**
 * 取某区域某指标的日序列（区域行 region_id = world_regions.id 的 UUID；
 * regionId 传 null 时取全局哨兵行）。
 */
async function metricSeries(worldId, regionId, metricKey, fromDay, toDay) {
  const gid = '00000000-0000-0000-0000-000000000000';
  const r = await query(
    `SELECT day, metric_value FROM world_metrics_daily
      WHERE world_id=$1 AND region_id=$2::uuid AND metric_key=$3
        AND day >= $4::date AND day <= $5::date
      ORDER BY day ASC`,
    [String(worldId), regionId || gid, String(metricKey), String(fromDay), String(toDay)]
  );
  const rows = (r.rows || []).map((x) => ({ day: dayStr(x.day), value: Number(x.metric_value) || 0 }));
  const sum = rows.reduce((s, x) => s + x.value, 0);
  return { rows, sum, avg: rows.length ? sum / rows.length : 0, days: rows.length };
}

/** 冷却检查：同区域 cooldownDays 内是否已有实验（任何状态都占冷却） */
async function cooldownHit(worldId, regionKey, days) {
  const r = await query(
    `SELECT id, status, created_at FROM world_ai_experiments
      WHERE world_id=$1 AND region_key=$2 AND created_at > NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY created_at DESC LIMIT 1`,
    [String(worldId), String(regionKey), Math.max(1, Number(days) || DEFAULTS.cooldownDays)]
  );
  return r.rows && r.rows.length ? r.rows[0] : null;
}

/**
 * 开一个实验（先过冷却）：baseline 值在此刻算定并落库（之后基线不随时间漂移，可复算）。
 * @param {object} o { worldId, regionKey, regionId, rule, metricKey, hypothesis, changeSteps }
 */
async function start(o) {
  const p = o || {};
  if (!p.worldId || !p.regionKey) return { ok: false, code: 'PARAMS_REQUIRED', reason: '必须给 worldId 与 regionKey' };
  const cfgP = await params(p.worldId);
  const hit = await cooldownHit(p.worldId, p.regionKey, cfgP.cooldownDays);
  if (hit) {
    return {
      ok: false, code: 'COOLDOWN_ACTIVE',
      reason: '区域 ' + p.regionKey + ' 在 ' + cfgP.cooldownDays + ' 天冷却期内已有实验（'
        + hit.status + '，' + String(hit.created_at).slice(0, 10) + '）—— 防止震荡（§12.3）',
      existing: { id: String(hit.id), status: hit.status },
    };
  }
  const now = Date.now();
  const from = dayStr(now - cfgP.baselineDays * 86400000);
  const base = await metricSeries(p.worldId, p.regionId, p.metricKey || 'visits', from, dayStr(now - 86400000));
  const ins = await query(
    `INSERT INTO world_ai_experiments
       (world_id, region_key, region_id, rule, hypothesis, metric_key, status, baseline_value, sample_n,
        change_steps, baseline_days, experiment_days, cooldown_until)
     VALUES ($1,$2,$3::uuid,$4,$5,$6,'experimenting',$7,$8,$9::jsonb,$10,$11, NOW() + ($12::int * INTERVAL '1 day'))
     RETURNING *`,
    [String(p.worldId), String(p.regionKey), p.regionId ? String(p.regionId) : null, String(p.rule || 'R0'),
      String(p.hypothesis || '').slice(0, 500), String(p.metricKey || 'visits'),
      base.avg, base.sum, JSON.stringify(Array.isArray(p.changeSteps) ? p.changeSteps : []),
      cfgP.baselineDays, cfgP.experimentDays, cfgP.cooldownDays]
  );
  return { ok: true, experiment: ins.rows[0], baseline: base, params: cfgP };
}

/** 把执行结果登记为「变更 step」（executor 返回 {ok, executionId, result}） */
function toChangeStep(tool, paramsObj, execResult) {
  return {
    executionId: execResult && execResult.executionId ? String(execResult.executionId) : null,
    tool: String(tool),
    params: paramsObj || {},
    ok: !!(execResult && execResult.ok),
  };
}

/** 回滚一组变更 step（逐条走 toolJournal.rollback；失败如实记账不吞） */
async function rollbackSteps(steps) {
  const toolJournal = require('../journal/toolJournal');
  const out = { attempted: 0, rolledBack: [], failed: [] };
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || !s.executionId) continue;
    out.attempted += 1;
    const r = await toolJournal.rollback(s.executionId, 'ab_worsened');
    if (r.ok) out.rolledBack.push({ executionId: s.executionId, tool: s.tool, undoKind: r.undoKind });
    else out.failed.push({ executionId: s.executionId, tool: s.tool, code: r.code, reason: String(r.reason || '').slice(0, 200) });
  }
  return out;
}

async function decide(row, status, vals, note) {
  const r = await query(
    `UPDATE world_ai_experiments
        SET status=$2::varchar, experiment_value=$3, sample_n=$4, delta_pct=$5,
            verdict_note=$6, decided_at=NOW(), updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [row.id, status,
      vals.experimentValue === undefined ? null : Number(vals.experimentValue),
      Math.max(0, Math.floor(Number(vals.sampleN) || 0)),
      vals.deltaPct === null ? null : Number(vals.deltaPct),
      String(note).slice(0, 800)]
  );
  return r.rows[0] || row;
}

async function writeMemory(row, content) {
  try {
    await require('../memory/memoryService').write({
      worldId: String(row.world_id), scope: 'world', kind: 'lesson', source: 'planner',
      subject_id: 'ab:' + String(row.region_key), importance: 4,
      tags: ['optimize', String(row.rule).toLowerCase()],
      content: 'A/B ' + row.rule + ' @' + row.region_key + '：' + content,
    });
  } catch (e) { /* 记忆失败不阻断判定 */ }
}

/**
 * 判定单个实验（§12.3 三档判定 + 样本不足档）。
 * @param {object} row world_ai_experiments 行
 * @param {object} opts { force?:boolean } force=true 时无视实验窗口直接判（验收 / 演练口径）
 */
async function evaluateOne(row, opts) {
  const o = opts || {};
  const cfgP = await params(row.world_id);
  if (row.status !== 'experimenting') return { ok: true, skipped: true, reason: 'status=' + row.status };
  const startedAt = new Date(row.created_at).getTime();
  const elapsedDays = (Date.now() - startedAt) / 86400000;
  if (!o.force && elapsedDays < cfgP.experimentDays) {
    return { ok: true, skipped: true, reason: '实验窗口未满（' + elapsedDays.toFixed(1) + '/' + cfgP.experimentDays + ' 天）' };
  }
  // 实验窗口 = [created_at, now]
  const cur = await metricSeries(row.world_id, row.region_id, row.metric_key, dayStr(startedAt), dayStr(Date.now()));
  const sample = cur.sum;
  const baseline = Number(row.baseline_value) || 0;

  // ① 样本不足 → 无结论，保持原状（既不回滚也不固化）
  if (sample < cfgP.minSamples) {
    const up = await decide(row, 'inconclusive', { experimentValue: cur.avg, sampleN: sample, deltaPct: null },
      '样本不足（访问 ' + sample + ' < ' + cfgP.minSamples + '）→ 判无结论，保持原状（§12.3：宁可不做不做错）');
    return { ok: true, verdict: 'inconclusive', sampleN: sample, baseline, experimentValue: cur.avg, row: up };
  }
  if (baseline <= 0) {
    // ★ 基线为 0 的特殊口径（R1 冷区激活 / R5 引导缺口必然命中"零流量"）：
    //   相对提升无意义，但「从无到有」本身就是确定性改善 —— 样本达标即固化；
    //   样本不达标已在上面判 inconclusive（保持原状）。不做"永远无结论"的死循环。
    const note = '基线为 0（此前无流量），实验窗口访问 ' + sample + ' 次 ≥ ' + cfgP.minSamples
      + ' → 判定为「从无到有」的确定性改善，固化';
    const up = await decide(row, 'solidified', { experimentValue: cur.avg, sampleN: sample, deltaPct: null }, note);
    await writeMemory(row, note);
    return { ok: true, verdict: 'solidified', deltaPct: null, sampleN: sample, baselineZero: true, row: up };
  }
  const deltaPct = ((cur.avg - baseline) / baseline) * 100;
  // ② 改善 ≥ +10% → 固化到记忆
  if (deltaPct >= cfgP.improvePct) {
    const note = '实验窗口内 ' + row.metric_key + ' 提升 ' + deltaPct.toFixed(1) + '%（≥' + cfgP.improvePct + '%）→ 固化';
    const up = await decide(row, 'solidified', { experimentValue: cur.avg, sampleN: sample, deltaPct }, note);
    await writeMemory(row, note);
    return { ok: true, verdict: 'solidified', deltaPct, sampleN: sample, row: up };
  }
  // ③ 恶化 ≤ -10% → 自动回滚（重放 undo，不手写逆 SQL）
  if (deltaPct <= cfgP.worsenPct) {
    const rb = await rollbackSteps(row.change_steps);
    const note = '实验窗口内 ' + row.metric_key + ' 下降 ' + deltaPct.toFixed(1) + '%（≤' + cfgP.worsenPct
      + '%）→ 自动回滚：' + rb.rolledBack.length + '/' + rb.attempted + ' 步已回滚'
      + (rb.failed.length ? '，' + rb.failed.length + ' 步失败（' + rb.failed.map((f) => f.code).join(',') + '）' : '');
    const up = await decide(row, 'rolled_back', { experimentValue: cur.avg, sampleN: sample, deltaPct }, note);
    await writeMemory(row, note);
    return { ok: true, verdict: 'rolled_back', deltaPct, sampleN: sample, rollback: rb, row: up };
  }
  // ④ ±10% 以内 → 保持观察（不下结论，保留回滚能力等下一窗口）
  const up = await decide(row, 'inconclusive', { experimentValue: cur.avg, sampleN: sample, deltaPct },
    '变化 ' + deltaPct.toFixed(1) + '% 落在 ±' + cfgP.improvePct + '% 带内 → 保持观察（不下结论）');
  return { ok: true, verdict: 'inconclusive', deltaPct, sampleN: sample, row: up };
}

/** 判定所有到期的 experimenting 行（optimize tick 调用；单行失败不阻断其他行） */
async function evaluateDue(worldId, opts) {
  const rows = (await query(
    `SELECT * FROM world_ai_experiments
      WHERE world_id=$1 AND status='experimenting' ORDER BY created_at ASC LIMIT 20`, [String(worldId)]
  )).rows || [];
  const out = [];
  for (const row of rows) {
    try {
      out.push({ id: String(row.id), rule: row.rule, regionKey: row.region_key, result: await evaluateOne(row, opts) });
    } catch (e) {
      out.push({ id: String(row.id), rule: row.rule, regionKey: row.region_key, error: String(e && e.message).slice(0, 200) });
    }
  }
  return { ok: true, evaluated: out.length, results: out };
}

async function listByWorld(worldId, limit) {
  const r = await query(
    `SELECT id, region_key, rule, metric_key, status, baseline_value, experiment_value, delta_pct,
            sample_n, verdict_note, created_at, decided_at
       FROM world_ai_experiments WHERE world_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [String(worldId), Math.min(100, Math.max(1, Number(limit) || 20))]
  );
  return r.rows || [];
}

module.exports = {
  DEFAULTS, params, metricSeries, cooldownHit, start, evaluateOne, evaluateDue,
  listByWorld, rollbackSteps, toChangeStep, dayStr,
};