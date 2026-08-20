/* 针对红军 26 个模型：文件大小 + 放置数 + 估算三角面 */
const { pool } = require('../src/database/db');

async function main() {
  // 1. 红军模型文件大小（file_name 为 model- 前缀的）
  const models = await pool.query(`
    SELECT file_name, file_size,
      (SELECT COUNT(*) FROM world_objects wo WHERE wo.model_path = '/models/uploaded/' || um.file_name) AS placed
    FROM uploaded_models um
    WHERE file_name LIKE 'model-%'
    ORDER BY file_size DESC
  `);
  console.log('=== 红军/新模型文件大小 ===');
  let total = 0;
  models.rows.forEach(r => {
    total += Number(r.file_size) || 0;
    console.log(`  ${((r.file_size || 0) / 1024 / 1024).toFixed(2)}MB placed=${r.placed} ${r.file_name}`);
  });
  console.log(`共 ${models.rows.length} 个, 总大小 ${(total / 1024 / 1024).toFixed(1)}MB`);

  // 2. 全部 uploaded_model 的 custom_config 情况
  const custom = await pool.query(`
    SELECT COUNT(*) AS cnt, COUNT(custom_config) AS with_custom
    FROM world_objects WHERE type = 'uploaded_model'
  `);
  console.log(`\nuploaded_model 总数=${custom.rows[0].cnt}, 带custom_config=${custom.rows[0].with_custom}`);

  // 3. has_collision 情况
  const coll = await pool.query(`
    SELECT has_collision, COUNT(*) AS cnt FROM world_objects WHERE type = 'uploaded_model' GROUP BY has_collision
  `);
  console.log('has_collision 分布:');
  coll.rows.forEach(r => console.log(`  ${r.has_collision}: ${r.cnt}`));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
