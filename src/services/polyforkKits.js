/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * Polyfork「成套场景（kit）」→ 创世世界对象 转换器
 * ------------------------------------------------------------------
 * 背景（2026-11-12 用户需求）：
 *   单件模型已经能一键放进世界，但一个个摆太费手。Polyfork 的 kit 除了零件，
 *   还带一份 layout：一整块「按米制摆好的场景」，每一行 = 一个零件的
 *   位置 / 旋转 / 缩放。本模块把 layout 行翻成 world_objects 行，
 *   一次插入，整村/整条街直接落在世界里。
 *
 * layout 行口径（官方 llms.txt + 2026-11-12 实测）：
 *   - 位置 x/y/z 单位米，Y-up；
 *   - 旋转 rx/ry/rz 单位「度」；直立的零件只给 ry，只有真的倾倒时才出现 rx/rz；
 *   - 缩放可选 s；
 *   - params 是该摆放点用的旋钮值（我们只能取零件默认值烘焙的 GLB，做不到逐件重烤）。
 *   - part 为 `_terrain` 的行是「地面程序」而不是模型 → 跳过（世界自带地形）。
 *
 * ⚠️ **part 是短键，不是资产 id**（实测踩坑）：
 *   layout 里写的是 `anvil` / `barn` / `grass-terrain-blob`，
 *   真正能下载的 id 是 `anvil-1286cb` / `timber-barn-90b3ce` / `grass-terrain-blob-389daa`。
 *   映射表在 `kit.parts[].key → kit.parts[].id`。**本模块只搬运 part 原值，不做翻译**，
 *   翻译在 routes/freeAssets.js 的 /import-kit 里完成（下载用 id，回填 pathById 用短键）。
 *
 * 容错：官方字段名只用文档描述过、没给 JSON 样例，所以这里对同义字段名做了兼容
 *       （part/id/key/asset、ry/rotY、s/scale 数字或向量），避免一次改名就整条链路哑掉。
 *
 * 纯函数，无 IO、无数据库依赖 —— 便于单测（见 _test/polyforkKits.test.js）。
 */

const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/i;

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
}

function deg2rad(d) {
  return num(d, 0) * Math.PI / 180;
}

/** 取 layout 行的零件 id（兼容几种可能字段名） */
function partIdOf(row) {
  if (!row || typeof row !== 'object') return '';
  const raw = row.part != null ? row.part
    : row.id != null ? row.id
      : row.key != null ? row.key
        : row.asset != null ? row.asset
          : row.assetId != null ? row.assetId
            : '';
  return String(raw || '').trim();
}

/** 取缩放（数字、字符串数字、或 {x,y,z}） */
function scaleOf(row) {
  let s = row && (row.s != null ? row.s : row.scale);
  if (s && typeof s === 'object') {
    return { x: num(s.x, 1), y: num(s.y, 1), z: num(s.z, 1) };
  }
  const v = num(s, 1);
  const f = v > 0 ? v : 1;
  return { x: f, y: f, z: f };
}

function rotOf(row) {
  const rx = row.rx != null ? row.rx : (row.rotX != null ? row.rotX : row.rot_x);
  const ry = row.ry != null ? row.ry : (row.rotY != null ? row.rotY : row.rot_y);
  const rz = row.rz != null ? row.rz : (row.rotZ != null ? row.rotZ : row.rot_z);
  return { rx: deg2rad(rx), ry: deg2rad(ry), rz: deg2rad(rz) };
}

/**
 * 把整份 layout 翻成 world_objects 行。
 *
 * @param {Array} layout             kit.layout（未配 key 时为 null）
 * @param {Object} opts
 *   - x,y,z        落点基准（世界坐标，米）；kit 的 0,0,0 会搬到这个点
 *   - rotateDeg    整场景绕 Y 轴再转多少度（让村子朝向你想要的方向）
 *   - titleById    { assetId: '显示名' }，来自 kit.parts
 *   - pathById     { assetId: '/models/uploaded/free/polyfork/xxx.glb' }
 *   - hasCollision 是否给建筑写入碰撞（默认 false：559 个碰撞盒会把寻路压垮）
 *   - namePrefix   对象名前缀，便于在右侧列表里一眼认出“这是哪个套件”
 * @returns {{ rows: Object[], stats: Object }}
 */
function toWorldObjects(layout, opts) {
  const o = opts || {};
  const bx = num(o.x), by = num(o.y), bz = num(o.z);
  const yaw = deg2rad(o.rotateDeg);
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const titleById = o.titleById || {};
  const pathById = o.pathById || {};
  const prefix = String(o.namePrefix || '');
  const hasCollision = !!o.hasCollision;

  const rows = [];
  const skipped = { terrain: 0, unknownPart: 0, noPath: 0, badScale: 0 };
  const partUse = Object.create(null);

  if (!Array.isArray(layout)) {
    return { rows, stats: { total: 0, kept: 0, skipped, distinctParts: 0, missingParts: [] } };
  }

  for (const row of layout) {
    let pid = partIdOf(row);
    if (!pid) { skipped.unknownPart++; continue; }

    /**
     * 地面行 `_terrain` 不是资产 id，而是「这里放一块程序生成的地面」。
     * 2026-11-18 修：原先一律跳过（注释写着"世界自带地形"），结果整套导入后
     * 场景是悬空的、没有地面。实际上 kit 通常另外带一个 class=terrain 的资产
     * （Chronos Hearth 是 95×15.7×71m、19,218 三角形），调用方把它以 `__terrain`
     * 键塞进 pathById 就能把这块地面真正摆上。
     * 没有 terrain 资产时仍然跳过（不是所有 kit 都带地面）。
     */
    let isTerrain = false;
    if (pid === '_terrain') {
      if (pathById.__terrain) { pid = '__terrain'; isTerrain = true; }
      else { skipped.terrain++; continue; }
    } else if (pid.charAt(0) === '_') { skipped.terrain++; continue; }

    if (pid !== '__terrain' && !ASSET_ID_RE.test(pid)) { skipped.unknownPart++; continue; }

    const path = pathById[pid];
    if (!path) { skipped.noPath++; continue; }

    const sc = scaleOf(row);
    if (!(sc.x > 0) || !(sc.y > 0) || !(sc.z > 0) || sc.x > 1000 || sc.y > 1000 || sc.z > 1000) {
      skipped.badScale++;
      continue;
    }

    // 绕基点转 yaw：位置按 three.js 的 R_y(θ) 转到世界系，朝向直接加在 ry 上
    // （R_y(yaw)·R_y(ry) = R_y(yaw+ry)，纯 Y 朝向时是精确的）。
    // three.js 的 Y 轴旋转矩阵是 x' = x·cosθ + z·sinθ，z' = -x·sinθ + z·cosθ，
    // 别写成相反号 —— 写反了整块场景会朝反方向转。
    //
    // ⚠️ 地形行例外（2026-11-18 实测）：`_terrain` 的 x/y/z 是**导出 GLB 时已经
    // 烘焙进节点平移的内部偏移**（Chronos Hearth 是 -256,-10,-512），独立 GLB 里
    // 顶点已经带 +207~+302 / +471~+542 把它抵消回原点附近。这里再叠一次，地面会
    // 被推到离建筑 250 米外 —— 前端按 200 米加载半径判定"太远"，永远不加载，
    // 表现就是"导入了但看不见地面"。地形一律落在 kit 基准点 (0,0,0) 上。
    const lx = isTerrain ? 0 : num(row.x);
    const lz = isTerrain ? 0 : num(row.z);
    const wx = lx * cos + lz * sin;
    const wz = -lx * sin + lz * cos;
    const rot = rotOf(row);

    partUse[pid] = (partUse[pid] || 0) + 1;

    rows.push({
      type: 'uploaded_model',
      name: (prefix + (titleById[pid] || pid)).slice(0, 120),
      model_path: path,
      model_type: 'gltf',
      position_x: round3(bx + wx),
      position_y: round3(by + (isTerrain ? 0 : num(row.y))),
      position_z: round3(bz + wz),
      // three.js 欧拉角默认 XYZ 序，单位弧度。纯 Y 朝向的零件加 yaw 是精确的；
      // 少数倾斜零件（rx/rz 非 0）会有一点点近似，肉眼不可见。
      rotation_x: round6(rot.rx),
      rotation_y: round6(rot.ry + yaw),
      rotation_z: round6(rot.rz),
      scale_x: round3(sc.x),
      scale_y: round3(sc.y),
      scale_z: round3(sc.z),
      has_collision: hasCollision
    });
  }

  const usedIds = Object.keys(partUse);
  const missingParts = usedIds.filter((id) => !pathById[id]);
  return {
    rows,
    stats: {
      total: Array.isArray(layout) ? layout.length : 0,
      kept: rows.length,
      distinctParts: usedIds.length,
      partUse,
      skipped,
      missingParts
    }
  };
}

function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}
function round6(v) {
  return Math.round(Number(v) * 1e6) / 1e6;
}

/** layout 里真正用到的零件 id（去重，跳 _terrain），下载时按这个集合来 */
function usedPartIds(layout) {
  const set = new Set();
  if (!Array.isArray(layout)) return [];
  for (const row of layout) {
    const pid = partIdOf(row);
    if (!pid || pid.charAt(0) === '_' || !ASSET_ID_RE.test(pid)) continue;
    set.add(pid);
  }
  return Array.from(set);
}

module.exports = {
  ASSET_ID_RE,
  partIdOf,
  scaleOf,
  rotOf,
  toWorldObjects,
  usedPartIds
};
