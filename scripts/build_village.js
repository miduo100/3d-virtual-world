/**
 * build_village.js —— 在平原上布一座完整村庄（建筑 + 石径 + 路灯 + 植被）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么不是「一栋房一个区域 + 一个委托」：
 *   求解器的锚点固定取区域中心（adapter.anchorOf），所以那样做会把村子切成十几个围栏，
 *   房子摆不到想要的位置。这里改成：**一个村域 + 一个布展委托**，
 *   建筑用求解器离线算出局部坐标 → 按指定锚点平移/旋转 → 与装饰件一起落库。
 *   adapter.placementsToWorldObjects 本来就支持传 anchor，是它留好的口子。
 *
 * ★ 朝向：求解器把门固定放在「南边」（边定义 south = z 负侧，门朝 −Z）。
 *   街道两侧的房子必须面对面，所以北排整体绕 Y 轴转 180°（刚体旋转 + ry += π），
 *   否则北排房子的门朝屋后。
 *
 * ★ 写入：装饰件数量大（石径上千块），逐个走 journal.createObject 太慢（每件 2 次 SQL）。
 *   这里用 aiRow() 组装同样的 16 个字段，再分批多行 INSERT —— 字段口径与唯一写库路径一致，
 *   且每行落库前都校验「在村域围栏内」，安全属性不丢。
 *
 * 用法：node scripts/build_village.js
 */
'use strict';

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const { pool, query } = require('../src/database/db');
const registry = require('../src/worldai/assembly/templateRegistry');
const solver = require('../src/worldai/assembly/solver');
const adapter = require('../src/worldai/assembly/adapter');
const terrainGround = require('../src/worldai/assembly/terrainGround');

// ── 村庄选址与围栏 ────────────────────────────────────────────────
const VC = { x: -25, z: 295 };                  // 村中心（平原地形，地面恒 0）
const REGION_KEY = 'village_sample';
const REGION_NAME = '样板村庄';
const BOUNDS = { kind: 'rect', x: VC.x - 110, z: VC.z - 65, width: 220, depth: 130 };

// ── 街道参数 ──────────────────────────────────────────────────────
const STREET = { x0: VC.x - 58, x1: VC.x + 30, width: 4 };
const PLAZA = { x: VC.x - 44, z: VC.z, size: 12 };

// ── 房屋排布：北排（门朝 +Z，转 180°）／南排（门朝 −Z，原朝向）──────
const NORTH_ROW = [
  { id: 'medieval_6x6_wood', x: VC.x - 30, label: '木格工坊' },
  { id: 'medieval_6x10', x: VC.x - 14, label: '中世纪小屋' },
  { id: 'medieval_8x8_two', x: VC.x + 2, label: '砖砌两层' },
  { id: 'medieval_6x12', x: VC.x + 18, label: '长排民居' },
  { id: 'medieval_6x8_town', x: VC.x + 34, label: '两层联排' },
];
const SOUTH_ROW = [
  { id: 'medieval_6x6', x: VC.x - 30, label: '石砌小屋' },
  { id: 'medieval_8x12', x: VC.x - 14, label: '砖砌大屋' },
  { id: 'medieval_6x14', x: VC.x + 2, label: '长厅' },
  { id: 'medieval_8x8', x: VC.x + 18, label: '砖砌民居' },
  { id: 'medieval_8x14', x: VC.x + 34, label: '大会堂' },
];
const STREET_HALF = STREET.width / 2;
const SETBACK = 3;              // 房屋退线（距路面边缘）
const FRONT_N = VC.z - STREET_HALF - SETBACK;   // 北排临街面 z
const FRONT_S = VC.z + STREET_HALF + SETBACK;   // 南排临街面 z

// ── 装饰件 ────────────────────────────────────────────────────────
// ★ 铺装件选择（2026-11-07 对照实测）：path_stone 是「带草边的路条」，并排铺会变成
//   一条条平行细带（中间露草）。ground_pathStraight 是 1×1 的地面砖，并排能铺成
//   整片连续路面 —— 主街与广场都用它。
const PATH = 'ground_pathStraight';      // 1 × 0.05 × 1
// ★ 全库没有真正的路灯件（只有室内落地灯 / 壁灯）。两种对照实测后选定「杆 + 壁灯」：
//   structure_pole(0.1×1×0.1) 拉高到 3m，顶端把 lampWall 放大挂上去 —— 唯一能看出"灯头"的组合。
//   单独的落地灯/顶灯拉高后都只是一根细杆，远处看不见。
const LAMP_POLE = 'structure_pole';
const LAMP_HEAD = 'lampWall';
const TREES = ['tree_default', 'tree_default_dark', 'tree_default_fall', 'tree_cone', 'tree_cone_dark', 'tree_blocks', 'tree_detailed'];
const BUSHES = ['plant_bush', 'plant_bushLarge', 'plant_bushSmall', 'plant_bushTriangle', 'grass_large'];
const FLOWERS = ['flower_purpleA', 'flower_purpleB', 'flower_redA', 'flower_redB', 'flower_yellowA', 'flower_yellowB', 'flower_yellowC'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_smallD'];
const LOGS = ['log', 'log_large', 'log_stack', 'log_stackLarge'];

// ── 工具 ──────────────────────────────────────────────────────────
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };  // 确定性伪随机
const inBounds = (x, z) => x >= BOUNDS.x && x <= BOUNDS.x + BOUNDS.width
  && z >= BOUNDS.z && z <= BOUNDS.z + BOUNDS.depth;

let T = null;
async function api(p, o) {
  const opt = o || {};
  const h = Object.assign({}, opt.body ? { 'Content-Type': 'application/json' } : {});
  if (T && !opt.noAuth) h.Authorization = 'Bearer ' + T;
  const res = await fetch(BASE + p, { method: opt.method || 'GET', headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await res.json(); } catch (e) { j = {}; }
  return { status: res.status, j };
}

/** 取件的真实模型路径（不编码 —— world_objects.model_path 存原始路径） */
const pathCache = new Map();
async function modelOf(pack, key) {
  const ck = pack + '|' + key;
  if (pathCache.has(ck)) return pathCache.get(ck);
  const r = await query(
    `SELECT i.grid_w w, i.grid_h h, i.grid_d d, i.part_role role, u.path
       FROM part_library_items i
       JOIN part_libraries l ON l.id = i.library_id
       JOIN uploaded_models u ON u.id = i.model_id
      WHERE l.pack_key = $1 AND i.part_key = $2 AND l.status = 'active' AND l.deleted_at IS NULL
      ORDER BY i.id LIMIT 1`, [pack, key]
  );
  const v = r.rows[0] || null;
  pathCache.set(ck, v);
  return v;
}

const rows = [];   // {type,name,model_path,x,y,z,ry,sx,sy,sz,collision}

function push(p) {
  if (!inBounds(p.x, p.z)) throw new Error(`落点越界：( ${r3(p.x)}, ${r3(p.z)} ) 不在村域内 —— ${p.name}`);
  rows.push(p);
}

/** 装饰件：按 pack/key 直接摆一件 */
async function prop(pack, key, x, z, opts) {
  const o = opts || {};
  const m = await modelOf(pack, key);
  if (!m) throw new Error('取不到零件：' + pack + '/' + key);
  push({
    type: 'uploaded_model', name: key, model_path: m.path,
    // 模型原点在底面（Kenney nature/furniture 都是），所以 y 就是地面高度
    x, y: o.y == null ? 0 : o.y, z,
    ry: o.ry || 0, sx: o.sx || 1, sy: o.sy || 1, sz: o.sz || 1,
    collision: o.collision !== false,
  });
}

/**
 * 在指定锚点、指定朝向放一栋模板房。
 * @param {number} theta 绕 Y 轴旋转（弧度）：0 = 门朝 −Z；π = 门朝 +Z
 */
async function house(templateId, ax, az, theta, groundY) {
  const built = registry.buildSpec(templateId);
  if (!built.ok) throw new Error(templateId + ' buildSpec 失败：' + built.code + ' ' + built.reason);
  const t = registry.getTemplate(templateId);
  const parts = Object.values(t.parts).filter(Boolean);
  const resolved = await adapter.resolvePartsFromDb(parts, t.pack);
  if (!resolved.ok) throw new Error(templateId + ' 缺件：' + resolved.missing.join(','));
  // 用原始路径，不用 adapter 里 URL 编码过的（DB 存原始路径）
  const resolver = async (key) => {
    const raw = await modelOf(t.pack, key);
    if (!raw) return null;
    return { key, w: Number(raw.w), h: Number(raw.h), d: Number(raw.d), path: raw.path };
  };
  const plan = await solver.solve(built.spec, { partResolver: resolver });
  if (!plan.ok) throw new Error(templateId + ' 求解失败：' + plan.code + ' ' + plan.reason);

  // anchor 传 {0,0}：先拿「以建筑中心为原点」的局部坐标，再自己做刚体旋转 + 平移
  const local = adapter.placementsToWorldObjects(plan.parts, { anchor: { x: 0, z: 0 } });
  const c = Math.cos(theta), s = Math.sin(theta);
  for (const p of local) {
    const lx = Number(p.x), lz = Number(p.z);
    push({
      type: 'uploaded_model', name: p.partKey, model_path: (await modelOf(t.pack, p.partKey)).path,
      x: r3(ax + lx * c - lz * s),
      y: r3(groundY + Number(p.level)),
      z: r3(az + lx * s + lz * c),
      ry: r3(Number(p.ry) + theta),
      sx: 1, sy: Number(p.scaleY) || 1, sz: 1,
      // 与 missionTools.collideOf 同口径：结构件挡人，屋顶不挡
      collision: p.group !== 'roof',
    });
  }
  // 记录房屋占地，供后面避让装饰
  return { id: templateId, cx: ax, cz: az, w: built.spec.width, d: built.spec.depth, theta, n: local.length };
}

(async () => {
  console.log('村庄中心 ' + JSON.stringify(VC) + '  围栏 ' + BOUNDS.width + '×' + BOUNDS.depth);

  // ── 0) 地形校验：必须是平坦地面，否则整村的 y 都要另算 ──
  const g = await terrainGround.underFootprint(VC.x, VC.z, BOUNDS.width, BOUNDS.depth);
  if (!g.hasTerrain) throw new Error('村址没有地形（地块之外）');
  const groundY = g.baseY;
  console.log('地面 y=' + g.baseY + '（起伏 ' + g.span + 'm）');
  if (Math.abs(g.span) > 1.5) throw new Error('村址起伏 ' + g.span + 'm 太大，换个平地');

  // ── 1) 区域 + 委托（直接写表：布展不依赖 3002 服务在跑）──
  const WORLD = (await query(`SELECT world_id FROM world_regions WHERE region_key LIKE 'street%' OR region_key LIKE 'm14%' LIMIT 1`)).rows[0].world_id;
  await query(`DELETE FROM world_regions WHERE region_key = $1`, [REGION_KEY]);
  await query(
    `INSERT INTO world_regions (world_id, region_key, name, bounds, autonomy, gridsnap, status, origin, created_by)
     VALUES ($1,$2,$3,$4::jsonb,'managed','{"kind":"modular","unit":[1,1,1]}'::jsonb,'active','ai','village_build')`,
    [WORLD, REGION_KEY, REGION_NAME, JSON.stringify(BOUNDS)]
  );
  await query(`DELETE FROM world_build_missions WHERE region_key = $1`, [REGION_KEY]);
  const missionId = (await query(
    `INSERT INTO world_build_missions (world_id, region_key, title, prompt, constraints, autonomy_snapshot, status, origin, created_by)
     VALUES ($1,$2,'样板村庄布展','村庄场景','{"max_objects":20000}'::jsonb,'managed','completed','ai','village_build')
     RETURNING id`, [WORLD, REGION_KEY]
  )).rows[0].id;
  console.log('委托 ' + missionId);

  // 已建过就先清掉本村旧对象（可重复执行）
  const del = await query(`DELETE FROM world_objects WHERE region_id = $1`, [REGION_KEY]);
  console.log('清理旧对象 ' + del.rowCount + ' 件');

  // ── 2) 房屋 ──
  const houses = [];
  for (const h of NORTH_ROW) {
    // 北排：门朝 +Z → 转 180°，临街面在 z = FRONT_N
    const b = registry.getTemplate(h.id);
    const cz = FRONT_N - b.dimensions.depth / 2;
    houses.push(await house(h.id, h.x, cz, Math.PI, groundY));
  }
  for (const h of SOUTH_ROW) {
    const b = registry.getTemplate(h.id);
    const cz = FRONT_S + b.dimensions.depth / 2;
    houses.push(await house(h.id, h.x, cz, 0, groundY));
  }
  console.log('房屋 ' + houses.length + ' 栋，共 ' + rows.length + ' 件');

  // ── 3) 石径：主街 + 广场 ──
  const pathM = await modelOf('kenney_nature_kit', PATH);
  const tileW = Number(pathM.w);            // 1
  const tileD = Number(pathM.d);            // 0.5766
  const SZ = 1;                              // 不拉伸：1×1 砖按 1m 推进才能严丝合缝
  const stepZ = tileD * SZ;
  const pathRows = Math.max(1, Math.round(STREET.width / stepZ));
  let pathN = 0;
  for (let x = STREET.x0; x <= STREET.x1; x += tileW) {
    for (let k = 0; k < pathRows; k++) {
      const z = VC.z + (k - (pathRows - 1) / 2) * stepZ;
      await prop('kenney_nature_kit', PATH, x, r3(z), { y: groundY + 0.01, sz: SZ, collision: false });
      pathN++;
    }
  }
  // 广场：横竖都铺，形成一块整石地
  for (let ix = 0; ix < Math.round(PLAZA.size / tileW); ix++) {
    for (let iz = 0; iz < Math.round(PLAZA.size / stepZ); iz++) {
      await prop('kenney_nature_kit', PATH,
        r3(PLAZA.x - PLAZA.size / 2 + (ix + 0.5) * tileW),
        r3(PLAZA.z - PLAZA.size / 2 + (iz + 0.5) * stepZ),
        { y: groundY + 0.01, sz: SZ, collision: false });
      pathN++;
    }
  }
  console.log('石径 ' + pathN + ' 块');

  // ── 4) 路灯：街两侧，12m 一盏 ──
  let lampN = 0;
  for (let x = STREET.x0 + 6; x <= STREET.x1; x += 12) {
    for (const side of [-1, 1]) {
      const lx = r3(x), lz = r3(VC.z + side * (STREET_HALF + 0.8));
      await prop('kenney_retro_fantasy_kit', LAMP_POLE, lx, lz, { y: groundY, sy: 3.0, collision: true });
      await prop('kenney_furniture_kit', LAMP_HEAD, lx, lz, { y: groundY + 2.9, sy: 1.6, ry: side > 0 ? Math.PI : 0, collision: false });
      lampN++;
    }
  }
  console.log('路灯 ' + lampN + ' 盏');

  // ── 5) 植被：屋后成排树，街边花草，外围散石 ──
  let deco = 0;
  // 屋后树带：南北各两排
  for (let i = 0; i < 14; i++) {
    const t1 = TREES[i % TREES.length];
    await prop('kenney_nature_kit', t1, r3(STREET.x0 - 6 + i * 6.5), r3(FRONT_N - 16 - (i % 3) * 2.5),
      { y: groundY, sy: 1.7 + rnd(i) * 0.5, ry: rnd(i + 40) * 6.28, collision: true });
    await prop('kenney_nature_kit', TREES[(i + 3) % TREES.length], r3(STREET.x0 - 2 + i * 6.5), r3(FRONT_S + 16 + (i % 3) * 2.5),
      { y: groundY, sy: 1.7 + rnd(i + 7) * 0.5, ry: rnd(i + 50) * 6.28, collision: true });
    deco += 2;
  }
  // 街边：花丛 + 矮灌木（沿路缘，避开路灯与门口）
  for (let i = 0; i < 30; i++) {
    const x = STREET.x0 + 2 + i * 3.1;
    const side = i % 2 === 0 ? -1 : 1;
    const z = VC.z + side * (STREET_HALF + 0.55);
    const key = i % 3 === 0 ? FLOWERS[i % FLOWERS.length] : BUSHES[i % BUSHES.length];
    await prop('kenney_nature_kit', key, r3(x), r3(z),
      { y: groundY, sy: 0.9 + rnd(i + 11) * 0.5, ry: rnd(i + 60) * 6.28, collision: false });
    deco++;
  }
  // 外围散石与木堆
  for (let i = 0; i < 16; i++) {
    const key = i % 2 === 0 ? ROCKS[i % ROCKS.length] : LOGS[i % LOGS.length];
    const x = STREET.x0 - 12 + i * 7.3;
    const z = i % 2 === 0 ? FRONT_N - 22 - rnd(i) * 6 : FRONT_S + 22 + rnd(i) * 6;
    await prop('kenney_nature_kit', key, r3(x), r3(z),
      { y: groundY, sy: 0.8 + rnd(i + 21) * 0.6, ry: rnd(i + 70) * 6.28, collision: true });
    deco++;
  }
  // 广场四角花坛
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    await prop('kenney_nature_kit', BUSHES[0], r3(PLAZA.x + dx * (PLAZA.size / 2 + 0.6)), r3(PLAZA.z + dz * (PLAZA.size / 2 + 0.6)),
      { y: groundY, sy: 1.2, collision: false });
    deco++;
  }
  console.log('植被/散石 ' + deco + ' 件');

  // ── 6) 落库（分批多行 INSERT，字段口径 = batchJournal.aiRow）──
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    // 字段顺序与 batchJournal 的 INSERT_SQL 完全一致（16 列）
    const vals2 = [];
    const par2 = [];
    slice.forEach((p, k) => {
      const b = k * 16;
      vals2.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16})`);
      par2.push(
        p.type, String(p.name), p.model_path,
        p.x, p.y, p.z,
        0, p.ry, 0,
        p.sx, p.sy, p.sz,
        p.collision === true,
        'ai', String(missionId), REGION_KEY
      );
    });
    const sql = `INSERT INTO world_objects
      (type, name, model_path, position_x, position_y, position_z,
       rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
       has_collision, origin, created_by, region_id)
      VALUES ${vals2.join(',')}`;
    await query(sql, par2);
    inserted += slice.length;
    if (i % 1000 === 0) console.log('  已写入 ' + inserted + '/' + rows.length);
  }

  const total = (await query('SELECT count(*)::int n FROM world_objects WHERE region_id=$1', [REGION_KEY])).rows[0].n;
  console.log('\n完成：村域内 ' + total + ' 件（房屋 ' + houses.length + ' 栋 / 石径 ' + pathN
    + ' / 路灯 ' + lampN + ' / 植被散石 ' + deco + '）');
  console.log('村中心 ' + VC.x + ',' + VC.z + '；主街 x ' + STREET.x0 + '~' + STREET.x1 + '，广场 (' + PLAZA.x + ',' + PLAZA.z + ')');
  console.log('撤销：DELETE FROM world_objects WHERE region_id=\'' + REGION_KEY + '\';');
  console.log('      DELETE FROM world_build_missions WHERE region_key=\'' + REGION_KEY + '\';');
  console.log('      DELETE FROM world_regions WHERE region_key=\'' + REGION_KEY + '\';');
  try { await pool.end(); } catch (e) { /* ignore */ }
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
