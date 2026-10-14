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
  let floors = Math.max(1, Math.min(MAX_FLOORS, Math.floor(Number(s.floors) || 1)));
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
  // ★ 槽位件查不到必须显式记账（2026-10-12，§11-6）：旧代码只对 wall 计 dropped.unknownPart，
  //   roof/corner/door/window/trim 查不到时**静默跳过** —— 实测 AI 编造了零件名
  //   tower_square_roof_secondary（库内只有 tower_hexagon_roof_secondary / tower_square_roof），
  //   结果整栋楼 306 件落库却一件屋顶都没有，stats 里毫无痕迹。
  for (const [label, key, got] of [['corner', P.corner, corner], ['door', P.door, door],
    ['window', P.window, win], ['roof', P.roof, roof], ['trim', P.trim, trim]]) {
    if (key && !got) {
      dropped.unknownPart++;
      notes.push('parts.' + label + ' 查不到（显式丢弃，该槽位不落件）: ' + key);
    }
  }
  // ★ interior（2026-10-12）：内部楼板 + 立柱。原 recipe 只铺外轮廓 → 楼里面是空的，
  //   从任何能看到内部的角度都是"一层壳"。
  //   ★ 引擎兜底：AI 两次端到端都没填 interior（实测 interior=null），所以 interior.floor
  //     缺省时**自动复用 roof 零件**铺内部楼板 —— 屋顶件本来就是平板，当楼板正合适。
  //     这样"有楼板"成为默认行为，不依赖 AI 记得填。AI 显式给了 interior.floor 才用它。
  //     想彻底关掉可传 spec.interior = { floor: false }。
  const IN = s.interior && typeof s.interior === 'object' ? s.interior : null;
  const iFloorOff = IN && IN.floor === false;
  // ★ 楼板必须是平板件（2026-10-13）：兜底原来无条件拿 parts.roof，而 roof 可能是
  //   3m 高的坡屋顶件（Roof_Slate_Center）→ 楼板厚 3m、从墙洞看进去整层是黑的。
  //   候选顺序：interior.floor（显式，AI 给什么用什么）→ parts.floor → parts.roof(须平板)
  //   → parts.trim(须平板)；全都拿不到平板就放弃楼板，notes 留痕。
  const isFlatPart = function (p) { return p && p.grid[1] <= Math.min(p.grid[0], p.grid[2]) + 1e-6; };
  let iFloor = null;
  if (!iFloorOff) {
    const floorCands = [];
    if (IN && IN.floor) floorCands.push([IN.floor, 'interior.floor（显式）', true]);
    if (P.floor) floorCands.push([P.floor, 'parts.floor', true]);
    if (P.roof) floorCands.push([P.roof, 'parts.roof', false]);
    if (P.trim) floorCands.push([P.trim, 'parts.trim', false]);
    for (const [k, label, explicit] of floorCands) {
      const p = await resolvePart(c, k, notes);
      if (!p) continue;
      if (isFlatPart(p) || explicit) { iFloor = p; notes.push('内部楼板用 ' + label + ' = ' + k + (isFlatPart(p) ? '' : '（非平板，按显式指定采用）')); break; }
      notes.push('楼板候选 ' + k + ' 是非平板件（' + p.grid.map(function (v) { return v.toFixed(2); }).join('×') + '），跳过');
    }
    if (!iFloor) notes.push('无可用平板件做内部楼板 → 楼内不铺板（屋顶仍是 ' + (P.roof || '无') + '）');
  } else {
    notes.push('interior.floor=false → 按需关闭内部楼板');
  }
  const iCol = await resolvePart(c, IN && IN.column, notes);
  // ★ interior.furniture（2026-10-13）：室内家具散点。kenney_furniture_kit 140 件
  //   （bedSingle/chair/loungeSofa…，件名语义化）此前全库未用——interior 只铺楼板，
  //   房子里没有家具。AI 给键名数组（须在 PARTS 清单），引擎每层地面确定性散点：
  //   内部网格步长 1.2m + LCG（seedStr 种子）抖动/洗牌/朝向 → 同种子逐字节同输出。
  const furnList = IN && Array.isArray(IN.furniture) ? IN.furniture.map(String).filter(Boolean).slice(0, 8) : [];
  const furnParts = [];
  for (const k of furnList) {
    const p = await resolvePart(c, k, notes);
    if (p) furnParts.push(p);
    else { dropped.unknownPart++; notes.push('interior.furniture 查不到（显式丢弃）: ' + k); }
  }
  if (IN && typeof IN.furniture === 'string' && IN.furniture) {
    notes.push('interior.furniture 应为数组（如 ["bedSingle","chair"]），收到字符串已忽略');
  }
  if (!P.door) notes.push('no parts.door -> no doorway');
  if (!P.window) notes.push('no parts.window -> no windows');
  if (!P.roof) notes.push('no parts.roof -> open top (note only, not an error)');
  // ★ 层高优先级（2026-10-12）：spec.floorHeight > ctx.floorHeight（后台 system_config
  //   .building_floor_height，默认 2.4m）> 墙件自身高度。
  //   旧逻辑直接取 wall.grid[1]，而 Kenney modular 的 building_block 只有 0.625m 高、
  //   building_tower 1.02m —— "5 层公寓楼"总高 3.1m、"城堡"总高 5.5m，全是积木玩具。
  //   层高现在是**可配置的世界设定**，墙件比层高矮时由 wallRows 沿高度堆叠补足。
  const wallH = Math.max(0.05, Number(wall.grid[1]) > 0 ? Number(wall.grid[1]) : DEFAULT_FLOOR_HEIGHT);
  const cfgFloorH = Number(c.floorHeight) > 0 ? Number(c.floorHeight) : 0;
  let floorHeight = Number(s.floorHeight) > 0 ? Number(s.floorHeight)
    : (cfgFloorH > 0 ? cfgFloorH : wallH);
  // 层高不能低于墙件高度（否则墙件互相嵌）；也不能高于 20m（防呆）
  floorHeight = Math.max(wallH, Math.min(20, floorHeight));
  // 委托级 max_height（constraints.max_height）：此前只是透传给 LLM 的软约束，
  // 从未真正执行。这里按"层高 × 层数"折算成最大层数并截断。
  const maxH = Number(c.maxHeight) > 0 ? Number(c.maxHeight) : 0;
  // 每层沿高度堆叠几排墙：层高 / 墙件高度，向上取整
  let wallRows = Math.max(1, Math.ceil((floorHeight - 1e-6) / wallH));
  // ★ 层高必须对齐到"墙件高度的整数倍"，否则堆叠顶层与层高之间有缝（能看到楼层断开）。
  //   例：后台配 2.4m、墙件 0.625m → 4 排 = 2.5m，层高取 2.5 而非 2.4（偏差 0.1m 可接受，
  //   比"每层之间一道缝"观感好得多）。notes 记录实际值。
  const alignedFloorH = wallRows * wallH;
  if (Math.abs(alignedFloorH - floorHeight) > 1e-6) {
    notes.push('层高 ' + floorHeight.toFixed(2) + 'm 对齐到墙件 ' + wallH.toFixed(3) + 'm 的 ' + wallRows + ' 倍 = ' + alignedFloorH.toFixed(2) + 'm');
    floorHeight = alignedFloorH;
  }
  // 层高已定型（含对齐），此时再按 max_height 截断层数，总高才真正受控
  // ★ 必须在**层高对齐之后**再做 —— 否则对齐会把层高抬高（如 2.4→3.192），
  //   截断后的总高反而超出 max_height（实测 building_castle 8 层算出 25.54m > 24m）。
  if (maxH > 0 && floorHeight * floors > maxH + 1e-6) {
    const capped = Math.max(1, Math.floor((maxH + 1e-6) / floorHeight));
    if (capped < floors) {
      notes.push('floors ' + floors + ' → ' + capped + '（受 max_height=' + maxH + 'm 限制，层高 ' + floorHeight.toFixed(2) + 'm）');
      floors = capped;
    }
  }
  if (Number(s.floors) > MAX_FLOORS) notes.push('floors over limit -> clamped to ' + MAX_FLOORS);
  // 段长 = 墙件沿铺贴方向的长边。★ 用 max(w,d)：零厚度墙板（Brick_InteriorWall_3 是
  //   2.00×3.00×0.00）的 grid_d=0，取 grid[2] 会退化成 0.5m 段长 → 每边 24 件、件数爆炸
  //   （实测 2 层楼铺出 157 件墙）。墙板的长边才是它沿墙方向占的长度。
  const segLen = Math.max(0.5, wall.grid[0], wall.grid[2]);
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
  // 预算上限（提前取出：内部楼板要用它做"超预算就跳过"的保护）
  const maxObjects = Number(c.maxObjects) > 0 ? Math.floor(Number(c.maxObjects)) : 0;
  let furnTotal = 0;   // 家具散点计数（stats 用；声明须在层循环前，否则 TDZ）
  for (let f = 0; f < floors; f++) {
    const y = f * floorHeight;
    for (let row = 0; row < wallRows; row++) {
    const ry = y + row * wallH;                     // 本排的 Y（堆叠补足层高）
    const isTopRow = row === wallRows - 1;          // 最上一排：窗/腰线放这里
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const side = sideOf(e, bbox);
      const n = Math.max(1, Math.round(e.len / segLen));
      const doorIdx = (door && side === doorSide && f === 0 && row === 0) ? Math.floor(doorPos * (n - 1) + 0.5) : -1;
      // ★ 门让位（2026-10-13）：旧逻辑只把 doorIdx 那一件换成门件，但墙件比门宽时
      //   左右相邻墙件仍紧贴门边（实测门周围 1.5m 内 29 个墙件，侧面看是堵死的）。
      //   n≥5 时门两侧各空 1 件位置；n 太小就让不动了（全空就没有墙了）。
      const doorGap = new Set();
      if (doorIdx >= 0 && n >= 5) {
        if (doorIdx - 1 >= 0) doorGap.add(doorIdx - 1);
        doorGap.add(doorIdx);
        if (doorIdx + 1 < n) doorGap.add(doorIdx + 1);
      }
      const winIdx = [];
      if (win && winPerWall > 0 && isTopRow) for (let k = 0; k < winPerWall; k++) { const idx = Math.round((k + 0.5) * (n - 1) / winPerWall); if (idx !== doorIdx && !doorGap.has(idx)) winIdx.push(idx); }
      for (let k = 0; k < n; k++) {
        if (doorGap.has(k) && k !== doorIdx) continue;      // 门两侧留空
        const p = g.lerpOnSeg(e, (k + 0.5) * (e.len / n));
        let t = wall, rry = e.ang;
        if (k === doorIdx && door) t = door;
        else if (winIdx.indexOf(k) >= 0) t = win;
        push(mk(t, p.dx, p.dz, rry, ry));
      }
      if (trim && f < floors - 1 && isTopRow) { const q = g.lerpOnSeg(e, e.len / 2); push(mk(trim, q.dx, q.dz, e.ang, ry)); }
    }
    if (corner) for (let vi = 0; vi < pts.length; vi++) {
      const a = pts[vi], b = pts[(vi + 1) % pts.length];
      push(mk(corner, a.dx, a.dz, g.angleDeg(b.dx - a.dx, b.dz - a.dz), ry));
    }
    if (balcony && f === Math.max(0, Math.floor(Number(balcony.floor) || 1) - 1) && isTopRow) {
      const t = (await resolvePart(c, P.balcony || P.trim, notes)) || trim;
      const bSide = String(balcony.side || 'south').toLowerCase();
      if (t) for (const e of edges) { if (sideOf(e, bbox) !== bSide) continue; const q = g.lerpOnSeg(e, e.len / 2); push(mk(t, q.dx + e.normal.dx, q.dz + e.normal.dz, e.ang, ry)); }
    }
    // ── 内部结构（interior）── 只在每层最上一排铺楼板/立柱（避免每排都铺）
    //   ★ 楼板只铺「非顶层」（f < floors-1）：顶层的顶面就是屋顶位置（topY = floors×floorHeight），
    //     在那里铺楼板会和屋顶抢同一坐标，被同位去重吃掉 —— 铺了也白铺。
    //   ★ 预算保护：楼板是"有了更好"的装饰性结构，件数超预算时优先放弃它，保住墙体与屋顶。
    if (iFloor && isTopRow && f < floors - 1) {
      const fw = Math.max(0.5, iFloor.grid[0]), fd = Math.max(0.5, iFloor.grid[2]);
      const inset = Math.max(wall.grid[0], wall.grid[2]) * 0.5 + 0.1;
      const iMinX = bbox.minX + inset, iMaxX = bbox.maxX - inset;
      const iMinZ = bbox.minZ + inset, iMaxZ = bbox.maxZ - inset;
      const iW = Math.max(0, iMaxX - iMinX), iD = Math.max(0, iMaxZ - iMinZ);
      if (iW > 0.3 && iD > 0.3) {
        const fnx = Math.max(1, Math.round(iW / fw)), fnz = Math.max(1, Math.round(iD / fd));
        const budgetLeft = maxObjects > 0 ? maxObjects - parts.length : Infinity;
        if (fnx * fnz > budgetLeft) {
          notes.push('内部楼板跳过（本层需 ' + fnx * fnz + ' 件，预算余 ' + budgetLeft + '）→ 优先保墙体与屋顶');
        } else {
          for (let ix = 0; ix < fnx; ix++) for (let iz = 0; iz < fnz; iz++) {
            // 楼板同样贴层顶（+0.05 防 z-fighting），不用 h/2（坡屋顶件当楼板时会悬空半层）
            push(mk(iFloor, iMinX + (ix + 0.5) * (iW / fnx), iMinZ + (iz + 0.5) * (iD / fnz), 0, y + floorHeight + 0.05));
          }
        }
      } else {
        notes.push('interior 空间太窄（' + iW.toFixed(2) + '×' + iD.toFixed(2) + 'm）→ 无内部楼板');
      }
    }
    if (iCol && row === 0) {
      const inset = Math.max(wall.grid[0], wall.grid[2]) * 0.5 + 0.4;
      const cx = (bbox.minX + bbox.maxX) / 2, cz = (bbox.minZ + bbox.maxZ) / 2;
      const pts4 = [
        { dx: bbox.minX + inset, dz: bbox.minZ + inset }, { dx: bbox.maxX - inset, dz: bbox.minZ + inset },
        { dx: bbox.minX + inset, dz: bbox.maxZ - inset }, { dx: bbox.maxX - inset, dz: bbox.maxZ - inset },
        { dx: cx, dz: cz },
      ];
      for (const q of pts4) push(mk(iCol, q.dx, q.dz, 0, y));
    }
    // ── interior.furniture 家具散点（2026-10-13）── 每层地面一层；网格步长 1.2m +
    //    LCG 洗牌/抖动/朝向（seedStr 种子 → 同种子逐字节同输出，幂等重跑不重复）。
    //    数量：默认 min(8, 内部面积/6㎡)，可用 interior.furnitureCount 覆盖。
    if (furnParts.length && row === 0) {
      const inset = Math.max(wall.grid[0], wall.grid[2]) * 0.5 + 0.6;
      const iMinX = bbox.minX + inset, iMaxX = bbox.maxX - inset;
      const iMinZ = bbox.minZ + inset, iMaxZ = bbox.maxZ - inset;
      const iW = Math.max(0, iMaxX - iMinX), iD = Math.max(0, iMaxZ - iMinZ);
      if (iW > 1 && iD > 1) {
        const STEP = 1.2;
        const cells = [];
        for (let gx = iMinX + STEP / 2; gx < iMaxX; gx += STEP) for (let gz = iMinZ + STEP / 2; gz < iMaxZ; gz += STEP) cells.push({ dx: gx, dz: gz });
        // LCG（确定性；seed 来自 ctx.seedStr，与 path.js 同一幂等口径）
        let seed = 2166136261;
        const seedStr = String(c.seedStr || '');
        for (const ch of seedStr) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
        seed = (seed + f * 2654435761) >>> 0;                     // 每层不同布局
        const rnd = function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        // 洗牌
        for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
        const area = iW * iD;
        const want = Math.max(1, Math.min(cells.length, isFinite(Number(IN.furnitureCount)) && Number(IN.furnitureCount) > 0 ? Math.floor(Number(IN.furnitureCount)) : Math.min(8, Math.floor(area / 6))));
        const budgetLeftF = maxObjects > 0 ? maxObjects - parts.length : Infinity;
        const n = Math.min(want, furnParts.length * 3, budgetLeftF > 0 ? budgetLeftF : want);
        for (let i = 0; i < n; i++) {
          const cell = cells[i % cells.length];
          const p = furnParts[i % furnParts.length];
          const jx = (rnd() - 0.5) * 0.3, jz = (rnd() - 0.5) * 0.3;
          const ryOpt = [0, 90, 180, 270];
          push(mk(p, cell.dx + jx, cell.dz + jz, ryOpt[Math.floor(rnd() * 4)], y));
        }
        furnTotal += n;
      }
    }
    }   // end wallRows
  }
  // ★ 墙顶高度 = floors × floorHeight（**不是** (floors-1)×floorHeight）。
  //   原式取的是"最后一层的底部"，屋顶被埋进顶层墙体里（5 层楼屋顶落在 y=9.7，
  //   而顶层墙占 9.6~12.0）→ 从外面看不到屋顶、能一眼看进空楼（用户看图发现）。
  const topY = floors * floorHeight;
  let roofCount = 0;
  if (roof) {
    const rw = Math.max(0.5, roof.grid[0]), rd = Math.max(0.5, roof.grid[2]);
    const W = bbox.maxX - bbox.minX, D = bbox.maxZ - bbox.minZ;
    const nx = Math.max(1, Math.round(W / rw));
    // ★ 坡屋顶人字铺设（2026-10-14）：坡屋顶件（高 > 最短边，与 validate flat 判据
    //   同款反向）自带斜面，按平板逻辑 nz 排平铺时每块的斜面高端悬空——
    //   实测 4 层楼屋顶左缘 3~4 块瓦片斜立翘起（用户截图看图发现）。
    //   正确铺法：屋脊沿长边 W，z 方向分两坡，每坡 rowsPerSide 排**阶梯抬升**
    //   （第 i 排 y += i×件高，前一块的高端 = 后一块的底，数学闭合），
    //   两坡在屋脊处相接。平板件（h ≤ 最短边）走原平铺，行为不变。
    const isPitched = (Number(roof.grid[1]) || 0) > Math.min(rw, rd) + 1e-6;
    if (!isPitched) {
      const nz = Math.max(1, Math.round(D / rd));
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const x = bbox.minX + (ix + 0.5) * (W / nx), z = bbox.minZ + (iz + 0.5) * (D / nz);
        // ★ 屋顶 y = 墙顶 + 0.05（2026-10-13）：旧公式 `topY + max(0.05, grid_h/2)` 假设
        //   "零件原点在包围盒中心"，对薄板（h=0.1）没事，但对坡屋顶件（Roof_Slate h=3）
        //   会把屋顶抬到墙顶上方 1.5m 悬空。Kenney/gltf 件原点都在底部（Ymin=0），
        //   底面贴墙顶只需一个防 z-fighting 的小抬升。
        if (push(mk(roof, x, z, 0, topY + 0.05))) roofCount++;
      }
    } else {
      // 四向斜檐（2026-10-14 v2）：坡屋顶件实为「平顶+四周斜檐」（渲染目检确认），
      // 阶梯抬升会变成悬浮盒子。正确用法是单层平铺、边缘件斜檐朝外（Kenney 塔
      // 顶系统的标准用法）——四坡向由边缘件 ry 决定，内部件保持 0。
      // ★ 中央盖板（2026-10-14 v3）：中央件也是坡件（中央平四周斜）→ 多件拼接后
      //   拼缝处形成天沟网格（渲染目检内天沟凹陷）。有平板楼板件（iFloor，非坡件
      //   前提下解析成功）时中央区改用平板封盖，只有外圈用坡件斜檐——天沟消失。
      // ★ 异形适配（2026-10-14 v4）：逐格做「格中心在 footprint 多边形内」测试——
      //   圆楼/L楼按矩形 bbox 平铺会让屋顶大范围悬空在墙外（可见缺陷）。
      //   「边缘」判定同样改为「某方向邻居出界」→ 斜檐朝那个方向。
      const nz = Math.max(1, Math.round(D / rd));
      const capPart = (iFloor && iFloor.partKey !== roof.partKey) ? iFloor : null;
      const inPoly = function (x, z) { return g.pointInPolygon({ dx: x, dz: z }, pts); };
      let laid = 0;
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const x = bbox.minX + (ix + 0.5) * (W / nx), z = bbox.minZ + (iz + 0.5) * (D / nz);
        if (!inPoly(x, z)) continue;                        // 格子在轮廓外：不铺
        // 边缘 = 某方向邻居（半格距）出界 → 斜檐朝那个方向；四邻全界内 → 中央区
        let ry = null;
        if (!inPoly(x, z - rd)) ry = 180;                   // 南邻出界：檐朝南
        else if (!inPoly(x, z + rd)) ry = 0;                // 北邻出界
        else if (!inPoly(x - rw, z)) ry = 90;               // 西邻出界
        else if (!inPoly(x + rw, z)) ry = 270;              // 东邻出界
        if (ry === null && capPart) {
          if (push(mk(capPart, x, z, 0, topY + 0.05))) { roofCount++; laid++; }
          continue;
        }
        if (ry === null) ry = 0;                            // 中央且无盖板：坡件平放
        if (push(mk(roof, x, z, ry, topY + 0.05))) { roofCount++; laid++; }
      }
      notes.push('坡屋顶四向斜檐铺设：' + laid + ' 件（' + nx + '×' + nz + ' 网格 ∩ footprint 多边形，边缘檐口朝外）');
    }
  }
  // ★ subBlocks（2026-10-12）：多块组合。原 recipe 一个块只能出一个"外壳"，
  //   城堡 = 主楼 + 四座角楼 + 一圈围墙 这种需求无法表达。subBlocks 让一个 building 块
  //   携带若干子结构（各有自己的 footprint/floors/parts），递归展开后并入本块。
  //   子块坐标相对本块 anchor；子块没给 parts 时继承父块 parts（省 token）。
  let subCount = 0, subParts = 0;
  if (Array.isArray(s.subBlocks) && s.subBlocks.length) {
    for (const sb of s.subBlocks) {
      if (!sb || typeof sb !== 'object') continue;
      const ax = Number(sb.anchor && sb.anchor.dx) || 0, az = Number(sb.anchor && sb.anchor.dz) || 0;
      const subSpec = {
        footprint: sb.footprint,
        floors: sb.floors != null ? sb.floors : Math.max(1, floors - 1),
        // 子块继承父块已定型的层高与后台默认层高，避免角楼层高和主楼不一致
        floorHeight: sb.floorHeight != null ? sb.floorHeight : floorHeight,
        door: sb.door || null,
        windows: sb.windows || null,
        parts: (sb.parts && typeof sb.parts === 'object') ? sb.parts : P,
        interior: (sb.interior && typeof sb.interior === 'object') ? sb.interior : null,
        // 子块不再递归 subBlocks（防爆），坡屋顶/平板屋顶槽位照常可用
      };
      const sub = await build(subSpec, c);
      if (!sub.ok) {
        notes.push('subBlock(' + ax + ',' + az + ') 展开失败：' + String(sub.code || '') + ' ' + String(sub.reason || '').slice(0, 120));
        continue;
      }
      subCount++; subParts += sub.parts.length;
      for (const p of sub.parts) {
        p.dx = g.r2(p.dx + ax); p.dz = g.r2(p.dz + az);
        push(p);                                   // 跨子块同位去重，避免两块互相嵌
      }
      for (const n of (sub.stats && sub.stats.notes) || []) notes.push('subBlock: ' + n);
    }
  }

  let truncated = false;
  if (maxObjects && parts.length > maxObjects) { notes.push('budget truncate ' + parts.length + ' -> ' + maxObjects); parts.length = maxObjects; truncated = true; }
  return { ok: true, parts: parts, stats: { recipe: 'building', count: parts.length, floors: floors, floorHeight: g.r2(floorHeight), wallRows: wallRows, wallH: g.r2(wallH), edges: edges.length, segLen: g.r2(segLen), roofCount: roofCount, doorSide: door ? doorSide : null, winPerWall: winPerWall, truncated: truncated, height: g.r2(floors * floorHeight), interiorFloors: iFloor ? floors : 0, interiorColumns: iCol ? floors * 5 : 0, furniture: furnTotal, subBlocks: subCount, subParts: subParts, bounds: g.boundsOf(parts), dropped: dropped, notes: notes } };
}
module.exports = { build: build, DEFAULT_FLOOR_HEIGHT: DEFAULT_FLOOR_HEIGHT, MAX_FLOORS: MAX_FLOORS };