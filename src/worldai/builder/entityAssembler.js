/**
 * entityAssembler —— World Entity 装配（AI World Brain · Phase 5 · §C.3⑦⑧ + P4-7/P4-8/P4-14）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 核心设计（§C.3⑧）：组合建筑不是 THREE.Group，而是 N 个普通 world_objects + 1 个 Entity 索引。
 *   · world_objects 的创建只走 batchJournal（红线 1：AI 对象唯一写库路径，守卫逐件再查一次）；
 *   · Entity/parts/interactions/entity_id 回写在本模块的单事务里（任一失败整体回滚）；
 *   · 幂等：UNIQUE(world_id, spec_hash) + UNIQUE(entity_id, part_key) 双键，重跑不重复；
 *   · remove_building 单事务删 N 对象 + 1 Entity + N parts + 本 Entity 交互点，逐件过守卫。
 */
'use strict';

const crypto = require('crypto');
const { query, pool } = require('../../database/db');
const batchJournal = require('../journal/batchJournal');
const guard = require('../tools/ownershipGuard');

function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

/** spec 幂等键（确定性：同 spec 同 hash） */
function specHash(spec) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

/** 查实体（六段结构，P4-14） */
async function getEntity(worldId, entityId) {
  const e = await query(`SELECT * FROM world_entities WHERE id = $1 AND world_id = $2`, [String(entityId), String(worldId)]);
  if (!e.rows.length) return null;
  const row = e.rows[0];
  const parts = await query(
    `SELECT p.*, o.name AS object_name, o.position_x, o.position_y, o.position_z,
            o.rotation_y, o.scale_x, o.scale_y, o.scale_z, o.model_path, o.type AS object_type
       FROM world_entity_parts p LEFT JOIN world_objects o ON o.id = p.world_object_id
      WHERE p.entity_id = $1 ORDER BY p.sort_order ASC, p.id ASC`, [row.id]);
  const interactions = await query(
    `SELECT id, interaction_type, key, label, position, radius, payload, enabled
       FROM world_interactions WHERE entity_id = $1 ORDER BY created_at ASC`, [row.id]);
  return {
    id: row.id, worldId: row.world_id, entityType: row.entity_type, name: row.name, purpose: row.purpose,
    regionKey: row.region_key,
    visual: row.visual, physical: row.physical,
    interactions: interactions.rows || [],
    npcRefs: row.npc_refs || [],
    gameplay: row.gameplay || {},
    data: { origin: row.origin, createdBy: row.created_by, spec: row.spec, specHash: row.spec_hash, state: row.state, entityState: row.entity_state, createdAt: row.created_at, updatedAt: row.updated_at },
    parts: (parts.rows || []).map((p) => ({
      partKey: p.part_key, partRole: p.part_role, worldObjectId: p.world_object_id,
      objectName: p.object_name, objectType: p.object_type, modelPath: p.model_path,
      localTransform: p.local_transform, sortOrder: p.sort_order,
    })),
  };
}

/**
 * 装配实体（composite / asset / components 三种 visual.mode 统一入口）。
 * @param {object} o { worldId, regionKey, missionId, actor, entityType, name, purpose,
 *                     visual, physical, spec, parts:[{partKey,partRole,assetRef,localTransform,objectParams}], interactions:[] }
 * objectParams：batchJournal.createObject 的行参数（type/name/model_path/position/rotation/scale/has_collision/partKey）。
 */
async function assembleEntity(o) {
  const p = o || {};
  if (!p.worldId) return { ok: false, code: 'WORLD_REQUIRED', reason: '缺少 worldId' };
  if (!Array.isArray(p.parts) || !p.parts.length) return { ok: false, code: 'PARTS_REQUIRED', reason: 'parts 为空：实体至少要有一个部件' };
  const hash = specHash(p.spec || { name: p.name, parts: p.parts.map((x) => x.partKey) });

  // 幂等：同 spec 只建一个实体
  const exist = await query(
    `SELECT * FROM world_entities WHERE world_id = $1 AND spec_hash = $2 LIMIT 1`,
    [String(p.worldId), hash]
  );
  let entity = exist.rows[0] || null;
  let createdObjects = [];
  let deduped = !!entity;

  if (!entity) {
    // ① world_objects（唯一写库路径 batchJournal，逐件守卫）
    const items = p.parts.map((part) => Object.assign({}, part.objectParams, { partKey: part.partKey }));
    const created = await batchJournal.batchCreate(items, {
      regionKey: p.regionKey, missionId: p.missionId,
      effectiveAutonomy: p.effectiveAutonomy || 'semi_autonomous',
    });
    if (!created.ok) return { ok: false, code: created.code || 'BATCH_FAILED', reason: created.reason || '部件创建被拒绝' };
    createdObjects = created.ids || [];

    // ② Entity + parts + interactions + entity_id 回写（单事务）
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO world_entities (world_id, entity_type, name, purpose, region_key,
                                     visual, physical, npc_refs, gameplay, origin, created_by, spec, spec_hash, state)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'[]'::jsonb,'{}'::jsonb,'ai',$8,$9::jsonb,$10,'{"active":true,"phase":"built"}'::jsonb)
         ON CONFLICT (world_id, spec_hash) DO NOTHING RETURNING *`,
        [String(p.worldId), String(p.entityType || 'building'), String(p.name || 'AI 建筑').slice(0, 120),
          p.purpose ? String(p.purpose).slice(0, 40) : null, p.regionKey ? String(p.regionKey) : null,
          JSON.stringify(p.visual || {}), JSON.stringify(p.physical || {}), String(p.actor || 'world_ai:runtime').slice(0, 64),
          p.spec ? JSON.stringify(p.spec) : null, hash]
      );
      if (ins.rows.length) {
        entity = ins.rows[0];
      } else { // 并发竞态：别人先插了 → 复用
        const again = await client.query(`SELECT * FROM world_entities WHERE world_id=$1 AND spec_hash=$2`, [String(p.worldId), hash]);
        entity = again.rows[0];
      }
      let si = 0;
      for (let i = 0; i < p.parts.length; i++) {
        const part = p.parts[i];
        const oid = createdObjects[i];
        if (!entity || !oid) continue;
        await client.query(
          `INSERT INTO world_entity_parts (entity_id, world_object_id, part_key, part_role, asset_ref, local_transform, sort_order)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
           ON CONFLICT (entity_id, part_key) DO NOTHING`,
          [entity.id, oid, String(part.partKey).slice(0, 60), String(part.partRole || 'prop').slice(0, 40),
            JSON.stringify(part.assetRef || null), JSON.stringify(part.localTransform || null), si++]
        );
        await client.query(`UPDATE world_objects SET entity_id = $1 WHERE id = $2`, [entity.id, oid]);
      }
      for (const it of (p.interactions || [])) {
        await client.query(
          `INSERT INTO world_interactions (world_id, entity_id, interaction_type, key, label, position, radius, payload, grants, origin)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,'ai')
           ON CONFLICT (world_id, interaction_type, key) DO NOTHING`,
          [String(p.worldId), entity.id, String(it.interactionType || 'inspect').slice(0, 30),
            String(it.key || 'main').slice(0, 60), it.label ? String(it.label).slice(0, 120) : null,
            JSON.stringify(it.position || null), num(it.radius, 3.0),
            JSON.stringify(it.payload || {}), it.grants ? JSON.stringify(it.grants) : null]
        );
      }
      await client.query('COMMIT');
    } catch (e2) {
      try { await client.query('ROLLBACK'); } catch (e3) { /* 已回滚 */ }
      // Entity 写失败但 world_objects 已建 → 删掉刚建的对象，不留孤儿（账本由 executor 的 undo 兜底）
      for (const oid of createdObjects) {
        try { await query(`DELETE FROM world_objects WHERE id = $1 AND origin = 'ai' AND entity_id IS NULL`, [oid]); } catch (e4) { /* 保留给人工清理 */ }
      }
      return { ok: false, code: 'ASSEMBLE_FAILED', reason: '实体装配事务失败并已回滚：' + String(e2 && e2.message).slice(0, 200) };
    } finally {
      client.release();
    }
  } else {
    // 重跑：只补缺失的部件（UNIQUE(entity_id, part_key) 幂等，P4-7）
    const have = await query(`SELECT part_key, world_object_id FROM world_entity_parts WHERE entity_id = $1`, [entity.id]);
    const haveMap = new Map((have.rows || []).map((r) => [String(r.part_key), r.world_object_id]));
    const missing = p.parts.filter((part) => !haveMap.has(String(part.partKey)));
    if (missing.length) {
      const created = await batchJournal.batchCreate(missing.map((part) => Object.assign({}, part.objectParams, { partKey: part.partKey })), {
        regionKey: p.regionKey, missionId: p.missionId, effectiveAutonomy: p.effectiveAutonomy || 'semi_autonomous',
      });
      if (!created.ok) return { ok: false, code: created.code || 'BATCH_FAILED', reason: created.reason || '补建部件被拒绝' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < missing.length; i++) {
          const part = missing[i];
          const oid = created.ids[i];
          await client.query(
            `INSERT INTO world_entity_parts (entity_id, world_object_id, part_key, part_role, asset_ref, local_transform, sort_order)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,(SELECT COALESCE(MAX(sort_order),0)+1 FROM world_entity_parts WHERE entity_id=$1))
             ON CONFLICT (entity_id, part_key) DO NOTHING`,
            [entity.id, oid, String(part.partKey).slice(0, 60), String(part.partRole || 'prop').slice(0, 40),
              JSON.stringify(part.assetRef || null), JSON.stringify(part.localTransform || null)]
          );
          await client.query(`UPDATE world_objects SET entity_id = $1 WHERE id = $2`, [entity.id, oid]);
        }
        await client.query('COMMIT');
      } catch (e5) {
        try { await client.query('ROLLBACK'); } catch (e6) { /* 已回滚 */ }
        return { ok: false, code: 'ASSEMBLE_FAILED', reason: '补建部件失败并已回滚：' + String(e5 && e5.message).slice(0, 200) };
      } finally {
        client.release();
      }
    }
  }

  const full = await getEntity(p.worldId, entity.id);
  return {
    ok: true, deduped,
    entity: full,
    createdObjectIds: createdObjects,
    undo: { kind: 'remove_entity', worldId: String(p.worldId), entityId: entity.id },
    undoable: true,
  };
}

/**
 * 整体移除（P4-8）：单事务删 N world_objects + 1 Entity + N parts + 本 Entity 交互点。
 * 逐件过守卫（human / 锁定 / 跨区域一律 ROLLBACK 拒绝）。
 */
async function removeBuilding(o) {
  const p = o || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ent = await client.query(`SELECT * FROM world_entities WHERE id = $1 AND world_id = $2 FOR UPDATE`,
      [String(p.entityId), String(p.worldId)]);
    if (!ent.rows.length) { await client.query('ROLLBACK'); return { ok: false, code: 'ENTITY_NOT_FOUND', reason: '实体不存在：' + p.entityId }; }
    const entity = ent.rows[0];
    const parts = await client.query(
      `SELECT o.* FROM world_entity_parts pa JOIN world_objects o ON o.id = pa.world_object_id
        WHERE pa.entity_id = $1 ORDER BY pa.id ASC FOR UPDATE OF o`, [entity.id]);
    const rows = parts.rows || [];
    // 守卫逐件查（审查在删之前完成——任何一件拒绝则整体不动）
    for (const row of rows) {
      const verdict = guard.check('delete_object', row, {
        worldId: p.worldId, regionKey: p.regionKey || row.region_id, missionId: p.missionId || null,
        effectiveAutonomy: p.effectiveAutonomy, approvedRisks: p.approvedRisks || [],
      });
      if (!verdict.allow) { await client.query('ROLLBACK'); return verdict; }
    }
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await client.query(`DELETE FROM world_objects WHERE id = ANY($1::int[])`, [ids]);
    }
    await client.query(`DELETE FROM world_interactions WHERE entity_id = $1`, [entity.id]);
    await client.query(`DELETE FROM world_entities WHERE id = $1`, [entity.id]);   // parts 级联
    await client.query('COMMIT');
    return { ok: true, entityId: entity.id, name: entity.name, deletedObjects: ids.length, deletedInteractions: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return { ok: false, code: 'REMOVE_FAILED', reason: '删除事务失败并已整体回滚：' + String(e && e.message).slice(0, 200) };
  } finally {
    client.release();
  }
}

/** 整体移动/改名（modify_building；位置走 batchJournal.updateObject 保留守卫与 undo） */
async function moveBuilding(o) {
  const p = o || {};
  const ent = await query(`SELECT * FROM world_entities WHERE id = $1 AND world_id = $2`, [String(p.entityId), String(p.worldId)]);
  if (!ent.rows.length) return { ok: false, code: 'ENTITY_NOT_FOUND', reason: '实体不存在：' + p.entityId };
  const parts = await query(`SELECT p.world_object_id, o.position_x, o.position_y, o.position_z
                               FROM world_entity_parts p JOIN world_objects o ON o.id = p.world_object_id
                              WHERE p.entity_id = $1 ORDER BY p.id ASC`, [ent.rows[0].id]);
  const dx = num(p.dx, 0), dy = num(p.dy, 0), dz = num(p.dz, 0);
  const moved = [];
  for (const row of (parts.rows || [])) {
    if (!row.world_object_id) continue;
    const r = await batchJournal.updateObject(Number(row.world_object_id), {
      position_x: num(row.position_x, 0) + dx,
      position_y: num(row.position_y, 0) + dy,
      position_z: num(row.position_z, 0) + dz,
    }, {
      regionKey: p.regionKey, missionId: p.missionId || null,
      effectiveAutonomy: p.effectiveAutonomy, approvedRisks: p.approvedRisks || [],
    });
    if (!r.ok) return { ok: false, code: r.code, reason: r.reason + '（部件 #' + row.world_object_id + '）' };
    moved.push(r.id);
  }
  if (p.name) {
    await query(`UPDATE world_entities SET name = $2, updated_at = NOW() WHERE id = $1`, [ent.rows[0].id, String(p.name).slice(0, 120)]);
  }
  return { ok: true, moved, count: moved.length };
}

/** 更新 gameplay / npc_refs（npcTools 用；白名单字段） */
async function updateEntity(worldId, entityId, patch) {
  const sets = [];
  const params = [];
  if (patch.gameplay !== undefined) { params.push(JSON.stringify(patch.gameplay)); sets.push(`gameplay = $${params.length}::jsonb`); }
  if (patch.npcRefs !== undefined) { params.push(JSON.stringify(patch.npcRefs)); sets.push(`npc_refs = $${params.length}::jsonb`); }
  if (patch.physical !== undefined) { params.push(JSON.stringify(patch.physical)); sets.push(`physical = $${params.length}::jsonb`); }
  if (!sets.length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: 'patch 没有可更新字段（白名单：gameplay/npcRefs/physical）' };
  params.push(String(worldId), String(entityId));
  const r = await query(
    `UPDATE world_entities SET ${sets.join(', ')}, updated_at = NOW()
      WHERE world_id = $${params.length - 1} AND id = $${params.length} RETURNING *`, params);
  if (!r.rows.length) return { ok: false, code: 'ENTITY_NOT_FOUND', reason: '实体不存在：' + entityId };
  return { ok: true, entity: r.rows[0] };
}

module.exports = { assembleEntity, removeBuilding, moveBuilding, updateEntity, getEntity, specHash };
