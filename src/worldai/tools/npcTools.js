/**
 * npcTools —— ④ NPC / 玩法绑定 4 工具（AI World Brain · Phase 5 · §D.3④ + P4-13/P4-14）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * create_npc → npcs 表 + world_entities.npc_refs 追加
 * create_interaction → world_interactions（世界交互点；Agent interact 已在 P35 接线）
 * create_quest → world_tasks + world_entities.gameplay.questIds 追加
 * update_entity_gameplay → gameplay 白名单字段合并
 * ★ 只允许挂到 origin='ai' 的实体（human 世界没有 entity；纵深防御照查一次）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const entityAssembler = require('../builder/entityAssembler');

const INTERACTION_TYPES = ['quest_board', 'npc_talk', 'shop_open', 'portal_use', 'inspect', 'activity_join', 'reward_grant'];

async function requireAiEntity(worldId, entityId) {
  if (!entityId) return { ok: true, entity: null };
  const r = await query(`SELECT * FROM world_entities WHERE id = $1 AND world_id = $2`, [String(entityId), String(worldId)]);
  if (!r.rows.length) return { ok: false, code: 'ENTITY_NOT_FOUND', reason: '实体不存在：' + entityId };
  if (String(r.rows[0].origin || '') !== 'ai') {
    return { ok: false, code: 'HUMAN_ASSET_PROTECTED', reason: "实体 origin='" + r.rows[0].origin + "' 不是 AI 实体，禁止挂玩法" };
  }
  return { ok: true, entity: r.rows[0] };
}

/** npc_refs / gameplay 追加（读-改-写，量级 1 行，无并发风险） */
async function appendTo(worldId, entityId, field, value) {
  const r = await query(`SELECT ${field} FROM world_entities WHERE id = $1 AND world_id = $2`, [String(entityId), String(worldId)]);
  if (!r.rows.length) return { ok: false, code: 'ENTITY_NOT_FOUND' };
  const cur = r.rows[0][field];
  let next;
  if (field === 'npc_refs') {
    const arr = Array.isArray(cur) ? cur.slice() : [];
    arr.push(value);
    next = arr;
  } else {
    next = Object.assign({}, cur || {}, value);
  }
  const upd = await entityAssembler.updateEntity(worldId, entityId, field === 'npc_refs' ? { npcRefs: next } : { gameplay: next });
  return upd;
}

function registerAll() {
  const R = (d) => verbRegistry.register(Object.assign({ category: 'npc', scope: 'world:build' }, d));

  // ── create_npc ────────────────────────────────────────────────────────
  R({
    name: 'create_npc', risk: 'low', reversible: true, guardAction: null,
    summary: '创建 NPC（npcs 表；可挂到 AI 实体 → npc_refs 追加）',
    params: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      entityId: { type: 'string', maxLength: 64 },
      role: { type: 'string', maxLength: 40 },
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      avatarEmoji: { type: 'string', maxLength: 10 },
      systemPrompt: { type: 'string', maxLength: 4000 },
      description: { type: 'string', maxLength: 500 },
    } },
    impl: async (p, ctx) => {
      const ent = await requireAiEntity(ctx.worldId, p.entityId);
      if (!ent.ok) return ent;
      const ins = await query(
        `INSERT INTO npcs (name, description, avatar_emoji, position, system_prompt)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
        [String(p.name), p.description ? String(p.description) : null,
          p.avatarEmoji ? String(p.avatarEmoji) : '🧑',
          JSON.stringify({ x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 }),
          p.systemPrompt ? String(p.systemPrompt) : null]
      );
      const npcId = ins.rows[0].id;
      if (ent.entity) {
        const ap = await appendTo(ctx.worldId, ent.entity.id, 'npc_refs',
          { npcId, role: String(p.role || 'npc').slice(0, 40), position: { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 } });
        if (!ap.ok) return { ok: false, code: ap.code || 'NPC_REF_FAILED', reason: 'NPC 已建但挂实体失败：' + (ap.reason || ap.code) };
      }
      return {
        ok: true,
        result: { npcId, attachedEntity: ent.entity ? ent.entity.id : null },
        afterState: { npcId },
        undo: { kind: 'delete_npc', worldId: String(ctx.worldId), npcId },
        undoable: true,
      };
    },
  });

  // ── create_interaction ────────────────────────────────────────────────
  R({
    name: 'create_interaction', risk: 'low', reversible: true, guardAction: null,
    summary: '创建交互点（world_interactions；Agent interact 链路已消费 reward_grant 类型）',
    params: { type: 'object', required: ['interactionType', 'key'], properties: {
      entityId: { type: 'string', maxLength: 64 },
      worldObjectId: { type: 'integer', min: 1 },
      interactionType: { type: 'string', enum: INTERACTION_TYPES },
      key: { type: 'string', minLength: 1, maxLength: 60 },
      label: { type: 'string', maxLength: 120 },
      radius: { type: 'number', min: 0.5, max: 50 },
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      payload: { type: 'object' },
      grants: { type: 'object' },
    } },
    impl: async (p, ctx) => {
      const ent = await requireAiEntity(ctx.worldId, p.entityId);
      if (!ent.ok) return ent;
      const position = p.x !== undefined || p.z !== undefined
        ? { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 } : null;
      const ins = await query(
        `INSERT INTO world_interactions (world_id, entity_id, world_object_id, interaction_type, key, label, position, radius, payload, grants, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,'ai')
         ON CONFLICT (world_id, interaction_type, key)
         DO UPDATE SET label = EXCLUDED.label, radius = EXCLUDED.radius, payload = EXCLUDED.payload, grants = EXCLUDED.grants, updated_at = NOW()
         RETURNING id`,
        [String(ctx.worldId), ent.entity ? ent.entity.id : null,
          Number.isInteger(Number(p.worldObjectId)) ? Number(p.worldObjectId) : null,
          String(p.interactionType), String(p.key), p.label ? String(p.label) : null,
          JSON.stringify(position), Number(p.radius) || 3.0,
          JSON.stringify(p.payload || {}), p.grants ? JSON.stringify(p.grants) : null]
      );
      return {
        ok: true,
        result: { interactionId: ins.rows[0].id, key: String(p.key) },
        afterState: { interactionId: ins.rows[0].id },
        undo: { kind: 'delete_interaction', worldId: String(ctx.worldId), interactionId: ins.rows[0].id },
        undoable: true,
      };
    },
  });

  // ── create_quest ──────────────────────────────────────────────────────
  R({
    name: 'create_quest', risk: 'low', reversible: true, guardAction: null,
    summary: '创建任务（world_tasks，visibility=agent_only；挂实体时 gameplay.questIds 追加）',
    params: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      entityId: { type: 'string', maxLength: 64 },
      regionKey: { type: 'string', maxLength: 60 },
      questType: { type: 'string', enum: ['main', 'side'] },
      objectives: { type: 'array', maxItems: 10, items: { type: 'object' } },
      reward: { type: 'object' },
      expiresAt: { type: 'string', maxLength: 40 },
    } },
    impl: async (p, ctx) => {
      const ent = await requireAiEntity(ctx.worldId, p.entityId);
      if (!ent.ok) return ent;
      const objectives = (Array.isArray(p.objectives) && p.objectives.length)
        ? p.objectives
        : [{ type: 'object_interact', key: 'reward_grant:' + String(p.entityId || 'main').slice(0, 8), count: 1 }];
      const ins = await query(
        `INSERT INTO world_tasks (world_id, title, description, type, objectives, region_key, entity_id, status, visibility, reward, origin, expires_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'published','agent_only',$8::jsonb,'ai',$9) RETURNING id`,
        [String(ctx.worldId), String(p.title), p.description ? String(p.description) : null,
          p.questType === 'main' ? 'main' : 'side', JSON.stringify(objectives),
          p.regionKey ? String(p.regionKey) : (ent.entity ? ent.entity.region_key : null),
          ent.entity ? ent.entity.id : null,
          JSON.stringify(p.reward || { type: 'reward_codes', count: 1 }),
          p.expiresAt ? String(p.expiresAt) : null]
      );
      const taskId = ins.rows[0].id;
      if (ent.entity) {
        const gp = await appendTo(ctx.worldId, ent.entity.id, 'gameplay', {
          questIds: ((ent.entity.gameplay && ent.entity.gameplay.questIds) || []).concat([taskId]),
        });
        if (!gp.ok) return { ok: false, code: gp.code || 'QUEST_REF_FAILED', reason: '任务已建但挂实体失败：' + (gp.reason || gp.code) };
      }
      return {
        ok: true,
        result: { taskId, attachedEntity: ent.entity ? ent.entity.id : null },
        afterState: { taskId },
        undo: { kind: 'delete_quest', worldId: String(ctx.worldId), taskId },
        undoable: true,
      };
    },
  });

  // ── update_entity_gameplay ────────────────────────────────────────────
  R({
    name: 'update_entity_gameplay', risk: 'low', reversible: false, guardAction: null,
    summary: '更新实体玩法标记（gameplay.rewardPoolKey/importance/tags/activityKeys 白名单合并）',
    params: { type: 'object', required: ['entityId'], properties: {
      entityId: { type: 'string', minLength: 8, maxLength: 64 },
      rewardPoolKey: { type: 'string', maxLength: 60 },
      importance: { type: 'integer', min: 0, max: 5 },
      tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
      activityKeys: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 60 } },
    } },
    impl: async (p, ctx) => {
      const ent = await requireAiEntity(ctx.worldId, p.entityId);
      if (!ent.ok) return ent;
      const cur = (ent.entity.gameplay) || {};
      const patch = {};
      if (p.rewardPoolKey !== undefined) patch.rewardPoolKey = String(p.rewardPoolKey);
      if (p.importance !== undefined) patch.importance = Math.floor(Number(p.importance));
      if (p.tags !== undefined) patch.tags = p.tags.map(String);
      if (p.activityKeys !== undefined) patch.activityKeys = p.activityKeys.map(String);
      const upd = await entityAssembler.updateEntity(ctx.worldId, ent.entity.id, { gameplay: Object.assign({}, cur, patch) });
      if (!upd.ok) return { ok: false, code: upd.code, reason: upd.reason };
      return { ok: true, result: { entityId: ent.entity.id, gameplay: upd.entity.gameplay }, afterState: { entityId: ent.entity.id }, undoable: false };
    },
  });
}

module.exports = { registerAll, INTERACTION_TYPES };
