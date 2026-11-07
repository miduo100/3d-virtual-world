/**
 * placeBuilding —— 把模板房「算成一组待落库的行」（M1-6 · 工具层）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 职责：给「一次建一栋」提供可复用的计算层，**不写库**。
 *   输入：模板 id + 锚点 + 朝向 + 地面高度
 *   输出：一批 world_objects 行（坐标/朝向/缩放都已换算好）
 *
 * 为什么单独抽出来：
 *   ① missionTools 的新动词（build_from_template）要用它；
 *   ② 布展脚本（build_village）也在做同样的事——两边各写一份坐标换算，
 *      迟早出现「脚本里转 180°、工具层忘了转」这种只有肉眼看图才发现的错。
 *
 * ★ 朝向：求解器把门固定放在 south 边（朝 −Z）。theta 把整栋**刚体旋转**：
 *     theta=0    门朝 −Z
 *     theta=π    门朝 +Z（街道另一侧的房子）
 *     theta=±π/2 门朝 ∓X
 *   旋转同时作用在局部坐标与每件的 ry 上，不做等比缩放（会破模数）。
 */
'use strict';

const registry = require('./templateRegistry');
const solver = require('./solver');
const adapter = require('./adapter');
const terrainGround = require('./terrainGround');

const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

/**
 * @param {object} p
 * @param {string} p.templateId  模板 id
 * @param {object} p.anchor      { x, z } 建筑中心（墙中线围合区中心）
 * @param {number} [p.theta=0]   绕 Y 轴旋转（弧度）
 * @param {number} [p.groundY]   地面高度；不传则按锚点自动采样地形
 * @param {object} [p.resolved]  预先解析好的件表（省一次库查询；测试注入用）
 * @returns {Promise<{ok:true, rows:Array, pieceCount:number, spec:object, ground:object}
 *                 | {ok:false, code:string, reason:string, hint?:string}>}
 */
async function planBuilding(p) {
  const o = p || {};
  const built = registry.buildSpec(o.templateId);
  if (!built.ok) return { ok: false, code: built.code, reason: built.reason, hint: '模板要能在 templates/ 目录里查到' };
  const spec = built.spec;
  const tpl = registry.getTemplate(o.templateId);

  // 坐标必须是数字 —— LLM 常传出字符串 / null，这里直接拒，别让它变成 NaN 落库
  const ax = Number(o.anchor && o.anchor.x);
  const az = Number(o.anchor && o.anchor.z);
  if (!isFinite(ax) || !isFinite(az)) {
    return { ok: false, code: 'ANCHOR_INVALID', reason: '锚点必须是数字坐标 (x, z)' };
  }
  const theta = Number(o.theta) || 0;

  // 地面高度：不传就采样占地（与 runnerIntegration 同口径：取墙中线占地）
  let ground = { hasTerrain: false, baseY: 0, span: 0 };
  if (o.groundY == null) {
    try {
      ground = await terrainGround.underFootprint(ax, az, spec.width, spec.depth);
    } catch (e) {
      ground = { hasTerrain: false, baseY: 0, span: 0 };
    }
  } else {
    ground = { hasTerrain: true, baseY: Number(o.groundY), span: 0 };
  }

  let resolved = o.resolved;
  if (!resolved) {
    const keys = Object.values(spec.parts || {}).filter((k) => typeof k === 'string' && k);
    resolved = await adapter.resolvePartsFromDb(keys, spec.pack);
    if (!resolved.ok) {
      return { ok: false, code: 'PART_MISSING', reason: '零件库缺件：' + resolved.missing.join(', '), hint: '检查模板 pack 与 part_key' };
    }
  }
  const partMap = resolved.partMap;

  const plan = await solver.solve(spec, { partResolver: adapter.makeResolver(partMap) });
  if (!plan.ok) return { ok: false, code: plan.code, reason: plan.reason, hint: plan.hint };

  // local 坐标（anchor 传 0,0）→ 刚体旋转 → 平移到锚点
  const local = adapter.placementsToWorldObjects(plan.parts, { anchor: { x: 0, z: 0 } });
  const c = Math.cos(theta), s = Math.sin(theta);
  const rows = local.map((pl) => {
    const lx = Number(pl.x), lz = Number(pl.z);
    const src = partMap[pl.partKey] || {};
    return {
      type: 'uploaded_model',
      name: pl.partKey,
      model_path: src.path ? decodeURIComponent(String(src.path)) : null,
      position_x: r3(ax + lx * c - lz * s),
      position_y: r3(ground.baseY + Number(pl.level)),
      position_z: r3(az + lx * s + lz * c),
      rotation_y: r3(Number(pl.ry) + theta),
      scale_x: 1,
      scale_y: Number(pl.scaleY) || 1,
      scale_z: 1,
      // 与 missionTools.collideOf 同口径：结构件挡人，屋顶不挡
      has_collision: pl.group !== 'roof',
    };
  });

  return {
    ok: true,
    rows,
    pieceCount: rows.length,
    spec,
    templateId: tpl.id,
    ground,
  };
}

/**
 * 建筑旋转后的轴对齐占地（用于「放不放得下」的事前校验）。
 * @returns {{halfW:number, halfD:number}} 相对中心的半宽/半深（已考虑 90° 奇数倍旋转）
 */
function footprintOf(spec, theta) {
  const quarter = Math.round((Number(theta) || 0) / (Math.PI / 2));
  const swap = Math.abs(quarter % 2) === 1;
  const w = swap ? spec.depth : spec.width;
  const d = swap ? spec.width : spec.depth;
  // 加上屋顶出檐，避免「房子放得下、屋檐插到邻居家」
  return { halfW: w / 2, halfD: d / 2 };
}

module.exports = { planBuilding, footprintOf };
