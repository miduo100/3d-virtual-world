/**
 * accept_agent_chat_loop.js —— 自动应答循环验收（2026-09-24）
 *
 * 覆盖两半：
 *   ① 世界侧"书签"：GET /chat/history?since= 增量游标（C1~C3）
 *   ② 世界侧"名字牌" + 来访侧"接线图"：ai-chat-loop.mjs 的行为（D1~D6）
 *
 *   C1 无 since 时保持历史行为：created_at DESC + 返回 nextSince
 *   C2 since 增量：只取 id > since（order=asc），nextSince 前进，再取一次 0 条（幂等）
 *   C3 since 不会把旧消息再吐一遍（同一批消息不会被重复取到 N 次）
 *
 *   D1 被点名必有回应：真人在 30m 内 @名字 → 循环 say，回执 recipients≥1，且真人 WS 真收到 CHAT
 *   D2 不该出声就不出声：真人不点名说话 → 0 条 reply（只有 skip:no_trigger）
 *   D3a AI↔AI 对话**可用**（用户决策：AI 之间也能聊）：另一个 Agent 连说 3 次 @名字 → 3 条 toType=agent 的 reply
 *   D3b 不无限对刷：同一 AI 第 4 次 → 不再回，且日志有 ai_talk_cooldown
 *   D4 节流：真人 1 秒内连发 3 条点名 → 该窗口内 ≤1 条 reply
 *   D5 距离闸：真人移到 >30m 再点名 → 不发声
 *   D6 空闲静默：30m 内没人超过 IDLE_SILENCE_MS → 日志 idle_silence（不产生自言自语）
 *
 * 用法：node scripts/accept_agent_chat_loop.js
 *   · 需要本地服务在跑（默认 http://localhost:3002），且后台 agent_enabled 已开
 *   · 本脚本把 ai-chat-loop.mjs 作为**子进程**跑（最贴近真实用法），断言全部来自它的 chat-loop.jsonl
 *   · 用非回环测试 IP 签票，不烧本机 IP 的签票窗口；跑完杀掉子进程、删临时日志目录
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const kit = require('./agentV2TestKit');

const REPO = path.resolve(__dirname, '..');
const LOOP_SCRIPT = path.join('examples', 'agent-client', 'ai-chat-loop.mjs');
// 每轮换一段测试 IP：同一 IP 的游客签票额度是 10 张/小时，固定 IP 连跑几轮必然 429
const IP_BASE = 100 + Math.floor(Math.random() * 90);
const ipOf = (i) => kit.testIp(IP_BASE + i);
const NAME = '小七';                       // 被点名的名字（循环的 TRIGGER_NAMES）
const HUMAN_ID = 'tmp-loop-human-0001';
const HUMAN_NAME = '循环真人';
const AGENT2_ID = 'tmp-loop-agent2-0001';
const AGENT2_NAME = '另一个AI';

const LIVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-loop-'));
const LOG_FILE = path.join(LIVE_DIR, 'chat-loop.jsonl');

let loopProc = null;
let loopOut = '';

function readEventsFrom(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
const readEvents = () => readEventsFrom(LOG_FILE);
const replies = () => readEvents().filter(e => e.event === 'reply');
const replyCount = () => replies().length;

async function waitEventFrom(file, pred, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = readEventsFrom(file).find(pred);
    if (hit) return hit;
    await kit.sleep(200);
  }
  return null;
}
const waitEvent = (pred, timeoutMs) => waitEventFrom(LOG_FILE, pred, timeoutMs);

function startLoop(ip) {
  const env = {
    ...process.env,
    AGENT_HOST: kit.BASE,
    AGENT_TEST_IP: ip,
    AI_LIVE_DIR: LIVE_DIR,
    REPLY_MODE: 'mention',        // 本套件专门守"点名语义"；寻址推断/礼让由 accept_agent_chat_loop_yield.js 覆盖
    TRIGGER_NAMES: NAME,
    AI_TALK_MODE: 'limited',
    AI_TALK_MAX_TURNS: '3',
    AI_TALK_COOLDOWN_MS: '30000',
    COOLDOWN_MS: '3000',          // 游客档会被循环内部抬到 5s（对齐服务端 say 限频）
    MAX_PER_MIN: '8',
    POLL_MS: '2000',
    OBSERVE_MS: '2000',
    IDLE_SILENCE_MS: '15000'
  };
  loopProc = spawn(process.execPath, [LOOP_SCRIPT], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  loopProc.stdout.on('data', d => { loopOut += d.toString(); });
  loopProc.stderr.on('data', d => { loopOut += d.toString(); });
}

function stopLoop() {
  try { if (loopProc) loopProc.kill(); } catch (e) { /* ignore */ }
}

/** 真人/第二个 Agent 说话（走人类侧 WS，服务端会写进 world_chat_log，并广播给附近） */
function sayOnHuman(ws, characterId, text) {
  kit.wsSend(ws, { type: 'CHAT', payload: { characterId, message: text } });
}

/**
 * AI 侧必须走 ACTION say（agent 连接直接发 CHAT 会被服务端忽略：不广播、不入库 —— 第一版验收
 * 就是因此拿不到 AI↔AI 结果）。senderId 由服务端按连接身份填，天然与 observe 的 id 一致。
 */
function sayAsAgent(ws, text) {
  kit.wsSend(ws, { type: 'ACTION', payload: { action: 'say', text, requestId: 'acc-' + Math.random().toString(36).slice(2, 8) } });
}

async function main() {
  const rep = kit.createReporter('自动应答循环（游标 + 循环行为）验收');
  const closeables = [];
  try {
    // ---- 0. 拿世界出生点：用自己的票连一次 WS 读 READY.spawn ----
    const scoutIp = ipOf(0);
    const scout = await kit.guestTicket(scoutIp);
    rep.check('探路票 200', scout.status === 200 && !!scout.ticket, scout.status);
    if (!scout.ticket) return finish(rep, closeables);
    const scoutWs = await kit.openAgentWs({ token: scout.ticket.token, ip: scoutIp });
    if (!scoutWs.ok) { rep.check('探路 WS 连接', false, scoutWs); return finish(rep, closeables); }
    closeables.push(scoutWs.ws);
    const ready = await kit.waitFor(scoutWs.msgs, 'READY', 6000);
    const spawn0 = (ready && ready.payload && ready.payload.spawn) || { x: 0, y: 0, z: 0 };
    rep.info('world spawn', spawn0);
    const near = { x: Number(spawn0.x) || 0, y: Number(spawn0.y) || 0, z: Number(spawn0.z) || 0 };

    // ---- 0b. 游标（世界侧"书签"）----
    const auto = { headers: { Authorization: 'Bearer ' + scout.ticket.token } };
    const h0 = await kit.httpJson('/api/agent/v1/chat/history?limit=5', auto);
    rep.check('C1 无 since 保持历史行为（desc + nextSince）',
      h0.status === 200 && h0.json && h0.json.order === 'desc' && typeof h0.json.nextSince === 'number',
      { status: h0.status, order: h0.json && h0.json.order, nextSince: h0.json && h0.json.nextSince });
    const base = Number(h0.json && h0.json.nextSince) || 0;

    // ---- 1. 真人 + 第二个 Agent 就位（都在出生点旁）----
    const human = await kit.openHumanWs({ characterId: HUMAN_ID, characterName: HUMAN_NAME, position: near });
    rep.check('真人 WS 连接', human.ok === true, human.ok ? null : human);
    if (!human.ok) return finish(rep, closeables);
    closeables.push(human.ws);

    const ip2 = ipOf(1);
    const t2 = await kit.guestTicket(ip2);
    const agent2 = await kit.openAgentWs({ token: t2.ticket.token, ip: ip2 });
    rep.check('第二个 Agent WS 连接', agent2.ok === true, agent2.ok ? null : agent2);
    if (!agent2.ok) return finish(rep, closeables);
    closeables.push(agent2.ws);
    // 关键：说话时要用品**服务端认的 id**（READY.agentId）。用自己编的 id 说话，循环在 entities 里
    // 查不到这个 id → 会判成 speaker_not_in_view（第一版验收就是这么错的）
    const ready2 = await kit.waitFor(agent2.msgs, 'READY', 6000);
    const a2id = (ready2 && ready2.payload && ready2.payload.agentId) || AGENT2_ID;
    rep.info('agent2 id', a2id);
    kit.wsSend(agent2.ws, { type: 'POSITION_UPDATE', payload: { characterId: a2id, position: { x: near.x + 1, y: near.y, z: near.z + 1 }, animMode: 'idle', rotation: 0 } });
    await kit.sleep(800);

    // ---- 2. 拉起循环（子进程）----
    startLoop(ipOf(2));
    const loopReady = await waitEvent(e => e.event === 'ready', 15000);
    rep.check('循环启动并进入世界（子进程 READY）', !!loopReady, loopReady || loopOut.slice(-300));
    if (!loopReady) return finish(rep, closeables);
    const baseline = await waitEvent(e => e.event === 'history_baseline', 8000);   // 别抢跑：基线是 ready 之后的第一次 HTTP
    rep.check('循环用游客档 = 增量轮询（基线书签已建立）', !!baseline,
      baseline || readEvents().map(e => e.event).slice(0, 6));
    await kit.sleep(3000);                       // 等首轮 observe（2s）把我们就位的信息装进去

    // ---- C2/C3：游标增量 ----
    const marker = '【游标探针-' + Date.now().toString(36) + '】';
    sayOnHuman(human.ws, HUMAN_ID, marker);
    await kit.sleep(1200);
    const h1 = await kit.httpJson(`/api/agent/v1/chat/history?limit=50&since=${base}`, auto);
    const got = (h1.json && h1.json.history) || [];
    rep.check('C2 since 只取新增且升序', h1.json && h1.json.order === 'asc' && got.some(x => x.message === marker),
      { order: h1.json && h1.json.order, n: got.length, hit: got.some(x => x.message === marker) });
    rep.check('C2b nextSince 前进', Number(h1.json && h1.json.nextSince) > base, { base, next: h1.json && h1.json.nextSince });
    const h2 = await kit.httpJson(`/api/agent/v1/chat/history?limit=50&since=${h1.json.nextSince}`, auto);
    rep.check('C3 同一游标再取一次 = 0 条（幂等，不重复吐旧消息）',
      h2.status === 200 && (h2.json.history || []).length === 0 && Number(h2.json.nextSince) === Number(h1.json.nextSince),
      { n: (h2.json.history || []).length, next: h2.json.nextSince });

    // ---- D1 被点名必有回应 ----
    const before1 = replyCount();
    sayOnHuman(human.ws, HUMAN_ID, `@${NAME} 在吗？`);
    const d1 = await waitEvent(e => e.event === 'reply' && e.toType === 'human', 15000);
    rep.check('D1 被点名 → 循环回话且回执 recipients ≥ 1', !!d1 && Number(d1.recipients) >= 1, d1 || 'timeout');
    const chatFromLoop = kit.msgsOfType(human.msgs, 'CHAT').filter(m => (m.payload || {}).sender === loopReady.name);
    rep.check('D1b 真人侧真的收到 AI 的 CHAT，且带 senderType=agent（名字牌）',
      chatFromLoop.length >= 1 && chatFromLoop.every(m => (m.payload || {}).senderType === 'agent'),
      { n: chatFromLoop.length, sample: chatFromLoop[0] && chatFromLoop[0].payload });
    rep.check('D1c 该轮确实只产生 1 条回复', replyCount() === before1 + 1, { before: before1, after: replyCount() });

    // ---- D2 不点名就不出声 ----
    const before2 = replyCount();
    sayOnHuman(human.ws, HUMAN_ID, '今天天气还行。');
    await kit.sleep(9000);
    rep.check('D2 不点名 → 0 条 reply（只有 skip:no_trigger）', replyCount() === before2,
      { before: before2, after: replyCount(), skips: readEvents().filter(e => e.event === 'skip').map(e => e.why).slice(-4) });

    // ---- D3a AI↔AI 对话可用 ----
    const before3 = replyCount();
    for (let i = 1; i <= 3; i++) {
      sayAsAgent(agent2.ws, `@${NAME} 我是另一个AI，第${i}句。`);
      await kit.sleep(8000);                     // ≥ 游客 say 冷却 5s + 轮询 2s
    }
    const aiReplies = replies().filter(e => e.toType === 'agent').length;
    rep.check('D3a AI 之间能对话（另一个 Agent 被回应 ≥3 次）', aiReplies >= 3, { aiReplies, total: replyCount(), before: before3 });

    // ---- D3b 不会无限对刷 ----
    const before4 = replyCount();
    sayAsAgent(agent2.ws, `@${NAME} 第四句。`);
    await kit.sleep(9000);
    rep.check('D3b 超过 ai_talk_max_turns 后停口（无第 4 条回复）', replyCount() === before4, { before: before4, after: replyCount() });
    rep.check('D3b2 日志记录 ai_talk_cooldown', !!readEvents().find(e => e.event === 'ai_talk_cooldown'),
      readEvents().filter(e => e.event === 'ai_talk_cooldown').slice(0, 1));

    // ---- D4 节流：连发 3 条点名 ----
    await kit.sleep(6000);                       // 先让冷却归零
    const before5 = replyCount();
    sayOnHuman(human.ws, HUMAN_ID, `@${NAME} 一`);
    sayOnHuman(human.ws, HUMAN_ID, `@${NAME} 二`);
    sayOnHuman(human.ws, HUMAN_ID, `@${NAME} 三`);
    await kit.sleep(9000);
    rep.check('D4 1 秒内连发 3 条点名 → ≤1 条回复（冷却生效）', replyCount() - before5 <= 1,
      { added: replyCount() - before5, skips: readEvents().filter(e => e.event === 'skip').map(e => e.why).slice(-5) });

    // ---- D5 距离闸：走远再点名 ----
    await kit.sleep(6000);
    const before6 = replyCount();
    kit.wsSend(human.ws, { type: 'POSITION_UPDATE', payload: { characterId: HUMAN_ID, position: { x: near.x + 150, y: near.y, z: near.z + 150 }, animMode: 'idle', rotation: 0 } });
    await kit.sleep(3000);                       // 等循环 observe 更新（走远后不在视野里）
    sayOnHuman(human.ws, HUMAN_ID, `@${NAME} 我在很远的地方喊你。`);
    await kit.sleep(9000);
    rep.check('D5 超出 30m → 不发声', replyCount() === before6,
      { added: replyCount() - before6, why: readEvents().filter(e => e.event === 'skip').slice(-3).map(e => e.why) });

    // ---- D6 空闲静默：用**独立实例**验证（本地世界里常有真人/残留测试 Agent 站在出生点旁，
    //      主实例的 30m 内未必会没人 → 靠环境来判断不可重复）。
    //      做法：NEARBY_RANGE=2（视野内只有自己）+ IDLE_SILENCE_MS=5000，等 idle_silence。
    kit.closeAll(scoutWs.ws, agent2.ws);
    // NEARBY_RANGE=1：让"附近有人"极难成立（世界里有被 kill 的旧连接会残留几分钟）。
    // 最多两次尝试，吸收残留连接的偶发干扰；每次换一个测试 IP（游客每 IP 并发 1 条连接）。
    let idle = null, lastEvents = [];
    for (let attempt = 1; attempt <= 2 && !idle; attempt++) {
      const idleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-loop-idle-'));
      const idleLog = path.join(idleDir, 'chat-loop.jsonl');
      const idleProc = spawn(process.execPath, [LOOP_SCRIPT], {
        cwd: REPO,
        env: {
          ...process.env, AGENT_HOST: kit.BASE, AGENT_TEST_IP: ipOf(2 + attempt), AI_LIVE_DIR: idleDir,
          NEARBY_RANGE: '1', IDLE_SILENCE_MS: '5000', TRIGGER_NAMES: NAME, REPLY_MODE: 'mention'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      idle = await waitEventFrom(idleLog, e => e.event === 'idle_silence', 18000);
      lastEvents = readEventsFrom(idleLog).map(e => `${e.event}${e.why ? ':' + e.why : ''}`).slice(-6);
      try { idleProc.kill(); } catch (e) { /* ignore */ }
      fs.rmSync(idleDir, { recursive: true, force: true });
    }
    rep.check('D6 视野内长期没人 → idle_silence（不自言自语）', !!idle, idle || lastEvents);
  } catch (e) {
    rep.check('脚本未抛异常', false, e && e.message);
  }
  return finish(rep, closeables);
}

function finish(rep, closeables) {
  stopLoop();
  kit.closeAll(...closeables);
  const s = rep.summary();
  if (s.fail > 0) {
    console.log('--- 循环日志尾部（排错用）---');
    console.log(readEvents().slice(-12).map(e => JSON.stringify(e)).join('\n'));
    console.log('--- 循环进程输出尾部 ---');
    console.log(loopOut.slice(-600));
  }
  try { fs.rmSync(LIVE_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (s.fail > 0) process.exitCode = 1;
}

main();
