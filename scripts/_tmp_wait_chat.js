/**
 * _tmp_wait_chat.js — 临时工具：从事件日志增量读取真人聊天（供 AI Agent 驻场会话使用）
 *
 * 用法：node scripts/_tmp_wait_chat.js [timeoutMs] [quietMs]
 *   读取 examples/agent-client/live/events.jsonl，从上次偏移之后读取新增行，
 *   打印真人聊天 / 回执 / 错误，静默 quietMs 后退出。
 */
const fs = require('fs');
const path = require('path');

const LIVE = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
const EVENTS = path.join(LIVE, 'events.jsonl');
const OFF = path.join(LIVE, '.tmp-wait-offset');

const timeoutMs = parseInt(process.argv[2] || '90000', 10);
const quietMs = parseInt(process.argv[3] || '3000', 10);

let selfName = '';
try {
  const st = JSON.parse(fs.readFileSync(path.join(LIVE, 'state.json'), 'utf8'));
  selfName = st.agentName || '';
} catch (e) {}

function readOffset() {
  try { return parseInt(fs.readFileSync(OFF, 'utf8'), 10) || 0; } catch (e) { return 0; }
}
function saveOffset(n) { try { fs.writeFileSync(OFF, String(n), 'utf8'); } catch (e) {} }

let offset = readOffset();
let size = 0;
try { size = fs.statSync(EVENTS).size; } catch (e) { size = 0; }
if (offset > size) offset = 0; // 文件被重建
if (offset === 0 && process.env.WAIT_FROM_END !== '0') offset = size; // 首次从末尾开始

const start = Date.now();
let lastChatAt = 0;
let chatCount = 0;

function readNew() {
  let st;
  try { st = fs.statSync(EVENTS); } catch (e) { return []; }
  if (st.size < offset) offset = 0;
  if (st.size === offset) return [];
  const fd = fs.openSync(EVENTS, 'r');
  const len = st.size - offset;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, offset);
  fs.closeSync(fd);
  offset = st.size;
  saveOffset(offset);
  return buf.toString('utf8').split('\n').filter(Boolean);
}

function handle(line) {
  let o;
  try { o = JSON.parse(line); } catch (e) { return; }
  const ts = (o.ts || '').slice(11, 19);
  if (o.dir === 'chat-history') {
    if (o.from === selfName) { console.log(`[${ts}] SELF  ${o.text}`); return; }
    chatCount++; lastChatAt = Date.now();
    console.log(`[${ts}] CHAT ${o.from || '?'} : ${o.text}`);
  } else if (o.dir === 'in' && o.msg) {
    const t = o.msg.type;
    if (t === 'CHAT' && o.msg.payload) {
      if (o.msg.payload.sender === selfName) { console.log(`[${ts}] SELF  ${o.msg.payload.message}`); return; }
      chatCount++; lastChatAt = Date.now();
      console.log(`[${ts}] CHAT ${o.msg.payload.sender || '?'} : ${o.msg.payload.message}`);
    } else if (t === 'ACTION_REJECTED' || t === 'ERROR') {
      console.log(`[${ts}] ${t} ${JSON.stringify(o.msg.payload)}`);
    } else if (t === 'ACTION_ACCEPTED' || t === 'ACTION_COMPLETED') {
      console.log(`[${ts}] ${t} ${JSON.stringify(o.msg.payload)}`);
    }
  } else if (o.dir === 'out') {
    console.log(`[${ts}] SENT ${JSON.stringify(o.payload)}`);
  }
}

const timer = setInterval(() => {
  readNew().forEach(handle);
  const now = Date.now();
  if (now - start > timeoutMs) { finish('timeout'); return; }
  if (chatCount > 0 && now - lastChatAt > quietMs) { finish('chat'); return; }
}, 800);

function finish(why) {
  clearInterval(timer);
  readNew().forEach(handle);
  let self = '';
  try {
    const st = JSON.parse(fs.readFileSync(path.join(LIVE, 'state.json'), 'utf8'));
    self = ` | self=(${st.self ? st.self.position.x.toFixed(1) + ',' + st.self.position.z.toFixed(1) : '?'}) entities=${(st.entities || []).length}`;
  } catch (e) {}
  console.log(`--- end (${why}) chats=${chatCount}${self}`);
  process.exit(0);
}
