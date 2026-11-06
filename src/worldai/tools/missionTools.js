/**
 * missionTools —— 建设委托的唯一动词入口（Phase 3.5-1 · §G.5 ① v1.5 订正 ②）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5「tools/missionTools.js **只导出 execute(verb, params, ctx)**，
 * 3 个动词为模块内私有函数（不导出）」+ 判据 P35-6。
 *
 * ★ 为什么动词必须是私有函数：
 *   将来 Phase 4 加 verbRegistry（function calling 目录）时，若动词已到处export，
 *   就会出现"某处绕过守卫直接调动词"的路径 —— 而 P35-6 要求这条路径落库 0 行。
 *   只导出 execute = 结构上就没有第二个入口。
 *
 * 参数一律**白名单校验**：不在白名单里的参数直接拒（判据 P35-5 ——
 * placement_policy='replace' 不是"被拒绝"，而是**根本没有这个参数**）。
 */
'use strict';

const { query } = require('../../database/db');
const guard = require('./ownershipGuard');
const journal = require('../journal/batchJournal');
const boundsGuard = require('../regions/boundsGuard');
const gridsnap = require('../regions/gridsnap');

/** 3 个动词的参数白名单（P35-5 的落点） */
const PARAM_SCHEMA = {
  // ★ scale_*：M1-4 灰度需要（山墙填屋脊要垂直拉伸 1.223，见 assembly/runnerIntegration）。
  //   不能改成"先 place 再 move_object 补 scale"——move_object 会用米级 gridsnap 重吸附 x/z，
  //   把求解器算出的 0.05 米级坐标吸到米级（2m 墙件 x=-3 → -4），整圈错位。
  //   数值护栏见 verbPlacePart 的 SCALE_OUT_OF_RANGE。
  place_part: ['partKey', 'modelId', 'x', 'z', 'ry', 'level', 'name', 'type',
    'scale_x', 'scale_y', 'scale_z'],
  move_object: ['id', 'x', 'z', 'ry', 'scale_x', 'scale_y', 'scale_z'],
  delete_object: ['id'],
};
const VERBS = Object.keys(PARAM_SCHEMA);

/** 缩放允许范围：只放行"微调"量级（山墙 1.223 / 找平 0.98 这类），防止一件被拉成 50 倍糊掉整栋 */
const SCALE_MIN = 0.1;
const SCALE_MAX = 5;

function reject(code, reason, extra) {
  return Object.assign({ ok: false, code, reason }, extra || {});
}

/** 白名单校验：出现未知参数（含 placement_policy）一律拒 */
function validateParams(verb, params) {
  const allowed = PARAM_SCHEMA[verb];
  if (!allowed) return reject('UNKNOWN_VERB', '未知动词「' + verb + '」，3.5 只开放 ' + VERBS.join(' / '));
  const unknown = Object.keys(params || {}).filter((k) => allowed.indexOf(k) < 0);
  if (unknown.length) {
    return reject('UNKNOWN_PARAM',
      '参数 ' + unknown.join('/') + ' 不存在。★ 一期只有 placement_policy="avoid"，' +
      '"replace/overwrite" 既没有这个参数、也不在 UI 暴露（§G.5 ②：否则 AI 会把管理员手建的建筑推平重建）',
      { unknownParams: unknown, allowedParams: allowed });
  }
  return { ok: true };
}
/**
 * 解析零件：partKey → 零件行 + 可渲染的 model_path（只认 active 库，pending_review 对 AI 隐身）
 *
 * ★ ctx.packKey（可选，M1-4 新增）：套件锁定。
 *   求解器按模板 `pack` 取尺寸（adapter.resolvePartsFromDb），落库时若再按"全库随便找一件"
 *   取模型，就会出现「按 A 套件算、用 B 套件的模型建」——同名件尺寸一旦不同，
 *   建筑会在接缝处肉眼可见地裂开，且两者都"看起来正常"，极难排查。
 *   走 ctx 而不是 params：**不开新参数**，白名单（P35-5）不受影响；
 *   legacy 调用方不传 → 不过滤，行为不变。
 *
 * ★ ORDER BY 固定：原来是 `LIMIT 1` 无排序，取哪一行取决于执行计划（物理上通常是最小 id）。
 *   各库 priority 目前全是 100，故 `priority DESC, i.id` 与原先"取最小 id"结果一致，
 *   但从此是**确定行为**，不再随 vacuum / 计划变化而漂移。
 */
async function resolvePart(params, ctx) {
  const pack = ctx && ctx.packKey ? String(ctx.packKey) : null;
  if (params.partKey) {
    const r = await query(
      pack
        ? `SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, i.metadata,
                  l.id AS library_id, l.style_family, l.pack_key, l.status AS library_status,
                  u.path AS model_path, u.display_name AS model_name
             FROM part_library_items i
             JOIN part_libraries l ON l.id = i.library_id
             JOIN uploaded_models u ON u.id = i.model_id
            WHERE i.part_key = $1 AND l.pack_key = $2 AND l.status = 'active' AND (l.deleted_at IS NULL)
            ORDER BY l.priority DESC NULLS LAST, i.id
            LIMIT 1`
        : `SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, i.metadata,
                  l.id AS library_id, l.style_family, l.pack_key, l.status AS library_status,
                  u.path AS model_path, u.display_name AS model_name
             FROM part_library_items i
             JOIN part_libraries l ON l.id = i.library_id
             JOIN uploaded_models u ON u.id = i.model_id
            WHERE i.part_key = $1 AND l.status = 'active' AND (l.deleted_at IS NULL)
            ORDER BY l.priority DESC NULLS LAST, i.id
            LIMIT 1`,
      pack ? [String(params.partKey), pack] : [String(params.partKey)]
    );
    if (!r.rows.length) {
      return reject('PART_NOT_FOUND', '零件库中没有可用的 partKey=' + params.partKey
        + (pack ? '（套件 ' + pack + ' 内）' : '') + '（pending_review 的库对 AI 隐身）');
    }
    return { ok: true, part: r.rows[0] };
  }
  if (params.modelId) {
    const r = await query(
      `SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, i.metadata,
              l.id AS library_id, l.style_family, l.pack_key, l.status AS library_status,
              u.path AS model_path, u.display_name AS model_name
         FROM part_library_items i
         JOIN part_libraries l ON l.id = i.library_id
         JOIN uploaded_models u ON u.id = i.model_id
        WHERE i.model_id = $1 AND l.status = 'active' AND (l.deleted_at IS NULL)
        ORDER BY l.priority DESC NULLS LAST, i.id
        LIMIT 1`,
      [Number(params.modelId)]
    );
    if (!r.rows.length) return reject('PART_NOT_FOUND', 'modelId=' + params.modelId + ' 不在 active 零件库中');
    return { ok: true, part: r.rows[0] };
  }
  return reject('PART_REQUIRED', 'place_part 必须给 partKey 或 modelId');
}

// ── 动词 1：place_part（low）─────────────────────────────────────────
async function verbPlacePart(params, ctx) {
  // ★ 缩放护栏先行（不查库、不吸附）：AI 可以微调，但不能把一件拉成 50 倍糊掉整栋。
  //   负数/0 会让 footprint 归零 → 碰撞检测失效，所以必须在这里拦，不能靠下游。
  const scale = { x: 1, y: 1, z: 1 };
  for (const axis of ['x', 'y', 'z']) {
    const raw = params['scale_' + axis];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!isFinite(n) || n < SCALE_MIN || n > SCALE_MAX) {
      return reject('SCALE_OUT_OF_RANGE',
        'scale_' + axis + '=' + raw + ' 超出允许范围 ' + SCALE_MIN + '~' + SCALE_MAX +
        '（山墙填屋脊这类只需 1.2 左右的微拉伸；0 或负数会让碰撞检测失效）',
        { axis, value: raw, min: SCALE_MIN, max: SCALE_MAX });
    }
    scale[axis] = n;
  }

  const p = await resolvePart(params, ctx);
  if (!p.ok) return p;
  const part = p.part;
  const region = ctx.region || {};
  const bounds = region.bounds || {};
  // ★ ctx.snapUnit：调用方已按更细的模数吸附过时（AI 自由拼装 recipe 块 → [0.05,1,0.05]），
  //   优先用它，不再按"零件自身尺寸"二次吸附。支持标量（三轴同值）与 [ux,uy,uz] 数组
  //   （2026-10-15：乐高砖段 0.56m/排距 0.17m 用米级吸附会同格塌缩被去重吃掉，
  //   但 y 轴必须保持 1m 格 —— snap 的 y = level×u[1]，u[1]=1 才让 level 语义=米）。
  //   原因（E2E 实测真 bug）：roadTile 模数 3m，而引擎沿骨架均分出的间距是 2.857m < 3m，
  //   二次吸附必然有两块塌到同一格位 → 被幂等去重吃掉 → 20 米的路只落 7 件、跨度 18m。
  //   普通块不传此字段 → 行为逐字节不变（判据 P35-8 的墙仍按零件模数吸附）。
  const hint = Number(ctx.snapUnit);
  const hintArr = Array.isArray(ctx.snapUnit) && ctx.snapUnit.length >= 3
    && ctx.snapUnit.every(function (v) { return Number(v) > 0; })
    ? ctx.snapUnit.map(Number) : null;
  const unit = hintArr ? hintArr
    : (hint > 0 ? [hint, hint, hint] : (gridsnap.unitOfPart(part) || gridsnap.unitOf(region.gridsnap)));
  const snapped = gridsnap.snap({ x: params.x, z: params.z, y: 0 }, unit, params.level);

  // ★ footprint 按缩放后的实际占地算：拉伸过的件比原尺寸占地方，用原尺寸判碰撞会让它压到邻居。
  //   （ry 会交换 w/d，这是既有行为，本次不动——solver 的件按对角线对称布局，不做这件事的是老路径。）
  const footprint = {
    w: (Number(part.grid_w) || boundsGuard.DEFAULT_FOOTPRINT.w) * Math.abs(scale.x),
    d: (Number(part.grid_d) || boundsGuard.DEFAULT_FOOTPRINT.d) * Math.abs(scale.z),
  };
  const obstacles = await boundsGuard.loadObstacles(bounds, ctx);

  // ★ 幂等先行（判据 P35-11b）：重跑同一委托的同一条指令必须复用上次那件，
  //   否则"上次建的件把落点占了 → 换位 → 又建一件"会每跑一次多一批重复对象。
  // ★ 带 y：多层建筑上层与下层同 (x,z) 不同 y，不带 y 会把整栋楼误判成"重跑已存在"
  const existingId = await journal.findExisting(ctx.missionId, part.part_key, snapped.x, snapped.z, snapped.y);
  if (existingId) {
    return {
      ok: true, id: existingId, deduped: true, relocated: false, skippedByCollision: false, humanBlocked: false,
      partKey: part.part_key, partRole: part.part_role, modelPath: part.model_path,
      x: snapped.x, y: snapped.y, z: snapped.z, requested: { x: snapped.x, z: snapped.z },
      reason: '重跑幂等：本委托该落点已建过同零件，复用原对象（不新建、不换位）',
    };
  }

  let spot = { ok: true, x: snapped.x, z: snapped.z, attempts: 0 };
  const first = boundsGuard.checkPlacement(bounds, snapped.x, snapped.z, footprint, obstacles);
  if (!first.ok) {
    // 越界是硬拒（不是换位）；碰撞才换位（§G.5 ② / 判据 P35-4、P35-7）
    if (first.code === 'OUT_OF_BOUNDS') return first;
    spot = boundsGuard.findFreeSpot(bounds, { x: snapped.x, z: snapped.z }, footprint, obstacles, { maxAttempts: 12 });
    if (!spot.ok) {
      return { ok: false, code: 'NO_FREE_SPOT', reason: spot.reason, skipped: true, skippedByCollision: true, humanBlocked: !!first.humanBlocked, attempts: spot.attempts };
    }
  }

  const row = await journal.createObject({
    type: 'uploaded_model',
    name: part.part_key,
    model_path: part.model_path,
    position_x: spot.x, position_y: snapped.y, position_z: spot.z,
    rotation_y: Number(params.ry) || 0,
    // ★ 不传时 scale=1，与 aiRow 的默认值一致 → 老路径落库行逐字段不变
    scale_x: scale.x, scale_y: scale.y, scale_z: scale.z,
    has_collision: part.collidable !== false,
  }, ctx);

  return {
    ok: row.ok, id: row.id, code: row.code, reason: row.reason,
    partKey: part.part_key, partRole: part.part_role, modelPath: part.model_path,
    x: spot.x, y: snapped.y, z: spot.z,
    scale: { x: scale.x, y: scale.y, z: scale.z },
    packKey: part.pack_key || null,
    requested: { x: snapped.x, z: snapped.z },
    relocated: !first.ok,
    skippedByCollision: !first.ok,
    humanBlocked: !first.ok && !!first.humanBlocked,
    attempts: spot.attempts,
    deduped: !!row.deduped,
  };
}
// ── 动词 2：move_object（medium，只许动本委托创建的）─────────────────
async function verbMoveObject(params, ctx) {
  const id = Number(params.id);
  if (!id) return reject('ID_REQUIRED', 'move_object 必须给 id');
  const cur = await query(`SELECT * FROM world_objects WHERE id = $1`, [id]);
  const row = cur.rows && cur.rows[0];
  if (!row) return reject('OBJECT_NOT_FOUND', '对象不存在：id=' + id);

  const region = ctx.region || {};
  const bounds = region.bounds || {};
  const unit = gridsnap.unitOfPart(null) || gridsnap.unitOf(region.gridsnap);
  const target = gridsnap.snap({ x: params.x !== undefined ? params.x : row.position_x, z: params.z !== undefined ? params.z : row.position_z, y: row.position_y }, unit, params.level);

  // 守卫（origin / is_locked / 区域 / created_by）——先判权限，再算几何
  const verdict = guard.check('move_object', row, ctx);
  if (!verdict.allow) return Object.assign(verdict, { ok: false });

  // 新位置仍要在区域内（换位语义：移动不得越界）
  const inside = boundsGuard.checkInside(bounds, target.x, target.z, { w: 2, d: 2 });
  if (!inside.ok) return inside;

  const patch = { position_x: target.x, position_y: row.position_y, position_z: target.z };
  if (params.ry !== undefined) patch.rotation_y = Number(params.ry) || 0;
  for (const k of ['scale_x', 'scale_y', 'scale_z']) if (params[k] !== undefined) patch[k] = Number(params[k]);
  const upd = await journal.updateObject(id, patch, ctx);
  return Object.assign({ from: { x: row.position_x, z: row.position_z }, to: { x: target.x, z: target.z } }, upd, { ok: upd.ok });
}

// ── 动词 3：delete_object（high，走审批；3.5 正常路径走 rollbackBatch）──
async function verbDeleteObject(params, ctx) {
  const id = Number(params.id);
  if (!id) return reject('ID_REQUIRED', 'delete_object 必须给 id');
  const del = await journal.deleteObject(id, ctx);
  return Object.assign({ id }, del, { ok: !!del.ok });
}

const PRIVATE_VERBS = {
  place_part: verbPlacePart,
  move_object: verbMoveObject,
  delete_object: verbDeleteObject,
};

/**
 * ★ 唯一导出的入口。
 * @param {string} verb place_part | move_object | delete_object
 * @param {object} params 参数（白名单校验，见 PARAM_SCHEMA）
 * @param {object} ctx { worldId, regionKey, region:{bounds,gridsnap}, missionId,
 *                       effectiveAutonomy, approvedRisks, spawnPoint, protectedSpawnRadius }
 */
async function execute(verb, params, ctx) {
  const v = validateParams(verb, params);
  if (!v.ok) return v;
  const c = ctx || {};
  if (!c.regionKey) return reject('REGION_REQUIRED', 'ctx.regionKey 缺失：区域是并行与权限的安全边界（§H.10.4）');
  const fn = PRIVATE_VERBS[verb];
  if (!fn) return reject('UNKNOWN_VERB', '未知动词「' + verb + '」');
  try {
    return await fn(params || {}, c);
  } catch (e) {
    return reject('VERB_EXECUTE_FAILED', '动词执行异常：' + String(e && e.message).slice(0, 200));
  }
}

module.exports = {
  execute,
  PARAM_SCHEMA,
  VERBS,
  validateParams,
};