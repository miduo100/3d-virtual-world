/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const fs = require('fs');
const path = require('path');
let _wsServerModule = null;
function getWsModule() {
  if (!_wsServerModule) {
    try { _wsServerModule = require('../websocket/wsServer'); } catch(e) {}
  }
  return _wsServerModule;
}

// Get world state (all active entities)
router.get('/state', async (req, res) => {
  try {
    // Get all characters in world
    const charactersResult = await query(
      `SELECT id, position, name FROM characters 
       WHERE position IS NOT NULL 
       AND position != '{"x": 0, "y": 0, "z": 0}'::jsonb`
    );

    // Get all monsters
    const monstersResult = await query(
      'SELECT id, monster_type, spawn_position, health FROM monsters WHERE is_active = TRUE'
    );

    // Get all shops
    const shopsResult = await query(
      'SELECT id, shop_name, position FROM shops'
    );

    // Get all plots
    const plotsResult = await query(
      'SELECT id, position, buildings FROM plots'
    );

    // 从 WebSocket 服务器内存中获取在线玩家的 glbUrl（仅内存中有，数据库不存储）
    const wsModule = getWsModule();
    const onlineGlbMap = new Map(); // characterId -> glbUrl
    if (wsModule && typeof wsModule.getPlayerPositions === 'function') {
      wsModule.getPlayerPositions().forEach((pd) => {
        if (pd.characterId && pd.glbUrl) {
          onlineGlbMap.set(String(pd.characterId), pd.glbUrl);
        }
      });
    }

    // 合并 glbUrl 到角色数据
    const characters = charactersResult.rows.map(c => ({
      ...c,
      glbUrl: onlineGlbMap.get(String(c.id)) || null,
    }));

    res.json({
      characters,
      monsters: monstersResult.rows,
      shops: shopsResult.rows,
      plots: plotsResult.rows,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch world state' });
  }
});

// Broadcast message to all connected users (via WebSocket)
router.post('/broadcast', async (req, res) => {
  try {
    const { message, type } = req.body;
    // This will be handled by WebSocket server
    res.json({ message: 'Broadcast queued' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to broadcast' });
  }
});

// Get all world objects (including generated buildings and ad slots)
router.get('/objects', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM world_objects 
      ORDER BY created_at DESC
    `);

    // 查询有效广告位（未过期且激活的）
    const adSlotsResult = await query(`
      SELECT * FROM ad_slots
      WHERE is_active = TRUE
        AND (rent_end IS NULL OR rent_end > NOW())
      ORDER BY created_at DESC
    `);

    // 将广告位映射为 world_objects 兼容格式
    const adSlotObjects = adSlotsResult.rows.map(slot => ({
      id: slot.id,
      type: 'ad_slot',
      name: slot.name || '广告位',
      model_path: slot.model_url || '__default_portal__',
      position_x: (slot.position && slot.position.x) ? Number(slot.position.x) : 0,
      position_y: (slot.position && slot.position.y) ? Number(slot.position.y) : 0,
      position_z: (slot.position && slot.position.z) ? Number(slot.position.z) : 0,
      rotation_x: (slot.rotation && slot.rotation.x) ? Number(slot.rotation.x) : 0,
      rotation_y: (slot.rotation && slot.rotation.y) ? Number(slot.rotation.y) : 0,
      rotation_z: (slot.rotation && slot.rotation.z) ? Number(slot.rotation.z) : 0,
      scale_x: (slot.scale && slot.scale.x) ? Number(slot.scale.x) : 1,
      scale_y: (slot.scale && slot.scale.y) ? Number(slot.scale.y) : 1,
      scale_z: (slot.scale && slot.scale.z) ? Number(slot.scale.z) : 1,
      // 广告位特有字段
      portal_type: slot.portal_type || slot.trigger_type,
      trigger_type: slot.trigger_type,
      target_url: slot.target_url,
      target_world_url: slot.target_world_url,
      target_world_name: slot.target_world_name,
      target_world_id: slot.target_world_id,
      deep_link: slot.deep_link,
      model_url: slot.model_url,
      created_at: slot.created_at
    }));

    // 对于几何体建筑，需要附加几何体数据
    // 为几何体建筑补充 geometry_data
    // 【2026-11-12 性能】原实现在 Promise.all 里对每个 geometry_building 单独查一次库（N+1），
    // 52 个建筑就是 52 次往返。改成一次分批 IN 查询，把结果映射回去。
    const _geoNeed = [];
    result.rows.forEach(obj => {
      if (obj.type !== 'geometry_building') return;
      let gid = null;
      if (obj.model_path && obj.model_path.startsWith('geometry_building:')) {
        gid = obj.model_path.replace('geometry_building:', '');
      } else if (obj.building_id) {
        gid = obj.building_id;
      }
      if (gid) _geoNeed.push({ obj: obj, id: String(gid) });
    });

    if (_geoNeed.length > 0) {
      try {
        const ids = Array.from(new Set(_geoNeed.map(x => x.id)));
        const geoRes = await query(
          'SELECT id::text AS id, geometry_data FROM geometry_buildings WHERE id::text = ANY($1::text[])',
          [ids]
        );
        const gmap = new Map();
        geoRes.rows.forEach(r => gmap.set(String(r.id), r.geometry_data));
        _geoNeed.forEach(x => {
          if (gmap.has(x.id)) x.obj.geometry_data = gmap.get(x.id);
        });
      } catch (err) {
        console.error('批量获取几何体数据失败:', err);
      }
    }

    const objectsWithData = result.rows;

    // 合并广告位对象
    const allObjects = [...objectsWithData, ...adSlotObjects];

    // 为每个有 model_path 的对象补充文件大小（用于前端优先级排序）
    // 【2026-11-12 性能】同一 model_path 只 stat 一次：
    // 原实现对 9145 个对象逐个 fs.existsSync + fs.statSync（Windows 上每次 0.3~1ms），
    // 单是这段同步文件 IO 就要 2~5 秒，是 /api/world/objects 慢的主因之一。
    // 实际上 9145 个对象只对应 300 个不同文件，缓存后只需 300 次 stat。
    const publicDir = path.join(__dirname, '..', '..', 'public');
    const _sizeCache = new Map();   // model_path -> size | null
    allObjects.forEach(obj => {
      if (obj.model_path && obj.model_path !== '__default_portal__') {
        if (_sizeCache.has(obj.model_path)) {
          const cached = _sizeCache.get(obj.model_path);
          if (cached != null) obj.file_size = cached;
          return;
        }
        try {
          const modelRelativePath = obj.model_path.startsWith('/') ? obj.model_path.slice(1) : obj.model_path;
          const fullPath = path.join(publicDir, modelRelativePath);
          if (fs.existsSync(fullPath)) {
            const size = fs.statSync(fullPath).size;
            _sizeCache.set(obj.model_path, size);
            obj.file_size = size;
          } else {
            _sizeCache.set(obj.model_path, null);
          }
        } catch (err) {
          _sizeCache.set(obj.model_path, null);   // 文件不存在/无权限则忽略
        }
      }
    });

    console.log(`🌍 世界对象: ${result.rows.length} 常规 + ${adSlotObjects.length} 广告位`);

    res.json({
      success: true,
      objects: allObjects
    });
  } catch (error) {
    console.error('Get world objects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch world objects'
    });
  }
});

// Get specific world object
router.get('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT * FROM world_objects WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Object not found'
      });
    }

    res.json({
      success: true,
      object: result.rows[0]
    });
  } catch (error) {
    console.error('Get world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch world object'
    });
  }
});

// Create new world object
router.post('/objects', async (req, res) => {
  try {
    const { 
      type, name, model_path, model_type,
      position_x = 0, position_y = 0, position_z = 0,
      rotation_x = 0, rotation_y = 0, rotation_z = 0,
      scale_x = 1, scale_y = 1, scale_z = 1,
      building_id = null,
      world_id = 1,
      threejs_code = null,
      has_collision = false,
      custom_config = null,
      agent_description = null          // 🤖 AI 描述（给 AI/Agent 看，玩家不可见）
    } = req.body;

    if (!type || !name) {
      return res.status(400).json({
        success: false,
        error: 'Type and name are required'
      });
    }

    const insertQuery = `
      INSERT INTO world_objects
      (type, name, model_path, model_type, position_x, position_y, position_z,
       rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
       building_id, world_id, threejs_code, has_collision, custom_config, agent_description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
      RETURNING *
    `;

    const result = await query(insertQuery, [
      type, name, model_path, model_type,
      position_x, position_y, position_z,
      rotation_x, rotation_y, rotation_z,
      scale_x, scale_y, scale_z,
      building_id,
      world_id,
      threejs_code,
      has_collision,
      custom_config ? JSON.stringify(custom_config) : null,
      agent_description
    ]);

    console.log('✅ 世界对象已创建:', result.rows[0]);

    // Phase 4 埋点：AI 来源对象创建（origin='ai' 才记；失败绝不阻断创建）
    try { if (req.body && req.body.origin === 'ai') require('../worldai/perception/eventLog').log({ type: 'object_created', actorType: 'ai', worldObjectId: result.rows[0].id, payload: { name: String(name || '').slice(0, 60), type: String(type || '').slice(0, 40) } }); } catch (e) { /* 静默 */ }

    res.json({
      success: true,
      message: 'Object created successfully',
      object: result.rows[0],
      id: result.rows[0].id,
      object_id: result.rows[0].id
    });
  } catch (error) {
    console.error('Create world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create world object',
      details: error.message
    });
  }
});

// ===== 对象编组（world_object_groups）=====
// 组只存「名字 + 成员关系」，不存自身变换：成员坐标始终是世界坐标，
// 整体拖动组时由前端把世界变换烘焙回每个成员，组本身恒等 → 刷新重建零误差。

// 组列表（带成员数；空组也返回，前端决定是否隐藏）
router.get('/object-groups', async (req, res) => {
  try {
    const result = await query(`
      SELECT g.id, g.world_id, g.name, g.color, g.collapsed, g.sort_order, g.created_at,
             COUNT(o.id)::int AS member_count
      FROM world_object_groups g
      LEFT JOIN world_objects o ON o.group_id = g.id
      GROUP BY g.id
      ORDER BY g.sort_order ASC, g.created_at ASC
    `);
    res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('查询编组失败:', error);
    res.status(500).json({ success: false, error: '查询编组失败', details: error.message });
  }
});

// 建组：把 ids 里的对象收进新组（同批对象从原组移出）
router.post('/object-groups', async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
    const color = (req.body && req.body.color) || null;
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];

    if (!name) return res.status(400).json({ success: false, error: '组名不能为空' });
    if (ids.length === 0) return res.status(400).json({ success: false, error: 'ids 不能为空' });

    // world_id 跟随第一个成员（编辑器当前只编辑一个世界）
    const created = await query(`
      INSERT INTO world_object_groups (world_id, name, color)
      VALUES ((SELECT world_id FROM world_objects WHERE id = $1), $2, $3)
      RETURNING *
    `, [ids[0], name, color]);

    const groupId = created.rows[0].id;
    await query('UPDATE world_objects SET group_id = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [groupId, ids]);

    res.json({ success: true, group: { ...created.rows[0], member_count: ids.length } });
  } catch (error) {
    console.error('创建编组失败:', error);
    res.status(500).json({ success: false, error: '创建编组失败', details: error.message });
  }
});

// 改组：改名 / 折叠状态 / 颜色 / 成员集合（传 ids 表示「用这批对象替换组成员」）
router.patch('/object-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const fields = [];
    const values = [];
    let p = 1;

    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 120);
      if (!name) return res.status(400).json({ success: false, error: '组名不能为空' });
      fields.push(`name = $${p++}`);
      values.push(name);
    }
    if (body.color !== undefined) { fields.push(`color = $${p++}`); values.push(body.color); }
    if (body.collapsed !== undefined) { fields.push(`collapsed = $${p++}`); values.push(body.collapsed === true); }
    if (body.sort_order !== undefined) { fields.push(`sort_order = $${p++}`); values.push(Number(body.sort_order) || 0); }

    if (fields.length > 0) {
      fields.push('updated_at = NOW()');
      values.push(id);
      const r = await query(`UPDATE world_object_groups SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`, values);
      if (r.rows.length === 0) return res.status(404).json({ success: false, error: '编组不存在' });
    }

    if (Array.isArray(body.ids)) {
      const ids = body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
      // 先摘掉本组里不在新名单中的旧成员，再把新名单全部收进本组（可从别的组移过来）
      await query('UPDATE world_objects SET group_id = NULL, updated_at = NOW() WHERE group_id = $1 AND NOT (id = ANY($2::int[]))', [id, ids]);
      if (ids.length > 0) {
        await query('UPDATE world_objects SET group_id = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [id, ids]);
      }
    }

    const fresh = await query(`
      SELECT g.id, g.world_id, g.name, g.color, g.collapsed, g.sort_order,
             COUNT(o.id)::int AS member_count
      FROM world_object_groups g LEFT JOIN world_objects o ON o.group_id = g.id
      WHERE g.id = $1 GROUP BY g.id
    `, [id]);

    res.json({ success: true, group: fresh.rows[0] || null });
  } catch (error) {
    console.error('更新编组失败:', error);
    res.status(500).json({ success: false, error: '更新编组失败', details: error.message });
  }
});

// 解组：组成员 group_id 置空（对象本身保留），然后删组记录
router.delete('/object-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cleared = await query('UPDATE world_objects SET group_id = NULL, updated_at = NOW() WHERE group_id = $1', [id]);
    const del = await query('DELETE FROM world_object_groups WHERE id = $1 RETURNING id', [id]);
    if (del.rows.length === 0) return res.status(404).json({ success: false, error: '编组不存在' });
    res.json({ success: true, released: cleared.rowCount });
  } catch (error) {
    console.error('解组失败:', error);
    res.status(500).json({ success: false, error: '解组失败', details: error.message });
  }
});

// 批量更新世界对象（多选批量面板用）
// 只允许白名单字段，一条 SQL 更新 N 行 —— 避免前端为几百个对象循环发 PUT。
// body: { ids: number[], patch: { visible?, cast_shadow?, receive_shadow?, has_collision? } }
router.post('/objects/batch-update', async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    const patch = (req.body && req.body.patch) || {};

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids 不能为空' });
    }
    if (ids.length > 10000) {
      return res.status(400).json({ success: false, error: '单次最多更新 10000 个对象' });
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (patch.visible !== undefined) {
      updateFields.push(`visible = $${paramIndex++}`);
      updateValues.push(patch.visible === true || patch.visible === 'true' || patch.visible === 1);
    }
    if (patch.cast_shadow !== undefined) {
      updateFields.push(`cast_shadow = $${paramIndex++}`);
      updateValues.push(patch.cast_shadow === true || patch.cast_shadow === 'true' || patch.cast_shadow === 1);
    }
    if (patch.receive_shadow !== undefined) {
      updateFields.push(`receive_shadow = $${paramIndex++}`);
      updateValues.push(patch.receive_shadow === true || patch.receive_shadow === 'true' || patch.receive_shadow === 1);
    }
    if (patch.has_collision !== undefined) {
      updateFields.push(`has_collision = $${paramIndex++}`);
      updateValues.push(patch.has_collision === true || patch.has_collision === 'true' || patch.has_collision === 1);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, error: 'patch 里没有可更新字段' });
    }

    updateFields.push('updated_at = NOW()');
    const sql = `UPDATE world_objects SET ${updateFields.join(', ')} WHERE id = ANY($${paramIndex}::int[]) RETURNING id`;
    updateValues.push(ids);

    const result = await query(sql, updateValues);
    res.json({ success: true, updated: result.rowCount, ids: result.rows.map(r => r.id) });
  } catch (error) {
    console.error('批量更新对象错误:', error);
    res.status(500).json({ success: false, error: '批量更新失败', details: error.message });
  }
});

// Update world object
router.put('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, video_props, visible, castShadow, receiveShadow, has_collision, custom_config, agent_description } = req.body;

    console.log('📝 更新对象请求 - ID:', id, '类型:', typeof id);

    // 检测UUID格式ID - 尝试更新ad_slots等UUID主键表，否则存入transform_overrides
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      console.log('🔵 检测到UUID格式ID，尝试更新ad_slots/custom_npcs表...');

      // 尝试更新 ad_slots 表
      const adSlotUpdateFields = [];
      const adSlotValues = [];
      let adParamIndex = 1;

      if (name !== undefined) {
        adSlotUpdateFields.push(`name = $${adParamIndex++}`);
        adSlotValues.push(name);
      }
      if (position_x !== undefined || position_y !== undefined || position_z !== undefined) {
        adSlotUpdateFields.push(`position = $${adParamIndex++}`);
        adSlotValues.push(JSON.stringify({ x: position_x || 0, y: position_y || 0, z: position_z || 0 }));
      }
      if (rotation_x !== undefined || rotation_y !== undefined || rotation_z !== undefined) {
        adSlotUpdateFields.push(`rotation = $${adParamIndex++}`);
        adSlotValues.push(JSON.stringify({ x: rotation_x || 0, y: rotation_y || 0, z: rotation_z || 0 }));
      }
      if (scale_x !== undefined || scale_y !== undefined || scale_z !== undefined) {
        adSlotUpdateFields.push(`scale = $${adParamIndex++}`);
        adSlotValues.push(JSON.stringify({ x: scale_x || 1, y: scale_y || 1, z: scale_z || 1 }));
      }

      if (adSlotUpdateFields.length > 0) {
        adSlotUpdateFields.push(`updated_at = NOW()`);
        adSlotValues.push(id);

        // 先尝试 ad_slots
        try {
          const adResult = await query(
            `UPDATE ad_slots SET ${adSlotUpdateFields.join(', ')} WHERE id = $${adParamIndex} RETURNING *`,
            adSlotValues
          );
          if (adResult.rows.length > 0) {
            console.log('✅ ad_slots 更新成功, ID:', id);
            return res.json({ success: true, object: adResult.rows[0], source: 'ad_slots' });
          }
        } catch (adErr) {
          console.log('⚠️ ad_slots 更新失败:', adErr.message);
        }

        // 再尝试 custom_npcs
        const npcUpdateFields = [];
        const npcValues = [];
        let npcParamIndex = 1;
        if (name !== undefined) {
          npcUpdateFields.push(`name = $${npcParamIndex++}`);
          npcValues.push(name);
        }
        if (position_x !== undefined || position_y !== undefined || position_z !== undefined) {
          npcUpdateFields.push(`position = $${npcParamIndex++}`);
          npcValues.push(JSON.stringify({ x: position_x || 0, y: position_y || 0, z: position_z || 0 }));
        }
        if (npcUpdateFields.length > 0) {
          npcUpdateFields.push(`updated_at = NOW()`);
          npcValues.push(id);
          try {
            const npcResult = await query(
              `UPDATE custom_npcs SET ${npcUpdateFields.join(', ')} WHERE id = $${npcParamIndex} RETURNING *`,
              npcValues
            );
            if (npcResult.rows.length > 0) {
              console.log('✅ custom_npcs 更新成功, ID:', id);
              return res.json({ success: true, object: npcResult.rows[0], source: 'custom_npcs' });
            }
          } catch (npcErr) {
            console.log('⚠️ custom_npcs 更新失败:', npcErr.message);
          }
        }
      }

      // 【2026-09-16 修复】再尝试 portals 表（世界传送门，UUID主键）
      // 此前传送门编辑保存落到 transform_overrides，而传送门加载只读 portals 表，
      // 刷新后位置/名称改动全部丢失（"编辑传送门不能保存"根因）
      const portalUpdateFields = [];
      const portalValues = [];
      let portalParamIndex = 1;
      if (name !== undefined) {
        portalUpdateFields.push(`name = $${portalParamIndex++}`);
        portalValues.push(name);
      }
      if (position_x !== undefined || position_y !== undefined || position_z !== undefined) {
        portalUpdateFields.push(`source_position = $${portalParamIndex++}`);
        portalValues.push(JSON.stringify({ x: position_x || 0, y: position_y || 0, z: position_z || 0 }));
      }
      if (portalUpdateFields.length > 0) {
        try {
          portalUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`);
          portalValues.push(id);
          const portalResult = await query(
            `UPDATE portals SET ${portalUpdateFields.join(', ')} WHERE id = $${portalParamIndex} RETURNING *`,
            portalValues
          );
          if (portalResult.rows.length > 0) {
            console.log('✅ portals 更新成功, ID:', id);
            // portals 表没有 rotation/scale 列，若有传入则同步写入 transform_overrides 供前端加载时恢复
            const needOverride = rotation_x !== undefined || rotation_y !== undefined || rotation_z !== undefined ||
                                 scale_x !== undefined || scale_y !== undefined || scale_z !== undefined;
            if (needOverride) {
              try {
                await query(`
                  INSERT INTO object_transform_overrides (object_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                  ON CONFLICT (object_id)
                  DO UPDATE SET position_x = $2, position_y = $3, position_z = $4,
                                 rotation_x = $5, rotation_y = $6, rotation_z = $7,
                                 scale_x = $8, scale_y = $9, scale_z = $10,
                                 object_name = $11, updated_at = NOW()
                  RETURNING *
                `, [id, position_x || 0, position_y || 0, position_z || 0,
                    rotation_x || 0, rotation_y || 0, rotation_z || 0,
                    scale_x || 1, scale_y || 1, scale_z || 1,
                    name || null]);
              } catch (ovErr) {
                console.log('⚠️ portals 旋转/缩放写入 transform_overrides 失败:', ovErr.message);
              }
            }
            return res.json({ success: true, object: portalResult.rows[0], source: 'portals' });
          }
        } catch (portalErr) {
          console.log('⚠️ portals 更新失败:', portalErr.message);
        }
      }

      // UUID对象在已知表中都未找到，存入 transform_overrides 覆盖表
      console.log('💡 UUID对象未在已知表中找到，存入transform_overrides...');
      try {
        const overrideResult = await query(`
          INSERT INTO object_transform_overrides (object_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (object_id)
          DO UPDATE SET position_x = $2, position_y = $3, position_z = $4,
                         rotation_x = $5, rotation_y = $6, rotation_z = $7,
                         scale_x = $8, scale_y = $9, scale_z = $10,
                         object_name = $11, updated_at = NOW()
          RETURNING *
        `, [id, position_x || 0, position_y || 0, position_z || 0,
            rotation_x || 0, rotation_y || 0, rotation_z || 0,
            scale_x || 1, scale_y || 1, scale_z || 1,
            name || null]);
        if (overrideResult.rows.length > 0) {
          console.log('✅ transform_overrides 保存成功, ID:', id);
          return res.json({ success: true, override: overrideResult.rows[0], source: 'transform_overrides' });
        }
      } catch (overrideErr) {
        console.log('⚠️ transform_overrides 保存失败:', overrideErr.message);
      }

      return res.status(404).json({ success: false, error: 'UUID object not found in any table' });
    }

    // 特殊处理出生点
    if (id === 'spawn_point') {
      console.log('✅ 检测到出生点更新请求');
      const spawnPointData = {
        position: { x: position_x, y: position_y, z: position_z },
        rotation: { x: rotation_x, y: rotation_y, z: rotation_z },
        scale: { x: scale_x, y: scale_y, z: scale_z }
      };

      console.log('💾 保存出生点数据:', spawnPointData);

      // 保存到系统配置表
      await query(`
        INSERT INTO system_config (config_key, config_value, description)
        VALUES ('world_spawn_point', $1, '世界出生点位置和变换')
        ON CONFLICT (config_key) 
        DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP
      `, [JSON.stringify(spawnPointData)]);

      console.log('✅ 出生点保存成功');

      return res.json({
        success: true,
        object: {
          id: 'spawn_point',
          name: '出生点',
          type: 'system_spawn',
          position_x, position_y, position_z,
          rotation_x, rotation_y, rotation_z,
          scale_x, scale_y, scale_z
        }
      });
    }

    // 普通对象的更新逻辑
    console.log('📦 更新普通对象，ID:', id);
    
    // 构建动态更新查询（支持 video_props 字段）
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }
    if (position_x !== undefined) {
      updateFields.push(`position_x = $${paramIndex++}`);
      updateValues.push(position_x);
    }
    if (position_y !== undefined) {
      updateFields.push(`position_y = $${paramIndex++}`);
      updateValues.push(position_y);
    }
    if (position_z !== undefined) {
      updateFields.push(`position_z = $${paramIndex++}`);
      updateValues.push(position_z);
    }
    if (rotation_x !== undefined) {
      updateFields.push(`rotation_x = $${paramIndex++}`);
      updateValues.push(rotation_x);
    }
    if (rotation_y !== undefined) {
      updateFields.push(`rotation_y = $${paramIndex++}`);
      updateValues.push(rotation_y);
    }
    if (rotation_z !== undefined) {
      updateFields.push(`rotation_z = $${paramIndex++}`);
      updateValues.push(rotation_z);
    }
    if (scale_x !== undefined) {
      updateFields.push(`scale_x = $${paramIndex++}`);
      updateValues.push(scale_x);
    }
    if (scale_y !== undefined) {
      updateFields.push(`scale_y = $${paramIndex++}`);
      updateValues.push(scale_y);
    }
    if (scale_z !== undefined) {
      updateFields.push(`scale_z = $${paramIndex++}`);
      updateValues.push(scale_z);
    }
    // 视频属性
    if (video_props !== undefined) {
      updateFields.push(`video_props = $${paramIndex++}`);
      updateValues.push(typeof video_props === 'string' ? video_props : JSON.stringify(video_props));
    }
    // 碰撞检测
    if (has_collision !== undefined) {
      updateFields.push(`has_collision = $${paramIndex++}`);
      updateValues.push(has_collision);
    }
    // 渲染开关（原先前端发了 visible/castShadow/receiveShadow，但这里没有对应列 → 刷新即丢）
    if (visible !== undefined) {
      updateFields.push(`visible = $${paramIndex++}`);
      updateValues.push(visible === true || visible === 'true' || visible === 1);
    }
    if (castShadow !== undefined) {
      updateFields.push(`cast_shadow = $${paramIndex++}`);
      updateValues.push(castShadow === true || castShadow === 'true' || castShadow === 1);
    }
    if (receiveShadow !== undefined) {
      updateFields.push(`receive_shadow = $${paramIndex++}`);
      updateValues.push(receiveShadow === true || receiveShadow === 'true' || receiveShadow === 1);
    }
    // 自定义配置（粒子/动画/材质等参数）
    if (custom_config !== undefined) {
      updateFields.push(`custom_config = $${paramIndex++}`);
      updateValues.push(typeof custom_config === 'string' ? custom_config : JSON.stringify(custom_config));
    }
    // 🤖 AI 描述（给 AI/Agent 看，最长 500 字）
    if (agent_description !== undefined) {
      updateFields.push(`agent_description = $${paramIndex++}`);
      updateValues.push(agent_description === null ? null : String(agent_description).slice(0, 500));
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);
    
    const updateQuery = `
      UPDATE world_objects 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    console.log('📝 更新SQL:', updateQuery);
    console.log('📝 更新参数:', updateValues);

    const result = await query(updateQuery, updateValues);

    if (result.rows.length === 0) {
      console.log('❌ 对象未找到，ID:', id);
      return res.status(404).json({
        success: false,
        error: 'Object not found'
      });
    }

    console.log('✅ 对象更新成功');
    res.json({
      success: true,
      object: result.rows[0]
    });
  } catch (error) {
    console.error('❌ 更新对象错误:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update world object',
      details: error.message
    });
  }
});

// Delete world object
//
// 修复（2026-09-21）：原先无条件先执行 `DELETE FROM world_objects WHERE id = $1`，
// 但 world_objects.id 是**整数列** —— 传入 UUID（传送门 / 广告位 / 联邦副本等合成对象）
// 时 Postgres 抛 `invalid input syntax for type integer` → 直接被 catch → 500，
// 表现为"管理员模式下删除传送门删不掉"；且后面的 UUID 分支永远执行不到、
// 分支里也只认 ad_slots / custom_npcs，缺 portals（传送门的主表）。
// 现按 id 格式分流，并补上 portals。注意本路由**只能定义一次**（Express 先注册先匹配，
// 曾经的第二个同路径定义是永远执行不到的死代码，已合并删除）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 合成对象删除后同步清理其位置覆盖记录（失败不阻断删除本身） */
async function clearTransformOverride(objectId) {
  try {
    await query('DELETE FROM object_transform_overrides WHERE object_id = $1', [objectId]);
  } catch (e) { /* 表/列缺失时忽略 */ }
}

router.delete('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 【2026-11-15】出生点是系统对象，数据存在 system_config('world_spawn_point') 里，
    // 不在 world_objects 表中。前端（world_editor / unified_editor / buildingManager）
    // 三处入口都已拦截，这里再兜一层，防止直接调接口把落点删没。
    if (id === 'spawn_point') {
      return res.status(403).json({ success: false, error: '出生点是系统对象，不可删除' });
    }

    // ---------- 整数 ID：world_objects（主表）/ custom_npcs（SERIAL 主键）----------
    if (!UUID_RE.test(id)) {
      const result = await query('DELETE FROM world_objects WHERE id = $1 RETURNING *', [id]);
      if (result.rows.length > 0) {
        return res.json({ success: true, message: 'Object deleted successfully' });
      }
      try {
        const npcResult = await query('DELETE FROM custom_npcs WHERE id = $1 RETURNING *', [id]);
        if (npcResult.rows.length > 0) {
          return res.json({ success: true, message: 'Custom NPC deleted successfully' });
        }
      } catch (e) { /* ignore */ }
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    // ---------- UUID ID：portals / ad_slots（均 gen_random_uuid() 主键，互不相交）----------
    try {
      const portalResult = await query('DELETE FROM portals WHERE id = $1 RETURNING *', [id]);
      if (portalResult.rows.length > 0) {
        await clearTransformOverride(id);
        return res.json({ success: true, message: 'Portal deleted successfully' });
      }
    } catch (e) {
      console.warn('[world] 删除 portals 失败:', e.message);
    }

    try {
      const adResult = await query('DELETE FROM ad_slots WHERE id = $1 RETURNING *', [id]);
      if (adResult.rows.length > 0) {
        await clearTransformOverride(id);
        return res.json({ success: true, message: 'Ad slot deleted successfully' });
      }
    } catch (e) {
      console.warn('[world] 删除 ad_slots 失败:', e.message);
    }

    return res.status(404).json({ success: false, error: 'Object not found' });
  } catch (error) {
    console.error('Delete world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete world object',
      details: error.message
    });
  }
});

// Copy world object
router.post('/objects/:id/copy', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      offset_x = 5, offset_y = 0, offset_z = 0,
      // 可选：编辑器复制时前端传入 mesh 实际世界变换，
      // 避免数据库位置滞后（拖动保存延迟/未保存）导致副本回到旧位置
      position_x, position_y, position_z,
      rotation_x, rotation_y, rotation_z,
      scale_x, scale_y, scale_z
    } = req.body;

    // Get original object
    const originalResult = await query(
      'SELECT * FROM world_objects WHERE id = $1',
      [id]
    );

    if (originalResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Object not found'
      });
    }

    const original = originalResult.rows[0];

    // 优先使用前端传入的显式变换（+offset），未传入时回退数据库值（向后兼容）
    const hasExplicitPos = typeof position_x === 'number' && typeof position_y === 'number' && typeof position_z === 'number';
    const newX = hasExplicitPos ? position_x + offset_x : original.position_x + offset_x;
    const newY = hasExplicitPos ? position_y + offset_y : original.position_y + offset_y;
    const newZ = hasExplicitPos ? position_z + offset_z : original.position_z + offset_z;

    const hasExplicitRot = typeof rotation_x === 'number' && typeof rotation_y === 'number' && typeof rotation_z === 'number';
    const newRotX = hasExplicitRot ? rotation_x : (original.rotation_x || 0);
    const newRotY = hasExplicitRot ? rotation_y : (original.rotation_y || 0);
    const newRotZ = hasExplicitRot ? rotation_z : (original.rotation_z || 0);

    const hasExplicitScl = typeof scale_x === 'number' && typeof scale_y === 'number' && typeof scale_z === 'number';
    const newSclX = hasExplicitScl ? scale_x : (original.scale_x || 1);
    const newSclY = hasExplicitScl ? scale_y : (original.scale_y || 1);
    const newSclZ = hasExplicitScl ? scale_z : (original.scale_z || 1);

    // Create copy with offset position
    // 【2026-09-20 修复】补上 has_collision 透传：原 INSERT 列清单不含该列，
    // 副本会回落列默认值 FALSE，表现为"复制一次碰撞设置就丢了"（管理员模型级碰撞开关被复制动作清掉）。
    // 【2026-09-24 修复】补上 threejs_code / custom_config / video_props / model_type / world_id：
    // 原列清单不含 threejs_code，导致复制 threejs_code 类对象（如"光柱""草地"）时副本代码为空 →
    // 副本在世界里什么都不显示（addThreeJSModel 拿到空代码直接 return），
    // 而前端副本原地加载器认为"加载成功"、也不刷新页面 → 表现为"复制出来的不正常"。
    // 注意：is_locked 刻意不复制（副本应当可移动/可编辑）。
    const insertQuery = `
      INSERT INTO world_objects
      (type, name, model_path, model_type, position_x, position_y, position_z,
       rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
       building_id, has_collision, agent_description,
       threejs_code, custom_config, video_props, world_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18, $19, $20, NOW())
      RETURNING *
    `;

    const copyResult = await query(insertQuery, [
      original.type,
      `${original.name} (副本)`,
      original.model_path,
      original.model_type || null,
      newX,
      newY,
      newZ,
      newRotX,
      newRotY,
      newRotZ,
      newSclX,
      newSclY,
      newSclZ,
      original.building_id,
      original.has_collision === true,
      original.agent_description || null,
      original.threejs_code || null,
      original.custom_config || null,
      original.video_props || null,
      original.world_id || null
    ]);

    res.json({
      success: true,
      message: 'Object copied successfully',
      object: copyResult.rows[0]
    });
  } catch (error) {
    console.error('Copy world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to copy world object'
    });
  }
});

// Get spawn point configuration
router.get('/spawn-point', async (req, res) => {
  try {
    const result = await query(
      'SELECT config_value FROM system_config WHERE config_key = \'world_spawn_point\''
    );

    if (result.rows.length === 0) {
      // 返回默认出生点
      return res.json({
        success: true,
        spawnPoint: {
          position: { x: 0, y: 0.05, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        }
      });
    }

    const spawnPointData = JSON.parse(result.rows[0].config_value);
    res.json({
      success: true,
      spawnPoint: spawnPointData
    });
  } catch (error) {
    console.error('Get spawn point error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get spawn point'
    });
  }
});

// ============================================================
// 对象位置覆盖（Transform Overrides）
// 用于不在 world_objects 表中的对象（如UUID ID的"记忆空间"等）
// ============================================================

// 自动建表
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS object_transform_overrides (
        object_id VARCHAR(100) PRIMARY KEY,
        position_x FLOAT DEFAULT 0,
        position_y FLOAT DEFAULT 0,
        position_z FLOAT DEFAULT 0,
        rotation_x FLOAT DEFAULT 0,
        rotation_y FLOAT DEFAULT 0,
        rotation_z FLOAT DEFAULT 0,
        scale_x FLOAT DEFAULT 1,
        scale_y FLOAT DEFAULT 1,
        scale_z FLOAT DEFAULT 1,
        object_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ object_transform_overrides 表已就绪');
  } catch (e) {
    console.error('❌ 创建 object_transform_overrides 表失败:', e.message);
  }
})();

// 获取所有位置覆盖
router.get('/transform-overrides', async (req, res) => {
  try {
    const result = await query('SELECT * FROM object_transform_overrides');
    res.json({ success: true, overrides: result.rows });
  } catch (error) {
    console.error('获取位置覆盖失败:', error);
    res.status(500).json({ success: false, error: 'Failed to get transform overrides' });
  }
});

// 保存/更新位置覆盖（upsert）
router.put('/transform-overrides/:objectId', async (req, res) => {
  try {
    const { objectId } = req.params;
    const { position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name } = req.body;

    const result = await query(`
      INSERT INTO object_transform_overrides (object_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (object_id)
      DO UPDATE SET position_x = $2, position_y = $3, position_z = $4,
                     rotation_x = $5, rotation_y = $6, rotation_z = $7,
                     scale_x = $8, scale_y = $9, scale_z = $10,
                     object_name = $11, updated_at = NOW()
      RETURNING *
    `, [objectId, position_x || 0, position_y || 0, position_z || 0,
        rotation_x || 0, rotation_y || 0, rotation_z || 0,
        scale_x || 1, scale_y || 1, scale_z || 1,
        object_name || null]);

    res.json({ success: true, override: result.rows[0] });
  } catch (error) {
    console.error('保存位置覆盖失败:', error);
    res.status(500).json({ success: false, error: 'Failed to save transform override' });
  }
});

// 删除位置覆盖
router.delete('/transform-overrides/:objectId', async (req, res) => {
  try {
    const { objectId } = req.params;
    await query('DELETE FROM object_transform_overrides WHERE object_id = $1', [objectId]);
    res.json({ success: true });
  } catch (error) {
    console.error('删除位置覆盖失败:', error);
    res.status(500).json({ success: false, error: 'Failed to delete transform override' });
  }
});

module.exports = router;
