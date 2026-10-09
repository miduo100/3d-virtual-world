/**
 * presenceEmitter —— 真人位置埋点 + dwell_sec 修复（AI World Brain · Phase 7 · 判据 P6-11 前置 / Phase 4 遗留④）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么是"采样"而不是"钩子"（用户 2026-10-09 决策②）：
 *   wsServer.playerPositions 已经是真人位置的唯一权威，而 wsServer.js 是 573 行贴线文件
 *   （§K 禁止追加新功能代码）。因此本模块**只读采样**——由 scheduler 的 tick_idle 每轮调一次，
 *   对既有文件零改动，隐私口径与 Agent 侧 eventLog.trackRegionPresence 完全一致。
 *
 * 口径：
 *   ①区域变化 → entity_enter_region / entity_exit_region（eventLog 唯一写入器）；
 *   ②停留时长 → world_metrics_daily.dwell_sec（增量累加，Phase 4 起该指标恒 0 的根因就是没有轨迹）；
 *   ③进入次数 → 同表 visits 增量；
 *   ④**不存原始轨迹**（§H.6 聚合优先）：内存里只留"上次在哪个区域 + 采样时刻"，进程重启即清。
 *   ⑤Agent 条目（entityType='agent'）不在本模块统计口径内 —— 那是 eventLog 既有埋点的职责。
 */
'use strict';

const { query } = require('../../database/db');
const eventLog = require('./eventLog');
const analytics = require('./analytics');

// connectionId → { regionKey, regionId, at }
const state = new Map();
const STALE_MS = 5 * 60 * 1000;      // 5 分钟没采样到就清状态（离线/重连）
let regionsCache = { at: 0, rows: [] };

async function loadRegions() {
  if (Date.now() - regionsCache.at < 30000) return regionsCache.rows;
  try {
    const r = await query(`SELECT id, region_key, name, bounds FROM world_regions WHERE status <> 'sealed'`);
    regionsCache = { at: Date.now(), rows: r.rows || [] };
  } catch (e) {
    regionsCache = { at: Date.now(), rows: regionsCache.rows || [] };
  }
  return regionsCache.rows;
}

function regionAt(rows, x, z) {
  for (const r of rows) {
    const b = r.bounds || {};
    const minX = Number(b.minX !== undefined ? b.minX : b.x);
    const minZ = Number(b.minZ !== undefined ? b.minZ : b.z);
    const maxX = Number(b.maxX !== undefined ? b.maxX : (Number(b.x || 0) + Number(b.width || 0)));
    const maxZ = Number(b.maxZ !== undefined ? b.maxZ : (Number(b.z || 0) + Number(b.depth || 0)));
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) continue;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return r;
  }
  return null;
}

function humanPositions() {
  try {
    const wsServer = require('../../websocket/wsServer');
    const map = typeof wsServer.getPlayerPositions === 'function' ? wsServer.getPlayerPositions() : null;
    if (!map || !map.forEach) return [];
    const out = [];
    map.forEach((entry, cid) => {
      if (!entry) return;
      if (entry.entityType === 'agent') return;             // Agent 走既有埋点
      const pos = entry.position || {};
      const x = Number(pos.x), z = Number(pos.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      out.push({ connectionId: String(cid), characterId: entry.characterId ? String(entry.characterId) : null, x, z });
    });
    return out;
  } catch (e) {
    return [];                                              // 脚本进程/服务器未起ws：静默
  }
}

/**
 * 采样一轮。返回 {ok, players, entered, exited, dwellSec}。
 * @param {string} worldId
 * @param {object} opts { at?:number }注入采样时刻（验收可固定时间）
 */
async function sample(worldId, opts) {
  const o = opts || {};
  const now = Number(o.at) || Date.now();
  const rows = await loadRegions();
  const list = humanPositions();
  const seen = new Set();
  const dwellByRegion = {};
  const visitByRegion = {};
  let entered = 0;
  let exited = 0;

  for (const p of list) {
    seen.add(p.connectionId);
    const region = regionAt(rows, p.x, p.z);
    const prev = state.get(p.connectionId);
    const prevKey = prev ? prev.regionKey : null;
    const curKey = region ? String(region.region_key) : null;
    const seconds = prev ? Math.max(0, Math.min(600, (now - prev.at) / 1000)) : 0;

    if (prevKey && prevKey !== curKey) {
      // 离开旧区域：把停留时长计入旧区域 + exit 事件
      if (prev.regionId) dwellByRegion[prev.regionId] = (dwellByRegion[prev.regionId] || 0) + seconds;
      exited += 1;
      await eventLog.log({ worldId, type: 'entity_exit_region', actorType: 'human', actorId: p.characterId,
        targetId: prevKey, x: p.x, z: p.z, payload: { regionKey: prevKey, source: 'presence_sampler' } });
    } else if (prevKey && prevKey === curKey && prev.regionId) {
      // 仍在同一区域：累计停留
      dwellByRegion[prev.regionId] = (dwellByRegion[prev.regionId] || 0) + seconds;
    }

    if (curKey && curKey !== prevKey) {
      entered += 1;
      if (region && region.id) visitByRegion[region.id] = (visitByRegion[region.id] || 0) + 1;
      await eventLog.log({ worldId, type: 'entity_enter_region', actorType: 'human', actorId: p.characterId,
        targetId: curKey, x: p.x, z: p.z, payload: { regionKey: curKey, source: 'presence_sampler' } });
    }

    state.set(p.connectionId, {
      regionKey: curKey, regionId: region ? region.id : (prev ? prev.regionId : null), at: now,
    });
  }

  // 清理离线连接（不补计停留：采样间隔不保证，猜出来的时长会污染指标）
  for (const [cid, prev] of state) {
    if (!seen.has(cid) && now - prev.at > STALE_MS) state.delete(cid);
  }

  // 落日聚合（区域行 + 全局哨兵行）
  const day = new Date(now).toISOString().slice(0, 10);
  let dwellSec = 0;
  for (const regionId of Object.keys(dwellByRegion)) {
    const sec = dwellByRegion[regionId];
    dwellSec += sec;
    await analytics.bumpMetrics(worldId, day, regionId, 'dwell_sec', sec);
  }
  for (const regionId of Object.keys(visitByRegion)) {
    await analytics.bumpMetrics(worldId, day, regionId, 'visits', visitByRegion[regionId]);
  }
  // 全局哨兵行：区域行的合计（只写一次，避免与上面重复计）
  const totalVisits = Object.keys(visitByRegion).reduce((s, k) => s + visitByRegion[k], 0);
  if (totalVisits) await analytics.bumpMetrics(worldId, day, analytics.GLOBAL_REGION, 'visits', totalVisits);
  if (dwellSec) await analytics.bumpMetrics(worldId, day, analytics.GLOBAL_REGION, 'dwell_sec', dwellSec);

  return { ok: true, players: list.length, entered, exited, dwellSec: Math.round(dwellSec) };
}

/** 诊断/验收：当前采样状态快照 */
function diag() {
  const rows = [];
  state.forEach((v, k) => rows.push({ connectionId: k, regionKey: v.regionKey, at: new Date(v.at).toISOString() }));
  return { tracked: state.size, entries: rows.slice(0, 20), regionsCached: regionsCache.rows.length };
}

function reset() { state.clear(); }

module.exports = { sample, diag, reset, loadRegions, regionAt, humanPositions };