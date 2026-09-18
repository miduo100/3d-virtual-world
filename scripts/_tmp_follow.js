/**
 * _tmp_follow.js — 临时工具：让驻场 Agent 跟随真人（缺陷 C 修复后版本）
 *
 * v4（2026-09-19）：**不再由客户端每秒重发 walk_to**——
 *   只下发一条 `follow{targetId, stopDistance, maxDurationMs}`，由服务端 10Hz 追目标；
 *   本脚本退化为「keeper + 观测器」：每 2s 用 observe 记录距离（证据），
 *   并做**自愈**：若发现跟随实际没生效（距离 >6m 且持续增长）或 follow 已到期，就重新下发一条。
 *   maxDurationMs 上限 10 分钟（服务端限制），故长会话靠这道自愈续期。
 *
 * 用法：AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_... FOLLOW_TARGET_ID=<uuid> \
 *        node scripts/_tmp_follow.js [durationMs] [stopDistance]
 * 停止：创建 examples/agent-client/live/STOP_FOLLOW
 */
const fs = require('fs');
const path = require('path');

const HOST = process.env.AGENT_HOST || 'http://localhost:3002';
const KEY = process.env.AGENT_API_KEY || '';
const TARGET_ID = process.env.FOLLOW_TARGET_ID || '';
const DURATION = parseInt(process.argv[2] || '1800000', 10);
const STOP_DISTANCE = Number(process.argv[3] || 2);
const MAX_FOLLOW_MS = 600000;          // 服务端上限 10 分钟
const REISSUE_AFTER_MS = 9 * 60 * 1000; // 到期前 1 分钟续期

const LIVE = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
const INBOX = path.join(LIVE, 'inbox');
const LOG = path.join(LIVE, 'follow.log');
const STOP = path.join(LIVE, 'STOP_FOLLOW');

if (fs.existsSync(STOP)) fs.unlinkSync(STOP);

let token = null;
let seq = 0;
let lastFollowAt = 0;
const samples = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n', 'utf8'); } catch (e) { /* ignore */ }
}
function send(cmd) {
  const f = path.join(INBOX, `g-${String(++seq).padStart(5, '0')}.json`);
  fs.writeFileSync(f, JSON.stringify(cmd), 'utf8');
}
function issueFollow(why) {
  send({ action: 'follow', targetId: TARGET_ID, stopDistance: STOP_DISTANCE, maxDurationMs: MAX_FOLLOW_MS });
  lastFollowAt = Date.now();
  log(`→ 下发 follow（${why}）targetId=${TARGET_ID} stopDistance=${STOP_DISTANCE} maxDurationMs=${MAX_FOLLOW_MS}`);
}

(async function main() {
  if (!KEY || !TARGET_ID) { log('缺少 AGENT_API_KEY / FOLLOW_TARGET_ID'); process.exit(1); }
  const s = await (await fetch(HOST + '/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}'
  })).json();
  if (!s || !s.token) { log('session 失败: ' + JSON.stringify(s)); process.exit(1); }
  token = s.token;
  log(`follow v4（服务端 follow + keeper）启动 | 时长=${DURATION}ms`);
  await sleep(1500);
  issueFollow('启动');

  const t0 = Date.now();
  let badStreak = 0;
  while (Date.now() - t0 < DURATION) {
    if (fs.existsSync(STOP)) { log('收到停止信号'); break; }
    await sleep(2000);
    try {
      const r = await fetch(`${HOST}/api/agent/v1/observe?radius=300`, { headers: { Authorization: 'Bearer ' + token } });
      if (r.status !== 200) continue;
      const o = await r.json();
      const self = o.self && o.self.position;
      const tgt = (o.entities || []).find((e) => String(e.id) === TARGET_ID);
      if (!self || !tgt) { log('目标或自身不在 observe 半径内'); continue; }
      const dist = Math.hypot(tgt.position.x - self.x, tgt.position.z - self.z);
      samples.push(dist);
      const own = (o.entities || []).find((e) => e.isSelf === true);
      // 自愈：只在「真的停摆」时重发——距离连续 10 次采样（≈20s）都 >6m，
      // 或 follow 快到 10 分钟上限。跟随中短暂落后（真人冲刺）不算停摆，避免无谓 superseded。
      if (dist > 6) badStreak++; else badStreak = 0;
      const stalled = badStreak >= 10;
      const expireSoon = Date.now() - lastFollowAt > REISSUE_AFTER_MS;
      if (stalled || expireSoon) {
        issueFollow(stalled ? `连续 20s 距离 ${dist.toFixed(1)}m（疑似停摆）` : '到期续期');
        badStreak = 0;
      }
      log(`距离=${dist.toFixed(2)}m 我在=(${self.x.toFixed(1)},${self.z.toFixed(1)}) 对方=(${tgt.position.x.toFixed(1)},${tgt.position.z.toFixed(1)}) anim=${own ? own.animMode : '-'}`);
    } catch (e) { log('异常: ' + e.message); }
  }

  if (samples.length) {
    const d = samples.slice().sort((a, b) => a - b);
    log(`统计：样本=${samples.length} min=${d[0].toFixed(2)} p50=${d[Math.floor(d.length / 2)].toFixed(2)} max=${d[d.length - 1].toFixed(2)}`);
  }
  log('follow v4 结束');
})();
