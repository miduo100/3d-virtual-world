/**
 * agentMaintenanceService.js —— AI 接入数据维护循环（2026-09-23）
 *
 * 背景（本地 AI 访客体检发现）：三个清理函数**写好了但全项目零调用**（只在各自文件里定义+导出）：
 *   · agentSessionManager.cleanupExpiredSessions          → agent_sessions（会期行）
 *   · agentTransientSessionManager.cleanupExpiredTransientSessions
 *                                                         → agent_transient_sessions（游客票每次签票 1 行）
 *   · agentTeleportService.cleanupExpiredNonces           → token_usage（联邦传送 nonce）
 * 表现为"表只增不减"：本地实测 agent_sessions 478 行（478 已过期）、agent_transient_sessions 796 行。
 * 三个函数都是"过期后再留 7 天供审计"的保留策略，所以不会删掉仍有审计价值的行。
 *
 * 设计：
 *   · 启动后延迟 5 分钟跑首次（避开启动期 DB/迁移），之后每 24h 一次；
 *   · 三个清理**互相独立**，任一失败只告警不影响其它，也不影响主服务；
 *   · **惰性 require**：避免与 routes/federation、database/db 之间形成加载期循环依赖；
 *   · 提供 runOnce() 供验收脚本/运维手动触发（`node -e "require(...).runOnce('manual')"`）。
 *
 * 红线：不触碰 wsServer.js / federation.js 等黑名单文件；不改变任何对外行为，只做数据回收。
 */

const logger = require('../services/logger');

const FIRST_DELAY_MS = 5 * 60 * 1000;      // 启动后 5 分钟
const INTERVAL_MS = 24 * 60 * 60 * 1000;   // 每 24 小时

let timer = null;
let started = false;

/**
 * 执行一轮清理。
 * @param {string} reason 触发原因（startup_5min / daily / manual），仅用于日志
 * @returns {Promise<{sessions:number|null, transient:number|null, nonces:number|null}>}
 */
async function runOnce(reason) {
  const result = { sessions: null, transient: null, nonces: null };

  // ① 普通 Agent 会话行（过期 7 天后清）
  try {
    const m = require('./agentSessionManager');
    const n = await m.cleanupExpiredSessions();
    result.sessions = Number(n) || 0;
  } catch (e) {
    logger.ops('AI 维护：会话清理失败', { reason, error: e.message });
  }

  // ② 游客/跨世界临时会话行
  try {
    const m = require('./agentTransientSessionManager');
    const n = await m.cleanupExpiredTransientSessions();
    result.transient = Number(n) || 0;
  } catch (e) {
    logger.ops('AI 维护：临时会话清理失败', { reason, error: e.message });
  }

  // ③ 联邦传送 nonce（一次性消费记录）
  try {
    const m = require('./agentTeleportService');
    const n = await m.cleanupExpiredNonces();
    result.nonces = Number(n) || 0;
  } catch (e) {
    logger.ops('AI 维护：nonce 清理失败', { reason, error: e.message });
  }

  const total = (result.sessions || 0) + (result.transient || 0) + (result.nonces || 0);
  logger.ops('AI 维护：清理完成', { reason, ...result, total });
  if (total > 0) {
    console.log(`[AgentMaintenance] (${reason}) 清理 sessions=${result.sessions} transient=${result.transient} nonces=${result.nonces}`);
  }
  return result;
}

/** 启动维护循环（幂等；由 server.js 在 WebSocket 与归档循环之后调用） */
function startMaintenanceLoop() {
  if (started) return;
  started = true;

  setTimeout(() => {
    runOnce('startup_5min').catch((e) => logger.ops('AI 维护：首轮异常', { error: e.message }));
    timer = setInterval(() => {
      runOnce('daily').catch((e) => logger.ops('AI 维护：每日轮异常', { error: e.message }));
    }, INTERVAL_MS);
    if (timer.unref) timer.unref();      // 不阻止进程退出
  }, FIRST_DELAY_MS).unref();

  console.log('[AgentMaintenance] AI 数据维护循环已启动（首轮 5 分钟后，此后每 24h）');
}

function stopMaintenanceLoop() {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

module.exports = { startMaintenanceLoop, stopMaintenanceLoop, runOnce, FIRST_DELAY_MS, INTERVAL_MS };
