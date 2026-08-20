/* 红军模型文件实测：磁盘大小 + uploaded_models 关联 */
const { pool } = require('../src/database/db');
const fs = require('fs');
const path = require('path');

async function main() {
  // 1. world_objects 中引用的红军文件 URL
  const objs = await pool.query(`
    SELECT DISTINCT model_path FROM world_objects
    WHERE model_path LIKE '%model-1787%' OR model_path LIKE '%model-%'
    ORDER BY model_path
  `);
  console.log('=== world_objects 引用的 model-* 文件 ===');
  objs.rows.forEach(r => console.log(`  ${r.model_path}`));
  console.log(`共 ${objs.rows.length} 个唯一 URL`);

  // 2. uploaded_models 表里有没有 model- 前缀记录
  const um = await pool.query(`
    SELECT id, file_name, file_size, created_at FROM uploaded_models
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log('\n=== uploaded_models 最近 15 条 ===');
  um.rows.forEach(r => console.log(`  id=${r.id} ${((r.file_size || 0) / 1024 / 1024).toFixed(2)}MB ${r.file_name}`));

  // 3. 磁盘实测文件大小（public/models/uploaded/）
  const dir = path.join(__dirname, '..', 'public', 'models', 'uploaded');
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { console.log('\n目录不存在: ' + dir); }
  const glbs = files.filter(f => f.toLowerCase().endsWith('.glb')).map(f => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.size };
  }).sort((a, b) => b.size - a.size);
  console.log(`\n=== 磁盘 public/models/uploaded 共 ${glbs.length} 个 GLB ===`);
  let total = 0;
  glbs.forEach(g => { total += g.size; });
  console.log(`  总大小 ${(total / 1024 / 1024).toFixed(1)}MB`);
  glbs.slice(0, 35).forEach(g => console.log(`  ${(g.size / 1024 / 1024).toFixed(2)}MB ${g.name}`));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
