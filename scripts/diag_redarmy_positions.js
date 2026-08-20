/* 红军 26 个模型的位置分布：均值、范围、距离中心 */
const { pool } = require('../src/database/db');

async function main() {
  const red = await pool.query(`
    SELECT position_x, position_z, model_path
    FROM world_objects
    WHERE model_path LIKE '/models/uploaded/model-178712%'
  `);
  console.log('Total red army rows: ' + red.rows.length);
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  let sumx = 0, sumz = 0;
  red.rows.forEach((r) => {
    const x = r.position_x, z = r.position_z;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    sumx += x; sumz += z;
  });
  const cx = sumx / red.rows.length, cz = sumz / red.rows.length;
  console.log(`Bounds: X [${minx.toFixed(1)}, ${maxx.toFixed(1)}], Z [${minz.toFixed(1)}, ${maxz.toFixed(1)}]`);
  console.log(`Center: X=${cx.toFixed(1)}, Z=${cz.toFixed(1)}`);
  // 统计半径分布
  const bins = { 50:0, 100:0, 150:0, 200:0, 999:0 };
  red.rows.forEach((r) => {
    const d = Math.sqrt((r.position_x - cx)**2 + (r.position_z - cz)**2);
    if (d <= 50) bins[50]++; else if (d <= 100) bins[100]++; else if (d <= 150) bins[150]++; else if (d <= 200) bins[200]++; else bins[999]++;
  });
  console.log('Distance from center:', bins);
  // 按 model_path 分组数位置
  const groups = await pool.query(`
    SELECT model_path, COUNT(*) AS cnt, MIN(position_x) AS minx, MAX(position_x) AS maxx, MIN(position_z) AS minz, MAX(position_z) AS maxz, AVG(position_x) AS avgx, AVG(position_z) AS avgz
    FROM world_objects WHERE model_path LIKE '/models/uploaded/model-178712%'
    GROUP BY model_path ORDER BY cnt DESC
  `);
  console.log('\n=== 26 groups position ===');
  groups.rows.forEach((r) => {
    const sx = r.maxx - r.minx, sz = r.maxz - r.minz;
    console.log(`  ${r.cnt} pos X[${r.minx.toFixed(1)},${r.maxx.toFixed(1)}](${sx.toFixed(1)}) Z[${r.minz.toFixed(1)},${r.maxz.toFixed(1)}](${sz.toFixed(1)}) avg(${Number(r.avgx).toFixed(1)},${Number(r.avgz).toFixed(1)})`);
  });
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
