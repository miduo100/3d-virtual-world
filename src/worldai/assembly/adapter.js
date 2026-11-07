/**
 * adapter —— 求解器与「库 / 世界」之间的唯一转接层（M1-4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 职责边界（§K）：
 *   ① **所有数据库访问都收在这个文件里**，solver 保持纯净（判据 M1-1-5 的反面约束）。
 *   ② 纯坐标换算也放这里：求解器输出的是「以建筑中心为原点」的局部坐标，
 *      落库要的是世界坐标 —— 换算只写一处，避免以后两边各算一遍算歪。
 *
 * ★ 本文件只**读**库（SELECT），不写。写世界只有一条路：missionTools.execute('place_part')。
 * ★ db 是**惰性 require**：验收脚本注入 stub resolver 时不会加载 pg、不会建连接池。
 */
'use strict';

/** 模型路径含空格/方括号，URL 需编码（保留斜杠）——与 preview_assemble.js 同一口径 */
function encPath(p) {
  if (!p) return null;
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

/**
 * 按 part_key 批量解析零件尺寸（只读）。
 * @param {string[]} partKeys 模板 parts 里出现的所有 key
 * @param {string} [packKey]  零件库 pack_key（同一栋建筑必须同一套件，风险 R2）
 * @returns {Promise<{ok:boolean, partMap:object, missing:string[], packKey:string|null}>}
 */
async function resolvePartsFromDb(partKeys, packKey) {
  const keys = Array.from(new Set((partKeys || [])
    .map((k) => String(k == null ? '' : k).trim())
    .filter(Boolean))).sort();
  const pack = packKey ? String(packKey) : null;
  if (!keys.length) return { ok: true, partMap: {}, missing: [], packKey: pack };

  // ★ 惰性 require：stub 场景不碰数据库
  const { query } = require('../../database/db');
  const sql = pack
    ? `SELECT DISTINCT ON (i.part_key) i.part_key, i.grid_w, i.grid_h, i.grid_d,
              i.part_role, i.part_subtype, m.path
         FROM part_library_items i
         JOIN uploaded_models m ON m.id = i.model_id
         JOIN part_libraries l ON l.id = i.library_id
        WHERE i.part_key = ANY($1) AND l.pack_key = $2 AND l.status = 'active' AND l.deleted_at IS NULL
        ORDER BY i.part_key, i.id`
    : `SELECT DISTINCT ON (i.part_key) i.part_key, i.grid_w, i.grid_h, i.grid_d,
              i.part_role, i.part_subtype, m.path
         FROM part_library_items i
         JOIN uploaded_models m ON m.id = i.model_id
         JOIN part_libraries l ON l.id = i.library_id
        WHERE i.part_key = ANY($1) AND l.status = 'active' AND l.deleted_at IS NULL
        ORDER BY i.part_key, i.id`;

  const res = await query(sql, pack ? [keys, pack] : [keys]);
  const partMap = {};
  for (const row of res.rows || []) {
    partMap[row.part_key] = {
      key: row.part_key,
      w: Number(row.grid_w), h: Number(row.grid_h), d: Number(row.grid_d),
      path: encPath(row.path),
      role: row.part_role, subtype: row.part_subtype,
    };
  }
  const missing = keys.filter((k) => !partMap[k]);
  return { ok: missing.length === 0, partMap, missing, packKey: pack };
}

/** 把 partMap 包成 solver 要的 async resolver（solver 只认 (key) => 件|null） */
function makeResolver(partMap) {
  const map = partMap || {};
  return async function partResolver(key) {
    return map[key] || null;
  };
}

/** 区域包围盒（兼容 minX/minZ 与 x/z+width/depth 两种写法，与 coords.absoluteOf 同口径） */
function boundsOf(region) {
  const b = (region && region.bounds) || {};
  const minX = num(b.minX, num(b.x, 0));
  const minZ = num(b.minZ, num(b.z, 0));
  const maxX = num(b.maxX, minX + num(b.width, 0));
  const maxZ = num(b.maxZ, minZ + num(b.depth, 0));
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * 建筑落点：默认取区域中心（与 coords.absoluteOf「anchor 缺省即居中」一致）。
 * ★ 为什么不按建筑外框内缩：区域太小就该让 boundsGuard 拒（明确失败），
 *   而不是自动缩到角落里建一栋「看起来没错但位置很奇怪」的房子。
 */
function anchorOf(region) {
  const b = boundsOf(region);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/**
 * 求解器局部坐标 → 可落库的 world_objects 参数（纯函数，不查库）。
 *
 * ★ 旋转单位换算（2026-11-06 灰度 E2E 实测发现的真 bug）：
 *   `world_objects.rotation_y` 存的是**弧度**——客户端 world.js 直接 `model.rotation.set(...)`，
 *   后台 adminBuildings.js 显示时才 `×180/π`。人工摆的物件也是这样存的（0.8457、1.1781…）。
 *   而求解器内部按**度数**算边方向（0/90/180/270）。原先直接透传的后果：
 *   `90` 被当成 90 弧度 ≈ 117°，`180` ≈ 233°，`270` ≈ 350° —— 一栋楼只有 ry=0 的那面墙
 *   是对的，其余墙板全部歪着站、北山墙穿出屋顶（E2E 截图实证）。
 *   换算只在这里做一次，求解器保持"度数"这一人类可读口径。
 *
 * @param {Array} placements solver 返回的 parts（ry 为度数）
 * @param {object} opts { region, anchor?:{x,z}, groundY?:number }
 * @returns {Array<{partKey,x,z,level,ry,scaleY,group,slot,edge,row,seq}>} ry 为弧度
 */
const DEG2RAD = Math.PI / 180;

/** 保留 3 位小数（与求解器 r3 同口径，避免二元浮点尾数落进 position_y） */
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

function placementsToWorldObjects(placements, opts) {
  const o = opts || {};
  const a = o.anchor || anchorOf(o.region);
  // ★ groundY（2026-11-07 地形贴合）：世界地面不是 y=0 —— 山地地块实测 (4652,4620) 处
  //   地面 y=17.77，而求解器按 y=0 落位，整条街沉在山下。地面高程由 terrainGround 采样，
  //   这里只做一次平移；求解器本身仍输出「以建筑底面为 0」的局部坐标（保持纯函数）。
  const g = num(o.groundY, 0);
  return (placements || []).map((p) => ({
    partKey: p.key,
    // level 语义 = 米（place_part 的 gridsnap 单位 y 恒为 1），所以直接把 y 当 level
    level: r3(g + num(p.y, 0)),
    x: num(a.x, 0) + num(p.x, 0),
    z: num(a.z, 0) + num(p.z, 0),
    ry: num(p.ry, 0) * DEG2RAD,   // ★ 度数 → 弧度（见上方说明）
    scaleY: num(p.scaleY, 1),
    group: p.group,
    slot: p.slot,
    edge: p.edge == null ? null : p.edge,
    row: num(p.row, 0),
    seq: num(p.seq, 0),
  }));
}

/**
 * 落库质量指标（写进 world_build_missions.executed_stats.assembly）。
 * @param {object} solveResult solver 的返回值
 * @param {object} [extra] { templateId, objectsCreated, ... }
 */
function assemblyStatsOf(solveResult, extra) {
  const r = solveResult || {};
  const s = r.stats || {};
  return Object.assign({
    templateId: s.templateId || null,
    capability: s.capability || null,
    seamMax: s.seamMax == null ? null : s.seamMax,
    eave: s.eave || null,
    pieceCount: s.pieceCount || 0,
    wallSegments: s.wallSegments || 0,
    rows: s.rows || 1,
    policy: s.policy || 'absorb',
    seamGroups: s.seamGroups || 0,
    byGroup: s.byGroup || {},
  }, extra || {});
}

module.exports = {
  encPath, resolvePartsFromDb, makeResolver, boundsOf, anchorOf,
  placementsToWorldObjects, assemblyStatsOf,
};
