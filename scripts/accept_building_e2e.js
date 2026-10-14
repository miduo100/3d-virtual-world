'use strict';
/**
 * accept_building_e2e.js —— AI 自由拼装 · building 链路回归套件（2026-10-13 固化）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 背景：候选池/校验/层高/interior/subBlocks 六轮迭代修了 6 个连环 bug，验收逻辑
 * 当时散在一次性的 _tmp_* 脚本里（gitignore、随用随删）。本套件把它们固化，
 * 任何人改动 src/worldai/** 后跑一遍即可确认没有悄悄弄坏已修好的行为。
 *
 * 用法（三级，默认最快最稳）：
 *   node scripts/accept_building_e2e.js          # L1 纯函数级：mock 零件，不连库，秒级
 *   node scripts/accept_building_e2e.js --db     # L2 连库：真实零件数据 + 候选池 finalize
 *   node scripts/accept_building_e2e.js --e2e    # L3 真实 LLM 端到端：建区域+落库（烧一次调用）
 * 三级可叠加：--db --e2e。
 *
 * 判据来源：全部对应一次实测事故（格栅墙/玻璃楼/屋顶悬空/截断回流/25m 怪楼…），
 * 每条 check 的 id 即事故编号，详情看 git log dcc2f567 提交信息。
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

const ARG_DB = process.argv.indexOf('--db') >= 0;
const ARG_E2E = process.argv.indexOf('--e2e') >= 0;

let pass = 0, fail = 0;
function check(id, desc, ok, detail) {
  if (ok) { pass++; console.log('  [PASS] ' + id + ' ' + desc); }
  else { fail++; console.log('  [FAIL] ' + id + ' ' + desc + (detail ? ' → ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.02 : tol); }

// ── mock 零件库（全部为实测中用过的真实值，勿改数值——改了判据就失真）──
const MOCK = {
  'wall': { role: 'wall', grid: [0.1, 2.4, 2] },
  'building_block': { role: 'wall', grid: [1, 0.625, 1] },
  'Brick_InteriorWall_1': { role: 'wall', grid: [2, 1, 0] },
  'Brick_InteriorWall_3': { role: 'wall', grid: [2, 3, 0] },
  'Wall_Arch': { role: 'wall', grid: [2, 3, 0.064] },
  'Building_Large_2': { role: 'wall', grid: [20.64, 28, 16.64] },
  'Roof_2x2': { role: 'roof', grid: [2, 0, 2] },
  'Roof_Slate_Center': { role: 'roof', grid: [2, 3, 2] },
  'tower_square_roof': { role: 'roof', grid: [1, 2.01, 1] },
  'Characters_Captain_Barbarossa': { role: 'roof', grid: [1.9679, 1.8495, 1.049] },
  'chimney_basic': { role: 'roof', grid: [0.2, 1, 0.2] },
  'Brick_Inset_Window': { role: 'window', grid: [4, 3, 0.3743] },
  'DoorFrame_Metal_Single': { role: 'door', grid: [0.92, 0.59, 0.31] },
  'column_thin': { role: 'column', grid: [0.3, 2.4, 0.3] },
  'Floor_2x2': { role: 'floor', grid: [2, 0.1, 2] },
  'Brick_BottomTrim': { role: 'cornice', grid: [2, 3, 0.229] },
  'bedSingle': { role: 'prop', grid: [1.62, 0.51, 1.89] },
  'chair': { role: 'prop', grid: [0.2, 0.47, 0.2] },
  'loungeSofa': { role: 'prop', grid: [2, 0.7, 0.9] },
  'fence_wood_panel': { role: 'railing', grid: [2, 1.2, 0.1] },
  'fence_post': { role: 'column', grid: [0.15, 1.4, 0.15] },
  'gate_wood': { role: 'door', grid: [3, 2, 0.12] },
  'tree_oak': { role: 'tree', grid: [2.5, 6, 2.5] },
  'tree_pine': { role: 'tree', grid: [2, 8, 2] },
  'flower_red': { role: 'plant', grid: [0.4, 0.35, 0.4] },
  'flower_yellow': { role: 'plant', grid: [0.4, 0.3, 0.4] },
  'garden_edge_stone': { role: 'trim', grid: [1, 0.3, 0.25] },
};
function mockResolver(key) {
  const m = MOCK[String(key)];
  if (!m) return Promise.resolve(null);
  return Promise.resolve({ part_key: String(key), part_role: m.role, grid: m.grid.slice(), model_path: '/mock/' + key + '.glb' });
}
const G = require('../src/worldai/recipes/geometry');
const V = require('../src/worldai/recipes/validate');
const R = require('../src/worldai/recipes');

const FP12x8 = [{ dx: 0, dz: 0 }, { dx: 12, dz: 0 }, { dx: 12, dz: 8 }, { dx: 0, dz: 8 }];
const BASE_PARTS = { wall: 'building_block', door: 'DoorFrame_Metal_Single', window: 'Brick_Inset_Window', roof: 'Roof_2x2' };

// ══════════════════ L1 纯函数级 ══════════════════
async function level1() {
  console.log('\n═══ L1 geometry：零厚度与 grid 兜底 ═══');
  // G-1 零厚度平板不被抬成 1（事故：屋顶悬空 0.5m / prompt 显示 2×1×2）
  const g1 = G.normGrid([2, 0, 2]);
  check('G-1', 'normGrid 保留零厚度（Roof_2x2 [2,0,2] 不被抬成 [2,1,2]）',
    g1[0] === 2 && g1[1] === 0 && g1[2] === 2, JSON.stringify(g1));
  const g2 = G.normGrid([undefined, null, -3]);
  check('G-2', '未提供/非法值才兜底 1', g2.every(function (v) { return v === 1; }), JSON.stringify(g2));

  console.log('\n═══ L1 building：层高 / 堆叠 / 限高 ═══');
  // H-1~3 层高优先级
  const r0 = await R.build('building', { footprint: FP12x8, floors: 3, parts: BASE_PARTS }, { partResolver: mockResolver });
  check('H-1', '无后台层高时退化为墙件高度 0.625m', r0.ok && near(r0.stats.floorHeight, 0.625), 'floorHeight=' + (r0.stats && r0.stats.floorHeight));
  const r1 = await R.build('building', { footprint: FP12x8, floors: 3, parts: BASE_PARTS }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('H-2', '后台层高 2.4 生效且对齐墙件整数倍（4×0.625=2.5，wallRows=4）',
    r1.ok && near(r1.stats.floorHeight, 2.5) && r1.stats.wallRows === 4,
    'floorHeight=' + (r1.stats && r1.stats.floorHeight) + ' wallRows=' + (r1.stats && r1.stats.wallRows));
  const r2 = await R.build('building', { footprint: FP12x8, floors: 2, parts: BASE_PARTS, floorHeight: 3 }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('H-3', 'spec.floorHeight 优先于后台配置（3 对齐 5×0.625=3.125）',
    near(r2.stats.floorHeight, 3.125), 'floorHeight=' + r2.stats.floorHeight);
  // H-4 事故：3 层楼 1.88m → 7.5m
  check('H-4', '3 层总高 = 3×2.5 = 7.5m（堆叠补足层高）', near(r1.stats.height, 7.5), 'height=' + r1.stats.height);

  // H-5 墙件本身够高时 wallRows=1
  const r3 = await R.build('building', { footprint: FP12x8, floors: 2, parts: { wall: 'wall', roof: 'Roof_2x2' } }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('H-5', '墙件 2.4m 时 wallRows=1（不堆叠）', r3.ok && r3.stats.wallRows === 1, 'wallRows=' + (r3.stats && r3.stats.wallRows));

  // H-6/H-7 max_height（事故：building_castle 8 层 25.54m > 24m——截断须在层高对齐后）
  const r4 = await R.build('building', { footprint: FP12x8, floors: 8, parts: BASE_PARTS }, { partResolver: mockResolver, floorHeight: 2.4, maxHeight: 10 });
  check('H-6', 'max_height=10 且层高 2.5 → floors 截断 4，总高 ≤ 10',
    r4.ok && r4.stats.floors === 4 && r4.stats.height <= 10.001, 'floors=' + r4.stats.floors + ' height=' + r4.stats.height);
  const r5 = await R.build('building', { footprint: FP12x8, floors: 8, parts: BASE_PARTS }, { partResolver: mockResolver, floorHeight: 2.4, maxHeight: 100 });
  check('H-7', 'max_height 宽裕时不截断', r5.stats.floors === 8, 'floors=' + r5.stats.floors);

  // H-8 墙件 Y 序列连续无跳空（事故：楼层之间一道缝）
  const ys = Array.from(new Set(r1.parts.filter(function (p) { return p.partKey === 'building_block'; }).map(function (p) { return p.level; }))).sort(function (a, b) { return a - b; });
  let gap = 0;
  for (let i = 1; i < ys.length; i++) if (Math.abs((ys[i] - ys[i - 1]) - 0.625) > 0.02) gap++;
  check('H-8', '墙件 Y 序列连续（阶跃恒=墙高 0.625）', gap === 0, '跳空 ' + gap + ' 处');

  console.log('\n═══ L1 building：屋顶 / 门让位 / interior ═══');
  // R-1 屋顶贴墙顶（事故：grid_h/2 抬升 → 3m 坡屋顶悬空 1.5m）
  const rTop = Math.max.apply(null, r1.parts.filter(function (p) { return p.partKey === 'Roof_2x2'; }).map(function (p) { return p.level; }));
  check('R-1', '屋顶 y = 墙顶 + 0.05（不悬空）', near(rTop, 3 * 2.5 + 0.05, 0.06), '屋顶 y=' + rTop + ' 墙顶=' + 3 * 2.5);

  // D-1 门让位（事故：门周围 1.5m 内 29 个墙件，侧面看是堵死的）
  const r6 = await R.build('building', {
    footprint: FP12x8, floors: 2,
    parts: { wall: 'Brick_InteriorWall_3', door: 'DoorFrame_Metal_Single', roof: 'Roof_2x2' },
    door: { side: 'south', position: 0.5 },
  }, { partResolver: mockResolver, floorHeight: 2.4 });
  const doorP = r6.parts.filter(function (p) { return p.partKey === 'DoorFrame_Metal_Single'; })[0];
  const crowd = doorP ? r6.parts.filter(function (p) {
    return p !== doorP && p.level === doorP.level
      && Math.abs(p.dx - doorP.dx) < 2.2 && Math.abs(p.dz - doorP.dz) < 0.3;
  }).length : -1;
  check('D-1', '门两侧让位（±2.2m 内墙件 ≤1）', r6.ok && crowd <= 1, '挤着 ' + crowd + ' 个');

  // I-1~3 interior 楼板兜底链
  const i1 = await R.build('building', { footprint: FP12x8, floors: 3, parts: BASE_PARTS }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('I-1', '不填 interior 也自动铺楼板（roof 平板兜底）',
    i1.parts.filter(function (p) { return p.partKey === 'Roof_2x2'; }).length > 24);
  const i2 = await R.build('building', { footprint: FP12x8, floors: 3, parts: BASE_PARTS, interior: { floor: false } }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('I-2', 'interior.floor=false 可关闭（只剩屋顶 24 件）',
    i2.parts.filter(function (p) { return p.partKey === 'Roof_2x2'; }).length === 24);
  // 事故：3m 坡屋顶件当楼板 → 楼板厚 3m
  const i3 = await R.build('building', { footprint: FP12x8, floors: 3, parts: { wall: 'building_block', roof: 'Roof_Slate_Center' } }, { partResolver: mockResolver, floorHeight: 2.4 });
  const slateLow = i3.parts.filter(function (p) { return p.partKey === 'Roof_Slate_Center' && p.level < 7.5 - 0.1; });
  check('I-3', '坡屋顶件（非平板）不兜底当楼板', slateLow.length === 0, '混进楼板 ' + slateLow.length + ' 件');
  const i4 = await R.build('building', { footprint: FP12x8, floors: 3, parts: { wall: 'building_block', roof: 'Roof_Slate_Center', floor: 'Floor_2x2' } }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('I-4', 'parts.floor 有平板件时楼板用它', i4.parts.some(function (p) { return p.partKey === 'Floor_2x2'; }));
  const i5 = await R.build('building', { footprint: FP12x8, floors: 3, parts: BASE_PARTS, interior: { floor: 'Floor_2x2', column: 'column_thin' } }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('I-5', '显式 interior.floor/column 生效',
    i5.parts.some(function (p) { return p.partKey === 'Floor_2x2'; }) && i5.parts.some(function (p) { return p.partKey === 'column_thin'; }));
  // I-6 楼板只铺非顶层（顶层顶面是屋顶位，抢位会被去重吃掉）
  const topY3 = 3 * 2.5;
  const slabTop = i1.parts.filter(function (p) { return p.partKey === 'Roof_2x2' && Math.abs(p.level - (topY3 + 0.05)) < 0.06; }).length;
  check('I-6', '顶层顶面只有屋顶、无楼板抢位', slabTop === 24, '该高度上 ' + slabTop + ' 件（应=屋顶 24）');

  // F-1~4 interior.furniture 家具散点（2026-10-13）
  const FURN = { wall: 'building_block', roof: 'Roof_2x2', floor: 'Floor_2x2' };
  const f1 = await R.build('building', {
    footprint: FP12x8, floors: 3,
    parts: Object.assign({}, BASE_PARTS, FURN),
    interior: { furniture: ['bedSingle', 'chair', 'loungeSofa'] },
  }, { partResolver: mockResolver, floorHeight: 2.4, seedStr: 'seedA' });
  const f1Beds = f1.parts.filter(function (p) { return p.partKey === 'bedSingle'; }).length;
  check('F-1', '家具散点落位（bed/chair/sofa 每层都有）',
    f1.ok && f1Beds >= 3 && f1.parts.some(function (p) { return p.partKey === 'chair'; })
      && f1.parts.some(function (p) { return p.partKey === 'loungeSofa'; }),
    'bed×' + f1Beds + ' stats.furniture=' + (f1.stats && f1.stats.furniture));
  const f1In = f1.parts.filter(function (p) { return ['bedSingle', 'chair', 'loungeSofa'].indexOf(p.partKey) >= 0; });
  check('F-2', '家具全部落在墙体内部（inset 内，不与外墙重叠）',
    f1In.every(function (p) { return p.dx > 0.5 && p.dx < 12 - 0.5 && p.dz > 0.5 && p.dz < 8 - 0.5; }));
  const f1b = await R.build('building', {
    footprint: FP12x8, floors: 3,
    parts: Object.assign({}, BASE_PARTS, FURN),
    interior: { furniture: ['bedSingle', 'chair', 'loungeSofa'] },
  }, { partResolver: mockResolver, floorHeight: 2.4, seedStr: 'seedA' });
  const sig = function (r) { return r.parts.filter(function (p) { return ['bedSingle', 'chair', 'loungeSofa'].indexOf(p.partKey) >= 0; }).map(function (p) { return p.partKey + '@' + p.dx + ',' + p.dz + ',' + p.ry; }).join('|'); };
  check('F-3', '同种子逐字节相同（幂等重跑不重复）', sig(f1) === sig(f1b));
  const f1c = await R.build('building', {
    footprint: FP12x8, floors: 3,
    parts: Object.assign({}, BASE_PARTS, FURN),
    interior: { furniture: ['bedSingle', 'chair', 'loungeSofa'] },
  }, { partResolver: mockResolver, floorHeight: 2.4, seedStr: 'seedB' });
  check('F-4', '换种子布局不同', sig(f1) !== sig(f1c));
  const f1d = await R.build('building', {
    footprint: FP12x8, floors: 3,
    parts: Object.assign({}, BASE_PARTS, FURN),
    interior: { furniture: ['bedSingle', 'nonexistent_bed'] },
  }, { partResolver: mockResolver, floorHeight: 2.4 });
  check('F-5', '编造家具键显式记账且好键仍散点',
    f1d.ok && f1d.stats.dropped.unknownPart === 1 && f1d.parts.some(function (p) { return p.partKey === 'bedSingle'; })
      && (f1d.stats.notes || []).some(function (n) { return /nonexistent_bed/.test(n); }));

  // W-1~4 fence recipe（2026-10-13）
  const RECT = [{ dx: 0, dz: 0 }, { dx: 20, dz: 0 }, { dx: 20, dz: 15 }, { dx: 0, dz: 15 }];
  const w1 = await R.build('fence', {
    polygon: RECT, gate_position: 0.5,
    parts: { fence: 'fence_wood_panel', post: 'fence_post', gate: 'gate_wood' },
  }, { partResolver: mockResolver, seedStr: 'f1' });
  check('W-1', 'fence 矩形围墙闭环展开（panel+post+gate 全落）',
    w1.ok && w1.parts.length > 20 && w1.stats.posts === 4 && w1.stats.gate === 'gate_wood',
    w1.ok ? 'panels=' + w1.stats.panels + ' posts=' + w1.stats.posts : w1.code + ' ' + w1.reason);
  if (w1.ok) {
    // 周长 70m / 步长 2m = 35 位 − 4 角柱 − 1 门 = 30 栏板（采样含两端，角点由去重合并）
    const panels = w1.parts.filter(function (p) { return p.partKey === 'fence_wood_panel'; }).length;
    check('W-2', '栏板数 ≈ 周长/步长 − 4 角柱 − 1 门（≈30，容差 ±3）', Math.abs(panels - 30) <= 3, 'panels=' + panels);
    const gateP = w1.parts.filter(function (p) { return p.partKey === 'gate_wood'; })[0];
    check('W-3', '大门嵌在第一段 50% 处（x≈10, z=0）', gateP && Math.abs(gateP.dx - 10) <= 1.2 && Math.abs(gateP.dz) <= 0.3,
      gateP ? '(' + gateP.dx + ',' + gateP.dz + ')' : '无门');
    const kws = w1.parts.map(function (p) { return Math.round(p.dx * 100) + ':' + Math.round(p.dz * 100); });
    check('W-4', '同位去重（无重复键）', new Set(kws).size === kws.length);
  }
  // gate_align：楼门在 (10, -3)（院子北侧外）→ 门应开在北边 z=15 的墙段上 x≈10 处
  const w4 = await R.build('fence', {
    polygon: RECT, gate_align: { dx: 10, dz: 18 },
    parts: { fence: 'fence_wood_panel', gate: 'gate_wood' },
  }, { partResolver: mockResolver, seedStr: 'f4' });
  const w4gate = w4.ok ? w4.parts.filter(function (p) { return p.partKey === 'gate_wood'; })[0] : null;
  check('W-7', 'gate_align 门开在离参考点最近的段上（北墙 z=15、x≈10）',
    w4gate && Math.abs(w4gate.dz - 15) <= 0.3 && Math.abs(w4gate.dx - 10) <= 1.5,
    w4gate ? '(' + w4gate.dx + ',' + w4gate.dz + ')' : (w4.ok ? '无门' : w4.code));
  const w5 = await R.build('fence', {
    polygon: RECT, gate_position: 0.5,
    parts: { fence: 'fence_wood_panel', gate: 'gate_wood' },
  }, { partResolver: mockResolver, seedStr: 'f5' });
  check('W-8', '无 gate_align 时保持旧行为（门在第一段 50% 处）', w5.ok && w5.stats.gateAlign === false,
    w5.ok ? 'gateAlign=' + w5.stats.gateAlign : w5.code);
  const w2 = await R.build('fence', { polygon: RECT, parts: { fence: 'nonexistent_panel' } }, { partResolver: mockResolver });
  check('W-5', 'fence 槽编造键显式拒绝', !w2.ok && w2.code === 'RECIPE_ALL_PARTS_UNKNOWN', w2.ok ? '被放行！' : w2.code);
  const w3 = await R.build('fence', { parts: { fence: 'fence_wood_panel' } }, { partResolver: mockResolver });
  check('W-6', '缺 polygon 明确报错', !w3.ok && w3.code === 'RECIPE_SPEC_INCOMPLETE');

  // F-1~5 forest / G-1~7 garden（2026-10-13）
  const fo1 = await R.build('forest', {
    count: 15, size: { width: 25, depth: 20 }, around: { dx: 10, dz: 8 },
    partKeys: ['tree_oak', 'tree_pine'],
  }, { partResolver: mockResolver, seedStr: 'fo1' });
  check('F-1', 'forest 泊松盘展开（15 棵、围绕中心偏移）',
    fo1.ok && fo1.parts.length >= 12 && fo1.stats.requested === 15,
    fo1.ok ? '实放=' + fo1.parts.length + ' radius=' + fo1.stats.radius : fo1.code + ' ' + fo1.reason);
  if (fo1.ok) {
    const oak = fo1.parts.filter(function (p) { return p.partKey === 'tree_oak'; }).length;
    const pine = fo1.parts.filter(function (p) { return p.partKey === 'tree_pine'; }).length;
    check('F-2', '两树种混种（都出现）', oak > 0 && pine > 0, 'oak=' + oak + ' pine=' + pine);
    const minDist = (function () {
      let m = Infinity;
      for (let i = 0; i < fo1.parts.length; i++) for (let j = i + 1; j < fo1.parts.length; j++) {
        const dx = fo1.parts[i].dx - fo1.parts[j].dx, dz = fo1.parts[i].dz - fo1.parts[j].dz;
        m = Math.min(m, Math.sqrt(dx * dx + dz * dz));
      }
      return m;
    })();
    check('F-3', '最小间距 ≥ radiusFor 下限（2.5×1.2=3.0m）', minDist >= 2.9, 'minDist=' + minDist.toFixed(2));
    const inside = fo1.parts.every(function (p) {
      return p.dx >= 10 - 12.5 && p.dx <= 10 + 12.5 && p.dz >= 8 - 10 && p.dz <= 8 + 10;
    });
    check('F-4', '全部落在 around ± size/2 内', inside);
    const fo2 = await R.build('forest', { count: 15, partKeys: ['tree_oak', 'tree_pine'] }, { partResolver: mockResolver, seedStr: 'fo1' });
    const fo2b = await R.build('forest', { count: 15, partKeys: ['tree_oak', 'tree_pine'] }, { partResolver: mockResolver, seedStr: 'fo1' });
    check('F-5', '同种子幂等（坐标逐字节一致）', fo2.ok && fo2b.ok &&
      JSON.stringify(fo2.parts) === JSON.stringify(fo2b.parts));
    const fo3 = await R.build('forest', { count: 5, partKeys: ['ghost_tree'] }, { partResolver: mockResolver });
    check('F-6', '树种编造键显式拒绝', !fo3.ok && fo3.code === 'RECIPE_ALL_PARTS_UNKNOWN', fo3.ok ? '被放行！' : fo3.code);
  }
  const ga1 = await R.build('garden', {
    shape: 'rect', size: { width: 8, depth: 5 },
    flower_types: ['flower_red', 'flower_yellow'], parts: { edge: 'garden_edge_stone' },
  }, { partResolver: mockResolver, seedStr: 'ga1' });
  check('G-1', 'garden 矩形花坛（围边+花卉）', ga1.ok && ga1.stats.edgeCount >= 20 && ga1.stats.flowerCount >= 3,
    ga1.ok ? 'edge=' + ga1.stats.edgeCount + ' flower=' + ga1.stats.flowerCount : ga1.code + ' ' + ga1.reason);
  if (ga1.ok) {
    const inb = ga1.parts.every(function (p) { return Math.abs(p.dx) <= 4.01 && Math.abs(p.dz) <= 2.51; });
    check('G-2', '全部落在 size 矩形内', inb);
    const flowers = ga1.parts.filter(function (p) { return p.partKey !== 'garden_edge_stone'; });
    const onEdge = flowers.filter(function (p) { return Math.abs(Math.abs(p.dx) - 4) < 0.3 || Math.abs(Math.abs(p.dz) - 2.5) < 0.3; }).length;
    check('G-3', '花卉内缩不压围边（贴边 0.3m 内的 ≤2 株）', onEdge <= 2, '贴边=' + onEdge);
    const ga2 = await R.build('garden', {
      shape: 'circle', size: { width: 10, depth: 10 },
      flower_types: ['flower_red'], parts: { edge: 'garden_edge_stone' },
    }, { partResolver: mockResolver, seedStr: 'ga2' });
    const circOk = ga2.ok && ga2.parts.every(function (p) {
      return Math.sqrt(p.dx * p.dx + p.dz * p.dz) <= 5.01;
    });
    check('G-4', '圆形花坛：围边半径 5m、花卉在内切圆内', circOk, ga2.ok ? 'count=' + ga2.parts.length : ga2.code);
    const ga3 = await R.build('garden', { size: { width: 8, depth: 5 }, flower_types: ['no_such_flower'] }, { partResolver: mockResolver });
    check('G-5', '花卉编造键显式拒绝', !ga3.ok && ga3.code === 'RECIPE_ALL_PARTS_UNKNOWN', ga3.ok ? '被放行！' : ga3.code);
    const ga4 = await R.build('garden', { shape: 'rect', size: { width: 8, depth: 5 }, parts: { edge: 'garden_edge_stone' } }, { partResolver: mockResolver });
    check('G-6', '缺 flower_types 明确报错', !ga4.ok && ga4.code === 'RECIPE_SPEC_INCOMPLETE');
    const ga5 = await R.build('garden', {
      shape: 'rect', size: { width: 8, depth: 5 },
      flower_types: ['flower_red', 'flower_yellow'], parts: { edge: 'garden_edge_stone' },
    }, { partResolver: mockResolver, seedStr: 'ga1' });
    check('G-7', '同种子幂等', ga5.ok && JSON.stringify(ga5.parts) === JSON.stringify(ga1.parts));
  }

  // S-1 subBlocks（事故：城堡只有外壳；角楼 anchor 偏移丢失）
  const s1 = await R.build('building', {
    footprint: FP12x8, floors: 3, parts: BASE_PARTS,
    subBlocks: [
      { anchor: { dx: -4, dz: -4 }, footprint: [{ dx: 0, dz: 0 }, { dx: 4, dz: 0 }, { dx: 4, dz: 4 }, { dx: 0, dz: 4 }], floors: 5, parts: { wall: 'building_block', roof: 'Roof_2x2' } },
      { anchor: { dx: 16, dz: 12 }, footprint: [{ dx: 0, dz: 0 }, { dx: 4, dz: 0 }, { dx: 4, dz: 4 }, { dx: 0, dz: 4 }], floors: 5 },
    ],
  }, { partResolver: mockResolver, floorHeight: 2.4 });
  const xsAll = s1.ok ? s1.parts.map(function (p) { return p.dx; }) : [0];
  check('S-1', 'subBlocks 展开且 anchor 偏移生效（x 范围超出主体 0~12）',
    s1.ok && Math.min.apply(null, xsAll) < 0 && Math.max.apply(null, xsAll) > 12,
    'x ' + Math.min.apply(null, xsAll) + '~' + Math.max.apply(null, xsAll));
  const keysS = s1.parts.map(function (p) { return Math.round(p.dx * 100) + ':' + Math.round(p.dz * 100) + ':' + p.level; });
  check('S-2', '跨子块同位去重（无重复键）', new Set(keysS).size === keysS.length);

  console.log('\n═══ L1 validate：partKeys / 三道闸 ═══');
  // V-1 事故：.map(String) 返回槽位名，AI 实填键从未被校验
  const pk = V.SPEC_RULES.building.partKeys({ parts: { wall: 'Brick_InteriorWall_3', roof: 'Roof_2x2' } });
  check('V-1', 'partKeys 返回实键（非槽位名）', pk.indexOf('Brick_InteriorWall_3') >= 0 && pk.indexOf('wall') < 0, JSON.stringify(pk));
  // V-2 槽位 role 对应（事故：AI 拿窗户件当墙 → 玻璃楼）
  const vW = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'Brick_Inset_Window', roof: 'Roof_2x2' } } }, { partResolver: mockResolver });
  check('V-2', 'wall 槽填 role=window 件被拒（RECIPE_PART_ROLE_MISMATCH）',
    !vW.ok && vW.code === 'RECIPE_PART_ROLE_MISMATCH', vW.ok ? '被放行！' : vW.code);
  // V-3 拱形薄片墙（事故：Wall_Arch 34 件拱洞墙，整栋看穿）
  const vA = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'Wall_Arch', roof: 'Roof_2x2' } } }, { partResolver: mockResolver });
  check('V-3', 'wall 槽填拱形件被拒', !vA.ok && vA.code === 'RECIPE_PART_SHAPE_MISMATCH', vA.ok ? '被放行！' : vA.code);
  // V-4 整栋模型当墙（事故：层高 25m 怪楼）
  const vB = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'Building_Large_2', roof: 'Roof_2x2' } } }, { partResolver: mockResolver });
  check('V-4', '整栋模型填 wall 槽被拒', !vB.ok && vB.code === 'RECIPE_PART_SHAPE_MISMATCH', vB.ok ? '被放行！' : vB.code);
  // V-5 角色模型当屋顶（事故：48 个海盗当瓦片）
  const vC = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'building_block', roof: 'Characters_Captain_Barbarossa' } } }, { partResolver: mockResolver });
  check('V-5', '角色模型填 roof 槽被拒', !vC.ok && vC.code === 'RECIPE_PART_SHAPE_MISMATCH', vC.ok ? '被放行！' : vC.code);
  // V-6 坡屋顶合法（误杀修复后不得再拒）
  const vD = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'building_block', roof: 'Roof_Slate_Center' } } }, { partResolver: mockResolver });
  check('V-6', '坡屋顶件填 roof 槽放行', vD.ok, vD.ok ? '' : vD.code + ' ' + vD.reason);
  const vE = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'building_block', roof: 'tower_square_roof' } } }, { partResolver: mockResolver });
  check('V-7', '塔顶件填 roof 槽放行', vE.ok, vE.ok ? '' : vE.code);
  const vF = await V.validateRecipeBlock({ mode: 'recipe', recipe: 'building', spec: { footprint: FP12x8, floors: 2, parts: { wall: 'building_block', roof: 'chimney_basic' } } }, { partResolver: mockResolver });
  check('V-8', '烟囱填 roof 槽被拒', !vF.ok, vF.ok ? '被放行！' : vF.code);
}

// ══════════════════ L2 连库级 ══════════════════
async function level2() {
  const { query } = require('../src/database/db');
  const pool = require('../src/worldai/missions/candidatePool');
  const assetSearch = require('../src/worldai/tools/assetSearch');
  console.log('\n═══ L2 数据：part_role 修正生效 ═══');
  const badWall = (await query(
    "SELECT count(*)::int n FROM part_library_items i JOIN part_libraries l ON l.id=i.library_id "
    + "WHERE l.status='active' AND i.part_role='wall' AND GREATEST(i.grid_w, i.grid_d) > 2.5")).rows[0].n;
  check('E-1', 'role=wall 无整栋模型（>2.5m）', badWall === 0, badWall + ' 件残留');
  const chim = (await query(
    "SELECT count(*)::int n FROM part_library_items WHERE part_role='roof' AND part_key ILIKE 'chimney%'")).rows[0].n;
  check('E-2', 'chimney 不再标成 roof', chim === 0, chim + ' 件残留');

  console.log('\n═══ L2 candidatePool.finalize 全链路 ═══');
  const merged = new Map();
  for (const k of ['castle', 'stone', 'roof', 'slate']) {
    const r = await assetSearch.searchParts({ keyword: k, limit: 12 });
    (r.items || []).forEach(function (it) { if (!merged.has(it.partKey)) merged.set(it.partKey, it); });
  }
  const fin = await pool.finalize({
    candidates: { items: Array.from(merged.values()) },
    keywordHits: new Set(merged.keys()), constraints: {},
    prompt: '建一座中世纪石头城堡，屋顶用坡屋顶',
  });
  check('C-1', 'finalize 产出 ≤24 件', fin.items.length <= 24, fin.items.length + ' 件');
  const NEED = ['wall', 'door', 'window', 'roof'];
  const roles = {};
  fin.items.forEach(function (x) { roles[x.role] = (roles[x.role] || 0) + 1; });
  check('C-2', 'building 必需 role 齐活', NEED.every(function (r) { return roles[r]; }),
    '缺 ' + NEED.filter(function (r) { return !roles[r]; }).join(','));
  const firstRoof = fin.items.filter(function (x) { return x.role === 'roof'; })[0];
  check('C-3', '委托提坡屋顶 → 第一个 roof 是坡屋顶件',
    firstRoof && pool.isSlopeRoof(firstRoof), firstRoof ? firstRoof.partKey : '无 roof');
  const narrowWalls = fin.items.filter(function (x) { return x.role === 'wall' && Math.min(x.grid[0], x.grid[2]) < 1.5; });
  const bigWalls = fin.items.filter(pool.isBigWall);
  check('C-4', '池内无窄墙件（或该包本无大墙件）', narrowWalls.length === 0 || bigWalls.length === 0,
    '窄墙 ' + narrowWalls.length + ' / 大墙 ' + bigWalls.length);
  const fin2 = await pool.finalize({ candidates: { items: Array.from(merged.values()) }, keywordHits: new Set(), constraints: {}, prompt: '建一栋现代办公楼' });
  check('C-5', '不提坡屋顶时 finalize 正常（不误伤现代建筑）', fin2.items.length > 0 && fin2.items.length <= 24);
}

// ══════════════════ L3 真实 LLM 端到端 ══════════════════
async function level3() {
  const { query } = require('../src/database/db');
  const regionService = require('../src/worldai/regions/regionService');
  const missionService = require('../src/worldai/missions/missionService');
  const missionRunner = require('../src/worldai/missions/missionRunner');
  console.log('\n═══ L3 真实 LLM 端到端（会写库、烧一次 LLM 调用）═══');
  const old = await query("SELECT id FROM world_build_missions WHERE region_key LIKE 'accept_e2e_%'");
  for (const m of old.rows) {
    await query("DELETE FROM world_objects WHERE created_by = '" + String(m.id).replace(/'/g, '') + "' AND origin = 'ai'");
    await query("DELETE FROM world_build_missions WHERE id = '" + String(m.id).replace(/'/g, '') + "'");
  }
  await query("DELETE FROM world_regions WHERE region_key LIKE 'accept_e2e_%'");
  const RK = 'accept_e2e_' + Date.now().toString(36);
  // ★ 选址必须在无既有对象的空地：曾用 (-66,-87) 压在展示楼上（202 件假警报），
  //   又试 (3000,3000) 撞上 zhizhu12/my_forest333/xiaowu 三个区域（19 件假警报）。
  //   (500,500) 经查 0 对象 0 区域，是真空地。换地址前先跑 scripts/_tmp_site 类查询。
  const B = { x: 500, z: 500, width: 60, depth: 60, kind: 'rect' };
  // 双保险：清掉该窗口内的 AI 残留
  const stale = await query(
    "SELECT id FROM world_build_missions WHERE id::text IN "
    + '(SELECT created_by FROM world_objects WHERE origin = \'ai\' AND position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4)',
    [B.x, B.x + B.width, B.z, B.z + B.depth]
  );
  for (const m of stale.rows) {
    await query("DELETE FROM world_objects WHERE created_by = '" + String(m.id).replace(/'/g, '') + "' AND origin = 'ai'");
    await query("DELETE FROM world_build_missions WHERE id = '" + String(m.id).replace(/'/g, '') + "'");
  }
  await regionService.createRegion({ regionKey: RK, name: '回归验收', worldId: '', autonomy: 'autonomous', bounds: B, notes: 'accept' });
  const ms = await missionService.createMission({
    regionKey: RK, prompt: '建一栋三层住宅楼，带坡屋顶，要有窗户和门', createdBy: 'accept', worldId: '',
    constraints: { max_objects: 1200, placement_policy: 'avoid', max_height: 30 },
  });
  const run = await missionRunner.run(ms.mission.id, {});
  const ex = ((await query('SELECT executed_stats FROM world_build_missions WHERE id=$1', [ms.mission.id])).rows[0] || {}).executed_stats || {};
  const objs = (await query('SELECT name FROM world_objects WHERE created_by=$1', [ms.mission.id])).rows;
  const by = {};
  objs.forEach(function (o) { by[o.name] = (by[o.name] || 0) + 1; });
  const names = Object.keys(by);
  check('E2E-1', 'run ok 且落库 >0 件', run.ok && objs.length > 0, objs.length + ' 件');
  check('E2E-2', 'skippedByCollision=0（同批不互判）', (ex.skippedByCollision || 0) === 0, 'skipped=' + ex.skippedByCollision);
  check('E2E-3', '墙件落了（存在 role=wall 的件）', names.some(function (n) { return MOCK[n] && MOCK[n].role === 'wall'; }), names.join(',').slice(0, 120));
  check('E2E-4', '屋顶落了', names.some(function (n) { return /roof|slate/i.test(n); }), names.join(',').slice(0, 120));
  const doorNames = Object.keys(by).filter(function (n) { return /door/i.test(n); });
  const doorTotal = doorNames.reduce(function (s, n) { return s + by[n]; }, 0);
  check('E2E-5', '门落了（且只 1 件，不限型号）', doorTotal === 1, doorNames.map(function (n) { return n + '×' + by[n]; }).join(','));
  check('E2E-6', '窗落了', names.some(function (n) { return /window/i.test(n); }));
  // 拒因回流自愈：两轮内必须产出可用方案（objectsCreated>0 即证明第二轮修正成功）
  check('E2E-7', '两轮内自愈（llmCalls ≤ 3 且有产出）', (ex.llmCalls || 0) <= 3 && objs.length > 0, 'llmCalls=' + ex.llmCalls);
  console.log('  （区域 ' + RK + ' 保留，可在世界内查看）');
}

(async function () {
  console.log('AI 自由拼装 · building 链路回归套件'
    + (ARG_E2E ? ' [L1+L2+L3]' : ARG_DB ? ' [L1+L2]' : ' [L1]'));
  await level1();
  if (ARG_DB || ARG_E2E) await level2();
  if (ARG_E2E) await level3();
  console.log('\n═══ 总计：' + pass + ' PASS / ' + fail + ' FAIL ═══');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', (e && e.stack) || e); process.exit(1); });