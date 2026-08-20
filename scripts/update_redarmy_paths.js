/* UPDATE world_objects 的红军 model_path 指向 _dec 减面文件 */
const { pool } = require('../src/database/db');

async function main() {
  const res = await pool.query(`
    UPDATE world_objects
    SET model_path = regexp_replace(model_path, '\.glb$', '_dec.glb')
    WHERE model_path LIKE '/models/uploaded/model-1787128%'
       OR model_path LIKE '/models/uploaded/model-1787129%'
    RETURNING id, model_path
  `);
  console.log('Updated rows: ' + res.rowCount);
  if (res.rows.length <= 30) res.rows.forEach(r => console.log(`  ${r.id}: ${r.model_path}`));

  // 验证：统计更新后的唯一 URL
  const check = await pool.query(`
    SELECT COUNT(DISTINCT model_path) AS urls, COUNT(*) AS total FROM world_objects
    WHERE model_path LIKE '/models/uploaded/model-178712%'
  `);
  console.log(`\nAfter update: ${check.rows[0].urls} unique URLs, ${check.rows[0].total} objects`);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
