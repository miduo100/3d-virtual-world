/**
 * ownershipGuard —— AI 写世界前的**唯一**所有权守卫（Phase 3.5-1 · §G.5 ①）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§G.5 ①（含 v1.5 两处订正）+ §C.2 四级所有权表 + §I.3 自主度三档。
 *
 * ★ 这是用户红线的唯一执行点（2026-10-08：「用户搭建放置的模型不能随意删除」）：
 *   autonomy 只决定 AI 能做多少；本守卫决定 AI **永远不能碰什么**。
 *
 * 三条设计纪律（不可妥协）：
 *   ① 纯函数、无 IO、无配置、无 force 参数 —— 不可绕过，也不设管理员临时豁免开关；
 *   ② 判定矩阵来自 §G.5 ①，不在本文件里"顺手优化"；
 *   ③ autonomy 下限只约束「无委托上下文的自主写」（v1.5 订正）：
 *      委托内写以 created_by = ctx.missionId + 区域围栏为准；
 *      否则 managed 档（3.5 的默认演示档）一件都放不下。该判定由判据 P35-3b 断言仍在。
 */
'use strict';

/** §I.3 v1.5：两级同枚举同序，直接序比较即可，无映射歧义 */
const AUTONOMY_ORDER = { managed: 1, semi_autonomous: 2, autonomous: 3 };

/** §C.2：AI 可写/可删的唯一定位 */
const AI_OWNED = 'ai';
/** origin ∈ 这三者：只读，写/删一律 DENY（不接受任何 override） */
const PROTECTED = ['human', 'admin', 'import'];

/** §G.5①：永不删/永不碰的类型（传送门、广告位 —— AI 一律不碰） */
const NEVER_TOUCH_TYPES = ['portal', 'ad_slot'];

const READ_ACTIONS = ['observe', 'get', 'search_assets', 'snapshot', 'read'];
const WRITE_ACTIONS = ['place_part', 'move', 'scale', 'rotate', 'modify', 'move_object'];
const DELETE_ACTIONS = ['delete', 'delete_object', 'remove_building'];
/** high 风险动词：删自己的 AI 对象也必须人工审批（3.5 用后台一键回滚通道代替审批） */
const HIGH_RISK = new Set(DELETE_ACTIONS);

function kindOf(action) {
  const a = String(action || '');
  if (DELETE_ACTIONS.indexOf(a) >= 0) return 'delete';
  if (WRITE_ACTIONS.indexOf(a) >= 0) return 'write';
  if (READ_ACTIONS.indexOf(a) >= 0) return 'read';
  return 'unknown';
}

function deny(code, reason, extra) {
  // 同时给 allow:false 与 ok:false：守卫结果会被 journal / missionTools 直接当返回值透出，
  // 两种形状都要有（否则调用方判 result.ok 会踩 undefined）。
  return Object.assign({ allow: false, ok: false, code, reason, risk: null }, extra || {});
}
/**
 * 唯一入口。
 * @param {string} action 动词（place_part / move_object / delete_object / observe_* ...）
 * @param {object|null} target 目标对象行（读/搜索可 null；place 新建时传 { origin:'ai' } 预设行）
 * @param {object} ctx { worldId, regionKey, missionId, autonomy, effectiveAutonomy,
 *                       protectedSpawnRadius, spawnPoint, approvedRisks }
 * @returns {{allow:boolean, code:string, reason:string, risk:string|null}}
 */
function check(action, target, ctx) {
  const c = ctx || {};
  const kind = kindOf(action);
  const risk = kind === 'read' ? 'none' : (HIGH_RISK.has(String(action)) ? 'high' : (kind === 'write' ? 'low' : 'medium'));

  // 1) 读：一律放行（AI 可以看见全世界，这是规划的前提）
  if (kind === 'read') return { allow: true, code: 'READ_ALLOWED', reason: '只读动作', risk: 'none' };

  // 2) 未知动词：拒绝（不是"以后再说"，是防将来新增动词绕过守卫）
  if (kind === 'unknown') return deny('UNKNOWN_VERB', '未知动词「' + action + '」不在守卫词表内，拒绝执行（防新增动词绕过守卫）');

  // 3) 不可触碰的类型：传送门 / 广告位（§G.5① 末行）
  if (target && NEVER_TOUCH_TYPES.indexOf(String(target.type || '')) >= 0) {
    return deny('NEVER_TOUCH_TYPE', "type='" + target.type + "' 属永不触碰类型（传送门/广告位），" + (kind === 'delete' ? '删除' : '修改') + '一律拒绝');
  }

  // 4) origin 保护：非 ai 一律只读（红线本体，不接受任何 override）
  const origin = target && target.origin ? String(target.origin) : null;
  if (target && PROTECTED.indexOf(origin) >= 0) {
    return deny('HUMAN_ASSET_PROTECTED', "目标 origin='" + origin + "' 属人工资产，AI 只读不写不删（§C.2 用户红线，无任何绕过参数）", { origin: origin });
  }
  if (target && origin !== AI_OWNED) {
    return deny('ORIGIN_NOT_AI', "目标 origin='" + (origin || 'NULL') + "' 不是 AI 资产，拒绝", { origin: origin });
  }
  if (!target && kind !== 'read') {
    return deny('TARGET_REQUIRED', '写/删动作必须带 target 对象行（守卫无法确认其 origin）');
  }

  // 5) is_locked：锁定的对象 AI 连自己创建的也不动
  if (target && target.is_locked === true) {
    return deny('OBJECT_LOCKED', '目标 is_locked=true，AI 不得修改或删除');
  }

  // 6) 区域围栏：AI 只能动本区域的对象（自主写也必须有区域上下文）
  if (!c.regionKey) {
    return deny('REGION_REQUIRED', 'ctx.regionKey 缺失：自主写必须限定区域（§H.10.4 并行的安全边界 = 区域边界）');
  }
  if (target && target.region_id && String(target.region_id) !== String(c.regionKey)) {
    return deny('CROSS_REGION', "目标 region_id='" + target.region_id + "' ≠ 当前区域 '" + c.regionKey + "'，AI 不得跨区域操作");
  }
  // 7) 授权来源：委托内写（created_by = missionId）优先
  const missionId = c.missionId ? String(c.missionId) : null;
  if (missionId) {
    if (String(target.created_by || '') !== missionId) {
      return deny('NOT_MISSION_OWNER', "目标 created_by='" + (target.created_by || 'NULL') + "' ≠ 本委托 '" + missionId + "'：只允许删/改本委托自己创建的对象", { createdBy: target.created_by || null, missionId: missionId });
    }
  } else {
    // 8) 无委托上下文的自主写：受 autonomy 下限约束（v1.5 订正核心，判据 P35-3b 断言它还在）
    const order = AUTONOMY_ORDER[c.effectiveAutonomy || c.autonomy] || 0;
    if (order < AUTONOMY_ORDER.semi_autonomous) {
      return deny('AUTONOMY_TOO_LOW', "无委托上下文的自主写要求 effectiveAutonomy ≥ semi_autonomous，当前='" + (c.effectiveAutonomy || c.autonomy || 'managed') + "'（§G.5① v1.5 订正：该下限只约束自主写，委托内写不受它限制）");
    }
    if (!target.region_id) {
      return deny('UNREGISTERED_TARGET', '自主写只能操作已登记 region_id 的 AI 对象');
    }
  }

  // 9) 高风险必须已获批（删自己的对象也要；3.5 由后台回滚通道代替审批，故走批量删除而非本动词）
  if (risk === 'high') {
    const approved = Array.isArray(c.approvedRisks) ? c.approvedRisks : [];
    if (approved.indexOf('high') < 0) {
      return deny('HIGH_RISK_NEEDS_APPROVAL', 'high 风险动作（删除 AI 对象）必须先获人工审批；后台「一键回滚本批」走批量通道，不走本动词');
    }
  }

  // 10) 出生点保护半径：AI 不得在出生点附近新建（§G.5③）
  if (action === 'place_part') {
    const radius = Number(c.protectedSpawnRadius);
    if (isFinite(radius) && radius > 0 && c.spawnPoint) {
      const dx = Number(target.position_x || 0) - Number(c.spawnPoint.x || 0);
      const dz = Number(target.position_z || 0) - Number(c.spawnPoint.z || 0);
      if (Math.sqrt(dx * dx + dz * dz) < radius) {
        return deny('SPAWN_PROTECTED', '落点在出生点保护半径 ' + radius + 'm 内（§G.5③），拒绝新建');
      }
    }
  }

  return { allow: true, code: 'ALLOWED', reason: missionId ? '委托内写（created_by 匹配）' : '自主写（自主度达标）', risk };
}

/** 是否为 AI 自有资产（给查询/UI 用，避免各处重复写 origin 判断） */
function isAiOwned(target) {
  return !!target && String(target.origin || '') === AI_OWNED;
}

module.exports = {
  check: check,
  isAiOwned: isAiOwned,
  AUTONOMY_ORDER: AUTONOMY_ORDER,
  PROTECTED: PROTECTED,
  NEVER_TOUCH_TYPES: NEVER_TOUCH_TYPES,
  kindOf: kindOf,
};