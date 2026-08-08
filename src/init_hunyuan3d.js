/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { pool } = require('./database/db');
const fs = require('fs');
const path = require('path');

async function initHunyuan3D() {
  try {
    console.log('开始初始化混元3D数据表...');
    
    const sqlPath = path.join(__dirname, 'database', 'init_hunyuan3d.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ 混元3D数据表初始化成功！');
    console.log('已创建以下表：');
    console.log('  - generated_buildings (生成的建筑)');
    console.log('  - world_objects (世界对象)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 初始化失败:', error.message);
    process.exit(1);
  }
}

initHunyuan3D();
