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
    const objectsWithData = await Promise.all(result.rows.map(async (obj) => {
      if (obj.type === 'geometry_building') {
        let geometryBuildingId = null;

        // 优先从 model_path 提取ID
        if (obj.model_path && obj.model_path.startsWith('geometry_building:')) {
          geometryBuildingId = obj.model_path.replace('geometry_building:', '');
        }
        // 回退：通过 building_id 查询
        else if (obj.building_id) {
          geometryBuildingId = obj.building_id;
        }

        if (geometryBuildingId) {
          try {
            const geometryResult = await query(
              'SELECT geometry_data FROM geometry_buildings WHERE id = $1',
              [geometryBuildingId]
            );

            if (geometryResult.rows.length > 0) {
              obj.geometry_data = geometryResult.rows[0].geometry_data;
            }
          } catch (err) {
            console.error('获取几何体数据失败:', err);
          }
        }
      }
      return obj;
    }));

    // 合并广告位对象
    const allObjects = [...objectsWithData, ...adSlotObjects];

    // 为每个有 model_path 的对象补充文件大小（用于前端优先级排序）
    const publicDir = path.join(__dirname, '..', '..', 'public');
    allObjects.forEach(obj => {
      if (obj.model_path && obj.model_path !== '__default_portal__') {
        try {
          const modelRelativePath = obj.model_path.startsWith('/') ? obj.model_path.slice(1) : obj.model_path;
          const fullPath = path.join(publicDir, modelRelativePath);
          if (fs.existsSync(fullPath)) {
            obj.file_size = fs.statSync(fullPath).size;
          }
        } catch (err) {
          // 文件不存在则忽略，file_size 保持 undefined
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
      custom_config = null
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
       building_id, world_id, threejs_code, has_collision, custom_config, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
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
      custom_config ? JSON.stringify(custom_config) : null
    ]);

    console.log('✅ 世界对象已创建:', result.rows[0]);

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

// Update world object
router.put('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, video_props, visible, castShadow, receiveShadow, has_collision, custom_config } = req.body;

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
    // 自定义配置（粒子/动画/材质等参数）
    if (custom_config !== undefined) {
      updateFields.push(`custom_config = $${paramIndex++}`);
      updateValues.push(typeof custom_config === 'string' ? custom_config : JSON.stringify(custom_config));
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
router.delete('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 先尝试删除world_objects
    const result = await query(
      'DELETE FROM world_objects WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length > 0) {
      return res.json({ success: true, message: 'Object deleted successfully' });
    }

    // UUID格式ID：尝试ad_slots和custom_npcs
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      // 尝试ad_slots
      try {
        const adResult = await query('DELETE FROM ad_slots WHERE id = $1 RETURNING *', [id]);
        if (adResult.rows.length > 0) {
          return res.json({ success: true, message: 'Ad slot deleted successfully' });
        }
      } catch (e) { /* ignore */ }

      // 尝试custom_npcs
      try {
        const npcResult = await query('DELETE FROM custom_npcs WHERE id = $1 RETURNING *', [id]);
        if (npcResult.rows.length > 0) {
          return res.json({ success: true, message: 'Custom NPC deleted successfully' });
        }
      } catch (e) { /* ignore */ }
    }

    return res.status(404).json({
      success: false,
      error: 'Object not found'
    });
  } catch (error) {
    console.error('Delete world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete world object'
    });
  }
});

// Delete world object
router.delete('/objects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'DELETE FROM world_objects WHERE id = $1 RETURNING *',
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
      message: 'Object deleted successfully'
    });
  } catch (error) {
    console.error('Delete world object error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete world object'
    });
  }
});

// Copy world object
router.post('/objects/:id/copy', async (req, res) => {
  try {
    const { id } = req.params;
    const { offset_x = 5, offset_y = 0, offset_z = 0 } = req.body;

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

    // Create copy with offset position
    const insertQuery = `
      INSERT INTO world_objects 
      (type, name, model_path, position_x, position_y, position_z, 
       rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
       building_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *
    `;

    const copyResult = await query(insertQuery, [
      original.type,
      `${original.name} (副本)`,
      original.model_path,
      original.position_x + offset_x,
      original.position_y + offset_y,
      original.position_z + offset_z,
      original.rotation_x || 0,
      original.rotation_y || 0,
      original.rotation_z || 0,
      original.scale_x || 1,
      original.scale_y || 1,
      original.scale_z || 1,
      original.building_id
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
