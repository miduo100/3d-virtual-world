/* 诊断 world_objects 表：416 副本分布、模型文件大小、collision/custom_config 情况 */
const { pool } = require('../src/database/db');

async function main() {
  // 0. 表结构确认
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'world_objects' ORDER BY ordinal_position"
  );
  console.log('=== world_objects 列 ===');
  console.log('  ' + cols.rows.map(c => c.column_name).join(', '));

  // 1. 总量与类型分布
  const total = await pool.query('SELECT type, COUNT(*) AS cnt FROM world_objects GROUP BY type ORDER BY COUNT(*) DESC');
  console.log('\n=== 类型分布 ===');
  total.rows.forEach(r => console.log(`  ${r.type}: ${r.cnt}`));

  // 2. 按 model_path 分组（红军副本分布）
  const groups = await pool.query(`
    SELECT model_path, COUNT(*) AS cnt,
           COUNT(*) FILTER (WHERE custom_config IS NOT NULL) AS custom_cnt
    FROM world_objects
    WHERE model_path IS NOT NULL AND model_path != ''
    GROUP BY model_path
    ORDER BY cnt DESC
  `);
  console.log('\n=== model_path 分组（副本数前 30） ===');
  let sum = 0, over16 = 0, totalRows = 0;
  groups.rows.forEach((r, i) => {
    sum += Number(r.cnt);
    totalRows++;
    if (Number(r.cnt) >= 16) over16++;
    if (i < 30) console.log(`  cnt=${r.cnt} custom=${r.custom_cnt} ${r.model_path}`);
  });
  console.log(`\n总模型URL数: ${totalRows}, 副本总数: ${sum}, ≥16副本的组: ${over16}`);

  // 3. 模型文件大小 + 实际放置数
  const sizes = await pool.query(`
    SELECT um.id, um.file_name, um.file_size,
           (SELECT COUNT(*) FROM world_objects wo WHERE wo.model_path = '/models/uploaded/' || um.file_name) AS placed
    FROM uploaded_models um
    ORDER BY um.file_size DESC
  `);
  console.log('\n=== 上传模型文件大小（前 30） ===');
  let totalBytes = 0;
  sizes.rows.forEach((r, i) => {
    totalBytes += Number(r.file_size) || 0;
    if (i < 30) console.log(`  ${((r.file_size || 0) / 1024 / 1024).toFixed(2)}MB placed=${r.placed} ${r.file_name}`);
  });
  console.log(`\n模型总数: ${sizes.rows.length}, 总大小: ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);

  // 4. 位置分布范围（确认是否摆开）
  const pos = await pool.query(`
    SELECT MIN(position_x) AS minx, MAX(position_x) AS maxx,
           MIN(position_z) AS minz, MAX(position_z) AS maxz,
           COUNT(DISTINCT position_x || ',' || position_z) AS distinct_positions
    FROM world_objects
    WHERE model_path LIKE '%/uploaded/%'
  `);
  console.log('\n=== 上传模型位置分布 ===');
  console.log(`  X: [${pos.rows[0].minx}, ${pos.rows[0].maxx}], Z: [${pos.rows[0].minz}, ${pos.rows[0].maxz}], 不同坐标数: ${pos.rows[0].distinct_positions}`);

  // 5. 加载距离相关配置（loadDistance/unloadDistance 是否存库）
  try {
    const cfg = await pool.query(`SELECT config_key, config_value FROM system_config WHERE config_key IN ('loadDistance','unloadDistance')`);
    console.log('\n=== 距离配置 ===');
    cfg.rows.forEach(r => console.log(`  ${r.config_key} = ${r.config_value}`));
  } catch (e) {
    console.log('\n=== 距离配置查询失败: ' + e.message);
  }

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
