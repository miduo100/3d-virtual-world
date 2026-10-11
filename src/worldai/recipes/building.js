'use strict';
const g = require('./geometry');
const DEFAULT_FLOOR_HEIGHT = 2.4;
const MAX_FLOORS = 12;
function fail(code, reason, hint, stats) {
  return { ok: false, code, reason, hint, stats: Object.assign({ recipe: 'building', count: 0 }, stats || {}) };
}
function sideOf(edge, bbox) {
  const cand = [];
  if (Math.abs(edge.mid.dz - bbox.minZ) < 1e-6) cand.push('north');
  if (Math.abs(edge.mid.dz - bbox.maxZ) < 1e-6) cand.push('south');
  if (Math.abs(edge.mid.dx - bbox.minX) < 1e-6) cand.push('west');
  if (Math.abs(edge.mid.dx - bbox.maxX) < 1e-6) cand.push('east');
  if (cand.length === 1) return cand[0];
  return (edge.ang > 45 && edge.ang < 135) ? 'east' : 'north';
}
async function resolvePart(c, key, notes) {
  if (!key) return null;
  let raw = null;
  try { raw = await c.partResolver(String(key)); } catch (e) { notes.push('partResolver err: ' + String(e && e.message || e).slice(0, 100)); }
  if (!raw) { notes.push('part missing (dropped): ' + key); return null; }
  return { partKey: String(raw.part_key || raw.partKey || key), role: String(raw.part_role || raw.role || ''), grid: g.normGrid(raw.grid || [raw.grid_w, raw.grid_h, raw.grid_d]), modelPath: raw.model_path || raw.modelPath || null };
}
async function build(spec, ctx) {
  const s = spec || {}; const c = ctx || {};
  const notes = []; const dropped = { unknownPart: 0 };
  const edges = g.polygonEdges(s.footprint);
  if (edges.length < 3) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'footprint needs >=3 edges (got ' + edges.length + ')', 'footprint = ground outline polygon (give 4 {dx,dz} corners, auto-closed)', { dropped, notes });
  }
  const floors = Math.max(1, Math.min(MAX_FLOORS, Math.floor(Number(s.floors) || 1)));
  const P = s.parts && typeof s.parts === 'object' ? s.parts : {};
  const wall = await resolvePart(c, P.wall, notes);
  if (!wall) {
    dropped.unknownPart++;
    return fail('RECIPE_SPEC_INCOMPLETE', 'spec.parts.wall missing -> no walls, no building (never silently place only windows/doors)', 'parts must include wall (wall segment key); optional corner/door/window/roof/trim. Kenney modular walls are 2m wide x 2.4m high', { dropped, notes });
  }
  const corner = await resolvePart(c, P.corner, notes);
  const door = await resolvePart(c, P.door, notes);
  const win = await resolvePart(c, P.window, notes);
  const roof = await resolvePart(c, P.roof, notes);
  const trim = await resolvePart(c, P.trim, notes);
  if (!P.door) notes.push('no parts.door -> no doorway');
  if (!P.window) notes.push('no parts.window -> no windows');
  if (!P.roof) notes.push('no parts.roof -> open top (note only, not an error)');
  const floorHeight = Number(s.floorHeight) > 0 ? Number(s.floorHeight) : Math.max(1, wall.grid[1] || DEFAULT_FLOOR_HEIGHT);
  if (Number(s.floors) > MAX_FLOORS) notes.push('floors over limit -> clamped to ' + MAX_FLOORS);
  const segLen = Math.max(0.5, wall.grid[2]);
  const pts = g.normPoints(s.footprint);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.dx); maxX = Math.max(maxX, p.dx); minZ = Math.min(minZ, p.dz); maxZ = Math.max(maxZ, p.dz); }
  const bbox = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
  const doorSide = String((s.door && s.door.side) || 'south').toLowerCase();
  const doorPos = s.door && isFinite(Number(s.door.position)) ? Math.max(0, Math.min(1, Number(s.door.position))) : 0.5;
  const winPerWall = Math.max(0, Math.floor(Number(s.windows && s.windows.perWall) || 0));
  const balcony = s.balcony && typeof s.balcony === 'object' ? s.balcony : null;
  const taken = new Set(); const parts = [];
  const keyOf = function (dx, dz, lv) { return Math.round(dx * 100) + ':' + Math.round(dz * 100) + ':' + (lv || 0); };
  function push(p) { const kk = keyOf(p.dx, p.dz, p.level); if (taken.has(kk)) return false; taken.add(kk); parts.push(p); return true; }
  function mk(t, dx, dz, ry, lv) { return { partKey: t.partKey, role: t.role, grid: t.grid, modelPath: t.modelPath, dx: g.r2(dx), dz: g.r2(dz), ry: g.r2(ry), level: g.r2(lv) }; }
  for (let f = 0; f < floors; f++) {
    const y = f * floorHeight;
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const side = sideOf(e, bbox);
      const n = Math.max(1, Math.round(e.len / segLen));
      const doorIdx = (door && side === doorSide && f === 0) ? Math.floor(doorPos * (n - 1) + 0.5) : -1;
      const winIdx = [];
      if (win && winPerWall > 0) for (let k = 0; k < winPerWall; k++) { const idx = Math.round((k + 0.5) * (n - 1) / winPerWall); if (idx !== doorIdx) winIdx.push(idx); }
      for (let k = 0; k < n; k++) {
        const p = g.lerpOnSeg(e, (k + 0.5) * (e.len / n));
        let t = wall, ry = e.ang;
        if (k === doorIdx && door) t = door;
        else if (winIdx.indexOf(k) >= 0) t = win;
        push(mk(t, p.dx, p.dz, ry, y));
      }
      if (trim && f < floors - 1) { const q = g.lerpOnSeg(e, e.len / 2); push(mk(trim, q.dx, q.dz, e.ang, y + floorHeight)); }
    }
    if (corner) for (let vi = 0; vi < pts.length; vi++) {
      const a = pts[vi], b = pts[(vi + 1) % pts.length];
      push(mk(corner, a.dx, a.dz, g.angleDeg(b.dx - a.dx, b.dz - a.dz), y));
    }
    if (balcony && f === Math.max(0, Math.floor(Number(balcony.floor) || 1) - 1)) {
      const t = (await resolvePart(c, P.balcony || P.trim, notes)) || trim;
      const bSide = String(balcony.side || 'south').toLowerCase();
      if (t) for (const e of edges) { if (sideOf(e, bbox) !== bSide) continue; const q = g.lerpOnSeg(e, e.len / 2); push(mk(t, q.dx + e.normal.dx, q.dz + e.normal.dz, e.ang, y)); }
    }
  }
  const topY = (floors - 1) * floorHeight;
  let roofCount = 0;
  if (roof) {
    const rw = Math.max(0.5, roof.grid[0]), rd = Math.max(0.5, roof.grid[2]);
    const W = bbox.maxX - bbox.minX, D = bbox.maxZ - bbox.minZ;
    const nx = Math.max(1, Math.round(W / rw)), nz = Math.max(1, Math.round(D / rd));
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const x = bbox.minX + (ix + 0.5) * (W / nx), z = bbox.minZ + (iz + 0.5) * (D / nz);
      if (push(mk(roof, x, z, 0, topY + Math.max(0.1, roof.grid[1] || 0.1)))) roofCount++;
    }
  }
  let truncated = false;
  const maxObjects = Number(c.maxObjects) > 0 ? Math.floor(Number(c.maxObjects)) : 0;
  if (maxObjects && parts.length > maxObjects) { notes.push('budget truncate ' + parts.length + ' -> ' + maxObjects); parts.length = maxObjects; truncated = true; }
  return { ok: true, parts: parts, stats: { recipe: 'building', count: parts.length, floors: floors, floorHeight: g.r2(floorHeight), edges: edges.length, segLen: g.r2(segLen), roofCount: roofCount, doorSide: door ? doorSide : null, winPerWall: winPerWall, truncated: truncated, height: g.r2(topY + floorHeight), bounds: g.boundsOf(parts), dropped: dropped, notes: notes } };
}
module.exports = { build: build, DEFAULT_FLOOR_HEIGHT: DEFAULT_FLOOR_HEIGHT, MAX_FLOORS: MAX_FLOORS };