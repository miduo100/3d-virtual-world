/**
 * gameplayDefs —— 玩法 DSL 校验（AI World Brain · Phase 6 · 分册 §9.2/§9.3/§9.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 玩法是数据不是代码（§9.1）：AI 只能提交白名单 kind + 白名单算子 + where 固定字段，
 *   **不支持任意表达式**——这是防"玩法定义变成可执行注入"的关键（§9.3 判据说明）。
 * winWhen 条件形状：[{ event, where?, count? }]；where 字段白名单：
 *   regionKey / objectId / objectTag / actorType / actorId / interactionKey。
 */
'use strict';

/** MVP 白名单玩法 kind（§9.5：AI 不能提交新 DSL key） */
const KINDS = ['treasure_hunt', 'cleanup_drive', 'social_mixer', 'race', 'building_contest'];

/** winWhen 允许引用的事件类型（eventLog.TYPES 的子集） */
const WIN_EVENTS = ['object_interact', 'entity_enter_region', 'chat', 'economy', 'activity_participant', 'task_completed'];

const WHERE_KEYS = ['regionKey', 'objectId', 'objectTag', 'actorType', 'actorId', 'interactionKey'];

/** kind → 默认 winWhen 模板（AI 未显式给 winWhen 时使用） */
const DEFAULT_WIN = {
  treasure_hunt: [{ event: 'object_interact', where: { objectTag: 'treasure' }, count: 3 }],
  cleanup_drive: [{ event: 'object_interact', where: { objectTag: 'trash' }, count: 5 }],
  social_mixer: [{ event: 'chat', count: 10 }],
  race: [{ event: 'entity_enter_region', count: 1 }],
  building_contest: [{ event: 'task_completed', count: 1 }],
};

function validateWinWhen(winWhen) {
  if (winWhen === undefined || winWhen === null) return { ok: true };
  if (!Array.isArray(winWhen) || !winWhen.length) return { ok: false, reason: 'winWhen 必须是非空数组' };
  if (winWhen.length > 5) return { ok: false, reason: 'winWhen 条件数 ≤ 5' };
  for (const c of winWhen) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, reason: 'winWhen 条件必须是对象' };
    if (WIN_EVENTS.indexOf(c.event) < 0) return { ok: false, reason: 'winWhen.event 白名单外：' + String(c.event) };
    if (c.where !== undefined) {
      if (!c.where || typeof c.where !== 'object' || Array.isArray(c.where)) return { ok: false, reason: 'where 必须是平面对象' };
      for (const k of Object.keys(c.where)) {
        if (WHERE_KEYS.indexOf(k) < 0) return { ok: false, reason: 'where 字段白名单外：' + k + '（不支持任意表达式，§9.3）' };
        const v = c.where[k];
        if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, reason: 'where.' + k + ' 只允许字符串/数字' };
      }
    }
    if (c.count !== undefined && (!Number.isFinite(Number(c.count)) || Number(c.count) <= 0)) {
      return { ok: false, reason: 'count 必须是正数' };
    }
  }
  return { ok: true };
}

function validateRules(rules) {
  if (rules === undefined || rules === null) return { ok: true };
  if (typeof rules !== 'object' || Array.isArray(rules)) return { ok: false, reason: 'rules 必须是对象' };
  for (const k of Object.keys(rules)) {
    if (['minLevel', 'teamSize', 'allowAgent', 'allowHuman', 'maxParticipants'].indexOf(k) < 0) {
      return { ok: false, reason: 'rules 字段白名单外：' + k };
    }
  }
  return { ok: true };
}

/**
 * 活动入参总校验（create_event / create_game 工具共用）。
 * @returns {ok, errors?:[{path,message}]}
 */
function validateActivity(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return { ok: false, errors: [{ path: '', message: '参数必须是对象' }] };
  if (!p.title) errors.push({ path: 'title', message: '必须给 title' });
  if (p.kind !== undefined && KINDS.indexOf(p.kind) < 0) {
    errors.push({ path: 'kind', message: '玩法 kind 白名单外：' + String(p.kind) + '（' + KINDS.join('/') + '）' });
  }
  const wv = validateWinWhen(p.winWhen);
  if (!wv.ok) errors.push({ path: 'winWhen', message: wv.reason });
  const rl = validateRules(p.rules);
  if (!rl.ok) errors.push({ path: 'rules', message: rl.reason });
  if (p.gameplayParams !== undefined && (typeof p.gameplayParams !== 'object' || Array.isArray(p.gameplayParams))) {
    errors.push({ path: 'gameplayParams', message: 'gameplayParams 必须是对象' });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** 缺省 winWhen（kind 模板） */
function defaultWinWhen(kind) {
  return DEFAULT_WIN[kind] || [{ event: 'chat', count: 10 }];
}

module.exports = { KINDS, WIN_EVENTS, WHERE_KEYS, validateActivity, validateWinWhen, defaultWinWhen };
