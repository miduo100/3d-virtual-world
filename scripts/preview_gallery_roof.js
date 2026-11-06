/**
 * preview_gallery_roof.js —— 屋顶件形状普查（只读库）
 * 把所有 roof 件一字排开，用真实 bbox 观察「哪些是可拼接屋面、哪些是完整屋顶段」。
 * 输出：public/assembly-preview/roof-gallery.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const PACK = process.argv[2] || '%bundle-1791374093662-xqlf%';
const ROLE = process.argv[3] || 'roof';
const OUT = process.argv[4] || (ROLE + '-gallery.json');
const KEYLIKE = process.argv[5] || '%';

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  const r = await pool.query(
    `SELECT i.part_key, i.grid_w, i.grid_h, i.grid_d, i.part_role, i.part_subtype, m.path
       FROM part_library_items i JOIN uploaded_models m ON m.id = i.model_id
      WHERE m.path LIKE $1 AND i.part_role = $2 AND i.part_key LIKE $3
      ORDER BY i.part_key`,
    [PACK, ROLE, KEYLIKE]
  );
  await pool.end();

  const SPACING = Math.max(6, Math.ceil(Math.max(...r.rows.map((x) => Math.max(+x.grid_w, +x.grid_d)), 4) * 1.35));

  const parts = {};
  const placements = [];
  const COLS = 7;
  const rows = Math.ceil(r.rows.length / COLS);
  r.rows.forEach((row, idx) => {
    parts[row.part_key] = {
      key: row.part_key, path: row.path, role: row.part_role, subtype: row.part_subtype,
      w: Number(row.grid_w), h: Number(row.grid_h), d: Number(row.grid_d),
    };
    placements.push({
      group: 'part', slot: ROLE, key: row.part_key, path: row.path, label: row.part_key,
      x: (idx % COLS) * SPACING - (SPACING * (COLS - 1)) / 2,
      z: (Math.floor(idx / COLS) - (rows - 1) / 2) * SPACING,
      y: 0, ry: 0,
      libW: Number(row.grid_w), useW: Number(row.grid_w),
    });
  });

  const outDir = path.join(__dirname, '..', 'public', 'assembly-preview');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, OUT), JSON.stringify({
    generatedAt: new Date().toISOString(),
    spec: { name: ROLE + ' 件普查（' + r.rows.length + ' 件）', width: 0, depth: 0, wallHeight: 0 },
    parts, placements,
    stats: { total: placements.length, byGroup: { part: placements.length } },
    notes: ['按 w×d 面积升序排放；标签显示实测 bbox 宽×高×深'],
  }, null, 2), 'utf8');

  console.log('✓ ' + OUT + ' · ' + r.rows.length + ' 件');
  r.rows.forEach((x) => console.log(`  ${x.part_key.padEnd(32)} ${x.grid_w} × ${x.grid_h} × ${x.grid_d}  [${x.part_subtype}]`));
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
