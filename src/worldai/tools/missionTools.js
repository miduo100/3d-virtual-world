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
const adapter = require('../assembly/adapter');
const registry = require('../assembly/templateRegistry');

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
  // ★ M1-6：一次建一栋 / 铺一片 / 撒一派。
  //   AI 只需要说「哪个模板、放在哪、朝哪」，坐标换算与批量落库由代码做死。
  build_from_template: ['template', 'x', 'z', 'facing', 'name'],
  pave: ['partKey', 'x', 'z', 'width', 'depth'],
  scatter: ['partKey', 'x', 'z', 'width', 'depth', 'count', 'scale', 'collision'],
  // ★ 精确摆一批（路灯=杆+灯头这种组合件、广场放水井这类"指定位置"的装饰）
  place_props: ['items'],
};
const VERBS = Object.keys(PARAM_SCHEMA);

/** 缩放允许范围：只放行"微调"量级（山墙 1.223 / 找平 0.98 这类），防止一件被拉成 50 倍糊掉整栋 */
const SCALE_MIN = 0.1;
const SCALE_MAX = 5;

/** 保留 3 位小数（与求解器同口径） */
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

/**
 * ★ 结构性角色：无论库里标什么，一律可碰撞（2026-11-06）
 *
 * 为什么要这层护栏：`part_library_items.collidable` 是导入各套件时按件标的，
 * 但 window 角色有 158 件标了 false —— 因为多数套件的窗是"嵌进墙洞的玻璃片"、
 * 本身不该挡人。可本项目的模块化模板里，`Wall_Plaster_Window_Wide_Round` 这类
 * 是**整片替换墙板**的窗墙件，落在墙位上占满整个开间。
 * 照抄 false 的结果就是：AI 盖的房子在 5 处窗户位置能整片穿出去 ——
 * 正是"穿墙"。墙/门/地板/楼梯同理，一旦可穿过，建筑就不再是"enterable"。
 *
 * 所以：结构角色由引擎兜底为 true；road / awning / cornice / roof / trim / ground
 * 这些装饰角色才尊重库标记（路面贴片、头顶檐口本来就不该拦人）。
 */
const STRUCTURAL_ROLES = new Set(['wall', 'window', 'door', 'floor', 'stairs', 'column', 'foundation', 'base']);

/** 零件的最终碰撞开关：结构角色恒 true，其余按库标记（undefined → true，保持老行为） */
function collideOf(part) {
  const role = String((part && part.part_role) || '').toLowerCase();
  if (STRUCTURAL_ROLES.has(role)) return true;
  return part.collidable !== false;
}

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
 *
 * ★ collidable 透传（2026-11-06）：`part_library_items.collidable` 是 NOT NULL DEFAULT true，
 *   库作者逐件手工标过（road/awning/cornice/ground 标 false，wall/floor/door/stairs 全 true）。
 *   但原 SELECT 没取这一列 → `part.collidable` 恒为 undefined → `undefined !== false` 恒为 true，
 *   于是 981 件本该无碰撞的路面、檐口、线脚全被当成实心障碍。
 *   补上这一列即恢复库作者意图；但**不是无脑照抄**——结构角色（墙/窗/门/地板/楼梯）
 *   由 collideOf() 兜底为 true，否则窗墙件（库里 158 件标 false）会让 AI 的房子
 *   在窗户位置整片可穿过。判据见 accept_m1_5_collidable.js。
 */
async function resolvePart(params, ctx) {
  const pack = ctx && ctx.packKey ? String(ctx.packKey) : null;
  if (params.partKey) {
    const r = await query(
      pack
        ? `SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, i.metadata,
                  i.collidable,
                  l.id AS library_id, l.style_family, l.pack_key, l.status AS library_status,
                  u.path AS model_path, u.display_name AS model_name
             FROM part_library_items i
             JOIN part_libraries l ON l.id = i.library_id
             JOIN uploaded_models u ON u.id = i.model_id
            WHERE i.part_key = $1 AND l.pack_key = $2 AND l.status = 'active' AND (l.deleted_at IS NULL)
            ORDER BY l.priority DESC NULLS LAST, i.id
            LIMIT 1`
        : `SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, i.metadata,
                  i.collidable,
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
              i.collidable,
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
    has_collision: collideOf(part),
  }, ctx);

  return {
    ok: row.ok, id: row.id, code: row.code, reason: row.reason,
    partKey: part.part_key, partRole: part.part_role, modelPath: part.model_path,
    x: spot.x, y: snapped.y, z: spot.z,
    scale: { x: scale.x, y: scale.y, z: scale.z },
    collidable: collideOf(part),
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


// ── 动词 4：build_from_template（medium）一次建一栋模板房 ────────────
/**
 * AI 说「在 (x,z) 建 medieval_6x10，门朝南」，这里负责：
 *   ① 装得下吗（旋转后的占地 + 出檐 vs 区域围栏）→ 装不下就明确拒，并给出可行的模板
 *   ② 预算够吗（件数 vs ctx.maxObjects / mission.constraints.max_objects）
 *   ③ 地面多高（terrainGround 采样，整栋抬上去）
 *   ④ 批量落库（journal.batchCreate，单事务）
 *   ⑤ 幂等（同委托同落点重跑不重复建）
 */
async function verbBuildFromTemplate(params, ctx) {
  const placeBuilding = require('../assembly/placeBuilding');
  const boundsOf = adapter.boundsOf;

  const templateId = String(params.template || '').trim();
  if (!templateId) return reject('TEMPLATE_REQUIRED', 'build_from_template 必须给 template（模板 id）');

  const ax = Number(params.x), az = Number(params.z);
  if (!isFinite(ax) || !isFinite(az)) return reject('ANCHOR_INVALID', 'x / z 必须是数字（建筑中心坐标）');

  // facing：0/90/180/270（度数，0 = 门朝 −Z）
  const facing = params.facing == null ? 0 : Number(params.facing);
  if (![0, 90, 180, 270].includes(facing)) {
    return reject('FACING_INVALID', 'facing 只接受 0 / 90 / 180 / 270（度数，0 = 门朝 −Z）');
  }
  const theta = facing * Math.PI / 180;

  const built = registry.buildSpec(templateId);
  if (!built.ok) {
    return reject(built.code, built.reason,
      { available: registry.listTemplates().map((t) => t.id) });
  }
  const spec = built.spec;

  // ① 装得下吗：用旋转后的占地 + 出檐（屋顶比墙宽，按出檐算才不会插到邻居家）
  const fp = placeBuilding.footprintOf(spec, theta);
  const eaveX = Number((built.spec.roof && built.spec.roof.eave) || 0);
  const margin = Math.max(0.5, eaveX, 1.0);   // 未配 eave 的整块屋顶给 1m 余量
  const b = boundsOf(ctx.region);
  const needHalfW = fp.halfW + margin;
  const needHalfD = fp.halfD + margin;
  if (ax - needHalfW < b.minX || ax + needHalfW > b.maxX
    || az - needHalfD < b.minZ || az + needHalfD > b.maxZ) {
    return reject('BUILD_OUT_OF_BOUNDS',
      `模板 ${templateId}（${spec.width}×${spec.depth}m，旋转 ${facing}°）含出檐后需要 `
      + `${(needHalfW * 2).toFixed(1)}×${(needHalfD * 2).toFixed(1)}m 的空间，`
      + `在 (${ax},${az}) 放不下区域围栏 [${b.minX},${b.minZ}]~[${b.maxX},${b.maxZ}]`,
      {
        need: { width: r3(needHalfW * 2), depth: r3(needHalfD * 2) },
        // 给出同风格里能装下的候选（LLM 换一个就行，不用自己算）
        fitCandidates: registry.listTemplates()
          .filter((t) => {
            const bs = registry.buildSpec(t.id);
            if (!bs.ok) return false;
            const f = placeBuilding.footprintOf(bs.spec, theta);
            return (f.halfW + margin) * 2 <= (b.maxX - b.minX) && (f.halfD + margin) * 2 <= (b.maxZ - b.minZ);
          })
          .map((t) => t.id).slice(0, 8),
      });
  }

  // ② 预算
  const plan = await placeBuilding.planBuilding({ templateId, anchor: { x: ax, z: az }, theta });
  if (!plan.ok) return reject(plan.code, plan.reason, plan.hint ? { hint: plan.hint } : undefined);

  const maxObjects = Number(ctx.maxObjects || (ctx.mission && ctx.mission.constraints && ctx.mission.constraints.max_objects)) || 0;
  if (maxObjects > 0) {
    const already = ctx.missionId ? await countBatch(ctx.missionId) : 0;
    if (already + plan.pieceCount > maxObjects) {
      return reject('BUILD_EXCEEDS_BUDGET',
        `本委托已落 ${already} 件，再加 ${templateId} 的 ${plan.pieceCount} 件会超过预算 max_objects=${maxObjects}`,
        { pieceCount: plan.pieceCount, already, maxObjects });
    }
  }

  // ③④ 批量落库（batchCreate 单事务；本身已做守卫与三要素）
  const items = plan.rows.map((r) => Object.assign({}, r, {
    name: params.name ? String(params.name) : r.name,
  }));
  const res = await journal.batchCreate(items, ctx);
  if (!res.ok) return res;

  return {
    ok: true,
    template: templateId,
    pieces: plan.pieceCount,
    ids: res.count,
    anchor: { x: ax, z: az },
    facing,
    groundY: plan.ground.baseY,
    groundSpan: plan.ground.span,
    size: { width: spec.width, depth: spec.depth, wallHeight: spec.wallHeight },
  };
}

// ── 动词 5：pave（low）矩形铺装 ──────────────────────────────────────
/**
 * 用一块 1×1 地面砖铺满矩形。AI 不需要算块数，只给矩形范围。
 * 落库前逐块校验在围栏内；超界直接整批拒（不做「铺了一半」）。
 */
async function verbPave(params, ctx) {
  const partKey = String(params.partKey || 'ground_pathStraight').trim();
  const x = Number(params.x), z = Number(params.z);
  const w = Number(params.width), d = Number(params.depth);
  if (![x, z, w, d].every(isFinite) || !(w > 0) || !(d > 0)) {
    return reject('PARAMS_INVALID', 'pave 需要数字 x,z,width,depth（矩形中心与尺寸）');
  }
  const p = await resolvePart({ partKey }, ctx);
  if (!p.ok) return p;
  const part = p.part;
  const tw = Number(part.grid_w) || 1;
  const td = Number(part.grid_d) || 1;

  const nx = Math.max(1, Math.round(w / tw));
  const nz = Math.max(1, Math.round(d / td));
  const b = adapter.boundsOf(ctx.region);
  if (x - (nx * tw) / 2 < b.minX || x + (nx * tw) / 2 > b.maxX
    || z - (nz * td) / 2 < b.minZ || z + (nz * td) / 2 > b.maxZ) {
    return reject('PAVE_OUT_OF_BOUNDS', `铺装范围 ${nx * tw}×${nz * td}m 超出区域围栏`);
  }

  const groundY = Number(ctx.groundY) || 0;
  const items = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      items.push({
        type: 'uploaded_model',
        name: part.part_key,
        model_path: part.model_path,
        position_x: r3(x - (nx * tw) / 2 + (ix + 0.5) * tw),
        position_y: r3(groundY + 0.01),
        position_z: r3(z - (nz * td) / 2 + (iz + 0.5) * td),
        rotation_y: 0, scale_x: 1, scale_y: 1, scale_z: 1,
        has_collision: false,
      });
    }
  }
  const res = await journal.batchCreate(items, ctx);
  if (!res.ok) return res;
  return { ok: true, partKey: part.part_key, tiles: items.length, nx, nz, center: { x, z }, size: { width: r3(nx * tw), depth: r3(nz * td) } };
}

// ── 动词 6：scatter（low）在矩形内散布道具 ──────────────────────────
/**
 * 在矩形内按**确定性**抖动撒 count 件同种道具（同参数两次调用结果一致，判据要求确定性）。
 * 与已有对象相交的落点直接跳过（不换位）—— 植被压在墙上比少一棵树难看。
 */
async function verbScatter(params, ctx) {
  const partKey = String(params.partKey || '').trim();
  if (!partKey) return reject('PART_REQUIRED', 'scatter 必须给 partKey');
  const x = Number(params.x), z = Number(params.z);
  const w = Number(params.width), d = Number(params.depth);
  const count = Math.max(1, Math.round(Number(params.count) || 1));
  if (![x, z, w, d].every(isFinite) || !(w > 0) || !(d > 0)) {
    return reject('PARAMS_INVALID', 'scatter 需要数字 x,z,width,depth,count');
  }
  const p = await resolvePart({ partKey }, ctx);
  if (!p.ok) return p;
  const part = p.part;
  const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number(params.scale) || 1));
  const collision = params.collision === undefined ? true : params.collision === true;

  const b = adapter.boundsOf(ctx.region);
  if (x - w / 2 < b.minX || x + w / 2 > b.maxX || z - d / 2 < b.minZ || z + d / 2 > b.maxZ) {
    return reject('SCATTER_OUT_OF_BOUNDS', '散布范围超出区域围栏');
  }

  const obstacles = await boundsGuard.loadObstacles(ctx.region && ctx.region.bounds ? ctx.region.bounds : ctx.region, ctx);
  const groundY = Number(ctx.groundY) || 0;
  const footprint = {
    w: (Number(part.grid_w) || 1) * scale,
    d: (Number(part.grid_d) || 1) * scale,
  };

  // 确定性伪随机（同参数 → 同结果，不依赖 Math.random）
  const seedOf = (i) => {
    const v = Math.sin((x * 12.9898 + z * 78.233 + i * 37.719) * 1.0) * 43758.5453;
    return v - Math.floor(v);
  };

  const items = [];
  let skipped = 0;
  for (let i = 0; i < count; i++) {
    const px = r3(x - w / 2 + seedOf(i * 2) * w);
    const pz = r3(z - d / 2 + seedOf(i * 2 + 1) * d);
    const chk = boundsGuard.checkPlacement(ctx.region && ctx.region.bounds ? ctx.region.bounds : ctx.region, px, pz, footprint, obstacles);
    if (!chk.ok) { skipped++; continue; }
    items.push({
      type: 'uploaded_model',
      name: part.part_key,
      model_path: part.model_path,
      position_x: px, position_y: groundY, position_z: pz,
      rotation_y: r3(seedOf(i + 500) * Math.PI * 2),
      scale_x: scale, scale_y: scale, scale_z: scale,
      has_collision: collision,
    });
  }
  if (!items.length) return { ok: true, partKey: part.part_key, placed: 0, skipped, reason: '范围内没有空位（与已有对象都相交）' };
  const res = await journal.batchCreate(items, ctx);
  if (!res.ok) return res;
  return { ok: true, partKey: part.part_key, placed: items.length, skipped };
}

/** 本批已落多少件（预算校验用；失败当 0，不阻断） */
async function countBatch(missionId) {
  try {
    const r = await query(`SELECT count(*)::int n FROM world_objects WHERE created_by = $1 AND origin = 'ai'`, [String(missionId)]);
    return r.rows[0].n;
  } catch (e) { return 0; }
}


// ── 动词 7：place_props（medium）按给定坐标精确摆一批道具 ────────────
/**
 * 为什么需要它：scatter 是"在范围内随机撒"，而路灯是「杆 + 灯头」两件必须同点、
 * 广场摆水井必须落指定位置 —— 随机抖动会把组合件甩开。这里接受显式坐标列表。
 *
 * items[]: { partKey, x, z, y?, ry?, scale?, collision? }
 * 上限 500 件/次：再多就走错工具了（该用 build_from_template / pave）。
 */
async function verbPlaceProps(params, ctx) {
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) return reject('PARAMS_INVALID', 'place_props 需要 items 数组（至少 1 件）');
  if (items.length > 500) return reject('TOO_MANY_PROPS', 'place_props 单次上限 500 件（批量请用 pave / scatter / build_from_template）', { count: items.length });

  const b = adapter.boundsOf(ctx.region);
  const groundY = Number(ctx.groundY) || 0;
  const rows = [];
  const missing = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const key = String(it.partKey || '').trim();
    const x = Number(it.x), z = Number(it.z);
    if (!key) return reject('PARAMS_INVALID', `items[${i}] 缺 partKey`);
    if (!isFinite(x) || !isFinite(z)) return reject('PARAMS_INVALID', `items[${i}] 的 x/z 必须是数字`);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) {
      return reject('PROP_OUT_OF_BOUNDS', `items[${i}] (${x},${z}) 超出区域围栏`);
    }
    const p = await resolvePart({ partKey: key }, ctx);
    if (!p.ok) { missing.push(key); continue; }
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number(it.scale) || 1));
    rows.push({
      type: 'uploaded_model',
      name: p.part.part_key,
      model_path: p.part.model_path,
      position_x: r3(x),
      position_y: r3(it.y == null ? groundY : Number(it.y)),
      position_z: r3(z),
      rotation_y: r3(Number(it.ry) || 0),
      scale_x: scale, scale_y: Number(it.scaleY || scale), scale_z: scale,
      has_collision: it.collision === undefined ? true : it.collision === true,
    });
  }
  if (missing.length) return reject('PART_NOT_FOUND', '零件库没有：' + Array.from(new Set(missing)).join(', '), { missing });
  const res = await journal.batchCreate(rows, ctx);
  if (!res.ok) return res;
  return { ok: true, placed: rows.length, ids: res.count };
}

const PRIVATE_VERBS = {
  place_part: verbPlacePart,
  move_object: verbMoveObject,
  delete_object: verbDeleteObject,
  build_from_template: verbBuildFromTemplate,
  pave: verbPave,
  scatter: verbScatter,
  place_props: verbPlaceProps,
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