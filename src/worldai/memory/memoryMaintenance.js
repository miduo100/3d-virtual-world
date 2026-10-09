/**
 * memoryMaintenance —— world_memories 压缩/遗忘定时（AI World Brain · Phase 5 · Phase 4 遗留②）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 三件事（§C.5 口径：30 天 ~1500 条，封顶 5000）：
 *   ① 遗忘：删除 expires_at 已过期的记忆；
 *   ② 压缩：同 (scope, subject_id, kind) 只保留最新一条（去重压缩，结构化召回口径不变）；
 *   ③ 封顶：总量 > 5000 时删最旧最低重要度，压回 5000。
 * 调度：setTimeout 链 + .unref()（项目铁律：禁 setInterval），默认每 6 小时一轮；
 *       每轮 try/catch 静默（维护任务绝不影响主流程），审计走 logger.audit。
 */
'use strict';

const { query } = require('../../database/db');

const CAP = 5000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let _timer = null;
let _running = false;

/** 单轮维护；返回 {ok, expired, deduped, capped} */
async function runOnce() {
  if (_running) return { ok: false, code: 'RUN_IN_PROGRESS' };
  _running = true;
  try {
    const exp = await query(`DELETE FROM world_memories WHERE expires_at IS NOT NULL AND expires_at < NOW()`);
    const dedup = await query(
      `DELETE FROM world_memories m
         USING world_memories newer
        WHERE m.scope = newer.scope AND m.subject_id IS NOT DISTINCT FROM newer.subject_id
          AND m.kind = newer.kind AND m.id <> newer.id
          AND (newer.created_at, newer.id) > (m.created_at, m.id)`
    );
    const cnt = await query(`SELECT count(*)::int AS n FROM world_memories`);
    let capped = 0;
    const total = cnt.rows[0].n;
    if (total > CAP) {
      const del = await query(
        `DELETE FROM world_memories WHERE id IN (
            SELECT id FROM world_memories ORDER BY importance ASC, created_at ASC OFFSET $1)`,
        [CAP]
      );
      capped = del.rowCount || 0;
    }
    const out = { ok: true, expired: exp.rowCount || 0, deduped: dedup.rowCount || 0, capped, total: total - capped };
    try { require('../../services/logger').audit('world_ai_memory_maintenance', out); } catch (e) { /* logger 不在也不阻断 */ }
    return out;
  } catch (e) {
    console.warn('[memoryMaintenance] 维护轮失败（不影响主流程）:', e.message);
    return { ok: false, code: 'MAINTENANCE_FAILED', reason: String(e && e.message).slice(0, 200) };
  } finally {
    _running = false;
  }
}

/** 启动定时链（worldAiRuntime.init() 接线；unref 不阻止进程退出） */
function startLoop(intervalMs) {
  if (_timer) return;
  const iv = Math.max(10 * 60 * 1000, Math.floor(Number(intervalMs) || DEFAULT_INTERVAL_MS));
  const schedule = () => {
    _timer = setTimeout(async () => {
      _timer = null;
      try { await runOnce(); } catch (e) { /* 已在 runOnce 内吞 */ }
      schedule();
    }, iv);
    if (_timer.unref) _timer.unref();
  };
  schedule();
  // 启动即先跑一轮（进程刚起，表通常很小，代价可忽略）
  runOnce().catch(() => {});
}

function stopLoop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

module.exports = { runOnce, startLoop, stopLoop, CAP };
