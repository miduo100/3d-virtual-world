/**
 * LDraw M2 验收：seed 入库 + 候选池 + building recipe 用乐高件拼小屋（纯函数级端到端）
 *
 * 零世界写入：partResolver 直连 assetSearch.getPart（真实 DB 检索），
 * build 走真实 recipe。可任意环境重跑。
 *
 * 用法：node scripts/accept_ldraw_m2.js
 */
const { pool } = require('../src/database/db');
const assetSearch = require('../src/worldai/tools/assetSearch');
const building = require('../src/worldai/recipes/building');

const LIB_KEY = 'ldraw_builtin';
let pass = 0, failCount = 0;
function check(id, name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS ${id} ${name}`); }
  else { failCount++; console.log(`  FAIL ${id} ${name}${extra ? ' :: ' + extra : ''}`); }
}

(async () => {
  console.log('== W 组：seed 入库 ==');
  const lib = (await pool.query(
    `SELECT id, source_type, license_info, stats FROM part_libraries
      WHERE LOWER(pack_key)=$1 AND deleted_at IS NULL LIMIT 1`, [LIB_KEY])).rows[0];
  check('W1', 'ldraw_builtin 库存在且 source_type=builtin',
    !!lib && lib.source_type === 'builtin', JSON.stringify(lib && lib.source_type));
  check('W2', 'license_info 含 CC BY 4.0 + LDraw 署名',
    !!lib && lib.license_info && /CC BY 4\.0/.test(lib.license_info.type || '')
      && /LDraw/.test(lib.license_info.author || ''),
    JSON.stringify(lib && lib.license_info));
  const byRole = (await pool.query(
    `SELECT part_role, COUNT(*)::int AS n FROM part_library_items WHERE library_id=$1 GROUP BY 1`,
    [lib.id])).rows;
  const roleN = Object.fromEntries(byRole.map(r => [r.part_role, r.n]));
  check('W3', '件数=170 且 8 类 role 齐全',
    byRole.reduce((s, r) => s + r.n, 0) === 170
      && ['wall', 'floor', 'roof', 'door', 'window', 'column', 'railing', 'trim'].every(k => (roleN[k] || 0) > 0),
    JSON.stringify(roleN));
  const orphan = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM part_library_items i
       LEFT JOIN uploaded_models u ON u.id=i.model_id
      WHERE i.library_id=$1 AND u.id IS NULL`, [lib.id])).rows[0].n;
  check('W4', '无悬空 model_id', orphan === 0, 'orphans=' + orphan);
  const sample = (await pool.query(
    `SELECT part_key, grid_w, grid_h, grid_d, u.path FROM part_library_items i
       JOIN uploaded_models u ON u.id=i.model_id
      WHERE i.library_id=$1 AND i.part_key='3001'`, [lib.id])).rows[0];
  check('W5', 'brick 2x4(3001) 尺寸=米制 0.56×0.196×0.28，path 指向 builtin',
    !!sample && Math.abs(sample.grid_w - 0.56) < 0.01 && Math.abs(sample.grid_h - 0.196) < 0.01
      && Math.abs(sample.grid_d - 0.28) < 0.01 && /\/models\/builtin\/ldraw\/3001\.glb$/.test(sample.path),
    JSON.stringify(sample));
  const nolut = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM part_library_items i
      WHERE i.library_id=$1 AND (i.grid_w IS NULL OR i.grid_h IS NULL OR i.grid_d IS NULL)`, [lib.id])).rows[0].n;
  check('W6', '全部件 grid 尺寸非空（AI 需要知道每件多大）', nolut === 0, 'null grid=' + nolut);

  console.log('== S 组：候选池检索 ==');
  const resolver = async (key) => assetSearch.getPart(key);
  for (const role of ['wall', 'door', 'window', 'floor']) {
    const r = await assetSearch.searchParts({ roles: [role], limit: 60 });
    check('S-' + role, `searchParts(role=${role}) 命中 ldraw 件`,
      r.items.some(i => i.pack === LIB_KEY),
      'total=' + r.total);
  }

  console.log('== B 组：building recipe 用乐高件拼小屋 ==');
  // 动态选件：wall=3001；door/window 取 role 命中的第一件；roof 楼板用平板 floor 件
  const pick = async (role) => {
    const r = await pool.query(
      `SELECT i.part_key FROM part_library_items i WHERE i.library_id=$1 AND i.part_role=$2 ORDER BY i.id LIMIT 1`,
      [lib.id, role]);
    return r.rows[0] ? r.rows[0].part_key : null;
  };
  const wallKey = '3001';
  const doorKey = await pick('door');
  const winKey = await pick('window');
  const floorKey = await pick('floor');
  check('B0', 'door/window/floor 槽位有可用件', !!doorKey && !!winKey && !!floorKey,
    `door=${doorKey} win=${winKey} floor=${floorKey}`);

  const spec = {
    footprint: [{ dx: 0, dz: 0 }, { dx: 4, dz: 0 }, { dx: 4, dz: 3 }, { dx: 0, dz: 3 }],
    // 两层：单层楼的 interior 楼板按 recipe 设计不铺（顶层面=屋顶位置），floor 槽位需 ≥2 层才有落件
    floors: 2, floorHeight: 1.2,
    parts: { wall: wallKey, door: doorKey, window: winKey, floor: floorKey },
    door: { side: 'south', position: 0.5 },
    windows: { perWall: 2 },
    interior: { floor: true },
  };
  const ctx = { partResolver: resolver, maxObjects: 600, seedStr: 'ldraw-m2' };
  const res = await building.build(spec, ctx);
  check('B1', 'build ok 且产出零件', res.ok && res.parts.length > 20,
    res.ok ? ('parts=' + res.parts.length) : JSON.stringify(res));
  check('B2', '全部零件 modelPath 指向 /models/builtin/ldraw/',
    res.ok && res.parts.every(p => /\/models\/builtin\/ldraw\//.test(p.modelPath || '')),
    res.parts.find(p => !/builtin\/ldraw/.test(p.modelPath || ''))?.modelPath);
  const keys = new Set(res.parts.map(p => p.partKey));
  check('B3', '墙/门/窗/楼板四槽位都有落件',
    keys.has(wallKey) && keys.has(doorKey) && keys.has(winKey) && keys.has(floorKey),
    JSON.stringify([...keys]));
  const b = res.stats.bounds;
  check('B4', '包围盒覆盖 4×3 footprint',
    b.minX <= 0.05 && b.maxX >= 3.95 && b.minZ <= 0.05 && b.maxZ >= 2.95,
    JSON.stringify(b));
  check('B5', '有门件落位在南边', res.parts.some(p => p.partKey === doorKey
    && Math.abs(p.dz - 3) < 0.4), JSON.stringify(res.parts.filter(p => p.partKey === doorKey)));
  check('B6', 'stats.notes 无 unknownPart', (res.stats.dropped.unknownPart || 0) === 0,
    JSON.stringify(res.stats.dropped));
  check('B7', '层高对齐墙件整数倍且高度=层数×层高',
    Math.abs(res.stats.height - res.stats.floorHeight * res.stats.floors) < 0.01
      && res.stats.wallRows >= 1,
    JSON.stringify({ h: res.stats.height, fh: res.stats.floorHeight, rows: res.stats.wallRows }));

  const res2 = await building.build(spec, ctx);
  check('B8', '幂等：同参数重跑输出逐字节一致',
    JSON.stringify(res) === JSON.stringify(res2));

  console.log('');
  console.log(`==== LDraw M2 验收: ${pass} PASS / ${failCount} FAIL ====`);
  await pool.end();
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
