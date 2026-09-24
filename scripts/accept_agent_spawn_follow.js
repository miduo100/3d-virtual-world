/**
 * accept_agent_spawn_follow.js —— 「出生点改到哪里，AI 就跟到哪里」的验收（2026-09-22 新增）
 *
 * 需求（用户明确）：AI 的出生点必须与**真人**完全一致，而且出生点会变 ——
 * 后台把出生点改到哪里，AI 就要跟到哪里，**不能有缓存延迟**。
 *
 * 实现侧对应的两个约束：
 *   ① `agentSessionManager.getWorldSpawnPoint()` **不做缓存**（每次都查 DB）——
 *      真人前端是每次进世界都请求 `GET /api/world/spawn-point`（public/js/world.js），
 *      AI 只在新建连接时读一次，频率极低，直接查库即可保证同频。
 *   ② 配置缺失时的默认值必须与真人一致：`{x:0, y:0.05, z:0}`
 *      （真人侧两处默认值：world.js 的 spawnConfig 初值 + routes/world.js 的 GET /spawn-point 兜底）。
 *
 * 判据：
 *   S1 新连接的 spawn 落在**当前**世界出生点 ≤3.01m 内（含 ≤3m 随机偏移）
 *   S2 后台把出生点改到别处后，**不等待任何缓存**，新连接的 spawn 立刻落到**新**位置
 *   S3 恢复出生点后，新连接的 spawn 回到原位置
 *   S4 全程结束后出生点配置**必须是原值**（脚本 finally 双保险恢复）
 *
 * ⚠️ 本脚本会**临时修改** `system_config.world_spawn_point`（S2 需要），
 *    但会在 finally 里无条件恢复；如果它中途被强杀，请手工核对：
 *    SELECT config_value FROM system_config WHERE config_key='world_spawn_point';
 *
 * 用法：node scripts/accept_agent_spawn_follow.js
 */
const { query } = require('../src/database/db');
const kit = require('./agentV2TestKit');
const mcp = require('./mcpTestKit');
const { httpJson, guestTicket, openAgentWs, sleep } = kit;

const R = kit.createReporter('出生点跟随验收（改到哪里跟到哪里）');
const KEY = 'world_spawn_point';
const IPS = ['203.0.113.101', '203.0.113.102', '203.0.113.103'];

/** 新开一次游客连接，取 READY.spawn（用完即关；每个 IP 只连一次，避开游客每 IP 1 连接闸） */
async function spawnOf(ip) {
  const t = await guestTicket(ip);
  if (!t.ticket) return { err: `签票失败 ${t.status}` };
  const c = await openAgentWs({ token: t.ticket.token, ip });
  if (!c.ok) return { err: `WS 失败 ${JSON.stringify({ statusCode: c.statusCode, error: c.error })}` };
  await sleep(1300);
  const ready = c.msgs.find(m => m.type === 'READY');
  const spawn = ready && ready.payload && ready.payload.spawn;
  try { c.ws.close(); } catch (e) { /* ignore */ }
  return { spawn };
}

const d = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.z - b.z, 2));

(async () => {
  // 前置：总闸（收尾恢复运行前值）
  const before = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
  const wasEnabled = before.json ? before.json.agentEnabled : null;
  if (wasEnabled !== true) {
    const token = await mcp.adminToken();
    if (!token) { R.check('前置：取管理员 token 以开闸', false, 'adminToken 取不到'); return finish(); }
    await mcp.setAgentEnabled(token, true);
    for (let i = 0; i < 20; i++) {
      const r = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
      if (r.json && r.json.agentEnabled === true) break;
      await sleep(400);
    }
  }
  R.check('前置：agent_enabled 已开', (await httpJson('/.well-known/virtual-world-agent.json')).json.agentEnabled === true);

  const origRow = await query(`SELECT config_value FROM system_config WHERE config_key = $1`, [KEY]);
  const original = origRow.rows.length ? origRow.rows[0].config_value : null;
  const origObj = typeof original === 'string' ? JSON.parse(original) : original;
  const origPos = origObj && origObj.position;
  R.info('原出生点配置', JSON.stringify(origPos));
  if (!origPos) { R.check('前置：能读到世界出生点配置', false, JSON.stringify(original)); return finish(); }

  try {
    // S1 跟随"原"出生点
    const a = await spawnOf(IPS[0]);
    R.check('S1 新连接 spawn 落在当前世界出生点 ≤3.01m 内',
      !!a.spawn && d(a.spawn, origPos) <= 3.01,
      `spawn=${JSON.stringify(a.spawn)} 距原点=${a.spawn ? d(a.spawn, origPos).toFixed(2) : '?'}m ${a.err || ''}`);

    // S2 改出生点 → 不等待任何缓存，立刻再连
    const moved = JSON.parse(JSON.stringify(origObj));
    moved.position = { x: 120.5, y: 2, z: -80.25 };
    await query(`UPDATE system_config SET config_value = $1 WHERE config_key = $2`, [JSON.stringify(moved), KEY]);
    const b = await spawnOf(IPS[1]);
    R.check('S2 出生点改到别处后，新连接立刻跟随（无缓存延迟）',
      !!b.spawn && d(b.spawn, moved.position) <= 3.01,
      `改到 ${JSON.stringify(moved.position)}，spawn=${JSON.stringify(b.spawn)} 距新点=${b.spawn ? d(b.spawn, moved.position).toFixed(2) : '?'}m ${b.err || ''}`);
  } finally {
    // S3 + S4：恢复原值（双保险）
    if (original != null) {
      await query(`UPDATE system_config SET config_value = $1 WHERE config_key = $2`, [original, KEY]);
    }
    const c = await spawnOf(IPS[2]);
    R.check('S3 恢复出生点后，新连接回到原位置',
      !!c.spawn && d(c.spawn, origPos) <= 3.01,
      `spawn=${JSON.stringify(c.spawn)} 距原点=${c.spawn ? d(c.spawn, origPos).toFixed(2) : '?'}m ${c.err || ''}`);

    const check = await query(`SELECT config_value FROM system_config WHERE config_key = $1`, [KEY]);
    const now = JSON.stringify(check.rows.length ? check.rows[0].config_value : null);
    R.check('S4 出生点配置已恢复为原值（脚本不改变世界状态）',
      now === JSON.stringify(original), `now=${now.slice(0, 120)}`);
  }
  return finish();

  async function finish() {
    if (wasEnabled !== true) {
      const token = await mcp.adminToken();
      if (token) await mcp.setAgentEnabled(token, wasEnabled === true);
    }
    R.info('收尾：agent_enabled 已恢复运行前值', String(wasEnabled === true));
    const s = R.summary();
    process.exit(s.fail > 0 ? 1 : 0);
  }
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
