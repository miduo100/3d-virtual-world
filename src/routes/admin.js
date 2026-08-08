/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');
const configService = require('../services/configService');

// 管理员认证中间件：所有管理后台API都需要管理员登录
router.use(authenticateAdminToken);

// ==================== 用户管理 ====================

// 获取所有用户
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.username, u.email, u.role, u.federation_user, u.created_at,
             c.id as character_id, c.name as character_name,
             c.level as character_level, c.health as character_hp,
             c.max_health as character_max_hp, c.experience as character_exp,
             c.attack_power, c.defense
      FROM users u
      LEFT JOIN characters c ON u.id = c.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

// 更新用户角色
router.put('/users/:userId/role', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }

    await query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, userId]
    );

    res.json({ success: true, message: '角色更新成功' });
  } catch (error) {
    console.error('更新用户角色失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除用户
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // 删除用户的角色
    await query('DELETE FROM characters WHERE user_id = $1', [userId]);
    
    // 删除用户
    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ success: true, message: '用户删除成功' });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 更新角色属性（管理员专用）
router.put('/characters/:charId/stats', async (req, res) => {
  try {
    const { charId } = req.params;
    const { level, experience, health, max_health, attack_power, defense } = req.body;

    await query(
      `UPDATE characters SET
        level = COALESCE($1, level),
        experience = COALESCE($2, experience),
        health = COALESCE($3, health),
        max_health = COALESCE($4, max_health),
        attack_power = COALESCE($5, attack_power),
        defense = COALESCE($6, defense),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [level, experience, health, max_health, attack_power, defense, charId]
    );

    res.json({ success: true, message: '角色属性已更新' });
  } catch (error) {
    console.error('更新角色属性失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// ==================== 传送门管理 ====================

// 获取所有传送门
router.get('/portals', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, 
             COUNT(pl.id) as usage_count
      FROM portals p
      LEFT JOIN portal_logs pl ON p.id = pl.portal_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);

    // 解析JSON字段
    const parsedPortals = result.rows.map(p => ({
      ...p,
      position: typeof p.position === 'string' ? JSON.parse(p.position) : p.position,
      target_position: typeof p.target_position === 'string' ? JSON.parse(p.target_position) : p.target_position,
    }));

    res.json(parsedPortals);
  } catch (error) {
    console.error('获取传送门列表失败:', error);
    res.status(500).json({ error: '获取传送门列表失败' });
  }
});

// 创建传送门
router.post('/portals', async (req, res) => {
  try {
    const {
      name,
      portal_type,
      position,
      target_position,
      target_world_url,
      required_level,
      cooldown_seconds,
      description
    } = req.body;

    // 验证必填字段
    if (!name || !portal_type || !position) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    // 验证传送门类型
    if (!['local', 'remote'].includes(portal_type)) {
      return res.status(400).json({ error: '无效的传送门类型' });
    }

    // 本地传送门需要目标位置
    if (portal_type === 'local' && !target_position) {
      return res.status(400).json({ error: '本地传送门需要目标位置' });
    }

    // 远程传送门需要目标服务器URL
    if (portal_type === 'remote' && !target_world_url) {
      return res.status(400).json({ error: '远程传送门需要目标服务器URL' });
    }

    const result = await query(`
      INSERT INTO portals (
        name, description, source_position, target_position, target_world_url,
        portal_type, is_bidirectional, cooldown_seconds, required_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      name,
      description || '',
      JSON.stringify(position),
      target_position ? JSON.stringify(target_position) : null,
      target_world_url || null,
      portal_type,
      true,
      cooldown_seconds || 0,
      required_level || 1
    ]);

    res.json({
      success: true,
      portal_id: result.rows[0].id,
      message: '传送门创建成功'
    });
  } catch (error) {
    console.error('创建传送门失败:', error);
    console.error('错误详情:', error.message, error.detail, error.where);
    res.status(500).json({ error: '创建失败: ' + error.message });
  }
});

// 更新传送门
router.put('/portals/:portalId', async (req, res) => {
  try {
    const { portalId } = req.params;
    const {
      name,
      portal_type,
      position,
      target_position,
      target_world_url,
      required_level,
      cooldown_seconds,
      description
    } = req.body;

    await query(`
      UPDATE portals SET
        name = $1,
        description = $2,
        source_position = $3,
        target_position = $4,
        target_world_url = $5,
        portal_type = $6,
        is_bidirectional = $7,
        cooldown_seconds = $8,
        required_level = $9
      WHERE id = $10
    `, [
      name,
      description || '',
      JSON.stringify(position),
      target_position ? JSON.stringify(target_position) : null,
      target_world_url || null,
      portal_type,
      true,
      cooldown_seconds || 0,
      required_level || 1,
      portalId
    ]);

    res.json({ success: true, message: '传送门更新成功' });
  } catch (error) {
    console.error('更新传送门失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除传送门
router.delete('/portals/:portalId', async (req, res) => {
  try {
    const { portalId } = req.params;

    // 删除传送日志
    await query('DELETE FROM portal_logs WHERE portal_id = $1', [portalId]);
    
    // 删除传送门
    await query('DELETE FROM portals WHERE id = $1', [portalId]);

    res.json({ success: true, message: '传送门删除成功' });
  } catch (error) {
    console.error('删除传送门失败:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// ==================== 虚拟空间管理 ====================

// 获取所有连接的虚拟空间
router.get('/worlds', async (req, res) => {
  try {
    const { search } = req.query;
    
    // 检查 target_world_name 列是否存在，兼容旧数据库
    const colCheck = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'portals' AND column_name = 'target_world_name'
    `);
    const hasWorldName = colCheck.rows.length > 0;

    let queryString = hasWorldName ? `
      SELECT DISTINCT
        target_world_url as url,
        target_world_name as name,
        COUNT(*) as portal_count
      FROM portals
      WHERE portal_type = 'remote' AND target_world_url IS NOT NULL
    ` : `
      SELECT DISTINCT
        target_world_url as url,
        target_world_url as name,
        COUNT(*) as portal_count
      FROM portals
      WHERE portal_type = 'remote' AND target_world_url IS NOT NULL
    `;

    // 添加搜索条件
    if (search) {
      if (hasWorldName) {
        queryString += ' AND (target_world_name ILIKE $1 OR target_world_url ILIKE $1)';
      } else {
        queryString += ' AND target_world_url ILIKE $1';
      }
    }

    // 添加分组
    if (hasWorldName) {
      queryString += ' GROUP BY target_world_url, target_world_name';
    } else {
      queryString += ' GROUP BY target_world_url';
    }

    // 执行查询
    const params = search ? [`%${search}%`] : [];
    const result = await query(queryString, params);

    // 模拟状态检查（实际项目中应该通过健康检查API获取）
    const worldsWithStatus = result.rows.map(world => ({
      ...world,
      id: world.url, // 使用URL作为ID
      status: Math.random() > 0.2 ? 'online' : (Math.random() > 0.5 ? 'warning' : 'offline')
    }));

    res.json(worldsWithStatus);
  } catch (error) {
    console.error('获取虚拟空间列表失败:', error);
    res.status(500).json({ error: '获取列表失败' });
  }
});

// 检查世界健康状态
router.get('/worlds/:worldId/health', async (req, res) => {
  try {
    const { worldId } = req.params;
    
    // 模拟健康检查
    // 实际项目中应该向目标世界发送健康检查请求
    const status = Math.random() > 0.2 ? 'online' : (Math.random() > 0.5 ? 'warning' : 'offline');
    
    res.json({ success: true, status, worldId });
  } catch (error) {
    console.error('检查世界健康状态失败:', error);
    res.status(500).json({ error: '检查失败' });
  }
});

// 移除世界
router.delete('/worlds/:worldId', async (req, res) => {
  try {
    const { worldId } = req.params;
    
    // 实际项目中应该从trusted_worlds表中移除
    // 这里我们只是模拟删除
    
    res.json({ success: true, message: '世界移除成功' });
  } catch (error) {
    console.error('移除世界失败:', error);
    res.status(500).json({ error: '移除失败' });
  }
});

// ==================== 传送日志 ====================

// 获取传送日志
router.get('/portal-logs', async (req, res) => {
  try {
    const { limit = 50, page = 1, search, filter } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let queryString = `
      SELECT 
        pl.*,
        p.name as portal_name,
        p.portal_type,
        c.name as character_name,
        u.username
      FROM portal_logs pl
      JOIN portals p ON pl.portal_id = p.id
      JOIN characters c ON pl.character_id = c.id
      JOIN users u ON c.user_id = u.id
    `;

    // 添加搜索条件
    let params = [];
    let paramIndex = 1;

    if (search) {
      if (filter === 'user') {
        queryString += ` WHERE u.username ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex}`;
        params.push(`%${search}%`);
        paramIndex++;
      } else if (filter === 'world') {
        queryString += ` WHERE p.name ILIKE $${paramIndex}`;
        params.push(`%${search}%`);
        paramIndex++;
      } else {
        queryString += ` WHERE u.username ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex}`;
        params.push(`%${search}%`);
        paramIndex++;
      }
    }

    queryString += ` ORDER BY pl.used_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const result = await query(queryString, params);

    res.json(result.rows);
  } catch (error) {
    console.error('获取传送日志失败:', error);
    res.status(500).json({ error: '获取日志失败' });
  }
});

// ==================== 统计信息 ====================

// 获取系统统计
router.get('/stats', async (req, res) => {
  try {
    const stats = {
      users: (await query('SELECT COUNT(*) as count FROM users')).rows[0],
      characters: (await query('SELECT COUNT(*) as count FROM characters')).rows[0],
      buildings: (await query('SELECT COUNT(*) as count FROM generated_buildings WHERE status = $1', ['completed'])).rows[0],
      portals: (await query('SELECT COUNT(*) as count FROM portals')).rows[0],
      activePortals: (await query('SELECT COUNT(*) as count FROM portals WHERE is_active = true')).rows[0],
      remoteWorlds: (await query(`
        SELECT COUNT(DISTINCT target_world_url) as count 
        FROM portals 
        WHERE portal_type = 'remote' AND target_world_url IS NOT NULL
      `)).rows[0],
      totalTeleports: (await query('SELECT COUNT(*) as count FROM portal_logs')).rows[0],
      todayTeleports: (await query(`
        SELECT COUNT(*) as count FROM portal_logs 
        WHERE DATE(used_at) = CURRENT_DATE
      `)).rows[0]
    };

    res.json(stats);
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

// 获取联邦系统统计
router.get('/federation-stats', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysInt = parseInt(days);

    const totalTeleportsResult = await query('SELECT COUNT(*) as count FROM portal_logs');
    const recentTeleportsResult = await query(`
      SELECT COUNT(*) as count FROM portal_logs 
      WHERE used_at >= NOW() - INTERVAL '${daysInt} days'
    `);
    const worldsCountResult = await query(`
      SELECT COUNT(DISTINCT target_world_url) as count 
      FROM portals 
      WHERE portal_type = 'remote' AND target_world_url IS NOT NULL
    `);
    const trustedWorldsResult = await query('SELECT COUNT(*) as count FROM trusted_worlds WHERE enabled = true');
    const totalUsersResult = await query('SELECT COUNT(*) as count FROM users');
    const teleportHistoryResult = await query(`
      SELECT 
        DATE(used_at) as date, 
        COUNT(*) as count 
      FROM portal_logs 
      WHERE used_at >= NOW() - INTERVAL '${daysInt} days'
      GROUP BY DATE(used_at)
      ORDER BY date
    `);

    const stats = {
      totalTeleports: totalTeleportsResult.rows[0]?.count || 0,
      totalUsers: totalUsersResult.rows[0]?.count || 0,
      totalWorlds: worldsCountResult.rows[0]?.count || 0,
      averageTime: '0s', // 暂时设置为0s，后续可以根据实际数据计算
      recentTeleports: recentTeleportsResult.rows[0]?.count || 0,
      worldsCount: worldsCountResult.rows[0]?.count || 0,
      trustedWorlds: trustedWorldsResult.rows[0]?.count || 0,
      teleportHistory: teleportHistoryResult.rows
    };

    res.json(stats);
  } catch (error) {
    console.error('获取联邦统计信息失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

// ==================== 地块管理 ====================

// 获取所有地块
router.get('/plots', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, owner_id, position, size, created_at FROM plots ORDER BY created_at DESC'
    );
    res.json({ plots: result.rows });
  } catch (error) {
    console.error('获取地块列表失败:', error);
    res.status(500).json({ error: '获取地块列表失败' });
  }
});

// ==================== 系统配置管理 ====================

// 获取所有系统配置
router.get('/config', async (req, res) => {
  try {
    const configs = await configService.getAllConfigs(false); // 不包含敏感信息明文
    res.json({
      success: true,
      configs
    });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 获取单个配置
router.get('/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const value = await configService.getConfig(key, false); // 不解密
    
    res.json({
      success: true,
      key,
      value: value ? '********' : '',
      has_value: !!value
    });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 更新单个配置
router.put('/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const userId = req.adminUser.id;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const result = await configService.setConfig(key, value, userId, ipAddress);

    if (result.success) {
      res.json({
        success: true,
        message: '配置更新成功'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('更新配置失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 批量更新配置
router.post('/config/batch', async (req, res) => {
  try {
    const { configs } = req.body;
    const userId = req.adminUser.id;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: '无效的配置数据' });
    }

    const results = await configService.setConfigs(configs, userId, ipAddress);

    const failedUpdates = results.filter(r => !r.success);
    
    if (failedUpdates.length > 0) {
      return res.status(500).json({
        success: false,
        message: '部分配置更新失败',
        results
      });
    }

    res.json({
      success: true,
      message: '配置更新成功',
      results
    });
  } catch (error) {
    console.error('批量更新配置失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 验证腾讯云配置
router.post('/config/validate-tencent', async (req, res) => {
  try {
    const result = await configService.validateTencentConfig();
    res.json(result);
  } catch (error) {
    console.error('验证配置失败:', error);
    res.status(500).json({
      valid: false,
      message: error.message
    });
  }
});

// 测试混元3D连接
router.post('/config/test-hunyuan3d', async (req, res) => {
  try {
    const result = await configService.testHunyuan3DConnection();
    res.json(result);
  } catch (error) {
    console.error('测试连接失败:', error);
    res.status(500).json({
      valid: false,
      message: error.message
    });
  }
});

// 获取配置审计日志
router.get('/config/audit-logs', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logs = await configService.getAuditLogs(parseInt(limit));
    
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('获取审计日志失败:', error);
    res.status(500).json({ error: '获取日志失败' });
  }
});

// ==================== 3DGS 场景管理 ====================
const multer3dgs = require('multer');
const path3dgs = require('path');
const fs3dgs = require('fs').promises;

const storage3dgs = multer3dgs.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path3dgs.join(__dirname, '../../public/scenes/3dgs');
    try {
      await fs3dgs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path3dgs.extname(file.originalname).toLowerCase();
    cb(null, 'scene-' + suffix + ext);
  }
});

const upload3dgs = multer3dgs({
  storage: storage3dgs,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(rad|ply|spz|splat)$/i;
    if (allowed.test(file.originalname)) return cb(null, true);
    cb(new Error('仅支持 .rad .ply .spz .splat 格式'));
  }
});

// 获取场景列表
router.get('/3dgs/scenes', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', source_type = '', scene_type = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    if (search) { params.push(`%${search}%`); conditions.push(`(scene_name ILIKE $${params.length} OR description ILIKE $${params.length})`); }
    if (source_type) { params.push(source_type); conditions.push(`source_type = $${params.length}`); }
    if (scene_type) { params.push(scene_type); conditions.push(`scene_type = $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit), offset);
    const dataResult = await query(
      `SELECT * FROM scene_3dgs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countParams = params.slice(0, params.length - 2);
    const countResult = await query(`SELECT COUNT(*) FROM scene_3dgs ${where}`, countParams);
    res.json({ scenes: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    console.error('获取3DGS场景列表失败:', e);
    res.status(500).json({ error: '获取列表失败' });
  }
});

// 上传新场景
router.post('/3dgs/scenes', upload3dgs.single('rad_file'), async (req, res) => {
  try {
    const { scene_name, description, scene_type = 'outdoor', source_type = 'upload', splat_count = 0, lod_levels = 8, tags = '' } = req.body;
    if (!scene_name) return res.status(400).json({ error: '场景名称不能为空' });
    let rad_file_path = null, rad_file_url = null, file_size = 0;
    if (req.file) {
      rad_file_path = req.file.path;
      rad_file_url = '/scenes/3dgs/' + req.file.filename;
      file_size = req.file.size;
    }
    const tagsArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const result = await query(
      `INSERT INTO scene_3dgs (scene_name, description, scene_type, source_type, rad_file_path, rad_file_url, file_size, splat_count, lod_levels, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [scene_name, description, scene_type, source_type, rad_file_path, rad_file_url, file_size, parseInt(splat_count), parseInt(lod_levels), tagsArr]
    );
    res.json({ success: true, scene: result.rows[0] });
  } catch (e) {
    console.error('上传3DGS场景失败:', e);
    res.status(500).json({ error: '上传失败: ' + e.message });
  }
});

// 更新场景信息
router.put('/3dgs/scenes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { scene_name, description, scene_type, is_public, tags = '' } = req.body;
    const tagsArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const result = await query(
      `UPDATE scene_3dgs SET scene_name=$1, description=$2, scene_type=$3, is_public=$4, tags=$5 WHERE id=$6 RETURNING *`,
      [scene_name, description, scene_type, is_public !== false && is_public !== 'false', tagsArr, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '场景不存在' });
    res.json({ success: true, scene: result.rows[0] });
  } catch (e) {
    console.error('更新3DGS场景失败:', e);
    res.status(500).json({ error: '更新失败' });
  }
});

// 切换公开状态
router.patch('/3dgs/scenes/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_public } = req.body;
    await query('UPDATE scene_3dgs SET is_public=$1 WHERE id=$2', [is_public, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除场景
router.delete('/3dgs/scenes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT rad_file_path FROM scene_3dgs WHERE id=$1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: '场景不存在' });
    const { rad_file_path } = result.rows[0];
    await query('DELETE FROM scene_3dgs WHERE id=$1', [id]);
    if (rad_file_path) {
      fs3dgs.unlink(rad_file_path).catch(() => {});
    }
    res.json({ success: true });
  } catch (e) {
    console.error('删除3DGS场景失败:', e);
    res.status(500).json({ error: '删除失败' });
  }
});

// ==================== 3DGS 目录扫描与注册 ====================
const fsSync = require('fs');

/**
 * 递归扫描目录，返回所有 3DGS 文件
 */
function scanDir3dgs(baseDir, relDir) {
  const result = [];
  let entries;
  try {
    entries = fsSync.readdirSync(path3dgs.join(baseDir, relDir), { withFileTypes: true });
  } catch (e) {
    return result;
  }
  for (const entry of entries) {
    const entryRel = relDir ? relDir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      result.push(...scanDir3dgs(baseDir, entryRel));
    } else if (entry.isFile()) {
      const ext = path3dgs.extname(entry.name).toLowerCase();
      if (['.rad', '.ply', '.spz', '.splat'].includes(ext)) {
        result.push(entryRel);
      }
    }
  }
  return result;
}

// 扫描目录 API
router.get('/3dgs/scan', async (req, res) => {
  try {
    const baseDir = path3dgs.join(__dirname, '../../public/scenes/3dgs');
    // 确保目录存在
    await fs3dgs.mkdir(baseDir, { recursive: true });

    const relPaths = scanDir3dgs(baseDir, '');

    // 批量查询已注册的文件 URL
    const allRegistered = await query('SELECT id, scene_name, rad_file_url FROM scene_3dgs');
    const registeredMap = {};
    for (const row of allRegistered.rows) {
      if (row.rad_file_url) registeredMap[row.rad_file_url] = row;
    }

    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

    const files = relPaths.map(relPath => {
      const absPath = path3dgs.join(baseDir, relPath);
      let stat;
      try { stat = fsSync.statSync(absPath); } catch (e) { stat = null; }

      const fileUrl = '/scenes/3dgs/' + relPath.replace(/\\/g, '/');
      const nameNoExt = absPath.replace(/\.[^.]+$/, '');

      // 检测同名缩略图
      let autoThumbnail = null;
      for (const imgExt of IMAGE_EXTS) {
        const thumbAbs = nameNoExt + imgExt;
        if (fsSync.existsSync(thumbAbs)) {
          const thumbRel = (relPath.replace(/\\/g, '/').replace(/\.[^.]+$/, '')) + imgExt;
          autoThumbnail = '/scenes/3dgs/' + thumbRel;
          break;
        }
      }

      const regInfo = registeredMap[fileUrl];
      const filename = path3dgs.basename(relPath);
      const dirPart = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';

      return {
        filename,
        relative_path: relPath.replace(/\\/g, '/'),
        dir: dirPart,
        url: fileUrl,
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtime.toISOString() : null,
        ext: path3dgs.extname(filename).toLowerCase(),
        auto_thumbnail: autoThumbnail,
        registered: !!regInfo,
        scene_id: regInfo ? regInfo.id : null,
        scene_name: regInfo ? regInfo.scene_name : null
      };
    });

    res.json({ success: true, files });
  } catch (e) {
    console.error('扫描3DGS目录失败:', e);
    res.status(500).json({ error: '扫描失败: ' + e.message });
  }
});

// 批量注册 API（支持每个文件上传独立缩略图）
const multerScan = require('multer');
const storageScan = multerScan.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path3dgs.join(__dirname, '../../public/scenes/3dgs/thumbnails');
    try { await fs3dgs.mkdir(dir, { recursive: true }); cb(null, dir); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path3dgs.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'thumb-' + suffix + ext);
  }
});
const uploadScan = multerScan({
  storage: storageScan,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per thumbnail
  fileFilter: (req, file, cb) => {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('仅支持图片格式'));
  }
});

router.post('/3dgs/batch-register', uploadScan.any(), async (req, res) => {
  try {
    let items;
    try {
      items = JSON.parse(req.body.items || '[]');
    } catch (e) {
      return res.status(400).json({ error: 'items 参数格式错误' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '没有要注册的文件' });
    }

    const baseDir = path3dgs.join(__dirname, '../../public/scenes/3dgs');
    const uploadedFiles = req.files || [];

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const { relative_path, scene_name, scene_type = 'outdoor', source_type = 'local',
              splat_count = 0, lod_levels = 8, tags = '', description = '',
              thumbnail_key, auto_thumbnail } = item;

      if (!scene_name || !relative_path) {
        results.push({ relative_path, ok: false, error: '场景名称或路径不能为空' });
        continue;
      }

      const absPath = path3dgs.join(baseDir, relative_path);
      // 验证文件存在
      let stat;
      try { stat = fsSync.statSync(absPath); }
      catch (e) { results.push({ relative_path, ok: false, error: '文件不存在' }); continue; }

      const fileUrl = '/scenes/3dgs/' + relative_path.replace(/\\/g, '/');

      // 检查是否已注册
      const existCheck = await query('SELECT id FROM scene_3dgs WHERE rad_file_url=$1', [fileUrl]);
      if (existCheck.rows.length) {
        results.push({ relative_path, ok: false, error: '已注册', scene_id: existCheck.rows[0].id });
        continue;
      }

      // 确定缩略图 URL
      let thumbnailUrl = auto_thumbnail || null;
      if (thumbnail_key) {
        const uploadedThumb = uploadedFiles.find(f => f.fieldname === thumbnail_key);
        if (uploadedThumb) {
          thumbnailUrl = '/scenes/3dgs/thumbnails/' + uploadedThumb.filename;
        }
      }

      const tagsArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

      const insertResult = await query(
        `INSERT INTO scene_3dgs
           (scene_name, description, scene_type, source_type, rad_file_path, rad_file_url,
            file_size, splat_count, lod_levels, tags, thumbnail_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [scene_name, description, scene_type, source_type, absPath, fileUrl,
         stat.size, parseInt(splat_count), parseInt(lod_levels), tagsArr, thumbnailUrl]
      );

      results.push({ relative_path, ok: true, scene_id: insertResult.rows[0].id });
    }

    const successCount = results.filter(r => r.ok).length;
    res.json({ success: true, total: items.length, registered: successCount, results });
  } catch (e) {
    console.error('批量注册3DGS场景失败:', e);
    res.status(500).json({ error: '批量注册失败: ' + e.message });
  }
});

module.exports = router;
