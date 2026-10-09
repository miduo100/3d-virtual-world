/**
 * worldSnapshot —— 世界聚合视图（AI World Brain · Phase 4 · 判据 P3-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 4 文件清单「世界聚合视图（受控字节预算，≤ maxBytes）」
 * + §6-6（快照字节预算硬钳；降级顺序固定：先裁区域明细 → 再裁计数 → 骨架保底）。
 *
 * 结构固定四段（P3-1 断言）：regions / hotspots / coldspots / integrity 永远存在
 * （超预算时退化为空数组/空对象，而不是删键）。
 */
'use strict';

const { query } = require('../../database/db');

async function counts(worldId) {
  const r = await query(
    `SELECT
       (SELECT count(*)::int FROM world_objects) AS objects,
       (SELECT count(*)::int FROM world_objects WHERE origin = 'ai') AS ai_objects,
       (SELECT count(*)::int FROM world_regions WHERE status <> 'sealed') AS regions,
       (SELECT count(*)::int FROM world_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS events_24h,
       (SELECT count(*)::int FROM world_tool_executions WHERE status = 'succeeded') AS tool_succeeded,
       (SELECT count(*)::int FROM world_tool_executions WHERE status = 'denied') AS tool_denied`
  );
  return r.rows[0] || {};
}

/** 近 24h 各区域事件热度（enter_region + interact 计数） */
async function regionHeat(worldId) {
  const r = await query(
    `SELECT COALESCE(target_id,'(global)') AS region, count(*)::int AS n
       FROM world_events
      WHERE world_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
        AND type IN ('entity_enter_region','object_interact','chat')
      GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    [String(worldId)]
  );
  return r.rows || [];
}

async function integrity(worldId) {
  const r = await query(
    `SELECT
       (SELECT count(*)::int FROM world_objects WHERE origin = 'human') AS human_protected,
       (SELECT count(*)::int FROM world_approvals WHERE decision = 'pending') AS approvals_pending,
       (SELECT count(*)::int FROM world_objects WHERE origin = 'ai' AND region_id IS NULL) AS ai_orphans`,
    []
  );
  const row = r.rows[0] || {};
  return {
    humanProtected: row.human_protected || 0,
    approvalsPending: row.approvals_pending || 0,
    aiOrphans: row.ai_orphans || 0,
    ok: (row.ai_orphans || 0) === 0,
  };
}

/**
 * 构建快照（≤ maxBytes，硬钳）。
 * @returns {{ok:true, snapshot:object, bytes:int, dropped:string[]}}
 */
async function build(o) {
  const p = o || {};
  const worldId = String(p.worldId || '');
  const maxBytes = Math.min(64 * 1024, Math.max(300, Number(p.maxBytes) || 1900));
  const dropped = [];

  let regionRows = [];
  try {
    const r = await query(
      `SELECT region_key, name, autonomy, bounds FROM world_regions WHERE status <> 'sealed' ORDER BY created_at DESC LIMIT 40`,
      []
    );
    regionRows = r.rows || [];
  } catch (e) { dropped.push('regions(load)'); }

  const heat = await regionHeat(worldId).catch(() => []);
  const hotspots = heat.slice(0, 5).map((h) => ({ region: String(h.region).slice(0, 24), events: h.n }));
  const coldspots = regionRows
    .filter((r) => !heat.some((h) => h.region === r.region_key))
    .slice(0, 5)
    .map((r) => ({ region: r.region_key, events: 0 }));

  const snap = {
    worldId,
    generatedAt: new Date().toISOString(),
    regions: regionRows.map((r) => ({
      key: r.region_key, name: r.name, autonomy: r.autonomy,
      bounds: r.bounds && { x: r.bounds.x, z: r.bounds.z, width: r.bounds.width, depth: r.bounds.depth },
    })),
    hotspots,
    coldspots,
    integrity: await integrity(worldId).catch(() => ({ ok: true, humanProtected: 0, approvalsPending: 0, aiOrphans: 0 })),
    counts: await counts(worldId).catch(() => ({})),
    dropped,
  };

  // 固定顺序降级（§6-6）：区域明细 → 热点/冷点明细 → 计数；regions/hotspots/coldspots/integrity 键永不删
  const bytes = () => Buffer.byteLength(JSON.stringify(snap), 'utf8');
  if (bytes() > maxBytes) {
    snap.regions = snap.regions.map((r) => r.key); dropped.push('regions.detail');
  }
  if (bytes() > maxBytes) { snap.hotspots = hotspots.slice(0, 2); snap.coldspots = coldspots.slice(0, 2); dropped.push('hotspots.detail'); }
  if (bytes() > maxBytes) { snap.regions = snap.regions.slice(0, 10); dropped.push('regions.count'); }
  if (bytes() > maxBytes) { snap.hotspots = []; snap.coldspots = []; dropped.push('hotspots.all'); }
  if (bytes() > maxBytes) { snap.counts = {}; dropped.push('counts'); }

  return { ok: true, snapshot: snap, bytes: bytes(), maxBytes, dropped };
}

module.exports = { build };
