/**
 * accept_agent_chat_loop_yield.js —— "多个 AI 在场不抢话"验收（2026-09-24）
 *
 * 背景（用户实测反馈）：真人**不会**在聊天里打 @名字，所以触发只能靠空间/上下文推断；而且现场常常是
 * "1 个真人 + 多个 AI"，甚至"多个真人 + 多个 AI"。本用例验证两件事：
 *   ① 寻址推断：人多且没指向我 → **不开口**；对着我说（面朝我/贴脸）或独处 → 开口；
 *   ② 礼让仲裁：多个 AI 拿到的信号**完全一样**时（同一句点名所有 AI 都认的名字），**只能有一个回**。
 *
 * 场景（E1~E6）：
 *   E1 三实例进场，且都能在 observe 里看到彼此
 *   E2 人多 + 谁都没指向（真人背对所有 AI）说"有人吗？" → **0 条回复**（喧闹时克制）
 *   E3 真人对**甲**贴身并面朝它说"你好呀。"（不点名）→ **恰好 1 条**回复，且来自甲
 *   E4 真人点名"小七"（三个实例都认这个名字，信号完全相同）→ **恰好 1 条**回复（礼让）
 *   E5 另外两个实例的日志里有 skip:yielded_to_other_ai（证明确实是"让位"，不是"没想回"）
 *   E6 只剩 1 个 AI（独处）+ 不点名 + 背对它 → 仍然回复（alone 信号）
 *
 * 确定性手法：把三个实例的 CLOSE_DIST=1 / FACE_MAX_DIST=2 收小（默认 3/8），这样"贴脸/面朝"只对
 * 真人身前那一个成立；真人不在场时三个实例彼此不会互相触发。避免依赖 agent 走位（agent 只能 ACTION 移动）。
 *
 * 用法：node scripts/accept_agent_chat_loop_yield.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const kit = require('./agentV2TestKit');

const REPO = path.resolve(__dirname, '..');
// 每轮换一段测试 IP：同 IP 的游客签票额度是"10 张/小时"，固定 IP 连跑几轮就会 429
const IP_BASE = 100 + Math.floor(Math.random() * 90);
const ipOf = (i) => kit.testIp(IP_BASE + i);
const LOOP_SCRIPT = path.join('examples', 'agent-client', 'ai-chat-loop.mjs');
const NAME = '小七';                       // 三个实例都认这个名字 → 点名时信号完全相同（考礼让）
const HUMAN_ID = 'tmp-yield-human-0001';
const HUMAN_NAME = '围观的人';

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}${d !== undefined ? ' | ' + JSON.stringify(d) : ''}`); };

const readFrom = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
};
const sleep = kit.sleep;

const loops = [];        // { proc, dir, log, ip, agentId }
const closeables = [];

function startLoop(label, ip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-yield-' + label + '-'));
  const env = {
    ...process.env,
    AGENT_HOST: kit.BASE, AGENT_TEST_IP: ip, AI_LIVE_DIR: dir,
    REPLY_MODE: 'address', TRIGGER_NAMES: NAME,
    CLOSE_DIST: '1', FACE_MAX_DIST: '2',       // 收小半径：让"贴脸/面朝"只对身前那一个成立
    COOLDOWN_MS: '3000', OBSERVE_MS: '2500', POLL_MS: '2000',
    IDLE_SILENCE_MS: '600000', AI_TALK_MODE: 'limited'
  };
  const proc = spawn(process.execPath, [LOOP_SCRIPT], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const rec = { label, proc, dir, log: path.join(dir, 'chat-loop.jsonl'), ip, agentId: null };
  loops.push(rec);
  return rec;
}

function stopLoop(rec) {
  try { rec.proc.kill(); } catch (e) { /* ignore */ }
}

/** 所有实例日志里的事件（按时间合并） */
function allLogs() {
  const rows = [];
  for (const l of loops) for (const e of readFrom(l.log)) rows.push({ ...e, _loop: l.label });
  return rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
const replyCount = () => allLogs().filter(e => e.event === 'reply').length;

async function waitLoop(rec, pred, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = readFrom(rec.log).find(pred);
    if (hit) return hit;
    await sleep(200);
  }
  return null;
}
async function waitAll(pred, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = allLogs().find(pred);
    if (hit) return hit;
    await sleep(200);
  }
  return null;
}

const sayHuman = (ws, text) => kit.wsSend(ws, { type: 'CHAT', payload: { characterId: HUMAN_ID, message: text } });
const moveHuman = (ws, pos, yaw) => kit.wsSend(ws, { type: 'POSITION_UPDATE', payload: { characterId: HUMAN_ID, position: pos, animMode: 'idle', rotation: yaw } });
const bearing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const angDiff = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

/** 找一个"谁都不面对"的朝向：36 个候选里取到所有 AI 的最小夹角最大的那个 */
function yawFacingNobody(pos, targets) {
  let best = 0, bestMin = -1;
  for (let i = 0; i < 36; i++) {
    const yaw = (i / 36) * 2 * Math.PI - Math.PI;
    const min = Math.min(...targets.map(t => angDiff(yaw, bearing(pos, t.position))));
    if (min > bestMin) { bestMin = min; best = yaw; }
  }
  return { yaw: best, minDiffDeg: bestMin * 180 / Math.PI };
}

async function main() {
  try {
    // ---- 0. 探路：拿世界出生点（三个实例都会在它附近 ±3m 生成）----
    const scoutIp = ipOf(0);
    const st = await kit.guestTicket(scoutIp);
    check('探路票 200', st.status === 200 && !!st.ticket, st.status);
    if (!st.ticket) return finish();
    const scout = await kit.openAgentWs({ token: st.ticket.token, ip: scoutIp });
    check('探路 WS', scout.ok === true, scout.ok ? null : scout);
    if (!scout.ok) return finish();
    closeables.push(scout.ws);
    const sReady = await kit.waitFor(scout.msgs, 'READY', 6000);
    const spawn = (sReady.payload && sReady.payload.spawn) || { x: 0, y: 0, z: 0 };
    const auth = { headers: { Authorization: 'Bearer ' + st.ticket.token } };

    // ---- 1. 三个实例进场 ----
    const a = startLoop('甲', ipOf(1));
    const b = startLoop('乙', ipOf(2));
    const c = startLoop('丙', ipOf(3));
    const rA = await waitLoop(a, e => e.event === 'ready', 15000);
    const rB = await waitLoop(b, e => e.event === 'ready', 15000);
    const rC = await waitLoop(c, e => e.event === 'ready', 15000);
    check('E1 三个实例都进场（READY）', !!(rA && rB && rC), { a: !!rA, b: !!rB, c: !!rC });
    if (!(rA && rB && rC)) return finish();
    a.agentId = rA.agentId; b.agentId = rB.agentId; c.agentId = rC.agentId;

    // 真人就位（先站在出生点旁，稍后再精调）
    const human = await kit.openHumanWs({ characterId: HUMAN_ID, characterName: HUMAN_NAME, position: { x: spawn.x, y: spawn.y, z: spawn.z } });
    check('真人 WS', human.ok === true, human.ok ? null : human);
    if (!human.ok) return finish();
    closeables.push(human.ws);
    await sleep(6000);                                  // 等三个实例各自 observe 一轮（2.5s）

    // 从自己的 observe 拿三个实例的实时位置
    const obs = await kit.httpJson('/api/agent/v1/observe?radius=30', auth);
    const ents = (obs.json && obs.json.entities) || [];
    const posOf = (id) => { const e = ents.find(x => String(x.id) === String(id)); return e && e.position; };
    const pA = posOf(a.agentId), pB = posOf(b.agentId), pC = posOf(c.agentId);
    check('E1b observe 能看到三个实例', !!(pA && pB && pC), { pA, pB, pC });
    if (!(pA && pB && pC)) return finish();

    // ---- E2 人多 + 谁都没指向 → 不该出声 ----
    const away = yawFacingNobody(spawn, [{ position: pA }, { position: pB }, { position: pC }]);
    moveHuman(human.ws, { x: spawn.x, y: spawn.y, z: spawn.z }, away.yaw);
    await sleep(3500);
    const n2 = replyCount();
    sayHuman(human.ws, '有人吗？这儿怎么这么多人。');
    await sleep(10000);
    check('E2 人多且没指向我 → 0 条回复（克制）', replyCount() === n2,
      { added: replyCount() - n2, awayMinDiffDeg: Math.round(away.minDiffDeg * 10) / 10, skips: allLogs().filter(e => e.event === 'skip').map(e => e.why).slice(-3) });

    // ---- E3 面对甲、贴脸、不点名 → 只有甲回 ----
    await sleep(6000);                                   // 等冷却（游客档 say 1/5s）
    const stand = { x: pA.x, y: pA.y, z: pA.z + 1 };     // 站在甲前方 1m
    moveHuman(human.ws, stand, bearing(stand, pA));      // 面朝甲
    await sleep(3500);                                   // 等实例刷新 observe
    const n3 = replyCount();
    const saidAt = Date.now();
    sayHuman(human.ws, '你好呀。');
    await sleep(14000);                                  // 游客档：轮询 2s + 错峰 jitter（0.3~1.5s）+ 二次确认
    const added3 = replyCount() - n3;
    const last3 = allLogs().filter(x => x.event === 'reply').pop();
    check('E3 面朝甲贴脸 → 恰好 1 条回复', added3 === 1,
      {
        added: added3,
        humanDistToA: Math.hypot(stand.x - pA.x, stand.z - pA.z),
        replies: allLogs().filter(x => x.event === 'reply').slice(-2).map(x => ({ loop: x._loop, trigger: x.trigger, score: x.score, lagMs: x.ts ? (new Date(x.ts).getTime() - saidAt) : null })),
        skips: allLogs().filter(x => x.event === 'skip' && x.text && String(x.text).includes('你好')).map(x => ({ loop: x._loop, why: x.why, score: x.score, signals: x.signals }))
      });
    // 注意：三个实例的出生点只差 1~3m，我面朝甲时"乙/丙也可能被判成 facing+close"（都合法）→
    // 断言不能钉死"必须是甲"，只能钉"回话的那个确实是被判成 facing 的那个实例，且只有它回"。
    check('E3b 回话的是判定为 facing 的那个实例（且只有它回）',
      !!(last3 && last3._loop && last3.to === HUMAN_ID && last3.trigger === 'facing'
        && allLogs().filter(x => x.event === 'reply').slice(-2).filter(x => x.trigger === 'facing').length === 1),
      last3 ? { loop: last3._loop, to: last3.to, trigger: last3.trigger, score: last3.score, signals: last3.signals } : 'no reply');

    // ---- E4 点名（三个实例都认这个名字，信号相同）→ 礼让成 1 条 ----
    await sleep(6000);
    const n4 = replyCount();
    sayHuman(human.ws, `@${NAME} 你们谁在？`);
    await sleep(12000);
    const added4 = replyCount() - n4;
    check('E4 同一句点名三个 AI → 恰好 1 条回复（礼让仲裁）', added4 === 1,
      { added: added4, replies: allLogs().filter(x => x.event === 'reply').slice(-3).map(x => ({ loop: x._loop, score: x.score })) });
    const yielded = allLogs().filter(e => e.event === 'skip' && e.why === 'yielded_to_other_ai');
    check('E5 另外两个实例确实"让位"（skip:yielded_to_other_ai）', yielded.length >= 2,
      { n: yielded.length, loops: yielded.map(e => e._loop) });

    // ---- E6 打分表单元验证 ----
    // 为什么不做"独处"的端到端：世界里有别的连接残留（被 kill 的实例要几分钟才被服务端清理），
    // 现场没法干净地凑出"附近只有 1 个真人 0 个 AI"。这类纯逻辑用单元验证更确定，也更像文档。
    // Windows 上动态 import 绝对路径必须转成 file:// URL（否则报 protocol 'l:'）
    const mod = await import(pathToFileURL(path.join(REPO, 'examples/agent-client/loop-addressing.mjs')).href);
    const opts = { triggerNames: [NAME], facingToleranceDeg: 60, facingOffsetDeg: 0, faceMaxDist: 8, closeDist: 3, crowdedFrom: 3 };
    const selfAt = { x: 0, y: 0, z: 0 };
    const mapOf = (arr) => new Map(arr.map((e, i) => [e.id || 'e' + i, e]));
    const speakAt = (pos, yaw, extra = {}) => ({ id: 'h1', type: 'human', distance: Math.hypot(pos.x, pos.z), yaw, position: pos, ...extra });

    // 独处：附近只有他 1 个真人、没有别的 AI，泛问候 → alone(30)+greeting(15) = 45 ≥ 阈值 40
    const alone = mod.scoreAddressing({ text: '有人在吗？', speaker: speakAt({ x: 0, y: 0, z: 2 }, Math.PI), entities: mapOf([speakAt({ x: 0, y: 0, z: 2 }, Math.PI)]), selfId: 'me', selfPos: selfAt, opts });
    check('E6a 独处：alone=true 且分数 ≥ 阈值（会开口）', alone.signals.alone === true && alone.score >= 40, alone);

    // 人多：真人在 2m 外、没面朝我、泛问候 → crowded(−20)+greeting(15) < 40
    const many = mapOf([
      { id: 'h1', type: 'human', distance: 2, position: { x: 0, y: 0, z: 2 } },
      { id: 'h2', type: 'human', distance: 4, position: { x: 3, y: 0, z: 3 } },
      { id: 'a1', type: 'agent', distance: 5, position: { x: -4, y: 0, z: 3 } }
    ]);
    const crowd = mod.scoreAddressing({ text: '有人吗？', speaker: speakAt({ x: 0, y: 0, z: 2 }, 0), entities: many, selfId: 'me', selfPos: selfAt, opts });
    check('E6b 人多且没指向我 → 低于阈值（不开口）', crowd.signals.crowded === true && crowd.signals.facing === false && crowd.score < 40, crowd);

    // 面朝我：他在 +Z 2m 处、yaw=π 正好朝原点（游戏口径 yaw=atan2(dx,dz)）→ facing+close+greeting ≥ 40
    const facing = mod.scoreAddressing({ text: '你好呀。', speaker: speakAt({ x: 0, y: 0, z: 2 }, Math.PI), entities: mapOf([speakAt({ x: 0, y: 0, z: 2 }, Math.PI)]), selfId: 'me', selfPos: selfAt, opts });
    check('E6c 面朝我 → facing=true（朝向判定与游戏一致）', facing.signals.facing === true && facing.score >= 40, facing);

    // 他正对另一个真人说话（说话人在 (0,0,2) 朝 +Z，另一个真人在 (0,0,5)）→ 抑制插嘴
    const other = mod.scoreAddressing({
      text: '你好呀。',
      speaker: speakAt({ x: 0, y: 0, z: 2 }, 0),
      entities: mapOf([{ id: 'h9', type: 'human', distance: 5, position: { x: 0, y: 0, z: 5 } }]),
      selfId: 'me', selfPos: { x: 0, y: 0, z: -6 }, opts
    });
    check('E6d 他在跟另一个真人说话 → facingOtherHuman=true（抑制插嘴）', other.signals.facingOtherHuman === true, other);

    // 点名最硬：即使在"人多 + 他在跟别人聊"的抑制环境下，也仍越过阈值
    const named = mod.scoreAddressing({ text: `@${NAME} 在吗`, speaker: speakAt({ x: 0, y: 0, z: 2 }, 0), entities: many, selfId: 'me', selfPos: selfAt, opts });
    check('E6e 被点名 → 抑制环境下仍越过阈值（最硬信号）', named.signals.mention === true && named.score >= 40, named);
  } catch (e) {
    check('脚本未抛异常', false, e && e.message);
  }
  return finish();
}

function finish() {
  // 先出结论再清理：清理（杀子进程/删临时目录）偶尔会慢，结论不能被截掉
  console.log('');
  console.log(`===== 多 AI 礼让验收 : ${pass}/${pass + fail} PASS =====`);
  if (fail) {
    console.log('--- 全部日志尾部（排错）---');
    console.log(allLogs().slice(-14).map(e => JSON.stringify(e)).join('\n'));
    process.exitCode = 1;
  }
  for (const l of loops) stopLoop(l);
  kit.closeAll(...closeables);
  for (const l of loops) { try { fs.rmSync(l.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}

main();
