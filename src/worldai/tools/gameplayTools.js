/**
 * gameplayTools —— ⑤ 玩法 9 工具 + ⑥ 世界系统 2 工具（AI World Brain · Phase 6 · §D.3⑤⑥）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 与 npcTools 不重名（create_quest/create_interaction/create_npc 在 npcTools，勿重复注册）。
 * ★ §K.5 禁写表不注册：create_portal（portals 不可写）、modify_world_rule（world_rules 只读）
 *   —— 属"§D.3⑥ 清单与红线冲突，红线优先"的规格偏差，登记 §J.3。
 * ★ 任务/活动核心在 taskService / activityService / gameplayDefs；工具层只做参数整形。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const taskService = require('../gameplay/taskService');
const activityService = require('../gameplay/activityService');
const gameplayDefs = require('../gameplay/gameplayDefs');

function registerAll() {
  const R = (d) => verbRegistry.register(Object.assign({ category: 'gameplay', scope: 'world:build' }, d));

  // ── ⑤ 玩法 ────────────────────────────────────────────────────────────
  R({
    name: 'create_task', risk: 'low', reversible: true, guardAction: null,
    summary: '创建任务（world_tasks，status=published；create_quest 的单目标别名语义）',
    params: { type: 'object', required: ['title', 'objectives'], properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      objectives: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object' } },
      regionKey: { type: 'string', maxLength: 60 },
      entityId: { type: 'string', maxLength: 64 },
      questType: { type: 'string', enum: ['main', 'side'] },
      visibility: { type: 'string', enum: ['public', 'agent_only', 'human_only'] },
      reward: { type: 'object' },
      repeatable: { type: 'boolean' },
      maxCompletions: { type: 'integer', min: 1, max: 1000 },
      expiresAt: { type: 'string', maxLength: 40 },
      giverType: { type: 'string', maxLength: 20 },
      giverId: { type: 'string', maxLength: 100 },
    } },
    impl: async (p, ctx) => {
      const v = taskService.validateObjectives(p.objectives);
      if (!v.ok) return { ok: false, code: 'OBJECTIVES_INVALID', reason: v.reason };
      const r = await taskService.createTask({
        worldId: ctx.worldId, title: p.title, description: p.description,
        objectives: p.objectives, regionKey: p.regionKey, entityId: p.entityId,
        questType: p.questType, visibility: p.visibility, reward: p.reward,
        repeatable: p.repeatable, maxCompletions: p.maxCompletions, expiresAt: p.expiresAt,
        giverType: p.giverType, giverId: p.giverId,
        planStepId: ctx.executionId ? null : null, origin: 'ai',
      });
      if (!r.ok) return r;
      return {
        ok: true, result: { taskId: r.task.id, status: r.task.status },
        afterState: { taskId: r.task.id },
        undo: { kind: 'cancel_task', worldId: String(ctx.worldId), taskId: r.task.id },
        undoable: true,
      };
    },
  });

  R({
    name: 'modify_task', risk: 'medium', reversible: false, guardAction: null,
    summary: '修改任务（title/description/reward/expiresAt 白名单 patch）',
    params: { type: 'object', required: ['taskId'], properties: {
      taskId: { type: 'string', minLength: 8, maxLength: 64 },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      reward: { type: 'object' },
      expiresAt: { type: 'string', maxLength: 40 },
    } },
    impl: async (p) => {
      const sets = []; const args = [];
      const push = (col, val) => { args.push(val); sets.push(col + '=$' + args.length); };
      if (p.title !== undefined) push('title', String(p.title).slice(0, 200));
      if (p.description !== undefined) push('description', String(p.description).slice(0, 1000));
      if (p.reward !== undefined) { args.push(JSON.stringify(p.reward)); sets.push('reward=$' + args.length + '::jsonb'); }
      if (p.expiresAt !== undefined) push('expires_at', p.expiresAt ? String(p.expiresAt) : null);
      if (!sets.length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: '没有可更新字段' };
      args.push(String(p.taskId));
      const r = await query(`UPDATE world_tasks SET ` + sets.join(',') + `, updated_at=NOW() WHERE id=$` + args.length + ` RETURNING id`, args);
      if (!r.rows.length) return { ok: false, code: 'TASK_NOT_FOUND', reason: '任务不存在' };
      return { ok: true, result: { taskId: r.rows[0].id }, afterState: { taskId: r.rows[0].id }, undoable: false };
    },
  });

  R({
    name: 'cancel_task', risk: 'low', reversible: false, guardAction: null,
    summary: '取消任务（published/active → cancelled；已发奖励不追回，§10.3）',
    params: { type: 'object', required: ['taskId'], properties: {
      taskId: { type: 'string', minLength: 8, maxLength: 64 },
      reason: { type: 'string', maxLength: 200 },
    } },
    impl: async (p) => {
      const r = await taskService.cancelTask({ taskId: p.taskId });
      if (!r.ok) return r;
      return { ok: true, result: { taskId: r.taskId }, afterState: { taskId: r.taskId, status: 'cancelled' }, undoable: false };
    },
  });

  // create_event / create_game：medium 风险（§G.4；P5-7 验证 medium→审批链）
  const eventImpl = async (p, ctx) => {
    const v = gameplayDefs.validateActivity(p);
    if (!v.ok) return { ok: false, code: 'GAMEPLAY_DEF_INVALID', reason: v.errors.map((e) => e.path + ' ' + e.message).join('; ') };
    const r = await activityService.createActivity({
      worldId: ctx.worldId, kind: p.kind, title: p.title, description: p.description,
      regionKey: p.regionKey, createdBy: 'world_ai', origin: 'ai',
      schedule: p.schedule, gameplayDef: p.kind, gameplayParams: p.gameplayParams,
      rules: p.rules, winWhen: p.winWhen, reward: p.reward,
    });
    if (!r.ok) return r;
    return {
      ok: true, result: { activityId: r.activity.id, status: r.activity.status },
      afterState: { activityId: r.activity.id },
      undo: { kind: 'cancel_event', worldId: String(ctx.worldId), activityId: r.activity.id },
      undoable: true,
    };
  };
  R({
    name: 'create_event', risk: 'medium', reversible: true, guardAction: null,
    summary: '创建活动（world_activities，kind 白名单 DSL；medium 风险走 risk_policy）',
    params: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      kind: { type: 'string', maxLength: 40 },
      description: { type: 'string', maxLength: 1000 },
      regionKey: { type: 'string', maxLength: 60 },
      schedule: { type: 'object' }, gameplayParams: { type: 'object' },
      rules: { type: 'object' }, winWhen: { type: 'array', maxItems: 5 }, reward: { type: 'object' },
    } },
    impl: eventImpl,
  });
  R({
    name: 'create_game', risk: 'medium', reversible: true, guardAction: null,
    summary: '创建可重复玩法实例（world_activities；kind 必须在白名单 DSL，§9.5）',
    params: { type: 'object', required: ['kind', 'title'], properties: {
      kind: { type: 'string', minLength: 1, maxLength: 40 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      regionKey: { type: 'string', maxLength: 60 },
      schedule: { type: 'object' }, gameplayParams: { type: 'object' },
      rules: { type: 'object' }, winWhen: { type: 'array', maxItems: 5 }, reward: { type: 'object' },
    } },
    impl: eventImpl,
  });

  R({
    name: 'modify_event', risk: 'medium', reversible: false, guardAction: null,
    summary: '修改活动（title/description/schedule/winWhen/rules 白名单 patch）',
    params: { type: 'object', required: ['activityId'], properties: {
      activityId: { type: 'string', minLength: 8, maxLength: 64 },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      schedule: { type: 'object' }, rules: { type: 'object' },
      winWhen: { type: 'array', maxItems: 5 },
    } },
    impl: async (p) => {
      if (p.winWhen !== undefined) {
        const v = gameplayDefs.validateWinWhen(p.winWhen);
        if (!v.ok) return { ok: false, code: 'GAMEPLAY_DEF_INVALID', reason: v.reason };
      }
      const sets = []; const args = [];
      const push = (col, val) => { args.push(val); sets.push(col + '=$' + args.length); };
      if (p.title !== undefined) push('title', String(p.title).slice(0, 200));
      if (p.description !== undefined) push('description', String(p.description).slice(0, 1000));
      if (p.schedule !== undefined) { args.push(JSON.stringify(p.schedule)); sets.push('schedule=$' + args.length + '::jsonb'); }
      if (p.rules !== undefined) { args.push(JSON.stringify(p.rules)); sets.push('rules=$' + args.length + '::jsonb'); }
      if (p.winWhen !== undefined) { args.push(JSON.stringify(p.winWhen)); sets.push('win_when=$' + args.length + '::jsonb'); }
      if (!sets.length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: '没有可更新字段' };
      args.push(String(p.activityId));
      const r = await query(`UPDATE world_activities SET ` + sets.join(',') + `, updated_at=NOW() WHERE id=$` + args.length + ` RETURNING id`, args);
      if (!r.rows.length) return { ok: false, code: 'ACTIVITY_NOT_FOUND', reason: '活动不存在' };
      return { ok: true, result: { activityId: r.rows[0].id }, afterState: { activityId: r.rows[0].id }, undoable: false };
    },
  });
  R({ name: 'modify_game', risk: 'medium', reversible: false, guardAction: null,
    summary: '修改玩法实例（同 modify_event 白名单口径）',
    params: { type: 'object', required: ['activityId'], properties: {
      activityId: { type: 'string', minLength: 8, maxLength: 64 },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 1000 },
      rules: { type: 'object' }, winWhen: { type: 'array', maxItems: 5 },
    } },
    impl: async (p, ctx) => {
      const def = verbRegistry.get('modify_event');
      return def.impl(p, ctx);
    },
  });

  R({
    name: 'cancel_event', risk: 'low', reversible: false, guardAction: null,
    summary: '取消活动（未结束状态 → cancelled）',
    params: { type: 'object', required: ['activityId'], properties: {
      activityId: { type: 'string', minLength: 8, maxLength: 64 },
      reason: { type: 'string', maxLength: 200 },
    } },
    impl: async (p) => {
      const r = await activityService.cancel(p.activityId, p.reason);
      if (!r.ok) return r;
      return { ok: true, result: { activityId: r.activityId }, afterState: { activityId: r.activityId, status: 'cancelled' }, undoable: false };
    },
  });

  R({
    name: 'create_reward', risk: 'medium', reversible: false, guardAction: null,
    summary: '查看奖励池可用额度（读 reward_pools/reward_codes，不新建池，§D.3⑤）',
    params: { type: 'object', required: ['poolKey'], properties: {
      poolKey: { type: 'string', minLength: 1, maxLength: 100 },
    } },
    impl: async (p) => {
      const r = await query(
        `SELECT rp.id, rp.pool_name,
                count(rc.id) FILTER (WHERE rc.is_claimed=FALSE AND (rc.expires_at IS NULL OR rc.expires_at>NOW()))::int AS available,
                count(rc.id)::int AS total
           FROM reward_pools rp LEFT JOIN reward_codes rc ON rc.pool_id = rp.id
          WHERE rp.pool_name=$1 GROUP BY rp.id`, [String(p.poolKey)]);
      if (!r.rows.length) return { ok: false, code: 'POOL_NOT_FOUND', reason: '奖励池不存在：' + p.poolKey + '（AI 不新建池，请管理员先建）' };
      const row = r.rows[0];
      if (row.available <= 0) return { ok: false, code: 'POOL_EMPTY', reason: '奖励池已空（玩法会提前结束，不超发，§9.5）', result: { pool: row } };
      return { ok: true, result: { pool: row }, afterState: { pool: row.pool_name }, undoable: false };
    },
  });

  // ── ⑥ 世界系统（可做 2 个；portal/world_rule 属禁写表不注册，§K.5）───────
  R({
    name: 'create_shop', risk: 'medium', reversible: true, guardAction: null,
    summary: '创建商店（shops + shop_items；merchant 可空=AI 商店；金额/数量必须正数）',
    params: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      merchantUserId: { type: 'string', maxLength: 64 },
      items: { type: 'array', maxItems: 20, items: { type: 'object' } },
    } },
    impl: async (p, ctx) => {
      const items = Array.isArray(p.items) ? p.items : [];
      for (const it of items) {
        const price = Number(it && it.price), qty = Number(it && it.quantity);
        if (!it || !it.name || !Number.isFinite(price) || price < 0 || !Number.isInteger(qty) || qty <= 0) {
          return { ok: false, code: 'SHOP_ITEM_INVALID', reason: 'items 每项必须有 name + price≥0 + quantity 正整数' };
        }
      }
      let merchantId = null;
      if (p.merchantUserId) {
        const u = await query(`SELECT id FROM users WHERE id=$1`, [String(p.merchantUserId)]);
        if (!u.rows.length) return { ok: false, code: 'MERCHANT_NOT_FOUND', reason: 'merchantUserId 不存在（AI 不建 users 行，红线）' };
        merchantId = u.rows[0].id;
      }
      const ins = await query(
        `INSERT INTO shops (merchant_id, shop_name, position) VALUES ($1,$2,$3::jsonb) RETURNING id`,
        [merchantId, String(p.name).slice(0, 100),
          JSON.stringify({ x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 })]);
      const shopId = ins.rows[0].id;
      const itemIds = [];
      for (const it of items) {
        const ir = await query(
          `INSERT INTO shop_items (shop_id, item_name, description, price, quantity) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [shopId, String(it.name).slice(0, 100), it.description ? String(it.description).slice(0, 500) : null,
            Number(it.price), Number(it.quantity)]);
        itemIds.push(ir.rows[0].id);
      }
      return {
        ok: true, result: { shopId, itemIds },
        afterState: { shopId },
        undo: { kind: 'delete_shop', worldId: String(ctx.worldId), shopId },
        undoable: true,
      };
    },
  });

  R({
    name: 'create_item', risk: 'medium', reversible: true, guardAction: null,
    summary: '向既有奖励池添加兑换码（reward_codes；池必须已存在）',
    params: { type: 'object', required: ['poolKey', 'name', 'code'], properties: {
      poolKey: { type: 'string', minLength: 1, maxLength: 100 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      code: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: 'string', maxLength: 500 },
      platformUrl: { type: 'string', maxLength: 500 },
    } },
    impl: async (p, ctx) => {
      const poolRow = (await query(`SELECT id FROM reward_pools WHERE pool_name=$1`, [String(p.poolKey)])).rows[0];
      if (!poolRow) return { ok: false, code: 'POOL_NOT_FOUND', reason: '奖励池不存在：' + p.poolKey + '（AI 不新建池）' };
      const dup = await query(`SELECT id FROM reward_codes WHERE code=$1 LIMIT 1`, [String(p.code)]);
      if (dup.rows.length) return { ok: false, code: 'CODE_DUPLICATED', reason: '兑换码已存在（唯一性）' };
      const ins = await query(
        `INSERT INTO reward_codes (pool_id, code, reward_name, reward_desc, platform_url)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [poolRow.id, String(p.code), String(p.name).slice(0, 200),
          p.description ? String(p.description).slice(0, 500) : null,
          p.platformUrl ? String(p.platformUrl).slice(0, 500) : null]);
      return {
        ok: true, result: { codeId: ins.rows[0].id, poolKey: String(p.poolKey) },
        afterState: { codeId: ins.rows[0].id },
        undo: { kind: 'delete_code', worldId: String(ctx.worldId), codeId: ins.rows[0].id },
        undoable: true,
      };
    },
  });
}

module.exports = { registerAll };
