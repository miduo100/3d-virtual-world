/**
 * solver —— 零件装配求解器（M1-1 纯函数版）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 从 scripts/preview_assemble.js 抽出装配逻辑，改成**服务端可直接调用**的纯函数。
 *
 * ★ 核心算法（与旧 recipes/building.js 的唯一差别）：
 *     旧：位置 = (k + 0.5) × (边长 / 件数)      → 平均分配，边长非件宽整数倍时留缝
 *     新：cursor += 零件实际宽度                → 下一件起点 = 上一件终点，接缝恒 0
 *   三个模数体系完全不同的套件实测接缝 0.0000m（见 M1 文档 §1.4）。
 *
 * 纯净性（判据 M1-1-5）：
 *   - 不 require('pg') / 不读写文件 / 不 console（日志一律走返回的 notes）
 *   - 件信息由 ctx.partResolver 注入，本模块不知道数据库存在
 *   - 同 spec + 同 resolver 结果 → 两次调用 JSON.stringify 逐字节一致（判据 M1-1-3）
 *
 * 失败一律返回明确 code，不静默丢件（判据 M1-1-4）：
 *   SPEC_INVALID / RESOLVER_REQUIRED / PART_MISSING / PART_RESOLVER_FAILED
 *   SLOT_PART_UNDEFINED / LAYOUT_COUNT_MISMATCH / EDGE_NOT_MODULAR / ROOF_MODE_UNSUPPORTED
 */
'use strict';

const rules = require('./modularRules');

/** 失败返回（形状与成功返回互斥，调用方判 r.ok 即可） */
function fail(code, reason, hint, extra) {
  return Object.assign({ ok: false, code, reason, hint: hint || null }, extra || {});
}

/** spec.parts 里的所有件 key（去重 + 排序，保证解析顺序与输出顺序确定） */
function keysOf(parts) {
  const seen = new Set();
  for (const k of Object.keys(parts || {})) {
    const v = parts[k];
    if (typeof v === 'string' && v.trim()) seen.add(v.trim());
  }
  return Array.from(seen).sort();
}

/**
 * 求解一栋建筑的完整落位方案。
 *
 * @param {object} spec 由 templateRegistry.buildSpec() 产出（含 edges 坐标 + 件名）
 * @param {object} ctx  { partResolver: async (key) => {key,w,h,d,path}|null, policy?: 'absorb'|'snap' }
 * @returns {Promise<
 *   {ok:true, parts:Array, stats:object, notes:string[]} |
 *   {ok:false, code:string, reason:string, hint:string|null}
 * >}
 */
async function solve(spec, ctx) {
  const c = ctx || {};

  // ── 0) 入参校验（不做「半个 spec 也能跑」的宽容，缺什么直接报）──────────
  if (!spec || typeof spec !== 'object') {
    return fail('SPEC_INVALID', 'spec 必须是对象（由 templateRegistry.buildSpec 产出）', '先调 registry.buildSpec(templateId)');
  }
  if (!spec.parts || !spec.parts.wall) {
    return fail('SPEC_INVALID', 'spec.parts.wall 必填：没有墙件就无法确定模数', '模板 parts.wall 指向 part_library_items.part_key');
  }
  if (!Array.isArray(spec.edges) || spec.edges.length === 0) {
    return fail('SPEC_INVALID', 'spec.edges 必须是非空数组（每条边含 a/b/plan）', '用 registry.buildSpec 生成 edges，不要手写坐标');
  }
  const W = Number(spec.width), D = Number(spec.depth), H = Number(spec.wallHeight);
  if (!(W > 0) || !(D > 0) || !(H > 0)) {
    return fail('SPEC_INVALID', `spec 尺寸非法：width=${spec.width} depth=${spec.depth} wallHeight=${spec.wallHeight}`, 'width/depth/wallHeight 必须 > 0');
  }
  if (typeof c.partResolver !== 'function') {
    return fail('RESOLVER_REQUIRED', 'ctx.partResolver 缺失：求解器不自己查库，件信息必须由调用方注入', '传 (key) => ({ key, w, h, d }) 的 async 函数');
  }

  const notes = [];
  const policy = rules.resolvePolicy(spec, c);

  // ── 1) 解析零件尺寸（唯一的外部依赖，全部核对通过才继续）──────────────
  const keys = keysOf(spec.parts);
  const partMap = {};
  const missing = [];
  for (const key of keys) {
    let row = null;
    try {
      row = await c.partResolver(key);
    } catch (e) {
      return fail('PART_RESOLVER_FAILED', '解析零件 ' + key + ' 时抛错：' + String((e && e.message) || e).slice(0, 200),
        '检查 partResolver 的查询是否只读、是否按 pack_key 过滤');
    }
    if (!row || !(Number(row.w) > 0) || !(Number(row.d) > 0)) { missing.push(key); continue; }
    partMap[key] = {
      key,
      w: Number(row.w),
      h: Number(row.h) || 0,
      d: Number(row.d),
      path: row.path || null,
      role: row.role || null,
      subtype: row.subtype || null,
    };
  }
  if (missing.length) {
    return fail('PART_MISSING', '缺件：' + missing.join(', '),
      '检查模板 pack 与 part_key 是否匹配（part_libraries.pack_key + 库 status=active）；缺件时不产出半成品',
      { missing });
  }

  const PART = (slot) => {
    const key = spec.parts[slot];
    return key ? partMap[key] : null;
  };

  const parts = [];
  const byGroup = {};
  const push = (p) => {
    parts.push(p);
    byGroup[p.group] = (byGroup[p.group] || 0) + 1;
  };

  // ── 2) 墙体：按「实际件宽」累计推进；件矮于层高时沿高度堆叠 ─────────────
  const wallPart = PART('wall');
  const rows = rules.rowsFor(H, wallPart.h);
  if (rows > 1) notes.push(`墙件高 ${wallPart.h}m < 层高 ${H}m → 沿高度堆叠 ${rows} 排`);
  const declaredRows = Number(spec.module && spec.module.rows);
  if (declaredRows > 0 && declaredRows !== rows) {
    notes.push(`模板声明 module.rows=${declaredRows}，按件高实算 ${rows} 排（以实算为准，避免模板抄错导致重叠或空隙）`);
  }

  /** 每「边 × 排」的收尾余量（★ 必须分组：多排时跨排距离会被算成假缝） */
  const seamGroups = [];
  let seamMax = 0;
  let wallSegments = 0;

  for (let row = 0; row < rows; row++) {
    const y = rules.r3(row * wallPart.h);
    for (const edge of spec.edges) {
      const a = Array.isArray(edge.a) ? edge.a : [0, 0];
      const b = Array.isArray(edge.b) ? edge.b : [0, 0];
      const ax = Number(a[0]), az = Number(a[1]);
      const dx = Number(b[0]) - ax, dz = Number(b[1]) - az;
      const len = Math.hypot(dx, dz);
      if (!(len > 0)) {
        return fail('SPEC_INVALID', `边「${edge.name || edge.key}」长度为 0：a/b 坐标相同`, 'edges 由 buildSpec 按 width/depth 生成，不要手写');
      }
      const ux = dx / len, uz = dz / len;
      const ang = rules.normAng(rules.deg(Math.atan2(uz, ux)));
      const plan = Array.isArray(edge.plan) ? edge.plan : [];

      let cursor = 0, i = 0, guard = 0;
      while (len - cursor > rules.TAIL_TOL) {
        if (++guard > 2000) {
          return fail('SEGMENT_OVERRUN', `边「${edge.name || edge.key}」分段超过 2000 仍未闭合（件宽过小或长度异常）`, '检查件宽 w 是否接近 0');
        }
        let slot = plan[i] || 'wall';
        // ★ 按排替换门槽：Kenney 的门块与墙块同尺寸，只能逐块替换；
        //   中世纪/现代套件在 layout 里直接给 door 槽位即可。
        const ds = spec.doorSlot;
        if (ds && edge.name === ds.edge && i === ds.index
          && (!Array.isArray(ds.rows) || ds.rows.indexOf(row) >= 0)
          && spec.parts.door) {
          slot = 'door';
        }
        const p = PART(slot);
        if (!p) {
          return fail('SLOT_PART_UNDEFINED',
            `边「${edge.name || edge.key}」第 ${i} 段槽位「${slot}」在 spec.parts 里没有对应件`,
            `在模板 parts 里补 ${slot}，或把该槽位改回 wall —— 求解器不允许静默跳过（会留缺口）`,
            { edge: edge.name || edge.key, index: i, slot });
        }
        const remain = len - cursor;
        const segW = Math.min(p.w, remain);
        if (!(segW > 1e-9)) {
          return fail('SEGMENT_ZERO_WIDTH', `边「${edge.name || edge.key}」第 ${i} 段宽度为 0`, '件宽 w 非法');
        }
        // snap 策略：要求整段都是整件，余料不吸收
        if (policy === 'snap' && segW < p.w - 1e-9) {
          return fail('EDGE_NOT_MODULAR',
            `边「${edge.name || edge.key}」长 ${rules.r3(len)}m 不是件宽 ${p.w}m 的整数倍（余 ${rules.r3(remain)}m）`,
            `snap 策略要求整除：吸附到 ${rules.nearestMultiple(len, p.w)}m，或改用 absorb 策略收边（末段收窄）`,
            { edge: edge.name || edge.key, length: rules.r3(len), pieceW: p.w });
        }

        push({
          group: 'wall', slot, key: p.key, path: p.path,
          edge: edge.name || edge.key, row, seq: row * 1000 + i,
          dir: ang,
          x: rules.r3(ax + ux * (cursor + segW / 2)),
          y,
          z: rules.r3(az + uz * (cursor + segW / 2)),
          ry: ang,
          libW: p.w, useW: rules.r3(segW),
        });
        wallSegments++;

        cursor += segW;
        i++;
      }

      if (row === 0 && i !== plan.length) {
        return fail('LAYOUT_COUNT_MISMATCH',
          `边「${edge.name || edge.key}」实排 ${i} 段，模板 layout 给了 ${plan.length} 段（边长 ${rules.r3(len)}m ÷ 件宽 ${wallPart.w}m）`,
          '改模板 layout 段数或改尺寸；段数对不上说明门窗会被挤掉或留缺口',
          { edge: edge.name || edge.key, actual: i, planned: plan.length });
      }

      const tail = rules.r3(len - cursor);
      seamGroups.push({ edge: edge.name || edge.key, row, len: rules.r3(len), tail, segments: i });
      seamMax = Math.max(seamMax, Math.abs(tail));
      if (row === 0 && Math.abs(len - cursor) > 1e-6) {
        notes.push(`边「${edge.name || edge.key}」收尾偏差 ${tail}m（策略 ${policy}）`);
      }
    }
  }

  // ── 3) 楼板：按件尺寸铺满墙中线围合区（无 floor 件的套件跳过）──────────
  const fl = spec.parts.floor ? PART('floor') : null;
  if (!fl) {
    notes.push('该套件无 floor 类零件 → 不铺楼板（只验证墙体与屋顶）');
  } else {
    const nx = Math.max(1, Math.round(W / fl.w));
    const nz = Math.max(1, Math.round(D / fl.d));
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        push({
          group: 'floor', slot: 'floor', key: fl.key, path: fl.path,
          edge: null, row: 0, seq: ix * 1000 + iz, dir: 0,
          x: rules.r3(-W / 2 + (ix + 0.5) * (W / nx)),
          y: 0,
          z: rules.r3(-D / 2 + (iz + 0.5) * (D / nz)),
          ry: 0, libW: fl.w, useW: fl.w,
        });
      }
    }
    if (nx * fl.w < W - 1e-6 || nz * fl.d < D - 1e-6) {
      notes.push(`楼板未铺满：${nx}×${nz} 块覆盖 ${rules.r3(nx * fl.w)}×${rules.r3(nz * fl.d)}m，房子 ${W}×${D}m`);
    }
  }

  // ── 4) 屋顶 ────────────────────────────────────────────────────────
  const RF = spec.roof || {};
  if (RF.mode && rules.ROOF_MODES.indexOf(String(RF.mode)) < 0) {
    return fail('ROOF_MODE_UNSUPPORTED', `屋顶 mode='${RF.mode}' 不支持`, '只支持 whole（整块）| tile（平铺）');
  }
  if (RF.mode === 'whole') {
    const rw = PART('roof');
    if (!rw) {
      return fail('SLOT_PART_UNDEFINED', 'roof.mode=whole 但没有 roof 件', '模板 parts.roof 必须指向整块屋顶件');
    }
    const dropY = Number(RF.dropY) || 0;
    // ★ originOffsetY：模型原点到底面的距离（模板按 GLB 实测填，缺省 0 = 原点在底面）
    //   踩过的坑（2026-11-06 E2E 截图实证）：Roof_RoundTiles_6x10 的原点在屋檐**上方** 0.782m，
    //   按「原点在底面」放 y=H-dropY 会让整片屋顶陷进墙里 0.93m，墙只剩 2.2m 露在外面。
    const rOff = Number(RF.originOffsetY) || 0;
    push({
      group: 'roof', slot: 'roof_whole', key: rw.key, path: rw.path,
      edge: null, row: 0, seq: 0, dir: 0,
      x: 0, y: rules.r3(H - dropY + rOff), z: 0, ry: Number(RF.ry) || 0,
      libW: rw.w, useW: rw.w,
    });
    const eave = rules.eaveOf(spec, rw);
    notes.push(`屋顶：整块 ${rw.key}（${rw.w}×${rw.d}m）—— 出檐 X ${eave.actual.x}m / Z ${eave.actual.z}m（墙面厚 ${rules.WALL_THICKNESS}m 已计入）`);
  } else if (RF.mode === 'tile') {
    const rt = PART('roof');
    if (!rt) {
      return fail('SLOT_PART_UNDEFINED', 'roof.mode=tile 但没有 roof 件', '模板 parts.roof 必须指向平铺屋顶件');
    }
    const eave = Number(RF.eave) || 0;
    const spanW = W + rules.WALL_THICKNESS + eave * 2;
    const spanD = D + rules.WALL_THICKNESS + eave * 2;
    const tx = Math.max(1, Math.round(spanW / rt.w));
    const tz = Math.max(1, Math.round(spanD / rt.d));
    for (let ix = 0; ix < tx; ix++) {
      for (let iz = 0; iz < tz; iz++) {
        push({
          group: 'roof', slot: 'roof_tile', key: rt.key, path: rt.path,
          edge: null, row: 0, seq: ix * 1000 + iz, dir: 0,
          x: rules.r3(-(tx * rt.w) / 2 + (ix + 0.5) * rt.w),
          y: rules.r3(H - (Number(RF.dropY) || 0)),
          z: rules.r3(-(tz * rt.d) / 2 + (iz + 0.5) * rt.d),
          ry: 0, libW: rt.w, useW: rt.w,
        });
      }
    }
    const actual = rules.eaveOf(spec, rt);
    notes.push(`屋顶：${rt.key} 平铺 ${tx}×${tz} = ${tx * tz} 块（${rules.r3(tx * rt.w)}×${rules.r3(tz * rt.d)}m，目标 ${rules.r3(spanW)}×${rules.r3(spanD)}m）—— 实出檐 ${actual.actual.x}m`);
  }

  // ── 5) 山墙（可选）─────────────────────────────────────────────────
  if (spec.gable) {
    const gb = PART('gable');
    if (!gb) {
      return fail('SLOT_PART_UNDEFINED', 'spec.gable 存在但没有 gable 件', '补模板 parts.gable 或删掉 gable 段');
    }
    // ★ 山墙件与屋顶件不是配套的（实测：屋顶坡高 5.67m，山墙坡高 4.52m）：
    //   贴墙顶会矮 1.0m 露出屋脊缺口；抬高又露出山墙底部空隙 → 唯一解是垂直拉伸。
    //   前提是模型已按 bbox 重锚到底面 y=0，这样 scale.y 以底边为基准向上长。
    //   ★ 模板里存固定 stretch（确定性）；preset 用 stretchToRidge 现算。
    let sy = Number(spec.gable.stretch) > 0 ? Number(spec.gable.stretch) : 1;
    if (!(sy > 1) && spec.gable.stretchToRidge && spec.parts.roof) {
      const rp = PART('roof');
      const dropY = Number((spec.roof && spec.roof.dropY) || 0);
      // 屋脊高度 = 屋檐高度 + 屋顶 bbox 高（与 roof 段的 originOffsetY 无关：
      // 原点抬高 rOff、可见高度少 rOff，两者抵消，故这里沿用 bbox 高即对）
      const roofTop = (H - dropY) + (rp && rp.h ? rp.h : 0);
      const need = roofTop - (Number(spec.gable.y) || H);
      // ★ 分母要用「原点到底边之上还剩多少可见高度」：山墙件原点也在底边上方
      //   （Roof_Front_Brick6 = 0.132m）。用整 bbox 高（4.516）会少算 3%，
      //   实测拉伸 1.223 时山墙尖冲出屋脊 0.63m —— 正确值是 1.2597。
      const gOff = Number(spec.gable.originOffsetY) || 0;
      const gableVisibleH = (gb.h || 0) - gOff;
      if (need > 0 && gableVisibleH > 0) sy = rules.r3(need / gableVisibleH);
    }
    const gy = rules.r3(Number(spec.gable.y) || H);
    const zOff = Number(spec.gable.zOffset) || 0.5;
    for (const sgn of [-1, 1]) {
      push({
        group: 'gable', slot: 'gable', key: gb.key, path: gb.path,
        edge: null, row: 0, seq: sgn < 0 ? 0 : 1, dir: sgn < 0 ? 0 : 180,
        x: 0, y: gy,
        z: rules.r3(sgn * (D / 2 + zOff)),
        ry: sgn < 0 ? 0 : 180,
        scaleY: sy, libW: gb.w, useW: gb.w,
      });
    }
    notes.push(`山墙：${gb.key}（${gb.w}×${gb.h}）× 2 —— 垂直拉伸 ${sy}× 填满屋脊`);
  }

  // ── 6) 返回（字段顺序固定，保证逐字节确定性）────────────────────────
  const roofPart = spec.parts.roof ? PART('roof') : null;
  const eave = roofPart ? rules.eaveOf(spec, roofPart) : { configured: null, actual: { x: 0, z: 0 } };

  return {
    ok: true,
    parts,
    stats: {
      templateId: spec.templateId || null,
      capability: spec.capability || null,
      pieceCount: parts.length,
      wallSegments,
      rows,
      policy,
      seamMax: rules.r3(seamMax),
      seamGroups: seamGroups.length,
      eave: eave.actual,
      eaveConfigured: eave.configured,
      byGroup,
    },
    notes,
  };
}

module.exports = { solve, fail };
