/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 维护工具 - 脚本执行逻辑
 * 包含 6 个维护脚本的具体实现
 * 行数: ~350 行，符合 ≤500 行规范
 */
const { query } = require('../database/db');
const fs = require('fs');
const path = require('path');

// ==================== 常量 ====================

const SCRIPT_IDS = {
  CLEANUP_MODEL_PATH: 'cleanup_invalid_model_path',
  CHECK_REFERENCES: 'check_broken_references',
  CLEANUP_UPLOADS: 'cleanup_orphan_uploads',
  CLEANUP_ORPHAN_OBJECTS: 'cleanup_orphan_objects',
  REFRESH_GEOMETRY: 'refresh_geometry_buildings',
  VERIFY_DB: 'verify_db_schema',
};

const SCRIPTS_LIST = [
  { id: SCRIPT_IDS.CLEANUP_MODEL_PATH, label: '清理无效 model_url', category: 'cleanup',
    description: '扫描并清理指向不存在文件或无效几何类型的 model_url 记录', dangerous: false },
  { id: SCRIPT_IDS.CHECK_REFERENCES, label: '检查文件引用完整性', category: 'check',
    description: '检查 buildings、character_templates、world_objects、weapons 中的文件引用是否有效', dangerous: false },
  { id: SCRIPT_IDS.CLEANUP_UPLOADS, label: '清理孤立上传文件', category: 'cache',
    description: '扫描 uploads/ 目录，找出未被数据库引用的孤立文件并清理', dangerous: true },
  { id: SCRIPT_IDS.CLEANUP_ORPHAN_OBJECTS, label: '清理孤立世界对象引用', category: 'cleanup',
    description: '清理 world_objects 中引用不存在的 building_id、model_path 为空的 geometry_building 记录、以及指向已删除建筑的引用', dangerous: false },
  { id: SCRIPT_IDS.REFRESH_GEOMETRY, label: '重新初始化基础几何体', category: 'repair',
    description: '确保 14 种基础几何体建筑存在于 buildings 表', dangerous: false },
  { id: SCRIPT_IDS.VERIFY_DB, label: '数据库完整性验证', category: 'check',
    description: '检查关键表结构、必填字段、种子数据是否完整', dangerous: false },
];

// ==================== 脚本 1: 清理无效 model_url ====================

async function cleanupInvalidModelPath(logExecution, updateLog) {
  const scriptId = SCRIPT_IDS.CLEANUP_MODEL_PATH;
  await logExecution(scriptId, '清理无效 model_url', 'cleanup', 'running', {}, 0, null);

  const result = await query(`
    SELECT id, model_url FROM buildings WHERE model_url IS NOT NULL
      AND model_url NOT LIKE 'models/%' AND model_url NOT LIKE 'uploads/%'
      AND model_url NOT LIKE 'geometry:%' AND model_url != ''
  `);

  const invalid = result.rows;
  let cleaned = 0;
  const details = [];

  for (const row of invalid) {
    let fileExists = false;
    if (row.model_url && !row.model_url.startsWith('geometry:')) {
      const fullPath = path.join(__dirname, '../../public', row.model_url);
      fileExists = fs.existsSync(fullPath);
    }
    if (!fileExists) {
      await query(`UPDATE buildings SET model_url = NULL WHERE id = $1`, [row.id]);
      cleaned++;
      details.push({ id: row.id, old_path: row.model_url });
    }
  }

  const objResult = await query(`
    SELECT id, type, model_path FROM world_objects WHERE model_path IS NOT NULL
      AND model_path NOT LIKE 'models/%' AND model_path NOT LIKE 'uploads/%'
      AND model_path NOT LIKE 'geometry:%' AND model_path NOT LIKE 'geometry\_building:%' AND model_path != ''
  `);
  for (const row of objResult.rows) {
    let fileExists = false;
    if (row.model_path && !row.model_path.startsWith('geometry:') && !row.model_path.startsWith('geometry_building:')) {
      const fullPath = path.join(__dirname, '../../public', row.model_path);
      fileExists = fs.existsSync(fullPath);
    }
    if (!fileExists) {
      await query(`UPDATE world_objects SET model_path = NULL WHERE id = $1`, [row.id]);
      cleaned++;
      details.push({ id: row.id, type: 'world_object', old_path: row.model_path });
    }
  }

  const geomResult = await query(`SELECT id, model_url FROM buildings WHERE model_url LIKE 'geometry:%'`);
  const validGeometries = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus',
    'torus_knot', 'icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron',
    'ring', 'lathe', 'capsule'];
  let geomCleaned = 0;
  for (const row of geomResult.rows) {
    const geoName = row.model_url.replace('geometry:', '');
    if (!validGeometries.includes(geoName)) {
      await query(`UPDATE buildings SET model_url = NULL WHERE id = $1`, [row.id]);
      geomCleaned++;
      details.push({ id: row.id, old_path: row.model_url, reason: '无效几何类型' });
    }
  }
  cleaned += geomCleaned;

  const summary = `扫描 ${invalid.length + objResult.rows.length + geomResult.rows.length} 条记录，清理 ${cleaned} 条无效引用`;
  await updateLog(scriptId, 'success', { summary, detail: details }, cleaned, null);
  return { success: true, message: summary, cleaned, totalChecked: invalid.length + objResult.rows.length + geomResult.rows.length, details };
}

// ==================== 脚本 2: 检查文件引用完整性 ====================

async function checkBrokenReferences(logExecution, updateLog) {
  const scriptId = SCRIPT_IDS.CHECK_REFERENCES;
  await logExecution(scriptId, '检查文件引用完整性', 'check', 'running', {}, 0, null);

  const broken = [];
  const publicDir = path.join(__dirname, '../../public');

  const buildings = await query(`SELECT id, building_name, model_url FROM buildings WHERE model_url IS NOT NULL AND model_url != ''`);
  for (const b of buildings.rows) {
    if (b.model_url.startsWith('geometry:')) continue;
    if (!fs.existsSync(path.join(publicDir, b.model_url.replace(/^\//, '')))) {
      broken.push({ table: 'buildings', id: b.id, name: b.building_name, path: b.model_url, type: 'model_url' });
    }
  }

  const chars = await query(`SELECT id, name, glb_url FROM character_templates WHERE glb_url IS NOT NULL AND glb_url != ''`);
  for (const c of chars.rows) {
    if (!fs.existsSync(path.join(publicDir, c.glb_url.replace(/^\//, '')))) {
      broken.push({ table: 'character_templates', id: c.id, name: c.name, path: c.glb_url, type: 'glb_url' });
    }
  }

  const objects = await query(`SELECT id, type, model_path FROM world_objects WHERE model_path IS NOT NULL AND model_path != ''`);
  for (const o of objects.rows) {
    if (o.model_path.startsWith('geometry:')) continue;
    if (!fs.existsSync(path.join(publicDir, o.model_path.replace(/^\//, '')))) {
      broken.push({ table: 'world_objects', id: o.id, name: o.type, path: o.model_path, type: 'model_path' });
    }
  }

  const weapons = await query(`SELECT id, name, glb_url FROM weapons WHERE glb_url IS NOT NULL AND glb_url != ''`);
  for (const w of weapons.rows) {
    if (!fs.existsSync(path.join(publicDir, w.glb_url.replace(/^\//, '')))) {
      broken.push({ table: 'weapons', id: w.id, name: w.name, path: w.glb_url, type: 'glb_url' });
    }
  }

  const totalChecked = buildings.rows.length + chars.rows.length + objects.rows.length + weapons.rows.length;
  const summary = broken.length === 0
    ? `✅ 全部正常！共检查 ${totalChecked} 个文件引用，无断裂引用`
    : `⚠️ 发现 ${broken.length} 个断裂引用（共检查 ${totalChecked} 个引用）`;

  await updateLog(scriptId, 'success', { summary, detail: broken }, broken.length, null);
  return { success: true, message: summary, brokenCount: broken.length, totalChecked, broken };
}

// ==================== 脚本 3: 清理孤立上传文件 ====================

async function cleanupOrphanUploads(logExecution, updateLog, dryRun) {
  const scriptId = SCRIPT_IDS.CLEANUP_UPLOADS;
  await logExecution(scriptId, '清理孤立上传文件', 'cleanup', 'running', {}, 0, null);

  const dbFiles = new Set();
  const addPaths = (rows, field) => {
    for (const r of rows) {
      const val = r[field];
      if (val && val !== '' && !val.startsWith('geometry:')) dbFiles.add(val.replace(/^\//, ''));
    }
  };
  addPaths((await query(`SELECT model_url FROM buildings WHERE model_url IS NOT NULL`)).rows, 'model_url');
  addPaths((await query(`SELECT glb_url FROM character_templates WHERE glb_url IS NOT NULL`)).rows, 'glb_url');
  addPaths((await query(`SELECT model_path FROM world_objects WHERE model_path IS NOT NULL`)).rows, 'model_path');
  addPaths((await query(`SELECT glb_url FROM weapons WHERE glb_url IS NOT NULL`)).rows, 'glb_url');
  addPaths((await query(`SELECT thumbnail_url FROM character_templates WHERE thumbnail_url IS NOT NULL`)).rows, 'thumbnail_url');

  const uploadsDir = path.join(__dirname, '../../public/uploads');
  const orphans = [];
  if (fs.existsSync(uploadsDir)) {
    for (const file of fs.readdirSync(uploadsDir)) {
      const relPath = 'uploads/' + file;
      if (!dbFiles.has(relPath)) orphans.push(relPath);
    }
  }

  if (!dryRun && orphans.length > 0) {
    for (const f of orphans) {
      try { fs.unlinkSync(path.join(uploadsDir, path.basename(f))); } catch (e) { /* skip */ }
    }
  }

  const summary = dryRun
    ? `🔍 预览模式：发现 ${orphans.length} 个孤立文件（未实际删除）`
    : `🗑️ 已清理 ${orphans.length} 个孤立文件`;

  await updateLog(scriptId, 'success', { summary, detail: { orphans, dryRun } }, orphans.length, null);
  return { success: true, message: summary, orphanCount: orphans.length, orphans, dryRun };
}

// ==================== 脚本 4: 清理孤立世界对象引用 ====================

async function cleanupOrphanObjects(logExecution, updateLog) {
  const scriptId = SCRIPT_IDS.CLEANUP_ORPHAN_OBJECTS;
  await logExecution(scriptId, '清理孤立世界对象引用', 'cleanup', 'running', {}, 0, null);

  let cleaned = 0;
  let deleted = 0;
  const details = [];

  // === 检查1: building_id 指向不存在的 buildings 记录 ===
  const objBuildings = await query(`
    SELECT wo.id, wo.type, wo.building_id FROM world_objects wo
    WHERE wo.building_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.id::text = wo.building_id::text)
  `);
  if (objBuildings.rows.length > 0) {
    for (const row of objBuildings.rows) {
      await query(`UPDATE world_objects SET building_id = NULL WHERE id = $1`, [row.id]);
      cleaned++;
    }
    details.push({ type: 'invalid_building_ref', action: 'SET NULL', count: objBuildings.rows.length, ids: objBuildings.rows.map(r => r.id) });
  }

  // === 检查2: geometry_building 类型但 model_path 为空 → 孤儿数据，直接删除 ===
  const orphanGeomNull = await query(`
    SELECT wo.id, wo.name, wo.type, wo.model_path
    FROM world_objects wo
    WHERE wo.type = 'geometry_building'
      AND (wo.model_path IS NULL OR wo.model_path = '')
  `);
  if (orphanGeomNull.rows.length > 0) {
    for (const row of orphanGeomNull.rows) {
      await query(`DELETE FROM world_objects WHERE id = $1`, [row.id]);
      deleted++;
    }
    details.push({ type: 'orphan_geometry_null_path', action: 'DELETE', count: orphanGeomNull.rows.length, 
      ids: orphanGeomNull.rows.map(r => r.id), names: orphanGeomNull.rows.map(r => r.name) });
  }

  // === 检查3: model_path 指向不存在 geometry_buildings 记录的引用 ===
  const orphanGeomRef = await query(`
    SELECT wo.id, wo.name, wo.model_path
    FROM world_objects wo
    WHERE wo.type = 'geometry_building'
      AND wo.model_path LIKE 'geometry_building:%'
      AND NOT EXISTS (
        SELECT 1 FROM geometry_buildings gb 
        WHERE gb.id::text = substring(wo.model_path from 'geometry_building:(.+)$')
      )
  `);
  if (orphanGeomRef.rows.length > 0) {
    for (const row of orphanGeomRef.rows) {
      await query(`DELETE FROM world_objects WHERE id = $1`, [row.id]);
      deleted++;
    }
    details.push({ type: 'orphan_geometry_deleted_building', action: 'DELETE', count: orphanGeomRef.rows.length,
      ids: orphanGeomRef.rows.map(r => r.id), names: orphanGeomRef.rows.map(r => r.name) });
  }

  const totalFixed = cleaned + deleted;
  const summary = `清理 ${totalFixed} 条孤立引用（重置引用: ${cleaned}，删除孤儿: ${deleted}）`;
  await updateLog(scriptId, 'success', { summary, detail: details }, totalFixed, null);
  return { success: true, message: summary, cleaned: totalFixed, details };
}

// ==================== 脚本 5: 重新初始化基础几何体 ====================

async function refreshGeometryBuildings(logExecution, updateLog) {
  const scriptId = SCRIPT_IDS.REFRESH_GEOMETRY;
  await logExecution(scriptId, '重新初始化基础几何体建筑', 'repair', 'running', {}, 0, null);

  const defaultBuildings = [
    { name: '立方体', model_url: 'geometry:box', tags: '["基础几何体","立方体"]' },
    { name: '球体', model_url: 'geometry:sphere', tags: '["基础几何体","球体"]' },
    { name: '圆柱体', model_url: 'geometry:cylinder', tags: '["基础几何体","圆柱体"]' },
    { name: '圆锥体', model_url: 'geometry:cone', tags: '["基础几何体","圆锥体"]' },
    { name: '平面', model_url: 'geometry:plane', tags: '["基础几何体","平面"]' },
    { name: '圆环', model_url: 'geometry:torus', tags: '["基础几何体","圆环"]' },
    { name: '圆环结', model_url: 'geometry:torus_knot', tags: '["基础几何体","圆环结"]' },
    { name: '二十面体', model_url: 'geometry:icosahedron', tags: '["基础几何体","二十面体"]' },
    { name: '十二面体', model_url: 'geometry:dodecahedron', tags: '["基础几何体","十二面体"]' },
    { name: '八面体', model_url: 'geometry:octahedron', tags: '["基础几何体","八面体"]' },
    { name: '四面体', model_url: 'geometry:tetrahedron', tags: '["基础几何体","四面体"]' },
    { name: '环形', model_url: 'geometry:ring', tags: '["基础几何体","环形"]' },
    { name: '旋转体', model_url: 'geometry:lathe', tags: '["基础几何体","旋转体"]' },
    { name: '胶囊体', model_url: 'geometry:capsule', tags: '["基础几何体","胶囊体"]' },
  ];

  // Ensure system plot exists for geometry buildings (FK constraint)
  const SYS_PLOT_ID = '00000000-0000-0000-0000-000000000001';
  const sysPlot = await query(`SELECT id FROM plots WHERE id = $1`, [SYS_PLOT_ID]);
  if (sysPlot.rows.length === 0) {
    // Get any existing user as owner (FK to users table)
    const anyUser = await query(`SELECT id FROM users LIMIT 1`);
    const ownerId = anyUser.rows[0] ? anyUser.rows[0].id : SYS_PLOT_ID;
    await query(`INSERT INTO plots (id, owner_id, position, size) VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb)`, [SYS_PLOT_ID, ownerId]);
  }

  let added = 0, skipped = 0;
  for (const b of defaultBuildings) {
    const existing = await query(
      `SELECT id FROM buildings WHERE model_url = $1`,
      [b.model_url]
    );
    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO buildings (plot_id, building_name, model_url, category, auto_tags) VALUES ($1,$2,$3,'geometry',$4::jsonb)`,
        [SYS_PLOT_ID, b.name, b.model_url, b.tags]
      );
      added++;
    } else { skipped++; }
  }

  const summary = `添加 ${added} 个缺失的几何体建筑，${skipped} 个已存在无需添加`;
  await updateLog(scriptId, 'success', { summary }, added, null);
  return { success: true, message: summary, added, skipped, total: defaultBuildings.length };
}

// ==================== 脚本 6: 数据库完整性验证 ====================

async function verifyDbSchema(logExecution, updateLog) {
  const scriptId = SCRIPT_IDS.VERIFY_DB;
  await logExecution(scriptId, '数据库完整性验证', 'check', 'running', {}, 0, null);

  const checks = [];
  let passCount = 0, failCount = 0;

  const criticalTables = ['users', 'characters', 'buildings', 'character_templates', 'weapons', 'world_objects', 'ai_providers', 'maintenance_logs'];
  for (const table of criticalTables) {
    const r = await query(`SELECT 1 FROM information_schema.tables WHERE table_name=$1 AND table_schema='public'`, [table]);
    if (r.rows.length > 0) { passCount++; checks.push({ table, status: 'PASS' }); }
    else { failCount++; checks.push({ table, status: 'FAIL', reason: '表不存在' }); }
  }

  // Field checks adapted to actual schema
  const fieldChecks = [
    { table: 'buildings', field: 'model_url' },
    { table: 'character_templates', field: 'glb_url' },
    { table: 'ai_providers', field: 'config_schema' },
    { table: 'world_objects', field: 'model_path' },
  ];
  for (const fc of fieldChecks) {
    const r = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 AND table_schema='public'`,
      [fc.table, fc.field]
    );
    if (r.rows.length > 0) { passCount++; checks.push({ check: `${fc.table}.${fc.field}`, status: 'PASS' }); }
    else { failCount++; checks.push({ check: `${fc.table}.${fc.field}`, status: 'FAIL', reason: '字段缺失' }); }
  }

  const aiProviders = await query(`SELECT COUNT(*)::int as cnt FROM ai_providers`);
  checks.push({ check: 'AI提供商种子数据', status: aiProviders.rows[0].cnt > 0 ? 'PASS' : 'WARN', count: aiProviders.rows[0].cnt });

  const summary = failCount === 0 ? `✅ 全部通过！${passCount} 项检查均正常` : `⚠️ ${passCount}/${passCount + failCount} 项通过，${failCount} 项失败`;
  const resultData = { summary, detail: { checks, passCount, failCount } };
  await updateLog(scriptId, 'success', resultData, failCount, null);
  return { success: failCount === 0, message: summary, checks, passCount, failCount };
}

// ==================== 导出 ====================

module.exports = {
  SCRIPT_IDS,
  SCRIPTS_LIST,
  cleanupInvalidModelPath,
  checkBrokenReferences,
  cleanupOrphanUploads,
  cleanupOrphanObjects,
  refreshGeometryBuildings,
  verifyDbSchema,
};
