/**
 * eventLog —— world_events 唯一写入器（AI World Brain · Phase 4 · §C.3⑮ + 判据 P3-12/13）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 唯一写入器：任何模块不许绕开本文件直插 world_events（铁律 §0.1-3）。
 * ★ 隐私红线（§H.6 / P3-12）：chat 事件 payload 只存 {len, kw}，绝不存聊天全文。
 * ★ 埋点纪律：所有写入 try/catch 静默（最多 console.warn 一次），**绝不阻断主流程**。
 * ★ 速率保护（§H.1 第 5 层）：每分钟写入上限，超限丢弃 + 告警一次。
 */
'use strict';

const { query } = require('../../database/db');

// worldId 懒解析 + 30s 缓存：埋点调用方（chatLogService/shop/inventory/monster/bridge）不传 worldId 也能落行，
// 且埋点处保持 ≤3 行（铁律 §K：既有文件只许 1~3 行接线）。
let widCache = { at: 0, id: null };
async function resolveWorldId(explicit) {
  if (explicit) return String(explicit);
  if (widCache.id && Date.now() - widCache.at < 30000) return widCache.id;
  try {
    const worldAiConfig = require('../config');
    widCache = { at: Date.now(), id: String(await worldAiConfig.getWorldId()) };
  } catch (e) { widCache = { at: Date.now(), id: widCache.id || 'default' }; }
  return widCache.id;
}

const TYPES = [
  'entity_enter_region', 'entity_exit_region', 'chat', 'object_interact',
  'object_created', 'object_removed', 'task_progress', 'task_completed',
  'activity_participant', 'economy', 'npc_talk',
  'entity_created', 'entity_removed',   // Phase 5：完整实体（P4 判据走 eventLog 唯一写入器）
  'task_claimed', 'activity_started', 'activity_finished', // Phase 6：任务领取 / 活动生命周期
];

let warned = false;
let minuteWindow = 0;
let minuteCount = 0;
const RATE_PER_MINUTE = 1200;

function overRate() {
  const now = Date.now();
  const win = Math.floor(now / 60000);
  if (win !== minuteWindow) { minuteWindow = win; minuteCount = 0; }
  minuteCount += 1;
  return minuteCount > RATE_PER_MINUTE;
}

/**
 * 写一条事件（唯一入口）。失败静默（warn 一次）。
 * @param {object} e { worldId, type, actorType, actorId, regionId, entityId,
 *                     worldObjectId, targetId, x, y, z, payload }
 */
async function log(e) {
  try {
    const evt = e || {};
    if (TYPES.indexOf(evt.type) < 0) return { ok: false, code: 'TYPE_INVALID' };
    const worldId = await resolveWorldId(evt.worldId);
    if (!worldId) return { ok: false, code: 'WORLD_REQUIRED' };
    if (overRate()) {
      if (!warned) { warned = true; console.warn('[eventLog] 事件流超速率上限，本分钟剩余事件丢弃'); }
      return { ok: false, code: 'RATE_LIMITED' };
    }
    await query(
      `INSERT INTO world_events (world_id, type, actor_type, actor_id, region_id, entity_id,
                                 world_object_id, target_id, x, y, z, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING seq`,
      [worldId, evt.type,
        evt.actorType || null, evt.actorId ? String(evt.actorId).slice(0, 100) : null,
        evt.regionId || null, evt.entityId || null,
        Number.isInteger(Number(evt.worldObjectId)) ? Number(evt.worldObjectId) : null,
        evt.targetId ? String(evt.targetId).slice(0, 100) : null,
        Number.isFinite(Number(evt.x)) ? Number(evt.x) : null,
        Number.isFinite(Number(evt.y)) ? Number(evt.y) : null,
        Number.isFinite(Number(evt.z)) ? Number(evt.z) : null,
        JSON.stringify(sanitizePayload(evt.payload))]
    );
    return { ok: true };
  } catch (err2) {
    if (!warned) { warned = true; console.warn('[eventLog] 事件写入失败（不影响主流程）:', err2.message); }
    return { ok: false, code: 'WRITE_FAILED' };
  }
}

/** payload 白名单深限：只允许平面对象 + 数值/短字符串（防全文/嵌套泄漏进事件流） */
function sanitizePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(p)) {
    if (n >= 12) break;
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; n++; }
    else if (typeof v === 'string' && v.length <= 64) { out[k] = v; n++; }
    else if (typeof v === 'boolean') { out[k] = v; n++; }
  }
  return out;
}

/** 聊天事件（P3-12）：len + kw（短哈希），绝不存全文 */
function chatEvent(o) {
  const text = String((o && o.message) || '');
  if (!text) return Promise.resolve({ ok: false });
  const kw = shortHash(text);
  const senderType = o.senderType === 'agent' ? 'agent' : 'human';
  return log({
    worldId: o.worldId,
    type: 'chat',
    actorType: senderType,
    actorId: o.senderId,
    x: o.position && Number.isFinite(Number(o.position.x)) ? Number(o.position.x) : null,
    y: o.position && Number.isFinite(Number(o.position.y)) ? Number(o.position.y) : null,
    z: o.position && Number.isFinite(Number(o.position.z)) ? Number(o.position.z) : null,
    payload: { len: text.length, kw },
  }).then((r) => {
    // Phase 6：聊天事件驱动任务推进（talk_to / chat_contains；fire-and-forget 静默）
    if (r && r.ok && o.senderId) {
      setImmediate(() => { try { require('../gameplay/taskService').notifyChat({ actorType: senderType, actorId: o.senderId }); } catch (e) { /* 静默 */ } });
    }
    return r;
  });
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ── 区域进出判定（agentPresenceBridge 埋点用）────────────────────────────
// 10Hz 位置更新不能每帧查库：每连接 3s 节流 + 位移 >2m 才重算；区域清单 30s 缓存。
const presenceCache = new Map();   // connectionId → { regionKey, lastAt, lastX, lastZ }
let regionsCache = { at: 0, rows: [] };

async function loadRegions(worldId) {
  if (Date.now() - regionsCache.at < 30000) return regionsCache.rows;
  try {
    const r = await query(`SELECT region_key, name, bounds FROM world_regions WHERE status <> 'sealed'`);
    regionsCache = { at: Date.now(), rows: r.rows || [] };
  } catch (e) { regionsCache = { at: Date.now(), rows: regionsCache.rows || [] }; }
  return regionsCache.rows;
}

function regionAt(rows, x, z) {
  for (const r of rows) {
    const b = r.bounds || {};
    const minX = Number(b.minX !== undefined ? b.minX : b.x), minZ = Number(b.minZ !== undefined ? b.minZ : b.z);
    const maxX = Number(b.maxX !== undefined ? b.maxX : (Number(b.x || 0) + Number(b.width || 0)));
    const maxZ = Number(b.maxZ !== undefined ? b.maxZ : (Number(b.z || 0) + Number(b.depth || 0)));
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) continue;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return r.region_key;
  }
  return null;
}

/**
 * Agent 位置埋点：区域变化 → entity_enter_region / entity_exit_region。
 * 在 agentPresenceBridge.updatePosition 旁 1~3 行调用；内部节流，绝不阻塞广播。
 */
async function trackRegionPresence(worldId, connectionId, characterId, position) {
  try {
    const x = Number(position && position.x), z = Number(position && position.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const prev = presenceCache.get(connectionId);
    const now = Date.now();
    if (prev && now - prev.lastAt < 3000 && Math.abs(x - (prev.lastX || 0)) < 2 && Math.abs(z - (prev.lastZ || 0)) < 2) return;
    const rows = await loadRegions(worldId);
    const rk = regionAt(rows, x, z);
    presenceCache.set(connectionId, { regionKey: rk, lastAt: now, lastX: x, lastZ: z });
    if (rk === (prev && prev.regionKey)) return;
    if (prev && prev.regionKey) {
      await log({ worldId, type: 'entity_exit_region', actorType: 'agent', actorId: characterId, regionId: null, targetId: prev.regionKey, x, z, payload: { regionKey: prev.regionKey } });
    }
    if (rk) {
      await log({ worldId, type: 'entity_enter_region', actorType: 'agent', actorId: characterId, targetId: rk, x, z, payload: { regionKey: rk } });
      // Phase 6：事件驱动任务推进（fire-and-forget，失败静默，绝不影响广播）
      setImmediate(() => { try { require('../gameplay/taskService').notifyRegionEnter({ actorType: 'agent', actorId: characterId }); } catch (e) { /* 静默 */ } });
    }
  } catch (e) { /* 静默：埋点失败绝不影响广播 */ }
}

function clearPresence(connectionId) { presenceCache.delete(connectionId); }

/** 游标增量（P3-13）：返回 seq > cursor 的事件（升序） */
async function tail(worldId, cursor, limit) {
  const cur = Number(cursor) > 0 ? Math.floor(Number(cursor)) : 0;
  const lim = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
  const r = await query(
    `SELECT seq, type, actor_type, actor_id, target_id, world_object_id, payload, created_at
       FROM world_events WHERE world_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [String(worldId), cur, lim]
  );
  const rows = r.rows || [];
  return { ok: true, events: rows, cursor: rows.length ? rows[rows.length - 1].seq : cur };
}

module.exports = { log, chatEvent, trackRegionPresence, clearPresence, tail, TYPES, sanitizePayload };
