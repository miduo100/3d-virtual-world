/* 验证红军模型 world_objects 路径状态（只读）
 * 统计 1787128/1787129 前缀对象的路径指向：_dec.glb 减面版 vs 原始 .glb
 * 并列出唯一 URL 供 HTTP 抽样验证 */
const { pool } = require('../src/database/db');

async function main() {
  const r = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE model_path LIKE '%_dec.glb') AS decimated,
      COUNT(*) FILTER (WHERE model_path NOT LIKE '%_dec.glb') AS original
    FROM world_objects
    WHERE model_path LIKE '/models/uploaded/model-1787128%'
       OR model_path LIKE '/models/uploaded/model-1787129%'
  `);
  console.log('红军对象路径状态:', r.rows[0]);

  const urls = await pool.query(`
    SELECT DISTINCT model_path FROM world_objects
    WHERE model_path LIKE '/models/uploaded/model-1787128%'
       OR model_path LIKE '/models/uploaded/model-1787129%'
    ORDER BY model_path
  `);
  console.log(`\n唯一 URL 数: ${urls.rows.length}`);
  urls.rows.forEach(u => console.log(' ', u.model_path));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
