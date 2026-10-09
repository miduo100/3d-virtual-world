/**
 * circuitBreaker —— 熔断 + 崩溃恢复全量口径（AI World Brain · Phase 7 · 判据 P6-3 / P6-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 从 2b 的 worldAiRuntime 内联逻辑抽出并**扩展**两件事：
 *
 * ① 熔断（§H.7）：连续 3 轮异常 → runtime_state='error' + enabled=false + last_error + 审计。
 *   **Phase 7 扩展**：计数不再只挂 missionRunner 轮，optimize 轮也计入（同一计数器）。
 *   口径不变：成功一轮清零；restart 清计数但 Start 闸照走（enabled=false 仍拒，熔断永不静默复活）。
 *
 * ② 崩溃恢复（§I.2 全量口径，2b 只做到 mission 级）：
 *   进程重启后若 runtime_state='running'（上一进程遗留）：
 *     a) `world_plan_steps.status='executing'` → 判 failed(error='interrupted_by_restart')；
 *     b) 其 execution_id 若仍 'executing' → **有 undo 载荷走 toolJournal.rollback**，
 *        无 undo 载荷（新建类执行中断在记账之后）→ 判 failed 并记明原因（绝不假装回滚成功）；
 *     c) **plan 不中断**：plan 保持 executing，剩余 pending step 由下一轮 planRunner 继续推进；
 *     d) 孤儿 running 建设委托维持 2b 口径（failed + executed_stats.error）。
 *   幂等：只有从 DB 读到 running 才动作；error/paused/stopped 一律不动。
 */
'use strict';

const { query } = require('../../database/db');
const logger = require('../../services/logger');

const BREAKER_THRESHOLD = 3;      // §H.7 默认参数

// 连续失败计数在内存（与 2b 口径一致：重启即清；trip 状态落 DB 不会静默复活）
let _consecutive = 0;

/** 记一轮成败（委托轮 / 优化轮共用）；返回 {consecutive, tripped} */
async function record(worldId, o) {
  const p = o || {};
  if (p.ok) {
    _consecutive = 0;
    return { ok: true, consecutive: 0, tripped: false };
  }
  _consecutive += 1;
  const reason = String(p.reason || 'unknown').slice(0, 200);
  try {
    logger.audit('world_ai_round_failed', {
      worldId: String(worldId), kind: p.kind || 'unknown', consecutive: _consecutive, reason,
    });
  } catch (e) { /* logger 不在也不阻断 */ }
  if (_consecutive >= BREAKER_THRESHOLD) {
    await trip(worldId, reason);
    return { ok: false, consecutive: _consecutive, tripped: true };
  }
  return { ok: false, consecutive: _consecutive, tripped: false };
}

/** 熔断（§H.7）：error + 关总闸 + last_error + 审计；状态与关闸都落 DB，重启不会悄悄复活 */
async function trip(worldId, reason) {
  const msg = ('连续 ' + BREAKER_THRESHOLD + ' 轮异常，已熔断：' + String(reason).slice(0, 260)).slice(0, 500);
  await query(
    `UPDATE world_ai_configs
        SET runtime_state = 'error', enabled = false, last_error = $2, updated_at = now()
      WHERE world_id = $1`,
    [String(worldId), msg]
  );
  try {
    logger.audit('world_ai_runtime_breaker_tripped', { worldId: String(worldId), consecutive: _consecutive, reason: String(reason).slice(0, 200) });
  } catch (e) { /* 审计失败不阻断 */ }
  console.warn('[circuitBreaker] 熔断触发：', String(reason).slice(0, 120));
  return { ok: true, tripped: true, lastError: msg };
}

/** 重启清零（§I.2 Restart：清内存态，但 Start 闸门照走） */
function reset() { _consecutive = 0; return { ok: true }; }

function peek() { return _consecutive; }

/**
 * 崩溃恢复的 plan 部分（§I.2 ①②③）：executing step 判 failed + execution 回滚 + plan 继续。
 * 单独导出，便于验收脚本直接测（不必连带 mission 表）。
 * @returns {{ok, steps:[], rolledBack:[], failedExecutions:[], plans:[]}}
 */
async function recoverPlans(worldId) {
  const out = { ok: true, steps: [], rolledBack: [], failedExecutions: [], plans: [] };
  const rows = (await query(
    `SELECT s.id, s.plan_id, s.execution_id, s.tool_name
       FROM world_plan_steps s JOIN world_plans p ON p.id = s.plan_id
      WHERE p.world_id = $1 AND s.status = 'executing'
      ORDER BY s.updated_at ASC`, [String(worldId)]
  )).rows || [];
  if (!rows.length) return out;

  const toolJournal = require('../journal/toolJournal');
  for (const s of rows) {
    // ① executing step 判 failed（interrupted_by_restart）
    await query(
      `UPDATE world_plan_steps
          SET status='failed', error='interrupted_by_restart', finished_at=NOW(), updated_at=NOW()
        WHERE id = $1 AND status = 'executing'`, [s.id]);
    out.steps.push(String(s.id));
    if (out.plans.indexOf(String(s.plan_id)) < 0) out.plans.push(String(s.plan_id));
    if (!s.execution_id) continue;
    // ② execution：仍 executing 才处理；优先真回滚，无 undo 载荷则诚实判 failed
    const exec = await toolJournal.findById(s.execution_id);
    if (!exec || exec.status !== 'executing') continue;
    if (exec.undoable === true && exec.undo_payload) {
      const rb = await toolJournal.rollback(exec.id, 'crash_recovery', { allowExecuting: true });
      if (rb.ok) { out.rolledBack.push({ executionId: String(exec.id), undoKind: rb.undoKind }); continue; }
      await toolJournal.finishFail(exec.id, 'interrupted_by_restart（回滚失败：' + String(rb.reason || rb.code).slice(0, 200) + '）', 0);
      out.failedExecutions.push({ executionId: String(exec.id), code: rb.code || 'ROLLBACK_FAILED' });
    } else {
      // 新建类执行中断在 after/undo 记账之前：无逆操作可放，如实判 failed（绝不假装回滚成功）
      await toolJournal.finishFail(exec.id, 'interrupted_by_restart（新建类执行无 undo 载荷，仅判失败不假装回滚）', 0);
      out.failedExecutions.push({ executionId: String(exec.id), code: 'NO_UNDO_PAYLOAD' });
    }
  }
  // ③ plan 不中断：progress 记恢复痕迹，状态保持 executing（剩余 pending step 下一轮继续）
  for (const planId of out.plans) {
    await query(
      `UPDATE world_plans
          SET progress = COALESCE(progress,'{}'::jsonb) || jsonb_build_object('recoveredAt', to_jsonb(NOW()::text)),
              updated_at = NOW()
        WHERE id = $1 AND status = 'executing'`,
      [planId]
    );
  }
  try {
    await require('../memory/memoryService').write({
      worldId: String(worldId), scope: 'world', kind: 'lesson', source: 'planner',
      subject_id: 'crash_recovery', importance: 4,
      content: '崩溃恢复：' + out.steps.length + ' 个 executing step 判 failed（interrupted_by_restart），'
        + out.rolledBack.length + ' 个 execution 已回滚，' + out.failedExecutions.length + ' 个无 undo 载荷仅判失败；plan 继续。',
    });
  } catch (e) { /* 记忆写入失败不阻断恢复 */ }
  try {
    logger.audit('world_ai_crash_recovered', {
      worldId: String(worldId), steps: out.steps.length, rolledBack: out.rolledBack.length, failed: out.failedExecutions.length,
    });
  } catch (e) { /* 审计失败不阻断 */ }
  return out;
}

module.exports = { BREAKER_THRESHOLD, record, trip, reset, peek, recoverPlans };