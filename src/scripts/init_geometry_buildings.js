/**
 * 初始化几何体建筑表
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/db');

async function initGeometryBuildings() {
  try {
    console.log('🔨 开始初始化几何体建筑表...\n');
    
    // 读取SQL文件
    const sqlPath = path.join(__dirname, '../database/init_geometry_buildings.sql');
    console.log('SQL文件路径:', sqlPath);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // 执行SQL
    await pool.query(sql);
    
    console.log('✅ 几何体建筑表初始化成功！\n');
    
    // 查询表状态
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM geometry_buildings
    `);
    
    console.log(`📊 当前几何体建筑数量: ${result.rows[0].count}\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    process.exit(1);
  }
}

initGeometryBuildings();
