/**
 * intentExecutor —— 把「校验过的意图」变成实际建造（M1-7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 位置在链路里的作用：
 *   LLM 输出意图 → templatePlanner.validateIntent（判合法性）
 *   → **本模块** executeIntent：逐条翻译成工具层动词
 *   → missionTools.execute（唯一写库入口）
 *   → journal.batchCreate（唯一写库实现）
 *
 * ★ 本模块**不写库、不读库**：它只做「意图条目 → 动词参数」的翻译，
 *   所有落库与守卫都留给工具层。这样违规路径不可能绕过 ownershipGuard。
 */
'use strict';

/**
 * @param {object} plan validateIntent 的 plan（buildings / roads / props）
 * @param {object} ctx  工具层 ctx（regionKey / region / missionId / effectiveAutonomy / groundY / maxObjects）
 * @param {object} [opts] { tools } 可注入（测试用）
 * @returns {Promise<{ok:boolean, calls:Array, created:number, failed:Array}>}
 */
async function executeIntent(plan, ctx, opts) {
  const o = opts || {};
  const tools = o.tools || require('../tools/missionTools');
  const calls = [];
  const failed = [];
  let created = 0;

  async function run(verb, params, label) {
    const r = await tools.execute(verb, params, ctx);
    calls.push({ verb, label, ok: !!r.ok, code: r.code || 'OK' });
    if (!r.ok) failed.push({ verb, label, code: r.code || 'UNKNOWN', reason: r.reason || '' });
    else if (verb === 'build_from_template') created += Number(r.pieces) || 0;
    else if (verb === 'pave') created += Number(r.tiles) || 0;
    else if (verb === 'scatter') created += Number(r.placed) || 0;
    return r;
  }

  // 1) 铺装先做：房子后落，压不上路（道路的 has_collision=false，也不会挡房子）
  for (const road of (plan.roads || [])) {
    await run('pave', {
      partKey: 'ground_pathStraight',
      x: road.x, z: road.z, width: road.width, depth: road.depth,
    }, 'road@' + road.x + ',' + road.z);
  }

  // 2) 建筑
  for (const b of (plan.buildings || [])) {
    await run('build_from_template', {
      template: b.template, x: b.x, z: b.z, facing: b.facing,
    }, b.template);
  }

  // 3) 道具散布
  for (const p of (plan.props || [])) {
    await run('scatter', {
      partKey: p.partKey, x: p.x, z: p.z,
      width: p.width, depth: p.depth, count: p.count,
      // 缩放由 plan 里给定（代码定的，不是模型给的）；没有就不传，scatter 默认 1
      //   scaleY 单独给：树的 X/Z 要比 Y 宽，否则窄锥形的树看着像细杆
      scale: p.scale,
      scaleY: p.scaleY,
    }, p.partKey + '×' + p.count);
  }

  return { ok: failed.length === 0, calls, created, failed };
}

module.exports = { executeIntent };
