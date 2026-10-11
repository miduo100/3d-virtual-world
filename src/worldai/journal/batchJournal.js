/**
 * batchJournal —— AI 对象创建/删除的**唯一写库路径** + 最小回滚（Phase 3.5-1 · §G.5 ① v1.5 订正 ③④）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单「最小回滚：记录本批创建的 object id → 一键删除（事务）」
 * + §G.5 ① v1.5 订正 ③（守卫在此层再检查一次 = 纵深防御，也是判据 P35-6 的依据）
 * + ④（任何其他模块不得直接 INSERT/DELETE world_objects）。
 *
 * 为什么要有这一层（不是多余抽象）：
 *   ① 事务：一批 place 要么全成要么全不成，不留半成品；
 *   ② 幂等：重跑同一委托按 created_by=missionId 去重（判据 P35-11b）；
 *   ③ 纵深防御：即使将来有人绕过 missionTools 直接调本模块，守卫仍会再查一次 origin/围栏/授权。
 *
 *★ 写库时强制三要素：origin='ai' + region_id=ctx.regionKey + created_by=ctx.missionId。
 *   缺任何一条都拒写—— 这让"AI 写的行"在数据库层面就是可识别的，
 *   回滚与"人工资产零影响"因此不依赖任何人记得加where 条件。
 */
'use strict';

const { query, pool } = require('../../database/db');
const guard = require('../tools/ownershipGuard');

/** 守卫要求的 AI 资产三要素 */
function requireAiTarget(row, ctx) {
  const c = ctx || {};
  if (!c.regionKey) return { ok: false, allow: false, code: 'REGION_REQUIRED', reason: 'ctx.regionKey 缺失：AI 写入必须归属区域' };
  if (!c.missionId && String(c.effectiveAutonomy || c.autonomy || 'managed') === 'managed') {
    return { ok: false, allow: false, code: 'MISSION_REQUIRED', reason: 'managed 档只允许「委托内写」：请传ctx.missionId（§G.5① v1.5 订正）' };
  }
  return { ok: true, allow: true, code: 'OK', reason: 'AI 写入前置条件满足' };
}

/** 组装 INSERT 参数（三要素强制） */
function aiRow(params, ctx) {
  const p = params || {};
  return [
    String(p.type || 'uploaded_model'),
    String(p.name || 'AI 零件'),
    p.model_path || null,
    num(p.position_x, 0), num(p.position_y, 0), num(p.position_z, 0),
    0, num(p.rotation_y, 0), 0,
    num(p.scale_x, 1), num(p.scale_y, 1), num(p.scale_z, 1),
    p.has_collision === true,
    'ai',
    String(ctx.missionId || ''),
    String(ctx.regionKey || ''),
  ];
}

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}
const INSERT_SQL =
  `INSERT INTO world_objects
     (type, name, model_path, position_x, position_y, position_z,
      rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
      has_collision, origin, created_by, region_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
   RETURNING id`;

/**
 * 创建一个 AI 对象（唯一写库路径）。**幂等**：同一委托 + 同一 partKey + 同一落点已存在则复用其id。
 * @returns {{ok:boolean, id?:number, code?:string, reason?:string, deduped?:boolean}}
 */
async function createObject(params, ctx) {
  const pre = requireAiTarget(params, ctx);
  if (!pre.allow) return pre;
  // 纵深防御：把"将要写入的行"当目标过一遍守卫（place_part 语义）
  const verdict = guard.check('place_part', {
    origin: 'ai', region_id: ctx.regionKey, created_by: ctx.missionId || '',
    position_x: num(params && params.position_x, 0), position_z: num(params && params.position_z, 0),
    type: (params && params.type) || 'uploaded_model',
  }, ctx);
  if (!verdict.allow) return verdict;

  const key = String((params && params.partKey) || params.name || '');
  if (ctx.missionId && key) {
    // ★ 带 y：多层建筑上层与下层同 (x,z) 不同 y，不带 y → 2~5 层全被误判成"重跑幂等"
    //   （实测 5 层楼 87 件 deduped、只落 1 层）。单层场景 y 相同，行为不变。
    const dup = await query(
      `SELECT id FROM world_objects
        WHERE created_by = $1 AND origin = 'ai' AND name = $2
          AND abs(position_x - $3) < 1e-6 AND abs(position_z - $4) < 1e-6
          AND abs(position_y - $5) < 1e-6
        LIMIT 1`,
      [String(ctx.missionId), key, num(params.position_x, 0), num(params.position_z, 0), num(params.position_y, 0)]
    );
    if (dup.rows && dup.rows.length) {
      return { ok: true, id: dup.rows[0].id, deduped: true, reason: '重跑幂等：复用已存在的同批对象（判据 P35-11b）' };
    }
  }

  const res = await query(INSERT_SQL, aiRow(params, ctx));
  return { ok: true, id: res.rows[0].id, deduped: false };
}

/** 批量创建（单事务：全成或全不成，避免半成品） */
async function batchCreate(items, ctx) {
  const pre = requireAiTarget(null, ctx);
  if (!pre.allow) return pre;
  const list = Array.isArray(items) ? items : [];
  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (const p of list) {
      const verdict = guard.check('place_part', {
        origin: 'ai', region_id: ctx.regionKey, created_by: ctx.missionId || '',
        position_x: num(p && p.position_x, 0), position_z: num(p && p.position_z, 0),
        type: (p && p.type) || 'uploaded_model',
      }, ctx);
      if (!verdict.allow) { await client.query('ROLLBACK'); return verdict; }
      const r = await client.query(INSERT_SQL, aiRow(p, ctx));
      created.push(r.rows[0].id);
    }
    await client.query('COMMIT');
    return { ok: true, ids: created, count: created.length };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return { ok: false, code: 'BATCH_FAILED', reason: '批量创建失败并已回滚：' + e.message };
  } finally {
    client.release();
  }
}
/**
 * 幂等查询：本委托是否已按"同一落点"建过这个零件（判据 P35-11b）。
 * ★ 必须按**请求落点**（吸附后、换位前）查，而不是按最终落点：
 *   否则重跑时"落点已被自己上次建的件占住"→ 先被换位逻辑挪走 → 永远命中不了去重，
 *   每重跑一次就多一批重复对象（这正是 P35-11b 要防的事故）。
 * ★★ 必须带 y：多层建筑（building recipe / 5 层楼）上层与下层**同 (x,z) 不同 y**，
 *   只按 (x,z) 匹配会把 2~5 层全部误判成"已存在"→ 整栋楼只落 1 层（实测 22 件里 21 件在 y=0）。
 *   y 传 null 时保持旧口径（单层场景行为逐字节不变）。
 */
async function findExisting(missionId, name, x, z, y) {
  if (!missionId || !name) return null;
  const res = await query(
    `SELECT id FROM world_objects
      WHERE created_by = $1 AND origin = 'ai' AND name = $2
        AND abs(position_x - $3) < 1e-6 AND abs(position_z - $4) < 1e-6
        AND ($5::double precision IS NULL OR abs(position_y - $5) < 1e-6)
      LIMIT 1`,
    [String(missionId), String(name), num(x, 0), num(z, 0),
      y == null ? null : num(y, 0)]
  );
  return (res.rows && res.rows[0]) ? res.rows[0].id : null;
}

/** 更新对象（move_object 用；守卫过一遍 + 只允许改位置/旋转/缩放） */
async function updateObject(id, patch, ctx) {
  const res0 = await query(`SELECT * FROM world_objects WHERE id = $1`, [id]);
  const row = res0.rows && res0.rows[0];
  if (!row) return { ok: false, code: 'OBJECT_NOT_FOUND', reason: '对象不存在：id=' + id };
  const verdict = guard.check('move_object', row, ctx);
  if (!verdict.allow) return verdict;
  const sets = [];
  const params = [];
  const push = (col, v) => { params.push(v); sets.push(col + ' = $' + params.length); };
  if (patch.position_x !== undefined) push('position_x', num(patch.position_x, row.position_x));
  if (patch.position_y !== undefined) push('position_y', num(patch.position_y, row.position_y));
  if (patch.position_z !== undefined) push('position_z', num(patch.position_z, row.position_z));
  if (patch.rotation_y !== undefined) push('rotation_y', num(patch.rotation_y, row.rotation_y));
  if (patch.scale_x !== undefined) push('scale_x', num(patch.scale_x, row.scale_x));
  if (patch.scale_y !== undefined) push('scale_y', num(patch.scale_y, row.scale_y));
  if (patch.scale_z !== undefined) push('scale_z', num(patch.scale_z, row.scale_z));
  if (!sets.length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: '没有可更新的字段' };
  params.push(id);
  await query(`UPDATE world_objects SET ` + sets.join(', ') + ` WHERE id = $` + params.length, params);
  return { ok: true, id, updated: sets.length };
}

/** 删单个对象（high 风险；3.5 正常路径走 rollbackBatch，这里供 Phase 4 账本/审批链用） */
async function deleteObject(id, ctx) {
  const res0 = await query(`SELECT * FROM world_objects WHERE id = $1`, [id]);
  const row = res0.rows && res0.rows[0];
  if (!row) return { ok: false, code: 'OBJECT_NOT_FOUND', reason: '对象不存在：id=' + id };
  const verdict = guard.check('delete_object', row, ctx);
  if (!verdict.allow) return verdict;
  await query(`DELETE FROM world_objects WHERE id = $1`, [id]);
  return { ok: true, id, deleted: 1 };
}

/** 本批已创建的对象（回滚预览 / 判据 P35-11 用） */
async function listBatchObjects(missionId) {
  const res = await query(
    `SELECT id, name, type, position_x, position_y, position_z, region_id, created_by, origin
       FROM world_objects WHERE created_by = $1 AND origin = 'ai' ORDER BY id`,
    [String(missionId)]
  );
  return res.rows || [];
}

/**
 * 一键回滚本批（判据 P35-11）：删掉本批全部 AI 对象，其他区域与 human 对象零影响。
 * 用单条带三条件的 DELETE（而不是先查后删），保证"只删本批 AI 资产"是数据库层面的原子事实。
 */
async function rollbackBatch(missionId, ctx) {
  const res = await query(
    `DELETE FROM world_objects WHERE created_by = $1 AND origin = 'ai' AND region_id = $2 RETURNING id`,
    [String(missionId), String((ctx && ctx.regionKey) || '')]
  );
  const ids = (res.rows || []).map((r) => r.id);
  return { ok: true, deleted: ids.length, ids };
}

/** 计数（预算/回滚预览用） */
async function countBatchObjects(missionId) {
  const res = await query(
    `SELECT count(*)::int AS n FROM world_objects WHERE created_by = $1 AND origin = 'ai'`,
    [String(missionId)]
  );
  return res.rows[0].n;
}

module.exports = {
  createObject,
  findExisting,
  batchCreate,
  updateObject,
  deleteObject,
  listBatchObjects,
  rollbackBatch,
  countBatchObjects,
  requireAiTarget,
  INSERT_SQL,
};