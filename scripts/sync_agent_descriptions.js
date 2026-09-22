#!/usr/bin/env node
/**
 * sync_agent_descriptions.js — 把「模型库描述 / 几何体类型词映射」一键传导到世界对象
 *
 * 背景（2026-09-22 用户决策）：
 *   ① 模型对象（uploaded_model，706 个）：描述权威来源是 uploaded_models.description
 *      （管理员后台上传/编辑模型时填），此前只有「新放置对象」才会继承，
 *      已存在的对象不会更新 → 本脚本负责回填。
 *   ② 几何体对象（geometry_*，365 个）：描述由「名称里的类型词 → 映射表」推导
 *      （src/services/geometryAgentDesc.js + src/data/geometryDescMap.json）。
 *      observe 输出侧也有同样的兜底推导（新对象不改代码即生效），本脚本把值落库。
 *
 * ⚠️ 安全铁律（红线 4）：**绝不覆盖人工写的描述** —— 所有 UPDATE 都带
 *    `agent_description IS NULL`（只填空，不改已有的）。V3 专门验收这条。
 *
 * 用法：
 *   node scripts/sync_agent_descriptions.js                  # dry-run（默认，只统计）
 *   node scripts/sync_agent_descriptions.js --apply           # 真写库（先自动备份）
 *   node scripts/sync_agent_descriptions.js --only=models     # 只做模型对象
 *   node scripts/sync_agent_descriptions.js --only=geometry   # 只做几何体对象
 *   node scripts/sync_agent_descriptions.js --json            # 额外输出 JSON 报告
 *
 * 备份：--apply 时把被影响行的 (id, agent_description) 写到
 *       scripts/_agent_desc_backup_<时间戳>.json，回滚用（回滚=按 id 写回 null）。
 *
 * 控制台输出一律英文/数字（Windows PowerShell 中文会乱码）。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/database/db');
const geom = require('../src/services/geometryAgentDesc');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const WANT_JSON = args.includes('--json');
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || 'all';
const DO_MODELS = onlyArg === 'all' || onlyArg === 'models';
const DO_GEOMETRY = onlyArg === 'all' || onlyArg === 'geometry';

const MAX_DESC = 500;

function log(...a) { console.log(...a); }

// ==================== 覆盖率 ====================

async function coverage() {
  const o = await query(`SELECT count(*)::int AS total,
                                count(agent_description)::int AS with_desc
                         FROM world_objects`);
  const m = await query(`SELECT count(*)::int AS total,
                                count(NULLIF(description, ''))::int AS with_desc
                         FROM uploaded_models`);
  return {
    objects: o.rows[0].total, objectsWithDesc: o.rows[0].with_desc,
    models: m.rows[0].total, modelsWithDesc: m.rows[0].with_desc
  };
}

// ==================== B1：模型 → 世界对象 ====================

async function planModels() {
  const r = await query(
    `SELECT wo.id, wo.name, um.description
     FROM world_objects wo
     JOIN uploaded_models um ON wo.model_path = um.path
     WHERE um.description IS NOT NULL AND um.description <> ''
       AND wo.agent_description IS NULL
     ORDER BY wo.id`);
  return r.rows;
}

// ==================== B2：类型词 → 几何体对象 ====================

async function planGeometry() {
  const r = await query(
    `SELECT id, name, type, model_path
     FROM world_objects
     WHERE type LIKE 'geometry_%' AND agent_description IS NULL
     ORDER BY id`);
  const hits = [];
  const byWord = {};
  const unmatched = [];
  for (const row of r.rows) {
    const desc = geom.deriveAgentDescription(row);
    if (desc) {
      const parsed = geom.parseGeometryName(row.name);
      const key = (parsed && parsed.typeWord) || geom.typeWordFromModelPath(row.model_path) ||
        ('name:' + geom.stripCopySuffix(row.name).slice(0, 24));
      byWord[key] = (byWord[key] || 0) + 1;
      hits.push({ id: row.id, desc });
    } else {
      unmatched.push({ id: row.id, name: row.name, type: row.type });
    }
  }
  return { hits, byWord, unmatched, scanned: r.rows.length };
}

// ==================== 传送门（只读报告：待填清单）====================

async function reportPortals() {
  const r = await query(
    `SELECT id, name, description FROM portals WHERE is_active = true ORDER BY name`);
  return r.rows.map(p => ({
    id: p.id, name: p.name,
    desc: p.description ? String(p.description) : '',
    filled: !!(p.description && String(p.description).trim())
  }));
}

// ==================== 写库 ====================

async function applyModels(rows) {
  if (!rows.length) return { updated: 0, backup: [] };
  const backup = rows.map(r => ({ id: r.id, agent_description: null }));
  const res = await query(
    `UPDATE world_objects wo
     SET agent_description = LEFT(um.description, ${MAX_DESC}), updated_at = NOW()
     FROM uploaded_models um
     WHERE wo.model_path = um.path
       AND um.description IS NOT NULL AND um.description <> ''
       AND wo.agent_description IS NULL
     RETURNING wo.id`);
  return { updated: res.rowCount, backup };
}

async function applyGeometry(hits) {
  if (!hits.length) return { updated: 0, backup: [] };
  const backup = hits.map(h => ({ id: h.id, agent_description: null }));
  // 按描述分组，一组一条 UPDATE（365 个对象 → 约 20 条语句）
  const groups = new Map();
  hits.forEach(h => {
    if (!groups.has(h.desc)) groups.set(h.desc, []);
    groups.get(h.desc).push(h.id);
  });
  let updated = 0;
  for (const [desc, ids] of groups) {
    const res = await query(
      `UPDATE world_objects SET agent_description = $1, updated_at = NOW()
       WHERE id = ANY($2::int[]) AND agent_description IS NULL`,
      [String(desc).slice(0, MAX_DESC), ids]);
    updated += res.rowCount;
  }
  return { updated, backup };
}

// ==================== 主流程 ====================

async function main() {
  const before = await coverage();
  log('---- BEFORE ----');
  log(`objects=${before.objects} withDesc=${before.objectsWithDesc} coverage=${(before.objectsWithDesc * 100 / Math.max(1, before.objects)).toFixed(1)}%`);
  log(`models=${before.models} modelsWithDesc=${before.modelsWithDesc}`);

  const modelRows = DO_MODELS ? await planModels() : [];
  const geoPlan = DO_GEOMETRY ? await planGeometry() : { hits: [], byWord: {}, unmatched: [], scanned: 0 };
  const portals = await reportPortals();

  log('');
  log('---- PLAN ----');
  log(`B1 models->objects : ${modelRows.length} rows will be filled`);
  log(`B2 geometry        : scanned=${geoPlan.scanned} matched=${geoPlan.hits.length} unmatched=${geoPlan.unmatched.length}`);
  Object.entries(geoPlan.byWord).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => log(`     typeWord ${k} = ${n}`));
  if (geoPlan.unmatched.length) {
    log(`     unmatched sample (no mapping, left NULL):`);
    geoPlan.unmatched.slice(0, 10).forEach(u => log(`       id=${u.id} type=${u.type} name=${JSON.stringify(u.name)}`));
  }
  log(`portals (read-only) : ${portals.filter(p => p.filled).length}/${portals.length} filled`);
  portals.forEach(p => log(`     [${p.filled ? 'x' : ' '}] ${p.name} (${p.id})`));
  log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN (use --apply to write)'}`);

  if (!APPLY) {
    const after = await coverage();
    log('');
    log('---- SUMMARY (dry-run, nothing written) ----');
    log(`plan_models=${modelRows.length} plan_geometry=${geoPlan.hits.length}`);
    log(`objects_coverage=${(after.objectsWithDesc * 100 / Math.max(1, after.objects)).toFixed(1)}%`);
    if (WANT_JSON) {
      fs.writeFileSync(path.join(__dirname, '_agent_desc_sync_plan.json'),
        JSON.stringify({ before, after, plan: { models: modelRows.length, geometry: geoPlan.hits.length, byWord: geoPlan.byWord, unmatched: geoPlan.unmatched }, portals }, null, 2), 'utf8');
    }
    await pool.end();
    return;
  }

  const r1 = DO_MODELS ? await applyModels(modelRows) : { updated: 0, backup: [] };
  const r2 = DO_GEOMETRY ? await applyGeometry(geoPlan.hits) : { updated: 0, backup: [] };

  // ---------- 备份（没有任何改动就不落盘，避免验收/重跑刷出一堆空备份）----------
  let backupPath = '(skipped: nothing updated)';
  if (r1.updated + r2.updated > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backupPath = path.join(__dirname, `_agent_desc_backup_${ts}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      note: 'rollback = UPDATE world_objects SET agent_description = NULL WHERE id = ANY(ids)',
      modelsUpdated: r1.updated, geometryUpdated: r2.updated,
      rows: [...r1.backup, ...r2.backup]
    }, null, 2), 'utf8');
  }

  const after = await coverage();
  log('');
  log('---- APPLIED ----');
  log(`models_updated=${r1.updated} geometry_updated=${r2.updated} total=${r1.updated + r2.updated}`);
  log(`backup=${backupPath}`);
  log(`objects=${after.objects} withDesc=${after.objectsWithDesc} coverage=${(after.objectsWithDesc * 100 / Math.max(1, after.objects)).toFixed(1)}%`);
  log(`models=${after.models} modelsWithDesc=${after.modelsWithDesc}`);

  if (WANT_JSON) {
    fs.writeFileSync(path.join(__dirname, '_agent_desc_sync_result.json'),
      JSON.stringify({ before, after, modelsUpdated: r1.updated, geometryUpdated: r2.updated, backup: backupPath, portals }, null, 2), 'utf8');
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('[sync] FATAL ' + e.message);
  try { await pool.end(); } catch (_) { /* ignore */ }
  process.exitCode = 1;
});
