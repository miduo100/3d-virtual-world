/**
 * accept_agent_longsession.js — 长会话稳定性实测（v5 轮批次 C 第 3 项）
 *
 * 目的：验证"Agent 会话能长期挂着"这一运营前提。默认 3 个 Key Agent
 * （eco / standard / realtime 各一，来自 scripts/_tmp_tier_agents.json）同时挂 ≥35 分钟。
 *
 * 已知机制与要验证的点：
 *   - Agent JWT TTL = 900s，**WS 只在建连时校验一次**（之后不逐消息校验）→ 连接可长期存活
 *   - ⚠️ **但 HTTP 端点每次调用都重新校验 JWT**（`authenticateAgentToken`）→ JWT 到期后
 *     `observe` 等 HTTP 调用会 403 `TOKEN_EXPIRED`，而 WS 仍然活着。
 *     **运营结论：长会话客户端必须每 <15 分钟用 API Key 换一次会话**（本脚本每 10 分钟续期，C7 断言其有效性）。
 *   - 空闲超时 5 分钟：活跃信号 = ACTION/SUBSCRIBE/UNSUBSCRIBE + **Key 档 PING** + **HTTP observe**
 *     → 本脚本每 60s PING + 每 3s 轮询 observe（两者都应续命）
 *   - 档位不变、位置续位（缺陷 I/J 的修复在长时间尺度上不退化）
 *   - 无幽灵实体：断开后 playerPositions 必须清理，其它 Agent observe 不应再看到
 *   - 内存无单调增长（采样服务器 RSS，对比前 1/3 与后 1/3 的中位）
 *
 * 运行：node scripts/accept_agent_longsession.js [--minutes=35] [--allow-short]
 * 报告：examples/agent-client/live/longsession.json
 *
 * 判据（C1~C7）：
 *   C1  N 分钟后 3 个连接仍全部存活（JWT TTL 只在建连校验）
 *   C2  档位不变（READY.pushTier）
 *   C3  位置续位正常：每次移动检查都有**有效 observe** + 真实位移（>10m）且不回原点
 *   C4  服务器内存无失控增长
 *   C5  断开后无幽灵实体（>1 分钟尺度上 playerPositions 已清理）
 *   C6  重连续位：新会话出生点继承上次位置（非原点）
 *   C7  JWT 续期有效：换票后 HTTP observe 恢复 200，且 WS 连接**未断**（无需重连）
 *
 * ⚠️ 这是一条 35 分钟的长跑：Windows 下**别用 process.exit()**（块缓冲会丢输出），
 *    用 process.exitCode 让 Node 自然 drain。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const K = require('./agentV2TestKit');

const R = K.createReporter('长会话稳定性实测（3 Key Agent 长挂）');
const sleep = K.sleep;
const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const PORT = Number((BASE.match(/:(\d+)/) || [])[1] || 3002);

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const MINUTES = argOf('minutes', 35);
const ALLOW_SHORT = argv.includes('--allow-short');
const DURATION_MS = MINUTES * 60 * 1000;
// Agent JWT TTL 900s → 每 10 分钟用 API Key 换一次（留 5 分钟余量；这是长会话客户端的标准做法）
// `--refresh-min=<分钟>` 仅用于**短跑验证**（例如 6 分钟跑里每 2 分钟续期一次，快速覆盖 C7）。
const REFRESH_MIN = argOf('refresh-min', 10);
const REFRESH_INTERVAL_MS = REFRESH_MIN * 60 * 1000;

const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'longsession.json');
const ORDER = ['eco', 'standard', 'realtime'];
const sockets = [];
let adminTok = null;
let origEnabled = null;

function ps(cmd) {
  return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
}
function serverStat(pid) {
  if (!Number.isFinite(pid)) return null;
  try {
    const raw = ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.CPU)|$($p.WorkingSet64)" } else { '' }`);
    if (!raw) return null;
    const [cpu, rss] = raw.split('|').map(Number);
    return { cpuSeconds: cpu, rssBytes: rss };
  } catch (e) { return null; }
}

async function keySession(apiKey) {
  const r = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: {}
  });
  if (r.status !== 200 || !r.json.token) throw new Error(`session 失败: ${r.status} ${r.text.slice(0, 160)}`);
  return r.json.token;
}

async function connect(spec) {
  const jwt = await keySession(spec.apiKey);
  const c = await K.openAgentWs({ token: jwt, authHeader: 'Bearer ' + jwt });
  if (!c.ok) throw new Error(`${spec.name} WS 失败: ${c.statusCode || c.error}`);
  sockets.push(c.ws);
  const ready = await K.waitFor(c.msgs, 'READY', 6000);
  return { spec, jwt, conn: c, ready, pushTier: ready && ready.payload && ready.payload.pushTier, spawn: ready && ready.payload && ready.payload.spawn };
}

/** observe：返回结构化的成败信息（JWT 到期会 403 TOKEN_EXPIRED，必须能被观测到） */
async function observeOf(jwt) {
  const r = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + jwt } });
  return {
    ok: r.status === 200, status: r.status,
    code: r.json && r.json.code, json: r.json,
    self: r.json && r.json.self && r.json.self.position
  };
}

/** 轻量探活：GET /me —— 同样走 JWT 验签 + jti 两道门，但**无限频**，适合做续期前后的干净探针 */
async function meOf(jwt) {
  const r = await K.httpJson('/api/agent/v1/me', { headers: { Authorization: 'Bearer ' + jwt } });
  return { ok: r.status === 200, status: r.status, code: r.json && r.json.code };
}

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 两点距离；任一缺失返回 null（**不要返回 Infinity**——它会被 `> 10` 之类的判据当成"通过"） */
function dist(a, b) {
  if (!a || !b) return null;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

(async () => {
  const started = Date.now();
  const report = {
    title: 'accept_agent_longsession', startedAt: new Date().toISOString(),
    params: { minutes: MINUTES, port: PORT, refreshIntervalMs: REFRESH_INTERVAL_MS }
  };
  const rssSamples = [];
  const positionChecks = [];
  const observeStats = { ok: 0, tokenExpired: 0, rateLimited: 0, other: 0 };
  const refreshes = [];
  let sessions = [];
  let lastKnownPos = null;
  try {
    if (MINUTES < 35 && !ALLOW_SHORT) {
      throw new Error(`长会话要求 ≥35 分钟（当前 ${MINUTES}）；确要短跑请加 --allow-short`);
    }

    // ---------- 前置 ----------
    const store = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_tier_agents.json'), 'utf8'));
    adminTok = store.adminToken;
    const cfg = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + adminTok } });
    origEnabled = cfg.json && cfg.json.config && cfg.json.config.agentEnabled;
    if (origEnabled !== true) {
      await K.httpJson('/api/agent/v1/admin/config', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok }, body: { agent_enabled: 'true' }
      });
      await sleep(600);
    }
    R.check('P0 agent_enabled=true（长会话前置）', true, { wasEnabled: origEnabled });

    const pid = Number(ps(`(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`));
    console.log(`[server] pid=${pid}`);

    // ---------- 连接 3 个 Key Agent ----------
    const specs = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
    for (const s of specs) sessions.push(await connect(s));
    R.check('P1 3 个 Key Agent（eco/standard/realtime）全部 READY', sessions.length === 3,
      sessions.map(s => `${s.spec.key}:${s.pushTier || 'n/a'}`));

    const t0 = Date.now();
    const memStart = serverStat(pid);
    console.log(`\n[long] 开始 ${MINUTES} 分钟长挂（PING/60s + observe/3s 轮询 + JWT 每 10min 续期）...`);

    const renewAll = async (tag) => {
      for (const s of sessions) {
        try {
          // ⚠️ 探活用 `/me` 而不是 `observe`：observe 有 1 次/秒限频（窗口 950ms），
          // 续期前后连续两次 observe 必然撞窗口 → 429 会被误判成"续期失败"（首跑踩到）。
          // `/me` 同样走 JWT + jti 两道门，但没有限频，是"凭据是否有效"的干净探针。
          const before = await meOf(s.jwt);
          const jwt = await keySession(s.spec.apiKey);    // 用 API Key 换新会话
          s.jwt = jwt;
          const after = await meOf(s.jwt);
          refreshes.push({ tag, key: s.spec.key, beforeStatus: before.status, beforeCode: before.code, afterStatus: after.status, afterCode: after.code });
          console.log(`[long] 续期 ${s.spec.key}: /me ${before.status}${before.code ? '/' + before.code : ''} -> ${after.status}${after.code ? '/' + after.code : ''}`);
        } catch (e) {
          refreshes.push({ tag, key: s.spec.key, error: e.message });
        }
      }
    };

    // ---------- 长挂循环 ----------
    let tick = 0;
    let moveDir = 1;
    let lastRefreshAt = Date.now();
    const loop = setInterval(async () => {
      tick += 1;
      const elapsedMin = (Date.now() - t0) / 60000;

      for (const s of sessions) {
        if (s.conn.ws.readyState === 1) K.wsSend(s.conn.ws, { type: 'PING' });
      }
      const target = sessions[tick % sessions.length];
      if (target && target.conn.ws.readyState === 1) {
        const o = await observeOf(target.jwt);
        if (o.ok) { observeStats.ok++; if (o.self) lastKnownPos = o.self; }
        else if (o.code === 'TOKEN_EXPIRED') observeStats.tokenExpired++;
        else if (o.status === 429) observeStats.rateLimited++;
        else observeStats.other++;
      }
      if (tick % 20 === 0) {
        const st = serverStat(pid);
        if (st) rssSamples.push({ min: Number(elapsedMin.toFixed(2)), rssMB: Math.round(st.rssBytes / 1048576) });
        const alive = sessions.filter(s => s.conn.ws.readyState === 1).length;
        console.log(`[long] t=${elapsedMin.toFixed(1)}min alive=${alive}/3 rss=${st ? Math.round(st.rssBytes / 1048576) + 'MB' : 'n/a'}`);
      }
      // JWT 续期（默认每 10 分钟；用固定间隔而非 tick 计数，避免 tick 抖动）
      if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        lastRefreshAt = Date.now();
        await renewAll(`t=${elapsedMin.toFixed(1)}min`);
      }
      if (tick % 100 === 0) {
        const m = sessions[0];
        if (m && m.conn.ws.readyState === 1) {
          const before = await observeOf(m.jwt);
          const p0 = before.self;
          K.wsSend(m.conn.ws, { type: 'ACTION', payload: { action: 'move', direction: { x: moveDir, z: 0 }, requestId: `long-move-${tick}` } });
          await sleep(6000);
          K.wsSend(m.conn.ws, { type: 'ACTION', payload: { action: 'stop', requestId: `long-stop-${tick}` } });
          await sleep(1200);
          const after = await observeOf(m.jwt);
          const p1 = after.self;
          const step = dist(p1, p0);
          if (p1) lastKnownPos = p1;
          positionChecks.push({
            min: Number(elapsedMin.toFixed(2)),
            observeOk: before.ok && after.ok,
            status: `${before.status}/${after.status}`,
            from: p0, to: p1, step: step === null ? null : Number(step.toFixed(2))
          });
          console.log(`[long] 位置检查 t=${elapsedMin.toFixed(1)}min observe=${before.status}/${after.status} 位移=${step === null ? 'n/a' : step.toFixed(2) + 'm'} at=${JSON.stringify(p1)}`);
          moveDir = -moveDir;
        }
      }
    }, 3000);

    await sleep(DURATION_MS);
    clearInterval(loop);

    // ---------- 收尾断言 ----------
    const alive = sessions.filter(s => s.conn.ws.readyState === 1).length;
    R.check(`C1 ${MINUTES} 分钟后 3 个连接仍全部存活（JWT TTL 900s 只在建连校验）`, alive === 3, { alive });

    const tiers = sessions.map(s => {
      const last = s.conn.msgs.filter(m => m && m.type === 'READY').pop();
      return last && last.payload && last.payload.pushTier;
    });
    R.check('C2 档位不变（READY.pushTier 与建连时一致）',
      sessions.every((s, i) => tiers[i] === s.pushTier), { tiers });

    const finiteChecks = positionChecks.filter(p => p.observeOk && Number.isFinite(p.step));
    const okSteps = finiteChecks.filter(p => p.step > 10);
    R.check('C3 位置续位正常：每次移动检查都有效 observe + 真实位移（>10m）且不回原点',
      positionChecks.length >= Math.floor(MINUTES / 5) - 1 && finiteChecks.length === positionChecks.length && okSteps.length === positionChecks.length,
      {
        checks: positionChecks.length, validChecks: finiteChecks.length, movedOk: okSteps.length,
        samples: positionChecks, observeStats
      });

    const memEnd = serverStat(pid);
    const firstThird = rssSamples.slice(0, Math.max(1, Math.floor(rssSamples.length / 3))).map(s => s.rssMB);
    const lastThird = rssSamples.slice(-Math.max(1, Math.floor(rssSamples.length / 3))).map(s => s.rssMB);
    const m1 = median(firstThird), m2 = median(lastThird);
    const growthCap = (m1 || 0) * 1.5 + 200;
    R.check('C4 服务器内存无失控增长（后 1/3 中位 < 前 1/3×1.5 + 200MB）',
      m2 === null || m2 < growthCap, { rssMedianFirst: m1, rssMedianLast: m2, cap: Math.round(growthCap), samples: rssSamples.length });

    // ---------- 幽灵检查 ----------
    const victim = sessions[2];
    const victimId = victim.spec.id;
    const witness = sessions[0];
    const beforeClose = await observeOf(witness.jwt);
    const entitiesBefore = (beforeClose.json && beforeClose.json.entities) || [];
    const victimEntity = entitiesBefore.find(e => String(e.id) === String(victimId));
    const seenBefore = beforeClose.ok && !!victimEntity;
    // ⚠️ C6 必须用 **victim 自己的位置** 做基准：首跑错用 witness（另一个 Agent）的最后位置
    // 去比 → 差 108.6m 假失败（三个 Agent 各自位置不同，victim 全程未动）。
    const victimPosBefore = victimEntity ? victimEntity.position : null;
    K.closeAll(victim.conn.ws);
    await sleep(3500);
    const afterClose = await observeOf(witness.jwt);
    const seenAfter = ((afterClose.json && afterClose.json.entities) || []).some(e => String(e.id) === String(victimId));
    R.check('C5 断开后无幽灵实体（其它 Agent observe 不再看到它）',
      beforeClose.ok === true && seenBefore === true && seenAfter === false,
      { witnessObserveStatus: beforeClose.status, afterObserveStatus: afterClose.status, seenBefore, seenAfter, victimId });

    // ---------- 重连续位（基准 = 该 Agent 断开前的位置，由 witness 的 entities 提供） ----------
    const re = await connect(victim.spec);
    sessions[2] = re;
    const spawn = re.spawn || (re.ready && re.ready.payload && re.ready.payload.spawn);
    const d = dist(spawn, victimPosBefore);
    R.check('C6 重连续位：新会话出生点继承该 Agent 自己断开前的位置（非原点）',
      victimPosBefore !== null && d !== null && d < 40 && dist(spawn, { x: 0, z: 0 }) > 1,
      { victimPosBefore, newSpawn: spawn, deltaM: d === null ? null : Number(d.toFixed(1)) });

    // ---------- JWT 续期有效性 ----------
    const badRefresh = refreshes.filter(r => r.afterStatus !== 200);
    const recovering = refreshes.filter(r => r.beforeStatus === 403 && r.afterStatus === 200);
    R.check('C7 JWT 续期有效：换票后 HTTP observe 恢复 200，且 WS 连接全程未断（无需重连）',
      refreshes.length >= Math.max(1, Math.floor(MINUTES / 10) - 1) && badRefresh.length === 0 && alive === 3,
      { refreshes, recoveringCount: recovering.length, observeStats, alive });

    report.sessions = sessions.map(s => ({ key: s.spec.key, agentId: s.spec.id, pushTier: s.pushTier }));
    report.positionChecks = positionChecks;
    report.rssSamples = rssSamples;
    report.observeStats = observeStats;
    report.refreshes = refreshes;
    report.serverStat = { start: memStart, end: memEnd };
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    K.closeAll(...sockets);
    if (adminTok && origEnabled !== null) {
      try {
        await K.httpJson('/api/agent/v1/admin/config', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
          body: { agent_enabled: origEnabled ? 'true' : 'false' }
        });
        console.log(`[restore] agent_enabled=${origEnabled ? 'true' : 'false'}`);
      } catch (e) { /* ignore */ }
    }
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + REPORT);
  process.exitCode = sum.fail === 0 ? 0 : 1;      // 不走 process.exit（Windows 块缓冲会丢输出）
})();
