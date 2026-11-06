/**
 * preview_assemble.js —— 零件装配求解器（通用版 · 支持多 preset）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 用法：node scripts/preview_assemble.js [presetName]
 *       不带参数默认 medieval_6x10
 *
 * 核心算法（与旧 recipes/building.js 的唯一差别）：
 *   旧：位置 = (k + 0.5) × (边长 / 件数)   → 平均分配，边长非件宽整数倍时留缝
 *   新：cursor += 零件实际宽度             → 下一件起点 = 上一件终点，接缝恒 0
 *
 * 只读库，不写世界。
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const PRESETS = require('./assembly-presets');
const registry = require('../src/worldai/assembly/templateRegistry');

const PRESET_NAME = process.argv[2] || 'medieval_6x10';

// ★ 模板库优先（M1-2）：模板是唯一数据源，presets 仅作向后兼容的回落。
//   两者结构不同——模板存 layout 意图，edges 坐标由 buildSpec 按尺寸生成。
let SPEC = null;
const tpl = registry.getTemplate(PRESET_NAME);
if (tpl) {
  const built = registry.buildSpec(PRESET_NAME);
  if (!built.ok) {
    console.error('模板展开失败：' + built.code + ' — ' + built.reason);
    process.exit(1);
  }
  SPEC = built.spec;
  console.log('（来源：模板 ' + tpl.id + ' v' + tpl.version + '）');
} else {
  SPEC = PRESETS[PRESET_NAME];
}
if (!SPEC) {
  console.error('未知 preset/模板：' + PRESET_NAME +
    '（可用模板：' + registry.listTemplates().map((t) => t.id).join(', ') +
    '；presets：' + Object.keys(PRESETS).join(', ') + '）');
  process.exit(1);
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const deg = (rad) => r3((rad * 180) / Math.PI);
const normAng = (a) => ((Math.round(a / 90) * 90) % 360 + 360) % 360;
/** 模型路径含空格/方括号，URL 需编码（保留斜杠） */
const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const keys = [...new Set(Object.values(SPEC.parts))];
  const res = await pool.query(
    `SELECT DISTINCT ON (i.part_key) i.part_key, i.grid_w, i.grid_h, i.grid_d, i.part_role, i.part_subtype, m.path
       FROM part_library_items i
       JOIN uploaded_models m ON m.id = i.model_id
       JOIN part_libraries l ON l.id = i.library_id
      WHERE i.part_key = ANY($1) AND l.pack_key = $2
      ORDER BY i.part_key, i.id`,
    [keys, SPEC.pack]
  );
  await pool.end();

  const partMap = {};
  for (const row of res.rows) {
    partMap[row.part_key] = {
      key: row.part_key, path: encPath(row.path), role: row.part_role, subtype: row.part_subtype,
      w: Number(row.grid_w), h: Number(row.grid_h), d: Number(row.grid_d),
    };
  }
  const missing = keys.filter((k) => !partMap[k]);
  if (missing.length) {
    console.error('缺件：' + missing.join(', '));
    process.exit(1);
  }

  const placements = [];
  const notes = [];
  const PART = (slot) => partMap[SPEC.parts[slot]];

  // ── 1) 墙体：同一边上按「实际件宽」累计推进；墙件矮于层高时沿高度堆叠 ──
  const wallPart = PART('wall');
  // ★ 少数套件（Kenney modular）墙块只有 0.625m 高，层高 2.5m 需堆 4 排。
  //   中世纪套件墙高 = 层高（3.12m），rows 恒为 1，行为与单排完全一致。
  const wallH = Number(wallPart.h) > 0.01 ? Number(wallPart.h) : SPEC.wallHeight;
  const rows = Math.max(1, Math.round(SPEC.wallHeight / wallH));
  if (rows > 1) notes.push(`墙件高 ${wallH}m < 层高 ${SPEC.wallHeight}m → 沿高度堆叠 ${rows} 排`);

  for (let row = 0; row < rows; row++) {
    const y = r3(row * wallH);
    for (const edge of SPEC.edges) {
      const [ax, az] = edge.a;
      const [bx, bz] = edge.b;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const ang = normAng(deg(Math.atan2(uz, ux)));

      let cursor = 0, i = 0;
      while (len - cursor > 0.02) {
        let slot = edge.plan[i] || 'wall';
        // ★ 按排替换门槽（Kenney 套件的门块与墙块同尺寸，只能一块块替换，
        //   不存在「整扇门墙件」；中世纪/现代套件用 plan 里的 door 槽位即可）。
        const ds = SPEC.doorSlot;
        if (ds && edge.name === ds.edge && i === ds.index
            && (!ds.rows || ds.rows.indexOf(row) >= 0)
            && SPEC.parts.door) {
          slot = 'door';
        }
        const p = PART(slot);
        if (!p) { notes.push(`${edge.name}[${i}] 槽位 ${slot} 无对应零件，跳过`); i++; continue; }
        const remain = len - cursor;
        const segW = Math.min(p.w, remain);
        const cx = ax + ux * (cursor + segW / 2);
        const cz = az + uz * (cursor + segW / 2);

        placements.push({
          group: 'wall', slot, key: p.key, path: p.path,
          edge: edge.name, seq: row * 1000 + i, row, dir: normAng(ang),
          x: r3(cx), y, z: r3(cz), ry: ang,
          libW: p.w, useW: r3(segW),
        });

        cursor += segW;
        i++;
      }
      if (row === 0) {
        if (i !== edge.plan.length) notes.push(`${edge.name} 实排 ${i} 段，计划 ${edge.plan.length} 段（边长 ${len}m ÷ 件宽 ${wallPart.w}m）`);
        if (Math.abs(cursor - len) > 1e-6) notes.push(`${edge.name} 收尾偏差 ${r3(cursor - len)}m`);
      }
    }
  }

  // ── 2) 楼板：按件尺寸铺满墙中线围合区（无 floor 件的套件跳过）────────
  const fl = SPEC.parts.floor ? PART('floor') : null;
  if (!fl) {
    notes.push('该套件无 floor 类零件 → 不铺楼板（只验证墙体与屋顶）');
  } else {
    const nx = Math.round(SPEC.width / fl.w);
    const nz = Math.round(SPEC.depth / fl.d);
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        placements.push({
          group: 'floor', slot: 'floor', key: fl.key, path: fl.path,
          x: r3(-SPEC.width / 2 + (ix + 0.5) * (SPEC.width / nx)),
          y: 0,
          z: r3(-SPEC.depth / 2 + (iz + 0.5) * (SPEC.depth / nz)),
          ry: 0, libW: fl.w, useW: fl.w,
        });
      }
    }
    if (nx * fl.w < SPEC.width - 1e-6 || nz * fl.d < SPEC.depth - 1e-6) {
      notes.push(`楼板未铺满：${nx}×${nz} 块覆盖 ${r3(nx * fl.w)}×${r3(nz * fl.d)}m，房子 ${SPEC.width}×${SPEC.depth}m`);
    }
  }

  // ── 3) 屋顶 ──────────────────────────────────────────────────────
  const RF = SPEC.roof || {};
  if (RF.mode === 'whole') {
    const rw = PART('roof');
    placements.push({
      group: 'roof', slot: 'roof_whole', key: rw.key, path: rw.path,
      x: 0, y: r3(SPEC.wallHeight - (RF.dropY || 0)), z: 0, ry: RF.ry || 0,
      libW: rw.w, useW: rw.w,
    });
    const wallOuterW = SPEC.width + 0.41, wallOuterD = SPEC.depth + 0.41;
    notes.push(`屋顶：整块 ${rw.key}（${rw.w}×${rw.d}m）—— 出檐 X ${r3((rw.w - wallOuterW) / 2)}m / Z ${r3((rw.d - wallOuterD) / 2)}m`);
  } else if (RF.mode === 'tile') {
    const rt = PART('roof');
    const eave = Number(RF.eave) || 0;
    const spanW = SPEC.width + 0.41 + eave * 2;
    const spanD = SPEC.depth + 0.41 + eave * 2;
    const tx = Math.max(1, Math.round(spanW / rt.w));
    const tz = Math.max(1, Math.round(spanD / rt.d));
    for (let ix = 0; ix < tx; ix++) {
      for (let iz = 0; iz < tz; iz++) {
        placements.push({
          group: 'roof', slot: 'roof_tile', key: rt.key, path: rt.path,
          x: r3(-(tx * rt.w) / 2 + (ix + 0.5) * rt.w),
          y: r3(SPEC.wallHeight - (RF.dropY || 0)),
          z: r3(-(tz * rt.d) / 2 + (iz + 0.5) * rt.d),
          ry: 0, libW: rt.w, useW: rt.w,
        });
      }
    }
    notes.push(`屋顶：${rt.key} 平铺 ${tx}×${tz} = ${tx * tz} 块（${r3(tx * rt.w)}×${r3(tz * rt.d)}m，目标 ${r3(spanW)}×${r3(spanD)}m）`);
  }

  // ── 4) 山墙（可选；这套件的三角山墙属于 roof 类）──────────────────
  if (SPEC.gable) {
    const gb = PART('gable');
    if (gb) {
      // ★ 山墙件与屋顶件不是配套的（实测：屋顶坡高 5.67m，山墙坡高 4.52m）：
      //   直接贴合墙顶会矮 1.0m 露出屋脊缺口；抬高又会露出山墙底部空隙。
      //   唯一解 = 垂直拉伸填满「墙顶 → 屋脊」。底面已被重锚到 y=0，
      //   所以 holder 的 scale.y 以底边为基准向上拉伸，底边不动。
      //   ★ 模板里存固定 stretch 值（确定性），preset 里用 stretchToRidge 现算。
      let sy = Number(SPEC.gable.stretch) > 0 ? Number(SPEC.gable.stretch) : 1;
      if (!(sy > 1) && SPEC.gable.stretchToRidge && SPEC.roof && SPEC.parts.roof) {
        const roofTop = (SPEC.wallHeight - (SPEC.roof.dropY || 0)) + PART('roof').h;
        const need = roofTop - (SPEC.gable.y || SPEC.wallHeight);
        if (need > 0 && gb.h > 0) sy = r3(need / gb.h);
      }
      for (const sgn of [-1, 1]) {
        placements.push({
          group: 'gable', slot: 'gable', key: gb.key, path: gb.path,
          x: 0, y: r3(SPEC.gable.y || SPEC.wallHeight),
          z: r3(sgn * (SPEC.depth / 2 + (SPEC.gable.zOffset || 0.5))),
          ry: sgn < 0 ? 0 : 180, scaleY: sy, libW: gb.w, useW: gb.w,
        });
      }
      notes.push(`山墙：${gb.key}（${gb.w}×${gb.h}）× 2——垂直拉伸 ${sy}× 填满屋脊`);
    }
  }

  // ── 5) 输出 ──────────────────────────────────────────────────────
  const outDir = path.join(__dirname, '..', 'public', 'assembly-preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, PRESET_NAME + '.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    preset: PRESET_NAME,
    spec: SPEC,
    parts: partMap,
    placements,
    stats: {
      total: placements.length,
      byGroup: placements.reduce((a, p) => ((a[p.group] = (a[p.group] || 0) + 1), a), {}),
    },
    notes,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

  console.log('✓ ' + path.basename(outFile) + '  ←  ' + SPEC.name);
  console.log('  总件数 ' + placements.length + ' · ' + JSON.stringify(payload.stats.byGroup));
  for (const k of Object.keys(partMap)) {
    const p = partMap[k];
    console.log(`    ${k.padEnd(30)} ${p.w} × ${p.h} × ${p.d}`);
  }
  notes.forEach((n) => console.log('    · ' + n));
})().catch((e) => { console.error('失败：' + (e && e.stack || e)); process.exit(1); });
