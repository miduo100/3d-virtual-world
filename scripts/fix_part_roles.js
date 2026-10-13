'use strict';
/**
 * 修正 part_role 分类错误（2026-10-13）
 *  - role=roof 里 50 件非屋顶件（烟囱/岩石/水塔/排水沟/盖板…）
 *  - role=wall 里 3 件整栋模型（Building_Large_2 等 20×28×16）
 * 备份到 scripts/_backup_part_roles_<ts>.json 后逐条 UPDATE。
 */
const fs = require('fs');
const path = require('path');
const { query } = require('../src/database/db');

// 按名字定 role（保守：归入最贴近的既有 role，绝无不存在的值）
function targetRole(key) {
  const k = String(key).toLowerCase();
  if (/chimney/.test(k)) return 'prop';                       // 烟囱
  if (/^cliff|cliff_/.test(k)) return 'nature';               // 岩石悬崖
  if (/water_tower|unit_tower|silo|tank/.test(k)) return 'prop';
  if (/gutter/.test(k)) return 'prop';                        // 排水沟
  if (/spline|concave_cap|convex_cap/.test(k)) return 'road'; // 路面盖板
  if (/^building_(large|medium|small)_/.test(k)) return 'prop'; // 整栋模型（当摆件用）
  return null;                                                // 不认识的改，宁缺毋滥
}

(async function () {
  const rows = (await query(
    'SELECT i.id, i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, l.pack_key '
    + 'FROM part_library_items i JOIN part_libraries l ON l.id = i.library_id '
    + "WHERE l.status = 'active' AND l.deleted_at IS NULL AND i.part_role IN ('roof','wall')"
  )).rows;
  const SLOPE = /roof|slate|tile|spire|gable|pitch|steeple|turret|_top$|^top_/i;
  const targets = [];
  for (const x of rows) {
    const g = [Number(x.grid_w), Number(x.grid_h), Number(x.grid_d)];
    const me = Math.min(g[0], g[2]);
    if (x.part_role === 'roof') {
      const isFlat = g[1] <= me + 1e-6;
      const isSlope = SLOPE.test(x.part_key) && me >= 1 && g[1] <= 5;
      if (!isFlat && !isSlope) {
        const t = targetRole(x.part_key);
        if (t && t !== x.part_role) targets.push({ id: x.id, key: x.part_key, from: 'roof', to: t, grid: g });
      }
    } else if (x.part_role === 'wall') {
      if (me > 2.5) {
        const t = targetRole(x.part_key);
        if (t && t !== x.part_role) targets.push({ id: x.id, key: x.part_key, from: 'wall', to: t, grid: g });
      }
    }
  }
  console.log('待修正 ' + targets.length + ' 条');
  const byTo = {};
  targets.forEach(function (t) { byTo[t.to] = (byTo[t.to] || 0) + 1; });
  console.log('目标 role 分布: ' + JSON.stringify(byTo));
  targets.slice(0, 14).forEach(function (t) {
    console.log('   ' + t.key.padEnd(32) + ' ' + t.from + ' → ' + t.to + '   ' + t.grid.map(function (v) { return v.toFixed(2); }).join('×'));
  });
  if (targets.length > 14) console.log('   … 其余 ' + (targets.length - 14) + ' 条');

  // 备份
  const backup = path.join(__dirname, '_backup_part_roles_' + Date.now() + '.json');
  const ids = targets.map(function (t) { return t.id; });
  const cur = await query('SELECT id, part_key, part_role FROM part_library_items WHERE id = ANY($1::bigint[])', [ids]);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), rows: cur.rows }, null, 2));
  console.log('\n已备份原值 → ' + backup);

  // 逐条 UPDATE（带 role 双重条件防误改）
  let n = 0;
  for (const t of targets) {
    const r = await query(
      'UPDATE part_library_items SET part_role = $1 WHERE id = $2 AND part_role = $3',
      [t.to, t.id, t.from]
    );
    n += r.rowCount || 0;
  }
  console.log('已修正 ' + n + ' 条');

  // 验证
  const v = await query(
    'SELECT i.part_role, count(*)::int n FROM part_library_items i '
    + 'JOIN part_libraries l ON l.id = i.library_id '
    + "WHERE l.status='active' AND l.deleted_at IS NULL AND i.part_role IN ('roof','wall') GROUP BY 1"
  );
  v.rows.forEach(function (x) { console.log('  ' + x.part_role + ' 现存 ' + x.n + ' 件'); });
  process.exit(0);
})().catch(function (e) { console.error('ERR', (e && e.stack) || e); process.exit(1); });