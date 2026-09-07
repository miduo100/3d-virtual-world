/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 维护工具 - 角色资产清理脚本（角色模型未引用 / 角色动画未引用）
 *
 * 扫描 public/uploads/character-templates/** 与 public/uploads/anim-library/*，
 * 与数据库引用对比，找出孤儿文件：
 *   1. 精确引用匹配：character_templates(模型/17个动画列/anim_sounds/weapon_sounds)、
 *      animation_library(含软删行)、template_skills、weapon_skills、全库 url/path 列；
 *   2. 兜底 substring 搜索：全部 text/varchar/jsonb 列内容（防动态拼接引用）。
 *
 * 分类与删除边界（安全设计）：
 *   - model  孤儿：character-templates 根目录 char-* 文件 → 「角色模型未引用清理」删除
 *   - anim   孤儿：anim-library/*、AI工厂动画(uuid_动作_时间戳.glb)、skill-anims/* → 「角色动画未引用清理」删除
 *   - backup 孤儿：*.bak / *.bak_upfix → 永不自动删除，仅报告
 *   - other  孤儿：其余（如 sounds/*）→ 永不自动删除，仅报告
 *
 * 行数: ~260 行，符合 ≤500 行规范
 */
const { query } = require('../database/db');
const fs = require('fs');
const path = require('path');

const SCRIPT_IDS = {
  CLEANUP_CHAR_MODELS: 'cleanup_orphan_char_models',
  CLEANUP_CHAR_ANIMS: 'cleanup_orphan_char_anims',
};

const SCRIPT_ENTRIES = [
  { id: SCRIPT_IDS.CLEANUP_CHAR_MODELS, label: '清理未引用角色模型', category: 'cleanup',
    description: '扫描 character-templates 目录，找出未被数据库引用的 char-* 角色模型/缩略图并清理（已删除模板的残留文件）', dangerous: true },
  { id: SCRIPT_IDS.CLEANUP_CHAR_ANIMS, label: '清理未引用角色动画', category: 'cleanup',
    description: '扫描 anim-library 与 character-templates，找出未被任何模板/动作库引用的动画 GLB 并清理', dangerous: true },
];

const PUB_DIR = path.join(__dirname, '../../public');
const SCAN_DIRS = ['uploads/character-templates', 'uploads/anim-library'];
const ANIM_COLS = ['anim_idle_url','anim_walk_url','anim_run_url','anim_jump_url','anim_attack1_url',
  'anim_attack2_url','anim_attack3_url','anim_hit_url','anim_death_url','anim_turn_left_url',
  'anim_turn_right_url','anim_attack_stab_url','anim_attack_slash_url','anim_attack_swing_url',
  'anim_attack_uppercut_url','anim_sheath_url','anim_draw_sword_url'];
// 角色模型/缩略图（uploads.js glbStorage 命名：char-<ts>-<rand>.<ext>）
const MODEL_FILE_RE = /^char-.+/i;
// AI 工厂动作生成命名：<characterId(uuid)>_<motionKey>_<ts>.glb
const AI_ANIM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[\w\-]+_\d+\.(glb|gltf|fbx)$/i;
const BAK_RE = /\.bak(_\w+)?$/i;

// ==================== 文件枚举与分类 ====================

function listScanFiles() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(PUB_DIR, dir);
    if (!fs.existsSync(abs)) continue;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        const rel = path.join(dir, path.relative(abs, p)).replace(/\\/g, '/');
        out.push(rel);
      }
    })(abs);
  }
  return out.map(rel => {
    const abs = path.join(PUB_DIR, rel);
    return { rel, abs, size: fs.statSync(abs).size, basename: path.basename(rel) };
  });
}

function classifyOrphan(f) {
  const inRoot = /^uploads\/character-templates\/[^/]+$/.test(f.rel);
  if (BAK_RE.test(f.basename)) return 'backup';
  if (inRoot && MODEL_FILE_RE.test(f.basename)) return 'model';
  if (/^uploads\/anim-library\//.test(f.rel)) return 'anim';
  if (inRoot && /\.(glb|gltf|fbx)$/i.test(f.basename)) return 'anim'; // 含 AI 工厂 uuid_动作_ts.glb
  if (/^uploads\/character-templates\/skill-anims\//.test(f.rel)) return 'anim';
  return 'other';
}

// ==================== 引用收集 ====================

function addAllUrls(str, source, add) {
  const re = /\/?(?:uploads|models|scenes)\/[A-Za-z0-9_\-./]+\.(?:glb|gltf|png|jpg|jpeg|webp|mp3|wav|ogg|m4a|fbx|ply|mp4|webm)/gi;
  (str.match(re) || []).forEach(u => add(u, source));
}

async function buildExactRefs() {
  const map = new Map(); // rel 或 basename -> [source]
  const add = (val, source) => {
    if (!val || typeof val !== 'string') return;
    const v = val.replace(/^\//, '');
    for (const key of [v, path.basename(v)]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(source);
    }
  };

  const ct = await query(`SELECT id, name, glb_url, thumbnail_url FROM character_templates`);
  ct.rows.forEach(r => { add(r.glb_url, `character_templates#${r.id}(${r.name}).glb_url`);
                         add(r.thumbnail_url, `character_templates#${r.id}(${r.name}).thumbnail_url`); });

  for (const col of ANIM_COLS) {
    try {
      const r = await query(`SELECT id, name, ${col} AS u FROM character_templates WHERE ${col} IS NOT NULL`);
      r.rows.forEach(row => add(row.u, `character_templates#${row.id}(${row.name}).${col}`));
    } catch (e) { /* 列不存在跳过 */ }
  }

  try {
    const r = await query(`SELECT id, name, anim_sounds::text AS s, weapon_sounds::text AS w FROM character_templates`);
    r.rows.forEach(row => {
      if (row.s) addAllUrls(row.s, `character_templates#${row.id}.anim_sounds`, add);
      if (row.w) addAllUrls(row.w, `character_templates#${row.id}.weapon_sounds`, add);
    });
  } catch (e) { /* 列不存在跳过 */ }

  try {
    const r = await query(`SELECT id, name, glb_url FROM animation_library WHERE glb_url IS NOT NULL`);
    r.rows.forEach(row => add(row.glb_url, `animation_library#${row.id}(${row.name})`));
  } catch (e) { /* 表不存在跳过 */ }

  try {
    const r = await query(`SELECT id, skill_name, anim_glb_url, fx_sound_url FROM template_skills WHERE anim_glb_url IS NOT NULL OR fx_sound_url IS NOT NULL`);
    r.rows.forEach(row => { add(row.anim_glb_url, `template_skills#${row.id}.anim_glb_url`);
                            add(row.fx_sound_url, `template_skills#${row.id}.fx_sound_url`); });
  } catch (e) { /* 列不存在跳过 */ }

  // 全库 url/path 列（覆盖 world_objects/weapons/buildings/NPC 等一切可能的引用者）
  const pathCols = await query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (column_name ILIKE '%url%' OR column_name ILIKE '%path%' OR column_name ILIKE '%_file%')
    AND data_type IN ('text','character varying','varchar')`);
  for (const c of pathCols.rows) {
    if (['character_templates','animation_library','template_skills','maintenance_logs'].includes(c.table_name)) continue;
    try {
      const r = await query(`SELECT "${c.column_name}" AS u FROM "${c.table_name}" WHERE "${c.column_name}" IS NOT NULL`);
      r.rows.forEach(row => add(row.u, `${c.table_name}.${c.column_name}`));
    } catch (e) { /* 跳过 */ }
  }
  return map;
}

async function buildTextBlob() {
  const cols = await query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying','varchar','jsonb','json','character')
    ORDER BY table_name`);
  const tables = new Map();
  cols.rows.forEach(c => {
    if (!tables.has(c.table_name)) tables.set(c.table_name, []);
    tables.get(c.table_name).push(c.column_name);
  });
  let blob = '';
  for (const [t, tcols] of tables) {
    try {
      const cnt = await query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      if (cnt.rows[0].c > 200000) continue; // 超大表跳过（避免拖垮接口）
      const sel = tcols.map(c => `COALESCE("${c}"::text,'')`).join(" || ' \\n ' || ");
      const r = await query(`SELECT ${sel} AS v FROM "${t}"`);
      for (const row of r.rows) if (row.v) blob += row.v + '\n';
    } catch (e) { /* 长表等异常跳过 */ }
  }
  return blob;
}

// ==================== 孤儿扫描 ====================

async function scanOrphans() {
  const files = listScanFiles();
  const exactRefs = await buildExactRefs();
  const orphans = [];
  for (const f of files) {
    if (exactRefs.has(f.rel) || exactRefs.has(f.basename)) continue;
    orphans.push({ ...f, category: classifyOrphan(f) });
  }
  // 兜底：全库 substring 搜索，命中则保留
  const blob = await buildTextBlob();
  const finalOrphans = [];
  for (const f of orphans) {
    if (blob.includes(f.basename)) continue;
    finalOrphans.push(f);
  }
  return { files, finalOrphans };
}

// ==================== 脚本: 清理未引用角色模型 / 角色动画 ====================

function makeCleanupScript(targetCategories, scriptId, label) {
  return async function cleanup(logExecution, updateLog, dryRun) {
    await logExecution(scriptId, label, 'cleanup', 'running', {}, 0, null);
    const { files, finalOrphans } = await scanOrphans();
    const targets = finalOrphans.filter(f => targetCategories.includes(f.category));
    const skipped = finalOrphans.filter(f => !targetCategories.includes(f.category));

    let deleted = 0, freed = 0;
    const failed = [];
    if (!dryRun) {
      for (const f of targets) {
        try { fs.unlinkSync(f.abs); deleted++; freed += f.size; }
        catch (e) { failed.push({ rel: f.rel, error: e.message }); }
      }
    }
    const mb = n => (n / 1048576).toFixed(1) + 'MB';
    const summary = dryRun
      ? `🔍 预览：扫描 ${files.length} 个文件，发现 ${targets.length} 个${label}孤儿（${mb(targets.reduce((s, f) => s + f.size, 0))}）${skipped.length ? `；另有 ${skipped.length} 个备份/未分类孤儿不自动删除` : ''}`
      : `🗑️ 已清理 ${deleted} 个未引用文件（释放 ${mb(freed)}）${failed.length ? `；${failed.length} 个删除失败` : ''}${skipped.length ? `；${skipped.length} 个备份/未分类孤儿保留` : ''}`;
    await updateLog(scriptId, 'success', { summary, detail: { dryRun, targets, skipped, failed } }, deleted, null);
    return { success: true, message: summary, orphanCount: targets.length, orphans: targets.map(f => ({ rel: f.rel, size: f.size })), deleted, skipped: skipped.map(f => f.rel), failed, dryRun };
  };
}

module.exports = {
  SCRIPT_IDS,
  SCRIPT_ENTRIES,
  scanOrphans,
  cleanupOrphanCharacterModels: makeCleanupScript(['model'], SCRIPT_IDS.CLEANUP_CHAR_MODELS, '未引用角色模型'),
  cleanupOrphanCharacterAnims: makeCleanupScript(['anim'], SCRIPT_IDS.CLEANUP_CHAR_ANIMS, '未引用角色动画'),
};
