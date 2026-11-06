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
 * @param {Array} placements solver 返回的 parts
 * @param {object} opts { region, anchor?:{x,z} }
 * @returns {Array<{partKey,x,z,level,ry,scaleY,group,slot,edge,row,seq}>}
 */
function placementsToWorldObjects(placements, opts) {
  const o = opts || {};
  const a = o.anchor || anchorOf(o.region);
  return (placements || []).map((p) => ({
    partKey: p.key,
    // level 语义 = 米（place_part 的 gridsnap 单位 y 恒为 1），所以直接把 y 当 level
    level: num(p.y, 0),
    x: num(a.x, 0) + num(p.x, 0),
    z: num(a.z, 0) + num(p.z, 0),
    ry: num(p.ry, 0),
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
