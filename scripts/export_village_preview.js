/**
 * export_village_preview.js —— 把已落库的村域导出成预览页可读的 plan.json
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 用途：3002 服务没起（或懒得飞过去）时，把整村按真实坐标/朝向导出，
 *       用 public/assembly-preview.html?plan=village_sample.json 直接看布局。
 *
 * 与 preview_assemble.js 的区别：那个是「求解器算一栋」，这个是「读库里已建好的真实行」，
 * 所以看到的就是世界里的东西，不是另一套推算。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/database/db');

const REGION = process.argv[2] || 'village_sample';
const OUT = path.join(__dirname, '..', 'public', 'assembly-preview', REGION + '.json');

(async () => {
  const rows = (await query(
    `SELECT name, model_path, position_x, position_y, position_z, rotation_y, scale_x, scale_y, scale_z
       FROM world_objects WHERE region_id = $1 ORDER BY id`, [REGION]
  )).rows;
  if (!rows.length) { console.error('区域内没有对象：' + REGION); process.exit(1); }

  // 件尺寸：从零件库取（同名件取第一条）
  const names = Array.from(new Set(rows.map((r) => r.name)));
  const dims = (await query(
    `SELECT DISTINCT ON (part_key) part_key, grid_w, grid_h, grid_d
       FROM part_library_items WHERE part_key = ANY($1) ORDER BY part_key, id`, [names]
  )).rows;
  const dm = {};
  dims.forEach((d) => { dm[d.part_key] = d; });

  const parts = {};
  for (const r of rows) {
    if (!parts[r.name]) {
      const d = dm[r.name] || {};
      parts[r.name] = {
        key: r.name, w: Number(d.grid_w) || 1, h: Number(d.grid_h) || 1, d: Number(d.grid_d) || 1,
        path: r.model_path,
      };
    }
  }

  // 分组：靠零件名猜（预览页只用来上色/开关，判据不依赖）
  const groupOf = (n) => {
    if (/^path_|^ground_|^Street_/i.test(n)) return 'ground';
    if (/^(tree|plant|grass|flower|bush|rock|log|mushroom)/i.test(n)) return 'nature';
    if (/lamp/i.test(n)) return 'prop';   // 只认灯，别把 Floor_WoodLight 当成灯
    if (/^Roof|roof/i.test(n)) return n.indexOf('Front') >= 0 ? 'gable' : 'roof';
    if (/^Floor/i.test(n)) return 'floor';
    return 'wall';
  };

  const placements = rows.map((r) => ({
    key: r.name, path: r.model_path, group: groupOf(r.name),
    x: Number(r.position_x), y: Number(r.position_y), z: Number(r.position_z),
    ry: Number(r.rotation_y), scaleY: Number(r.scale_y),
  }));

  const byGroup = placements.reduce((a, p) => ((a[p.group] = (a[p.group] || 0) + 1), a), {});
  const payload = {
    generatedAt: new Date().toISOString(),
    preset: REGION,
    spec: { name: '村庄 ' + REGION, width: 0, depth: 0, wallHeight: 0, module: {}, parts: {}, roof: {}, edges: [] },
    parts,
    placements,
    stats: { total: placements.length, byGroup },
    isVillage: true,   // 告诉预览页：这是多栋导出，别做接缝判定
    notes: ['由 export_village_preview.js 从 world_objects 导出（真实坐标与朝向）'],
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');
  console.log('✓ ' + path.relative(path.join(__dirname, '..'), OUT) + '  ' + placements.length + ' 件  ' + JSON.stringify(byGroup));
  try { await pool.end(); } catch (e) { /* ignore */ }
})();
