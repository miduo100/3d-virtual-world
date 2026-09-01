/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 角色模板 API 模块
 * 包含：角色模板 CRUD、技能管理、音频/动画配置等 API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { query } = require('../../database/db');
const { fileHash } = require('./utils');
const { upload, uploadSound, uploadSkillAnim } = require('./uploads');
const { compressCharGlb } = require('./charTextureCompress');

// GET /api/character-templates  获取所有模板（公开接口）
router.get('/', async (req, res) => {
  try {
    const { access_level, character_role } = req.query;
    let sql = `
      SELECT ct.*, ct.created_by_name as creator_name,
             COUNT(ts.id) as skill_count
      FROM character_templates ct
      LEFT JOIN template_skills ts ON ct.id = ts.template_id
    `;
    const params = [];
    const conditions = [];
    if (access_level) { params.push(access_level); conditions.push(`ct.access_level = $${params.length}`); }
    if (character_role) { params.push(character_role); conditions.push(`ct.character_role = $${params.length}`); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' GROUP BY ct.id ORDER BY ct.sort_order, ct.created_at DESC';

    const result = await query(sql, params);
    res.json({ templates: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取模板列表失败' });
  }
});

// GET /api/character-templates/:id  获取模板详情（含技能）
router.get('/:id', async (req, res, next) => {
  try {
    // 【修复路由冲突】排除子模块路径，让后续中间件处理
    // 这些路径由 weaponsRouter、extrasRouter 等专门处理
    const excludedPaths = ['weapons', 'world-rules', 'weather', 'anim-library'];
    if (excludedPaths.includes(req.params.id.toLowerCase())) {
      // 调用 next() 传递给下一个中间件，而不是返回 404
      return next('route');
    }

    // 检查ID格式是否为UUID
    const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!idPattern.test(req.params.id)) {
      // 不是有效UUID，也传递给下一个中间件处理
      return next('route');
    }
    
    const tmpl = await query('SELECT * FROM character_templates WHERE id = $1', [req.params.id]);
    if (!tmpl.rows.length) return res.status(404).json({ error: '模板不存在' });

    // 解析 JSON 字段
    const template = { ...tmpl.rows[0] };
    try {
      template.anim_sounds = _parseJ(tmpl.rows[0].anim_sounds);
      template.weapon_sounds = _parseJ(tmpl.rows[0].weapon_sounds);
      const _parseJ = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch(e) { return null; } };
      template.weapon_config = _parseJ(tmpl.rows[0].weapon_config);
      template.calibration_config = _parseJ(tmpl.rows[0].calibration_config);
      template.weapon_socket_config = _parseJ(tmpl.rows[0].weapon_socket_config);
      template.bone_mapping_config = _parseJ(tmpl.rows[0].bone_mapping_config);
      template.fit_config = _parseJ(tmpl.rows[0].fit_config);
      template.is_calibrated = Boolean(tmpl.rows[0].is_calibrated);
      template.calibrated_at = tmpl.rows[0].calibrated_at ? new Date(tmpl.rows[0].calibrated_at) : null;
      template.calibration_version = tmpl.rows[0].calibration_version || 1;
      console.log(`[admin-templates] 解析模板 ${template.name} 成功:`, template.calibration_config);
    } catch (error) {
      console.error(`[admin-templates] 解析模板 ${tmpl.rows[0].name} 失败:`, error);
    }

    // 若模板绑定了 weapon_id，从 weapons 表读取武器完整配置，优先覆盖旧 weapon_config
    if (template.weapon_id) {
      try {
        const wRes = await query('SELECT id, name, weapon_type, glb_url, config FROM weapons WHERE id=$1 AND is_active=TRUE', [template.weapon_id]);
        if (wRes.rows.length) {
          const w = wRes.rows[0];
          const wConfig = w.config ? (typeof w.config === 'string' ? JSON.parse(w.config) : w.config) : {};
          // 将武器表的 config 合并进 weapon_config，武器表数据优先
          template.weapon_config = Object.assign({}, template.weapon_config || {}, wConfig, {
            weapon_id: w.id,
            weapon_name: w.name,
            weapon_type: w.weapon_type,
            glb_url: w.glb_url || null,
          });
          console.log(`[admin-templates] 模板 ${template.name} 武器配置已从武器库同步:`, template.weapon_config);
        }
      } catch (wErr) {
        console.error(`[admin-templates] 读取武器配置失败:`, wErr.message);
      }
    }

    const skills = await query(
      'SELECT * FROM template_skills WHERE template_id = $1 ORDER BY sort_order, created_at',
      [req.params.id]
    );
    res.json({ template, skills: skills.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取模板详情失败' });
  }
});

// POST /api/character-templates  创建模板（含 GLB 上传）
router.post('/', upload.fields([
  { name: 'glb_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'anim_idle', maxCount: 1 },
  { name: 'anim_walk', maxCount: 1 },
  { name: 'anim_run', maxCount: 1 },
  { name: 'anim_jump', maxCount: 1 },
  { name: 'anim_attack1', maxCount: 1 },
  { name: 'anim_attack2', maxCount: 1 },
  { name: 'anim_attack3', maxCount: 1 },
  { name: 'anim_hit', maxCount: 1 },
  { name: 'anim_death', maxCount: 1 },
  { name: 'anim_turn_left', maxCount: 1 },
  { name: 'anim_turn_right', maxCount: 1 },
  { name: 'anim_attack_stab', maxCount: 1 },
  { name: 'anim_attack_slash', maxCount: 1 },
  { name: 'anim_attack_swing', maxCount: 1 },
  { name: 'anim_attack_uppercut', maxCount: 1 },
  { name: 'anim_sheath', maxCount: 1 },
  { name: 'anim_draw_sword', maxCount: 1 },
]), async (req, res) => {
  try {
    const { name, description, access_level, character_role, is_default, sort_order,
            model_source_platform, auto_bone_map } = req.body;
    if (!name) return res.status(400).json({ error: '模板名称不能为空' });

    // ===== 处理平台信息和骨骼映射配置 =====
    let bone_mapping_config_value = '{}';
    if (model_source_platform && model_source_platform !== 'manual' && auto_bone_map) {
      try {
        const parsed = typeof auto_bone_map === 'string' ? JSON.parse(auto_bone_map) : auto_bone_map;
        // 优先使用前端传入的 auto_bone_map（包含完整映射）
        bone_mapping_config_value = JSON.stringify({
          platform: parsed.platform || model_source_platform,
          rightHand: parsed.rightHand || null,
          camera: parsed.camera || null,
          rootBone: parsed.rootBone || null,
          fullMap: parsed.fullMap || {},
          defaults: parsed.defaults || {},
        });
        console.log('[templates] 模板 ' + name + ' 来自平台: ' + model_source_platform);
      } catch (e) {
        console.warn('[templates] 解析auto_bone_map失败:', e.message);
      }
    } else if (req.body.bone_mapping_config) {
      // 回退：使用直接传入的 bone_mapping_config
      bone_mapping_config_value = typeof req.body.bone_mapping_config === 'string'
        ? req.body.bone_mapping_config
        : JSON.stringify(req.body.bone_mapping_config);
    }

    let glb_url = null, glb_hash = null, thumbnail_url = null;
    let anim_idle_url = null, anim_walk_url = null, anim_run_url = null;
    let anim_jump_url = null, anim_attack1_url = null, anim_attack2_url = null, anim_attack3_url = null;
    let anim_hit_url = null, anim_death_url = null;
    let anim_turn_left_url = null, anim_turn_right_url = null;
    let anim_attack_stab_url = null, anim_attack_slash_url = null;
    let anim_attack_swing_url = null, anim_attack_uppercut_url = null;
    let anim_sheath_url = null, anim_draw_sword_url = null;

    if (req.files?.glb_file?.[0]) {
      const f = req.files.glb_file[0];
      glb_url = `/uploads/character-templates/${f.filename}`;
      // 角色模板纹理压缩（4K→2K），失败自动跳过、不阻断上传
      await compressCharGlb(f.path, 'char-template-create');
      // 压缩后再算 hash，保证 glb_hash 与磁盘上的最终文件一致
      glb_hash = await fileHash(f.path);
    }
    if (req.files?.thumbnail?.[0]) {
      const t = req.files.thumbnail[0];
      thumbnail_url = `/uploads/character-templates/${t.filename}`;
    }
    const animFields = ['anim_idle','anim_walk','anim_run','anim_jump','anim_attack1','anim_attack2','anim_attack3','anim_hit','anim_death',
      'anim_turn_left','anim_turn_right','anim_attack_stab','anim_attack_slash','anim_attack_swing','anim_attack_uppercut','anim_sheath','anim_draw_sword'];
    const animUrls = {};
    for (const field of animFields) {
      if (req.files?.[field]?.[0]) {
        animUrls[field] = `/uploads/character-templates/${req.files[field][0].filename}`;
      } else {
        animUrls[field] = null;
      }
    }
    anim_idle_url    = animUrls.anim_idle;
    anim_walk_url    = animUrls.anim_walk;
    anim_run_url     = animUrls.anim_run;
    anim_jump_url    = animUrls.anim_jump;
    anim_attack1_url = animUrls.anim_attack1;
    anim_attack2_url = animUrls.anim_attack2;
    anim_attack3_url = animUrls.anim_attack3;
    anim_hit_url     = animUrls.anim_hit;
    anim_death_url   = animUrls.anim_death;
    anim_turn_left_url      = animUrls.anim_turn_left;
    anim_turn_right_url     = animUrls.anim_turn_right;
    anim_attack_stab_url    = animUrls.anim_attack_stab;
    anim_attack_slash_url   = animUrls.anim_attack_slash;
    anim_attack_swing_url   = animUrls.anim_attack_swing;
    anim_attack_uppercut_url= animUrls.anim_attack_uppercut;
    anim_sheath_url         = animUrls.anim_sheath;
    anim_draw_sword_url     = animUrls.anim_draw_sword;

    const result = await query(
      `INSERT INTO character_templates
        (name, description, glb_url, glb_hash, thumbnail_url,
         anim_idle_url,
         anim_walk_url, anim_run_url, anim_jump_url,
         anim_attack1_url, anim_attack2_url, anim_attack3_url,
         anim_hit_url, anim_death_url,
         anim_turn_left_url, anim_turn_right_url,
         anim_attack_stab_url, anim_attack_slash_url,
         anim_attack_swing_url, anim_attack_uppercut_url,
         anim_sheath_url, anim_draw_sword_url,
         access_level, character_role, is_default, sort_order, created_by_admin_id, created_by_name,
         fit_config, calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at, calibration_version,
         model_source_platform)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
       RETURNING *`,
      [
        name, description || null,
        glb_url, glb_hash, thumbnail_url,
        anim_idle_url,
        anim_walk_url, anim_run_url, anim_jump_url,
        anim_attack1_url, anim_attack2_url, anim_attack3_url,
        anim_hit_url, anim_death_url,
        anim_turn_left_url, anim_turn_right_url,
        anim_attack_stab_url, anim_attack_slash_url,
        anim_attack_swing_url, anim_attack_uppercut_url,
        anim_sheath_url, anim_draw_sword_url,
        access_level || 'public',
        character_role || 'player',
        is_default === 'true' || is_default === true,
        parseInt(sort_order) || 0,
        req.adminUser?.id || null,
        req.adminUser?.username || null,
        req.body.fit_config ? (typeof req.body.fit_config === 'string' ? req.body.fit_config : JSON.stringify(req.body.fit_config)) : '{}',
        req.body.calibration_config ? (typeof req.body.calibration_config === 'string' ? req.body.calibration_config : JSON.stringify(req.body.calibration_config)) : '{}',
        req.body.weapon_socket_config ? (typeof req.body.weapon_socket_config === 'string' ? req.body.weapon_socket_config : JSON.stringify(req.body.weapon_socket_config)) : '{}',
        bone_mapping_config_value,
        req.body.is_calibrated === 'true' || req.body.is_calibrated === true,
        req.body.calibrated_at ? new Date(req.body.calibrated_at) : null,
        parseInt(req.body.calibration_version) || 1,
        model_source_platform || null
      ]
    );

    if (result.rows[0].is_default) {
      await query('UPDATE character_templates SET is_default = FALSE WHERE id != $1', [result.rows[0].id]);
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建模板失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id  更新模板（可重新上传 GLB）
router.put('/:id', upload.fields([
  { name: 'glb_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'anim_idle', maxCount: 1 },
  { name: 'anim_walk', maxCount: 1 },
  { name: 'anim_run', maxCount: 1 },
  { name: 'anim_jump', maxCount: 1 },
  { name: 'anim_attack1', maxCount: 1 },
  { name: 'anim_attack2', maxCount: 1 },
  { name: 'anim_attack3', maxCount: 1 },
  { name: 'anim_hit', maxCount: 1 },
  { name: 'anim_death', maxCount: 1 },
  { name: 'anim_turn_left', maxCount: 1 },
  { name: 'anim_turn_right', maxCount: 1 },
  { name: 'anim_attack_stab', maxCount: 1 },
  { name: 'anim_attack_slash', maxCount: 1 },
  { name: 'anim_attack_swing', maxCount: 1 },
  { name: 'anim_attack_uppercut', maxCount: 1 },
  { name: 'anim_sheath', maxCount: 1 },
  { name: 'anim_draw_sword', maxCount: 1 },
]), async (req, res, next) => {
  try {
    // 【修复路由冲突】排除子模块路径
    const excludedPaths = ['weapons', 'world-rules', 'weather', 'anim-library'];
    if (excludedPaths.includes(req.params.id.toLowerCase())) {
      return next('route');
    }

    const { id } = req.params;
    const existing = await query('SELECT * FROM character_templates WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: '模板不存在' });

    const old = existing.rows[0];
    const { name, description, access_level, character_role, is_default, is_active, sort_order, clear_fields, weapon_config, bone_map, fit_config, calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at, calibration_version, model_source_platform, anim_mode, selected_anim_platform } = req.body;
    console.log('[PUT template] anim_mode字段:', anim_mode, 'selected_anim_platform字段:', selected_anim_platform);
    // 需要清空的字段列表（前端传来逗号分隔，如 "glb_file,anim_idle"）
    const clearSet = new Set((clear_fields || '').split(',').map(s => s.trim()).filter(Boolean));

    let glb_url = old.glb_url, glb_hash = old.glb_hash;
    let thumbnail_url = old.thumbnail_url;
    let anim_idle_url = old.anim_idle_url, anim_walk_url = old.anim_walk_url, anim_run_url = old.anim_run_url;
    let anim_jump_url = old.anim_jump_url;
    let anim_attack1_url = old.anim_attack1_url;
    let anim_attack2_url = old.anim_attack2_url;
    let anim_attack3_url = old.anim_attack3_url;
    let anim_hit_url = old.anim_hit_url, anim_death_url = old.anim_death_url;
    let anim_turn_left_url = old.anim_turn_left_url, anim_turn_right_url = old.anim_turn_right_url;
    let anim_attack_stab_url = old.anim_attack_stab_url, anim_attack_slash_url = old.anim_attack_slash_url;
    let anim_attack_swing_url = old.anim_attack_swing_url, anim_attack_uppercut_url = old.anim_attack_uppercut_url;
    let anim_sheath_url = old.anim_sheath_url, anim_draw_sword_url = old.anim_draw_sword_url;

    // 处理清空字段
    const fieldUrlMap = {
      glb_file:    ['glb_url',        old.glb_url],
      thumbnail:   ['thumbnail_url',  old.thumbnail_url],
      anim_idle:   ['anim_idle_url',  old.anim_idle_url],
      anim_walk:   ['anim_walk_url',  old.anim_walk_url],
      anim_run:    ['anim_run_url',   old.anim_run_url],
      anim_jump:   ['anim_jump_url',  old.anim_jump_url],
      anim_attack1:['anim_attack1_url',old.anim_attack1_url],
      anim_attack2:['anim_attack2_url',old.anim_attack2_url],
      anim_attack3:['anim_attack3_url',old.anim_attack3_url],
      anim_hit:    ['anim_hit_url',   old.anim_hit_url],
      anim_death:  ['anim_death_url', old.anim_death_url],
      anim_turn_left:      ['anim_turn_left_url',       old.anim_turn_left_url],
      anim_turn_right:     ['anim_turn_right_url',      old.anim_turn_right_url],
      anim_attack_stab:    ['anim_attack_stab_url',     old.anim_attack_stab_url],
      anim_attack_slash:   ['anim_attack_slash_url',    old.anim_attack_slash_url],
      anim_attack_swing:   ['anim_attack_swing_url',    old.anim_attack_swing_url],
      anim_attack_uppercut:['anim_attack_uppercut_url', old.anim_attack_uppercut_url],
      anim_sheath:         ['anim_sheath_url',          old.anim_sheath_url],
      anim_draw_sword:     ['anim_draw_sword_url',      old.anim_draw_sword_url],
    };
    for (const field of clearSet) {
      if (fieldUrlMap[field]) {
        const [, oldUrl] = fieldUrlMap[field];
        if (oldUrl) fs.unlink(path.join(__dirname, '../../public', oldUrl)).catch(() => {});
        // 将对应变量置 null
        if (field === 'glb_file') { glb_url = null; glb_hash = null; }
        else if (field === 'thumbnail') thumbnail_url = null;
        else if (field === 'anim_idle')    anim_idle_url = null;
        else if (field === 'anim_walk')    anim_walk_url = null;
        else if (field === 'anim_run')     anim_run_url = null;
        else if (field === 'anim_jump')    anim_jump_url = null;
        else if (field === 'anim_attack1') anim_attack1_url = null;
        else if (field === 'anim_attack2') anim_attack2_url = null;
        else if (field === 'anim_attack3') anim_attack3_url = null;
        else if (field === 'anim_hit')     anim_hit_url = null;
        else if (field === 'anim_death')   anim_death_url = null;
        else if (field === 'anim_turn_left')       anim_turn_left_url = null;
        else if (field === 'anim_turn_right')      anim_turn_right_url = null;
        else if (field === 'anim_attack_stab')     anim_attack_stab_url = null;
        else if (field === 'anim_attack_slash')    anim_attack_slash_url = null;
        else if (field === 'anim_attack_swing')    anim_attack_swing_url = null;
        else if (field === 'anim_attack_uppercut') anim_attack_uppercut_url = null;
        else if (field === 'anim_sheath')          anim_sheath_url = null;
        else if (field === 'anim_draw_sword')      anim_draw_sword_url = null;
      }
    }

    if (req.files?.glb_file?.[0]) {
      const f = req.files.glb_file[0];
      if (old.glb_url) fs.unlink(path.join(__dirname, '../../public', old.glb_url)).catch(() => {});
      glb_url = `/uploads/character-templates/${f.filename}`;
      // 角色模板纹理压缩（4K→2K），失败自动跳过、不阻断上传
      await compressCharGlb(f.path, 'char-template-update');
      // 压缩后再算 hash，保证 glb_hash 与磁盘上的最终文件一致
      glb_hash = await fileHash(f.path);
    }
    if (req.files?.thumbnail?.[0]) {
      const t = req.files.thumbnail[0];
      if (old.thumbnail_url) fs.unlink(path.join(__dirname, '../../public', old.thumbnail_url)).catch(() => {});
      thumbnail_url = `/uploads/character-templates/${t.filename}`;
    }
    // 直接处理动画字段更新
    const animFields = {
      anim_idle: { varName: 'anim_idle_url', currentValue: anim_idle_url },
      anim_walk: { varName: 'anim_walk_url', currentValue: anim_walk_url },
      anim_run: { varName: 'anim_run_url', currentValue: anim_run_url },
      anim_jump: { varName: 'anim_jump_url', currentValue: anim_jump_url },
      anim_attack1: { varName: 'anim_attack1_url', currentValue: anim_attack1_url },
      anim_attack2: { varName: 'anim_attack2_url', currentValue: anim_attack2_url },
      anim_attack3: { varName: 'anim_attack3_url', currentValue: anim_attack3_url },
      anim_hit: { varName: 'anim_hit_url', currentValue: anim_hit_url },
      anim_death: { varName: 'anim_death_url', currentValue: anim_death_url },
      anim_turn_left: { varName: 'anim_turn_left_url', currentValue: anim_turn_left_url },
      anim_turn_right: { varName: 'anim_turn_right_url', currentValue: anim_turn_right_url },
      anim_attack_stab: { varName: 'anim_attack_stab_url', currentValue: anim_attack_stab_url },
      anim_attack_slash: { varName: 'anim_attack_slash_url', currentValue: anim_attack_slash_url },
      anim_attack_swing: { varName: 'anim_attack_swing_url', currentValue: anim_attack_swing_url },
      anim_attack_uppercut: { varName: 'anim_attack_uppercut_url', currentValue: anim_attack_uppercut_url },
      anim_sheath: { varName: 'anim_sheath_url', currentValue: anim_sheath_url },
      anim_draw_sword: { varName: 'anim_draw_sword_url', currentValue: anim_draw_sword_url },
    };
    
    console.log('[Upload Debug] req.files:', req.files);
    
    for (const [field, { varName, currentValue }] of Object.entries(animFields)) {
      if (req.files?.[field]?.[0]) {
        const f = req.files[field][0];
        console.log(`[Upload Debug] Processing ${field} file:`, {
          field: field,
          filename: f.filename,
          originalname: f.originalname,
          path: f.path,
          size: f.size,
          mimetype: f.mimetype
        });
        
        // 检查文件是否真的存在
        const fileExists = fsSync.existsSync(f.path);
        console.log(`[Upload Debug] File exists at ${f.path}:`, fileExists);
        
        if (old[varName]) {
          console.log(`[Upload Debug] Removing old file: ${old[varName]}`);
          fs.unlink(path.join(__dirname, '../../public', old[varName])).catch(e => console.error('[Upload Debug] Failed to remove old file:', e));
        }
        
        const newUrl = `/uploads/character-templates/${f.filename}`;
        console.log(`[Upload Debug] Setting new URL: ${newUrl}`);
        
        // 直接更新对应的变量
        switch (field) {
          case 'anim_idle': anim_idle_url = newUrl; break;
          case 'anim_walk': anim_walk_url = newUrl; break;
          case 'anim_run': anim_run_url = newUrl; break;
          case 'anim_jump': anim_jump_url = newUrl; break;
          case 'anim_attack1': anim_attack1_url = newUrl; break;
          case 'anim_attack2': anim_attack2_url = newUrl; break;
          case 'anim_attack3': anim_attack3_url = newUrl; break;
          case 'anim_hit': anim_hit_url = newUrl; break;
          case 'anim_death': anim_death_url = newUrl; break;
          case 'anim_turn_left': anim_turn_left_url = newUrl; break;
          case 'anim_turn_right': anim_turn_right_url = newUrl; break;
          case 'anim_attack_stab': anim_attack_stab_url = newUrl; break;
          case 'anim_attack_slash': anim_attack_slash_url = newUrl; break;
          case 'anim_attack_swing': anim_attack_swing_url = newUrl; break;
          case 'anim_attack_uppercut': anim_attack_uppercut_url = newUrl; break;
          case 'anim_sheath': anim_sheath_url = newUrl; break;
          case 'anim_draw_sword': anim_draw_sword_url = newUrl; break;
        }
      }
    }

    const result = await query(
      `UPDATE character_templates SET
        name = $1, description = $2, glb_url = $3, glb_hash = $4, thumbnail_url = $5,
        anim_idle_url = $6,
        anim_walk_url = $7, anim_run_url = $8,
        anim_jump_url = $9,
        anim_attack1_url = $10, anim_attack2_url = $11, anim_attack3_url = $12,
        anim_hit_url = $13, anim_death_url = $14,
        anim_turn_left_url = $15, anim_turn_right_url = $16,
        anim_attack_stab_url = $17, anim_attack_slash_url = $18,
        anim_attack_swing_url = $19, anim_attack_uppercut_url = $20,
        anim_sheath_url = $21, anim_draw_sword_url = $22,
        access_level = $23, character_role = $24, is_default = $25, is_active = $26,
        sort_order = $27, weapon_config = $28, bone_map = $29, fit_config = $30,
        calibration_config = $31, weapon_socket_config = $32, bone_mapping_config = $33, is_calibrated = $34, calibrated_at = $35, calibration_version = $36, updated_at = CURRENT_TIMESTAMP,
        model_source_platform = $38, anim_mode = $39, selected_anim_platform = $40
       WHERE id = $37 RETURNING *`,
      [
        name || old.name, description ?? old.description,
        glb_url, glb_hash, thumbnail_url,
        anim_idle_url,
        anim_walk_url, anim_run_url, anim_jump_url,
        anim_attack1_url, anim_attack2_url, anim_attack3_url,
        anim_hit_url, anim_death_url,
        anim_turn_left_url, anim_turn_right_url,
        anim_attack_stab_url, anim_attack_slash_url,
        anim_attack_swing_url, anim_attack_uppercut_url,
        anim_sheath_url, anim_draw_sword_url,
        access_level || old.access_level,
        character_role || old.character_role,
        is_default === 'true' || is_default === true,
        is_active !== 'false' && is_active !== false,
        parseInt(sort_order) || old.sort_order,
        weapon_config ? (typeof weapon_config === 'string' ? weapon_config : JSON.stringify(weapon_config)) : JSON.stringify(old.weapon_config || {}),
        bone_map ? (typeof bone_map === 'string' ? bone_map : JSON.stringify(bone_map)) : JSON.stringify(old.bone_map || {}),
        fit_config ? (typeof fit_config === 'string' ? fit_config : JSON.stringify(fit_config)) : (old.fit_config || '{}'),
        calibration_config ? (typeof calibration_config === 'string' ? calibration_config : JSON.stringify(calibration_config)) : (old.calibration_config || '{}'),
        weapon_socket_config ? (typeof weapon_socket_config === 'string' ? weapon_socket_config : JSON.stringify(weapon_socket_config)) : (old.weapon_socket_config || '{}'),
        bone_mapping_config ? (typeof bone_mapping_config === 'string' ? bone_mapping_config : JSON.stringify(bone_mapping_config)) : (old.bone_mapping_config || '{}'),
        is_calibrated !== undefined ? (is_calibrated === 'true' || is_calibrated === true) : old.is_calibrated,
        calibrated_at ? new Date(calibrated_at) : old.calibrated_at,
        parseInt(calibration_version) || old.calibration_version || 1,
        id,
        model_source_platform !== undefined ? model_source_platform : old.model_source_platform,
        anim_mode || old.anim_mode || 'custom',
        selected_anim_platform !== undefined ? selected_anim_platform : old.selected_anim_platform,
      ]
    );

    if (result.rows[0].is_default) {
      await query('UPDATE character_templates SET is_default = FALSE WHERE id != $1', [id]);
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '更新模板失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id/bone-map  单独保存骨骼映射（骨骼绑定Tab专用）
router.put('/:id/bone-map', async (req, res) => {
  try {
    const { id } = req.params;
    const { bone_map } = req.body;
    if (!bone_map) return res.status(400).json({ error: '缺少 bone_map 参数' });
    const bm = typeof bone_map === 'string' ? JSON.parse(bone_map) : bone_map;
    const result = await query(
      'UPDATE character_templates SET bone_map=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,name,bone_map',
      [JSON.stringify(bm), id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, bone_map: result.rows[0].bone_map });
  } catch (e) {
    res.status(500).json({ error: '保存骨骼映射失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id/anim-sounds  保存动作音效配置
// Body: { anim_sounds: { walk: '/uploads/...mp3', run: '...', ... } }
router.put('/:id/anim-sounds', async (req, res) => {
  try {
    const { id } = req.params;
    const { anim_sounds } = req.body;
    if (!anim_sounds) return res.status(400).json({ error: '缺少 anim_sounds 参数' });
    const sounds = typeof anim_sounds === 'string' ? JSON.parse(anim_sounds) : anim_sounds;
    const result = await query(
      'UPDATE character_templates SET anim_sounds=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,name,anim_sounds',
      [JSON.stringify(sounds), id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, anim_sounds: result.rows[0].anim_sounds });
  } catch (e) {
    res.status(500).json({ error: '保存动作音效失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id/weapon-sounds  保存武器音效配置
// Body: { weapon_sounds: { equip_hum: '...', swing: '...', hit_impact: '...' } }
router.put('/:id/weapon-sounds', async (req, res) => {
  try {
    const { id } = req.params;
    const { weapon_sounds } = req.body;
    if (!weapon_sounds) return res.status(400).json({ error: '缺少 weapon_sounds 参数' });
    const sounds = typeof weapon_sounds === 'string' ? JSON.parse(weapon_sounds) : weapon_sounds;
    const result = await query(
      'UPDATE character_templates SET weapon_sounds=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,name,weapon_sounds',
      [JSON.stringify(sounds), id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, weapon_sounds: result.rows[0].weapon_sounds });
  } catch (e) {
    res.status(500).json({ error: '保存武器音效失败: ' + e.message });
  }
});

// POST /api/character-templates/upload-sound  上传单个音频文件
// multipart: sound_file
// Returns: { url: '/uploads/character-templates/sounds/sound-xxx.mp3' }
router.post('/upload-sound', uploadSound.single('sound_file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传音频文件' });
    const relUrl = '/uploads/character-templates/sounds/' + req.file.filename;
    res.json({ success: true, url: relUrl, filename: req.file.filename, size: req.file.size });
  } catch (e) {
    res.status(500).json({ error: '音频上传失败: ' + e.message });
  }
});

// POST /api/character-templates/skills/:skillId/upload-sound  上传技能激发音效
router.post('/skills/:skillId/upload-sound', uploadSound.single('sound_file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传音频文件' });
    const { skillId } = req.params;
    const relUrl = '/uploads/character-templates/sounds/' + req.file.filename;
    const volume = parseFloat(req.body.volume) || 0.8;
    const result = await query(
      'UPDATE template_skills SET fx_sound_url=$1, fx_sound_volume=$2 WHERE id=$3 RETURNING id,skill_name,fx_sound_url,fx_sound_volume',
      [relUrl, volume, skillId]
    );
    if (!result.rows.length) return res.status(404).json({ error: '技能不存在' });
    res.json({ success: true, skill: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: '技能音效上传失败: ' + e.message });
  }
});

// DELETE /api/character-templates/:id  删除模板
router.delete('/:id', async (req, res, next) => {
  try {
    // 【修复路由冲突】排除子模块路径
    const excludedPaths = ['weapons', 'world-rules', 'weather', 'anim-library'];
    if (excludedPaths.includes(req.params.id.toLowerCase())) {
      return next('route');
    }

    const { id } = req.params;
    const existing = await query('SELECT * FROM character_templates WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: '模板不存在' });

    const old = existing.rows[0];
    // 删除文件
    [old.glb_url, old.thumbnail_url,
     old.anim_idle_url, old.anim_walk_url, old.anim_run_url,
     old.anim_jump_url, old.anim_attack1_url, old.anim_attack2_url, old.anim_attack3_url,
     old.anim_hit_url, old.anim_death_url,
     old.anim_turn_left_url, old.anim_turn_right_url,
     old.anim_attack_stab_url, old.anim_attack_slash_url,
     old.anim_attack_swing_url, old.anim_attack_uppercut_url,
     old.anim_sheath_url, old.anim_draw_sword_url,
    ].forEach(u => {
      if (u) fs.unlink(path.join(__dirname, '../../public', u)).catch(() => {});
    });

    await query('DELETE FROM character_templates WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '删除模板失败' });
  }
});

// PUT /api/character-templates/:id/calibration  保存校准配置
router.put('/:id/calibration', async (req, res) => {
  try {
    const { id } = req.params;
    const { calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated } = req.body;
    
    if (!calibration_config) return res.status(400).json({ error: '缺少 calibration_config 参数' });
    
    const result = await query(
      `UPDATE character_templates SET 
        calibration_config = $1, 
        weapon_socket_config = $2, 
        bone_mapping_config = $3, 
        is_calibrated = $4, 
        calibrated_at = $5, 
        updated_at = CURRENT_TIMESTAMP 
       WHERE id = $6 
       RETURNING id, name, calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at`,
      [
        typeof calibration_config === 'string' ? calibration_config : JSON.stringify(calibration_config),
        weapon_socket_config ? (typeof weapon_socket_config === 'string' ? weapon_socket_config : JSON.stringify(weapon_socket_config)) : '{}',
        bone_mapping_config ? (typeof bone_mapping_config === 'string' ? bone_mapping_config : JSON.stringify(bone_mapping_config)) : '{}',
        is_calibrated === 'true' || is_calibrated === true,
        new Date(),
        id
      ]
    );
    
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, calibration: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存校准配置失败: ' + e.message });
  }
});

// GET /api/character-templates/:id/calibration  读取校准配置
router.get('/:id/calibration', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at FROM character_templates WHERE id = $1',
      [id]
    );
    
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, calibration: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取校准配置失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id/bone-mapping  保存骨骼映射
router.put('/:id/bone-mapping', async (req, res) => {
  try {
    const { id } = req.params;
    const { bone_mapping } = req.body;
    
    if (!bone_mapping) return res.status(400).json({ error: '缺少 bone_mapping 参数' });
    
    const result = await query(
      `UPDATE character_templates SET 
        bone_mapping_config = $1, 
        updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, name, bone_mapping_config`,
      [JSON.stringify(bone_mapping), id]
    );
    
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, bone_mapping: result.rows[0].bone_mapping_config });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存骨骼映射失败: ' + e.message });
  }
});

// ============================================================
// 模板技能 API
// ============================================================

// GET /api/character-templates/:id/skills
router.get('/:id/skills', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM template_skills WHERE template_id = $1 ORDER BY sort_order, created_at',
      [req.params.id]
    );
    res.json({ skills: result.rows });
  } catch (e) {
    res.status(500).json({ error: '获取技能失败' });
  }
});

// POST /api/character-templates/:id/skills  添加技能
router.post('/:id/skills', async (req, res) => {
  try {
    const { id: template_id } = req.params;
    const {
      skill_name, trigger_text, skill_type, skill_scope,
      animation_clip, anim_glb_url, effect_type, effect_power, range_distance,
      effect_duration, cooldown, particle_effect, icon_emoji, sort_order,
      fx_preset, fx_color, fx_glow, fx_particle, fx_duration,
    } = req.body;

    if (!skill_name) return res.status(400).json({ error: '技能名称不能为空' });

    const result = await query(
      `INSERT INTO template_skills
        (template_id, skill_name, trigger_text, skill_type, skill_scope, animation_clip, anim_glb_url,
         effect_type, effect_power, range_distance, effect_duration, cooldown, particle_effect, icon_emoji, sort_order,
         fx_preset, fx_color, fx_glow, fx_particle, fx_duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        template_id, skill_name, trigger_text || '',
        skill_type || 'attack', skill_scope || 'portable',
        animation_clip || '', anim_glb_url || null,
        effect_type || 'AOE_DAMAGE',
        parseInt(effect_power) || 0, parseInt(range_distance) || 5,
        parseInt(effect_duration) || 1000, parseInt(cooldown) || 3000,
        particle_effect || '', icon_emoji || '⚡',
        parseInt(sort_order) || 0,
        fx_preset || 'none',
        fx_color || null,
        fx_glow != null ? parseFloat(fx_glow) : null,
        fx_particle || null,
        parseInt(fx_duration) || 2000,
      ]
    );
    res.json({ success: true, skill: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '添加技能失败: ' + e.message });
  }
});

// POST /api/character-templates/skills/:skillId/upload-anim  上传技能动画GLB
router.post('/skills/:skillId/upload-anim', uploadSkillAnim.single('anim_file'), async (req, res) => {
  try {
    const { skillId } = req.params;
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const anim_glb_url = `/uploads/character-templates/skill-anims/${req.file.filename}`;
    
    // 查旧文件路径
    const old = await query('SELECT anim_glb_url FROM template_skills WHERE id = $1', [skillId]);
    if (!old.rows.length) {
      // 删除上传的文件
      fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: '技能不存在' });
    }
    
    const oldAnimUrl = old.rows[0]?.anim_glb_url;
    
    // 先更新数据库
    const result = await query(
      'UPDATE template_skills SET anim_glb_url = $1 WHERE id = $2 RETURNING *',
      [anim_glb_url, skillId]
    );
    
    if (!result.rows.length) {
      // 删除上传的文件
      fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: '技能不存在' });
    }
    
    // 更新成功后再删除旧文件
    if (oldAnimUrl) {
      fs.unlink(path.join(__dirname, '../../public', oldAnimUrl)).catch(() => {});
    }
    
    res.json({ success: true, skill: result.rows[0], anim_glb_url });
  } catch (e) {
    // 发生错误时删除上传的文件
    if (req.file) {
      fs.unlink(req.file.path).catch(() => {});
    }
    console.error(e);
    res.status(500).json({ error: '上传技能动画失败: ' + e.message });
  }
});

// DELETE /api/character-templates/skills/:skillId  删除技能
router.delete('/skills/:skillId', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM template_skills WHERE id = $1 RETURNING id',
      [req.params.skillId]
    );
    if (!result.rows.length) return res.status(404).json({ error: '技能不存在' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除技能失败' });
  }
});

module.exports = router;
